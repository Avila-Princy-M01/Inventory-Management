"""
verify.py — standalone assertion suite for dashboard_data.json

Run as: python backend/verify.py
Exit code 0 on full pass, non-zero on any failure.
"""

import json
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PASS = "\u2713"
FAIL = "\u2717"

CONTRACT_ACTION_TYPES = {
    "ACTIVE CRISIS",
    "EMERGENCY EXPEDITE",
    "STANDARD PO",
    "ADVISORY",
    "EXCESS HOLDING",
}

REQUIRED_TRAJECTORY_KEYS = {
    "weeks",
    "inventory",
    "unclamped_inventory",
    "lost_patient_demand",
    "doh",
    "ssd",
    "ceiling",
    "demand",
}

TRAJECTORY_EXPECTED_LENGTH = 52


def ok(msg: str) -> None:
    print(f"  {PASS}  {msg}")


def fail(msg: str) -> None:
    print(f"  {FAIL}  FAIL: {msg}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------

DATA_PATH = Path(__file__).parent / "dashboard_data.json"

print("=" * 60)
print("Pharma Corridor Monitor — dashboard_data.json verification")
print("=" * 60)
print()

if not DATA_PATH.exists():
    fail(
        f"dashboard_data.json not found at {DATA_PATH}. "
        "Run backend/generate_dashboard_data.py (task 1.3) first."
    )
    sys.exit(1)

try:
    with DATA_PATH.open(encoding="utf-8") as fh:
        data = json.load(fh)
    ok(f"Loaded {DATA_PATH.name} ({DATA_PATH.stat().st_size:,} bytes)")
except json.JSONDecodeError as exc:
    fail(f"JSON parse error: {exc}")
    sys.exit(1)

print()

# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------

failures: list[str] = []


def assert_check(condition: bool, pass_msg: str, fail_msg: str) -> None:
    if condition:
        ok(pass_msg)
    else:
        fail(fail_msg)
        failures.append(fail_msg)


# 1. corridor_health.global_chi ∈ [0, 100]
try:
    chi = data["corridor_health"]["global_chi"]
    assert_check(
        isinstance(chi, (int, float)) and 0 <= chi <= 100,
        f"corridor_health.global_chi = {chi} ∈ [0, 100]",
        f"corridor_health.global_chi = {chi!r} is not in [0, 100]",
    )
except (KeyError, TypeError) as exc:
    fail(f"Could not read corridor_health.global_chi: {exc}")
    failures.append(str(exc))

# 2. top_signals length = 15
try:
    signals = data["top_signals"]
    n = len(signals)
    assert_check(
        n == 15,
        f"top_signals contains {n} signals (expected 15)",
        f"top_signals length = {n}, expected 15",
    )
except (KeyError, TypeError) as exc:
    fail(f"Could not read top_signals: {exc}")
    failures.append(str(exc))
    signals = []

# 3. All action_type values are in the 5-key contract set
bad_action_types = []
for i, sig in enumerate(signals):
    at = sig.get("action_type", "<missing>")
    if at not in CONTRACT_ACTION_TYPES:
        bad_action_types.append(f"  signal[{i}] row_id={sig.get('row_id')} → {at!r}")

assert_check(
    len(bad_action_types) == 0,
    "All action_type values are in the 5-key contract set",
    "Non-contract action_type values found:\n" + "\n".join(bad_action_types),
)

# 4. Each signal trajectory has all 8 required keys, each of length 52
traj_errors = []
REQUIRED_SIGNAL_FIELDS = [
    "row_id", "prs_score", "urgency", "severity", "region", "brand",
    "country", "mrp", "product_group", "breach_week", "arrival_target_week",
    "delta_t_weeks", "breach_length_weeks", "is_actionable", "is_early_order",
    "midpoint_target_units", "recommended_qty_units", "action_type",
    "action_desc", "badge_color", "root_cause", "trajectory",
    "supply_certainty", "capital_at_risk_inr",
]
field_errors = []
for i, sig in enumerate(signals):
    for fld in REQUIRED_SIGNAL_FIELDS:
        if fld not in sig:
            field_errors.append(f"signal[{i}] row_id={sig.get('row_id')} missing field: '{fld}'")
    prs = sig.get("prs_score", -1)
    if not (0 <= prs <= 100):
        field_errors.append(f"signal[{i}] prs_score {prs} not in [0, 100]")

    traj = sig.get("trajectory")
    if not isinstance(traj, dict):
        traj_errors.append(f"  signal[{i}] row_id={sig.get('row_id')} — trajectory is missing or not an object")
        continue
    missing_keys = REQUIRED_TRAJECTORY_KEYS - traj.keys()
    if missing_keys:
        traj_errors.append(
            f"  signal[{i}] row_id={sig.get('row_id')} — missing trajectory keys: {sorted(missing_keys)}"
        )
    for key in REQUIRED_TRAJECTORY_KEYS & traj.keys():
        arr = traj[key]
        if not isinstance(arr, list) or len(arr) != TRAJECTORY_EXPECTED_LENGTH:
            traj_errors.append(
                f"  signal[{i}] row_id={sig.get('row_id')} — trajectory[{key!r}] "
                f"has length {len(arr) if isinstance(arr, list) else type(arr).__name__!r}, "
                f"expected {TRAJECTORY_EXPECTED_LENGTH}"
            )

assert_check(
    len(field_errors) == 0,
    f"All {len(signals)} signals contain all 24 required fields with valid PRS in [0, 100]",
    "Signal field errors:\n" + "\n".join(field_errors[:10]),
)

assert_check(
    len(traj_errors) == 0,
    f"All {len(signals)} signal trajectories have 8 required keys each of length 52",
    "Trajectory shape errors:\n" + "\n".join(traj_errors),
)

# 5. executive.chronic_summary.total_pure_calibration_series = 379
try:
    total = data["executive"]["chronic_summary"]["total_pure_calibration_series"]
    assert_check(
        total == 379,
        f"executive.chronic_summary.total_pure_calibration_series = {total} (expected 379)",
        f"executive.chronic_summary.total_pure_calibration_series = {total}, expected 379",
    )
except (KeyError, TypeError) as exc:
    fail(f"Could not read total_pure_calibration_series: {exc}")
    failures.append(str(exc))

# 6. executive.chronic_summary.sample_series is a non-empty list
try:
    sample = data["executive"]["chronic_summary"]["sample_series"]
    assert_check(
        isinstance(sample, list) and len(sample) > 0,
        f"executive.chronic_summary.sample_series is a non-empty list ({len(sample)} records)",
        f"executive.chronic_summary.sample_series is empty or not a list: {type(sample).__name__!r}",
    )
except (KeyError, TypeError) as exc:
    fail(f"Could not read sample_series: {exc}")
    failures.append(str(exc))

# 7. executive.seasonality length = 12
try:
    seasonality = data["executive"]["seasonality"]
    n_months = len(seasonality) if isinstance(seasonality, list) else None
    assert_check(
        n_months == 12,
        f"executive.seasonality has {n_months} entries (expected 12)",
        f"executive.seasonality has {n_months!r} entries, expected 12",
    )
except (KeyError, TypeError) as exc:
    fail(f"Could not read executive.seasonality: {exc}")
    failures.append(str(exc))

# 8. chi_matrix shape is 12 rows × 20 columns
try:
    matrix = data["chi_matrix"]
    rows = len(matrix) if isinstance(matrix, list) else None
    if rows is not None:
        col_lengths = [len(row) for row in matrix if isinstance(row, list)]
        all_20 = all(c == 20 for c in col_lengths)
        shape_ok = rows == 12 and all_20 and len(col_lengths) == 12
        assert_check(
            shape_ok,
            f"chi_matrix shape is {rows} rows × {col_lengths[0] if col_lengths else '?'} columns (expected 12×20)",
            f"chi_matrix shape is {rows} rows, column lengths: {col_lengths} — expected 12×20",
        )
    else:
        fail(f"chi_matrix is not a list: {type(matrix).__name__!r}")
        failures.append("chi_matrix is not a list")
except (KeyError, TypeError) as exc:
    fail(f"Could not read chi_matrix: {exc}")
    failures.append(str(exc))

# 9. chi_lookup_matrix structured object validation
try:
    clm = data.get("chi_lookup_matrix", {})
    lt_len = len(clm.get("lead_time_axis", []))
    ceil_len = len(clm.get("ceiling_axis", []))
    val_rows = len(clm.get("values", []))
    clm_ok = lt_len == 12 and ceil_len == 20 and val_rows == 12
    assert_check(
        clm_ok,
        f"chi_lookup_matrix has valid axes ({lt_len} lead times × {ceil_len} ceilings) and 12-row values",
        f"chi_lookup_matrix invalid: lead_times={lt_len}, ceilings={ceil_len}, values_rows={val_rows}",
    )
except Exception as exc:
    fail(f"Could not read chi_lookup_matrix: {exc}")
    failures.append(str(exc))

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print()
print("=" * 60)
if not failures:
    print(f"{PASS}  ALL ASSERTIONS PASSED — dashboard_data.json is valid")
    print("=" * 60)
    sys.exit(0)
else:
    print(f"{FAIL}  {len(failures)} ASSERTION(S) FAILED", file=sys.stderr)
    print("=" * 60)
    sys.exit(1)
