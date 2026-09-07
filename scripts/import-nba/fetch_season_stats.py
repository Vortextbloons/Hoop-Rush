"""Fetch per-season player aggregate stats from nba_api.

Output: raw-data/nba/{season}/season-stats.json
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


def _nullable(value: Any) -> float | None:
    """Value or None when missing/NaN (spec/12: absent fields stay null)."""
    try:
        f = float(value)
    except (ValueError, TypeError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f

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


def clamp_unit(v: float | None) -> float | None:
    if v is None:
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return clamp(v, 0.0, 1.0)


def sanitize_shooting_totals(t: dict[str, Any]) -> None:
    """Stint aggregation can yield made > attempted; cap before deriving rates."""
    fga = float(t.get("fga") or 0.0)
    if fga > 0:
        t["fgm"] = min(float(t.get("fgm") or 0.0), fga)
    fta = float(t.get("fta") or 0.0)
    if fta > 0:
        t["ftm"] = min(float(t.get("ftm") or 0.0), fta)
    tpa = t.get("tpa")
    tpm = t.get("tpm")
    if tpa is not None and tpm is not None:
        tpa_f = float(tpa)
        if tpa_f > 0:
            t["tpm"] = min(float(tpm), tpa_f)


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
        row = {
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
                "tsPct": _nullable(a.get("TS_PCT")),
                "efgPct": _nullable(a.get("EFG_PCT")),
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
                "usageRate": _nullable(a.get("USG_PCT")) * 100 if a.get("USG_PCT") is not None else None,
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
        sanitize_shooting_totals(row)
        out.append(row)
    return out


def estimate_usage(fga: float, fta: float, tov: float, gp: int, pace: float = 95.0) -> float:
    """Approximate usage percentage from per-game box stats (era pace based)."""
    if gp == 0:
        return 0
    per_game = (fga + 0.44 * fta + tov) / gp
    return clamp(per_game / pace * 100, 0, 100)


def _coverage_ok(coverage: dict[str, Any], out_key: str, games: int) -> bool:
    """A family counts as a season total only when the source logged it in at
    least three-quarters of the player's games. Partial sums (e.g. FGA in 58
    of 81 games) look complete but produce fictional rates, while nulling errs
    toward conservative estimates downstream."""
    if games <= 0:
        return False
    try:
        present = float(coverage.get(out_key, games))
    except (ValueError, TypeError):
        return False
    return (present / games) >= 0.75


def _drop_inconsistent_shooting(t: dict[str, Any]) -> None:
    """Makes without matching attempts (or splits that contradict totals) mean
    the family is unobserved, not zero and not capped into fiction: capping
    fgm 973 to a partial fga 883 would invent a 1.000 efg."""
    for made, attempted in (("fgm", "fga"), ("ftm", "fta"), ("tpm", "tpa")):
        m = t.get(made)
        a = t.get(attempted)
        if m is None:
            continue
        try:
            mf, af = float(m), float(a) if a is not None else None
        except (ValueError, TypeError):
            t[made] = None
            continue
        if af is None or not math.isfinite(af) or af <= 0 or not math.isfinite(mf) or mf < 0:
            t[made] = None
            continue
        if mf > af:
            t[made] = None
            t[attempted] = None
    oreb = t.get("offensiveRebounds")
    dreb = t.get("defensiveRebounds")
    reb = t.get("rebounds")
    try:
        if (
            oreb is not None and dreb is not None and reb is not None
            and float(oreb) + float(dreb) < 0.5 * float(reb)
        ):
            t["offensiveRebounds"] = None
            t["defensiveRebounds"] = None
    except (ValueError, TypeError):
        t["offensiveRebounds"] = None
        t["defensiveRebounds"] = None


def stats_from_stints(season: str) -> list[dict[str, Any]]:
    """Build league-total season stats from aggregated team stints.

    LeagueDashPlayerStats returns no rows before 1996-97; team stints from
    game logs cover every player who appeared. Absent field families (steals/
    blocks before 1973-74, turnovers before 1977-78, rebound splits before
    1973-74, threes before 1979-80) stay None - never converted zeros.
    Advanced estimates are derived from whatever evidence exists and are
    marked `stints-derived` (spec/12 provenance).
    """
    from .config import NBA_ROOT

    stints_path = NBA_ROOT / season / "stints.json"
    if not stints_path.exists():
        return []

    totals: dict[str, dict[str, Any]] = {}
    for stint in json.loads(stints_path.read_text(encoding="utf-8")):
        pid = stint["playerExternalId"]
        row = totals.setdefault(pid, {})
        stint_games = int(stint.get("gamesPlayed") or 0)
        row["gamesPlayed"] = row.get("gamesPlayed", 0) + stint_games
        stint_coverage = stint.get("coverage") if isinstance(stint.get("coverage"), dict) else {}
        row_coverage = row.setdefault("_coverage", {})
        for key in ("minutes", "points", "rebounds", "offensiveRebounds",
                    "defensiveRebounds", "assists", "steals", "blocks",
                    "turnovers", "fouls", "fgm", "fga", "tpm", "tpa", "ftm", "fta"):
            value = stint.get(key)
            if value is None or value is False:
                continue
            try:
                f = float(value)
            except (ValueError, TypeError):
                continue
            if math.isnan(f) or math.isinf(f):
                continue
            row[key] = row.get(key, 0.0) + f
            try:
                covered = float(stint_coverage.get(key, stint_games))
            except (ValueError, TypeError):
                covered = float(stint_games)
            row_coverage[key] = row_coverage.get(key, 0.0) + covered

    def _num(t: dict[str, Any], key: str, default: float = 0.0) -> float:
        try:
            f = float(t.get(key, default))
        except (ValueError, TypeError):
            return default
        return f if math.isfinite(f) else default

    def _present(t: dict[str, Any], key: str) -> float | None:
        # A popped (R1/R2-nulled) key and a never-observed key look identical
        # here, and should: both mean the family is unobserved and must stay
        # null downstream so derivation estimates instead of trusting a zero.
        if key not in t:
            return None
        try:
            f = float(t[key])
        except (ValueError, TypeError):
            return None
        return f if math.isfinite(f) else None

    out: list[dict[str, Any]] = []
    for pid, t in totals.items():
        gp = int(t.get("gamesPlayed") or 0)
        if gp == 0:
            continue
        coverage = t.get("_coverage", {})
        if isinstance(coverage, dict):
            for key in ("minutes", "points", "rebounds", "offensiveRebounds",
                        "defensiveRebounds", "assists", "steals", "blocks",
                        "turnovers", "fouls", "fgm", "fga", "tpm", "tpa", "ftm", "fta"):
                if not _coverage_ok(coverage, key, gp):
                    t.pop(key, None)
        _drop_inconsistent_shooting(t)
        # Magnitude sanity: no real season exceeds ~1.1 points per minute
        # (Wilt's peak is ~1.04). Past 1.5 the minutes column is corrupt, not
        # the scoring line, so minutes go while points stay for per-game use.
        try:
            _min = float(t.get("minutes", 0.0) or 0.0)
            _pts = float(t.get("points", 0.0) or 0.0)
        except (ValueError, TypeError):
            _min, _pts = 0.0, 0.0
        if _min > 0 and (_pts / _min) > 1.5:
            t.pop("minutes", None)
        minutes = _present(t, "minutes")
        fga = _num(t, "fga")
        fta = _num(t, "fta")
        tpa = t.get("tpa")
        tpm = t.get("tpm")
        pts = _num(t, "points")
        rebounds = _present(t, "rebounds")
        assists = _present(t, "assists")
        fouls = _present(t, "fouls")
        fgm = _present(t, "fgm")
        ftm = _present(t, "ftm")
        stl = t.get("steals")
        blk = t.get("blocks")
        tov = t.get("turnovers")
        efg = (
            clamp_unit(((float(fgm) + 0.5 * (tpm or 0.0)) / fga))
            if fgm is not None and fga > 0 else None
        )
        ts = (
            clamp_unit((pts / (2 * (fga + 0.44 * fta))))
            if t.get("points") is not None and fga > 0 else None
        )
        out.append(
            {
                "playerExternalId": pid,
                "season": season,
                "teamExternalId": None,
                "gamesPlayed": gp,
                "minutes": minutes,
                "starts": 0,
                "points": _present(t, "points"),
                "rebounds": rebounds,
                "offensiveRebounds": t.get("offensiveRebounds"),
                "defensiveRebounds": t.get("defensiveRebounds"),
                "assists": assists,
                "steals": stl,
                "blocks": blk,
                "turnovers": tov,
                "fouls": fouls,
                "fgm": fgm,
                "fga": _present(t, "fga"),
                "tpm": tpm,
                "tpa": tpa,
                "ftm": ftm,
                "fta": _present(t, "fta"),
                "tsPct": ts,
                "efgPct": efg,
                "per": estimate_per(
                    pts, rebounds or 0.0, assists or 0.0, stl or 0.0,
                    blk or 0.0, tov or 0.0, fga, fta, 0, gp,
                ),
                "usageRate": estimate_usage(fga, fta, tov or 0.0, gp) if fga > 0 else None,
                "winShares": 0,
                "boxPlusMinus": estimate_bpm(
                    pts, rebounds or 0.0, assists or 0.0, stl or 0.0,
                    blk or 0.0, tov or 0.0, fga, fta, gp,
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
