"""Derive ratings, tendencies, traits, and contracts from real NBA stats.

Reads roster.json + season-stats.json, produces complete StaticPlayer-compatible roster.json.
Ported from src/game/ratings/playerRatingEngine.ts.
"""

from __future__ import annotations

import hashlib
import random
from typing import Any

from .config import ensure_output_dir
from .util import read_json, write_json

# ---------------------------------------------------------------------------
# Era configs (from src/game/models/eraConfig.ts)
# ---------------------------------------------------------------------------
MODERN_PPG = 114.7
MODERN_3PA_RATE = 0.39

ERA_CONFIGS: dict[str, dict[str, float]] = {
    "1990-91": {"leaguePpg": 106.7, "league3PARate": 0.10, "pace": 96.4},
    "1991-92": {"leaguePpg": 106.5, "league3PARate": 0.11, "pace": 95.4},
    "1992-93": {"leaguePpg": 105.3, "league3PARate": 0.12, "pace": 94.7},
    "1993-94": {"leaguePpg": 101.5, "league3PARate": 0.13, "pace": 95.1},
    "1994-95": {"leaguePpg": 101.4, "league3PARate": 0.15, "pace": 94.7},
    "1995-96": {"leaguePpg": 99.5, "league3PARate": 0.17, "pace": 94.1},
    "1996-97": {"leaguePpg": 99.1, "league3PARate": 0.18, "pace": 91.1},
    "1997-98": {"leaguePpg": 95.6, "league3PARate": 0.18, "pace": 90.7},
    "1998-99": {"leaguePpg": 95.1, "league3PARate": 0.18, "pace": 91.1},
    "1999-00": {"leaguePpg": 97.5, "league3PARate": 0.19, "pace": 93.3},
    "2000-01": {"leaguePpg": 94.8, "league3PARate": 0.19, "pace": 92.4},
    "2001-02": {"leaguePpg": 95.1, "league3PARate": 0.21, "pace": 91.5},
    "2002-03": {"leaguePpg": 95.1, "league3PARate": 0.22, "pace": 91.5},
    "2003-04": {"leaguePpg": 93.4, "league3PARate": 0.22, "pace": 91.0},
    "2004-05": {"leaguePpg": 97.2, "league3PARate": 0.23, "pace": 90.9},
    "2005-06": {"leaguePpg": 97.0, "league3PARate": 0.24, "pace": 90.5},
    "2006-07": {"leaguePpg": 98.7, "league3PARate": 0.25, "pace": 90.4},
    "2007-08": {"leaguePpg": 99.9, "league3PARate": 0.26, "pace": 91.7},
    "2008-09": {"leaguePpg": 100.0, "league3PARate": 0.27, "pace": 92.2},
    "2009-10": {"leaguePpg": 100.4, "league3PARate": 0.27, "pace": 92.7},
    "2010-11": {"leaguePpg": 99.6, "league3PARate": 0.27, "pace": 92.1},
    "2011-12": {"leaguePpg": 96.3, "league3PARate": 0.26, "pace": 91.3},
    "2012-13": {"leaguePpg": 98.1, "league3PARate": 0.28, "pace": 92.7},
    "2013-14": {"leaguePpg": 101.0, "league3PARate": 0.28, "pace": 93.5},
    "2014-15": {"leaguePpg": 100.0, "league3PARate": 0.27, "pace": 93.5},
    "2015-16": {"leaguePpg": 102.7, "league3PARate": 0.27, "pace": 95.8},
    "2016-17": {"leaguePpg": 105.6, "league3PARate": 0.31, "pace": 96.4},
    "2017-18": {"leaguePpg": 106.3, "league3PARate": 0.33, "pace": 97.3},
    "2018-19": {"leaguePpg": 111.2, "league3PARate": 0.36, "pace": 100.0},
    "2019-20": {"leaguePpg": 111.8, "league3PARate": 0.38, "pace": 100.3},
    "2020-21": {"leaguePpg": 112.1, "league3PARate": 0.39, "pace": 99.8},
    "2021-22": {"leaguePpg": 110.7, "league3PARate": 0.39, "pace": 98.2},
    "2022-23": {"leaguePpg": 114.7, "league3PARate": 0.40, "pace": 99.2},
    "2023-24": {"leaguePpg": 114.9, "league3PARate": 0.40, "pace": 99.0},
    "2024-25": {"leaguePpg": 114.7, "league3PARate": 0.39, "pace": 99.2},
}

DEFAULT_ERA = {"leaguePpg": 114.7, "league3PARate": 0.39, "pace": 99.2}


def get_era(season: str) -> dict[str, float]:
    return ERA_CONFIGS.get(season, DEFAULT_ERA)


# ---------------------------------------------------------------------------
# Overall weights (from src/game/ratings/overallWeights.ts)
# ---------------------------------------------------------------------------
OVERALL_WEIGHTS: dict[str, dict[str, float]] = {
    "PG": {
        "ballHandling": 0.13, "passing": 0.13, "perimeterDefense": 0.12,
        "threePoint": 0.12, "speed": 0.10, "offensiveIq": 0.10,
        "midrange": 0.04, "freeThrow": 0.05, "consistency": 0.05,
        "defensiveIq": 0.03, "steal": 0.03, "closeShot": 0.05, "insideScoring": 0.05,
    },
    "SG": {
        "threePoint": 0.15, "perimeterDefense": 0.12, "midrange": 0.10,
        "ballHandling": 0.10, "speed": 0.08, "offensiveIq": 0.08,
        "steal": 0.07, "freeThrow": 0.06, "consistency": 0.05,
        "defensiveIq": 0.05, "insideScoring": 0.05, "closeShot": 0.05,
        "offensiveRebound": 0.04,
    },
    "SF": {
        "threePoint": 0.12, "midrange": 0.10, "perimeterDefense": 0.12,
        "defensiveIq": 0.08, "offensiveIq": 0.08, "speed": 0.07,
        "ballHandling": 0.06, "insideScoring": 0.06, "offensiveRebound": 0.05,
        "defensiveRebound": 0.05, "freeThrow": 0.05, "consistency": 0.05,
        "strength": 0.05, "steal": 0.06,
    },
    "PF": {
        "insideScoring": 0.15, "defensiveRebound": 0.12, "offensiveRebound": 0.08,
        "interiorDefense": 0.10, "midrange": 0.08, "threePoint": 0.07,
        "strength": 0.08, "offensiveIq": 0.06, "defensiveIq": 0.06,
        "freeThrow": 0.04, "consistency": 0.05, "closeShot": 0.06,
        "vertical": 0.05,
    },
    "C": {
        "insideScoring": 0.18, "defensiveRebound": 0.15, "interiorDefense": 0.12,
        "offensiveRebound": 0.08, "strength": 0.10, "closeShot": 0.07,
        "offensiveIq": 0.06, "defensiveIq": 0.05, "freeThrow": 0.04,
        "consistency": 0.05, "vertical": 0.05, "block": 0.05,
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def round_dict(d: dict[str, Any], decimals: int = 2) -> dict[str, Any]:
    return {k: round(v, decimals) if isinstance(v, float) else v for k, v in d.items()}


def clamp_rating(v: float) -> int:
    return int(clamp(v, 0, 100))


def sample_weight(minutes: float, games: int) -> float:
    mw = min(1.0, minutes / 1500)
    gw = min(1.0, games / 45)
    return 0.6 * mw + 0.4 * gw


def blend_to_mean(value: float, weight: float, mean: float) -> float:
    w = clamp(weight, 0, 1)
    return value * w + mean * (1 - w)


def _is_big_profile(ratings: dict[str, int], position: str) -> bool:
    """Detect big-man profile. Cs and PFs are always bigs.
    SFs qualify with a big defensive profile."""
    if position in ("C", "PF"):
        return True
    if position == "SF":
        return (
            ratings.get("interiorDefense", 0) >= 65
            and ratings.get("defensiveRebound", 0) >= 70
            and ratings.get("block", 0) >= 55
        )
    return False


def compute_overall(ratings: dict[str, int], position: str) -> int:
    weights = OVERALL_WEIGHTS.get(position, OVERALL_WEIGHTS["SF"])
    total = 0.0
    for key, weight in weights.items():
        val = ratings.get(key, 50)
        total += val * weight
    if total <= 50:
        return int(round(total))
    deviation = total - 50
    is_big = _is_big_profile(ratings, position)
    divisor = 120 if is_big else 85
    return int(min(99, round(50 + deviation * (1 + deviation / divisor))))


def compute_production_impact(stats: dict[str, Any]) -> float:
    """Estimate top-line player impact from real production.

    The weighted skill overall is intentionally position-specific, but by itself it
    compresses heliocentric stars and older elite players into the high 70s. This
    impact layer lets real NBA production lift the final overall without inflating
    every individual skill rating.
    """
    gp = int(stats.get("gamesPlayed", 0) or 0)
    minutes = float(stats.get("minutes", 0) or 0)
    if gp == 0 or minutes == 0:
        return 0

    ppg = float(stats.get("points", 0) or 0) / max(1, gp)
    rpg = float(stats.get("rebounds", 0) or 0) / max(1, gp)
    apg = float(stats.get("assists", 0) or 0) / max(1, gp)
    mpg = minutes / max(1, gp)
    per = float(stats.get("per", 0) or 0)
    bpm = float(stats.get("boxPlusMinus", 0) or 0)
    usage = float(stats.get("usageRate", 0) or 0)
    ts_pct = float(stats.get("tsPct", 0) or 0)

    impact = (
        62
        + (ppg - 10) * 1.0
        + (rpg - 4) * 0.7
        + (apg - 3) * 0.95
        + (per - 15) * 0.9
        + bpm * 1.5
        + (usage - 20) * 0.35
        + (mpg - 24) * 0.35
        + (ts_pct - 0.57) * 50
    )
    if ppg >= 24 and ts_pct >= 0.59:
        impact += 3.5
    elif ppg >= 24 and ts_pct >= 0.56:
        impact += 2
    if apg >= 6 and usage >= 26:
        impact += 2
    if ppg >= 20 and per >= 20:
        impact += 1.5
    return clamp(impact, 55, 99)


def compute_real_overall(ratings: dict[str, int], position: str, stats: dict[str, Any]) -> int:
    skill_overall = compute_overall(ratings, position)
    production_impact = compute_production_impact(stats)
    if production_impact == 0:
        return skill_overall

    gp = int(stats.get("gamesPlayed", 0) or 0)
    minutes = float(stats.get("minutes", 0) or 0)
    ppg = float(stats.get("points", 0) or 0) / max(1, gp)
    rpg = float(stats.get("rebounds", 0) or 0) / max(1, gp)
    apg = float(stats.get("assists", 0) or 0) / max(1, gp)
    mpg = minutes / max(1, gp)
    usage = float(stats.get("usageRate", 0) or 0)
    bpm = float(stats.get("boxPlusMinus", 0) or 0)
    ts_pct = float(stats.get("tsPct", 0) or 0)

    blended = max(skill_overall, skill_overall * 0.65 + production_impact * 0.35)

    # --- Floor logic (matches TS computeRealOverall) ---
    floor = 0
    if mpg >= 28 and gp >= 40:
        if ppg >= 26:
            floor = 88
        elif ppg >= 22:
            floor = 84
        elif ppg >= 16:
            floor = 80
        elif ppg >= 12:
            floor = 76
    elif mpg >= 24 and gp >= 35:
        if ppg >= 18:
            floor = 79
        elif ppg >= 14:
            floor = 75
        elif ppg >= 10:
            floor = 71
    elif mpg >= 18 and gp >= 40:
        if ppg >= 14:
            floor = 73
        elif ppg >= 10:
            floor = 69
        elif ppg >= 6:
            floor = 65
    elif mpg >= 18 and gp >= 15:
        if ppg >= 7:
            floor = 70
        else:
            floor = 68
    elif mpg >= 12 and gp >= 15:
        floor = 69
    elif mpg >= 8 and gp >= 15:
        floor = 69
    elif gp >= 50:
        floor = 67
    elif gp >= 30:
        floor = 63

    # Star floor overrides (matches TS)
    if gp >= 15 and mpg >= 28 and ppg >= 22 and usage >= 28:
        floor = max(floor, 89)
    if gp >= 15 and mpg >= 28 and ppg >= 24 and bpm >= 4:
        floor = max(floor, 92)
    if gp >= 40 and mpg >= 28 and ppg >= 23:
        floor = max(floor, 90)
    if gp >= 30 and mpg >= 28 and ppg >= 17 and apg >= 5:
        floor = max(floor, 81)
    if gp >= 40 and mpg >= 30 and ppg >= 22:
        floor = max(floor, 85)
    if gp >= 30 and mpg >= 20 and ppg >= 8:
        floor = max(floor, 73)
    if gp >= 20 and mpg >= 25 and ppg >= 20 and usage >= 25:
        floor = max(floor, 84)
    if gp >= 30 and mpg >= 24 and ppg >= 14 and rpg >= 7 and bpm >= 2.5:
        floor = max(floor, 80)
    if gp >= 35 and mpg >= 24 and apg >= 6:
        floor = max(floor, 75)
    if gp >= 10:
        floor = max(floor, 67)

    boosted = max(blended, floor)

    # --- Big-man profile caps (matches TS) ---
    is_big = _is_big_profile(ratings, position)

    if is_big and usage < 28:
        if ppg < 12:
            boosted = min(boosted, 82)
        elif ppg < 17:
            boosted = min(boosted, 88 if bpm >= 3 else 83)
        elif ppg < 20:
            boosted = min(boosted, 88 if bpm >= 3 else 82)
        elif ppg < 25 and bpm < 3:
            boosted = min(boosted, 91)
        elif ppg < 25:
            boosted = min(boosted, 94)

    if is_big and usage >= 28 and ppg < 25:
        boosted = min(boosted, 89)

    # --- High-usage non-big caps (matches TS) ---
    if not is_big and usage >= 28 and bpm < 3:
        if bpm < 0:
            cap = 82
        elif gp < 30 and ppg >= 22:
            cap = 89
        elif ppg >= 24 and ts_pct >= 0.58:
            cap = 88
        else:
            cap = 87
        boosted = min(boosted, cap)

    if not is_big and ppg >= 18 and ppg < 23 and usage >= 24 and bpm < 1.5:
        boosted = min(boosted, 83 if ppg >= 22 else 82)

    if not is_big and ppg >= 20 and usage < 28 and bpm < 2.5:
        boosted = min(boosted, 87)

    if not is_big and ppg >= 20 and ppg < 25 and usage < 28:
        boosted = min(boosted, 89)

    if not is_big and ppg >= 20 and usage < 26 and bpm < 1.5:
        boosted = min(boosted, 82)

    # --- Final boost (matches TS) ---
    if boosted < 65:
        final_boost = 6.0
    elif boosted < 72:
        final_boost = 6.0
    elif boosted < 78:
        final_boost = 6.0
    elif boosted < 85:
        final_boost = 4.0
    else:
        final_boost = 2.0

    return clamp_rating(boosted + final_boost)


# ---------------------------------------------------------------------------
# Position mapping
# ---------------------------------------------------------------------------
POS_MAP = {"G": "SG", "F": "SF", "C": "C", "PG": "PG", "SG": "SG", "SF": "SF", "PF": "PF"}


def map_position(raw: str) -> str:
    return POS_MAP.get(raw, "SF")


# ---------------------------------------------------------------------------
# Rating derivation (ported from playerRatingEngine.ts)
# ---------------------------------------------------------------------------
def derive_ratings(stats: dict[str, Any], position: str, season: str, rng: random.Random) -> dict[str, int]:
    """Derive 23 ratings from real season stats."""
    era = get_era(season)
    gp = int(stats.get("gamesPlayed", 0) or 0)
    minutes = float(stats.get("minutes", 0) or 0)

    if gp == 0 or minutes == 0:
        return _default_ratings(position, rng)

    ppg = float(stats.get("points", 0) or 0) / max(1, gp)
    rpg = float(stats.get("rebounds", 0) or 0) / max(1, gp)
    apg = float(stats.get("assists", 0) or 0) / max(1, gp)
    spg = float(stats.get("steals", 0) or 0) / max(1, gp)
    bpg = float(stats.get("blocks", 0) or 0) / max(1, gp)
    topg = float(stats.get("turnovers", 0) or 0) / max(1, gp)
    mpg = minutes / max(1, gp)
    fga = float(stats.get("fga", 0) or 0)
    tpa = float(stats.get("tpa", 0) or 0)
    tpm = float(stats.get("tpm", 0) or 0)
    fta = float(stats.get("fta", 0) or 0)
    ftm = float(stats.get("ftm", 0) or 0)
    ts_pct = float(stats.get("tsPct", 0) or 0)
    efg_pct = float(stats.get("efgPct", 0) or 0)
    per = float(stats.get("per", 0) or 0)
    bpm = float(stats.get("boxPlusMinus", 0) or 0)
    usage = float(stats.get("usageRate", 0) or 0)

    three_pct = tpm / max(1, tpa)
    ft_pct = ftm / max(1, fta)

    # Era normalize PPG
    ppg_norm = ppg * (MODERN_PPG / max(1, era["leaguePpg"]))
    three_parate = tpa / max(1, fga) * (MODERN_3PA_RATE / max(0.01, era["league3PARate"]))

    weight = sample_weight(minutes, gp)
    j = rng.gauss

    def blend(raw: float, mean: float) -> float:
        return blend_to_mean(raw, weight, mean)

    def jitter(v: float, sigma: float = 1.0) -> float:
        return v + j(0, sigma)

    # Shooting
    ts_component = (ts_pct - 0.5) * 200
    three_component = (three_pct - 0.3) * 200
    ft_component = (ft_pct - 0.7) * 100
    three_raw = 62 + ts_component * 0.35 + three_component * 0.45 + ft_component * 0.25

    # Playmaking
    pass_raw = 60 + (apg - 3) * 5 + per * 0.6

    # Rebounding
    reb_raw = 60 + (rpg - 4) * 5
    oreb_raw = reb_raw * 0.7
    dreb_raw = reb_raw * 1.1

    # Defense
    stock = (spg + bpg) * 7
    def_raw = 60 + stock + bpm * 1.8

    # Inside scoring
    inside_raw = 60 + (ppg_norm - 14) * 2.2 + ts_pct * 35
    if position in ("C", "PF"):
        inside_raw += 4
    elif position in ("PG", "SG"):
        inside_raw -= 2

    # Athleticism
    ath = 60 + (usage - 18) * 0.5 + mpg * 0.5 + per * 0.7

    ratings = {
        "insideScoring": clamp_rating(jitter(blend(inside_raw, 54))),
        "closeShot": clamp_rating(jitter(blend(60 + (ppg - 10) * 1.5, 59))),
        "midrange": clamp_rating(jitter(blend(60 + (efg_pct - 0.48) * 100, 54))),
        "threePoint": clamp_rating(jitter(blend(three_raw, 54))),
        "freeThrow": clamp_rating(jitter(blend(60 + (ft_pct - 0.75) * 250, 69))),
        "ballHandling": clamp_rating(jitter(blend(60 + (usage - 16) * 0.8, 54))),
        "passing": clamp_rating(jitter(blend(pass_raw, 54))),
        "offensiveIq": clamp_rating(jitter(blend(60 + per * 1.0 + bpm * 2.0, 59))),
        "offensiveRebound": clamp_rating(jitter(blend(oreb_raw, 45))),
        "defensiveRebound": clamp_rating(jitter(blend(dreb_raw, 59))),
        "perimeterDefense": clamp_rating(jitter(blend(def_raw, 54))),
        "interiorDefense": clamp_rating(jitter(blend(
            def_raw + 5 if position in ("C", "PF") else def_raw - 3,
            59 if position in ("C", "PF") else 49,
        ))),
        "steal": clamp_rating(jitter(blend(60 + spg * 10, 54))),
        "block": clamp_rating(jitter(blend(60 + bpg * 12, 49))),
        "defensiveIq": clamp_rating(jitter(blend(60 + bpm * 2.0, 59))),
        "speed": clamp_rating(jitter(blend(ath + (5 if position == "PG" else 0), 59))),
        "strength": clamp_rating(jitter(blend(
            ath + 5 if position in ("C", "PF") else ath,
            64 if position in ("C", "PF") else 54,
        ))),
        "vertical": clamp_rating(jitter(blend(60 + (5 if position == "C" else 0), 54))),
        "stamina": clamp_rating(jitter(blend(60 + mpg * 1.0, 64))),
        "durability": clamp_rating(jitter(blend(60 + gp * 0.5, 64))),
        "clutch": clamp_rating(jitter(blend(60 + bpm * 0.8, 59))),
        "consistency": clamp_rating(jitter(blend(60 + gp * 0.3, 59))),
    }

    # Potential: based on age + recent performance
    age = int(stats.get("age", 25) or 25)
    potential_raw = max(per, inside_raw) + 5
    if age < 24:
        potential_raw += 5
    elif age > 30:
        potential_raw -= 5
    ratings["potential"] = clamp_rating(potential_raw)

    ratings["overall"] = compute_real_overall(ratings, position, stats)
    return ratings


def _default_ratings(position: str, rng: random.Random) -> dict[str, int]:
    """Replacement-level ratings for players with no stats."""
    base = {
        "insideScoring": 50, "closeShot": 50, "midrange": 50, "threePoint": 50,
        "freeThrow": 60, "ballHandling": 50, "passing": 50, "offensiveIq": 50,
        "offensiveRebound": 50, "defensiveRebound": 50, "perimeterDefense": 50,
        "interiorDefense": 50, "steal": 50, "block": 50, "defensiveIq": 50,
        "speed": 54, "strength": 54, "vertical": 54, "stamina": 60,
        "durability": 64, "clutch": 50, "consistency": 54, "potential": 60,
    }
    if position == "C":
        base["interiorDefense"] = 60
        base["insideScoring"] = 54
        base["vertical"] = 60
    elif position == "PG":
        base["ballHandling"] = 60
        base["passing"] = 60
        base["speed"] = 64

    for k in base:
        base[k] = clamp_rating(base[k] + rng.gauss(0, 1))
    base["overall"] = compute_overall(base, position)
    return base


# ---------------------------------------------------------------------------
# Tendency derivation
# ---------------------------------------------------------------------------
def derive_tendencies(stats: dict[str, Any], ratings: dict[str, int], position: str, rng: random.Random) -> dict[str, float]:
    """Derive 24 tendencies from real stats + ratings."""
    gp = max(1, int(stats.get("gamesPlayed", 0) or 1))
    ppg = float(stats.get("points", 0) or 0) / gp
    fga = float(stats.get("fga", 0) or 0)
    tpa = float(stats.get("tpa", 0) or 0)
    fta = float(stats.get("fta", 0) or 0)
    tov = float(stats.get("turnovers", 0) or 0)
    apg = float(stats.get("assists", 0) or 0)
    usage = float(stats.get("usageRate", 0) or 15)

    j = rng.gauss

    three_rate = (tpa / max(1, fga)) * 100
    ft_rate = (fta / max(1, fga)) * 100
    tov_rate = (tov / max(1, fga + 0.44 * fta + tov)) * 100 if (fga + 0.44 * fta + tov) > 0 else 12
    pass_rate = (apg / max(1, apg + ppg * 0.5 + 1)) * 40

    is_big = position in ("C", "PF")
    is_guard = position in ("PG", "SG")

    tendencies = {
        "usageRate": clamp(usage + j(0, 1), 10, 40),
        "passRate": clamp(pass_rate + j(0, 2), 5, 35),
        "shotRate": clamp(fga / max(1, gp) / 48 * 100 + j(0, 2), 10, 50),
        "driveRate": clamp(10 + (8 if is_guard else 0) + j(0, 2), 5, 35),
        "postUpRate": clamp(5 + (8 if is_big else 0) + j(0, 2), 0, 30),
        "rimFrequency": clamp(ratings.get("insideScoring", 50) / 100 * 40 + j(0, 3), 10, 50),
        "shortMidFrequency": clamp(15 + j(0, 2), 5, 30),
        "longMidFrequency": clamp(10 + j(0, 2), 0, 20),
        "cornerThreeFrequency": clamp(ratings.get("threePoint", 50) / 100 * 15 + j(0, 2), 0, 15),
        "aboveBreakThreeFrequency": clamp(ratings.get("threePoint", 50) / 100 * 25 + j(0, 2), 5, 30),
        "threePointRate": clamp(three_rate + j(0, 3), 15, 60),
        "freeThrowRate": clamp(ft_rate + j(0, 2), 10, 50),
        "turnoverRate": clamp(tov_rate + j(0, 2), 5, 25),
        "isolationRate": clamp(usage * 0.3 + j(0, 2), 0, 35),
        "pickAndRollBallHandlerRate": clamp(20 + (15 if is_guard else 0) + j(0, 3), 5, 50),
        "pickAndRollRollManRate": clamp(10 + (15 if position == "C" else 0) + j(0, 3), 0, 30),
        "spotUpRate": clamp(20 + j(0, 2), 5, 40),
        "transitionRate": clamp(15 + j(0, 2), 5, 30),
        "cutRate": clamp(10 + j(0, 2), 0, 25),
        "foulRate": clamp(2 + j(0, 0.5), 0, 6),
        "stealAttemptRate": clamp(5 + ratings.get("steal", 50) * 0.08 + j(0, 1), 0, 12),
        "blockAttemptRate": clamp(5 + ratings.get("block", 50) * 0.08 + j(0, 1), 0, 12),
        "crashOffensiveGlassRate": clamp(10 + ratings.get("offensiveRebound", 50) * 0.12 + j(0, 2), 0, 25),
    }
    return round_dict(tendencies)


# ---------------------------------------------------------------------------
# Trait derivation (archetype-based)
# ---------------------------------------------------------------------------
def derive_traits(ratings: dict[str, int], stats: dict[str, Any], position: str, rng: random.Random) -> dict[str, int]:
    """Derive 9 personality traits from archetype + ratings."""
    usage = float(stats.get("usageRate", 15) or 15)
    gp = int(stats.get("gamesPlayed", 0) or 0)
    consistency = ratings.get("consistency", 55)
    age = int(stats.get("age", 25) or 25)
    potential = ratings.get("potential", 60)

    j = rng.gauss

    work_ethic = clamp(50 + gp / 82 * 10 + consistency * 0.2 + j(0, 5), 20, 99)
    loyalty = clamp(50 + j(0, 10), 20, 99)
    ego = clamp(50 + usage * 0.3 + j(0, 8), 20, 99)
    greed = clamp(50 + usage * 0.2 + j(0, 6), 20, 99)
    leadership = clamp(50 + (age - 22) * 0.8 + j(0, 6), 20, 99)
    coachability = clamp(50 + potential * 0.2 - ego * 0.1 + j(0, 5), 20, 99)
    injury_risk = clamp(50 - ratings.get("durability", 65) * 0.3 + j(0, 8), 10, 99)
    shot_creation = clamp_rating(60 + (usage - 18) * 0.8 + j(0, 4))
    defensive_versatility = clamp_rating(60 + ratings.get("defensiveIq", 55) * 0.3 + ratings.get("steal", 50) * 0.2 + j(0, 4))

    return {
        "workEthic": clamp_rating(work_ethic),
        "loyalty": clamp_rating(loyalty),
        "ego": clamp_rating(ego),
        "greed": clamp_rating(greed),
        "leadership": clamp_rating(leadership),
        "coachability": clamp_rating(coachability),
        "injuryRisk": clamp_rating(injury_risk),
        "shotCreation": shot_creation,
        "defensiveVersatility": defensive_versatility,
    }


# ---------------------------------------------------------------------------
# Contract derivation
# ---------------------------------------------------------------------------
SALARY_TIERS = [
    (95, 65_000_000), (90, 55_000_000), (85, 45_000_000),
    (80, 35_000_000), (75, 26_000_000), (70, 18_000_000),
    (65, 12_000_000), (60, 7_000_000), (55, 3_000_000),
    (50, 1_500_000),
]


def derive_contract(overall: int, age: int, rng: random.Random) -> dict[str, Any]:
    """Estimate contract from overall rating and age. Matches TS Contract interface."""
    base_salary = 1_500_000
    for min_ovr, salary in SALARY_TIERS:
        if overall >= min_ovr:
            base_salary = salary
            break

    years_in_league = max(0, age - 19)
    if years_in_league <= 3:
        years = 1
    elif years_in_league <= 6:
        years = 2
    else:
        years = 4

    salary_by_year = []
    for i in range(years):
        salary_by_year.append(int(base_salary * (1.08 ** i)))

    signing_bonus = int(base_salary * 0.05)
    signing_bonus_by_year = [int(signing_bonus / years)] * years
    signing_bonus_by_year[-1] = signing_bonus - sum(signing_bonus_by_year[:-1]) if years > 1 else signing_bonus

    # Option type
    if years >= 4:
        option = "player"
        option_year = years - 1
    else:
        option = "none"
        option_year = None

    # Guaranteed: all years except last for 4+ year deals
    guaranteed = years <= 3
    guaranteed_by_year = [True] * years
    if years > 3:
        guaranteed_by_year[-1] = False

    return {
        "salaryByYear": salary_by_year,
        "yearsRemaining": years,
        "option": option,
        "optionYear": option_year,
        "noTradeClause": False,
        "signingBonusByYear": signing_bonus_by_year,
        "likelyBonusesByYear": [0] * years,
        "unlikelyBonusesByYear": [0] * years,
        "guaranteed": guaranteed,
        "guaranteedByYear": guaranteed_by_year,
        "tradeKickers": [],
        "poisonPill": False,
        "birdRights": years_in_league >= 7,
        "earlyBird": years_in_league >= 4,
        "baseYearCompensation": False,
        "deferredMoney": [],
    }


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
def compute_for_season(season: str, force: bool = False) -> None:
    """Compute ratings/tendencies/traits/contracts for a season."""
    out = ensure_output_dir(season)
    roster_path = out / "roster.json"
    stats_path = out / "season-stats.json"

    if not roster_path.exists():
        print(f"  ! {season}: no roster.json, skipping")
        return
    if not stats_path.exists():
        print(f"  ! {season}: no season-stats.json, skipping")
        return

    roster = read_json(roster_path)
    stats_list = read_json(stats_path)

    if not roster:
        print(f"  ! {season}: empty roster, skipping")
        return

    # Check if already computed (unless force)
    if not force and roster and "importMeta" in (roster[0] if roster else {}):
        meta = roster[0].get("importMeta", {})
        if meta.get("statsSource") == "nba_api":
            print(f"  [SKIP] {season}: ratings already computed (use --force to recompute)")
            return

    # Build stats lookup by externalId
    stats_by_id: dict[str, dict[str, Any]] = {}
    for s in stats_list:
        pid = s.get("playerExternalId", "")
        if pid:
            stats_by_id[pid] = s

    seed = int(hashlib.sha256(season.encode("utf-8")).hexdigest()[:12], 16) + 42
    rng = random.Random(seed)

    computed = 0
    for player in roster:
        ext_id = player.get("externalId", "")
        pos = map_position(player.get("position", "SF"))
        player["position"] = pos

        # Set internal ID if missing
        if "id" not in player:
            team_abbr = player.get("teamInternalId", "unk").replace("team-", "")
            player["id"] = f"p-{team_abbr}-{player.get('firstName', '?')[0]}{player.get('lastName', '?')[0]}-{ext_id}"

        # Convert height/weight
        height_str = player.get("height", "")
        if isinstance(height_str, str) and "-" in height_str:
            parts = height_str.split("-")
            player["heightInches"] = int(parts[0]) * 12 + int(parts[1])
        elif isinstance(height_str, (int, float)):
            player["heightInches"] = int(height_str)
        elif "heightInches" not in player:
            player["heightInches"] = 78

        if player.get("weightLbs", 0) == 0:
            weight_str = player.get("weight", 0)
            if isinstance(weight_str, str) and weight_str.strip().isdigit():
                player["weightLbs"] = int(weight_str.strip())
            elif isinstance(weight_str, (int, float)) and weight_str > 0:
                import math
                if not math.isnan(weight_str) and not math.isinf(weight_str):
                    player["weightLbs"] = int(weight_str)

        # Set secondaryPositions
        if "secondaryPositions" not in player:
            player["secondaryPositions"] = []

        # Get stats
        stats = stats_by_id.get(ext_id, {})

        # Derive all fields
        player["ratings"] = derive_ratings(stats, pos, season, rng)
        player["tendencies"] = derive_tendencies(stats, player["ratings"], pos, rng)
        player["traits"] = derive_traits(player["ratings"], stats, pos, rng)
        player["contract"] = derive_contract(
            player["ratings"]["overall"],
            int(stats.get("age", player.get("age", 25)) or 25),
            rng,
        )

        player["importMeta"] = {
            "snapshotSeason": season,
            "statsSource": "nba_api",
            "lastUpdated": "2026-01-01T00:00:00Z",
        }

        computed += 1

    write_json(roster_path, roster)
    print(f"  [OK] computed ratings for {computed} players in {season}")


def run(seasons: list[str] | None = None, force: bool = False) -> None:
    """Compatibility wrapper for run_all.py."""
    from .config import DEFAULT_SEASONS
    if seasons is None:
        seasons = DEFAULT_SEASONS
    print("[ratings] deriving ratings from real stats")
    for season in seasons:
        compute_for_season(season, force=force)
