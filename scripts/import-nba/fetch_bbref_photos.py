"""Fetch missing photo fallbacks using the existing verified NBA-to-BBRef IDs."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

from .config import PUBLIC_DATA, RAW_CACHE
from .fetch_wikipedia_photos import HEADERS, HEADSHOT_URL, _load, _save
from .util import RateLimiter

PHOTO_PATH = RAW_CACHE / "fallback_photos.json"
LIMITER = RateLimiter(0.5)


def photo_available(response) -> bool:
    return (
        response.status_code == 200
        and response.headers.get("Content-Type", "").split(";")[0] == "image/jpeg"
        and len(response.content) > 1000
        and response.content.startswith(b"\xff\xd8\xff")
        and response.content.endswith(b"\xff\xd9")
    )


def run() -> None:
    import requests

    ids = _load(RAW_CACHE / "bbref_ids.json")
    if not ids:
        raise FileNotFoundError("Run python -m scripts.import-nba.fetch_bbref_ids first")
    photos = _load(PHOTO_PATH)
    players = {}
    for path in sorted((PUBLIC_DATA / "pools").glob("*.json")):
        for player in json.loads(path.read_text(encoding="utf-8"))["players"]:
            players[player["playerExternalId"]] = player
    pending = [p for p in players.values()
               if not p.get("altIds", {}).get("nbaHeadshotAvailable")
               and not p.get("altIds", {}).get("photoUrl")
               and not photos.get(p["playerExternalId"])
               and p["playerExternalId"] in ids]

    def fetch(player):
        key = player["playerExternalId"]
        url = HEADSHOT_URL.format(id=ids[key])
        LIMITER.wait()
        response = requests.get(url, headers=HEADERS, timeout=20)
        if response.status_code in (403, 429):
            raise RuntimeError(f"Basketball Reference returned {response.status_code}; stopping")
        return key, url if photo_available(response) else None

    found = 0
    executor = ThreadPoolExecutor(max_workers=2)
    try:
        for count, (key, url) in enumerate(executor.map(fetch, pending), 1):
            if url:
                photos[key] = url
                found += 1
            if count % 25 == 0 or count == len(pending):
                _save(PHOTO_PATH, photos)
                print(f"BBRef: {count}/{len(pending)} checked; {found} photos found", flush=True)
    finally:
        executor.shutdown(wait=True, cancel_futures=True)
        _save(PHOTO_PATH, photos)


if __name__ == "__main__":
    run()
