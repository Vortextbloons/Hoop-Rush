"""Build the compact global players index (Sandbox search asset).

Pipeline:
  manifest.json (pool index) + packaged FranchiseEraPool JSON
  -> players-index.json: one compact row per player, in pool order
     (pools sorted by franchiseId/eraId for determinism)
  -> manifest playersIndex entry with content hash + dataVersion bump

The index lets the browser search every franchise-era pool (118 files,
~18 MB) with a single compact asset. Rows only carry the fields the Sandbox
search and lineup builder need: identity, canonical positions, summary
ratings, and selectionScore.

Usage:
    python -m scripts.import-nba.compute_players_index
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path
from typing import Any

from .config import PUBLIC_DATA
from .util import read_json, write_json

POOLS_DIR = PUBLIC_DATA / "pools"
MANIFEST_PATH = PUBLIC_DATA / "manifest.json"
INDEX_PATH = PUBLIC_DATA / "players-index.json"

SCHEMA_VERSION = 1
DATA_VERSION = "m1.8"
INDEX_FILENAME = "players-index.json"

CANONICAL_POSITIONS = {"G", "F", "C"}


def pool_path(franchise_id: str, era_id: str) -> Path:
    return POOLS_DIR / f"{franchise_id}-{era_id}.json"


def build_row(player: dict[str, Any], franchise_id: str, era_id: str) -> dict[str, Any] | None:
    """Return the compact index row for a player, or None (with a warning) when
    a required source field is missing or malformed."""
    required = [
        "playerId", "eraId", "seasonKey", "firstName", "lastName",
        "displayName", "playerExternalId", "selectionScore",
    ]
    for key in required:
        if player.get(key) is None:
            name = f"{player.get('firstName', '')} {player.get('lastName', '')}".strip()
            print(f"  [WARN] {franchise_id}/{era_id} {name or player.get('playerId', '?')} missing '{key}'")
            return None

    alt_ids = player.get("altIds")
    if alt_ids is not None and not isinstance(alt_ids, dict):
        print(
            f"  [WARN] {franchise_id}/{era_id} {player['firstName']} {player['lastName']} "
            f"altIds is not an object: {type(alt_ids).__name__}"
        )
        return None

    positions = player.get("positions")
    canonical = positions.get("canonical") if isinstance(positions, dict) else None
    if not isinstance(canonical, list) or not all(p in CANONICAL_POSITIONS for p in canonical):
        print(
            f"  [WARN] {franchise_id}/{era_id} {player['firstName']} {player['lastName']} "
            f"positions.canonical invalid: {canonical!r}"
        )
        return None

    ratings = player.get("summaryRatings")
    if not isinstance(ratings, dict):
        print(
            f"  [WARN] {franchise_id}/{era_id} {player['firstName']} {player['lastName']} "
            "summaryRatings missing"
        )
        return None
    try:
        overall = int(ratings["overallRating"])
        offense = int(ratings["offenseRating"])
        defense = int(ratings["defenseRating"])
    except (KeyError, TypeError, ValueError):
        print(
            f"  [WARN] {franchise_id}/{era_id} {player['firstName']} {player['lastName']} "
            "summaryRatings invalid"
        )
        return None

    return {
        "playerId": player["playerId"],
        "franchiseId": franchise_id,
        "eraId": era_id,
        "seasonKey": player["seasonKey"],
        "firstName": player["firstName"],
        "lastName": player["lastName"],
        "displayName": player["displayName"],
        "playerExternalId": player["playerExternalId"],
        "altIds": alt_ids,
        "positionsCanonical": list(canonical),
        "overall": overall,
        "offense": offense,
        "defense": defense,
        "selectionScore": player["selectionScore"],
    }


def build_index() -> dict[str, Any]:
    manifest = read_json(MANIFEST_PATH)
    pool_entries = sorted(manifest.get("pools", []), key=lambda e: (e["franchiseId"], e["eraId"]))

    rows: list[dict[str, Any]] = []
    skipped = 0
    for entry in pool_entries:
        franchise_id = entry.get("franchiseId")
        era_id = entry.get("eraId")
        if not franchise_id or not era_id:
            print(f"  [WARN] pool entry missing franchiseId/eraId: {entry}")
            skipped += 1
            continue
        path = pool_path(franchise_id, era_id)
        if not path.exists():
            print(f"  [WARN] {path.name} not found; skipping pool")
            skipped += 1
            continue
        pool = read_json(path)
        players = pool.get("players")
        if not isinstance(players, list):
            print(f"  [WARN] {path.name} has no players list; skipping pool")
            skipped += 1
            continue
        for player in players:
            row = build_row(player, franchise_id, era_id)
            if row is None:
                skipped += 1
                continue
            rows.append(row)

    index = {
        "schemaVersion": SCHEMA_VERSION,
        "dataVersion": DATA_VERSION,
        "players": rows,
    }
    return index


def write_index(index: dict[str, Any]) -> str:
    write_json(INDEX_PATH, index)
    digest = hashlib.sha256(INDEX_PATH.read_bytes()).hexdigest()
    print(f"  [OK] wrote {INDEX_FILENAME} ({len(index['players'])} players, {digest[:12]}…)")
    return digest


def update_manifest(digest: str) -> None:
    manifest = read_json(MANIFEST_PATH)
    manifest["dataVersion"] = DATA_VERSION
    manifest["playersIndex"] = {
        "url": INDEX_FILENAME,
        "contentHash": digest,
    }
    write_json(MANIFEST_PATH, manifest)
    # The packaged manifest ends with a trailing newline; write_json does not.
    with open(MANIFEST_PATH, "a", encoding="utf-8") as fh:
        fh.write("\n")
    print(f"  [OK] manifest updated: playersIndex {digest[:12]}…, dataVersion {DATA_VERSION}")


def run() -> None:
    index = build_index()
    digest = write_index(index)
    update_manifest(digest)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the global players index asset")
    args = parser.parse_args()
    try:
        run()
    except Exception as exc:  # noqa: BLE001 - CLI reports and exits nonzero
        print(f"players index build failed: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
