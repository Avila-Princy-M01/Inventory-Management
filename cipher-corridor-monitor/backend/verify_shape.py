"""Quick shape verification for dashboard_data.json — task 1.4/1.5 assertions."""
import json, sys

VALID_ACTIONS = {
    "ACTIVE CRISIS",
    "EMERGENCY EXPEDITE",
    "STANDARD PO",
    "ADVISORY",
    "EXCESS HOLDING",
}
REQUIRED_SIGNAL_FIELDS = [
    "row_id", "prs_score", "urgency", "severity", "region", "brand",
    "country", "mrp", "product_group", "breach_week", "arrival_target_week",
    "delta_t_weeks", "breach_length_weeks", "is_actionable", "is_early_order",
    "midpoint_target_units", "recommended_qty_units", "action_type",
    "action_desc", "badge_color", "root_cause", "trajectory",
    "supply_certainty", "capital_at_risk_inr",
]
REQUIRED_TRAJECTORY_KEYS = [
    "weeks", "inventory", "unclamped_inventory", "lost_patient_demand",
    "doh", "ssd", "ceiling", "demand",
]

errors = []

import os as _os
_here = _os.path.dirname(_os.path.abspath(__file__))
with open(_os.path.join(_here, "dashboard_data.json")) as f:
    d = json.load(f)

# ---- metadata ----
meta = d.get("metadata", {})
assert meta, "metadata block missing"

# ---- top_signals ----
signals = d.get("top_signals", [])
if len(signals) != 15:
    errors.append(f"top_signals length = {len(signals)}, expected 15")

action_counts = {}
for sig in signals:
    at = sig.get("action_type", "")
    action_counts[at] = action_counts.get(at, 0) + 1
    if at not in VALID_ACTIONS:
        errors.append(f"Invalid action_type '{at}' in row_id={sig.get('row_id')}")
    for field in REQUIRED_SIGNAL_FIELDS:
        if field not in sig:
            errors.append(f"Missing field '{field}' in signal row_id={sig.get('row_id')}")
    prs = sig.get("prs_score", -1)
    if not (0 <= prs <= 100):
        errors.append(f"prs_score {prs} out of range for row_id={sig.get('row_id')}")
    traj = sig.get("trajectory", {})
    for tk in REQUIRED_TRAJECTORY_KEYS:
        if tk not in traj:
            errors.append(f"Missing trajectory key '{tk}' for row_id={sig.get('row_id')}")
        elif len(traj[tk]) != 52:
            errors.append(f"trajectory[{tk}] len={len(traj[tk])}, expected 52 for row_id={sig.get('row_id')}")

print(f"top_signals: {len(signals)} (action distribution: {action_counts})")

# ---- corridor_health ----
ch = d.get("corridor_health", {})
gchi = ch.get("global_chi", -1)
if not (0 <= gchi <= 100):
    errors.append(f"global_chi {gchi} out of range")
rchi = ch.get("regional_chi", [])
if len(rchi) != 10:
    errors.append(f"regional_chi count = {len(rchi)}, expected 10")
bchi = ch.get("brand_chi", [])
if len(bchi) != 5:
    errors.append(f"brand_chi count = {len(bchi)}, expected 5")
print(f"corridor_health: global_chi={gchi}, regional_chi={len(rchi)}, brand_chi={len(bchi)}")

# ---- chi_matrix ----
cm = d.get("chi_matrix", [])
if len(cm) != 12:
    errors.append(f"chi_matrix rows = {len(cm)}, expected 12")
for ri, row in enumerate(cm):
    if len(row) != 20:
        errors.append(f"chi_matrix row {ri} cols = {len(row)}, expected 20")
    for ci, val in enumerate(row):
        if not (0 <= val <= 100):
            errors.append(f"chi_matrix[{ri}][{ci}] = {val} out of range [0,100]")
print(f"chi_matrix: {len(cm)}x{len(cm[0]) if cm else 0}")

# ---- executive ----
ex = d.get("executive", {})
cs = ex.get("chronic_summary", {})
n_chronic = cs.get("total_pure_calibration_series", -1)
if n_chronic != 379:
    errors.append(f"total_pure_calibration_series = {n_chronic}, expected 379")
n_sample = len(cs.get("sample_series", []))
if n_sample != 379:
    errors.append(f"sample_series count = {n_sample}, expected 379")
seas = ex.get("seasonality", [])
if len(seas) != 12:
    errors.append(f"seasonality length = {len(seas)}, expected 12")
w10 = ex.get("worst_10_countries", [])
if len(w10) != 10:
    errors.append(f"worst_10_countries count = {len(w10)}, expected 10")
print(f"executive: chronic_series={n_chronic}, sample_series={n_sample}, seasonality={len(seas)}, worst_10={len(w10)}")

# ---- simulated_email ----
email = d.get("simulated_email", "")
if not email:
    errors.append("simulated_email is empty")
print(f"simulated_email: {len(email)} chars")

# ---- Summary ----
if errors:
    print(f"\nFAILED — {len(errors)} error(s):")
    for e in errors:
        print(f"  ERROR: {e}")
    sys.exit(1)
else:
    print("\nALL SHAPE CHECKS PASSED")
    sys.exit(0)

