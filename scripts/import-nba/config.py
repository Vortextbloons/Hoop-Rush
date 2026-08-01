"""Configuration for the nba_api import pipeline."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DATA = REPO_ROOT / "apps" / "web" / "static" / "data"
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
    "1994-95",
    "1993-94",
    "1992-93",
    "1991-92",
    "1990-91",
]

# Earliest NBA season key in which each current franchise existed, by NBA team
# external id. Rosters are only fetched for teams that existed in the season.
TEAM_FOUNDING_SEASON: dict[str, str] = {
    "1610612737": "1946-47",  # Hawks
    "1610612738": "1946-47",  # Celtics
    "1610612751": "1976-77",  # Nets (ABA before)
    "1610612766": "2004-05",  # Hornets (Bobcats expansion)
    "1610612741": "1966-67",  # Bulls
    "1610612739": "1970-71",  # Cavaliers
    "1610612742": "1980-81",  # Mavericks
    "1610612743": "1976-77",  # Nuggets (ABA before)
    "1610612765": "1948-49",  # Pistons
    "1610612744": "1946-47",  # Warriors
    "1610612745": "1967-68",  # Rockets
    "1610612754": "1976-77",  # Pacers (ABA before)
    "1610612746": "1970-71",  # Clippers (Braves)
    "1610612747": "1948-49",  # Lakers
    "1610612763": "1995-96",  # Grizzlies
    "1610612748": "1988-89",  # Heat
    "1610612749": "1968-69",  # Bucks
    "1610612750": "1989-90",  # Timberwolves
    "1610612740": "1988-89",  # Pelicans (Hornets lineage)
    "1610612752": "1946-47",  # Knicks
    "1610612760": "1967-68",  # Thunder (SuperSonics)
    "1610612753": "1989-90",  # Magic
    "1610612755": "1949-50",  # 76ers
    "1610612756": "1968-69",  # Suns
    "1610612757": "1970-71",  # Trail Blazers
    "1610612758": "1948-49",  # Kings
    "1610612759": "1976-77",  # Spurs (ABA before)
    "1610612761": "1995-96",  # Raptors
    "1610612762": "1974-75",  # Jazz
    "1610612764": "1961-62",  # Wizards
}


def team_exists_in_season(team_external_id: str, season: str) -> bool:
    """Whether an NBA franchise existed during the given season."""
    founding = TEAM_FOUNDING_SEASON.get(team_external_id)
    if founding is None:
        return True
    return season >= founding

RATE_LIMIT_SECONDS = float(os.environ.get("HOOP_RUSH_NBA_RATE_LIMIT", "0.4"))
MAX_RETRIES = int(os.environ.get("HOOP_RUSH_NBA_MAX_RETRIES", "6"))
MAX_WORKERS = int(os.environ.get("HOOP_RUSH_NBA_MAX_WORKERS", "6"))


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
