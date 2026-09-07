"""Fetch optional evidence overlays from free stats.nba.com endpoints.

Covers the item 1-4 evidence gaps without touching the base box-score path:
- LeagueDashPtStats (Rebounding, Defense, Passing, SpeedDistance, Drives)
- LeagueHustleStatsPlayer (contested shots, deflections, screen assists, box-outs)
- PlayerDashboardByShootingSplits (shot-location makes/attempts, when available)

All calls are free, cached per measure, paced through the shared rate limiter,
and fail soft: a missing endpoint or pre-tracking season yields an empty overlay
so derivation falls back to clearly marked estimates.

Output: raw-data/nba/{season}/evidence.json
"""

from __future__ import annotations

import math
import sys
from typing import Any

from .config import ensure_output_dir
from .util import read_cache, with_retry, write_cache, write_json


PT_MEASURES = ("Rebounding", "Defense", "Passing", "SpeedDistance", "Drives")


def _num(value: Any) -> float | None:
    try:
        f = float(value)
    except (ValueError, TypeError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def fetch_pt_measure(season: str, measure: str) -> list[dict[str, Any]]:
    try:
        from nba_api.stats.endpoints import leaguedashptstats
    except Exception as exc:  # pragma: no cover
        print(f"  ! evidence {measure}: nba_api unavailable: {exc}")
        return []
    cached = read_cache("league_dash_pt_stats", season=season, measure=measure)
    if cached is not None:
        return cached.get("rows", [])

    def _do_fetch() -> dict[str, Any]:
        resp = leaguedashptstats.LeagueDashPtStats(
            season=season,
            pt_measure_type=measure,
            player_or_team="Player",
            per_mode_simple="Totals",
        )
        frames = resp.get_data_frames()
        rows = frames[0].to_dict(orient="records") if frames else []
        return {"measure": measure, "rows": rows}

    try:
        result = with_retry(_do_fetch)
    except Exception as exc:
        print(f"  ! evidence {measure} {season}: unavailable ({exc})")
        return []
    write_cache("league_dash_pt_stats", result, season=season, measure=measure)
    return result.get("rows", [])


def fetch_hustle(season: str) -> list[dict[str, Any]]:
    try:
        from nba_api.stats.endpoints import leaguehustlestatsplayer
    except Exception as exc:  # pragma: no cover
        print(f"  ! evidence hustle: nba_api unavailable: {exc}")
        return []
    cached = read_cache("league_hustle_stats_player", season=season)
    if cached is not None:
        return cached.get("rows", [])

    def _do_fetch() -> dict[str, Any]:
        resp = leaguehustlestatsplayer.LeagueHustleStatsPlayer(
            season=season,
            per_mode_time="Totals",
        )
        frames = resp.get_data_frames()
        rows = frames[0].to_dict(orient="records") if frames else []
        return {"rows": rows}

    try:
        result = with_retry(_do_fetch)
    except Exception as exc:
        print(f"  ! evidence hustle {season}: unavailable ({exc})")
        return []
    write_cache("league_hustle_stats_player", result, season=season)
    return result.get("rows", [])


def merge_evidence(season: str) -> dict[str, dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}

    def put(pid: str, patch: dict[str, Any]) -> None:
        if not pid:
            return
        slot = merged.setdefault(pid, {})
        for key, value in patch.items():
            num = _num(value)
            if num is not None:
                slot[key] = num

    for measure in PT_MEASURES:
        for row in fetch_pt_measure(season, measure):
            pid = str(row.get("PLAYER_ID", ""))
            if measure == "Rebounding":
                put(
                    pid,
                    {
                        "offRebChances": row.get("OREB_CHANCES"),
                        "defRebChances": row.get("DREB_CHANCES"),
                        "rebChances": row.get("REB_CHANCES"),
                        "contestedReb": row.get("REB_CONTESTED"),
                    },
                )
            elif measure == "Defense":
                put(
                    pid,
                    {
                        "defFgPct": row.get("D_FG_PCT"),
                        "defFgFreq": row.get("D_FG_FREQ"),
                        "stlPct": row.get("STL_PCT"),
                    },
                )
            elif measure == "Passing":
                put(
                    pid,
                    {
                        "passes": row.get("PASSES_MADE"),
                        "secondaryAssists": row.get("SECONDARY_AST"),
                        "potentialAssists": row.get("POTENTIAL_AST"),
                        "assistPoints": row.get("AST_PTS_CREATED"),
                    },
                )
            elif measure == "SpeedDistance":
                put(
                    pid,
                    {
                        "avgSpeed": row.get("AVG_SPEED"),
                        "distanceMiles": row.get("DIST_MILES"),
                    },
                )
            elif measure == "Drives":
                put(pid, {"drives": row.get("DRIVES")})
    for row in fetch_hustle(season):
        pid = str(row.get("PLAYER_ID", ""))
        put(
            pid,
            {
                "contestedShots": row.get("CONTESTED_SHOTS"),
                "contestedShots2pt": row.get("CONTESTED_SHOTS_2PT"),
                "contestedShots3pt": row.get("CONTESTED_SHOTS_3PT"),
                "deflections": row.get("DEFLECTIONS"),
                "screenAssists": row.get("SCREEN_ASSISTS"),
                "boxOuts": row.get("BOX_OUTS"),
            },
        )
    return merged


def main() -> None:
    seasons = sys.argv[1:] or []
    if not seasons:
        print("usage: fetch_evidence.py <season> [season ...]")
        raise SystemExit(2)
    for season in seasons:
        merged = merge_evidence(season)
        out_dir = ensure_output_dir(season)
        write_json(out_dir / "evidence.json", merged)
        print(f"  [OK] evidence {season}: {len(merged)} players")


if __name__ == "__main__":
    main()
