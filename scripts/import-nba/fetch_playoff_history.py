from __future__ import annotations

import csv
import hashlib
import json
import math
import urllib.request
from collections import defaultdict

from fetch_postseason import config, util

VERSION = 533
SOURCE = f'https://www.kaggle.com/datasets/eoinamoore/historical-nba-data-and-player-box-scores/versions/{VERSION}'
CACHE = config.RAW_CACHE / 'playoff-model'
SHOT_COLUMNS = ('fieldGoalsMade', 'threePointersMade', 'threePointersAttempted', 'freeThrowsMade')
COLUMNS = ('points', 'assists', 'reboundsTotal', 'turnovers', 'fieldGoalsAttempted', 'freeThrowsAttempted', 'reboundsOffensive')


def game_season(game_id):
    identity = str(game_id).zfill(10)
    if len(identity) != 10 or identity[:3] not in ('002', '004'):
        return None
    year = int(identity[3:5])
    year += 1900 if year >= 46 else 2000
    return f'{year}-{(year + 1) % 100:02d}'


def download(name):
    path = CACHE / f'kaggle-v{VERSION}-{name}'
    if not path.exists():
        url = f'https://www.kaggle.com/api/v1/datasets/download/eoinamoore/historical-nba-data-and-player-box-scores/{name}?datasetVersionNumber={VERSION}'
        temporary = path.with_suffix('.download')
        with urllib.request.urlopen(url, timeout=60) as response, temporary.open('wb') as output:
            while block := response.read(1024 * 1024):
                output.write(block)
        temporary.replace(path)
    return path


def normalized_row(row, game):
    if row['numMinutes'] == '' or row.get('comment', '').startswith(('DNP', 'DND', 'NWT')):
        return None
    minutes = float(row['numMinutes'])
    if not math.isfinite(minutes) or minutes < 0:
        raise ValueError(f'Invalid minutes in {row["gameId"]}')
    team = row['playerteamId']
    if team not in (game['hometeamId'], game['awayteamId']):
        return None
    values = {}
    for column in COLUMNS:
        if not row[column]:
            return None
        value = float(row[column])
        if not math.isfinite(value) or value < 0:
            raise ValueError(f'Invalid {column} in {row["gameId"]}')
        values[column] = value
    return {'season_year': game_season(row['gameId']), 'gameId': row['gameId'], 'teamId': team, 'personId': row['personId'], 'minutes': f'{minutes:.12f}', 'minutePrecision': int(minutes.is_integer()), **{c: row.get(c, '') for c in SHOT_COLUMNS}, **values}


def normalize_game_minutes(rows):
    if not rows:
        return
    raw = [float(row['minutes']) for row in rows]
    teams = sorted({row['teamId'] for row in rows})
    whole = all(value.is_integer() for value in raw)
    candidates = [raw]
    seconds = [round((value % 1) * 100) for value in raw]
    if not whole and all(second < 60 and abs((value % 1) * 100 - second) < .00001 for value, second in zip(raw, seconds)):
        candidates.append([math.floor(value) + second / 60 for value, second in zip(raw, seconds)])
    def duration_error(values):
        totals = [sum(value for row, value in zip(rows, values) if row['teamId'] == team) for team in teams]
        duration = 240 + 25 * max(0, round((max(totals) - 240) / 25))
        return sum(abs(total - duration) for total in totals)
    selected = min(candidates, key=duration_error)
    for row, value in zip(rows, selected):
        row['minutes'] = f'{value:.12f}'
        row['minutePrecision'] = int(whole)


def main():
    CACHE.mkdir(exist_ok=True)
    games_path, players_path = download('Games.csv'), download('PlayerStatistics.csv')
    with games_path.open(encoding='utf-8-sig', newline='') as file:
        games = {r['gameId']: r for r in csv.DictReader(file) if (season := game_season(r['gameId'])) and '1977-78' <= season <= '2025-26' and not '2010-11' <= season <= '2023-24'}
    grouped = defaultdict(list)
    incomplete = set()
    seen = {}
    with players_path.open(encoding='utf-8-sig', newline='') as file:
        for row in csv.DictReader(file):
            game = games.get(row['gameId'])
            if game is None:
                continue
            normalized = normalized_row(row, game)
            if normalized is None:
                if float(row['numMinutes'] or 0) > 0 or any(float(row[c] or 0) > 0 for c in COLUMNS):
                    incomplete.add(row['gameId'])
                continue
            key = (row['gameId'], normalized['teamId'], row['personId'])
            if key in seen:
                if seen[key] != normalized:
                    incomplete.add(row['gameId'])
                continue
            seen[key] = normalized
            grouped[row['gameId']].append(normalized)
    counts = defaultdict(lambda: {'regularGames': 0, 'playoffGames': 0, 'rejectedGames': 0})
    names = ['historical-regular.csv', 'historical-playoffs.csv']
    files = [(CACHE / name).open('w', encoding='utf-8', newline='') for name in names]
    writers = [csv.DictWriter(file, fieldnames=('season_year', 'gameId', 'teamId', 'personId', 'minutes', 'minutePrecision', *SHOT_COLUMNS, *COLUMNS)) for file in files]
    try:
        for writer in writers:
            writer.writeheader()
        for game_id, game in sorted(games.items()):
            season = game_season(game_id)
            rows = grouped.get(game_id, [])
            normalize_game_minutes(rows)
            valid = game_id not in incomplete
            totals = []
            uncertainties = []
            for side in ('home', 'away'):
                team = game[f'{side}teamId']
                own = [r for r in rows if r['teamId'] == team]
                minute_total = sum(float(r['minutes']) for r in own)
                totals.append(minute_total)
                uncertainties.append(sum(r['minutePrecision'] for r in own))
                valid &= bool(own) and minute_total >= 225 and sum(r['points'] for r in own) == float(game[f'{side}Score'])
            duration = 240 + 25 * max(0, round((max(totals) - 240) / 25))
            valid &= all(abs(total - duration) <= max(1, precision) for total, precision in zip(totals, uncertainties))
            if not valid:
                counts[season]['rejectedGames'] += 1
                continue
            playoffs = str(game_id).zfill(10).startswith('004')
            writers[int(playoffs)].writerows(rows)
            counts[season]['playoffGames' if playoffs else 'regularGames'] += 1
    finally:
        for file in files:
            file.close()
    hashes = {}
    for path in (games_path, players_path):
        with path.open('rb') as file:
            hashes[path.name] = hashlib.file_digest(file, 'sha256').hexdigest()
    util.write_json(config.NBA_ROOT / 'playoff-history-coverage.json', {'source': SOURCE, 'version': VERSION, 'sha256': hashes, 'seasons': dict(sorted(counts.items()))})
    print(json.dumps(dict(sorted(counts.items())), indent=2))


if __name__ == '__main__':
    main()
