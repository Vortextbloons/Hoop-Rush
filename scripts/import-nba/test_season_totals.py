from __future__ import annotations

import importlib
import sys
import types
import unittest
import json
import tempfile
from unittest.mock import patch
from pathlib import Path

PACKAGE_NAME = "_hoop_rush_import"
if PACKAGE_NAME not in sys.modules:
    package = types.ModuleType(PACKAGE_NAME)
    package.__path__ = [str(Path(__file__).resolve().parent)]
    package.__package__ = PACKAGE_NAME
    sys.modules[PACKAGE_NAME] = package

module = importlib.import_module(f"{PACKAGE_NAME}.fetch_season_stats")


class SeasonTotalsTests(unittest.TestCase):
    def test_partial_coverage_is_not_a_full_season_total(self):
        self.assertFalse(module._coverage_ok({"minutes": 60}, "minutes", 80))
        self.assertFalse(module._coverage_ok({"fga": 79}, "fga", 80))
        self.assertTrue(module._coverage_ok({"minutes": 80}, "minutes", 80))
        self.assertFalse(module._coverage_ok({}, "minutes", 80))

    def row(self):
        return {"PLAYER_ID": 7, "GP": 80, "MIN": 3000, "PTS": 1800,
                "FGM": 700, "FGA": 1500, "FTM": 400, "FTA": 500,
                "FG3M": 0, "FG3A": 0, "REB": 800, "AST": 300}

    def test_observed_totals_preserve_missing_historical_families(self):
        result = module.totals_from_leaders([self.row()], "1968-69")[0]
        self.assertEqual(result["minutes"], 3000)
        self.assertEqual(result["assists"], 300)
        self.assertIsNone(result["tpm"])
        self.assertIsNone(result["blocks"])
        self.assertIsNone(result["turnovers"])
        self.assertIsNone(result["per"])
        self.assertIsNone(result["boxPlusMinus"])
        self.assertAlmostEqual(result["tsPct"], 1800 / (2 * (1500 + 0.44 * 500)))

    def test_inconsistent_totals_and_duplicate_identities_fail(self):
        with self.assertRaises(ValueError):
            module.totals_from_leaders([{**self.row(), "PTS": 1801}], "1980-81")
        with self.assertRaises(ValueError):
            module.totals_from_leaders([self.row(), self.row()], "1980-81")

    def test_authoritative_stint_repair_keeps_missing_families_missing(self):
        total = module.totals_from_leaders([self.row()], "1968-69")[0]
        stint = {"minutes": 2300, "blocks": 0, "coverage": {"minutes": 60}}
        module.repair_stint(stint, total)
        self.assertEqual(stint["minutes"], 3000)
        self.assertEqual(stint["coverage"]["minutes"], 80)
        self.assertIsNone(stint["blocks"])
        self.assertEqual(stint["coverage"]["blocks"], 0)

    def test_traded_player_coverage_uses_career_total_without_double_counting(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            stints = [{"playerExternalId": "7", "teamExternalId": "1", "gamesPlayed": 80},
                      {"playerExternalId": "8", "teamExternalId": "2", "gamesPlayed": 40},
                      {"playerExternalId": "8", "teamExternalId": "3", "gamesPlayed": 40}]
            (path / "stints.json").write_text(json.dumps(stints), encoding="utf-8")
            total = {**self.row(), "PLAYER_ID": 8, "TEAM_ID": 0, "SEASON_ID": "1968-69", "LEAGUE_ID": "00"}
            halves = [{**total, **{key: value / 2 for key, value in self.row().items() if key != "PLAYER_ID"}, "TEAM_ID": team} for team in [2, 3]]
            def cached(key, **kwargs):
                return [self.row()] if key == "league_leaders_totals" else [*halves, total]
            with patch.object(module, "ensure_output_dir", return_value=path), patch.object(module, "read_cache", side_effect=cached):
                rows = module.full_season_totals("1968-69")
            traded = next(row for row in rows if row["playerExternalId"] == "8")
            self.assertEqual(traded["points"], 1800)
            self.assertEqual(traded["minutes"], 3000)
            self.assertEqual(traded["statsSource"], "nba-career-totals")
            repaired = json.loads((path / "stints.json").read_text(encoding="utf-8"))
            self.assertEqual(repaired[1]["minutes"], 1500)
            self.assertEqual(repaired[1]["coverage"]["minutes"], 40)

    def test_bad_career_shooting_is_quarantined_instead_of_observed(self):
        result = module.validated_career_total({**self.row(), "PTS": 1801}, "1980-81")
        self.assertEqual(result["points"], 1801)
        self.assertIsNone(result["fgm"])
        self.assertIsNone(result["fga"])
        self.assertIsNone(result["tsPct"])
        self.assertEqual(result["sourceIssues"], ["shooting-accounting-mismatch"])


if __name__ == "__main__":
    unittest.main()
