"""Run the full nba_api import pipeline.

Usage:
    python scripts/import-nba/run_all.py                 # fetch all default seasons
    python scripts/import-nba/run_all.py --seasons 2024-25 2023-24
    python scripts/import-nba/run_all.py --include-schedule
    python scripts/import-nba/run_all.py --workers 16     # concurrent workers
    python scripts/import-nba/run_all.py --force-ratings  # recompute ratings
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


def _fetch_season(season: str, include_schedule: bool, force_ratings: bool) -> None:
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

    config = _import("config")
    roster_path = config.NBA_ROOT / season / "roster.json"
    roster = []
    if roster_path.exists():
        roster = json.loads(roster_path.read_text(encoding="utf-8"))

    # Stints run before season stats: early-90s seasons fall back to
    # stint-derived league totals when the league dashboard returns nothing.
    try:
        fetch_stints = _import("fetch_stints")
        fetch_stints.compute_for_season(season, force=force_ratings)
    except Exception as exc:
        print(f"  ! stints fetch failed: {exc}")

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
    parser.add_argument("--force-ratings", action="store_true")
    parser.add_argument("--workers", type=int, default=config.MAX_WORKERS)
    parser.add_argument(
        "--pools", nargs="+", default=["lakers/1990s"],
        help="franchiseId/eraId pool targets (default lakers/1990s)",
    )
    parser.add_argument(
        "--skip-careers", action="store_true",
        help="skip the per-player career-stats fetch (not used by pools)",
    )
    args = parser.parse_args()

    seasons = args.seasons or DEFAULT_SEASONS
    pools = [tuple(p.split("/")) for p in args.pools]  # type: ignore[assignment]
    workers = max(1, min(args.workers, len(seasons)))
    started_at = time.perf_counter()
    print(f"Running pipeline for {len(seasons)} seasons ({workers} workers)")

    if workers > 1:
        print(f"\n--- Phase 1: Fetching seasons concurrently ({workers} workers) ---")
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {
                pool.submit(_fetch_season, s, args.include_schedule, args.force_ratings): s
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
            _fetch_season(season, args.include_schedule, args.force_ratings)

    print("\n--- Phase 2: Careers ---")
    if args.skip_careers:
        print("  (skipped)")
    else:
        compute_careers = _import("compute_careers").run
        compute_careers(seasons)

    print("\n--- Phase 3: Franchise-era pools ---")
    compute_pools = _import("compute_pools")
    compute_pools.run(targets=pools)

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
