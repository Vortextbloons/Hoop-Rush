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

The script also backfills altIds.bbref for players the roster-based mapping
never covered (pre-1986 seasons have no NBA.com rosters, so their players are
missing from .raw_nba_cache/bbref_ids.json). Matching runs against the cached
bbref index by normalized name plus a career window assembled from every pool
the player appears in; only unique matches are accepted, and the merged
mapping is written back to bbref_ids.json so future pool builds keep the ids.
photoUrl backfill (ensure_photos) always runs, regardless of whether the
nbaHeadshotAvailable markers are already present.

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

from _hoop_rush_import.config import PUBLIC_DATA, RAW_CACHE  # noqa: E402
from _hoop_rush_import.fetch_bbref_ids import normalize_name, overlaps  # noqa: E402
from _hoop_rush_import.fetch_nba_headshots import annotate_nba_headshots  # noqa: E402
from _hoop_rush_import.fetch_wikipedia_photos import ensure_photos  # noqa: E402
from _hoop_rush_import.util import read_cache  # noqa: E402

POOLS_DIR = PUBLIC_DATA / "pools"
BBREF_IDS_PATH = RAW_CACHE / "bbref_ids.json"
LETTERS = "abcdefghijklmnopqrstuvwxyz"


def pool_path(franchise_id: str, era_id: str) -> Path:
    return POOLS_DIR / f"{franchise_id}-{era_id}.json"


def write_pool(path: Path, pool: dict[str, Any]) -> None:
    path.write_text(json.dumps(pool, indent=2) + "\n", encoding="utf-8")


def load_bbref_index() -> list[dict[str, Any]]:
    """All cached bbref index entries, or [] when the fetch never ran."""
    entries: list[dict[str, Any]] = []
    for letter in LETTERS:
        cached = read_cache("bbref_index_v2", letter=letter)
        if cached is None:
            continue
        entries.extend(cached)
    return entries


def load_bbref_ids() -> dict[str, str]:
    if BBREF_IDS_PATH.exists():
        try:
            raw = json.loads(BBREF_IDS_PATH.read_text(encoding="utf-8"))
            return {str(k): str(v) for k, v in raw.items()}
        except Exception:
            return {}
    return {}


def season_end_year(season_key: str) -> int | None:
    try:
        return int(season_key[:4]) + 1
    except (ValueError, TypeError):
        return None


def career_years(pool_players: list[dict[str, Any]]) -> dict[str, set[int]]:
    """playerId -> observed NBA season end years across every pool."""
    years: dict[str, set[int]] = {}
    for player in pool_players:
        year = season_end_year(player.get("seasonKey") or "")
        if year is None:
            continue
        years.setdefault(player["playerId"], set()).add(year)
    return years


def match_bbref_ids(
    players: list[dict[str, Any]],
    index: list[dict[str, Any]],
    years: dict[str, set[int]],
) -> dict[str, str]:
    """externalId -> bbref id for pool players with no bbref id yet.

    Mirrors fetch_bbref_ids matching: full normalized name + career overlap,
    then unique last name + overlap, then unique full name. Only unique
    matches are accepted; ambiguous or missing names are left unmatched so
    ensure_photos falls through to Wikipedia.
    """
    mapping = load_bbref_ids()
    # Pool records may carry ids that the mapping lost in a rebuild; seed the
    # mapping from records so future pool builds keep them and no record is
    # re-matched against a possibly different candidate.
    for player in players:
        record_id = (player.get("altIds") or {}).get("bbref")
        external_id = str(player.get("playerExternalId", ""))
        if external_id and record_id:
            mapping.setdefault(external_id, str(record_id))
    by_name: dict[str, list[dict[str, Any]]] = {}
    by_last: dict[str, list[dict[str, Any]]] = {}
    for entry in index:
        key = normalize_name(entry["name"])
        by_name.setdefault(key, []).append(entry)
        by_last.setdefault(key.split()[-1] if key else key, []).append(entry)

    def unique(entries: list[dict[str, Any]]) -> dict[str, Any] | None:
        return entries[0] if len(entries) == 1 else None

    matched = 0
    ambiguous = 0
    for player in players:
        external_id = str(player.get("playerExternalId", ""))
        if not external_id or external_id in mapping:
            continue
        name = player.get("displayName") or ""
        key = normalize_name(name)
        if not key:
            continue
        observed = years.get(player["playerId"], set())

        candidate: dict[str, Any] | None = None

        candidates = [e for e in by_name.get(key, []) if overlaps(e, observed)]
        candidate = unique(candidates)

        if candidate is None:
            last_key = key.split()[-1]
            entries = [e for e in by_last.get(last_key, []) if overlaps(e, observed)]
            if unique(entries) is not None:
                candidate = unique(entries)

        if candidate is None:
            candidates = [e for e in by_name.get(key, [])]
            if unique(candidates) is not None:
                candidate = unique(candidates)

        if candidate is not None:
            mapping[external_id] = candidate["id"]
            player.setdefault("altIds", {})["bbref"] = candidate["id"]
            matched += 1
        else:
            ambiguous += 1

    if matched or ambiguous:
        BBREF_IDS_PATH.write_text(
            json.dumps(mapping, indent=2, sort_keys=True),
            encoding="utf-8",
        )
    return {"matched": matched, "unmatched": ambiguous}


def reannotate_pool(
    path: Path,
    index: list[dict[str, Any]],
    all_players: list[dict[str, Any]],
) -> tuple[int, int, int]:
    pool = json.loads(path.read_text(encoding="utf-8"))
    players = pool.get("players", [])
    if not players:
        return 0, 0, 0

    # nbaHeadshotAvailable is the authoritative marker for a completed asset
    # annotation (false is a valid value); photoUrl is legitimately null when
    # the bbref photo works.
    missing_marker = [
        p for p in players if (p.get("altIds") or {}).get("nbaHeadshotAvailable") is None
    ]
    missing_photo = [p for p in players if (p.get("altIds") or {}).get("photoUrl") is None]

    if missing_photo:
        match_bbref_ids(players, index, career_years(all_players))

    # These authoritative functions fill altIds in place, using the
    # .raw_nba_cache status caches and only touching the network for unknown
    # players. photoUrl is only resolved when the bbref photo is missing, so
    # players with a working bbref headshot keep photoUrl null.
    if missing_marker:
        annotate_nba_headshots(players)
    if missing_photo:
        ensure_photos(players)

    write_pool(path, pool)
    return len(players), len(missing_marker), len(missing_photo)


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

    index = load_bbref_index()
    print(f"  [OK] bbref index: {len(index)} cached entries")

    all_players: list[dict[str, Any]] = []
    for path in targets:
        if not path.exists():
            continue
        pool = json.loads(path.read_text(encoding="utf-8"))
        all_players.extend(pool.get("players", []))

    total_players = 0
    total_markers = 0
    total_photos = 0
    for path in targets:
        if not path.exists():
            print(f"  [SKIP] {path.name} not found")
            continue
        players, markers, photos = reannotate_pool(path, index, all_players)
        total_players += players
        total_markers += markers
        total_photos += photos
        print(
            f"  [OK] {path.name}: {players} players, "
            f"{markers} marker annotations, {photos} photoUrl pending"
        )
    print(
        f"done: {total_players} players across {len(targets)} pools, "
        f"{total_markers} marker annotations, {total_photos} photoUrl backfills"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
