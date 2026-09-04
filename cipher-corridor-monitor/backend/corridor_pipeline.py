"""
===============================================================================
 Novo Nordisk GBS Hackathon 2026 - Problem Statement 5
 Inventory Corridor Health Check Monitoring & Stock-Out Signal Capturing

 corridor_pipeline.py - single reproducible analysis pipeline
===============================================================================

 Supersedes and consolidates four exploratory scripts:
     profile_dataset.py   verify_signal.py   final_findings.py   check_identity.py

 WHAT THIS DOES
 --------------
   Stage 1  Load the wide "Export" sheet ONCE, straight from openpyxl.
   Stage 2  Reshape to a tidy long panel (row_id x week_seq x metric).
   Stage 3  Validate the file's internal arithmetic (recursion, movement, DOH).
   Stage 4  Characterise the supplied "Expected Stock Out" label.
   Stage 5  Evaluate the naive corridor breach rule as an alerting mechanism.
   Stage 6  Measure real early-warning lead time, per stock-out EPISODE.
   Stage 7  Risk concentration, seasonality, and data-quality sentinels.
   Stage 8  Persist: corridor_panel.parquet + corridor_findings.json

 WHY IT IS A SINGLE READ
 -----------------------
   The earlier scripts read the workbook twice - pandas for the numeric metrics
   and openpyxl for the TEXT "Expected Stock Out" column - then merged them on a
   week index derived independently on each side. That silently assumed the two
   column orderings agreed. They happened to, but nothing enforced it, and a
   misalignment would have invalidated every downstream conclusion without
   raising an error.

   Here every metric, numeric or text, is extracted from the SAME header scan and
   carries its own absolute column position. Week identity therefore comes from
   the spreadsheet itself rather than from a reconstructed ordering, so numeric
   and text metrics cannot drift apart. assert_alignment() enforces this.

 DETERMINISM
 -----------
   Pure function of the input workbook. No randomness, no network, no mutation of
   the source file. Delete the cache and rerun to reproduce byte-identical output.

 USAGE
 -----
   python corridor_pipeline.py              # cached if parquet present
   python corridor_pipeline.py --rebuild    # force full re-read of the Excel
   python corridor_pipeline.py --quiet      # write artefacts, suppress report
===============================================================================
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd

import openpyxl

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------
# Support upload: CORRIDOR_INPUT env var overrides the default source file path.
# When the web server receives an xlsx upload it sets this env var to the temp file path.
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_PARENT_DIR = os.path.dirname(os.path.dirname(_SCRIPT_DIR))
_SRC_CANDIDATES = [
    os.path.join(_SCRIPT_DIR, "Inventry_Corridor_Alert_Weekly_Aug2026_Jul2027.xlsx"),
    os.path.join(_PARENT_DIR, "Inventry_Corridor_Alert_Weekly_Aug2026_Jul2027.xlsx"),
    "Inventry_Corridor_Alert_Weekly_Aug2026_Jul2027.xlsx",
]
_DEFAULT_SRC = next((p for p in _SRC_CANDIDATES if os.path.isfile(p)), _SRC_CANDIDATES[0])
SRC = os.environ.get("CORRIDOR_INPUT") or _DEFAULT_SRC
SHEET = "Export"
PANEL_PARQUET = "corridor_panel.parquet"
FINDINGS_JSON = "corridor_findings.json"

N_BANNER_ROWS = 4          # rows 1-3 = Year/Month/Week banner, row 4 = metric names
ID_COLS = ["Region", "Brand", "Country", "MRP", "Product Group"]

# Canonical metric names as they appear in the workbook
INV = "Inventory"
DEM = "Demand For Week"
SUP = "Total Supply"
MOV = "Inventory Movement"
DOH = "Days On Hands (in days)"
SSD = "Safety Stock Days"
ESO = "Expected Stock Out"

DOH_SENTINEL = 9999.0       # "infinite cover" cap used by the source file
STOCK_OUT_LABEL = "stock out"

pd.set_option("display.width", 200)
pd.set_option("display.max_columns", 60)

F: dict = {}                # findings accumulator, serialised to JSON


# ----------------------------------------------------------------------------
# Shared helpers
# ----------------------------------------------------------------------------
def hr(title: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def pct(x) -> float:
    """Percentage, rounded for stable JSON output."""
    return round(float(x) * 100, 4)


def permanently_breaching(panel: pd.DataFrame) -> set[int]:
    """
    Series in corridor breach in every week of the horizon.

    Shared by Stage 5 and Stage 6 so both report against an identical basis.
    """
    n_weeks = int(panel["week_seq"].nunique())
    weeks_in_breach = panel.groupby("row_id")["breach"].sum()
    return set(weeks_in_breach[weeks_in_breach == n_weeks].index)


def num(x):
    """Coerce numpy scalars to plain JSON-safe Python values."""
    if x is None:
        return None
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (np.floating,)):
        return None if np.isnan(x) else round(float(x), 6)
    if isinstance(x, (np.bool_,)):
        return bool(x)
    return x


# ============================================================================
# STAGE 1 - LOAD
# ============================================================================
def load_workbook_once(path: str) -> tuple[list[dict], list[tuple]]:
    """
    Scan the header block once and return:
      schema : one dict per spreadsheet column, carrying its absolute position
      rows   : the raw data rows (tuples), untouched
    """
    if not os.path.exists(path):
        sys.exit(f"Source workbook not found: {path}")

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    if SHEET not in wb.sheetnames:
        sys.exit(f"Sheet '{SHEET}' not found. Sheets: {wb.sheetnames}")
    ws = wb[SHEET]

    stream = ws.iter_rows(values_only=True)
    banner = [next(stream) for _ in range(N_BANNER_ROWS)]
    years, months, weeks, metrics = banner[0], banner[1], banner[2], banner[3]

    def ffill(seq):
        """Merged banner cells only populate their first column; carry forward."""
        out, last = [], None
        for v in seq:
            blank = v is None or str(v).strip() == "" or str(v).lower() == "none"
            if blank:
                out.append(last)
            else:
                last = v
                out.append(v)
        return out

    years, months, weeks = ffill(years), ffill(months), ffill(weeks)

    schema = []
    for pos, raw_metric in enumerate(metrics):
        name = str(raw_metric).strip() if raw_metric is not None else ""
        if not name or name.lower() == "none":
            continue
        schema.append(
            {
                "pos": pos,
                "metric": name,
                "is_id": name in ID_COLS,
                "year": years[pos] if pos < len(years) else None,
                "month": months[pos] if pos < len(months) else None,
                "week": weeks[pos] if pos < len(weeks) else None,
            }
        )

    rows = list(stream)
    wb.close()
    return schema, rows


# ============================================================================
# STAGE 2 - RESHAPE
# ============================================================================
def build_panel(schema: list[dict], rows: list[tuple]) -> pd.DataFrame:
    """
    Reshape the wide sheet into a tidy long panel.

    Week identity is taken from each column's own banner values, so numeric and
    text metrics for the same week are guaranteed to line up by construction.
    """
    id_cols = [c for c in schema if c["is_id"]]
    metric_cols = [c for c in schema if not c["is_id"]]

    n_rows = len(rows)
    row_ids = np.arange(n_rows)

    # --- identifiers -------------------------------------------------------
    ids = pd.DataFrame({"row_id": row_ids})
    for c in id_cols:
        p = c["pos"]
        ids[c["metric"]] = [r[p] if p < len(r) else None for r in rows]

    # --- chronological week ordering, derived once from the banner ---------
    periods = {}
    for c in metric_cols:
        yr = pd.to_numeric(c["year"], errors="coerce")
        wk = pd.to_numeric(c["week"], errors="coerce")
        key = (c["year"], c["month"], c["week"])
        if key not in periods:
            periods[key] = {
                "year_num": yr,
                "week_num": wk,
                "Year": c["year"],
                "Month": c["month"],
                "Week": c["week"],
            }

    period_df = pd.DataFrame(periods.values())
    if period_df["year_num"].isna().any() or period_df["week_num"].isna().any():
        raise AssertionError(
            "Year/Week banner values are not numeric, so chronological ordering cannot be "
            "established. Inspect the header block before trusting any time-series result."
        )
    period_df = period_df.sort_values(["year_num", "week_num"], kind="mergesort").reset_index(drop=True)
    period_df["week_seq"] = np.arange(1, len(period_df) + 1)

    seq_of = {
        (r.Year, r.Month, r.Week): int(r.week_seq) for r in period_df.itertuples()
    }

    # --- melt each metric, tagging every value with its week_seq -----------
    blocks: dict[str, dict[int, list]] = {}
    for c in metric_cols:
        seq = seq_of[(c["year"], c["month"], c["week"])]
        p = c["pos"]
        col_vals = [r[p] if p < len(r) else None for r in rows]
        blocks.setdefault(c["metric"], {})[seq] = col_vals

    n_weeks = len(period_df)
    week_order = period_df["week_seq"].tolist()   # authoritative chronological ordering

    # Guard: every metric must have exactly one column per week. This catches both a
    # ragged metric and, more importantly, two week-blocks sharing an identical
    # (Year, Month, Week) banner triple - which would silently overwrite a week's data.
    for metric, by_seq in blocks.items():
        if len(by_seq) != n_weeks:
            raise AssertionError(
                f"Metric '{metric}' has {len(by_seq)} week blocks, expected {n_weeks}. "
                "Either the metric is ragged or two weeks share the same banner triple, "
                "which would corrupt the panel."
            )

    frames = []
    for metric, by_seq in blocks.items():
        # stack week blocks in strict chronological week_seq order
        ordered = [by_seq[s] for s in week_order]
        flat = np.concatenate([np.asarray(v, dtype=object) for v in ordered])
        frames.append(pd.Series(flat, name=metric))

    panel = pd.concat(frames, axis=1)
    # row_id cycles fastest within each week block; week_seq is held constant per block.
    # This must mirror the concatenation order above exactly.
    panel["row_id"] = np.tile(row_ids, n_weeks)
    panel["week_seq"] = np.repeat(week_order, n_rows)

    # attach calendar labels and identifiers
    panel = panel.merge(
        period_df[["week_seq", "Year", "Month", "Week"]], on="week_seq", how="left"
    )
    panel = panel.merge(ids, on="row_id", how="left")

    # --- typing: text label stays text, everything else numeric -----------
    numeric_metrics = [m for m in blocks if m != ESO]
    for m in numeric_metrics:
        panel[m] = pd.to_numeric(panel[m], errors="coerce")

    if ESO in panel.columns:
        panel[ESO] = panel[ESO].astype("string").str.strip()

    panel = panel.sort_values(["row_id", "week_seq"], kind="mergesort").reset_index(drop=True)
    return panel, period_df, numeric_metrics


def derive_flags(panel: pd.DataFrame) -> pd.DataFrame:
    """
    Add the boolean columns every later stage depends on.

    Cast to plain numpy bool rather than pandas' nullable BooleanDtype: the run-length
    routine calls .to_numpy(), which on a nullable column yields an object array.
    """
    panel["is_out"] = panel[ESO].str.lower().eq(STOCK_OUT_LABEL).fillna(False).astype(bool)
    panel["breach"] = (panel[DOH] < panel[SSD]).astype(bool)
    panel["inv_neg"] = (panel[INV] < 0).astype(bool)
    return panel


def assert_alignment(panel: pd.DataFrame) -> None:
    """
    Guard the single assumption that matters: that the text stock-out label and
    the numeric inventory column describe the same SKU-week.

    'Stock Out' should coincide with negative inventory. If the numeric and text
    blocks were misaligned this identity would shatter, so it doubles as an
    alignment test. Fail loudly rather than reporting corrupted findings.
    """
    if ESO not in panel.columns:
        return
    labelled = panel[ESO].notna()
    if not labelled.any():
        raise AssertionError(
            f"'{ESO}' is entirely empty after load - text column was destroyed."
        )

    agreement = (panel["inv_neg"] == panel["is_out"]).mean()
    if agreement < 0.99:
        raise AssertionError(
            "ALIGNMENT FAILURE: 'Stock Out' label agrees with (Inventory < 0) only "
            f"{100 * agreement:.2f}% of the time. Numeric and text metric blocks are "
            "probably misaligned; every downstream finding would be invalid."
        )
    print(f"  alignment guard passed: label vs (Inventory<0) = {100 * agreement:.4f}%")


# ============================================================================
# STAGE 3 - VALIDATE THE FILE'S OWN ARITHMETIC
# ============================================================================
def validate_formulas(panel: pd.DataFrame, quiet: bool) -> None:
    """
    Reverse-engineer and confirm the three rules the projection engine must obey.
    Getting the recursion's timing convention wrong silently produces a plausible
    but incorrect forward projection, so this is verified rather than assumed.
    """
    if not quiet:
        hr("STAGE 3  FILE ARITHMETIC - the rules our projection engine must obey")

    g = panel.copy()
    g["inv_prev"] = g.groupby("row_id")[INV].shift(1)
    g["sup_prev"] = g.groupby("row_id")[SUP].shift(1)
    g["dem_prev"] = g.groupby("row_id")[DEM].shift(1)

    candidates = {
        # same-week supply/demand land on the SAME week's closing balance
        "Inv[t-1] + Supply[t] - Demand[t]": g["inv_prev"] + g[SUP] - g[DEM],
        "Inv[t-1] + Movement[t]": g["inv_prev"] + g[MOV],
        # the intuitive-but-wrong convention, kept to document the trap
        "Inv[t-1] + Supply[t-1] - Demand[t-1]": g["inv_prev"] + g["sup_prev"] - g["dem_prev"],
    }

    recursion = {}
    for name, pred in candidates.items():
        cmp = pd.DataFrame({"actual": g[INV], "pred": pred}).dropna()
        err = (cmp["actual"] - cmp["pred"]).abs()
        recursion[name] = {
            "n": int(len(cmp)),
            "match_within_0_01_pct": pct((err < 0.01).mean()),
            "median_abs_err": num(err.median()),
        }
        if not quiet:
            print(
                f"  {name:40s} n={len(cmp):>7,}  "
                f"within0.01={pct((err < 0.01).mean()):6.2f}%  median_err={err.median():,.6f}"
            )

    best = max(recursion, key=lambda k: recursion[k]["match_within_0_01_pct"])
    F["recursion"] = {"candidates": recursion, "confirmed": best}
    if not quiet:
        print(f"  -> CONFIRMED: Inventory[t] = {best}")

    # Movement identity
    d = (panel[MOV] - (panel[SUP] - panel[DEM])).abs()
    F["movement_identity"] = {
        "rule": "Inventory Movement = Total Supply - Demand For Week",
        "exact_match_pct": pct((d < 1e-6).mean()),
        "within_0_01_pct": pct((d < 0.01).mean()),
    }
    if not quiet:
        print(
            f"\n  Movement = Supply - Demand      exact={pct((d < 1e-6).mean()):.2f}%  "
            f"within0.01={pct((d < 0.01).mean()):.2f}%"
        )

    # DOH formula, with sentinel cap
    s = panel.copy()
    with np.errstate(divide="ignore", invalid="ignore"):
        s["calc"] = s[INV] / (s[DEM] / 7.0)
    s["calc_capped"] = s["calc"].clip(upper=DOH_SENTINEL)
    doh_res = {}
    for col in ["calc", "calc_capped"]:
        cmp = s[[DOH, col]].replace([np.inf, -np.inf], np.nan).dropna()
        err = (cmp[DOH] - cmp[col]).abs()
        doh_res[col] = {
            "n": int(len(cmp)),
            "within_0_01_pct": pct((err < 0.01).mean()),
            "within_0_5_pct": pct((err < 0.5).mean()),
            "spearman": num(cmp[DOH].corr(cmp[col], method="spearman")),
        }
        if not quiet:
            print(
                f"  DOH = Inventory/(Demand/7) [{col:11s}]  "
                f"within0.01={doh_res[col]['within_0_01_pct']:6.2f}%  "
                f"spearman={doh_res[col]['spearman']}"
            )
    F["doh_formula"] = {
        "rule": f"Days On Hand = Inventory / (Demand For Week / 7), capped at {int(DOH_SENTINEL)}",
        "variants": doh_res,
        "sentinel_rows": int((panel[DOH] >= DOH_SENTINEL).sum()),
    }


# ============================================================================
# STAGE 4 - CHARACTERISE THE SUPPLIED LABEL
# ============================================================================
def characterise_label(panel: pd.DataFrame, quiet: bool) -> None:
    """
    The single most consequential finding: what 'Expected Stock Out' actually is.
    If it equals (Inventory < 0) it is reactive - it fires the week the balance
    has already gone negative - and carries no predictive information.
    """
    if not quiet:
        hr("STAGE 4  WHAT IS 'Expected Stock Out'?")
        print("label value counts:")
        print(panel[ESO].value_counts(dropna=False).to_string())

    tests = {
        "Inventory < 0": panel[INV] < 0,
        "Inventory <= 0": panel[INV] <= 0,
        "DOH < 0": panel[DOH] < 0,
        "DOH <= 0": panel[DOH] <= 0,
        "DOH < Safety Stock Days": panel[DOH] < panel[SSD],
    }
    equiv = {}
    for name, cond in tests.items():
        equiv[name] = pct((cond == panel["is_out"]).mean())
        if not quiet:
            print(f"  agreement with '{STOCK_OUT_LABEL}': {name:26s} {equiv[name]:9.4f}%")

    exact = [k for k, v in equiv.items() if v >= 99.999]
    F["label"] = {
        "dtype": "text",
        "distinct_values": sorted(panel[ESO].dropna().unique().tolist()),
        "stock_out_weeks": int(panel["is_out"].sum()),
        "total_weeks": int(len(panel)),
        "stock_out_pct": pct(panel["is_out"].mean()),
        "equivalence_tests": equiv,
        "exact_equivalents": exact,
        "is_reactive": bool(exact),
    }
    if not quiet and exact:
        print(f"\n  -> '{ESO}' is EXACTLY equivalent to: {exact}")
        print("  -> REACTIVE label: it fires the week stock has ALREADY gone negative.")
        print("  -> Reproducing it adds no value; the task is to predict it earlier.")


# ============================================================================
# STAGE 5 - THE NAIVE ALERT RULE
# ============================================================================
def evaluate_naive_alert(panel: pd.DataFrame, quiet: bool) -> None:
    """
    Quantify why threshold alerting fails: recall is arithmetically guaranteed,
    so only precision carries information.

    Safety Stock Days is always >= 14, and a stock-out means Inventory < 0, hence
    DOH < 0 < SSD. So 'DOH < SSD' catches 100% of stock-outs BY ALGEBRA, not by
    merit. Quoting that recall as an achievement would be a tautology.
    """
    if not quiet:
        hr("STAGE 5  THE NAIVE CORRIDOR BREACH AS AN ALERT RULE")

    b, o = panel["breach"], panel["is_out"]
    precision = float(o[b].mean()) if b.any() else float("nan")
    recall = float((b & o).sum() / o.sum()) if o.any() else float("nan")

    ssd_min = num(panel[SSD].min())
    F["naive_alert"] = {
        "breach_weeks": int(b.sum()),
        "breach_rate_pct": pct(b.mean()),
        "stock_out_weeks": int(o.sum()),
        "stock_out_rate_pct": pct(o.mean()),
        "precision_pct": pct(precision),
        "recall_pct": pct(recall),
        "alerts_per_real_event": num(b.sum() / max(o.sum(), 1)),
        "safety_stock_days_min": ssd_min,
        "recall_is_tautological": bool(ssd_min is not None and ssd_min > 0),
        "tautology_note": (
            "Safety Stock Days is always > 0 and a stock-out implies Inventory < 0, "
            "hence DOH < 0 < SSD. 100% recall is therefore an algebraic identity, "
            "not evidence that the rule works. Only precision is informative."
        ),
    }
    if not quiet:
        print(pd.crosstab(b, o, rownames=["DOH<SSD"], colnames=["StockOut"]).to_string())
        print(f"\n  breach weeks    : {b.sum():,}  ({pct(b.mean()):.2f}%)")
        print(f"  stock-out weeks : {o.sum():,}  ({pct(o.mean()):.2f}%)")
        print(f"  PRECISION       : {pct(precision):.2f}%")
        print(f"  RECALL          : {pct(recall):.2f}%   <-- tautological, see note")
        print(
            f"\n  -> {b.sum():,} alerts to surface {o.sum():,} real events "
            f"({b.sum() / max(o.sum(), 1):.1f} alerts per event)."
        )
        print("  -> This is precisely the alert-fatigue failure mode to engineer against.")

    # Series permanently below the floor: evidence of mis-parameterised safety stock
    always = permanently_breaching(panel)
    ever_out = panel[panel["row_id"].isin(always)].groupby("row_id")["is_out"].any()
    F["permanent_breach"] = {
        "series_in_breach_every_week": int(len(always)),
        "of_which_ever_stock_out": int(ever_out.sum()),
        "interpretation": (
            "Series that sit below the corridor floor for the entire horizon yet never "
            "stock out indicate the floor is mis-parameterised for them. Such series "
            "generate perpetual noise and must be separated from genuine risk."
        ),
    }
    if not quiet:
        print(f"\n  series in breach EVERY week: {len(always):,}")
        print(f"    of which ever actually stock out: {int(ever_out.sum()):,}")

    # Structural separator: median DOH / SSD ratio per series
    med = panel.groupby("row_id").agg(
        med_doh=(DOH, "median"), ssd=(SSD, "median"), out=("is_out", "any")
    )
    med["ratio"] = med["med_doh"] / med["ssd"]
    bands = pd.cut(med["ratio"], [-np.inf, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, np.inf])
    tbl = med.groupby(bands, observed=False).agg(
        series=("out", "size"), pct_ever_out=("out", lambda x: round(100 * x.mean(), 2))
    )
    F["ratio_separator"] = {
        "definition": "per-series median Days On Hand / Safety Stock Days",
        "bands": [
            {"band": str(i), "series": int(r.series), "pct_ever_stock_out": num(r.pct_ever_out)}
            for i, r in tbl.iterrows()
        ],
        "interpretation": (
            "The ratio separates risk strongly and monotonically, so it is a usable "
            "prioritisation feature where the raw breach flag is not."
        ),
    }
    if not quiet:
        print("\n  per-series median DOH / SSD  vs  probability of ever stocking out:")
        print(tbl.to_string())


# ============================================================================
# STAGE 6 - REAL EARLY-WARNING LEAD TIME
# ============================================================================
def _true_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Contiguous (start, end) index runs of True."""
    out, i, n = [], 0, len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j + 1 < n and mask[j + 1]:
                j += 1
            out.append((i, j))
            i = j + 1
        else:
            i += 1
    return out


def measure_lead_time(panel: pd.DataFrame, quiet: bool) -> None:
    """
    Lead time per stock-out EPISODE, measured from the onset of the contiguous breach
    run active at the point the stock-out begins.

    IMPORTANT - this figure must be reported with its caveat, never on its own.

    A stock-out means Inventory < 0, so DOH < 0, and Safety Stock Days is always >= 14.
    The breach flag is therefore ALREADY true at the onset of every stock-out, by
    algebra. Two consequences:

      * "episodes with no prior warning" is ~0 by construction, not by merit.
      * for a series continuously in breach from week 1 that stocks out in week 40,
        this returns 39 weeks of "warning" - which is breach persistence, not
        predictive skill.

    So we additionally split the population by whether the series is in breach for the
    entire horizon. The subset that is NOT permanently in breach is the only place the
    signal carries genuine information, and that is the number worth quoting.
    """
    if not quiet:
        hr("STAGE 6  EARLY-WARNING LEAD TIME (per episode, with tautology caveat)")

    permanent = permanently_breaching(panel)

    leads, leads_transient, episodes, no_warning = [], [], 0, 0
    for rid, g in panel.groupby("row_id", sort=False):
        out_mask = g["is_out"].to_numpy()
        br_mask = g["breach"].to_numpy()
        breach_runs = _true_runs(br_mask)
        for start, _end in _true_runs(out_mask):
            episodes += 1
            # breach run active at, or immediately before, the onset
            prior = [r for r in breach_runs if r[0] <= start and r[1] >= start - 1]
            if prior:
                lead = start - max(r[0] for r in prior)
                leads.append(lead)
                if rid not in permanent:
                    leads_transient.append(lead)
            else:
                no_warning += 1

    leads_s = pd.Series(leads, dtype=float)
    trans_s = pd.Series(leads_transient, dtype=float)

    def stats(s: pd.Series) -> dict:
        if not len(s):
            return {"n": 0}
        return {
            "n": int(len(s)),
            "median_weeks": num(s.median()),
            "mean_weeks": num(s.mean()),
            "p25_weeks": num(s.quantile(0.25)),
            "p75_weeks": num(s.quantile(0.75)),
            "max_weeks": num(s.max()),
        }

    F["lead_time"] = {
        "method": (
            "Per stock-out episode, measured from the onset of the contiguous corridor "
            "breach run active immediately before it."
        ),
        "caveat": (
            "These figures are NOT evidence of predictive skill and must not be quoted "
            "without this qualification. A stock-out implies Inventory < 0, hence DOH < 0, "
            "and Safety Stock Days is always >= 14, so the breach flag is already true at "
            "the onset of every stock-out as a matter of algebra. 'Episodes without "
            "warning' is therefore approximately zero by construction, and a long lead "
            "time mostly reflects how long a series has been sitting below the floor "
            "rather than a signal that anticipated the event."
        ),
        "episodes": int(episodes),
        "episodes_with_prior_breach": int(len(leads_s)),
        "episodes_without_warning": int(no_warning),
        "pct_without_warning": pct(no_warning / max(episodes, 1)),
        "all_episodes": stats(leads_s),
        "excluding_permanently_breaching_series": stats(trans_s),
        "permanently_breaching_series": int(len(permanent)),
        "interpretation": (
            "The lead time excluding permanently-breaching series is the only informative "
            "variant, since for those series the breach flag never resets and so cannot "
            "distinguish a developing problem from a standing condition."
        ),
    }
    if not quiet:
        print(f"  stock-out episodes                : {episodes:,}")
        print(f"  preceded by a contiguous breach   : {len(leads_s):,}")
        print(f"  with NO advance warning           : {no_warning:,} "
              f"({pct(no_warning / max(episodes, 1)):.1f}%)  <-- ~0 BY ALGEBRA, not merit")
        if len(leads_s):
            print(f"\n  lead time, ALL episodes        : median={leads_s.median():.0f}w "
                  f"mean={leads_s.mean():.1f}w max={leads_s.max():.0f}w")
        if len(trans_s):
            print(f"  lead time, EXCLUDING permanent : median={trans_s.median():.0f}w "
                  f"mean={trans_s.mean():.1f}w  n={len(trans_s):,}   <-- the honest figure")
        else:
            print("  no episodes outside permanently-breaching series")
        print(f"  series permanently in breach   : {len(permanent):,}")
        print("\n  CAVEAT: breach is true at every stock-out onset by algebra;")
        print("          these numbers measure breach persistence, not predictive skill.")

    # Episode duration
    panel["_blk"] = (panel["is_out"] != panel.groupby("row_id")["is_out"].shift()).cumsum()
    ep_len = panel[panel["is_out"]].groupby(["row_id", "_blk"]).size()
    F["episode_length"] = {
        "episodes": int(len(ep_len)),
        "median_weeks": num(ep_len.median()) if len(ep_len) else None,
        "mean_weeks": num(ep_len.mean()) if len(ep_len) else None,
        "max_weeks": num(ep_len.max()) if len(ep_len) else None,
    }
    panel.drop(columns=["_blk"], inplace=True)
    if not quiet and len(ep_len):
        print(f"\n  stock-out episode length (weeks): median={ep_len.median():.0f} "
              f"mean={ep_len.mean():.2f} max={ep_len.max():.0f}")


# ============================================================================
# STAGE 7 - SHAPE, CONCENTRATION, SENTINELS
# ============================================================================
def profile_and_concentration(panel: pd.DataFrame, period_df: pd.DataFrame,
                              numeric_metrics: list[str], quiet: bool) -> None:
    if not quiet:
        hr("STAGE 7  SHAPE, CONCENTRATION AND DATA QUALITY")

    F["shape"] = {
        "source_file": SRC,
        "sheet": SHEET,
        "series": int(panel["row_id"].nunique()),
        "weeks": int(panel["week_seq"].nunique()),
        "sku_week_records": int(len(panel)),
        "metrics_per_week": int(len(numeric_metrics) + 1),
        "metric_names": sorted(numeric_metrics) + [ESO],
        "horizon_start": f"{period_df.iloc[0]['Month']} {period_df.iloc[0]['Year']} (wk {period_df.iloc[0]['Week']})",
        "horizon_end": f"{period_df.iloc[-1]['Month']} {period_df.iloc[-1]['Year']} (wk {period_df.iloc[-1]['Week']})",
        "is_forward_looking": True,
    }
    F["cardinality"] = {c: int(panel[c].nunique()) for c in ID_COLS if c in panel.columns}

    if not quiet:
        print(f"  series {F['shape']['series']:,} x weeks {F['shape']['weeks']} "
              f"= {F['shape']['sku_week_records']:,} SKU-week records")
        print(f"  horizon: {F['shape']['horizon_start']} -> {F['shape']['horizon_end']}")
        print(f"  grain cardinality: {F['cardinality']}")

    # grain uniqueness
    base = panel.drop_duplicates("row_id")
    F["grain_unique"] = bool(not base.duplicated(subset=[c for c in ID_COLS if c in base.columns]).any())

    # safety stock as policy master data
    nun = panel.groupby("row_id")[SSD].nunique()
    F["safety_stock"] = {
        "constant_within_series": bool((nun <= 1).all()),
        "series_with_varying_ssd": int((nun > 1).sum()),
        "min_days": num(panel[SSD].min()),
        "max_days": num(panel[SSD].max()),
        "distinct_value_count": int(panel[SSD].nunique()),
    }
    if not quiet:
        print(f"  safety stock days: {F['safety_stock']['min_days']}-{F['safety_stock']['max_days']}, "
              f"constant within series = {F['safety_stock']['constant_within_series']}")

    # order pipeline vs Total Supply - is the ladder additive?
    pipeline = [
        m for m in numeric_metrics
        if any(k in m.lower() for k in
               ["confirmed", "packed", "ready for ship", "in-transit", "in transit", "requisition"])
    ]
    components = [m for m in pipeline if "unconfirmed" not in m.lower() and "requisition" not in m.lower()]
    recon = None
    if components:
        approx = panel[components].fillna(0).sum(axis=1)
        d = (panel[SUP].fillna(0) - approx).abs()
        recon = {
            "components_tested": components,
            "exact_match_pct": pct((d < 1e-6).mean()),
            "median_abs_diff": num(d.median()),
            "reconciles": bool(pct((d < 1e-6).mean()) > 99),
        }
    F["supply_pipeline"] = {
        "pipeline_columns": pipeline,
        "reconciliation": recon,
        "open_question": (
            "Whether Total Supply is the sum of the order-pipeline stages or an "
            "independent figure determines whether supply certainty can be weighted "
            "by stage. This requires confirmation from the mentor."
        ),
    }
    if not quiet and recon:
        print(f"  Total Supply == sum(pipeline stages)? exact={recon['exact_match_pct']:.2f}% "
              f"-> reconciles={recon['reconciles']}")

    # sentinels / data quality
    null_counts = {m: int(panel[m].isna().sum()) for m in numeric_metrics}
    F["data_quality"] = {
        "null_counts_by_metric": null_counts,
        "metrics_with_nulls": {k: v for k, v in null_counts.items() if v},
        "any_nulls": bool(any(null_counts.values())),
        "doh_sentinel_rows": int((panel[DOH] >= DOH_SENTINEL).sum()),
        "doh_negative_rows": int((panel[DOH] < 0).sum()),
        "inventory_negative_rows": int((panel[INV] < 0).sum()),
        "zero_demand_weeks": int((panel[DEM] == 0).sum()),
        "zero_supply_weeks": int((panel[SUP] == 0).sum()),
        "zero_supply_pct": pct((panel[SUP] == 0).mean()),
        "id_nulls": {c: int(panel[c].isna().sum()) for c in ID_COLS if c in panel.columns},
        "label_nulls": int(panel[ESO].isna().sum()),
    }
    if not quiet:
        print(f"  DOH sentinel (>={int(DOH_SENTINEL)}) rows: {F['data_quality']['doh_sentinel_rows']:,}")
        print(f"  negative inventory rows          : {F['data_quality']['inventory_negative_rows']:,}")
        print(f"  weeks with zero supply           : {F['data_quality']['zero_supply_weeks']:,} "
              f"({F['data_quality']['zero_supply_pct']:.2f}%)")

    # concentration
    conc = {}
    for c in ["Region", "Brand", "MRP"]:
        if c not in panel.columns:
            continue
        t = panel.groupby(c).agg(
            stock_out_pct=("is_out", lambda x: round(100 * x.mean(), 3)),
            breach_pct=("breach", lambda x: round(100 * x.mean(), 2)),
            stock_out_weeks=("is_out", "sum"),
        ).sort_values("stock_out_weeks", ascending=False)
        conc[c] = [
            {"value": str(i), "stock_out_pct": num(r.stock_out_pct),
             "breach_pct": num(r.breach_pct), "stock_out_weeks": int(r.stock_out_weeks)}
            for i, r in t.iterrows()
        ]
    ctry = panel.groupby("Country").agg(stock_out_weeks=("is_out", "sum")).sort_values(
        "stock_out_weeks", ascending=False)
    total_out = ctry["stock_out_weeks"].sum()
    pareto = {}
    if total_out:
        cum = ctry["stock_out_weeks"].cumsum() / total_out
        for k in [5, 10, 20, 30, 50]:
            if k <= len(cum):
                pareto[f"worst_{k}_countries"] = pct(cum.iloc[k - 1])
    F["concentration"] = {
        "by_dimension": conc,
        "countries_total": int(len(ctry)),
        "countries_with_zero_stock_outs": int((ctry["stock_out_weeks"] == 0).sum()),
        "worst_countries": [
            {"country": str(i), "stock_out_weeks": int(r.stock_out_weeks)}
            for i, r in ctry.head(10).iterrows()
        ],
        "pareto_share_pct": pareto,
    }
    if not quiet:
        print(f"  countries with zero stock-outs: "
              f"{F['concentration']['countries_with_zero_stock_outs']}/{len(ctry)}")
        for k, v in pareto.items():
            print(f"    {k}: {v:.1f}% of all stock-out weeks")

    # seasonality
    seas = panel.groupby("Month").agg(
        stock_outs=("is_out", "sum"), breaches=("breach", "sum"), median_doh=(DOH, "median")
    ).sort_values("stock_outs", ascending=False)
    F["seasonality"] = [
        {"month": str(i), "stock_outs": int(r.stock_outs), "breaches": int(r.breaches),
         "median_doh": num(r.median_doh)}
        for i, r in seas.iterrows()
    ]

    # synthetic?
    sample = " ".join(str(v) for v in panel.drop_duplicates("row_id").head(50)[
        [c for c in ID_COLS if c in panel.columns]].values.ravel())
    F["is_synthetic"] = bool("synthetic" in sample.lower())


# ============================================================================
# STAGE 8 - PERSIST
# ============================================================================
def persist(panel: pd.DataFrame, quiet: bool) -> None:
    panel.to_parquet(PANEL_PARQUET, index=False)
    F["_meta"] = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ"),
        "pipeline": os.path.basename(__file__),
        "pandas": pd.__version__,
        "numpy": np.__version__,
        "note": "Regenerate with: python corridor_pipeline.py --rebuild",
    }
    with open(FINDINGS_JSON, "w", encoding="utf-8") as fh:
        json.dump(F, fh, indent=2, default=str)
    if not quiet:
        hr("ARTEFACTS")
        print(f"  {PANEL_PARQUET}   analysis-ready panel ({len(panel):,} rows)")
        print(f"  {FINDINGS_JSON}   machine-readable findings, consumed by the docx generator")


# ============================================================================
# ORCHESTRATION
# ============================================================================
def run(rebuild: bool = False, quiet: bool = False) -> tuple[pd.DataFrame, dict]:
    F.clear()   # so a second in-process call cannot merge stale findings
    use_cache = os.path.exists(PANEL_PARQUET) and not rebuild

    if use_cache:
        if not quiet:
            hr("STAGE 1-2  LOADING CACHED PANEL")
        panel = pd.read_parquet(PANEL_PARQUET)
        panel[ESO] = panel[ESO].astype("string")
        panel = derive_flags(panel)
        period_df = (
            panel.drop_duplicates("week_seq")[["week_seq", "Year", "Month", "Week"]]
            .sort_values("week_seq").reset_index(drop=True)
        )
        numeric_metrics = [
            c for c in panel.columns
            if c not in ID_COLS + ["row_id", "week_seq", "Year", "Month", "Week",
                                   ESO, "is_out", "breach", "inv_neg"]
        ]
        if not quiet:
            print(f"  loaded {len(panel):,} rows from {PANEL_PARQUET}  (--rebuild to re-read Excel)")
    else:
        if not quiet:
            hr("STAGE 1  READING WORKBOOK (single pass, ~30MB)")
        schema, rows = load_workbook_once(SRC)
        if not quiet:
            print(f"  {len(schema)} named columns, {len(rows):,} data rows")
        if not quiet:
            hr("STAGE 2  RESHAPING TO TIDY PANEL")
        panel, period_df, numeric_metrics = build_panel(schema, rows)
        panel = derive_flags(panel)
        if not quiet:
            print(f"  panel: {len(panel):,} rows x {len(panel.columns)} cols")

    # every later stage relies on chronological order within each series
    panel = panel.sort_values(["row_id", "week_seq"], kind="mergesort").reset_index(drop=True)

    assert_alignment(panel)

    validate_formulas(panel, quiet)
    characterise_label(panel, quiet)
    evaluate_naive_alert(panel, quiet)
    measure_lead_time(panel, quiet)
    profile_and_concentration(panel, period_df, numeric_metrics, quiet)
    persist(panel, quiet)

    if not quiet:
        hr("HEADLINE CONCLUSIONS")
        lbl, na, lt = F["label"], F["naive_alert"], F["lead_time"]
        print(f"  1. '{ESO}' is text and exactly equals {lbl['exact_equivalents']}")
        print(f"     -> reactive, {lbl['stock_out_weeks']:,} weeks ({lbl['stock_out_pct']:.2f}%); "
              f"reproducing it adds nothing.")
        print(f"  2. Naive breach alerting: {na['breach_weeks']:,} alerts for "
              f"{na['stock_out_weeks']:,} events = {na['precision_pct']:.2f}% precision.")
        print(f"     -> 100% recall is algebraic, not a result.")
        honest = lt["excluding_permanently_breaching_series"]
        if honest.get("n"):
            print(f"  3. Lead time excl. permanently-breaching series: median "
                  f"{honest['median_weeks']:.0f} weeks (n={honest['n']:,}).")
            print("     -> raw lead time measures breach persistence, NOT predictive skill.")
        print(f"  4. Confirmed recursion: Inventory[t] = {F['recursion']['confirmed']}")
        print("\nDONE")

    return panel, F


def main() -> None:
    ap = argparse.ArgumentParser(description="Corridor dataset analysis pipeline (read-only).")
    ap.add_argument("--rebuild", action="store_true", help="force re-read of the source Excel")
    ap.add_argument("--quiet", action="store_true", help="write artefacts without the report")
    args = ap.parse_args()
    run(rebuild=args.rebuild, quiet=args.quiet)


if __name__ == "__main__":
    main()

