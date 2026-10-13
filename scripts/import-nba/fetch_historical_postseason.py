from __future__ import annotations

import argparse
import concurrent.futures
import json

from fetch_postseason import number, config, util


def fetch_player(identity):
    from nba_api.stats.endpoints.playercareerstats import PlayerCareerStats
    rows = util.read_cache('player_postseason_totals', player=identity)
    if rows is not None:
        return identity, rows
    util.rate_limit_sleep()
    response = PlayerCareerStats(player_id=identity, per_mode36='Totals', timeout=8)
    rows = response.get_normalized_dict()['SeasonTotalsPostSeason']
    util.write_cache('player_postseason_totals', rows, player=identity)
    return identity, rows


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache-only', action='store_true')
    parser.add_argument('--workers', type=int, default=2)
    args = parser.parse_args()
    players = set()
    season_players = {}
    workloads = {}
    seasons = [season for season in config.DEFAULT_SEASONS if season < '1996-97']
    for season in seasons:
        rows = json.loads((config.NBA_ROOT / season / 'season-stats.json').read_text(encoding='utf-8'))
        season_players[season] = {row['playerExternalId'] for row in rows if (row.get('minutes') or 0) >= 400}
        players.update(season_players[season])
        for row in rows:
            identity = row['playerExternalId']
            workloads[identity] = max(workloads.get(identity, 0), row.get('minutes') or 0)
    by_season = {season: {} for season in seasons}
    failures = []
    retrieved = set()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        ordered = sorted(players, key=lambda identity: (-workloads[identity], identity))
        if args.cache_only:
            ordered = [identity for identity in ordered if util.read_cache('player_postseason_totals', player=identity) is not None]
        futures = {executor.submit(fetch_player, identity): identity for identity in ordered}
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            try:
                identity, rows = future.result()
                retrieved.add(identity)
                for row in rows:
                    season = row['SEASON_ID']
                    if season not in by_season:
                        continue
                    team = str(row.get('TEAM_ID', ''))
                    current = by_season[season].get(identity)
                    if current is None or team == '0':
                        by_season[season][identity] = row
            except Exception as error:
                failures.append(futures[future])
                print(f'Unavailable {futures[future]}: {error}', flush=True)
            if index % 50 == 0:
                print(f'Historical postseason: {index}/{len(players)} players', flush=True)
    for season, rows in by_season.items():
        records = []
        missing = sorted(season_players[season] - retrieved)
        for identity, row in sorted(rows.items()):
            points, fga, fta = number(row, 'PTS'), number(row, 'FGA'), number(row, 'FTA')
            minutes, games = number(row, 'MIN'), number(row, 'GP')
            if not minutes or not games or points is None or fga is None or fta is None:
                continue
            denominator = 2 * (fga + 0.44 * fta)
            records.append({
                'playerExternalId': identity, 'gamesPlayed': int(games), 'minutes': minutes,
                'points': points, 'assists': number(row, 'AST') or 0,
                'rebounds': number(row, 'REB') or 0,
                'offensiveRebounds': number(row, 'OREB') if season >= '1973-74' else None,
                'defensiveRebounds': number(row, 'DREB') if season >= '1973-74' else None,
                'steals': number(row, 'STL') if season >= '1973-74' else None,
                'blocks': number(row, 'BLK') if season >= '1973-74' else None,
                'turnovers': number(row, 'TOV') if season >= '1977-78' else None,
                'fga': fga, 'fta': fta, 'tsPct': min(1.5, points / denominator) if denominator > 0 else None,
            })
        util.write_json(config.NBA_ROOT / season / 'postseason-stats.json', {
            'schemaVersion': 1, 'season': season,
            'sources': ['https://stats.nba.com/stats/playercareerstats'],
            'status': 'available' if records else 'unavailable', 'players': records,
            'coverage': { 'eligiblePlayerCount': len(season_players[season]), 'retrievedPlayerCount': len(season_players[season] & retrieved), 'missingPlayerIds': missing },
        })
        print(f'{season}: {len(records)} historical postseason player-seasons', flush=True)
    if failures:
        raise SystemExit(f'Missing historical player sources: {len(failures)}; retry to fill cache')
