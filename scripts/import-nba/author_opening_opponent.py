"""Authors the first permanent bracket entry: the medium-strength 1990s Lakers
opening opponent (Van Exel, Threatt, A.C. Green, Horry, Divac in legal
G,G,F,F,C assignments). M3 includes this artifact unchanged in the full
bracket. Player records are converted to the explicit SimulationPlayer
contract; summary Overall ratings never enter the engine.

Output: `apps/web/static/data/opponents/lakers-1990s-opening.json`
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "apps" / "web" / "static" / "data"
OUT_DIR = DATA_DIR / "opponents"
POOL_PATH = DATA_DIR / "pools" / "lakers-1990s.json"

OPPONENT_ID = "lakers-1990s-opening"
BRACKET_VERSION = "bracket-m3-preview-v1"
SEASON_KEY = "1995-96"

# Van Exel, Threatt, A.C. Green, Horry, Divac -> G, G, F, F, C.
LINEUP = [
    ("p-89", 0, "G"),
    ("p-9", 1, "G"),
    ("p-920", 2, "F"),
    ("p-109", 3, "F"),
    ("p-124", 4, "C"),
]

RATING_KEYS = [
    "insideScoring", "closeShot", "midrange", "threePoint", "freeThrow",
    "ballHandling", "passing", "offensiveIq", "offensiveRebound",
    "defensiveRebound", "perimeterDefense", "interiorDefense", "steal",
    "block", "defensiveIq", "speed", "strength", "vertical",
]

TENDENCY_KEYS = [
    "usageRate", "passRate", "shotRate", "driveRate", "postUpRate",
    "rimFrequency", "shortMidFrequency", "longMidFrequency",
    "cornerThreeFrequency", "aboveBreakThreeFrequency", "threePointRate",
    "freeThrowRate", "turnoverRate", "isolationRate",
    "pickAndRollBallHandlerRate", "pickAndRollRollManRate", "spotUpRate",
    "transitionRate", "cutRate", "foulRate", "stealAttemptRate",
    "blockAttemptRate", "crashOffensiveGlassRate",
]


def clamp(value, low, high):
    return max(low, min(high, value))


def main():
    pool = json.loads(POOL_PATH.read_text(encoding="utf-8"))
    by_id = {p["playerId"]: p for p in pool["players"]}
    for player_id, slot, position in LINEUP:
        if player_id not in by_id:
            raise SystemExit(f"missing pool player {player_id}")

    assignments = []
    players = []
    for player_id, slot, position in LINEUP:
        p = by_id[player_id]
        canonical = p["positions"]["canonical"]
        assignments.append({
            "slotIndex": slot,
            "playerId": player_id,
            "positions": canonical,
        })
        sim = {
            "playerId": player_id,
            "displayName": p["displayName"],
            "positions": canonical,
            "heightInches": p["heightInches"],
            "weightLbs": p["weightLbs"],
            "ratings": {k: clamp(round(p["detailedRatings"].get(k, 50)), 0, 100) for k in RATING_KEYS},
            "tendencies": {k: clamp(p["tendencies"].get(k, 0), 0, 100) for k in TENDENCY_KEYS},
        }
        players.append(sim)

    artifact = {
        "schemaVersion": 1,
        "opponentId": OPPONENT_ID,
        "bracketVersion": BRACKET_VERSION,
        "difficultyBand": "medium",
        "teamId": "lakers",
        "displayName": "Los Angeles Lakers",
        "seasonKey": SEASON_KEY,
        "lineup": {"structure": ["G", "G", "F", "F", "C"], "assignments": assignments},
        "players": players,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{OPPONENT_ID}.json"
    out.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    for player in players:
        print(f"{player['playerId']}: {player['displayName']} "
              f"{'/'.join(player['positions'])} "
              f"ft={player['ratings']['freeThrow']} pass={player['ratings']['passing']}")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
