"""Detect whether the NBA CDN hosts a real headshot or only the generic silhouette.

Output cache: .raw_nba_cache/nba_headshot_status.json  {nba externalId -> bool}

The CDN returns HTTP 200 for every player id, but missing photos are always the
same ~12 KB placeholder PNG. Build-time pool records carry that result as
altIds.nbaHeadshotAvailable so the UI can prefer NBA when a real photo exists.
"""

from __future__ import annotations

import json
from typing import Any

from .config import RAW_CACHE
from .util import with_retry

NBA_HEADSHOT_STATUS_PATH = RAW_CACHE / "nba_headshot_status.json"
NBA_HEADSHOT_URL = "https://cdn.nba.com/headshots/nba/latest/1040x760/{id}.png"
NBA_PLACEHOLDER_BYTES = 12430

HEADERS = {
    "User-Agent": (
        "HoopRush/1.0 (build-time asset resolver; contact: hooprush@example.com) "
        "requests/1 +https://github.com/"
    )
}


def _load() -> dict[str, bool]:
    if NBA_HEADSHOT_STATUS_PATH.exists():
        try:
            raw = json.loads(NBA_HEADSHOT_STATUS_PATH.read_text(encoding="utf-8"))
            return {key: bool(value) for key, value in raw.items()}
        except Exception:
            return {}
    return {}


def _save(cache: dict[str, bool]) -> None:
    NBA_HEADSHOT_STATUS_PATH.write_text(
        json.dumps(cache, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def nba_headshot_available(external_id: str) -> bool:
    """Return True when the NBA CDN hosts a non-placeholder headshot for this player."""
    cache = _load()
    if external_id in cache:
        return cache[external_id]

    import requests

    def _check() -> bool:
        resp = requests.head(
            NBA_HEADSHOT_URL.format(id=external_id),
            headers=HEADERS,
            timeout=20,
            allow_redirects=True,
        )
        if resp.status_code != 200:
            return False
        content_length = resp.headers.get("Content-Length")
        if content_length is None:
            return True
        return int(content_length) != NBA_PLACEHOLDER_BYTES

    try:
        available = with_retry(_check)
    except Exception:
        available = False

    cache[external_id] = available
    _save(cache)
    return available


def annotate_nba_headshots(players: list[dict[str, Any]]) -> None:
    """Fill altIds.nbaHeadshotAvailable on pool player records (in place)."""
    for player in players:
        alt_ids = dict(player.get("altIds") or {})
        alt_ids["nbaHeadshotAvailable"] = nba_headshot_available(player["playerExternalId"])
        player["altIds"] = alt_ids


if __name__ == "__main__":
    annotate_nba_headshots([])
