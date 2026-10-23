from __future__ import annotations

import importlib
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

PACKAGE_NAME = "_hoop_rush_import"
if PACKAGE_NAME not in sys.modules:
    package = types.ModuleType(PACKAGE_NAME)
    package.__path__ = [str(Path(__file__).resolve().parent)]
    package.__package__ = PACKAGE_NAME
    sys.modules[PACKAGE_NAME] = package
module = importlib.import_module(f"{PACKAGE_NAME}.fetch_evidence")


class TrackingEvidenceTests(unittest.TestCase):
    def merge(self, hustle, tracking=None):
        with patch.object(module, "fetch_hustle", return_value=hustle), patch.object(
            module, "fetch_pt_measure", side_effect=lambda season, measure: (tracking or {}).get(measure, [])
        ):
            return module.merge_evidence("2015-16")

    def test_partial_hustle_keeps_its_own_sample_and_unavailable_boxouts_missing(self):
        result = self.merge([{"PLAYER_ID": 201939, "G": 2, "MIN": 78,
                              "DEFLECTIONS": 9, "CONTESTED_SHOTS_3PT": 0, "BOX_OUTS": 0}])
        row = result["201939"]
        self.assertEqual(row["hustleGamesPlayed"], 2)
        self.assertEqual(row["hustleMinutes"], 78)
        self.assertEqual(row["deflections"], 9)
        self.assertEqual(row["contestedShots3pt"], 0)
        self.assertNotIn("boxOuts", row)

    def test_observed_zero_boxouts_remain_zero_when_the_field_has_league_coverage(self):
        result = self.merge([{"PLAYER_ID": 1, "G": 80, "MIN": 2000, "BOX_OUTS": 0},
                             {"PLAYER_ID": 2, "G": 80, "MIN": 2000, "BOX_OUTS": 100}])
        self.assertEqual(result["1"]["boxOuts"], 0)

    def test_rebound_chances_and_creation_keep_matching_tracking_samples(self):
        result = self.merge([], {
            "Rebounding": [{"PLAYER_ID": 1, "MIN": 357, "OREB": 7, "DREB": 40,
                            "OREB_CHANCES": 22, "DREB_CHANCES": 63}],
            "Passing": [{"PLAYER_ID": 1, "MIN": 300, "POTENTIAL_AST": 50}],
            "Drives": [{"PLAYER_ID": 1, "MIN": 250, "DRIVES": 40}],
        })["1"]
        self.assertEqual(result["trackedOffensiveRebounds"], 7)
        self.assertEqual(result["trackedDefensiveRebounds"], 40)
        self.assertEqual(result["passingMinutes"], 300)
        self.assertEqual(result["drivesMinutes"], 250)


if __name__ == "__main__":
    unittest.main()
