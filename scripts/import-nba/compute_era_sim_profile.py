"""Build-time derivation of the versioned 1990s era simulation profile.

M2 scope: the profile is derived from the decade's packaged source data
(`apps/web/static/data/nba/<season>/stints.json` per season, plus the packaged
Lakers 1990s pool for population anchor ratings and shot-mix priors).

Output: `apps/web/static/data/era-sim/1990s.json` (EraSimulationProfile).

Targets are emitted as initial estimates from the same source aggregates with
wide tolerances; the M2 calibration baseline freezes the final gates.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "apps" / "web" / "static" / "data"
OUT_DIR = DATA_DIR / "era-sim"
POOL_PATH = DATA_DIR / "pools" / "lakers-1990s.json"
SEASONS = [
    "1990-91",
    "1991-92",
    "1992-93",
    "1993-94",
    "1994-95",
    "1995-96",
    "1996-97",
    "1997-98",
    "1998-99",
    "1999-00",
]
PROFILE_VERSION = "m2-1990s-v1"
DATA_VERSION = "m1.0"


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def derive_league_aggregates():
    sums = {
        "fga": 0.0, "fgm": 0.0, "tpa": 0.0, "tpm": 0.0,
        "fta": 0.0, "ftm": 0.0, "oreb": 0.0, "dreb": 0.0,
        "ast": 0.0, "stl": 0.0, "tov": 0.0, "pf": 0.0, "pts": 0.0,
        "player_games": 0.0,
    }
    for season in SEASONS:
        stints = load_json(DATA_DIR / "nba" / season / "stints.json")
        for stint in stints:
            sums["fga"] += stint.get("fga", 0)
            sums["fgm"] += stint.get("fgm", 0)
            sums["tpa"] += stint.get("tpa", 0)
            sums["tpm"] += stint.get("tpm", 0)
            sums["fta"] += stint.get("fta", 0)
            sums["ftm"] += stint.get("ftm", 0)
            sums["oreb"] += stint.get("offensiveRebounds", 0)
            sums["dreb"] += stint.get("defensiveRebounds", 0)
            sums["ast"] += stint.get("assists", 0)
            sums["stl"] += stint.get("steals", 0)
            sums["tov"] += stint.get("turnovers", 0)
            sums["pf"] += stint.get("fouls", 0)
            sums["pts"] += stint.get("points", 0)
            sums["player_games"] += stint.get("gamesPlayed", 0)

    # Each game contributes ~20 player-games (ten players per team), so
    # player_games / 20 approximates the number of NBA games. Total possessions
    # per team-game is the league pace; per-game totals use the same denominator.
    team_games = max(1.0, sums["player_games"] / 10.0)
    possessions = sums["fga"] + 0.44 * sums["fta"] - sums["oreb"] + sums["tov"]
    return {
        "team_games": team_games,
        "possessions": possessions,
        "points": sums["pts"],
        "fga": sums["fga"],
        "fgm": sums["fgm"],
        "tpa": sums["tpa"],
        "tpm": sums["tpm"],
        "fta": sums["fta"],
        "ftm": sums["ftm"],
        "oreb": sums["oreb"],
        "dreb": sums["dreb"],
        "ast": sums["ast"],
        "stl": sums["stl"],
        "tov": sums["tov"],
        "pf": sums["pf"],
    }


def pool_shot_mix_and_anchors():
    pool = load_json(POOL_PATH)
    players = pool["players"]
    total_usage = sum(p["tendencies"].get("usageRate", 0) for p in players) or 1.0
    zones = ["rimFrequency", "shortMidFrequency", "longMidFrequency",
             "cornerThreeFrequency", "aboveBreakThreeFrequency"]
    weighted = {z: sum(p["tendencies"].get(z, 0) * p["tendencies"].get("usageRate", 0) for p in players) / total_usage for z in zones}
    total = sum(weighted.values()) or 1.0
    mix = {
        "rim": round(weighted["rimFrequency"] / total, 4),
        "shortMid": round(weighted["shortMidFrequency"] / total, 4),
        "longMid": round(weighted["longMidFrequency"] / total, 4),
        "cornerThree": round(weighted["cornerThreeFrequency"] / total, 4),
        "aboveBreakThree": round(weighted["aboveBreakThreeFrequency"] / total, 4),
    }
    ft_mean = sum(p["detailedRatings"].get("freeThrow", 50) for p in players) / len(players)
    pass_mean = sum(p["detailedRatings"].get("passing", 50) for p in players) / len(players)
    return mix, round(ft_mean), round(pass_mean)


def target(value, tolerance, minimum_sample=200):
    return {"value": round(value, 4), "tolerance": tolerance, "minimumSample": minimum_sample}


def main():
    a = derive_league_aggregates()
    mix, ft_anchor, pass_anchor = pool_shot_mix_and_anchors()

    pace = a["possessions"] / a["team_games"]  # per team per game
    ppg = a["points"] / a["team_games"]
    ts_pct = a["points"] / (2.0 * a["possessions"])
    fg_pct = a["fgm"] / max(1.0, a["fga"])
    efg_pct = (a["fgm"] + 0.5 * a["tpm"]) / max(1.0, a["fga"])
    three_rate = a["tpa"] / max(1.0, a["fga"])
    three_pct = a["tpm"] / max(1.0, a["tpa"])
    fta_per_fga = a["fta"] / max(1.0, a["fga"])
    ft_pct = a["ftm"] / max(1.0, a["fta"])
    tov_per_poss = a["tov"] / max(1.0, a["possessions"])
    steal_share = a["stl"] / max(1.0, a["tov"])
    oreb_rate = a["oreb"] / max(1.0, a["oreb"] + a["dreb"])
    assist_rate = a["ast"] / max(1.0, a["fgm"])
    fouls_per_poss = a["pf"] / max(1.0, a["possessions"])
    oreb_per_game = a["oreb"] / a["team_games"]
    ast_per_game = a["ast"] / a["team_games"]
    tov_per_game = a["tov"] / a["team_games"]
    fta_per_game = a["fta"] / a["team_games"]
    pf_per_game = a["pf"] / a["team_games"]

    profile = {
        "schemaVersion": 1,
        "eraId": "1990s",
        "profileVersion": PROFILE_VERSION,
        "dataVersion": DATA_VERSION,
        "seasons": SEASONS,
        "baselineReport": "derived from packaged 1990s stints; targets frozen after m2 calibration baseline",
        "parameters": {
            "pace": round(pace, 3),
            "league3PARate": round(three_rate, 4),
            "leagueTsPct": round(ts_pct, 4),
            "leagueFtaPerFga": round(fta_per_fga, 4),
            "leagueFtPct": round(ft_pct, 4),
            "turnoverPerPossession": round(tov_per_poss, 4),
            "stealShareOfTurnovers": round(steal_share, 4),
            "offensiveReboundRate": round(oreb_rate, 4),
            "assistRate": round(assist_rate, 4),
            "foulsPerPossession": round(fouls_per_poss, 4),
            "shootingFoulShare": 0.55,  # documented estimate; not derivable from box scores
            "freeThrowAnchorRating": ft_anchor,
            "assistAnchorRating": pass_anchor,
            "zoneMix": mix,
            "source": "packaged stints 1990-91..1999-00 + Lakers 1990s pool rating anchors",
        },
        "targets": {
            "possessionsPerGame": target(pace, 3),
            "pointsPerGame": target(ppg, 5),
            "offensiveRating": target(ppg / (pace / 100.0), 5),
            "fieldGoalPct": target(fg_pct, 0.02),
            "efgPct": target(efg_pct, 0.02),
            "tsPct": target(ts_pct, 0.02),
            "threePointRate": target(three_rate, 0.02),
            "threePointPct": target(three_pct, 0.02),
            "freeThrowsAttemptedPerGame": target(fta_per_game, 3),
            "freeThrowPct": target(ft_pct, 0.02),
            "turnoversPerGame": target(tov_per_game, 1.5),
            "turnoversPerPossession": target(tov_per_poss, 0.012),
            "offensiveReboundsPerGame": target(oreb_per_game, 1.5),
            "offensiveReboundRate": target(oreb_rate, 0.02),
            "assistsPerGame": target(ast_per_game, 2.5),
            "assistRate": target(assist_rate, 0.03),
            "personalFoulsPerGame": target(pf_per_game, 2.5),
            "zoneMix": {
                "rim": target(mix["rim"], 0.02),
                "shortMid": target(mix["shortMid"], 0.02),
                "longMid": target(mix["longMid"], 0.02),
                "cornerThree": target(mix["cornerThree"], 0.015),
                "aboveBreakThree": target(mix["aboveBreakThree"], 0.02),
            },
            "closeGameRate": target(0.18, 0.04, 2000),
            "blowoutRate": target(0.12, 0.04, 2000),
            "overtimeRate": target(0.06, 0.02, 2000),
            "strongVsWeakWinRate": target(0.88, 0.07, 2000),
            "equalLineupHomeWinRate": target(0.5, 0.05, 2000),
        },
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "1990s.json"
    with out.open("w", encoding="utf-8") as fh:
        json.dump(profile, fh, indent=2)
        fh.write("\n")
    print(f"wrote {out}")
    print(f"pace={pace:.2f} ppg={ppg:.2f} ts={ts_pct:.3f} ftaPerFga={fta_per_fga:.3f} "
          f"tovPp={tov_per_poss:.3f} stealShare={steal_share:.3f} orebRate={oreb_rate:.3f} "
          f"astRate={assist_rate:.3f} foulsPp={fouls_per_poss:.3f} ftAnchor={ft_anchor} passAnchor={pass_anchor}")


if __name__ == "__main__":
    main()
