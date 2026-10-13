from __future__ import annotations

import argparse
import concurrent.futures
import importlib
import math
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PACKAGE = '_hoop_rush_import'
if PACKAGE not in sys.modules:
    package = types.ModuleType(PACKAGE)
    package.__path__ = [str(ROOT)]
    sys.modules[PACKAGE] = package
config = importlib.import_module(f'{PACKAGE}.config')
util = importlib.import_module(f'{PACKAGE}.util')


def number(row, key):
    value = row.get(key)
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) and value >= 0 else None


def fetch(season):
    from nba_api.stats.endpoints import leaguedashplayerstats, leagueleaders
    rows = util.read_cache('postseason_totals', season=season)
    sources = ['https://stats.nba.com/stats/leaguedashplayerstats']
    if rows is None:
        util.rate_limit_sleep()
        try:
            response = leaguedashplayerstats.LeagueDashPlayerStats(
                season=season, season_type_all_star='Playoffs',
                per_mode_detailed='Totals', timeout=20)
            rows = response.get_normalized_dict()['LeagueDashPlayerStats']
            if not rows and season < '1996-97':
                util.rate_limit_sleep()
                response = leagueleaders.LeagueLeaders(
                    season=season, season_type_all_star='Playoffs',
                    per_mode48='Totals', timeout=20)
                rows = response.get_normalized_dict()['LeagueLeaders']
                sources.append('https://stats.nba.com/stats/leagueleaders')
            util.write_cache('postseason_totals', rows, season=season)
            util.write_cache('postseason_sources', sources, season=season)
        except Exception as error:
            print(f'{season}: postseason unavailable: {error}', flush=True)
            return False
    else:
        sources = util.read_cache('postseason_sources', season=season) or sources
    players = []
    for row in rows:
        gp, minutes = number(row, 'GP'), number(row, 'MIN')
        if not gp or not minutes:
            continue
        points, fga, fta = number(row, 'PTS'), number(row, 'FGA'), number(row, 'FTA')
        if points is None or fga is None or fta is None:
            raise ValueError(f'{season}: incomplete postseason scoring totals')
        denominator = 2 * (fga + 0.44 * fta)
        players.append({
            'playerExternalId': str(row['PLAYER_ID']),
            'gamesPlayed': int(gp), 'minutes': minutes,
            'points': points, 'assists': number(row, 'AST') or 0,
            'rebounds': number(row, 'REB') or 0,
            'offensiveRebounds': number(row, 'OREB'),
            'defensiveRebounds': number(row, 'DREB'),
            'steals': number(row, 'STL'), 'blocks': number(row, 'BLK'),
            'turnovers': number(row, 'TOV'), 'fga': fga, 'fta': fta,
            'tsPct': min(1.5, points / denominator) if denominator > 0 else None,
        })
    players.sort(key=lambda row: row['playerExternalId'])
    util.write_json(config.NBA_ROOT / season / 'postseason-stats.json', {
        'schemaVersion': 1, 'season': season, 'sources': sources,
        'status': 'available' if players else 'unavailable', 'players': players,
    })
    print(f'{season}: {len(players)} postseason player-seasons', flush=True)
    return True


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--seasons', default=','.join(season for season in config.DEFAULT_SEASONS if season >= '1996-97'))
    parser.add_argument('--workers', type=int, default=3)
    args = parser.parse_args()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        outcomes = list(executor.map(fetch, args.seasons.split(',')))
    if not all(outcomes):
        raise SystemExit(1)
