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
module = importlib.import_module(f"{PACKAGE_NAME}.fetch_overall_evidence")


class OverallEvidenceTests(unittest.TestCase):
    def test_only_exact_individual_honors_are_used(self):
        html = '<tr><td data-append-csv="sample01"></td><td data-stat="awards">MVP-10, NBA1, AS, DEF2, MVP-1</td></tr>'
        self.assertEqual(module.parse_honors(html), {"sample01": ["DEF2", "MVP-1", "NBA1"]})
        rows = [
            {"SEASON": "2000-01", "DESCRIPTION": "NBA Most Valuable Player"},
            {"SEASON": "2000-01", "DESCRIPTION": "NBA All-Star Most Valuable Player"},
            {"SEASON": "2000-01", "DESCRIPTION": "All-NBA", "ALL_NBA_TEAM_NUMBER": 2},
            {"SEASON": "1999-00", "DESCRIPTION": "All-Defensive Team", "ALL_NBA_TEAM_NUMBER": 1},
        ]
        self.assertEqual(module.honors_from_awards(rows, "2000-01"), ["MVP-1", "NBA2"])

    def test_missing_historical_possession_fields_do_not_become_zero(self):
        row = {"YEAR": "1980-81", "GP": 80, "FGA": 8000, "FTA": 2000, "OREB": 1000, "TOV": 1500}
        self.assertAlmostEqual(module.estimated_pace(row), 112.56)
        self.assertIsNone(module.estimated_pace({**row, "OREB": None}))
        self.assertIsNone(module.estimated_pace({**row, "YEAR": "1976-77"}))

    def test_missing_bbref_mapping_uses_nba_awards_and_covers_unpacked_players(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            season = root / "2000-01"
            season.mkdir()
            (season / "roster.json").write_text(json.dumps([{"externalId": "7"}]), encoding="utf-8")
            stats = [{"playerExternalId": identity, "points": 1800, "fga": 1500, "fta": 500} for identity in ["7", "8"]]
            (season / "season-stats.json").write_text(json.dumps(stats), encoding="utf-8")
            (season / "stints.json").write_text("[]", encoding="utf-8")
            def awards(identity):
                return identity, [{"SEASON": "2000-01", "DESCRIPTION": "All-NBA", "ALL_NBA_TEAM_NUMBER": 1}]
            with patch.object(module, "NBA_ROOT", root), patch.object(module, "RAW_CACHE", root), patch.object(module, "fetch_player_awards", side_effect=awards), patch.object(module.requests, "get", side_effect=AssertionError("unexpected web request")):
                result = module.build_season("2000-01", {}, {})
            self.assertEqual(result["players"]["7"]["honors"], ["NBA1"])
            self.assertEqual(result["players"]["8"]["honors"], ["NBA1"])
            self.assertIn("https://stats.nba.com/stats/playerawards", result["sources"])


if __name__ == "__main__":
    unittest.main()
