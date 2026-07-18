"""Fetch historical award winners.

Output: public/data/shared/awards-history.json

Uses CommonAllPlayers + PlayerAwards per star player.
Falls back to empty list on failure.
"""

from __future__ import annotations

import sys
from typing import Any

from .config import SHARED_ROOT
from .util import read_cache, with_retry, write_cache, write_json

try:
    from nba_api.stats.endpoints import playerawards
except Exception as exc:  # pragma: no cover
    print(
        f"Could not import nba_api: {exc}\n"
        "Install with: pip install -r scripts/import_nba/requirements.txt",
        file=sys.stderr,
    )
    raise

# Only fetch awards for top players to avoid thousands of API calls
TOP_PLAYER_IDS = [
    "2544",   # LeBron James
    "201566", # Kevin Durant
    "203999", # Nikola Jokic
    "203507", # Giannis Antetokounmpo
    "1628973", # Trae Young
    "1628369", # Jayson Tatum
    "1628983", # Shai Gilgeous-Alexander
    "1630169", # Anthony Edwards
    "203954",  # Joel Embiid
    "1626164", # Devin Booker
    "1628378", # Donovan Mitchell
    "1629029", # Luka Doncic
    "1627759", # Jaylen Brown
    "1631000", # Paolo Banchero
    "1630596", # Cade Cunningham
    "6450",    # Kawhi Leonard
    "101162",  # Chris Paul
    "201939",  # Stephen Curry
    "201935",  # James Harden
    "201569",  # Russell Westbrook
]

AWARD_KEYWORDS = {
    "Most Valuable Player": "mvp",
    "Defensive Player of the Year": "dpoy",
    "Rookie of the Year": "roy",
    "Rookie": "roy",
    "Sixth Man of the Year": "smoy",
    "Most Improved Player": "mip",
    "Finals MVP": "finals_mvp",
    "Finals Most Valuable Player": "finals_mvp",
}


def fetch_awards_for_player(player_id: str) -> list[dict[str, Any]]:
    cached = read_cache("player_awards", player=player_id)
    if cached is not None:
        return cached

    def _do_fetch() -> list[dict[str, Any]]:
        resp = playerawards.PlayerAwards(player_id=player_id)
        df = resp.get_data_frames()[0]
        out: list[dict[str, Any]] = []
        for _, row in df.iterrows():
            desc = str(row.get("DESCRIPTION", ""))
            award_type = None
            for keyword, atype in AWARD_KEYWORDS.items():
                if keyword.lower() in desc.lower():
                    award_type = atype
                    break
            if not award_type:
                continue
            season = str(row.get("SEASON", ""))
            if not season:
                continue
            out.append({
                "season": season,
                "award": award_type,
                "playerExternalId": player_id,
                "teamExternalId": str(int(row.get("TEAM_ID", 0))) if row.get("TEAM_ID") else "",
                "playerName": f"{row.get('FIRST_NAME', '')} {row.get('LAST_NAME', '')}".strip(),
            })
        return out

    awards = with_retry(_do_fetch)
    write_cache("player_awards", awards, player=player_id)
    return awards


def run(seasons: list[str]) -> None:
    SHARED_ROOT.mkdir(parents=True, exist_ok=True)
    print("[awards] fetching award winners for top players")
    all_awards: list[dict[str, Any]] = []
    for pid in TOP_PLAYER_IDS:
        try:
            awards = fetch_awards_for_player(pid)
            all_awards.extend(awards)
        except Exception as exc:
            print(f"  ! failed for player {pid}: {exc}")
    write_json(SHARED_ROOT / "awards-history.json", {
        "version": "0.2.0",
        "updatedAt": "",
        "awards": all_awards,
    })
    print(f"  [OK] wrote awards-history.json ({len(all_awards)} entries)")
