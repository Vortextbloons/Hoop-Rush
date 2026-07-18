"""Historical champions list.

nba_api does not have a clean historical champions endpoint, so this script
generates a hand-curated fallback when the JSON does not exist, then writes
the canonical public/data/shared/champions.json.

Edit CHAMPIONS_HISTORY below to add seasons. The importer will not overwrite
an existing champions.json unless --force is passed.
"""

from __future__ import annotations

from .config import SHARED_ROOT
from .util import write_json

CHAMPIONS_HISTORY: list[dict[str, str]] = [
    {"season": "2024-25", "championAbbrev": "OKC", "runnerUpAbbrev": "IND", "finalsMvpName": "Shai Gilgeous-Alexander", "seriesResult": "4-3"},
    {"season": "2023-24", "championAbbrev": "BOS", "runnerUpAbbrev": "DAL", "finalsMvpName": "Jaylen Brown", "seriesResult": "4-1"},
    {"season": "2022-23", "championAbbrev": "DEN", "runnerUpAbbrev": "MIA", "finalsMvpName": "Nikola Jokic", "seriesResult": "4-1"},
    {"season": "2021-22", "championAbbrev": "GSW", "runnerUpAbbrev": "BOS", "finalsMvpName": "Stephen Curry", "seriesResult": "4-2"},
    {"season": "2020-21", "championAbbrev": "MIL", "runnerUpAbbrev": "PHX", "finalsMvpName": "Giannis Antetokounmpo", "seriesResult": "4-2"},
    {"season": "2019-20", "championAbbrev": "LAL", "runnerUpAbbrev": "MIA", "finalsMvpName": "LeBron James", "seriesResult": "4-2"},
    {"season": "2018-19", "championAbbrev": "TOR", "runnerUpAbbrev": "GSW", "finalsMvpName": "Kawhi Leonard", "seriesResult": "4-2"},
    {"season": "2017-18", "championAbbrev": "GSW", "runnerUpAbbrev": "CLE", "finalsMvpName": "Kevin Durant", "seriesResult": "4-0"},
    {"season": "2016-17", "championAbbrev": "GSW", "runnerUpAbbrev": "CLE", "finalsMvpName": "Kevin Durant", "seriesResult": "4-1"},
    {"season": "2015-16", "championAbbrev": "CLE", "runnerUpAbbrev": "GSW", "finalsMvpName": "LeBron James", "seriesResult": "4-3"},
    {"season": "2014-15", "championAbbrev": "GSW", "runnerUpAbbrev": "CLE", "finalsMvpName": "Andre Iguodala", "seriesResult": "4-2"},
    {"season": "2013-14", "championAbbrev": "SAS", "runnerUpAbbrev": "MIA", "finalsMvpName": "Kawhi Leonard", "seriesResult": "4-1"},
    {"season": "2012-13", "championAbbrev": "MIA", "runnerUpAbbrev": "SAS", "finalsMvpName": "LeBron James", "seriesResult": "4-3"},
    {"season": "2011-12", "championAbbrev": "MIA", "runnerUpAbbrev": "OKC", "finalsMvpName": "LeBron James", "seriesResult": "4-1"},
    {"season": "2010-11", "championAbbrev": "DAL", "runnerUpAbbrev": "MIA", "finalsMvpName": "Dirk Nowitzki", "seriesResult": "4-2"},
    {"season": "2009-10", "championAbbrev": "LAL", "runnerUpAbbrev": "BOS", "finalsMvpName": "Kobe Bryant", "seriesResult": "4-3"},
    {"season": "2008-09", "championAbbrev": "LAL", "runnerUpAbbrev": "ORL", "finalsMvpName": "Kobe Bryant", "seriesResult": "4-1"},
    {"season": "2007-08", "championAbbrev": "BOS", "runnerUpAbbrev": "LAL", "finalsMvpName": "Paul Pierce", "seriesResult": "4-2"},
    {"season": "2006-07", "championAbbrev": "SAS", "runnerUpAbbrev": "CLE", "finalsMvpName": "Tony Parker", "seriesResult": "4-0"},
    {"season": "2005-06", "championAbbrev": "MIA", "runnerUpAbbrev": "DAL", "finalsMvpName": "Dwyane Wade", "seriesResult": "4-2"},
    {"season": "2004-05", "championAbbrev": "SAS", "runnerUpAbbrev": "DET", "finalsMvpName": "Tim Duncan", "seriesResult": "4-3"},
    {"season": "2003-04", "championAbbrev": "DET", "runnerUpAbbrev": "LAL", "finalsMvpName": "Chauncey Billups", "seriesResult": "4-1"},
    {"season": "2002-03", "championAbbrev": "SAS", "runnerUpAbbrev": "NJN", "finalsMvpName": "Tim Duncan", "seriesResult": "4-2"},
    {"season": "2001-02", "championAbbrev": "LAL", "runnerUpAbbrev": "NJN", "finalsMvpName": "Shaquille O'Neal", "seriesResult": "4-0"},
    {"season": "2000-01", "championAbbrev": "LAL", "runnerUpAbbrev": "PHI", "finalsMvpName": "Shaquille O'Neal", "seriesResult": "4-1"},
    {"season": "1999-00", "championAbbrev": "LAL", "runnerUpAbbrev": "IND", "finalsMvpName": "Shaquille O'Neal", "seriesResult": "4-2"},
    {"season": "1998-99", "championAbbrev": "SAS", "runnerUpAbbrev": "NYK", "finalsMvpName": "Tim Duncan", "seriesResult": "4-1"},
    {"season": "1997-98", "championAbbrev": "CHI", "runnerUpAbbrev": "UTA", "finalsMvpName": "Michael Jordan", "seriesResult": "4-2"},
    {"season": "1996-97", "championAbbrev": "CHI", "runnerUpAbbrev": "UTA", "finalsMvpName": "Michael Jordan", "seriesResult": "4-2"},
    {"season": "1995-96", "championAbbrev": "CHI", "runnerUpAbbrev": "SEA", "finalsMvpName": "Michael Jordan", "seriesResult": "4-2"},
    {"season": "1994-95", "championAbbrev": "HOU", "runnerUpAbbrev": "ORL", "finalsMvpName": "Hakeem Olajuwon", "seriesResult": "4-0"},
    {"season": "1993-94", "championAbbrev": "HOU", "runnerUpAbbrev": "NYK", "finalsMvpName": "Hakeem Olajuwon", "seriesResult": "4-3"},
    {"season": "1992-93", "championAbbrev": "CHI", "runnerUpAbbrev": "PHO", "finalsMvpName": "Michael Jordan", "seriesResult": "4-2"},
    {"season": "1991-92", "championAbbrev": "CHI", "runnerUpAbbrev": "POR", "finalsMvpName": "Michael Jordan", "seriesResult": "4-2"},
    {"season": "1990-91", "championAbbrev": "CHI", "runnerUpAbbrev": "LAL", "finalsMvpName": "Michael Jordan", "seriesResult": "4-1"},
]


def run(force: bool = False) -> None:
    out = SHARED_ROOT / "champions.json"
    if out.exists() and not force:
        print(f"  · champions.json exists, skipping (use --force to overwrite)")
        return
    write_json(out, {"version": "0.2.0", "updatedAt": "", "champions": CHAMPIONS_HISTORY})
    print(f"  [OK] wrote champions.json ({len(CHAMPIONS_HISTORY)} entries)")
