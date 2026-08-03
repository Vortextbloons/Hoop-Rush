"""Re-annotate packaged pools with headshot asset data.

One-time repair for pool builds that ran without the asset annotation step
(--no-assets, or a silent annotation failure): every player lost
altIds.nbaHeadshotAvailable and altIds.photoUrl, leaving the UI stuck on the
NBA CDN's generic silhouette for players without a real CDN headshot.

Runs in two phases:

1. Offline: backfill altIds.bbref for players the roster-based mapping never
   covered (pre-1986 seasons have no NBA.com rosters, so their players are
   missing from .raw_nba_cache/bbref_ids.json). Matching runs against the
   cached bbref index by normalized name plus a career window assembled from
   every pool the player appears in; only unique matches are accepted, and
   the merged mapping is written back to bbref_ids.json so future pool builds
   keep the ids.

2. Network, concurrent: resolve photoUrl for every player still missing one.
   Both status caches are loaded into memory once and shared across a worker
   pool (--workers, default 6); per-host rate limits are enforced by shared
   limiters so concurrency never exceeds the intended requests-per-second.
   Caches are flushed periodically and on interrupt via atomic writes, so a
   stopped run only loses work since the last flush and resumes from cache.

nbaHeadshotAvailable markers are only re-annotated when absent (false is a
valid value); photoUrl is legitimately null when the bbref photo works.

Usage:
    python scripts/import-nba/reannotate_assets.py               # all pools
    python scripts/import-nba/reannotate_assets.py --workers 8
    python scripts/import-nba/reannotate_assets.py lakers 1990s  # one pool
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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
from _hoop_rush_import.fetch_wikipedia_photos import (  # noqa: E402
    flush_photos,
    load_bbref_status,
    load_wikipedia_photos,
    resolve_photo,
)
from _hoop_rush_import.util import read_cache  # noqa: E402

POOLS_DIR = PUBLIC_DATA / "pools"
BBREF_IDS_PATH = RAW_CACHE / "bbref_ids.json"
LETTERS = "abcdefghijklmnopqrstuvwxyz"
DEFAULT_WORKERS = 6
FLUSH_EVERY = 200


def pool_path(franchise_id: str, era_id: str) -> Path:
    return POOLS_DIR / f"{franchise_id}-{era_id}.json"


def ensure_alt_ids(player: dict[str, Any]) -> dict[str, Any]:
    """Return a mutable altIds dict; packaged pools may carry altIds: null."""
    alt_ids = player.get("altIds")
    if not isinstance(alt_ids, dict):
        alt_ids = {}
        player["altIds"] = alt_ids
    return alt_ids


def write_pool(path: Path, pool: dict[str, Any]) -> None:
    text = json.dumps(pool, indent=2) + "\n"
    tmp = path.with_suffix(path.suffix + ".tmp")
    for attempt in range(12):
        try:
            tmp.write_text(text, encoding="utf-8")
            os.replace(tmp, path)
            return
        except OSError:
            if attempt == 11:
                raise
            time.sleep(0.2 * (attempt + 1))


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


def save_bbref_ids(mapping: dict[str, str]) -> None:
    tmp = BBREF_IDS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(mapping, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(BBREF_IDS_PATH)


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
    the photo phase falls through to Wikipedia.
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
            ensure_alt_ids(player)["bbref"] = candidate["id"]
            matched += 1
        else:
            ambiguous += 1

    if matched or ambiguous:
        save_bbref_ids(mapping)
    return mapping


def load_pools(targets: list[Path]) -> dict[str, dict[str, Any]]:
    pools: dict[str, dict[str, Any]] = {}
    for path in targets:
        if path.exists():
            pools[path.name] = json.loads(path.read_text(encoding="utf-8"))
    return pools


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("targets", nargs="*", help="franchiseId eraId pairs; default: all pools")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help="photo worker count")
    parser.add_argument(
        "--retry-wikipedia",
        action="store_true",
        help="retry empty Wikipedia cache entries and add cached Wikipedia photos even when other fallbacks exist",
    )
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
    pools = load_pools(targets)
    all_players: list[dict[str, Any]] = []
    for path in targets:
        all_players.extend(pools.get(path.name, {}).get("players", []))
    years = career_years(all_players)

    # Phase 1 (offline): bbref id backfill + marker annotation.
    total_players = 0
    total_markers = 0
    for path in targets:
        pool = pools.get(path.name)
        if not pool:
            print(f"  [SKIP] {path.name} not found")
            continue
        players = pool.get("players", [])
        if not players:
            continue
        missing_marker = [
            p for p in players if (p.get("altIds") or {}).get("nbaHeadshotAvailable") is None
        ]
        mapping = match_bbref_ids(players, index, years)
        applied = 0
        for player in players:
            if (player.get("altIds") or {}).get("bbref"):
                continue
            record_id = mapping.get(str(player.get("playerExternalId", "")))
            if record_id:
                ensure_alt_ids(player)["bbref"] = record_id
                applied += 1
        if missing_marker:
            annotate_nba_headshots(players, workers=args.workers)
        total_players += len(players)
        total_markers += len(missing_marker)
        if applied or missing_marker:
            print(
                f"  [OK] {path.name}: {len(players)} players, "
                f"{len(missing_marker)} marker annotations, {applied} bbref ids applied"
            )

    # Phase 2 (network, concurrent): resolve photoUrl.
    pending: list[tuple[str, dict[str, Any]]] = []
    for path in targets:
        pool = pools.get(path.name)
        if not pool:
            continue
        for player in pool.get("players", []):
            if args.retry_wikipedia or (player.get("altIds") or {}).get("photoUrl") is None:
                pending.append((path.name, player))
    print(f"  [OK] {len(pending)} players need photoUrl ({args.workers} workers)")

    if pending:
        status_cache = load_bbref_status()
        photo_cache = load_wikipedia_photos()
        cache_lock = threading.Lock()
        done = 0
        interrupt = False

        def work(item: tuple[str, dict[str, Any]]) -> None:
            _, player = item
            photo = resolve_photo(
                player["playerExternalId"],
                player["displayName"],
                (player.get("altIds") or {}).get("bbref"),
                status_cache,
                photo_cache,
                cache_lock,
                args.retry_wikipedia,
            )
            ensure_alt_ids(player)["photoUrl"] = photo

        executor = ThreadPoolExecutor(max_workers=max(1, args.workers))
        try:
            futures = [executor.submit(work, item) for item in pending]
            for future in as_completed(futures):
                future.result()
                done += 1
                if done % FLUSH_EVERY == 0:
                    flush_photos(status_cache, photo_cache)
                    print(f"    [progress] {done}/{len(pending)} photos resolved, caches flushed")
        except KeyboardInterrupt:
            interrupt = True
            executor.shutdown(wait=False, cancel_futures=True)
        else:
            executor.shutdown(wait=True)

        flush_photos(status_cache, photo_cache)
        print(
            f"  [OK] resolved {done}/{len(pending)} photos"
            + (" (interrupted; re-run resumes from cache)" if interrupt else "")
        )

    # Persist pools once, after both phases.
    for path in targets:
        pool = pools.get(path.name)
        if not pool:
            continue
        write_pool(path, pool)
        players = pool.get("players", [])
        with_photo = sum(1 for p in players if (p.get("altIds") or {}).get("photoUrl"))
        with_bbref = sum(1 for p in players if (p.get("altIds") or {}).get("bbref"))
        print(
            f"  [OK] {path.name}: {len(players)} players, "
            f"{with_photo} with photo, {with_bbref} with bbref id"
        )

    print(f"done: {total_players} players across {len(targets)} pools")
    return 130 if interrupt else 0


if __name__ == "__main__":
    sys.exit(main())
