"""Fetch-only NBA import pipeline (compute moved to TypeScript).

Fetches raw nba_api data for the requested seasons: rosters, stints, season
stats, and optionally schedules, plus the Basketball-Reference id mapping.
All compute (era config, ratings, pools, careers) lives in TypeScript.

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


def _import(module_name: str):
    """Import a submodule dynamically to avoid circular imports."""
    full = f"{PACKAGE_NAME}.{module_name}"
    return importlib.import_module(full)


def _fetch_season(season: str, include_schedule: bool, force_stints: bool) -> None:
    """Fetch all raw data for a single season."""
    fetch_rosters = _import("fetch_rosters").run
    fetch_season_stats = _import("fetch_season_stats").run

    print(f"\n=== {season} ===")
    try:
        fetch_rosters(season)
    except Exception as exc:
        print(f"  ! roster fetch failed: {exc}")
        return

    config = _import("config")
    roster_path = config.NBA_ROOT / season / "roster.json"
    roster = []
    if roster_path.exists():
        roster = json.loads(roster_path.read_text(encoding="utf-8"))

    # Stints run before season stats: early-90s seasons fall back to
    # stint-derived league totals when the league dashboard returns nothing.
    try:
        fetch_stints = _import("fetch_stints")
        fetch_stints.compute_for_season(season, force=force_stints)
    except Exception as exc:
        print(f"  ! stints fetch failed: {exc}")

    try:
        fetch_season_stats(season, roster)
    except Exception as exc:
        print(f"  ! season stats fetch failed: {exc}")

    if include_schedule:
        try:
            fetch_schedule = _import("fetch_schedule").run
            fetch_schedule(season)
        except Exception as exc:
            print(f"  ! schedule fetch failed: {exc}")


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
                    future.result()
                except Exception as exc:
                    print(f"  ! {season} failed: {exc}")
    else:
        for season in seasons:
            _fetch_season(season, args.include_schedule, args.force_stints)

    print("\n--- Phase 2: Basketball-Reference IDs ---")
    if args.skip_bbref:
        print("  (skipped)")
    else:
        try:
            fetch_bbref_ids = _import("fetch_bbref_ids").run
            fetch_bbref_ids()
        except Exception as exc:
            print(f"  ! bbref ids fetch failed: {exc}")

    metrics = _import("util").import_metrics()
    elapsed = time.perf_counter() - started_at
    print(
        f"\nAll done in {elapsed:.1f}s "
        f"({metrics['networkRequests']} network requests, "
        f"{metrics['cacheHits']} cache hits)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
