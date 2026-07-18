"""Compute career stats by reading all season-stats.json files.

Output: public/data/nba/{season}/career-stats.json

This replaces the per-player API loop with instant computation.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import NBA_ROOT, DEFAULT_SEASONS, ensure_output_dir
from .util import read_json, write_json


def compute_career_stats(seasons: list[str] | None = None) -> None:
    """Read all season-stats.json files, group by player, write career stats."""
    if seasons is None:
        seasons = DEFAULT_SEASONS

    career_map: dict[str, dict[str, Any]] = {}

    for season in seasons:
        season_path = NBA_ROOT / season / "season-stats.json"
        if not season_path.exists():
            continue
        stats = read_json(season_path)
        for player_stat in stats:
            pid = player_stat.get("playerExternalId") or player_stat.get("playerId", "")
            if not pid:
                continue
            if pid not in career_map:
                career_map[pid] = {"playerExternalId": pid, "seasons": []}
            career_map[pid]["seasons"].append(player_stat)

    for season in seasons:
        roster_path = NBA_ROOT / season / "roster.json"
        if not roster_path.exists():
            continue
        roster = read_json(roster_path)
        player_ids = {p.get("externalId") or p.get("id", "") for p in roster}
        careers = [career_map[pid] for pid in player_ids if pid in career_map]
        out = ensure_output_dir(season)
        write_json(out / "career-stats.json", careers)
        print(f"  [OK] computed {len(careers)} career stat files for {season}")


def run(seasons: list[str] | None = None) -> None:
    """Compatibility wrapper for run_all.py."""
    print("[careers] computing career stats from season data")
    compute_career_stats(seasons)
