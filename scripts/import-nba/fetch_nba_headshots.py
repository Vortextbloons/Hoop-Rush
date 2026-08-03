"""Detect whether the NBA CDN hosts a real headshot or only the generic silhouette.

Output cache: .raw_nba_cache/nba_headshot_status.json  {nba externalId -> bool}

The CDN returns HTTP 200 for every player id, but missing photos are always the
same ~12 KB placeholder PNG. Build-time pool records carry that result as
altIds.nbaHeadshotAvailable so the UI can prefer NBA when a real photo exists.

The in-memory cache is loaded once per process, network checks run concurrently,
and the disk cache is flushed every FLUSH_EVERY lookups so interrupted runs
resume cleanly (mirrors scripts/annotate-markers.mjs).
"""

from __future__ import annotations

import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from .config import RAW_CACHE

NBA_HEADSHOT_STATUS_PATH = RAW_CACHE / "nba_headshot_status.json"
NBA_HEADSHOT_URL = "https://cdn.nba.com/headshots/nba/latest/1040x760/{id}.png"
NBA_PLACEHOLDER_BYTES = 12430
DEFAULT_WORKERS = 8
FLUSH_EVERY = 50
REQUEST_TIMEOUT = 15

HEADERS = {
    "User-Agent": (
        "HoopRush/1.0 (build-time asset resolver; contact: hooprush@example.com) "
        "requests/1 +https://github.com/"
    )
}

_cache: dict[str, bool] = {}
_cache_loaded = False
_cache_lock = threading.Lock()
_dirty = 0


def _load_disk() -> dict[str, bool]:
    if not NBA_HEADSHOT_STATUS_PATH.exists():
        return {}
    try:
        raw = json.loads(NBA_HEADSHOT_STATUS_PATH.read_text(encoding="utf-8"))
        return {str(key): bool(value) for key, value in raw.items()}
    except Exception:
        return {}


def _save_disk(cache: dict[str, bool]) -> None:
    NBA_HEADSHOT_STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = NBA_HEADSHOT_STATUS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cache, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, NBA_HEADSHOT_STATUS_PATH)


def _ensure_loaded() -> None:
    global _cache, _cache_loaded
    with _cache_lock:
        if not _cache_loaded:
            _cache = _load_disk()
            _cache_loaded = True


def _record(external_id: str, available: bool) -> None:
    global _dirty
    with _cache_lock:
        _cache[external_id] = available
        _dirty += 1
        if _dirty >= FLUSH_EVERY:
            _save_disk(_cache)
            _dirty = 0


def flush_cache() -> None:
    """Persist any in-memory cache updates not yet flushed to disk."""
    global _dirty
    with _cache_lock:
        if _dirty > 0:
            _save_disk(_cache)
            _dirty = 0


def _head_check(external_id: str) -> bool:
    import requests

    try:
        resp = requests.head(
            NBA_HEADSHOT_URL.format(id=external_id),
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT,
            allow_redirects=True,
        )
        if resp.status_code != 200:
            return False
        content_length = resp.headers.get("Content-Length")
        if content_length is None:
            return True
        return int(content_length) != NBA_PLACEHOLDER_BYTES
    except Exception:
        return False


def nba_headshot_available(external_id: str) -> bool:
    """Return True when the NBA CDN hosts a non-placeholder headshot for this player."""
    _ensure_loaded()
    with _cache_lock:
        if external_id in _cache:
            return _cache[external_id]

    available = _head_check(external_id)
    _record(external_id, available)
    return available


def annotate_nba_headshots(
    players: list[dict[str, Any]],
    *,
    workers: int = DEFAULT_WORKERS,
) -> None:
    """Fill altIds.nbaHeadshotAvailable on pool player records (in place)."""
    _ensure_loaded()
    pending = [p for p in players if (p.get("altIds") or {}).get("nbaHeadshotAvailable") is None]
    if not pending:
        return

    uncached: list[str] = []
    seen: set[str] = set()
    for player in pending:
        external_id = str(player.get("playerExternalId", ""))
        if not external_id or external_id in seen:
            continue
        seen.add(external_id)
        with _cache_lock:
            if external_id not in _cache:
                uncached.append(external_id)

    if uncached:
        worker_count = max(1, workers)

        def check_one(external_id: str) -> tuple[str, bool]:
            return external_id, _head_check(external_id)

        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [executor.submit(check_one, external_id) for external_id in uncached]
            for future in as_completed(futures):
                external_id, available = future.result()
                _record(external_id, available)

    for player in pending:
        external_id = str(player.get("playerExternalId", ""))
        if not external_id:
            continue
        with _cache_lock:
            available = _cache.get(external_id, False)
        alt_ids = dict(player.get("altIds") or {})
        alt_ids["nbaHeadshotAvailable"] = available
        player["altIds"] = alt_ids

    flush_cache()


if __name__ == "__main__":
    annotate_nba_headshots([])
