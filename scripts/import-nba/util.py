"""Shared utilities for the nba_api import pipeline."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Callable, TypeVar

from .config import MAX_RETRIES, RAW_CACHE, RATE_LIMIT_SECONDS

T = TypeVar("T")

# Global rate limiter
_last_request_time = 0.0
_rate_lock = threading.Lock()


def _global_rate_wait() -> None:
    """Thread-safe: wait at least RATE_LIMIT_SECONDS between requests."""
    global _last_request_time
    with _rate_lock:
        now = time.monotonic()
        wait = RATE_LIMIT_SECONDS - (now - _last_request_time)
        if wait > 0:
            time.sleep(wait)
        _last_request_time = time.monotonic()


def cache_key(name: str, **params: Any) -> str:
    safe = name.replace("/", "_")
    suffix = "_".join(f"{k}={v}" for k, v in sorted(params.items()))
    return f"{safe}__{suffix}.json".replace(" ", "_")


def cache_path(name: str, **params: Any) -> Path:
    return RAW_CACHE / cache_key(name, **params)


def read_cache(name: str, **params: Any) -> Any | None:
    p = cache_path(name, **params)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def write_cache(name: str, value: Any, **params: Any) -> None:
    p = cache_path(name, **params)
    p.write_text(json.dumps(value, default=str), encoding="utf-8")


def with_retry(fn: Callable[[], T]) -> T:
    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            _global_rate_wait()
            result = fn()
            if attempt > 0:
                print(f"  [OK] recovered after {attempt} retries")
            return result
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            backoff = min(RATE_LIMIT_SECONDS * (2 ** attempt), 30)
            print(f"  ! attempt {attempt + 1} failed: {exc} -- retrying in {backoff:.1f}s")
            time.sleep(backoff)
    assert last_err is not None
    raise last_err


def rate_limit_sleep() -> None:
    """Thread-safe rate limit sleep."""
    _global_rate_wait()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, default=str), encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def season_label(season: str) -> str:
    return season
