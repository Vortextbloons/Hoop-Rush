"""Fetch per-season player aggregate stats from nba_api.

Output: apps/web/static/data/nba/{season}/season-stats.json
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

from .config import ensure_output_dir
from .util import read_cache, with_retry, write_cache, write_json


REQUIRED_MEASURE_TYPES = ("Base", "Advanced")


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
        "Install with: pip install -r scripts/import-nba/requirements.txt",
        file=sys.stderr,
    )
    raise


def fetch_league_dash(season: str) -> list[dict[str, Any]]:
    """Fetch only datasets consumed by rating derivation.

    Each measure is cached independently so a later failure never forces already
    successful requests to be repeated. The old aggregate cache remains readable.
    """
    cached = read_cache("league_dash_player_stats", season=season)
    if cached is not None:
        by_type = {item.get("measureType"): item for item in cached}
        if all(measure in by_type for measure in REQUIRED_MEASURE_TYPES):
            return [by_type[measure] for measure in REQUIRED_MEASURE_TYPES]

    out: list[dict[str, Any]] = []
    for measure_type in REQUIRED_MEASURE_TYPES:
        measure_cached = read_cache(
            "league_dash_player_stats_measure",
            season=season,
            measure=measure_type,
        )
        if measure_cached is not None:
            out.append(measure_cached)
            continue

        def _do_fetch(measure: str = measure_type) -> dict[str, Any]:
            resp = leaguedashplayerstats.LeagueDashPlayerStats(
                season=season,
                measure_type_detailed_defense=measure,
                per_mode_detailed="PerGame",
            )
            df = resp.get_data_frames()[0]
            return {
                "measureType": measure,
                "rows": jsonable_rows(df),
            }

        result = with_retry(_do_fetch)
        write_cache(
            "league_dash_player_stats_measure",
            result,
            season=season,
            measure=measure_type,
        )
        out.append(result)

    write_cache("league_dash_player_stats", out, season=season)
    return out


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
    base_by_id = {
        str(r["PLAYER_ID"]): r
        for r in base["rows"]
        if r.get("PLAYER_ID") is not None and not (isinstance(r.get("PLAYER_ID"), float) and math.isnan(r["PLAYER_ID"]))
    }
    adv_by_id = {
        str(r["PLAYER_ID"]): r
        for r in (adv["rows"] if adv else [])
        if r.get("PLAYER_ID") is not None and not (isinstance(r.get("PLAYER_ID"), float) and math.isnan(r["PLAYER_ID"]))
    }
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


def estimate_usage(fga: float, fta: float, tov: float, gp: int, pace: float = 95.0) -> float:
    """Approximate usage percentage from per-game box stats (era pace based)."""
    if gp == 0:
        return 0
    per_game = (fga + 0.44 * fta + tov) / gp
    return clamp(per_game / pace * 100, 0, 100)


def stats_from_stints(season: str) -> list[dict[str, Any]]:
    """Build league-total season stats from aggregated team stints.

    LeagueDashPlayerStats returns no rows for some early-90s seasons; team
    stints from game logs cover every player who appeared.
    """
    from .config import NBA_ROOT

    stints_path = NBA_ROOT / season / "stints.json"
    if not stints_path.exists():
        return []

    totals: dict[str, dict[str, float]] = {}
    for stint in json.loads(stints_path.read_text(encoding="utf-8")):
        pid = stint["playerExternalId"]
        row = totals.setdefault(pid, {})
        for key in ("gamesPlayed", "minutes", "points", "rebounds", "assists", "steals",
                    "blocks", "turnovers", "fouls", "fgm", "fga", "tpm", "tpa", "ftm", "fta"):
            row[key] = row.get(key, 0) + float(stint.get(key, 0))

    out: list[dict[str, Any]] = []
    for pid, t in totals.items():
        gp = int(t["gamesPlayed"])
        if gp == 0:
            continue
        minutes = t["minutes"]
        fga = t["fga"]
        fta = t["fta"]
        tpa = t["tpa"]
        pts = t["points"]
        out.append(
            {
                "playerExternalId": pid,
                "season": season,
                "teamExternalId": None,
                "gamesPlayed": gp,
                "minutes": minutes,
                "starts": 0,
                "points": pts,
                "rebounds": t["rebounds"],
                "offensiveRebounds": 0,
                "defensiveRebounds": t["rebounds"],
                "assists": t["assists"],
                "steals": t["steals"],
                "blocks": t["blocks"],
                "turnovers": t["turnovers"],
                "fouls": t["fouls"],
                "fgm": t["fgm"],
                "fga": fga,
                "tpm": t["tpm"],
                "tpa": tpa,
                "ftm": t["ftm"],
                "fta": fta,
                "tsPct": (pts / (2 * (fga + 0.44 * fta))) if (fga + fta) > 0 else 0.0,
                "efgPct": ((t["fgm"] + 0.5 * t["tpm"]) / fga) if fga > 0 else 0.0,
                "per": estimate_per(
                    pts, t["rebounds"], t["assists"], t["steals"], t["blocks"],
                    t["turnovers"], fga, fta, 0, gp,
                ),
                "usageRate": estimate_usage(fga, fta, t["turnovers"], gp),
                "winShares": 0,
                "boxPlusMinus": estimate_bpm(
                    pts, t["rebounds"], t["assists"], t["steals"], t["blocks"],
                    t["turnovers"], fga, fta, gp,
                ),
                "vorp": 0,
                "statsSource": "stints-derived",
            }
        )
    return out


def run(season: str, roster: list[dict[str, Any]]) -> None:
    out = ensure_output_dir(season)
    print(f"[{season}] fetching season stats")
    payload = fetch_league_dash(season)
    rows = to_player_season_stats(payload, season, roster)
    if not rows:
        rows = stats_from_stints(season)
        if rows:
            print(f"  [WARN] league dash empty for {season}; using stint-derived stats")
    write_json(out / "season-stats.json", rows)
    print(f"  [OK] wrote season-stats.json ({len(rows)} players)")
