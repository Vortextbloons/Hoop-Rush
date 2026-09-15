from __future__ import annotations

import importlib
import sys
import types
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_DIR = Path(__file__).resolve().parent
PACKAGE_NAME = "_hoop_rush_import"
if PACKAGE_NAME not in sys.modules:
    package = types.ModuleType(PACKAGE_NAME)
    package.__path__ = [str(PACKAGE_DIR)]  # type: ignore[attr-defined]
    package.__package__ = PACKAGE_NAME
    sys.modules[PACKAGE_NAME] = package

fetch_rosters = importlib.import_module(f"{PACKAGE_NAME}.fetch_rosters")


class FetchRosterNameTests(unittest.TestCase):
    def test_prefers_canonical_player_name_over_nickname(self):
        self.assertEqual(
            fetch_rosters._split_player_name("Yao Ming", "Ming"),
            ("Yao", "Ming"),
        )

    def test_preserves_multiword_surname(self):
        self.assertEqual(
            fetch_rosters._split_player_name("John Lucas III", "John"),
            ("John", "Lucas III"),
        )

    def test_uses_nickname_only_when_player_name_is_missing(self):
        self.assertEqual(
            fetch_rosters._split_player_name("", "Nene"),
            ("Nene", "Nene"),
        )


if __name__ == "__main__":
    unittest.main()
