"""Fetch per-season player aggregate stats from nba_api.

Output: public/data/nba/{season}/season-stats.json
"""

from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any

from .config import ensure_output_dir
from .util import rate_limit_sleep, read_cache, with_retry, write_cache, write_json


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return default
        return int(f)
    except (ValueError, TypeError):
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (ValueError, TypeError):
        return default

try:
    from nba_api.stats.endpoints import leaguedashplayerstats
except Exception as exc:  # pragma: no cover
    print(
        f"Could not import nba_api: {exc}\n"
        "Install with: pip install -r scripts/import_nba/requirements.txt",
        file=sys.stderr,
    )
    raise


def fetch_league_dash(season: str) -> list[dict[str, Any]]:
    cached = read_cache("league_dash_player_stats", season=season)
    if cached is not None:
        return cached

    def _do_fetch() -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for measure_type in ("Base", "Advanced", "Scoring", "Usage", "Defense"):
            rate_limit_sleep()
            resp = leaguedashplayerstats.LeagueDashPlayerStats(
                season=season,
                measure_type_detailed_defense=measure_type,
                per_mode_detailed="PerGame",
            )
            df = resp.get_data_frames()[0]
            out.append(
                {
                    "measureType": measure_type,
                    "rows": jsonable_rows(df),
                }
            )
        return out

    payload = with_retry(_do_fetch)
    write_cache("league_dash_player_stats", payload, season=season)
    return payload


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def jsonable_rows(df: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        rows.append({k: (None if (hasattr(v, "item") and not isinstance(v, (list, dict))) else v) for k, v in row.to_dict().items()})
    return rows


def estimate_per(pts: float, reb: float, ast: float, stl: float, blk: float, tov: float,
                  fga: float, fta: float, oreb: float, gp: int) -> float:
    """Estimate PER from box score stats (Hollinger-style)."""
    if gp == 0:
        return 0
    ppg = pts / gp
    rpg = reb / gp
    apg = ast / gp
    spg = stl / gp
    bpg = blk / gp
    topg = tov / gp
    fg2a = max(0, fga - (fta * 0.44) - 0)
    # Hollinger PER rough estimate
    per = (ppg + rpg * 1.2 + apg * 1.5 + spg * 2 + bpg * 2 - topg * 1.5) / 2
    return clamp(per, 0, 40)


def estimate_bpm(pts: float, reb: float, ast: float, stl: float, blk: float,
                  tov: float, fga: float, fta: float, gp: int) -> float:
    """Estimate BPM from box score stats."""
    if gp == 0:
        return 0
    ppg = pts / gp
    rpg = reb / gp
    apg = ast / gp
    spg = stl / gp
    bpg = blk / gp
    topg = tov / gp
    # Simple BPM: league avg contribution is ~0, stars are +5 to +10
    bpm = ppg * 0.12 + rpg * 0.15 + apg * 0.2 + spg * 1.8 + bpg * 1.8 - topg * 0.7 - 4
    return clamp(bpm, -8, 15)


def to_player_season_stats(payload: list[dict[str, Any]], season: str, roster: list[dict[str, Any]]) -> list[dict[str, Any]]:
    base = next((p for p in payload if p["measureType"] == "Base"), None)
    adv = next((p for p in payload if p["measureType"] == "Advanced"), None)
    if base is None:
        return []
    base_by_id = {str(r["PLAYER_ID"]): r for r in base["rows"]}
    adv_by_id = {str(r["PLAYER_ID"]): r for r in (adv["rows"] if adv else [])}
    roster_by_id = {str(p["externalId"]): p for p in roster}

    out: list[dict[str, Any]] = []
    for ext_id, b in base_by_id.items():
        a = adv_by_id.get(ext_id, {})
        rp = roster_by_id.get(ext_id, {})
        gp = _safe_int(b.get("GP"))
        out.append(
            {
                "playerExternalId": ext_id,
                "season": season,
                "teamExternalId": str(b.get("TEAM_ID") or (rp.get("teamExternalId") or "")) or None,
                "gamesPlayed": gp,
                "minutes": _safe_float(b.get("MIN")) * gp,
                "starts": _safe_int(b.get("GS")),
                "points": _safe_float(b.get("PTS")) * gp,
                "rebounds": _safe_float(b.get("REB")) * gp,
                "offensiveRebounds": _safe_float(b.get("OREB")) * gp,
                "defensiveRebounds": _safe_float(b.get("DREB")) * gp,
                "assists": _safe_float(b.get("AST")) * gp,
                "steals": _safe_float(b.get("STL")) * gp,
                "blocks": _safe_float(b.get("BLK")) * gp,
                "turnovers": _safe_float(b.get("TOV")) * gp,
                "fouls": _safe_float(b.get("PF")) * gp,
                "fgm": _safe_float(b.get("FGM")) * gp,
                "fga": _safe_float(b.get("FGA")) * gp,
                "tpm": _safe_float(b.get("FG3M")) * gp,
                "tpa": _safe_float(b.get("FG3A")) * gp,
                "ftm": _safe_float(b.get("FTM")) * gp,
                "fta": _safe_float(b.get("FTA")) * gp,
                "tsPct": _safe_float(a.get("TS_PCT")),
                "efgPct": _safe_float(a.get("EFG_PCT")),
                "per": _safe_float(a.get("PER")) or estimate_per(
                    _safe_float(b.get("PTS")) * gp,
                    _safe_float(b.get("REB")) * gp,
                    _safe_float(b.get("AST")) * gp,
                    _safe_float(b.get("STL")) * gp,
                    _safe_float(b.get("BLK")) * gp,
                    _safe_float(b.get("TOV")) * gp,
                    _safe_float(b.get("FGA")) * gp,
                    _safe_float(b.get("FTA")) * gp,
                    _safe_float(b.get("OREB")) * gp,
                    gp,
                ),
                "usageRate": _safe_float(a.get("USG_PCT")) * 100 if a.get("USG_PCT") is not None else 0,
                "winShares": _safe_float(a.get("WS")),
                "boxPlusMinus": _safe_float(a.get("BPM")) or estimate_bpm(
                    _safe_float(b.get("PTS")) * gp,
                    _safe_float(b.get("REB")) * gp,
                    _safe_float(b.get("AST")) * gp,
                    _safe_float(b.get("STL")) * gp,
                    _safe_float(b.get("BLK")) * gp,
                    _safe_float(b.get("TOV")) * gp,
                    _safe_float(b.get("FGA")) * gp,
                    _safe_float(b.get("FTA")) * gp,
                    gp,
                ),
                "vorp": _safe_float(a.get("VORP")),
            }
        )
    return out


def run(season: str, roster: list[dict[str, Any]]) -> None:
    out = ensure_output_dir(season)
    print(f"[{season}] fetching season stats")
    payload = fetch_league_dash(season)
    rows = to_player_season_stats(payload, season, roster)
    write_json(out / "season-stats.json", rows)
    print(f"  [OK] wrote season-stats.json ({len(rows)} players)")
