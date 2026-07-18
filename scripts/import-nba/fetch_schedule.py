"""Fetch NBA schedule for a given season.

Output: public/data/nba/{season}/schedule.json
"""

from __future__ import annotations

import sys
from typing import Any

from .config import ensure_output_dir
from .util import read_cache, with_retry, write_cache, write_json

try:
    from nba_api.stats.endpoints import scheduleleaguev2
except Exception as exc:  # pragma: no cover - import-time guard
    print(
        f"Could not import nba_api: {exc}\n"
        "Install with: pip install -r scripts/import_nba/requirements.txt",
        file=sys.stderr,
    )
    raise


def fetch_schedule(season: str) -> list[dict[str, Any]]:
    cached = read_cache("schedule", season=season)
    if cached is not None:
        return cached

    def _do_fetch() -> list[dict[str, Any]]:
        schedule = scheduleleaguev2.ScheduleLeagueV2(season=season)
        data = schedule.get_dict()
        games: list[dict[str, Any]] = []
        for game in data.get("leagueSchedule", {}).get("gameList", []):
            games.append({
                "gameId": game.get("gameId", ""),
                "homeTeamId": game.get("homeTeam", {}).get("teamId", ""),
                "awayTeamId": game.get("awayTeam", {}).get("teamId", ""),
            })
        return games

    games = with_retry(_do_fetch)
    write_cache("schedule", games, season=season)
    return games


def run(season: str) -> None:
    out = ensure_output_dir(season)
    print(f"[{season}] fetching schedule")
    games = fetch_schedule(season)
    write_json(out / "schedule.json", {
        "season": season,
        "games": games,
    })
    print(f"  [OK] wrote {len(games)} games")
