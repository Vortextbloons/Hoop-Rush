"""Compute packaged franchise-era pools (spec/02 fast-load artifact).

Pipeline:
  roster.json (ratings/positions) + stints.json (team-stint accounting)
  + season-stats.json (league totals) + manifest lineage/eras
  -> eligible peak player-seasons per (franchise, era)
  -> compact FranchiseEraPool JSON + manifest pool index with content hashes

Usage:
  python -m scripts.import-nba.compute_pools --pools lakers/1990s
  python -m scripts.import-nba.compute_pools --all
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from .config import NBA_ROOT, PUBLIC_DATA, RAW_CACHE, TEAM_FOUNDING_SEASON, ensure_output_dir
from .util import read_json, write_json

POOL_DIR = PUBLIC_DATA / "pools"
MANIFEST_PATH = PUBLIC_DATA / "manifest.json"

SCHEMA_VERSION = 1
POSITION_NORMALIZATION_VERSION = "position-v1"
RATINGS_VERSION = "ratings-v7-simulation-anchors"
SELECTION_SCORE_VERSION = "selection-v1"
MIN_TEAM_GAMES = 40
DATA_VERSION = "m1.6"

# ---------------------------------------------------------------------------
# Position normalization (spec/02)
# ---------------------------------------------------------------------------
POSITION_LABEL_MAP: dict[str, list[str]] = {
    "G": ["G"], "F": ["F"], "C": ["C"],
    "G-F": ["G", "F"], "F-G": ["G", "F"],
    "F-C": ["F", "C"], "C-F": ["F", "C"],
    "G-C": ["G", "C"], "C-G": ["G", "C"],
    "G-F-C": ["G", "F", "C"], "F-G-C": ["F", "G", "C"],
    "PG": ["G"], "SG": ["G"], "SF": ["F"], "PF": ["F"],
    "": [],
}


def normalize_position_labels(labels: set[str]) -> tuple[list[str], list[str], list[str]]:
    """Return (canonical, sourceLabels, unknownLabels) for a set of labels."""
    canonical: set[str] = set()
    known: list[str] = []
    unknown: list[str] = []
    for label in sorted(labels):
        mapped = POSITION_LABEL_MAP.get(label)
        if mapped is None:
            unknown.append(label)
            continue
        known.append(label)
        canonical.update(mapped)
    return sorted(canonical), known, unknown


# ---------------------------------------------------------------------------
# Career position unions (cached; scans every packaged roster once)
# ---------------------------------------------------------------------------
def load_career_position_labels() -> dict[str, set[str]]:
    # The cache is derived from the packaged roster snapshot. Version the
    # filename so older imports cannot silently erase positions for players
    # added in a later snapshot.
    cache_path = RAW_CACHE / "career-position-labels-v2.json"
    if cache_path.exists():
        return {
            pid: set(labels)
            for pid, labels in json.loads(cache_path.read_text(encoding="utf-8")).items()
        }

    labels_by_player: dict[str, set[str]] = {}
    season_dirs = sorted(p for p in NBA_ROOT.iterdir() if p.is_dir())
    for season_dir in season_dirs:
        roster_path = season_dir / "roster.json"
        if not roster_path.exists():
            continue
        roster = read_json(roster_path)
        for player in roster:
            pid = str(player.get("externalId", ""))
            if not pid:
                continue
            labels_by_player.setdefault(pid, set()).add(str(player.get("position", "")))

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(
        json.dumps({pid: sorted(labels) for pid, labels in labels_by_player.items()}),
        encoding="utf-8",
    )
    print(f"  [OK] career position labels for {len(labels_by_player)} players (cached)")
    return labels_by_player


# ---------------------------------------------------------------------------
# Manifest helpers
# ---------------------------------------------------------------------------
def load_manifest() -> dict[str, Any]:
    return read_json(MANIFEST_PATH)


def season_to_era(eras: list[dict[str, Any]], season: str) -> str | None:
    for era in eras:
        if era["fromSeasonKey"] <= season <= era["toSeasonKey"]:
            return era["eraId"]
    return None


# ---------------------------------------------------------------------------
# Per-season loading
# ---------------------------------------------------------------------------
def load_season_data(season: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Return (rosterByExtId, stintsByTeam, statsByPlayer) for a season."""
    season_dir = NBA_ROOT / season
    roster_by_id: dict[str, Any] = {}
    for player in read_json(season_dir / "roster.json"):
        roster_by_id[str(player.get("externalId", ""))] = player

    stints_by_team: dict[str, list[dict[str, Any]]] = {}
    stints_path = season_dir / "stints.json"
    if stints_path.exists():
        for stint in read_json(stints_path):
            stints_by_team.setdefault(str(stint["teamExternalId"]), []).append(stint)

    stats_by_player: dict[str, Any] = {}
    stats_path = season_dir / "season-stats.json"
    if stats_path.exists():
        for row in read_json(stats_path):
            stats_by_player[str(row.get("playerExternalId", ""))] = row

    return roster_by_id, stints_by_team, stats_by_player


# ---------------------------------------------------------------------------
# Record building
# ---------------------------------------------------------------------------
def build_stats(season_stats: dict[str, Any]) -> dict[str, Any]:
    def num(key: str, default: float = 0.0) -> float:
        value = season_stats.get(key, default)
        try:
            f = float(value)
            if f != f:  # NaN
                return default
            return f
        except (TypeError, ValueError):
            return default

    def nullable(key: str) -> float | None:
        value = season_stats.get(key)
        if value is None:
            return None
        try:
            f = float(value)
            if f != f:
                return None
            return f
        except (TypeError, ValueError):
            return None

    return {
        "gamesPlayed": int(num("gamesPlayed")),
        "minutes": int(num("minutes")),
        "points": int(num("points")),
        "rebounds": int(num("rebounds")),
        "offensiveRebounds": int(num("offensiveRebounds")),
        "defensiveRebounds": int(num("defensiveRebounds")),
        "assists": int(num("assists")),
        "steals": int(num("steals")),
        "blocks": int(num("blocks")),
        "turnovers": int(num("turnovers")),
        "fieldGoalsMade": int(num("fgm")),
        "fieldGoalsAttempted": int(num("fga")),
        "threesMade": int(num("tpm")),
        "threesAttempted": int(num("tpa")),
        "freeThrowsMade": int(num("ftm")),
        "freeThrowsAttempted": int(num("fta")),
        "per": nullable("per"),
        "boxPlusMinus": nullable("boxPlusMinus"),
        "usageRate": nullable("usageRate"),
        "tsPct": nullable("tsPct"),
        "efgPct": nullable("efgPct"),
    }


def selection_score(
    summary: dict[str, int], usage_rate: float | None, team_minutes: int, team_games: int
) -> float:
    """selection-v1: rating blend plus availability-weighted production context."""
    usage = min(max(float(usage_rate or 0), 0), 40.0)
    mpg = min((team_minutes / max(1, team_games)), 48.0)
    return round(
        0.5 * summary["overallRating"]
        + 0.3 * summary["offenseRating"]
        + 0.2 * summary["defenseRating"]
        + 0.05 * usage
        + 0.02 * mpg,
        3,
    )


def _candidate_key(candidate: dict[str, Any]) -> tuple[float, int, int, int]:
    """Peak tie-break order: selectionScore, team minutes, team games, earlier season."""
    stint = candidate["stint"]
    summary = candidate["player"]["summaryRatings"]
    season_start = int(candidate["season"].split("-")[0])
    return (
        selection_score(
            summary,
            candidate["stats"].get("usageRate"),
            int(stint.get("minutes", 0)),
            int(stint["gamesPlayed"]),
        ),
        int(stint.get("minutes", 0)),
        int(stint["gamesPlayed"]),
        -season_start,
    )


def load_bbref_ids() -> dict[str, str]:
    """External NBA id -> Basketball-Reference id (fetch_bbref_ids.py output)."""
    path = RAW_CACHE / "bbref_ids.json"
    if not path.exists():
        print("  [WARN] bbref_ids.json missing; run fetch_bbref_ids or run_all (no altIds)")
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def compute_pool(
    franchise_id: str,
    era_id: str,
    manifest: dict[str, Any],
    bbref_ids: dict[str, str] | None = None,
    with_assets: bool = True,
) -> dict[str, Any]:
    if bbref_ids is None:
        bbref_ids = load_bbref_ids()
    lineage = next(
        (e for e in manifest["franchiseLineage"] if e["franchiseId"] == franchise_id), None
    )
    if lineage is None:
        raise SystemExit(f"unknown franchiseId {franchise_id}")
    era = next((e for e in manifest["eras"] if e["eraId"] == era_id), None)
    if era is None:
        raise SystemExit(f"unknown eraId {era_id}")

    team_external_id = lineage["teamExternalId"]
    seasons = sorted(
        season
        for season in (p.name for p in NBA_ROOT.iterdir() if p.is_dir())
        if era["fromSeasonKey"] <= season <= era["toSeasonKey"]
    )
    if not seasons:
        raise SystemExit(f"no seasons available for {franchise_id} {era_id}")

    print(f"[{franchise_id} {era_id}] scanning {len(seasons)} seasons")
    career_labels = load_career_position_labels()

    eligible: dict[str, list[dict[str, Any]]] = {}
    roster_by_season: dict[str, dict[str, Any]] = {}
    missing_stints: list[str] = []

    for season in seasons:
        roster, stints_by_team, stats_by_player = load_season_data(season)
        roster_by_season[season] = roster
        stints = stints_by_team.get(team_external_id, [])
        if not stints and any(p.get("teamExternalId") == team_external_id for p in roster.values()):
            missing_stints.append(season)

        for stint in stints:
            games = int(stint.get("gamesPlayed", 0))
            if games < MIN_TEAM_GAMES:
                continue
            pid = stint["playerExternalId"]
            player = roster.get(pid)
            if player is None:
                continue
            stats = stats_by_player.get(pid)
            if stats is None or int(stats.get("gamesPlayed", 0)) == 0:
                continue
            summary = player.get("summaryRatings")
            if summary is None:
                print(f"  ! {pid} missing summaryRatings in {season}; re-run compute_ratings")
                continue
            eligible.setdefault(pid, []).append(
                {
                    "season": season,
                    "player": player,
                    "stint": stint,
                    "stats": stats,
                }
            )

    if missing_stints:
        print(f"  [WARN] no stints for {franchise_id} in: {', '.join(missing_stints)}")

    players_out: list[dict[str, Any]] = []
    for pid in sorted(eligible):
        candidates = eligible[pid]
        best = max(candidates, key=_candidate_key)

        player = best["player"]
        stint = best["stint"]
        stats = best["stats"]
        summary = player["summaryRatings"]
        labels = career_labels.get(pid, set()) or {str(player.get("position", ""))}
        canonical, known_labels, unknown_labels = normalize_position_labels(labels)
        if unknown_labels:
            print(f"  [WARN] {player.get('firstName', '')} {player.get('lastName', '')} ({pid}) unknown position labels: {unknown_labels}")

        players_out.append(
            {
                "schemaVersion": SCHEMA_VERSION,
                "playerId": f"p-{pid}",
                "franchiseId": franchise_id,
                "eraId": era_id,
                "seasonKey": best["season"],
                "firstName": player.get("firstName", ""),
                "lastName": player.get("lastName", ""),
                "displayName": f"{player.get('firstName', '')} {player.get('lastName', '')}".strip(),
                "playerExternalId": pid,
                "altIds": {"bbref": bbref_ids[pid]} if pid in bbref_ids else None,
                "positions": {
                    "sourceLabels": known_labels,
                    "canonical": canonical,
                    "normalizationVersion": POSITION_NORMALIZATION_VERSION,
                },
                "heightInches": player.get("heightInches"),
                "weightLbs": player.get("weightLbs"),
                "eligibility": {
                    "minimumTeamGames": MIN_TEAM_GAMES,
                    "teamGames": int(stint["gamesPlayed"]),
                    "teamMinutes": int(stint.get("minutes", 0)),
                },
                "selectionScore": selection_score(
                    summary, stats.get("usageRate"), int(stint.get("minutes", 0)), int(stint["gamesPlayed"])
                ),
                "selectionScoreVersion": SELECTION_SCORE_VERSION,
                "stats": build_stats(stats),
                "summaryRatings": {
                    "overallRating": summary["overallRating"],
                    "offenseRating": summary["offenseRating"],
                    "defenseRating": summary["defenseRating"],
                },
                "detailedRatings": {
                    k: int(v) for k, v in player.get("ratings", {}).items()
                    if isinstance(v, (int, float))
                },
                "tendencies": {k: float(v) for k, v in player.get("tendencies", {}).items()},
                "dataConfidence": (
                    "derived-medium"
                    if stats.get("statsSource") == "stints-derived"
                    else "observed"
                    if stats.get("boxPlusMinus") is not None
                    else "derived-medium"
                ),
                "source": {
                    "dataVersion": DATA_VERSION,
                    "ratingsVersion": RATINGS_VERSION,
                    "selectionScoreVersion": SELECTION_SCORE_VERSION,
                },
            }
        )

    if not players_out:
        print(
            f"  [SKIP] no eligible players for {franchise_id} {era_id} "
            f"(no packaged stints for team {lineage['teamExternalId']} in era seasons)"
        )
        return None

    if with_assets:
        try:
            from .fetch_nba_headshots import annotate_nba_headshots
            from .fetch_wikipedia_photos import ensure_photos

            annotate_nba_headshots(players_out)
            ensure_photos(players_out)
        except Exception as exc:  # noqa: BLE001 - photos are best-effort, never fail a build
            print(f"  [WARN] headshot annotation failed: {exc}")

    pool = {
        "schemaVersion": SCHEMA_VERSION,
        "dataVersion": DATA_VERSION,
        "franchiseId": franchise_id,
        "eraId": era_id,
        "eligibility": {"minimumTeamGames": MIN_TEAM_GAMES},
        "players": players_out,
    }
    return pool


def write_pool(pool: dict[str, Any]) -> str:
    POOL_DIR.mkdir(parents=True, exist_ok=True)
    path = POOL_DIR / f"{pool['franchiseId']}-{pool['eraId']}.json"
    write_json(path, pool)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    print(f"  [OK] wrote {path.name} ({len(pool['players'])} players, {digest[:12]}…)")
    return digest


def update_manifest(entries: list[dict[str, str]]) -> None:
    manifest = load_manifest()
    manifest["dataVersion"] = DATA_VERSION
    for lineage in manifest["franchiseLineage"]:
        lineage.setdefault("firstNbaSeasonKey", TEAM_FOUNDING_SEASON.get(lineage["teamExternalId"]))
    existing = {f"{e['franchiseId']}/{e['eraId']}": e for e in manifest["pools"]}
    for entry in entries:
        key = f"{entry['franchiseId']}/{entry['eraId']}"
        existing[key] = entry
    manifest["pools"] = [existing[k] for k in sorted(existing)]
    write_json(MANIFEST_PATH, manifest)
    print(f"  [OK] manifest updated: {len(manifest['pools'])} pools, dataVersion {DATA_VERSION}")


def parse_pool_targets(raw: list[str]) -> list[tuple[str, str]]:
    targets: list[tuple[str, str]] = []
    for item in raw:
        parts = item.split("/")
        if len(parts) != 2 or not all(parts):
            raise SystemExit(f"invalid pool target {item!r} (expected franchiseId/eraId)")
        targets.append((parts[0], parts[1]))
    return targets


def run(targets: list[tuple[str, str]] | None = None, with_assets: bool = True) -> None:
    if targets is None:
        targets = [("lakers", "1990s")]
    manifest = load_manifest()
    bbref_ids = load_bbref_ids()
    entries: list[dict[str, str]] = []
    for franchise_id, era_id in targets:
        pool = compute_pool(franchise_id, era_id, manifest, bbref_ids, with_assets)
        if pool is None:
            continue
        digest = write_pool(pool)
        entries.append(
            {
                "franchiseId": franchise_id,
                "eraId": era_id,
                "url": f"pools/{franchise_id}-{era_id}.json",
                "contentHash": digest,
            }
        )
    update_manifest(entries)


def main() -> None:
    parser = argparse.ArgumentParser(description="Compute franchise-era pools")
    parser.add_argument(
        "--pools", nargs="+", default=["lakers/1990s"],
        help="franchiseId/eraId targets (default lakers/1990s)",
    )
    parser.add_argument(
        "--all", action="store_true", help="compute every available (franchise, era) combination",
    )
    parser.add_argument(
        "--no-assets", action="store_true",
        help="skip per-player headshot/photo network annotation (altIds fields omitted)",
    )
    args = parser.parse_args()

    if args.all:
        manifest = load_manifest()
        packaged_seasons = {p.name for p in NBA_ROOT.iterdir() if p.is_dir()}
        targets = [
            (entry["franchiseId"], era["eraId"])
            for entry in manifest["franchiseLineage"]
            for era in manifest["eras"]
            if any(era["fromSeasonKey"] <= s <= era["toSeasonKey"] for s in packaged_seasons)
            and (not entry.get("firstNbaSeasonKey") or entry["firstNbaSeasonKey"] <= era["toSeasonKey"])
        ]
    else:
        targets = parse_pool_targets(args.pools)
    run(targets, with_assets=not args.no_assets)


if __name__ == "__main__":
    main()
