"""Failure-mode tests for scripts/import-nba/fetch_all.py.

Run from the repo root with either command:

    python -m unittest scripts.import-nba.test_fetch_all
    python -m unittest discover -s scripts/import-nba -p "test_*.py"

The tests patch ``fetch_all._import`` so no nba_api calls or real network
access happen; stages write into a temporary NBA_ROOT.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

try:
    from . import fetch_all
except ImportError:  # pragma: no cover - direct script execution
    _SPEC = importlib.util.spec_from_file_location(
        "fetch_all", Path(__file__).with_name("fetch_all.py")
    )
    assert _SPEC is not None and _SPEC.loader is not None
    fetch_all = importlib.util.module_from_spec(_SPEC)
    _SPEC.loader.exec_module(fetch_all)


class FakeConfig:
    def __init__(self, nba_root: Path, raw_cache: Path, seasons: list[str], workers: int = 1):
        self.NBA_ROOT = nba_root
        self.RAW_CACHE = raw_cache
        self.DEFAULT_SEASONS = seasons
        self.MAX_WORKERS = workers


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def make_modules(
    nba_root: Path,
    raw_cache: Path,
    seasons: list[str],
    *,
    fail: str | None = None,
    missing: str | None = None,
    empty: str | None = None,
):
    """Build fake stage modules.

    ``fail`` raises in that stage, ``missing`` makes that stage a silent no-op,
    and ``empty`` makes that stage write a zero-byte output.
    """

    def emit(stage: str, season: str, filename: str, payload: str) -> None:
        if missing == stage:
            return
        _write(nba_root / season / filename, "" if empty == stage else payload)

    def roster_run(season: str) -> None:
        if fail == "rosters":
            raise RuntimeError("roster boom")
        emit("rosters", season, "roster.json", "[]")

    def stints_run(season: str, force: bool = False) -> None:
        if fail == "stints":
            raise RuntimeError("stints boom")
        emit("stints", season, "stints.json", "[]")

    def stats_run(season: str, roster) -> None:
        if fail == "season-stats":
            raise RuntimeError("stats boom")
        emit("season-stats", season, "season-stats.json", "[]")

    def schedule_run(season: str) -> None:
        if fail == "schedule":
            raise RuntimeError("schedule boom")
        emit("schedule", season, "schedule.json", '{"games": []}')

    def bbref_run():
        if fail == "bbref":
            raise RuntimeError("bbref boom")
        if missing == "bbref":
            return {}
        _write(raw_cache / "bbref_ids.json", "" if empty == "bbref" else "{}")
        return {}

    return {
        "config": FakeConfig(nba_root, raw_cache, seasons),
        "fetch_rosters": types.SimpleNamespace(run=roster_run),
        "fetch_stints": types.SimpleNamespace(compute_for_season=stints_run),
        "fetch_season_stats": types.SimpleNamespace(run=stats_run),
        "fetch_schedule": types.SimpleNamespace(run=schedule_run),
        "fetch_bbref_ids": types.SimpleNamespace(run=bbref_run),
        "util": types.SimpleNamespace(
            import_metrics=lambda: {"networkRequests": 0, "cacheHits": 0}
        ),
    }


class FetchAllFailureTests(unittest.TestCase):
    def run_main(
        self,
        argv: list[str],
        *,
        seasons: list[str] | None = None,
        fail: str | None = None,
        missing: str | None = None,
        empty: str | None = None,
    ) -> tuple[int, str]:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            modules = make_modules(
                root / "nba",
                root / "cache",
                seasons or ["2024-25"],
                fail=fail,
                missing=missing,
                empty=empty,
            )

            def fake_import(name: str):
                return modules[name]

            stdout = io.StringIO()
            with mock.patch.object(fetch_all, "_import", side_effect=fake_import):
                with mock.patch.object(sys, "argv", ["fetch_all.py", *argv]):
                    with contextlib.redirect_stdout(stdout):
                        code = fetch_all.main()
            return code, stdout.getvalue()

    def test_all_success_returns_zero(self):
        code, output = self.run_main(["--seasons", "2024-25", "--workers", "1"])
        self.assertEqual(code, 0, output)

    def test_stage_failure_returns_nonzero(self):
        code, output = self.run_main(["--seasons", "2024-25", "--workers", "1"], fail="stints")
        self.assertEqual(code, 1, output)
        self.assertIn("stints fetch failed", output)

    def test_roster_failure_skips_dependent_stages_but_fails(self):
        code, output = self.run_main(["--seasons", "2024-25", "--workers", "1"], fail="rosters")
        self.assertEqual(code, 1, output)
        self.assertIn("roster fetch failed", output)
        self.assertNotIn("stats boom", output)

    def test_missing_required_output_returns_nonzero(self):
        code, output = self.run_main(
            ["--seasons", "2024-25", "--workers", "1"], missing="season-stats"
        )
        self.assertEqual(code, 1, output)
        self.assertIn("season-stats.json missing", output)

    def test_empty_required_output_returns_nonzero(self):
        code, output = self.run_main(["--seasons", "2024-25", "--workers", "1"], empty="stints")
        self.assertEqual(code, 1, output)
        self.assertIn("stints.json is empty", output)

    def test_schedule_required_only_with_include_schedule(self):
        code, output = self.run_main(
            ["--seasons", "2024-25", "--workers", "1"], missing="schedule"
        )
        self.assertEqual(code, 0, output)
        code, output = self.run_main(
            ["--seasons", "2024-25", "--workers", "1", "--include-schedule"],
            missing="schedule",
        )
        self.assertEqual(code, 1, output)
        self.assertIn("schedule.json missing", output)

    def test_skip_bbref_does_not_require_ids(self):
        code, output = self.run_main(
            ["--seasons", "2024-25", "--workers", "1", "--skip-bbref"], missing="bbref"
        )
        self.assertEqual(code, 0, output)
        code, output = self.run_main(
            ["--seasons", "2024-25", "--workers", "1"], missing="bbref"
        )
        self.assertEqual(code, 1, output)
        self.assertIn("bbref_ids.json missing", output)

    def test_bbref_failure_returns_nonzero(self):
        code, output = self.run_main(["--seasons", "2024-25", "--workers", "1"], fail="bbref")
        self.assertEqual(code, 1, output)
        self.assertIn("bbref ids fetch failed", output)

    def test_concurrent_workers_collect_season_failures(self):
        code, output = self.run_main(
            ["--workers", "2"],
            seasons=["2024-25", "2023-24"],
            fail="season-stats",
        )
        self.assertEqual(code, 1, output)
        self.assertIn("2024-25 season stats fetch failed", output)
        self.assertIn("2023-24 season stats fetch failed", output)


if __name__ == "__main__":
    unittest.main()
