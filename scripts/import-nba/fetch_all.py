"""Fetch-only NBA import pipeline (compute moved to TypeScript).

Fetches raw nba_api data for the requested seasons: rosters, stints, season
stats, and optionally schedules, plus the Basketball-Reference id mapping.
All compute (era config, ratings, pools, careers) lives in TypeScript.

Every stage failure is collected and the required per-season outputs are
checked for existence and non-empty content; ``main`` returns nonzero when
anything failed or is missing.

Usage:
    python scripts/import-nba/fetch_all.py                 # fetch all default seasons
    python scripts/import-nba/fetch_all.py --seasons 2024-25 2023-24
    python scripts/import-nba/fetch_all.py --include-schedule
    python scripts/import-nba/fetch_all.py --force-stints  # recompute stints
    python scripts/import-nba/fetch_all.py --workers 16    # concurrent workers
    python scripts/import-nba/fetch_all.py --skip-bbref    # skip bbref id mapping
"""

from __future__ import annotations

import argparse
import json
import importlib
import sys
import time
import types
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))
PACKAGE_DIR = Path(__file__).resolve().parent
PACKAGE_NAME = "_hoop_rush_import"

# The directory intentionally keeps its user-facing `import-nba` name, which is not
# a legal Python package identifier. Register a private package alias so sibling
# modules can use normal relative imports when this file is executed directly.
if PACKAGE_NAME not in sys.modules:
    package = types.ModuleType(PACKAGE_NAME)
    package.__path__ = [str(PACKAGE_DIR)]  # type: ignore[attr-defined]
    package.__package__ = PACKAGE_NAME
    sys.modules[PACKAGE_NAME] = package

REQUIRED_SEASON_OUTPUTS = ("roster.json", "stints.json", "season-stats.json")
SCHEDULE_OUTPUT = "schedule.json"
BBREF_IDS_FILENAME = "bbref_ids.json"


def _import(module_name: str):
    """Import a submodule dynamically to avoid circular imports."""
    full = f"{PACKAGE_NAME}.{module_name}"
    return importlib.import_module(full)


def _require_output(path: Path, label: str, failures: list[str]) -> None:
    """Record a failure when a required output is missing or empty."""
    try:
        size = path.stat().st_size
    except OSError:
        failures.append(f"{label} missing: {path}")
        return
    if size <= 0:
        failures.append(f"{label} is empty: {path}")


def _verify_season_outputs(
    season: str,
    include_schedule: bool,
    config,
    failures: list[str],
) -> None:
    season_dir = Path(config.NBA_ROOT) / season
    for name in REQUIRED_SEASON_OUTPUTS:
        _require_output(season_dir / name, f"{season} {name}", failures)
    if include_schedule:
        _require_output(season_dir / SCHEDULE_OUTPUT, f"{season} {SCHEDULE_OUTPUT}", failures)


def _fetch_season(season: str, include_schedule: bool, force_stints: bool) -> list[str]:
    """Fetch all raw data for a single season, returning collected failures."""
    failures: list[str] = []
    print(f"\n=== {season} ===")

    try:
        config = _import("config")
    except Exception as exc:
        message = f"{season} config load failed: {exc}"
        print(f"  ! {message}")
        failures.append(message)
        return failures

    roster_failed = False
    try:
        _import("fetch_rosters").run(season)
    except Exception as exc:
        message = f"{season} roster fetch failed: {exc}"
        print(f"  ! {message}")
        failures.append(message)
        roster_failed = True

    roster_path = config.NBA_ROOT / season / "roster.json"
    roster = []
    if roster_path.exists():
        try:
            roster = json.loads(roster_path.read_text(encoding="utf-8"))
        except Exception as exc:
            failures.append(f"{season} roster.json unreadable: {exc}")

    if not roster_failed:
        # Stints run before season stats: early-90s seasons fall back to
        # stint-derived league totals when the league dashboard returns nothing.
        try:
            _import("fetch_stints").compute_for_season(season, force=force_stints)
        except Exception as exc:
            message = f"{season} stints fetch failed: {exc}"
            print(f"  ! {message}")
            failures.append(message)

        try:
            _import("fetch_season_stats").run(season, roster)
        except Exception as exc:
            message = f"{season} season stats fetch failed: {exc}"
            print(f"  ! {message}")
            failures.append(message)

        if include_schedule:
            try:
                _import("fetch_schedule").run(season)
            except Exception as exc:
                message = f"{season} schedule fetch failed: {exc}"
                print(f"  ! {message}")
                failures.append(message)

    _verify_season_outputs(season, include_schedule, config, failures)
    return failures


def main() -> int:
    config = _import("config")
    DEFAULT_SEASONS = config.DEFAULT_SEASONS
    parser = argparse.ArgumentParser()
    parser.add_argument("--seasons", nargs="*", default=None)
    parser.add_argument("--include-schedule", action="store_true")
    parser.add_argument("--force-stints", action="store_true")
    parser.add_argument("--workers", type=int, default=config.MAX_WORKERS)
    parser.add_argument(
        "--skip-bbref", action="store_true",
        help="skip the Basketball-Reference id mapping (pools ship without altIds)",
    )
    args = parser.parse_args()

    seasons = args.seasons or DEFAULT_SEASONS
    workers = max(1, min(args.workers, len(seasons)))
    started_at = time.perf_counter()
    print(f"Running pipeline for {len(seasons)} seasons ({workers} workers)")

    failures: list[str] = []
    if workers > 1:
        print(f"\n--- Phase 1: Fetching seasons concurrently ({workers} workers) ---")
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_fetch_season, s, args.include_schedule, args.force_stints): s
                for s in seasons
            }
            for future in as_completed(futures):
                season = futures[future]
                try:
                    failures.extend(future.result())
                except Exception as exc:
                    message = f"{season} failed: {exc}"
                    print(f"  ! {message}")
                    failures.append(message)
    else:
        for season in seasons:
            try:
                failures.extend(_fetch_season(season, args.include_schedule, args.force_stints))
            except Exception as exc:
                message = f"{season} failed: {exc}"
                print(f"  ! {message}")
                failures.append(message)

    print("\n--- Phase 2: Basketball-Reference IDs ---")
    if args.skip_bbref:
        print("  (skipped)")
    else:
        try:
            fetch_bbref_ids = _import("fetch_bbref_ids").run
            fetch_bbref_ids()
        except Exception as exc:
            message = f"bbref ids fetch failed: {exc}"
            print(f"  ! {message}")
            failures.append(message)
        _require_output(config.RAW_CACHE / BBREF_IDS_FILENAME, BBREF_IDS_FILENAME, failures)

    try:
        metrics = _import("util").import_metrics()
    except Exception as exc:
        failures.append(f"metrics unavailable: {exc}")
        metrics = {"networkRequests": 0, "cacheHits": 0}
    elapsed = time.perf_counter() - started_at
    if failures:
        print(f"\nFAILED after {elapsed:.1f}s with {len(failures)} failure(s):")
        for message in failures:
            print(f"  - {message}")
        return 1
    print(
        f"\nAll done in {elapsed:.1f}s "
        f"({metrics['networkRequests']} network requests, "
        f"{metrics['cacheHits']} cache hits)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
