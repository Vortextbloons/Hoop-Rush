"""Build-time derivation of era simulation profiles.

Each profile is derived from the era's raw packaged season data
(`raw-data/nba/<season>/stints.json` per season), plus the packaged Lakers pool
for that era, which provides population anchor ratings and shot-mix priors.

Output: `apps/web/static/data/era-sim/<era>.json` (EraSimulationProfile).

Targets are emitted as initial estimates from the same source aggregates with
wide tolerances; the calibration baseline freezes the final gates.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "apps" / "web" / "static" / "data"
OUT_DIR = DATA_DIR / "era-sim"
NBA_DIR = ROOT / "raw-data" / "nba"
POOLS_DIR = DATA_DIR / "pools"
MANIFEST_PATH = DATA_DIR / "manifest.json"
PROFILE_VERSION_PREFIX = "m3"
DATA_VERSION = "m1.6"


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def packaged_seasons() -> list[str]:
    return sorted(p.name for p in NBA_DIR.iterdir() if p.is_dir())


def era_seasons(era: dict[str, str]) -> list[str]:
    return [
        season
        for season in packaged_seasons()
        if era["fromSeasonKey"] <= season <= era["toSeasonKey"]
    ]


def eras_with_data() -> list[dict[str, str]]:
    manifest = load_json(MANIFEST_PATH)
    return [era for era in manifest["eras"] if era_seasons(era)]


def derive_league_aggregates(seasons: list[str]):
    sums = {
        "fga": 0.0, "fgm": 0.0, "tpa": 0.0, "tpm": 0.0,
        "fta": 0.0, "ftm": 0.0, "oreb": 0.0, "dreb": 0.0,
        "ast": 0.0, "stl": 0.0, "tov": 0.0, "pf": 0.0, "pts": 0.0,
        "player_games": 0.0,
    }
    for season in seasons:
        stints = load_json(NBA_DIR / season / "stints.json")
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


def pool_shot_mix_and_anchors(era_id: str):
    pool_path = POOLS_DIR / f"lakers-{era_id}.json"
    if not pool_path.exists():
        raise SystemExit(f"anchor pool missing: {pool_path} (run compute_pools first)")
    pool = load_json(pool_path)
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


def compute_era_profile(era: dict[str, str]) -> dict[str, object]:
    era_id = era["eraId"]
    seasons = era_seasons(era)
    if not seasons:
        raise SystemExit(f"no packaged seasons for era {era_id}")

    a = derive_league_aggregates(seasons)
    mix, ft_anchor, pass_anchor = pool_shot_mix_and_anchors(era_id)

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

    first, last = seasons[0], seasons[-1]
    return {
        "schemaVersion": 1,
        "eraId": era_id,
        "profileVersion": f"{PROFILE_VERSION_PREFIX}-{era_id}-v1",
        "dataVersion": DATA_VERSION,
        "seasons": seasons,
        "baselineReport": f"derived from packaged {first}..{last} stints; targets frozen after calibration baseline",
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
            "source": f"packaged stints {first}..{last} + Lakers {era_id} pool rating anchors",
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Compute era simulation profiles")
    parser.add_argument(
        "--era", nargs="+", default=None,
        help="eraIds to compute (default: every era with packaged seasons)",
    )
    args = parser.parse_args()

    eras = eras_with_data()
    if args.era:
        by_id = {era["eraId"]: era for era in eras}
        missing = [e for e in args.era if e not in by_id]
        if missing:
            raise SystemExit(f"no packaged data for era(s): {', '.join(missing)}")
        eras = [by_id[e] for e in args.era]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for era in eras:
        profile = compute_era_profile(era)
        out = OUT_DIR / f"{era['eraId']}.json"
        with out.open("w", encoding="utf-8") as fh:
            json.dump(profile, fh, indent=2)
            fh.write("\n")
        params = profile["parameters"]
        print(f"wrote {out} pace={params['pace']:.2f}")


if __name__ == "__main__":
    main()
