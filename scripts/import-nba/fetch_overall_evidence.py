from __future__ import annotations

import concurrent.futures
import hashlib
import json
import re
import unicodedata
from html import unescape
from typing import Any

import requests
from nba_api.stats.endpoints.teamyearbyyearstats import TeamYearByYearStats
from nba_api.stats.endpoints.playerawards import PlayerAwards
from nba_api.stats.static.teams import get_teams

from .config import NBA_ROOT, RAW_CACHE, DEFAULT_SEASONS
from .util import read_cache, with_retry, write_cache, write_json


def parse_honors(html: str) -> dict[str, list[str]]:
    result = {}
    for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", html, re.S):
        identity = re.search(r'data-append-csv="([a-z0-9]+)"', row)
        awards = re.search(r'data-stat="awards"[^>]*>(.*?)</td>', row, re.S)
        if not identity or not awards:
            continue
        text = unescape(re.sub(r"<[^>]+>", "", awards.group(1)))
        honors = [value.strip() for value in text.split(',') if re.fullmatch(r"(?:MVP-1|NBA[123]|DEF[12])", value.strip())]
        if honors:
            result[identity.group(1)] = sorted(set(result.get(identity.group(1), []) + honors))
    return result


def normalized(value: str) -> str:
    return re.sub(r'[^a-z]', '', unicodedata.normalize('NFKD', value).lower())


def resolve_identities(html: str, roster: list[dict[str, Any]], stats: list[dict[str, Any]], identities: dict[str, str]) -> dict[str, str]:
    resolved = dict(identities)
    evidence = {row['playerExternalId']: row for row in stats}
    for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", html, re.S):
        cells = {key: unescape(re.sub(r'<[^>]+>', '', value)).strip()
                 for key, value in re.findall(r'data-stat="([a-z_]+)"[^>]*>(.*?)</(?:td|th)>', row, re.S)}
        ref = re.search(r'data-append-csv="([a-z0-9]+)"', row)
        if not ref or not cells.get('awards'):
            continue
        name = cells.get('name_display', cells.get('player', ''))
        candidates = []
        for player in roster:
            identity = player.get('externalId')
            record = evidence.get(identity, {})
            surname = player.get('lastName', '').split()[-1:]
            if not surname or normalized(surname[0]) not in normalized(name):
                continue
            if str(record.get('gamesPlayed')) != cells.get('games'):
                continue
            try:
                if abs(float(record.get('points', -100)) - float(cells.get('pts', -200))) > 1:
                    continue
            except (ValueError, TypeError):
                continue
            candidates.append(identity)
        candidates = sorted(set(candidates))
        if len(candidates) == 1:
            resolved[candidates[0]] = ref.group(1)
    return resolved


def fetch_team(team: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    identity = str(team['id'])
    source = read_cache('team_season_totals', team=identity)
    if source is None:
        source = with_retry(lambda: TeamYearByYearStats(team_id=identity, timeout=20)
                            .get_normalized_dict()['TeamStats'])
        write_cache('team_season_totals', source, team=identity)
    return identity, source


def estimated_pace(row: dict[str, Any]) -> float | None:
    if not row.get('GP') or any(row.get(key) is None for key in ['FGA', 'FTA', 'OREB', 'TOV']):
        return None
    if int(row['YEAR'][:4]) < 1977:
        return None
    value = 0.96 * (row['FGA'] + 0.44 * row['FTA'] - row['OREB'] + row['TOV']) / row['GP']
    return round(value, 4) if 70 <= value <= 150 else None


def fetch_player_awards(identity: str) -> tuple[str, list[dict[str, Any]]]:
    rows = read_cache('player_awards', player=identity)
    if rows is None:
        rows = with_retry(lambda: PlayerAwards(player_id=identity, timeout=20).get_normalized_dict()['PlayerAwards'])
        write_cache('player_awards', rows, player=identity)
    return identity, rows


def honors_from_awards(rows: list[dict[str, Any]], season: str) -> list[str]:
    honors = set()
    for row in rows:
        if row.get('SEASON') != season:
            continue
        description = row.get('DESCRIPTION')
        tier = str(row.get('ALL_NBA_TEAM_NUMBER'))
        if description == 'NBA Most Valuable Player':
            honors.add('MVP-1')
        elif description == 'All-NBA' and tier in ['1', '2', '3']:
            honors.add('NBA' + tier)
        elif description == 'All-Defensive Team' and tier in ['1', '2']:
            honors.add('DEF' + tier)
    return sorted(honors)


def build_season(season: str, teams: dict[str, list[dict[str, Any]]], identities: dict[str, str]) -> dict[str, Any]:
    url = f'https://www.basketball-reference.com/leagues/NBA_{int(season[:4]) + 1}_totals.html'
    cache = RAW_CACHE / f'bbref_season_totals__season={season}.html'
    if not identities:
        html = ''
    elif cache.exists():
        html = cache.read_text(encoding='utf-8')
    else:
        def fetch():
            response = requests.get(url, timeout=20)
            response.raise_for_status()
            if 'data-stat="awards"' not in response.text:
                raise ValueError(f'no season awards table in {url}')
            return response.text
        try:
            html = fetch()
            cache.write_text(html, encoding='utf-8')
        except requests.HTTPError as error:
            if error.response.status_code != 429:
                raise
            html = ''
    honors = parse_honors(html)
    roster = json.loads((NBA_ROOT / season / 'roster.json').read_text(encoding='utf-8'))
    stats = json.loads((NBA_ROOT / season / 'season-stats.json').read_text(encoding='utf-8'))
    packaged = {row.get('externalId') for row in roster}
    roster += [{'externalId': row['playerExternalId']} for row in stats if row['playerExternalId'] not in packaged]
    nba_awards = {}
    if not html:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            nba_awards = dict(pool.map(fetch_player_awards, sorted({row['externalId'] for row in roster if row.get('externalId')})))
    identities = resolve_identities(html, roster, stats, identities)
    stints = json.loads((NBA_ROOT / season / 'stints.json').read_text(encoding='utf-8'))
    by_id = {}
    for stint in stints:
        by_id.setdefault(stint['playerExternalId'], []).append(stint)
    paces = {}
    for identity, records in teams.items():
        row = next((row for row in records if row['YEAR'] == season), None)
        if row:
            paces[identity] = estimated_pace(row)
    players = {}
    matched = set()
    for player in roster:
        identity = player.get('externalId')
        if not identity:
            continue
        ref = identities.get(identity)
        recognition = honors_from_awards(nba_awards[identity], season) if identity in nba_awards else honors.get(ref, [])
        if recognition:
            matched.add(ref)
        exposure = [(paces.get(row['teamExternalId']), row['gamesPlayed']) for row in by_id.get(identity, [])]
        complete = exposure and all(pace is not None and games > 0 for pace, games in exposure)
        pace = sum(pace * games for pace, games in exposure) / sum(games for _, games in exposure) if complete else None
        players[identity] = {
            'honors': recognition,
            'possessionPace': pace,
            'paceSource': 'team-totals-possession-estimate' if pace is not None else None,
        }
    known_unpacked = {ref for identity, ref in identities.items() if identity not in packaged and identity in {row['playerExternalId'] for row in stats}}
    unmatched = sorted(set(honors) - matched - known_unpacked)
    if unmatched:
        raise ValueError(f'{season} unmapped individual honors: {unmatched}')
    complete_shooting = {row['playerExternalId']: row for row in stats if all(isinstance(row.get(key), (int, float)) for key in ['points', 'fga', 'fta'])}
    points = sum(row['points'] for row in complete_shooting.values())
    attempts = sum(row['fga'] + 0.44 * row['fta'] for row in complete_shooting.values())
    result = {
        'schemaVersion': 1, 'version': 'overall-evidence-v1', 'season': season,
        'sources': [url if html else 'https://stats.nba.com/stats/playerawards', 'https://stats.nba.com/stats/teamyearbyyearstats'],
        'recognitionSourceHash': hashlib.sha256((html or json.dumps(nba_awards, sort_keys=True)).encode()).hexdigest(),
        'leagueTrueShooting': points / (2 * attempts) if attempts > 0 else None,
        'players': players,
    }
    write_json(NBA_ROOT / season / 'overall-evidence.json', result)
    print(f'{season}: {sum(bool(row["honors"]) for row in players.values())} recognized players; {sum(row["possessionPace"] is not None for row in players.values())} pace observations', flush=True)
    return result


def run(seasons=DEFAULT_SEASONS):
    identity_path = RAW_CACHE / 'bbref_ids.json'
    identities = json.loads(identity_path.read_text(encoding='utf-8')) if identity_path.exists() else {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        teams = dict(pool.map(fetch_team, get_teams()))
        jobs = [pool.submit(build_season, season, teams, identities) for season in seasons]
        errors = []
        for future in concurrent.futures.as_completed(jobs):
            try:
                future.result()
            except Exception as error:
                errors.append(str(error))
                print('FAILED', error, flush=True)
    if errors:
        raise RuntimeError('\n'.join(errors))


if __name__ == '__main__':
    run()
