"""Configuration for the nba_api import pipeline."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DATA = REPO_ROOT / "public" / "data"
NBA_ROOT = PUBLIC_DATA / "nba"
SHARED_ROOT = PUBLIC_DATA / "shared"
RAW_CACHE = REPO_ROOT / ".raw_nba_cache"
RAW_CACHE.mkdir(exist_ok=True)

CURRENT_SEASON_END_YEAR = 2026  # 2025-26 season

DEFAULT_SEASONS = [
    "2025-26",
    "2024-25",
    "2023-24",
    "2022-23",
    "2021-22",
    "2020-21",
    "2019-20",
    "2018-19",
    "2017-18",
    "2016-17",
    "2015-16",
    "2014-15",
    "2013-14",
    "2012-13",
    "2011-12",
    "2010-11",
    "2009-10",
    "2008-09",
    "2007-08",
    "2006-07",
    "2005-06",
    "2004-05",
    "2003-04",
    "2002-03",
    "2001-02",
    "2000-01",
    "1999-00",
    "1998-99",
    "1997-98",
    "1996-97",
    "1995-96",
]

RATE_LIMIT_SECONDS = float(os.environ.get("DD_NBA_RATE_LIMIT", "0.4"))
MAX_RETRIES = int(os.environ.get("DD_NBA_MAX_RETRIES", "6"))
MAX_WORKERS = int(os.environ.get("DD_NBA_MAX_WORKERS", "6"))


def season_to_season_type(season: str) -> str:
    """nba_api expects '2024-25' style season strings."""
    return season


def season_to_nba_api_season(season: str) -> str:
    """nba_api uses '2024-25' for the 2024-25 season. We store the same string."""
    return season


def output_dir(season: str) -> Path:
    return NBA_ROOT / season


def ensure_output_dir(season: str) -> Path:
    out = output_dir(season)
    out.mkdir(parents=True, exist_ok=True)
    return out
