"""Re-annotate packaged pools with headshot asset data.

One-time repair for pool builds that ran without the asset annotation step
(--no-assets, or a silent annotation failure): every player lost
altIds.nbaHeadshotAvailable and altIds.photoUrl, leaving the UI stuck on the
NBA CDN's generic silhouette for players without a real CDN headshot.

Loads each packaged FranchiseEraPool, runs the authoritative annotation
functions (fetch_nba_headshots.annotate_nba_headshots and
fetch_wikipedia_photos.ensure_photos) on the packaged players, and writes the
pool back. Network lookups are cached in .raw_nba_cache, so re-running resumes
where the previous run stopped.

Usage:
    python scripts/import-nba/reannotate_assets.py              # all pools
    python scripts/import-nba/reannotate_assets.py lakers 1990s # one pool
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
PACKAGE_DIR = Path(__file__).resolve().parent
PACKAGE_NAME = "_hoop_rush_import"

if PACKAGE_NAME not in sys.modules:
    import types

    package = types.ModuleType(PACKAGE_NAME)
    package.__path__ = [str(PACKAGE_DIR)]  # type: ignore[attr-defined]
    package.__package__ = PACKAGE_NAME
    sys.modules[PACKAGE_NAME] = package

from _hoop_rush_import.config import PUBLIC_DATA  # noqa: E402
from _hoop_rush_import.fetch_nba_headshots import annotate_nba_headshots  # noqa: E402
from _hoop_rush_import.fetch_wikipedia_photos import ensure_photos  # noqa: E402

POOLS_DIR = PUBLIC_DATA / "pools"


def pool_path(franchise_id: str, era_id: str) -> Path:
    return POOLS_DIR / f"{franchise_id}-{era_id}.json"


def write_pool(path: Path, pool: dict[str, Any]) -> None:
    path.write_text(json.dumps(pool, indent=2) + "\n", encoding="utf-8")


def reannotate_pool(path: Path) -> tuple[int, int]:
    pool = json.loads(path.read_text(encoding="utf-8"))
    players = pool.get("players", [])
    if not players:
        return 0, 0

    # nbaHeadshotAvailable is the authoritative marker for a completed asset
    # annotation (false is a valid value); photoUrl is legitimately null when
    # the bbref photo works.
    missing = [
        p for p in players if (p.get("altIds") or {}).get("nbaHeadshotAvailable") is None
    ]
    if not missing:
        return len(players), 0

    # These authoritative functions fill altIds in place, using the
    # .raw_nba_cache status caches and only touching the network for unknown
    # players. photoUrl is only resolved when the bbref photo is missing, so
    # players with a working bbref headshot keep photoUrl null.
    annotate_nba_headshots(players)
    ensure_photos(players)

    write_pool(path, pool)
    return len(players), len(missing)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("targets", nargs="*", help="franchiseId eraId pairs; default: all pools")
    args = parser.parse_args()

    if args.targets:
        if len(args.targets) % 2 != 0:
            print("error: pass franchiseId eraId pairs")
            return 2
        targets = [
            pool_path(args.targets[i], args.targets[i + 1])
            for i in range(0, len(args.targets), 2)
        ]
    else:
        targets = sorted(POOLS_DIR.glob("*.json"))

    total_players = 0
    total_fixed = 0
    for path in targets:
        if not path.exists():
            print(f"  [SKIP] {path.name} not found")
            continue
        players, fixed = reannotate_pool(path)
        total_players += players
        total_fixed += fixed
        print(f"  [OK] {path.name}: {players} players, {fixed} re-annotated")
    print(f"done: {total_players} players across {len(targets)} pools, {total_fixed} re-annotated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
