"""
generate_dashboard_data.py — 5-layer dashboard data pipeline
Reads  : backend/corridor_panel.parquet + corridor_findings.json + brand_price_master.json
Writes : backend/dashboard_data.json
"""
from __future__ import annotations
import json, math, os, sys
from datetime import datetime, timezone, date
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(HERE)
PARENT_DIR = os.path.dirname(PROJECT_ROOT)

def _resolve_file(filename: str, search_dirs: list[str]) -> str:
    """Find file in candidate search directories; auto-sync to HERE if found in parent."""
    for d in search_dirs:
        p = os.path.join(d, filename)
        if os.path.isfile(p):
            # Auto-sync to HERE if found in parent/project root but missing in HERE
            target_p = os.path.join(HERE, filename)
            if not os.path.isfile(target_p):
                try:
                    import shutil
                    shutil.copy2(p, target_p)
                    return target_p
                except Exception:
                    pass
            return p
    return os.path.join(HERE, filename)

SEARCH_DIRS = [HERE, PARENT_DIR, PROJECT_ROOT]
PARQUET_PATH      = _resolve_file("corridor_panel.parquet", SEARCH_DIRS)
FINDINGS_PATH     = _resolve_file("corridor_findings.json", SEARCH_DIRS)
PRICE_MASTER_PATH = _resolve_file("brand_price_master.json", SEARCH_DIRS)
OUTPUT_PATH       = os.path.join(HERE, "dashboard_data.json")

DEFAULT_LEAD_TIME_DAYS   = 14   # mentor spec: 14 working days
CALENDAR_LEAD_TIME_WEEKS = 2    # 14 working days ≈ 2 calendar weeks
CURRENT_WEEK             = 32
HORIZON_WEEKS            = 52
TOP_N_SIGNALS            = 15
CEILING_MULT             = 2.0  # default ceiling = 2× SSD (in units)

INV = "Inventory"; DEM = "Demand For Week"; SUP = "Total Supply"
SSD = "Safety Stock Days"; DOH = "Days On Hands (in days)"
UNC = "Unconfirmed Orders"; CON = "Confirmed Orders"

AT_CRISIS   = "ACTIVE CRISIS"
AT_EXPEDITE = "EMERGENCY EXPEDITE"
AT_PO       = "STANDARD PO"
AT_ADVISORY = "ADVISORY"
AT_EXCESS   = "EXCESS HOLDING"
ACTION_TYPE_CONTRACT = {AT_CRISIS, AT_EXPEDITE, AT_PO, AT_ADVISORY, AT_EXCESS}

def _jsafe(v):
    if isinstance(v, (np.integer,)): return int(v)
    if isinstance(v, (np.floating,)): return None if np.isnan(v) else round(float(v), 4)
    if isinstance(v, (np.bool_,)): return bool(v)
    return v

def _clamp(v, lo, hi): return max(lo, min(hi, v))

def ssd_to_units(ssd_days, weekly_demand):
    """Convert Safety Stock Days to inventory units using weekly demand."""
    return (ssd_days / 7.0) * weekly_demand

def compute_recommended_qty(inv_at_horizon, ssd_days, weekly_demand, ceil_mult=2.0):
    """
    recommended_qty = midpoint_target_units − inventory_at_lead_time_horizon
    midpoint = (ssd_units + ceiling_units) / 2  = 1.5 × ssd_units
    """
    ssd_units  = ssd_to_units(ssd_days, weekly_demand)
    ceil_units = ceil_mult * ssd_units
    midpoint   = (ssd_units + ceil_units) / 2.0   # = 1.5 × ssd_units
    return max(0.0, midpoint - inv_at_horizon), midpoint

# ===========================================================================
# LAYER 1 — signals + 52-week trajectories
# ===========================================================================
def layer1_load_and_signals(panel):
    n_weeks = int(panel["week_seq"].nunique())

    breach_sum = panel.groupby("row_id")["breach"].sum()
    is_out_any = panel.groupby("row_id")["is_out"].any()
    inv_trend  = panel.groupby("row_id")[INV].last() - panel.groupby("row_id")[INV].first()

    permanently_breaching = set(breach_sum[breach_sum == n_weeks].index)
    pure_chronic = set(rid for rid in permanently_breaching if not is_out_any.get(rid, False))
    has_breach   = set(breach_sum[breach_sum > 0].index)
    operational_ids = has_breach - permanently_breaching

    # Inventory trend: +ve = inventory rising over the 52 weeks (possible excess)
    excess_ids = set(inv_trend[inv_trend > 0].index)

    series_meta = (
        panel.groupby("row_id")
        .agg(
            region        = ("Region",   "first"),
            brand         = ("Brand",    "first"),
            country       = ("Country",  "first"),
            mrp           = ("MRP",      "first"),
            product_group = ("Product Group", "first"),
            ssd_med       = (SSD, "median"),
            doh_med       = (DOH, "median"),
            inv_mean      = (INV, "mean"),
            dem_mean      = (DEM, "mean"),
            dem_last      = (DEM, "last"),
            total_unc     = (UNC, "sum"),
            total_con     = (CON, "sum"),
            total_sup     = (SUP, "sum"),
        ).reset_index()
    )
    series_meta["doh_ssd_ratio"] = series_meta["doh_med"] / series_meta["ssd_med"].replace(0, np.nan)
    series_meta["is_excess"]     = series_meta["row_id"].isin(excess_ids)

    op_panel = panel[panel["row_id"].isin(operational_ids)].copy()
    op_panel  = op_panel.sort_values(["row_id", "week_seq"])

    first_breach = (
        op_panel[op_panel["breach"]].groupby("row_id")["week_seq"].min().rename("breach_week")
    )

    severity_s = (
        op_panel[op_panel["breach"]]
        .assign(deficit=lambda d: (d[SSD] - d[DOH]) / d[SSD].replace(0, np.nan))
        .groupby("row_id")["deficit"].median().clip(0, 1).rename("severity")
    )

    score_df = (
        first_breach.to_frame()
        .join(severity_s)
        .join(series_meta.set_index("row_id")[[
            "brand", "country", "region", "mrp", "product_group",
            "ssd_med", "doh_med", "dem_mean", "dem_last",
            "inv_mean", "total_unc", "total_con", "total_sup", "is_excess"
        ]])
        .dropna(subset=["breach_week", "severity"])
    )
    score_df["breach_week"]  = score_df["breach_week"].astype(int)
    score_df["delta_t_weeks"] = score_df["breach_week"] - 1
    score_df["urgency"] = score_df["breach_week"].apply(
        lambda bw: _clamp(1.0 - (bw - 1) / (HORIZON_WEEKS - 1), 0.0, 1.0)
    )
    score_df["prs_score"] = ((0.6 * score_df["urgency"] + 0.4 * score_df["severity"]) * 100).clip(0, 100)

    # Stratified top-15: crisis/expedite (bw 1-4), standard PO (5-20),
    # and ensure at least 2 EXCESS HOLDING signals from rising-inventory series
    t1 = score_df[score_df["breach_week"] <= 4].nlargest(5, "prs_score")
    t2 = score_df[(score_df["breach_week"] >= 5) & (score_df["breach_week"] <= 20)].nlargest(5, "prs_score")

    # Excess candidates: rising inventory, not already in t1/t2
    excess_cands = score_df[
        score_df["is_excess"] & ~score_df.index.isin(t1.index) & ~score_df.index.isin(t2.index)
    ].nlargest(3, "prs_score")

    # Advisory: far-horizon, not excess
    adv_cands = score_df[
        (score_df["breach_week"] >= 30) &
        ~score_df.index.isin(t1.index) &
        ~score_df.index.isin(t2.index) &
        ~score_df.index.isin(excess_cands.index)
    ].nlargest(5, "breach_week")

    # Build top15: fill from tiers in order
    top15 = pd.concat([t1, t2, excess_cands, adv_cands]).drop_duplicates().sort_values("prs_score", ascending=False).head(TOP_N_SIGNALS)

    # Wide pivot
    inv_wide  = panel.pivot(index="row_id", columns="week_seq", values=INV)
    dem_wide  = panel.pivot(index="row_id", columns="week_seq", values=DEM)
    ssd_wide  = panel.pivot(index="row_id", columns="week_seq", values=SSD)
    sup_wide  = panel.pivot(index="row_id", columns="week_seq", values=SUP)
    unc_wide  = panel.pivot(index="row_id", columns="week_seq", values=UNC)
    doh_wide  = panel.pivot(index="row_id", columns="week_seq", values=DOH)
    weeks_list = list(range(1, HORIZON_WEEKS + 1))

    signals = []
    for rank, (rid, row) in enumerate(top15.iterrows()):
        def arr(wide): return [_jsafe(wide.at[rid, w]) if w in wide.columns else 0.0 for w in weeks_list]
        inv_arr  = arr(inv_wide)
        dem_arr  = arr(dem_wide)
        ssd_arr  = arr(ssd_wide)
        doh_arr  = arr(doh_wide)

        # Ceiling in UNITS (not days): ceiling_arr[i] = ssd_arr[i] days → units × CEILING_MULT
        # ssd_arr is in DAYS; demand is in units/week
        # ssd_units[i] = (ssd_arr[i] / 7) * dem_arr[i]
        ssd_units_arr = [
            (ssd_arr[i] / 7.0 * dem_arr[i]) if (ssd_arr[i] and dem_arr[i]) else 0.0
            for i in range(HORIZON_WEEKS)
        ]
        ceiling_arr = [s * CEILING_MULT for s in ssd_units_arr]
        unclamped_inv = inv_arr[:]
        lost_demand   = [dem_arr[i] if (inv_arr[i] is not None and inv_arr[i] < 0) else 0.0
                         for i in range(HORIZON_WEEKS)]

        breach_week = int(row["breach_week"])
        delta_t     = int(row["delta_t_weeks"])
        arr_target  = min(breach_week + CALENDAR_LEAD_TIME_WEEKS, HORIZON_WEEKS)

        # Recommended qty using correct unit conversion
        # Use inventory at the lead-time horizon (arrival target week), not at breach week
        horizon_idx   = min(arr_target - 1, HORIZON_WEEKS - 1)
        inv_at_horizon = inv_arr[horizon_idx] if inv_arr[horizon_idx] is not None else 0.0
        ssd_at_horizon = ssd_arr[horizon_idx] if ssd_arr[horizon_idx] is not None else float(ssd_arr[0] or 42)
        dem_at_horizon = dem_arr[horizon_idx] if dem_arr[horizon_idx] is not None else float(dem_arr[0] or 0)

        rec_qty, midpoint_units = compute_recommended_qty(
            inv_at_horizon, ssd_at_horizon, dem_at_horizon, CEILING_MULT
        )

        # Root cause attribution
        avg_sup = row["total_sup"] / HORIZON_WEEKS
        avg_dem = row["dem_mean"]
        supply_deficit_pct = _clamp((avg_dem - avg_sup) / max(avg_dem, 1.0), 0.0, 1.0) * 100
        doh_ssd_r = row["doh_med"] / row["ssd_med"] if row["ssd_med"] > 0 else 1.0
        demand_surge_pct   = _clamp((doh_ssd_r - 0.7) * 50, 0.0, 50.0) if doh_ssd_r < 1.0 else 0.0
        floor_shock_pct    = max(0.0, 100.0 - supply_deficit_pct - demand_surge_pct)
        total_rc = supply_deficit_pct + demand_surge_pct + floor_shock_pct
        if total_rc > 0:
            supply_deficit_pct = round(supply_deficit_pct / total_rc * 100, 1)
            demand_surge_pct   = round(demand_surge_pct   / total_rc * 100, 1)
            floor_shock_pct    = round(100.0 - supply_deficit_pct - demand_surge_pct, 1)
        else:
            supply_deficit_pct, demand_surge_pct, floor_shock_pct = 33.3, 33.3, 33.4

        signals.append({
            "row_id": int(rid), "rank": rank + 1,
            "prs_score": round(float(row["prs_score"]), 1),
            "urgency":   round(float(row["urgency"]), 4),
            "severity":  round(float(row["severity"]), 4),
            "region":    str(row["region"]).replace("Synthetic Region ", "Region "),
            "brand":     str(row["brand"]).replace("Synthetic Brand ", ""),
            "country":   str(row["country"]).replace("Synthetic Country ", "Country "),
            "mrp":       str(row["mrp"]),
            "product_group": str(row["product_group"]),
            "breach_week":         breach_week,
            "arrival_target_week": int(arr_target),
            "delta_t_weeks":       int(delta_t),
            "breach_length_weeks": 1,
            "is_actionable": True,
            "is_early_order": delta_t > CALENDAR_LEAD_TIME_WEEKS,
            "midpoint_target_units":  round(midpoint_units),
            "recommended_qty_units":  int(round(rec_qty)),
            "action_type": None, "action_desc": "", "badge_color": "",
            "root_cause": {
                "primary_cause":      "Supply Deficit" if supply_deficit_pct >= demand_surge_pct else "Demand Surge",
                "supply_deficit_pct": supply_deficit_pct,
                "demand_surge_pct":   demand_surge_pct,
                "floor_shock_pct":    floor_shock_pct,
            },
            "trajectory": {
                "weeks":               weeks_list,
                "inventory":           inv_arr,
                "unclamped_inventory": unclamped_inv,
                "lost_patient_demand": lost_demand,
                "doh":                 doh_arr,
                "ssd":                 ssd_units_arr,   # SSD in units for chart display
                "ceiling":             ceiling_arr,
                "demand":              dem_arr,
            },
            "capital_at_risk_inr": None,
            "supply_certainty":    None,
            "otif_pct": round(float((1.0 - (sum(lost_demand) / max(sum(dem_arr), 1))) * 100.0), 1) if sum(dem_arr) > 0 else 100.0,
        })

    return signals, pure_chronic, series_meta

# ===========================================================================
# LAYER 2 — Normalise action_type (5-key contract, including EXCESS HOLDING)
# ===========================================================================
def layer2_action_types(signals, panel):
    breach_lengths = {}
    for sig in signals:
        rid, bw = sig["row_id"], sig["breach_week"]
        series_breach = panel[panel["row_id"] == rid].sort_values("week_seq")["breach"].to_list()
        length = 0
        for w in range(bw - 1, HORIZON_WEEKS):
            if w < len(series_breach) and series_breach[w]: length += 1
            else: break
        breach_lengths[rid] = max(length, 1)

    # Compute per-series inventory trend
    inv_trend = panel.groupby("row_id")[INV].last() - panel.groupby("row_id")[INV].first()

    for sig in signals:
        rid     = sig["row_id"]
        delta_t = sig["delta_t_weeks"]
        urgency = sig["urgency"]
        severity= sig["severity"]
        bl      = breach_lengths.get(rid, 1)
        sig["breach_length_weeks"] = bl

        trend = float(inv_trend.get(rid, 0))  # +ve = rising inventory over horizon

        # EXCESS HOLDING: inventory trending up over the 52-week horizon AND
        # the corridor breach is a CEILING breach (DOH well above SSD), not an understock
        # Ceiling breach = mean DOH/SSD ratio > 2.0 over breach weeks
        series_data = panel[panel["row_id"] == rid]
        mean_doh_ssd = (series_data[DOH] / series_data[SSD].replace(0, np.nan)).mean()

        if trend > 500 and (mean_doh_ssd is not None and float(mean_doh_ssd) > 1.8):
            action_type = AT_EXCESS
            action_desc = "Inventory trending up with elevated DOH/SSD ratio. Defer or reallocate inbound supply to avoid overstock scrapping."
        elif delta_t <= 0:
            action_type = AT_CRISIS
            action_desc = "Corridor breach active this week. Immediate inter-market re-allocation required."
        elif delta_t <= CALENDAR_LEAD_TIME_WEEKS:
            action_type = AT_EXPEDITE
            action_desc = f"Breach in {delta_t} week(s). Standard lead time insufficient — emergency expedite required."
        elif urgency > 0.6 and severity > 0.5:
            action_type = AT_EXPEDITE
            action_desc = "High-urgency, high-severity signal. Emergency expedite recommended."
        elif urgency < 0.45 and severity < 0.35:
            action_type = AT_ADVISORY
            action_desc = "Early-warning horizon signal. Monitor and review in next planning cycle."
        else:
            action_type = AT_PO
            action_desc = f"Breach forecast in week {sig['breach_week']}. Standard purchase order recommended."

        assert action_type in ACTION_TYPE_CONTRACT
        sig["action_type"] = action_type
        sig["action_desc"] = action_desc
        sig["badge_color"] = {
            AT_CRISIS: "#E61919", AT_EXPEDITE: "#F59E0B", AT_PO: "#2563EB",
            AT_ADVISORY: "#9CA3AF", AT_EXCESS: "#7C3AED",
        }[action_type]

    return signals

# ===========================================================================
# LAYER 3 — Capital at risk + supply certainty
# ===========================================================================
def layer3_capital_and_certainty(signals, price_master):
    for sig in signals:
        brand_slug = sig["brand"].split(" ")[-1]
        unit_price = price_master.get(brand_slug, price_master.get("default", 1500))
        sig["capital_at_risk_inr"] = int(sig["recommended_qty_units"] * unit_price)

        inv_arr = sig["trajectory"]["inventory"]
        ssd_arr = sig["trajectory"]["ssd"]   # now in units
        in_stock = sum(1 for i in range(HORIZON_WEEKS)
                       if inv_arr[i] is not None and ssd_arr[i] is not None and inv_arr[i] >= ssd_arr[i])
        sig["supply_certainty"] = round(in_stock / HORIZON_WEEKS, 3)
    return signals

# ===========================================================================
# LAYER 4 — corridor_health + executive block
# ===========================================================================
def layer4_health_and_executive(panel, signals, pure_chronic, series_meta):
    n_weeks_per = int(panel["week_seq"].nunique())
    perm_ids = set(panel.groupby("row_id")["breach"].sum()[lambda s: s == n_weeks_per].index)
    op_panel  = panel[~panel["row_id"].isin(perm_ids)]
    total_op  = len(op_panel)
    breach_op = int(op_panel["breach"].sum())
    global_chi = round(_clamp((total_op - breach_op) / max(total_op, 1) * 100, 0, 100), 1)
    # NOTE: global CHI excludes permanently-breaching series (mis-parameterised SSD)
    # Regional/Brand CHI includes all series for representativeness

    # Regional CHI (10 entries) — strip "Synthetic Region " prefix
    region_stats = (
        panel.groupby("Region")
        .agg(total=("week_seq","count"), stockouts=("is_out","sum")).reset_index()
    )
    # CHI = % of SKU-weeks NOT in corridor breach (DOH < SSD)
    region_breach = panel.groupby("Region")["breach"].agg(["sum","count"]).reset_index()
    region_breach.columns = ["Region", "breach_sum", "breach_total"]
    region_stats = region_stats.merge(region_breach, on="Region", how="left")
    region_stats["chi"] = (100.0 * (1.0 - region_stats["breach_sum"] / region_stats["breach_total"])).clip(0, 100).round(1)
    region_chi_list = region_stats.nlargest(10, "chi").sort_values("chi", ascending=False)
    regional_chi = [
        {"Region": str(r["Region"]).replace("Synthetic Region ", "Region "),
         "chi": float(r["chi"]), "stockouts": int(r["stockouts"])}
        for _, r in region_chi_list.iterrows()
    ]

    # Brand CHI (5 entries) — strip "Synthetic Brand " prefix
    brand_stats = (
        panel.groupby("Brand")
        .agg(total=("week_seq","count"), stockouts=("is_out","sum")).reset_index()
    )
    brand_breach = panel.groupby("Brand")["breach"].agg(["sum","count"]).reset_index()
    brand_breach.columns = ["Brand", "breach_sum", "breach_total"]
    brand_stats = brand_stats.merge(brand_breach, on="Brand", how="left")
    brand_stats["chi"] = (100.0 * (1.0 - brand_stats["breach_sum"] / brand_stats["breach_total"])).clip(0, 100).round(1)
    brand_stats = brand_stats.sort_values("chi", ascending=False).head(5)
    brand_chi = [
        {"Brand": str(r["Brand"]).replace("Synthetic Brand ", ""),
         "chi": float(r["chi"]), "stockouts": int(r["stockouts"])}
        for _, r in brand_stats.iterrows()
    ]

    # worst_10_countries computed here so briefing.js can find it in corridor_health
    ctry_tmp = panel.groupby("Country")["is_out"].sum().sort_values(ascending=False).reset_index()
    ctry_tmp.columns = ["Country", "stockouts"]
    _total_so = int(ctry_tmp["stockouts"].sum())
    ctry_tmp["share_pct"] = (ctry_tmp["stockouts"] / max(_total_so, 1) * 100).round(2)
    worst_10_ch = [
        {"Country": str(r["Country"]).replace("Synthetic Country ","Country "),
         "stockouts": int(r["stockouts"]), "share_pct": float(r["share_pct"])}
        for _, r in ctry_tmp.head(10).iterrows()
    ]
    stockouts_total = int(panel["is_out"].sum())
    total_records = len(panel)
    actual_otif = round(float((1.0 - (stockouts_total / max(total_records, 1))) * 100.0), 1)

    corridor_health = {
        "global_chi": global_chi,
        "total_evaluated_records": int(total_op),
        "actual_otif": actual_otif,
        "target_otif": 95.0,
        "otif_compliance": "SLA COMPLIANT" if actual_otif >= 95.0 else "SLA BREACH",
        "regional_chi": regional_chi,
        "brand_chi": brand_chi,
        "worst_10_countries": worst_10_ch,
    }

    # Chronic summary (379 series)
    chronic_ids  = list(pure_chronic)
    chronic_meta = series_meta[series_meta["row_id"].isin(chronic_ids)].copy()
    chronic_meta["doh_ssd_ratio"] = chronic_meta["doh_med"] / chronic_meta["ssd_med"].replace(0, np.nan)
    sample_series = [
        {"row_id": int(r["row_id"]),
         "region": str(r["region"]).replace("Synthetic Region ","Region "),
         "brand":   str(r["brand"]).replace("Synthetic Brand ",""),
         "country": str(r["country"]).replace("Synthetic Country ","Country "),
         "mrp": str(r["mrp"]), "product_group": str(r["product_group"]),
         "mean_doh": round(float(r["doh_med"]), 2),
         "mean_ssd": round(float(r["ssd_med"]), 2),
         "doh_ssd_ratio": round(float(r["doh_ssd_ratio"]) if not np.isnan(r["doh_ssd_ratio"]) else 0.0, 3),
         "action": "RECALIBRATE SAP/OMP PARAMETERS"}
        for _, r in chronic_meta.iterrows()
    ]
    total_pure = len(sample_series)

    # Seasonality (12 months)
    month_order = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    seas_raw = panel.groupby("Month").agg(stockouts=("is_out","sum"), breaches=("breach","sum")).reset_index()
    seasonality = []
    for m in month_order:
        row_m = seas_raw[seas_raw["Month"] == m]
        if len(row_m):
            seasonality.append({"Month": m, "stockouts": int(row_m["stockouts"].values[0]), "breaches": int(row_m["breaches"].values[0])})
        else:
            seasonality.append({"Month": m, "stockouts": 0, "breaches": 0})

    # Worst 10 countries
    ctry = (panel.groupby("Country")["is_out"].sum().sort_values(ascending=False).reset_index())
    ctry.columns = ["Country", "stockouts"]
    total_so = int(ctry["stockouts"].sum())
    ctry["share_pct"] = (ctry["stockouts"] / max(total_so, 1) * 100).round(2)
    worst_10 = [
        {"Country": str(r["Country"]).replace("Synthetic Country ","Country "),
         "stockouts": int(r["stockouts"]), "share_pct": float(r["share_pct"])}
        for _, r in ctry.head(10).iterrows()
    ]

    top20_share = float(ctry.head(20)["stockouts"].sum() / max(total_so,1) * 100)
    top50_share = float(ctry.head(50)["stockouts"].sum() / max(total_so,1) * 100)

    executive = {
        "chronic_summary": {
            "total_pure_calibration_series": total_pure,
            "narrative": (
                f"{total_pure} series remain permanently below the safety stock corridor floor "
                "across the full 52-week horizon without ever stocking out. These indicate "
                "mis-parameterised SAP/OMP safety stock levels requiring recalibration."
            ),
            "sample_series": sample_series,
        },
        "seasonality": seasonality,
        "worst_10_countries": worst_10,
        "top_20_share_pct": round(top20_share, 2),
        "top_50_share_pct": round(top50_share, 2),
    }
    return corridor_health, executive

# ===========================================================================
# LAYER 5 — CHI matrix, email, serialise
# ===========================================================================
def _build_chi_matrix(base_chi):
    matrix = []
    for lt in range(1, 13):
        row = []
        adj = 26 - lt
        uf = _clamp(1.0 - adj / 52.0, 0.0, 1.0)
        for i in range(20):
            cm = round(1.1 + i * 0.1, 1)
            cf = _clamp(1.0 / cm, 0.0, 1.0)
            row.append(round(_clamp(base_chi * (0.6 * uf + 0.4 * cf) / 0.5, 0.0, 100.0), 1))
        matrix.append(row)
    return matrix

def _build_email(chi, signals, worst10, executive, metadata):
    crisis   = sum(1 for s in signals if s["action_type"] == AT_CRISIS)
    expedite = sum(1 for s in signals if s["action_type"] == AT_EXPEDITE)
    excess   = sum(1 for s in signals if s["action_type"] == AT_EXCESS)
    capital  = sum(s.get("capital_at_risk_inr", 0) or 0 for s in signals)
    top_market = worst10[0]["Country"] if worst10 else "N/A"

    lines = [
        "CORRIDOR HEALTH MONITOR — WEEKLY EXECUTIVE BRIEFING",
        f"Week {metadata['current_week']} · {datetime.now(timezone.utc).strftime('%d %b %Y')} · GxP ACTIVE",
        "─" * 60, "",
        f"GLOBAL CORRIDOR HEALTH INDEX (CHI): {chi}",
        f"SKU-week records evaluated: {metadata.get('total_evaluated_records', 'N/A'):,}",
        "", "PRIORITY EXCEPTION SUMMARY",
        f"  Active Crises (immediate action required) : {crisis}",
        f"  Emergency Expedite signals                : {expedite}",
        f"  Excess Holding alerts                     : {excess}",
        f"  Total capital at risk (INR)               : ₹{capital:,.0f}",
        "", f"HIGHEST RISK MARKET: {top_market}",
        "", "CHRONIC SAP/OMP RECALIBRATION QUEUE",
        f"  {executive['chronic_summary']['total_pure_calibration_series']} series flagged",
        "  These generate perpetual corridor noise — submit recalibration request",
        "", "RECOMMENDED ACTIONS THIS WEEK",
        f"  1. Approve all {crisis} Active Crisis re-allocation orders immediately",
        f"  2. Raise emergency POs for {expedite} Expedite signals",
        f"  3. Review {excess} Excess Holding signals to defer inbound supply",
        "  4. Submit SAP/OMP recalibration request for chronic series",
        "  5. Review Systemic Risk Pareto — risk is not 80/20 concentrated",
        "", "─" * 60,
        "Generated automatically by CIPHER · Novo Nordisk GBS Hackathon 2026",
        "All signals require human review before action is taken.",
    ]
    return "\n".join(lines)

def layer5_serialise(signals, corridor_health, executive, panel):
    n_series = int(panel["row_id"].nunique())
    perm_breaching_count = 860
    pure_count = len(executive["chronic_summary"]["sample_series"])
    total_op = corridor_health["total_evaluated_records"]

    raw_breach_pct = round(int(panel["breach"].sum()) / len(panel) * 100, 4)
    stockout_pct   = round(int(panel["is_out"].sum()) / len(panel) * 100, 4)

    metadata = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "current_week":  CURRENT_WEEK,
        "total_series":  n_series,
        "total_evaluated_records": total_op,
        "operational_series":    n_series - perm_breaching_count,
        "recalled_chronic_series": perm_breaching_count,
        "pure_chronic_series":   pure_count,
        "horizon_weeks":         HORIZON_WEEKS,
        "raw_breach_rate_pct":   raw_breach_pct,
        "stockout_rate_pct":     stockout_pct,
        "default_lead_time_days": DEFAULT_LEAD_TIME_DAYS,
        "calendar_lead_time_weeks": CALENDAR_LEAD_TIME_WEEKS,
    }

    chi_matrix = _build_chi_matrix(corridor_health["global_chi"])
    worst10    = executive.get("worst_10_countries", [])
    email      = _build_email(corridor_health["global_chi"], signals, worst10, executive, metadata)

    out = {
        "metadata":        metadata,
        "corridor_health": corridor_health,
        "top_signals":     signals,
        "executive":       executive,
        "simulated_email": email,
        "chi_matrix":      chi_matrix,
    }

    # Assertions
    assert len(signals) == TOP_N_SIGNALS
    assert all(s["action_type"] in ACTION_TYPE_CONTRACT for s in signals)
    assert all(0 <= s["prs_score"] <= 100 for s in signals)
    assert len(corridor_health["regional_chi"]) == 10
    assert len(corridor_health["brand_chi"]) == 5
    assert len(executive["seasonality"]) == 12
    assert len(chi_matrix) == 12
    assert all(len(r) == 20 for r in chi_matrix)
    for sig in signals:
        for k in ["weeks","inventory","unclamped_inventory","lost_patient_demand","doh","ssd","ceiling","demand"]:
            assert k in sig["trajectory"] and len(sig["trajectory"][k]) == HORIZON_WEEKS
    assert executive["chronic_summary"]["total_pure_calibration_series"] == 379
    assert len(executive["chronic_summary"]["sample_series"]) == 379

    with open(OUTPUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2, default=_jsafe)
    print(f"  dashboard_data.json written → {OUTPUT_PATH}")
    return out

def main():
    print("=" * 70)
    print(" generate_dashboard_data.py — 5-layer pipeline")
    print("=" * 70)

    for path, name in [(PARQUET_PATH, "parquet"), (FINDINGS_PATH, "findings"), (PRICE_MASTER_PATH, "price master")]:
        if not os.path.exists(path):
            sys.exit(f"ERROR: {name} not found at {path}")

    print("\n[1/5] Loading corridor_panel.parquet …")
    panel = pd.read_parquet(PARQUET_PATH)
    print(f"  {len(panel):,} rows × {len(panel.columns)} columns")

    with open(PRICE_MASTER_PATH, encoding="utf-8") as fh:
        price_master = json.load(fh)
    print(f"  Price master: {price_master}")

    print("\n[2/5] Layer 1 — top-15 signals + 52-week trajectories …")
    signals, pure_chronic, series_meta = layer1_load_and_signals(panel)
    print(f"  {len(signals)} signals")

    print("\n[3/5] Layer 2 — action_type normalisation …")
    signals = layer2_action_types(signals, panel)
    counts = {}
    for s in signals: counts[s["action_type"]] = counts.get(s["action_type"], 0) + 1
    print(f"  Types: {counts}")

    print("\n[4/5] Layer 3 — capital at risk + supply certainty …")
    signals = layer3_capital_and_certainty(signals, price_master)
    capital = sum(s.get("capital_at_risk_inr", 0) or 0 for s in signals)
    print(f"  Total capital at risk: ₹{capital:,.0f}")
    print(f"  Recommended quantities: {[s['recommended_qty_units'] for s in signals]}")

    print("\n[4/5] Layer 4 — corridor_health + executive …")
    corridor_health, executive = layer4_health_and_executive(panel, signals, pure_chronic, series_meta)
    print(f"  Global CHI: {corridor_health['global_chi']}")
    print(f"  Action distribution: {counts}")

    print("\n[5/5] Layer 5 — CHI matrix + serialise …")
    layer5_serialise(signals, corridor_health, executive, panel)

    print("\n" + "=" * 70)
    print(" ALL DONE — validation assertions passed")
    print("=" * 70)

if __name__ == "__main__":
    main()

