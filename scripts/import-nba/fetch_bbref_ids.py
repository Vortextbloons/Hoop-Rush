"""Fetch Basketball-Reference player IDs for every packaged roster player.

Output: .raw_nba_cache/bbref_ids.json  {nba externalId -> bbref id}

The mapping is resolved at build time from bbref's per-letter index pages and
joined to packaged rosters by normalized name, a birth-year estimate derived
from per-season roster age, and career-span overlap. Only the compact mapping
is cached; each letter index is also cached for repeat runs.
"""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

from .config import NBA_ROOT, RAW_CACHE
from .util import read_cache, read_json, write_cache, with_retry

LETTERS = "abcdefghijklmnopqrstuvwxyz"
INDEX_URL = "https://www.basketball-reference.com/players/{letter}/"
BREF_IDS_PATH = RAW_CACHE / "bbref_ids.json"

BODY_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
ID_RE = re.compile(r'data-append-csv="([a-z0-9]+)"')
NAME_RE = re.compile(r'<a href="/players/[a-z]/[a-z0-9]+\.html">([^<]+)</a>')
BIRTH_CSK_RE = re.compile(r'data-stat="birth_date" csk="(\d{8})"')
YEAR_MIN_RE = re.compile(r'data-stat="year_min"[^>]*>(\d{4})<')
YEAR_MAX_RE = re.compile(r'data-stat="year_max"[^>]*>(\d{4})<')

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def normalize_name(name: str) -> str:
    """Lowercase, strip accents/punctuation, drop suffixes and duplicated words."""
    n = unicodedata.normalize("NFKD", name)
    n = "".join(c for c in n if not unicodedata.combining(c))
    n = n.lower().replace("'", "").replace(".", "").replace("-", " ").replace("_", " ")
    parts = n.split()
    if parts and parts[-1] in SUFFIXES:
        parts = parts[:-1]
    changed = True
    while changed:
        changed = False
        for i in range(len(parts) - 1):
            if parts[i] == parts[i + 1]:
                del parts[i]
                changed = True
                break
    return " ".join(parts)


def fetch_index(letter: str) -> list[dict[str, Any]]:
    cached = read_cache("bbref_index_v2", letter=letter)
    if cached is not None:
        return cached

    import requests

    def _do_fetch() -> list[dict[str, Any]]:
        resp = requests.get(
            INDEX_URL.format(letter=letter),
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
                )
            },
            timeout=30,
        )
        resp.raise_for_status()
        # bbref serves UTF-8 without always declaring it; force the correct
        # decoding or accented names (e.g. Marciulionis) arrive mojibake'd.
        resp.encoding = "utf-8"
        players: list[dict[str, Any]] = []
        for row in BODY_RE.findall(resp.text):
            id_match = ID_RE.search(row)
            if not id_match:
                continue
            name_match = NAME_RE.search(row)
            if not name_match:
                continue
            birth_match = BIRTH_CSK_RE.search(row)
            year_min = YEAR_MIN_RE.search(row)
            year_max = YEAR_MAX_RE.search(row)
            birth_year = int(birth_match.group(1)[:4]) if birth_match else None
            players.append(
                {
                    "id": id_match.group(1),
                    "name": name_match.group(1),
                    "birthYear": birth_year,
                    "fromYear": int(year_min.group(1)) if year_min else None,
                    "toYear": int(year_max.group(1)) if year_max else None,
                }
            )
        return players

    players = with_retry(_do_fetch)
    write_cache("bbref_index_v2", players, letter=letter)
    return players


def build_index() -> list[dict[str, Any]]:
    index: list[dict[str, Any]] = []
    for letter in LETTERS:
        index.extend(fetch_index(letter))
    return index


def _season_end_year(season: str) -> int:
    return int(season[:4]) + 1


def roster_players() -> dict[str, dict[str, Any]]:
    """externalId -> {names, ageBirthYears, observedYears} across every season."""
    players: dict[str, dict[str, Any]] = {}
    for season_dir in sorted(p for p in NBA_ROOT.iterdir() if p.is_dir()):
        roster_path = season_dir / "roster.json"
        if not roster_path.exists():
            continue
        end_year = _season_end_year(season_dir.name)
        for player in read_json(roster_path):
            ext = str(player.get("externalId", ""))
            if not ext:
                continue
            record = players.setdefault(
                ext,
                {"names": set(), "ageBirthYears": set(), "observedYears": set()},
            )
            record["names"].add(
                normalize_name(
                    f"{player.get('firstName', '')} {player.get('lastName', '')}".strip()
                )
            )
            record["observedYears"].add(end_year)
            age = player.get("age")
            if isinstance(age, (int, float)) and age > 0:
                record["ageBirthYears"].update({end_year - int(age), end_year - int(age) - 1})
    return players


def overlaps(entry: dict[str, Any], observed_years: set[int]) -> bool:
    lo, hi = entry["fromYear"], entry["toYear"]
    if lo is None or hi is None:
        return True
    return any(y - 1 <= hi and y + 1 >= lo for y in observed_years)


def last_key(name: str) -> str:
    parts = name.split()
    return parts[-1] if parts else name


def run() -> dict[str, str]:
    if BREF_IDS_PATH.exists():
        cached = json.loads(BREF_IDS_PATH.read_text(encoding="utf-8"))
        print(f"  [OK] bbref ids cached ({len(cached)} players)")
        return cached

    print("  fetching bbref player index (26 letter pages)")
    index = build_index()
    print(f"  [OK] bbref index: {len(index)} players")

    by_name: dict[str, list[dict[str, Any]]] = {}
    by_last_year: dict[tuple[str, int | None], list[dict[str, Any]]] = {}
    by_last: dict[str, list[dict[str, Any]]] = {}
    for entry in index:
        key = normalize_name(entry["name"])
        by_name.setdefault(key, []).append(entry)
        lk = last_key(key)
        by_last.setdefault(lk, []).append(entry)
        by_last_year.setdefault((lk, entry["birthYear"]), []).append(entry)

    def unique(entries: list[dict[str, Any]]) -> dict[str, Any] | None:
        return entries[0] if len(entries) == 1 else None

    players = roster_players()
    mapping: dict[str, str] = {}
    unmatched: list[tuple[str, str, int | None]] = []
    ambiguous: list[tuple[str, str, int | None]] = []

    for ext, record in players.items():
        primary_name = sorted(record["names"])[0]
        age_birth_years = record["ageBirthYears"]
        observed_years = record["observedYears"]
        name_keys = sorted(record["names"])
        last_keys = {last_key(n) for n in name_keys}

        candidate: dict[str, Any] | None = None

        # 1. Full normalized name + career overlap (+ birth-year narrowing).
        candidates = [
            e for n in name_keys for e in by_name.get(n, []) if overlaps(e, observed_years)
        ]
        if age_birth_years:
            narrowed = [e for e in candidates if e["birthYear"] in age_birth_years]
            if narrowed:
                candidates = narrowed
        candidate = unique(candidates)

        # 2. Last name + age-derived birth year (covers nickname variants
        #    like "Danny Schayes" vs "Dan Schayes").
        if candidate is None and age_birth_years:
            for by in sorted(age_birth_years):
                for lk in last_keys:
                    entries = [
                        e for e in by_last_year.get((lk, by), []) if overlaps(e, observed_years)
                    ]
                    if unique(entries) is not None:
                        candidate = unique(entries)
                        break
                if candidate is not None:
                    break

        # 3. Unique last name + overlap.
        if candidate is None:
            for lk in last_keys:
                entries = [e for e in by_last.get(lk, []) if overlaps(e, observed_years)]
                if unique(entries) is not None:
                    candidate = unique(entries)
                    break

        # 4. Unique full name without career data (index without years).
        if candidate is None:
            candidates = [e for n in name_keys for e in by_name.get(n, [])]
            candidate = unique(candidates)

        if candidate is not None:
            mapping[ext] = candidate["id"]
            continue
        unmatched.append((ext, primary_name, None))

    BREF_IDS_PATH.write_text(json.dumps(mapping, indent=2, sort_keys=True), encoding="utf-8")
    print(f"  [OK] mapped {len(mapping)}/{len(players)} roster players to bbref ids")
    if unmatched:
        print(f"  [WARN] {len(unmatched)} unmatched roster players")
        for ext, name, year in unmatched[:10]:
            print(f"    - {name} ({year}) ext {ext}")
    return mapping


if __name__ == "__main__":
    run()
