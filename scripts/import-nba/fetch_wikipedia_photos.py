"""Resolve Wikipedia thumbnails for players without a usable fallback photo.

Output: .raw_nba_cache/wikipedia_photos.json  {nba externalId -> full image URL}

The module also maintains a per-player bbref headshot status cache
(.raw_nba_cache/bbref_image_status.json) so repeated pool builds only touch
the network for players whose status is unknown. Players whose bbref image is
missing (404) or who have no bbref id are resolved through the Wikipedia API.

Only thumbnails from an article whose title names the player are accepted;
search hits about other people or places (e.g. a hometown article) are
rejected so a wrong face is never packaged.

Bulk resolution runs concurrently: both caches are loaded into memory once,
resolve_photo mutates them under a shared lock, and the caller saves them at
the end (atomic temp-file + rename, so an interrupted run never truncates the
cache and only loses work since the last flush). Wikipedia requests are paced
by a process-wide RateLimiter shared across workers, so concurrency never
exceeds the configured requests-per-second; the global with_retry limiter is
not double-applied to wiki calls.
"""

from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path
from typing import Any

from .config import RAW_CACHE
from .util import RateLimiter, with_retry

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
# burst rate: HOOP_RUSH_WIKI_PACE_SECONDS=0.25. Shared across all workers.
WIKI_LIMITER = RateLimiter(float(os.environ.get("HOOP_RUSH_WIKI_PACE_SECONDS", "1.0")))


def _load(path: Any) -> dict[str, str]:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save(path: Any, value: dict[str, str]) -> None:
    # Atomic write: an interrupted run must never truncate the cache, or
    # every previously resolved photo is lost on the next lookup.
    tmp = Path(path).with_suffix(".json.tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)


def load_bbref_status() -> dict[str, str]:
    return _load(BBREF_IMAGE_STATUS_PATH)


def load_wikipedia_photos() -> dict[str, str]:
    return _load(WIKIPEDIA_PHOTOS_PATH)


def save_bbref_status(cache: dict[str, str]) -> None:
    _save(BBREF_IMAGE_STATUS_PATH, cache)


def save_wikipedia_photos(cache: dict[str, str]) -> None:
    _save(WIKIPEDIA_PHOTOS_PATH, cache)


def bbref_image_status(
    external_id: str,
    bbref_id: str | None,
    status_cache: dict[str, str],
    cache_lock: threading.Lock,
) -> str:
    """Return 'ok', 'missing', or 'error' for a player's bbref headshot."""
    cached = status_cache.get(external_id)
    if cached is not None:
        return cached
    if not bbref_id:
        with cache_lock:
            status_cache.setdefault(external_id, "missing")
        return "missing"

    import requests

    def _check() -> str:
        resp = requests.head(HEADSHOT_URL.format(id=bbref_id), headers=HEADERS, timeout=20)
        return "ok" if resp.status_code == 200 else "missing"

    try:
        status = with_retry(_check)
    except Exception:
        status = "error"
    with cache_lock:
        status_cache.setdefault(external_id, status)
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

    WIKI_LIMITER.wait()
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
    # The wiki limiter paces these calls; skip the global limiter to avoid
    # double-waiting on every request.
    exact = with_retry(lambda: _pageimage(player_name), paced=False)
    if exact:
        return exact

    # 2. Search fallback: accept only hits whose title names the player.
    def _search() -> list[str]:
        WIKI_LIMITER.wait()
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
        for title in with_retry(_search, paced=False):
            found = _pageimage(title)
            if found:
                return found
    except Exception:
        return None
    return None


def resolve_photo(
    external_id: str,
    display_name: str,
    bbref_id: str | None,
    status_cache: dict[str, str],
    photo_cache: dict[str, str],
    cache_lock: threading.Lock,
    retry_wikipedia: bool = False,
) -> str | None:
    """Resolve (and cache in memory) a Wikipedia photo URL for a player."""
    cached = photo_cache.get(external_id)
    if cached and not retry_wikipedia:
        return cached or None
    if cached == "" and not retry_wikipedia:
        return None

    photo: str | None = None
    if retry_wikipedia or bbref_image_status(external_id, bbref_id, status_cache, cache_lock) != "ok":
        photo = wikipedia_thumbnail(display_name)
        if photo:
            print(f"    [photo] {display_name} ({external_id}) <- wikipedia")

    with cache_lock:
        photo_cache[external_id] = photo or ""
    return photo


def flush_photos(
    status_cache: dict[str, str],
    photo_cache: dict[str, str],
) -> None:
    """Persist both caches atomically; safe to call at any point."""
    save_bbref_status(status_cache)
    save_wikipedia_photos(photo_cache)


if __name__ == "__main__":
    print(f"bbref status cache: {len(load_bbref_status())} entries")
    photos = load_wikipedia_photos()
    print(
        f"wikipedia photo cache: {len(photos)} entries, "
        f"{sum(1 for v in photos.values() if v)} non-empty"
    )
