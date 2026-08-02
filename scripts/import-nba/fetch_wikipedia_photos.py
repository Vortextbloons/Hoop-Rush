"""Resolve Wikipedia thumbnails for players without a usable fallback photo.

Output: .raw_nba_cache/wikipedia_photos.json  {nba externalId -> full image URL}

The module also maintains a per-player bbref headshot status cache
(.raw_nba_cache/bbref_image_status.json) so repeated pool builds only touch
the network for players whose status is unknown. Players whose bbref image is
missing (404) or who have no bbref id are resolved through the Wikipedia API.

Only thumbnails from an article whose title names the player are accepted;
search hits about other people or places (e.g. a hometown article) are
rejected so a wrong face is never packaged.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

from .config import RAW_CACHE
from .util import with_retry

BBREF_IMAGE_STATUS_PATH = RAW_CACHE / "bbref_image_status.json"
WIKIPEDIA_PHOTOS_PATH = RAW_CACHE / "wikipedia_photos.json"

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
HEADSHOT_URL = "https://www.basketball-reference.com/req/20200617/images/headshots/{id}.jpg"

HEADERS = {
    "User-Agent": (
        "HoopRush/1.0 (build-time asset resolver; contact: hooprush@example.com) "
        "requests/{0} +https://en.wikipedia.org/"
    )
}

DISAMBIG_RE = re.compile(r"\s*\(.*?\)\s*$")

# Wikipedia requests anonymous clients to about one request per second.
# Override for resumable bulk re-annotation runs that accept a slightly higher
# burst rate: HOOP_RUSH_WIKI_PACE_SECONDS=0.25
WIKI_PACE_SECONDS = float(os.environ.get("HOOP_RUSH_WIKI_PACE_SECONDS", "1.0"))


def _load(path: Any) -> dict[str, str]:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save(path: Any, value: dict[str, str]) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


def _pace() -> None:
    """Wikipedia requests anonymous clients to about one request per second."""
    time.sleep(WIKI_PACE_SECONDS)


def bbref_image_status(external_id: str, bbref_id: str | None) -> str:
    """Return 'ok', 'missing', or 'error' for a player's bbref headshot."""
    cache = _load(BBREF_IMAGE_STATUS_PATH)
    if external_id in cache:
        return cache[external_id]
    if not bbref_id:
        return "missing"

    import requests

    def _check() -> str:
        resp = requests.head(HEADSHOT_URL.format(id=bbref_id), headers=HEADERS, timeout=20)
        return "ok" if resp.status_code == 200 else "missing"

    try:
        status = with_retry(_check)
    except Exception:
        status = "error"
    cache[external_id] = status
    _save(BBREF_IMAGE_STATUS_PATH, cache)
    return status


def _name_matches(player_name: str, title: str) -> bool:
    """True when the article title names this player (ignoring disambiguation)."""
    base = DISAMBIG_RE.sub("", title).strip()
    if not base:
        return False
    parts = player_name.split()
    first = parts[0].lower()
    last = parts[-1].lower() if len(parts) > 1 else first
    lowered = base.lower()
    return first in lowered and last in lowered


def _pageimage(title: str) -> str | None:
    import requests

    _pace()
    resp = requests.get(
        WIKIPEDIA_API,
        params={
            "action": "query",
            "titles": title,
            "prop": "pageimages",
            "piprop": "thumbnail",
            "pithumbsize": 320,
            "format": "json",
        },
        headers=HEADERS,
        timeout=30,
    )
    resp.raise_for_status()
    for page in resp.json().get("query", {}).get("pages", {}).values():
        source = page.get("thumbnail", {}).get("source")
        if source and source.startswith("https://upload.wikimedia.org/"):
            return source
    return None


def wikipedia_thumbnail(player_name: str) -> str | None:
    """Return a hotlinkable Wikipedia thumbnail of the named player, or None."""
    import requests

    # 1. Exact-title lookup: only the article named after the player is eligible.
    exact = with_retry(lambda: _pageimage(player_name))
    if exact:
        return exact

    # 2. Search fallback: accept only hits whose title names the player.
    def _search() -> list[str]:
        _pace()
        resp = requests.get(
            WIKIPEDIA_API,
            params={
                "action": "query",
                "list": "search",
                "srsearch": f"{player_name} basketball",
                "srlimit": 5,
                "format": "json",
            },
            headers=HEADERS,
            timeout=30,
        )
        resp.raise_for_status()
        return [
            hit["title"]
            for hit in resp.json().get("query", {}).get("search", [])
            if _name_matches(player_name, hit["title"])
        ]

    try:
        for title in with_retry(_search):
            found = _pageimage(title)
            if found:
                return found
    except Exception:
        return None
    return None


def resolve_photo(external_id: str, display_name: str, bbref_id: str | None) -> str | None:
    """Return a cached or freshly resolved Wikipedia photo URL for a player."""
    cache = _load(WIKIPEDIA_PHOTOS_PATH)
    if external_id in cache:
        return cache[external_id] or None

    photo: str | None = None
    if bbref_image_status(external_id, bbref_id) != "ok":
        photo = wikipedia_thumbnail(display_name)
        if photo:
            print(f"    [photo] {display_name} ({external_id}) <- wikipedia")

    cache[external_id] = photo or ""
    _save(WIKIPEDIA_PHOTOS_PATH, cache)
    return photo


def ensure_photos(players: list[dict[str, Any]]) -> None:
    """Fill altIds.photoUrl on pool player records (in place)."""
    pending = [p for p in players if p.get("altIds", {}).get("photoUrl") is None]
    if not pending:
        return
    for player in pending:
        alt_ids = player.setdefault("altIds", {})
        alt_ids["photoUrl"] = resolve_photo(
            player["playerExternalId"],
            player["displayName"],
            alt_ids.get("bbref"),
        )


if __name__ == "__main__":
    ensure_photos([])
