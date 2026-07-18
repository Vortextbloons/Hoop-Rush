"""Run the full nba_api import pipeline.

Usage:
    python scripts/import_nba/run_all.py                 # fetch all default seasons
    python scripts/import_nba/run_all.py --seasons 2024-25 2023-24
    python scripts/import_nba/run_all.py --skip-awards
    python scripts/import_nba/run_all.py --skip-schedule
    python scripts/import_nba/run_all.py --skip-draft
    python scripts/import_nba/run_all.py --workers 16     # concurrent workers
    python scripts/import_nba/run_all.py --force-ratings  # recompute ratings
"""

from __future__ import annotations

import argparse
import json
import importlib
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))


def _import(module_name: str):
    """Import a submodule dynamically to avoid circular imports."""
    full = f"scripts.import_nba.{module_name}"
    return importlib.import_module(full)


def _fetch_season(season: str, skip_schedule: bool, force_ratings: bool) -> None:
    """Fetch all data for a single season."""
    fetch_rosters = _import("fetch_rosters").run
    fetch_season_stats = _import("fetch_season_stats").run
    compute_era_config = _import("compute_era_config").run
    compute_ratings = _import("compute_ratings").run

    print(f"\n=== {season} ===")
    try:
        fetch_rosters(season)
    except Exception as exc:
        print(f"  ! roster fetch failed: {exc}")
        return

    roster_path = REPO_ROOT / "public" / "data" / "nba" / season / "roster.json"
    roster = []
    if roster_path.exists():
        roster = json.loads(roster_path.read_text(encoding="utf-8"))

    try:
        fetch_season_stats(season, roster)
    except Exception as exc:
        print(f"  ! season stats fetch failed: {exc}")

    try:
        compute_era_config([season])
    except Exception as exc:
        print(f"  ! era config compute failed: {exc}")

    try:
        compute_ratings([season], force=force_ratings)
    except Exception as exc:
        print(f"  ! ratings compute failed: {exc}")

    if not skip_schedule:
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
    parser.add_argument("--skip-awards", action="store_true")
    parser.add_argument("--skip-schedule", action="store_true")
    parser.add_argument("--skip-draft", action="store_true")
    parser.add_argument("--force-champions", action="store_true")
    parser.add_argument("--force-ratings", action="store_true")
    parser.add_argument("--workers", type=int, default=config.MAX_WORKERS)
    args = parser.parse_args()

    seasons = args.seasons or DEFAULT_SEASONS
    workers = max(1, min(args.workers, len(seasons)))
    print(f"Running pipeline for {len(seasons)} seasons ({workers} workers)")

    if workers > 1:
        print(f"\n--- Phase 1: Fetching seasons concurrently ({workers} workers) ---")
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_fetch_season, s, args.skip_schedule, args.force_ratings): s
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
            _fetch_season(season, args.skip_schedule, args.force_ratings)

    print("\n--- Phase 2: Careers ---")
    compute_careers = _import("compute_careers").run
    compute_careers(seasons)

    if not args.skip_awards:
        print("\n--- Phase 3: Awards ---")
        try:
            fetch_awards = _import("fetch_awards").run
            fetch_awards(seasons)
        except Exception as exc:
            print(f"  ! awards fetch failed: {exc}")

    print("\n--- Phase 4: Champions ---")
    try:
        fetch_champions = _import("fetch_champions").run
        fetch_champions(force=args.force_champions)
    except Exception as exc:
        print(f"  ! champions fetch failed: {exc}")

    if not args.skip_draft:
        print("\n--- Phase 5: Draft ---")
        try:
            fetch_draft = _import("fetch_draft").run
            fetch_draft()
        except Exception as exc:
            print(f"  ! draft fetch failed: {exc}")

    print("\nAll done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
