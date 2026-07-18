"""Compute league-average era config per season.

Reads season-stats.json (produced by fetch_season_stats) and writes a small
era-config.json next to it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import NBA_ROOT
from .util import write_json


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def compute_for_season(season: str) -> dict[str, Any]:
    path = NBA_ROOT / season / "season-stats.json"
    if not path.exists():
        return {"season": season, "pace": 95, "league3PARate": 0.25, "leagueTsPct": 0.55, "leaguePpg": 105, "possessionCoefficient": 1.0}

    rows = _read(path)
    if not rows:
        return {"season": season, "pace": 95, "league3PARate": 0.25, "leagueTsPct": 0.55, "leaguePpg": 105, "possessionCoefficient": 1.0}

    valid = [r for r in rows if r.get("gamesPlayed", 0) > 0]
    if not valid:
        return {"season": season, "pace": 95, "league3PARate": 0.25, "leagueTsPct": 0.55, "leaguePpg": 105, "possessionCoefficient": 1.0}

    total_fga = sum(r.get("fga", 0) for r in valid)
    total_3pa = sum(r.get("tpa", 0) for r in valid)
    total_pts = sum(r.get("points", 0) for r in valid)
    total_games = sum(r.get("gamesPlayed", 0) for r in valid)
    total_teams = max(1, total_games / 82) if total_games else 30

    league_3pa_rate = (total_3pa / total_fga) if total_fga else 0.3
    league_ppg = (total_pts / total_games) if total_games else 100
    avg_ts = sum(r.get("tsPct", 0) for r in valid) / len(valid)

    out = {
        "season": season,
        "pace": 100.0,
        "league3PARate": round(league_3pa_rate, 3),
        "leagueTsPct": round(avg_ts, 3),
        "leaguePpg": round(league_ppg, 1),
        "possessionCoefficient": 1.0,
        "playerCount": len(valid),
        "teamCount": int(total_teams),
    }
    return out


def run(seasons: list[str]) -> None:
    for season in seasons:
        cfg = compute_for_season(season)
        path = NBA_ROOT / season / "era-config.json"
        write_json(path, cfg)
        print(f"[{season}] wrote era-config.json")
