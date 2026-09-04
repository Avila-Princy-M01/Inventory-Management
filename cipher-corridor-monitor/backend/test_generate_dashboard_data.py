"""
Unit tests for generate_dashboard_data.py output shape.
Loads backend/dashboard_data.json and asserts all structural constraints
required by the pharma-corridor-monitor-frontend spec (Requirements 1.2,
3.1–3.5, 6.7, 7.1, 8.1).

Run with:
    python -m pytest backend/test_generate_dashboard_data.py -v
or from inside backend/:
    python -m pytest test_generate_dashboard_data.py -v
"""

import json
import os
import unittest

# ---------------------------------------------------------------------------
# Load the fixture once at module level so every test class shares it.
# ---------------------------------------------------------------------------
_DASHBOARD_PATH = os.path.join(os.path.dirname(__file__), "dashboard_data.json")

_CONTRACT_ACTION_TYPES = {
    "ACTIVE CRISIS",
    "EMERGENCY EXPEDITE",
    "STANDARD PO",
    "ADVISORY",
    "EXCESS HOLDING",
}

_TRAJECTORY_KEYS = {
    "weeks",
    "inventory",
    "unclamped_inventory",
    "lost_patient_demand",
    "doh",
    "ssd",
    "ceiling",
    "demand",
}

_TRAJECTORY_LENGTH = 52
_TOP_SIGNALS_COUNT = 15
_REGIONAL_CHI_COUNT = 10
_BRAND_CHI_COUNT = 5
_SEASONALITY_COUNT = 12
_CHI_MATRIX_ROWS = 12
_CHI_MATRIX_COLS = 20


def _load_data() -> dict:
    """Load dashboard_data.json, skip all tests if the file is not yet present."""
    if not os.path.exists(_DASHBOARD_PATH):
        raise unittest.SkipTest(
            f"dashboard_data.json not found at {_DASHBOARD_PATH}. "
            "Run task 1.3 (generate_dashboard_data.py) first to produce the file."
        )
    with open(_DASHBOARD_PATH, encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Test classes
# ---------------------------------------------------------------------------


class TestTopSignals(unittest.TestCase):
    """Assertions against the top_signals array."""

    @classmethod
    def setUpClass(cls):
        cls.data = _load_data()
        cls.signals = cls.data["top_signals"]

    # --- Requirement 1.2 / 4.1: exactly 15 priority signals ----------------

    def test_top_signals_length_is_15(self):
        self.assertEqual(
            len(self.signals),
            _TOP_SIGNALS_COUNT,
            f"Expected {_TOP_SIGNALS_COUNT} signals, got {len(self.signals)}",
        )

    # --- Requirement 3.2: action_type values must be in the 5-key contract --

    def test_all_action_types_are_contract_values(self):
        violations = [
            (i, s.get("action_type"))
            for i, s in enumerate(self.signals)
            if s.get("action_type") not in _CONTRACT_ACTION_TYPES
        ]
        self.assertFalse(
            violations,
            f"Signals with non-contract action_type: {violations}",
        )

    def test_all_five_contract_keys_present_in_output(self):
        """The dataset should exercise the full contract — all 5 types appear."""
        found = {s.get("action_type") for s in self.signals}
        self.assertTrue(
            found.issubset(_CONTRACT_ACTION_TYPES),
            f"Found action_types not in contract: {found - _CONTRACT_ACTION_TYPES}",
        )

    # --- Requirement 3.1 / 3.3: prs_score ∈ [0, 100] -----------------------

    def test_all_prs_scores_in_range(self):
        out_of_range = [
            (i, s.get("prs_score"))
            for i, s in enumerate(self.signals)
            if not (0 <= (s.get("prs_score") or -1) <= 100)
        ]
        self.assertFalse(
            out_of_range,
            f"Signals with prs_score outside [0, 100]: {out_of_range}",
        )

    def test_all_prs_scores_are_numeric(self):
        non_numeric = [
            (i, s.get("prs_score"))
            for i, s in enumerate(self.signals)
            if not isinstance(s.get("prs_score"), (int, float))
        ]
        self.assertFalse(non_numeric, f"Non-numeric prs_score values: {non_numeric}")


class TestTrajectoryShape(unittest.TestCase):
    """Assertions against each signal's trajectory object."""

    @classmethod
    def setUpClass(cls):
        cls.data = _load_data()
        cls.signals = cls.data["top_signals"]

    def test_every_signal_has_trajectory_key(self):
        missing = [i for i, s in enumerate(self.signals) if "trajectory" not in s]
        self.assertFalse(missing, f"Signals missing 'trajectory': {missing}")

    def test_trajectory_has_all_8_required_keys(self):
        """Each trajectory must contain exactly the 8 spec-defined array keys."""
        violations = []
        for i, signal in enumerate(self.signals):
            traj = signal.get("trajectory", {})
            missing_keys = _TRAJECTORY_KEYS - set(traj.keys())
            if missing_keys:
                violations.append((i, sorted(missing_keys)))
        self.assertFalse(
            violations,
            f"Signals with missing trajectory keys: {violations}",
        )

    def test_every_trajectory_array_has_length_52(self):
        """Every array inside trajectory must have exactly 52 entries (one per week)."""
        violations = []
        for i, signal in enumerate(self.signals):
            traj = signal.get("trajectory", {})
            for key in _TRAJECTORY_KEYS:
                if key in traj:
                    length = len(traj[key])
                    if length != _TRAJECTORY_LENGTH:
                        violations.append((i, key, length))
        self.assertFalse(
            violations,
            f"Trajectory arrays with wrong length (expected 52): {violations}",
        )

    def test_trajectory_weeks_are_1_to_52(self):
        """The 'weeks' array must be the integers 1–52 in order."""
        for i, signal in enumerate(self.signals):
            traj = signal.get("trajectory", {})
            if "weeks" in traj:
                self.assertEqual(
                    traj["weeks"],
                    list(range(1, 53)),
                    f"Signal {i}: trajectory.weeks is not [1..52]",
                )


class TestCorridorHealth(unittest.TestCase):
    """Assertions against corridor_health block."""

    @classmethod
    def setUpClass(cls):
        cls.data = _load_data()
        cls.health = cls.data["corridor_health"]

    # --- Requirement 3.1: regional_chi has 10 entries -----------------------

    def test_regional_chi_has_10_entries(self):
        regional = self.health.get("regional_chi", [])
        self.assertEqual(
            len(regional),
            _REGIONAL_CHI_COUNT,
            f"Expected {_REGIONAL_CHI_COUNT} regional_chi entries, got {len(regional)}",
        )

    # --- Requirement 3.1: brand_chi has 5 entries ---------------------------

    def test_brand_chi_has_5_entries(self):
        brand = self.health.get("brand_chi", [])
        self.assertEqual(
            len(brand),
            _BRAND_CHI_COUNT,
            f"Expected {_BRAND_CHI_COUNT} brand_chi entries, got {len(brand)}",
        )

    def test_global_chi_in_range(self):
        chi = self.health.get("global_chi")
        self.assertIsNotNone(chi, "global_chi is missing")
        self.assertIsInstance(chi, (int, float))
        self.assertGreaterEqual(chi, 0)
        self.assertLessEqual(chi, 100)

    def test_regional_chi_values_in_range(self):
        for entry in self.health.get("regional_chi", []):
            chi = entry.get("chi")
            self.assertIsNotNone(chi, f"Missing 'chi' in regional entry: {entry}")
            self.assertGreaterEqual(chi, 0)
            self.assertLessEqual(chi, 100)

    def test_brand_chi_values_in_range(self):
        for entry in self.health.get("brand_chi", []):
            chi = entry.get("chi")
            self.assertIsNotNone(chi, f"Missing 'chi' in brand entry: {entry}")
            self.assertGreaterEqual(chi, 0)
            self.assertLessEqual(chi, 100)

    def test_wow_delta_present_and_valid(self):
        wow = self.health.get("wow_delta")
        self.assertIsNotNone(wow, "wow_delta is missing from corridor_health")
        self.assertIn("chi_delta", wow)
        self.assertIn("crises_delta", wow)
        self.assertIn("capital_delta_inr", wow)
        self.assertIn("otif_delta", wow)


class TestExecutiveBlock(unittest.TestCase):
    """Assertions against the executive block."""

    @classmethod
    def setUpClass(cls):
        cls.data = _load_data()
        cls.executive = cls.data.get("executive", {})

    def test_executive_wow_delta_present(self):
        wow = self.executive.get("wow_delta")
        self.assertIsNotNone(wow, "wow_delta is missing from executive")
        self.assertIn("briefing_narrative", wow)
        self.assertIn("crises_resolved", wow)
        self.assertIn("crises_emerged", wow)

    # --- Requirement 7.1: seasonality has 12 entries ------------------------

    def test_seasonality_has_12_entries(self):
        seasonality = self.executive.get("seasonality", [])
        self.assertEqual(
            len(seasonality),
            _SEASONALITY_COUNT,
            f"Expected {_SEASONALITY_COUNT} seasonality entries, got {len(seasonality)}",
        )

    def test_chronic_summary_present(self):
        self.assertIn("chronic_summary", self.executive, "'chronic_summary' key missing from executive block")

    def test_chronic_summary_total_series(self):
        summary = self.executive.get("chronic_summary", {})
        total = summary.get("total_pure_calibration_series")
        self.assertIsNotNone(total, "'total_pure_calibration_series' missing from chronic_summary")
        self.assertIsInstance(total, int)
        self.assertGreater(total, 0)

    def test_chronic_summary_sample_series_non_empty(self):
        summary = self.executive.get("chronic_summary", {})
        sample = summary.get("sample_series", [])
        self.assertIsInstance(sample, list)
        self.assertGreater(len(sample), 0, "'sample_series' is empty")


class TestCHIMatrix(unittest.TestCase):
    """Assertions against the chi_matrix 2D array."""

    @classmethod
    def setUpClass(cls):
        cls.data = _load_data()

    # --- Requirement 6.7: chi_matrix is a 12×20 2D array -------------------

    def test_chi_matrix_key_present(self):
        self.assertIn("chi_matrix", self.data, "'chi_matrix' top-level key missing from dashboard_data.json")

    def test_chi_matrix_has_12_rows(self):
        matrix = self.data.get("chi_matrix", [])
        self.assertEqual(
            len(matrix),
            _CHI_MATRIX_ROWS,
            f"Expected {_CHI_MATRIX_ROWS} rows in chi_matrix, got {len(matrix)}",
        )

    def test_chi_matrix_every_row_has_20_columns(self):
        matrix = self.data.get("chi_matrix", [])
        violations = [
            (row_idx, len(row))
            for row_idx, row in enumerate(matrix)
            if len(row) != _CHI_MATRIX_COLS
        ]
        self.assertFalse(
            violations,
            f"chi_matrix rows with wrong column count (expected {_CHI_MATRIX_COLS}): {violations}",
        )

    def test_chi_matrix_all_values_are_numeric_in_range(self):
        matrix = self.data.get("chi_matrix", [])
        violations = []
        for r, row in enumerate(matrix):
            for c, val in enumerate(row):
                if not isinstance(val, (int, float)) or not (0 <= val <= 100):
                    violations.append((r, c, val))
        self.assertFalse(
            violations,
            f"chi_matrix cells not in [0, 100]: {violations[:10]}",  # show first 10
        )

    def test_chi_matrix_is_2d_list_of_lists(self):
        matrix = self.data.get("chi_matrix", [])
        self.assertIsInstance(matrix, list)
        for i, row in enumerate(matrix):
            self.assertIsInstance(row, list, f"Row {i} is not a list")


class TestTopLevelStructure(unittest.TestCase):
    """Sanity checks on mandatory top-level keys."""

    @classmethod
    def setUpClass(cls):
        cls.data = _load_data()

    def test_required_top_level_keys_present(self):
        required = {"metadata", "corridor_health", "top_signals", "executive", "simulated_email", "chi_matrix"}
        missing = required - set(self.data.keys())
        self.assertFalse(missing, f"Missing top-level keys: {missing}")

    def test_simulated_email_is_non_empty_string(self):
        email = self.data.get("simulated_email")
        self.assertIsInstance(email, str)
        self.assertGreater(len(email.strip()), 0, "'simulated_email' is an empty string")


if __name__ == "__main__":
    unittest.main(verbosity=2)
