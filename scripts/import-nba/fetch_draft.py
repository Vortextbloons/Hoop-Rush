"""Fetch NBA draft history from 1990 to present.

Output: public/data/shared/draft-history.json
"""

from __future__ import annotations

import sys
from typing import Any

from .config import SHARED_ROOT
from .util import read_cache, with_retry, write_cache, write_json

try:
    from nba_api.stats.endpoints import drafthistory
except Exception as exc:  # pragma: no cover - import-time guard
    print(
        f"Could not import nba_api: {exc}\n"
        "Install with: pip install -r scripts/import_nba/requirements.txt",
        file=sys.stderr,
    )
    raise


DRAFT_START_YEAR = 1990


def fetch_draft_history() -> list[dict[str, Any]]:
    cached = read_cache("draft_history")
    if cached is not None:
        return cached

    def _do_fetch() -> list[dict[str, Any]]:
        draft = drafthistory.DraftHistory()
        df = draft.get_data_frames()[0]
        out: list[dict[str, Any]] = []
        for _, row in df.iterrows():
            season = str(row.get("SEASON", ""))
            year_match = season[:4] if len(season) >= 4 else ""
            try:
                year = int(year_match) if year_match else 0
            except ValueError:
                year = 0

            if year < DRAFT_START_YEAR:
                continue

            out.append({
                "season": season,
                "round": int(row.get("ROUND_NUMBER", 0)),
                "pick": int(row.get("ROUND_PICK", 0)),
                "teamExternalId": str(int(row.get("TEAM_ID", 0))),
                "playerExternalId": str(int(row.get("PLAYER_ID", 0))),
                "firstName": str(row.get("PLAYER_FIRST_NAME", "")),
                "lastName": str(row.get("PLAYER_LAST_NAME", "")),
                "college": str(row.get("SCHOOL", "")) if row.get("SCHOOL") else "",
                "country": str(row.get("COUNTRY", "")) if row.get("COUNTRY") else "",
            })
        return out

    picks = with_retry(_do_fetch)
    write_cache("draft_history", picks)
    return picks


def run() -> None:
    SHARED_ROOT.mkdir(parents=True, exist_ok=True)
    print("[draft] fetching draft history")
    picks = fetch_draft_history()
    write_json(SHARED_ROOT / "draft-history.json", {
        "version": "0.1.0",
        "picks": picks,
    })
    print(f"  [OK] wrote {len(picks)} draft picks")
