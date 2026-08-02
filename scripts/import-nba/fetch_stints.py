"""Fetch league-wide player game logs and aggregate team stints.

Eligibility for franchise/decade pools uses games played for the franchise
stint, not league totals (spec/02). PlayerGameLogs returns every player-game
for a season; grouping by (player, team) produces exact stint rows.

Output: raw-data/nba/{season}/stints.json
"""

from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any

from .config import ensure_output_dir
from .util import read_cache, with_retry, write_cache, write_json

try:
    from nba_api.stats.endpoints.playergamelogs import PlayerGameLogs
except Exception as exc:  # pragma: no cover
    print(
        f"Could not import nba_api: {exc}\n"
        "Install with: pip install -r scripts/import-nba/requirements.txt",
        file=sys.stderr,
    )
    raise

AGGREGATE_KEYS = (
    "MIN", "PTS", "REB", "OREB", "DREB", "AST", "STL", "BLK",
    "TOV", "PF", "FGM", "FGA", "FG3M", "FG3A", "FTM", "FTA",
)

# Output key naming matches season-stats.json so pools share one mapping.
OUTPUT_KEY: dict[str, str] = {
    "MIN": "minutes", "PTS": "points", "REB": "rebounds", "OREB": "offensiveRebounds",
    "DREB": "defensiveRebounds", "AST": "assists", "STL": "steals", "BLK": "blocks",
    "TOV": "turnovers", "PF": "fouls", "FGM": "fgm", "FGA": "fga",
    "FG3M": "tpm", "FG3A": "tpa", "FTM": "ftm", "FTA": "fta",
}


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (ValueError, TypeError):
        return default


def fetch_game_logs(season: str) -> list[dict[str, Any]]:
    cached = read_cache("player_game_logs", season=season)
    if cached is not None:
        return cached

    def _do_fetch() -> list[dict[str, Any]]:
        # Regular season only: eligibility is a 40-game regular-season rule.
        resp = PlayerGameLogs(season_nullable=season, season_type_nullable="Regular Season")
        df = resp.get_data_frames()[0]
        rows: list[dict[str, Any]] = []
        for _, row in df.iterrows():
            rows.append({k: row[k] for k in df.columns})
        return rows

    logs = with_retry(_do_fetch)
    write_cache("player_game_logs", logs, season=season)
    return logs


def _clean_id(value: Any) -> str:
    """Normalize a pandas-sourced id to its integer string form."""
    try:
        return str(int(float(value)))
    except (TypeError, ValueError):
        return str(value)


def _real(value: Any) -> float | None:
    """Float value or None when the cell is missing/NaN (spec/12: absent
    fields must never be converted to zero)."""
    if value is None:
        return None
    try:
        f = float(value)
    except (ValueError, TypeError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def aggregate_stints(logs: list[dict[str, Any]], season: str) -> list[dict[str, Any]]:
    """Group game logs by (player, team) into stint totals.

    Field families that are absent across all of a stint's games stay None
    (e.g. steals/blocks before 1973-74, turnovers before 1977-78, threes
    before 1979-80); per-row missingness within an available family sums
    the present rows.
    """
    stints: dict[tuple[str, str], dict[str, Any]] = {}
    for game in logs:
        pid = _clean_id(game.get("PLAYER_ID"))
        tid = _clean_id(game.get("TEAM_ID"))
        if not pid or not tid or pid == "0" or tid == "0":
            continue
        key = (pid, tid)
        stint = stints.setdefault(key, {"playerExternalId": pid, "teamExternalId": tid})
        stint["gamesPlayed"] = int(stint.get("gamesPlayed", 0)) + 1
        for k in AGGREGATE_KEYS:
            value = _real(game.get(k))
            if value is None:
                continue
            counts = stint.setdefault("_counts", {})
            counts[k] = counts.get(k, 0) + 1
            stint[k] = round(float(stint.get(k, 0.0)) + value, 1)

    out: list[dict[str, Any]] = []
    for key, stint in sorted(stints.items()):
        row: dict[str, Any] = {
            "season": season,
            "playerExternalId": key[0],
            "teamExternalId": key[1],
            "gamesPlayed": stint["gamesPlayed"],
        }
        counts: dict[str, int] = stint.get("_counts", {})
        for k in AGGREGATE_KEYS:
            out_key = OUTPUT_KEY[k]
            if k in stint:
                row[out_key] = stint[k]
            else:
                # Absent family: keep null, never a converted zero.
                row[out_key] = None
        out.append(row)
    return out


def compute_for_season(season: str, force: bool = False) -> None:
    out = ensure_output_dir(season)
    stints_path = out / "stints.json"
    if stints_path.exists() and not force:
        return
    print(f"[{season}] fetching game logs")
    logs = fetch_game_logs(season)
    stints = aggregate_stints(logs, season)
    write_json(stints_path, stints)
    print(f"  [OK] wrote stints.json ({len(stints)} player-team stints)")


def run(seasons: list[str] | None = None, force: bool = False) -> None:
    from .config import DEFAULT_SEASONS

    if seasons is None:
        seasons = DEFAULT_SEASONS
    print("[stints] aggregating player-team stints from game logs")
    for season in seasons:
        compute_for_season(season, force=force)
