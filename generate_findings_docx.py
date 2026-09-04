"""
Generates: Cipher_Problem5_Dataset_Findings.docx

A findings note on the supplied dataset, to attach to the mentor email alongside
the solution design note.

Every figure is read from corridor_findings.json, which is produced by
corridor_pipeline.py. Nothing is hard-coded, so the document cannot drift away
from the analysis it reports.

Run:
    python corridor_pipeline.py        # produces corridor_findings.json
    python generate_findings_docx.py
"""

import json
import os
import sys

from docx_style import (
    body,
    callout,
    footer,
    h1,
    h2,
    meta_table,
    new_document,
    numbered,
    rich,
    subtitle,
    table,
    title,
)

FINDINGS_JSON = "corridor_findings.json"
OUT = "Cipher_Problem5_Dataset_Findings.docx"

if not os.path.exists(FINDINGS_JSON):
    sys.exit(f"{FINDINGS_JSON} not found. Run:  python corridor_pipeline.py")

with open(FINDINGS_JSON, encoding="utf-8") as fh:
    F = json.load(fh)

shape = F["shape"]
card = F["cardinality"]
label = F["label"]
naive = F["naive_alert"]
lead = F["lead_time"]
ratio = F["ratio_separator"]
perm = F["permanent_breach"]
ssd = F["safety_stock"]
pipe = F["supply_pipeline"]
pipe_recon = pipe.get("reconciliation") or {}
dq = F["data_quality"]
conc = F["concentration"]
rec = F["recursion"]
mov = F["movement_identity"]
doh = F["doh_formula"]
ep = F["episode_length"]

honest = lead["excluding_permanently_breaching_series"]
all_ep = lead["all_episodes"]


def f(n, dp=0):
    """Format a number with thousands separators."""
    if n is None:
        return "n/a"
    return f"{n:,.{dp}f}"


doc = new_document()

# ============================================================ HEADER
title(doc, "Dataset Analysis Findings")
subtitle(doc, "Inventory Corridor Health Check Monitoring & Stock-Out Signal Capturing  |  Problem Statement 5")

meta_table(
    doc,
    [
        ("Team", "Cipher"),
        ("Institution", "Amity University"),
        ("Dataset", shape["source_file"]),
        ("Records analysed", f"{f(shape['sku_week_records'])} SKU-weeks"),
    ],
)
body(doc, "", space_after=2)

rich(
    doc,
    [
        ("Document purpose:  ", True),
        (
            "This note reports what we established from the dataset you shared. It covers the "
            "structure of the file, the arithmetic rules we reverse-engineered and verified, what "
            "the supplied stock-out indicator actually represents, and the consequences for the "
            "tool we are building. Section 7 lists the questions the data itself raised, which we "
            "could not answer from the file alone. All figures are reproducible from a single "
            "script, which we can share on request.",
            False,
        ),
    ],
)

# ============================================================ 1. HEADLINE
h1(doc, "1.  Headline Conclusions")

callout(
    doc,
    "The supplied stock-out indicator is reactive, not predictive.",
    f"'Expected Stock Out' is a text column taking the values "
    f"{', '.join(repr(v) for v in label['distinct_values'])}. It is exactly equivalent to "
    f"Inventory < 0, agreeing in {label['equivalence_tests']['Inventory < 0']:.4f}% of "
    f"{f(label['total_weeks'])} records with no exceptions. It therefore identifies the week in "
    f"which stock has already gone negative. Reproducing this column would add no value; the "
    f"opportunity is to anticipate it.",
    tone="warn",
)

callout(
    doc,
    "Threshold alerting on the corridor floor is unusable as designed.",
    f"Comparing days on hand against safety stock days flags "
    f"{f(naive['breach_weeks'])} of {f(label['total_weeks'])} "
    f"SKU-weeks ({naive['breach_rate_pct']:.1f}%), against only {f(naive['stock_out_weeks'])} actual "
    f"stock-out weeks ({naive['stock_out_rate_pct']:.2f}%). That is a precision of "
    f"{naive['precision_pct']:.2f}%, or roughly {naive['alerts_per_real_event']:.0f} alerts for every "
    f"real event. Prioritisation, not detection, is the hard problem.",
    tone="warn",
)

body(
    doc,
    "We also confirmed the file's internal arithmetic exactly, which means our forward projection "
    "can reproduce the same trajectory rather than approximate it. And we found a per-series ratio "
    "that separates genuine risk far more cleanly than the raw breach flag, which gives us a "
    "defensible basis for ranking alerts.",
)

# ============================================================ 2. STRUCTURE
h1(doc, "2.  Structure of the Dataset")

table(
    doc,
    rows=[
        ["Grain", f"{' x '.join(card.keys())}  =  {f(shape['series'])} series"],
        ["Time buckets", f"{shape['weeks']} weekly buckets"],
        ["Horizon", f"{shape['horizon_start']}  to  {shape['horizon_end']}"],
        ["Orientation", "Forward-looking projected inventory, not historical actuals"],
        ["Metrics per week", f"{shape['metrics_per_week']}"],
        ["Total records", f"{f(shape['sku_week_records'])} SKU-week records"],
        [
            "Cardinality",
            ",  ".join(f"{k}: {v}" for k, v in card.items()),
        ],
        ["Grain uniqueness", "Unique on the five identifier columns" if F.get("grain_unique") else "Not unique on the identifier columns"],
        ["Completeness", "No nulls in any metric or identifier column" if not dq["any_nulls"] else f"Nulls present in: {', '.join(dq['metrics_with_nulls'])}"],
        ["Nature", "Synthetic / anonymised labels" if F.get("is_synthetic") else "Apparently real labels"],
    ],
    headers=["Property", "Finding"],
    widths=[1.5, 5.25],
    bold_first_col=True,
)

body(doc, "", space_after=4)
body(
    doc,
    "The file is laid out in wide format: three merged banner rows carrying year, month and week, "
    "a fourth row of metric names, then five identifier columns followed by the metric block "
    "repeating once per week. We reshape this into a long panel keyed on series and week before "
    "any analysis, which is the form our projection engine consumes.",
    italic=True,
)

h2(doc, "Metrics present")
body(doc, ",  ".join(shape["metric_names"]), size=10)

# ============================================================ 3. ARITHMETIC
h1(doc, "3.  Verified Arithmetic Rules")

body(
    doc,
    "We reverse-engineered the relationships between the columns and verified each against every "
    "record. These are now the rules our projection engine implements, so that a projected "
    "trajectory is consistent with the way the source data behaves.",
)

table(
    doc,
    rows=[
        [
            "Inventory recursion",
            f"Inventory[t] = {rec['confirmed']}",
            f"{rec['candidates'][rec['confirmed']]['match_within_0_01_pct']:.2f}%",
        ],
        [
            "Movement identity",
            mov["rule"],
            f"{mov['within_0_01_pct']:.2f}%",
        ],
        [
            "Days on hand",
            doh["rule"],
            f"{doh['variants']['calc_capped']['within_0_01_pct']:.2f}%",
        ],
    ],
    headers=["Rule", "Formula", "Agreement"],
    widths=[1.35, 4.15, 1.0],
    bold_first_col=True,
)

body(doc, "", space_after=4)
callout(
    doc,
    "One timing subtlety worth recording.",
    "Supply and demand in week t settle against week t's own closing balance, not the following "
    "week's. We initially tested the more intuitive convention, where a week's movement carries "
    "into the next period, and it matched only about half the records. The convention above matches "
    "every record. This distinction is easy to get wrong and produces a projection that looks "
    "plausible while being systematically out by one period, so we would welcome confirmation that "
    "it matches the convention used upstream.",
)

body(
    doc,
    f"A ceiling value of 9,999 appears in the days-on-hand column on {f(doh['sentinel_rows'])} records, "
    f"which we read as a sentinel for effectively unlimited cover where weekly demand is very small "
    f"rather than a genuine measurement. We exclude these from distribution statistics and would like "
    f"to confirm that reading.",
)

# ============================================================ 4. THE SIGNAL
h1(doc, "4.  What the Stock-Out Indicator Represents")

body(
    doc,
    "We tested the supplied indicator against every candidate definition we could construct. The "
    "results were unambiguous:",
)

table(
    doc,
    rows=[[k, f"{v:.4f}%"] for k, v in label["equivalence_tests"].items()],
    headers=["Candidate definition", "Agreement with 'Stock Out'"],
    widths=[3.6, 2.9],
)

body(doc, "", space_after=4)
body(
    doc,
    f"The indicator marks {f(label['stock_out_weeks'])} of {f(label['total_weeks'])} SKU-weeks "
    f"({label['stock_out_pct']:.2f}%). Because it coincides exactly with a negative balance, it is a "
    f"record of a shortage that has already occurred rather than a warning of one approaching. "
    f"Stock-outs cluster into {f(ep['episodes'])} distinct episodes with a median duration of "
    f"{f(ep['median_weeks'])} weeks, so the unit a planner would act on is the episode, not the "
    f"individual week. Our alerting is therefore designed around episodes, which also prevents the "
    f"same continuing problem from being reported afresh every week.",
)

# ============================================================ 5. WHY NAIVE FAILS
h1(doc, "5.  Why Naive Threshold Alerting Fails")

table(
    doc,
    rows=[
        ["Corridor breaches (days on hand below safety stock)", f"{f(naive['breach_weeks'])} weeks", f"{naive['breach_rate_pct']:.2f}%"],
        ["Actual stock-out weeks", f"{f(naive['stock_out_weeks'])} weeks", f"{naive['stock_out_rate_pct']:.2f}%"],
        ["Precision of the breach rule as an alert", f"{naive['precision_pct']:.2f}%", "—"],
        ["Alerts raised per genuine event", f"{naive['alerts_per_real_event']:.0f}", "—"],
    ],
    headers=["Measure", "Value", "Share of records"],
    widths=[3.5, 1.7, 1.3],
)

body(doc, "", space_after=4)

callout(
    doc,
    "A point of statistical honesty we want to state plainly.",
    "The breach rule also achieves 100% recall, but this is an arithmetic certainty rather than a "
    "result, and we would rather flag that ourselves than present it as an achievement. Safety "
    f"stock days is never below {f(ssd['min_days'])}, and a stock-out means inventory is negative, so "
    "days on hand is negative and necessarily below the safety stock figure. Every stock-out is "
    "therefore captured by definition. For the same reason, the apparent lead time between a breach "
    "and a stock-out largely measures how long a series has been sitting below its floor, not the "
    "quality of the signal. Only precision carries information here.",
)

h2(doc, "Standing breaches versus developing problems")

body(
    doc,
    f"{f(perm['series_in_breach_every_week'])} series sit below the corridor floor in every week of "
    f"the horizon, and only {f(perm['of_which_ever_stock_out'])} of those ever actually stock out. "
    f"For these the floor appears mis-parameterised, and a breach flag that is permanently on cannot "
    f"distinguish a developing problem from a standing condition. Excluding them, the median warning "
    f"between breach onset and stock-out onset is {f(honest['median_weeks'])} weeks across "
    f"{f(honest['n'])} episodes, compared with {f(all_ep['median_weeks'])} weeks if the "
    f"permanently-breaching series are left in. We regard the former as the more informative figure, "
    f"though we would characterise even that as a less distorted measure of persistence rather than "
    f"genuine foresight, since a breach is necessarily already present when a stock-out begins.",
)

h2(doc, "A measure that does separate risk")

body(
    doc,
    f"Taking each series' median days on hand as a multiple of its safety stock days produces a "
    f"clean, monotonic separation of risk. This gives us a defensible basis for ranking, which the "
    f"raw breach flag does not:",
)

table(
    doc,
    rows=[
        [b["band"], f(b["series"]), f"{b['pct_ever_stock_out']:.1f}%"]
        for b in ratio["bands"]
    ],
    headers=["Median days on hand ÷ safety stock days", "Series", "Share that ever stock out"],
    widths=[2.9, 1.5, 2.1],
)

body(doc, "", space_after=4)
body(
    doc,
    "The lowest band is close to a certainty and the highest close to safe, which is exactly the "
    "behaviour a prioritisation feature needs. We would value your view on whether this ratio "
    "corresponds to anything your planners already use informally.",
    italic=True,
)

# ============================================================ 6. CONCENTRATION
h1(doc, "6.  Where the Risk Sits")

pareto = conc.get("pareto_share_pct", {})
if pareto:
    body(
        doc,
        f"Risk is concentrated rather than evenly spread. Of {conc['countries_total']} countries, "
        f"{conc['countries_with_zero_stock_outs']} record no stock-out weeks at all, while the worst "
        f"few account for a disproportionate share:",
    )
    table(
        doc,
        rows=[
            [k.replace("worst_", "Worst ").replace("_countries", " countries"), f"{v:.1f}%"]
            for k, v in pareto.items()
        ],
        headers=["Country group", "Share of all stock-out weeks"],
        widths=[2.6, 2.6],
    )
    body(doc, "", space_after=4)
    body(
        doc,
        "This matters for the interface: a global view sorted by exception count would bury the "
        "few markets that actually need attention, so we intend to lead with concentration rather "
        "than completeness.",
        italic=True,
    )

# ============================================================ 7. QUESTIONS
doc.add_page_break()
h1(doc, "7.  Questions Raised by the Data")

body(
    doc,
    "These are the points the file surfaced that we cannot resolve from it alone. Each one changes "
    "what we build, so they are the questions we would most value answers to.",
    italic=True,
)

h2(doc, "7.1  Replenishment lead time is absent  [Priority]")
body(
    doc,
    "The dataset contains no lead time, and this is the single most consequential gap. Without it we "
    "cannot tell whether a projected breach is still actionable. Your point about long lead-time "
    "markets implies that a warning is only useful if it arrives before the last moment a decision "
    "could still change the outcome, and that threshold differs by market.",
)
numbered(doc, "Is there a lead time per market, or per market and product, that could be supplied as reference data, even approximately?")
numbered(doc, "Should we treat lead time as a per-market parameter the planner can maintain within the tool, if it is not available as data?")
numbered(doc, "Is lead time better understood as a single figure or as a distribution, given that variability is often the real driver of a shortage?")
numbered(doc, "Should the alert horizon be explicitly lead-time aware, so that a market with a long replenishment path is flagged proportionately earlier than a short one? We have assumed yes.")

h2(doc, "7.2  Total supply does not reconcile to the order pipeline  [Priority]")
body(
    doc,
    f"The file carries an order pipeline that appears to represent increasing supply certainty — "
    f"{', '.join(pipe['pipeline_columns'])}. We tested whether total supply is the sum of these "
    f"stages and it matched in only {pipe_recon.get('exact_match_pct', 0):.2f}% of records, so it "
    f"does not appear to be a simple total.",
)
numbered(doc, "How is total supply derived, and which pipeline stages does it include?")
numbered(doc, "Should the stages be treated as a certainty ladder, so that confirmed or in-transit volume is weighted more heavily in a projection than an unconfirmed order or a purchase requisition? We think this is one of the more valuable things we could do with the data, but only if the interpretation is right.")
numbered(doc, "Is unconfirmed volume a genuine risk indicator in its own right — that is, does a projection resting largely on unconfirmed supply deserve a warning even when the balance stays inside the corridor?")
numbered(doc, "Are purchase requisitions ever cancelled or rejected often enough that they should be discounted rather than counted?")

h2(doc, "7.3  Safety stock days change within the horizon  [Priority]")
body(
    doc,
    f"Safety stock days ranges from {f(ssd['min_days'])} to {f(ssd['max_days'])} across "
    f"{ssd['distinct_value_count']} distinct values, and is not constant within a series: it varies "
    f"across the horizon in {f(ssd['series_with_varying_ssd'])} of {f(shape['series'])} series. This "
    f"means the corridor floor itself moves, which affects how a breach should be interpreted and "
    f"reported.",
)
numbered(doc, "Are these changes deliberate policy — seasonal or campaign-driven — or an artefact of how the extract was produced?")
numbered(doc, "When the floor moves, should a breach be assessed against the floor applicable in that week, or against a single current policy figure? We have assumed the former.")
numbered(doc, "If a series moves into breach only because its safety stock requirement rose rather than because stock fell, should that be reported differently? Our view is that it should, since the corrective action is quite different, but we would like your confirmation.")
numbered(doc, "Is there an upper bound to the corridor in your policy? The file gives us a floor but no ceiling, so at present we cannot detect overstocking, which we understand to be half of the problem.")

h2(doc, "7.4  Order constraints are not represented  [Priority]")
body(
    doc,
    "The dataset gives no minimum order quantity, batch or lot size, or rounding rule. Without these "
    "any quantity we recommend risks being unactionable, which would undermine confidence in the "
    "tool quickly.",
)
numbered(doc, "Is there a minimum order quantity, and does it vary by product or market?")
numbered(doc, "Are orders constrained to batch, lot or pallet multiples, and should recommended quantities be rounded accordingly?")
numbered(doc, "Is there a frozen horizon within which an order cannot be changed? If so, a recommendation falling inside it should arguably be presented as an escalation rather than an order proposal, and we would like to handle that correctly.")
numbered(doc, "Are there production campaign windows, so that a product can only be made at certain times rather than on demand?")

h2(doc, "7.5  Shelf life and expiry are not represented")
body(
    doc,
    "Nothing in the file describes remaining shelf life, which means we currently cannot address the "
    "overstocking and scrap side of the corridor at all, despite its being an explicit part of the "
    "problem.",
)
numbered(doc, "Is there a typical total shelf life by product that we could use as reference data?")
numbered(doc, "Is there a minimum remaining shelf life on receipt, and does it differ by market?")
numbered(doc, "Should we assume first-expiry-first-out consumption?")
numbered(doc, "Given that the file has no expiry data, would you prefer we model expiry risk from an assumed shelf life and state the assumption clearly, or leave it out of scope and say so? We can do either and would rather follow your preference than guess.")

h2(doc, "7.6  Interpretation and validation")
numbered(doc, f"Is our reading of the days-on-hand cap correct — a sentinel for effectively unlimited cover where demand is negligible, on {f(doh['sentinel_rows'])} records — or does it carry another meaning?")
numbered(doc, f"Negative inventory appears on {f(dq['inventory_negative_rows'])} records. Does a negative balance represent unfulfilled backorder rather than physically absent stock? This affects whether we present it as a shortfall quantity or as a backlog to be cleared.")
numbered(doc, f"Around {dq['zero_supply_pct']:.0f}% of SKU-weeks have no supply at all. Is that the expected rhythm of replenishment, or an artefact of the extract?")
numbered(doc, "Is the demand figure a forecast, a confirmed order book, or a blend that changes across the horizon? Cover means something different in each case, and we would rather label it accurately than generically.")
numbered(doc, "Does this extract mirror the structure of the real production data, so that our ingestion layer will transfer, or was it shaped for the exercise?")
numbered(doc, "Is the corridor health measure you report to management calculated from these same fields, and if so would you share the definition so we can reproduce it exactly rather than inventing our own?")

# ============================================================ 8. IMPLICATIONS
h1(doc, "8.  How This Has Shaped Our Build")

table(
    doc,
    rows=[
        [
            "Do not reproduce the supplied flag",
            "It is equivalent to a negative balance and carries no predictive content. We detect risk earlier on the projected trajectory instead.",
        ],
        [
            "Treat precision as the primary objective",
            f"Detection is trivial and already achieved; suppressing {f(naive['breach_weeks'])} breaches down to a credible shortlist is the actual engineering problem.",
        ],
        [
            "Alert on episodes, not weeks",
            f"The {f(naive['stock_out_weeks'])} stock-out weeks form {f(ep['episodes'])} episodes. Alerting per week would repeat the same problem and erode trust.",
        ],
        [
            "Separate standing from developing breaches",
            f"{f(perm['series_in_breach_every_week'])} series are permanently below the floor. These are a master-data problem to be reported once, not a recurring alert.",
        ],
        [
            "Rank using the cover ratio",
            "Median days on hand as a multiple of safety stock days separates risk monotonically and gives an explainable priority order.",
        ],
        [
            "Implement the verified recursion exactly",
            "The projection reproduces the file's own arithmetic, including its timing convention, so our figures reconcile with the source rather than approximating it.",
        ],
        [
            "Surface data limitations rather than hide them",
            "Lead time, order constraints and shelf life are absent. Where a judgement depends on an assumption, the tool states it instead of presenting it as fact.",
        ],
    ],
    headers=["Decision", "Reason drawn from the data"],
    widths=[2.1, 4.65],
    bold_first_col=True,
)

body(doc, "", space_after=6)
body(
    doc,
    "The absence of lead time, order constraints and shelf life is the main limitation on how far the "
    "recommendation layer can go. We can proceed by treating them as parameters the planner maintains, "
    "and will do so unless you would prefer otherwise, but even approximate reference values would let "
    "us produce recommendations that are actionable rather than indicative.",
    italic=True,
)

footer(doc)
doc.save(OUT)
print(f"Saved: {OUT}")
