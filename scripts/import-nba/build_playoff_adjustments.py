from __future__ import annotations

import csv
import json
import math
import urllib.request
from collections import defaultdict
from pathlib import Path

from fetch_postseason import config, util

CHANNELS = ('tsPct', 'pointsPer36', 'assistsPer36', 'reboundsPer36', 'turnoversPer36')
COLUMNS = ('points', 'assists', 'reboundsTotal', 'turnovers')
CACHE = config.RAW_CACHE / 'playoff-model'
REVISION = 'a5f108b5b1f08074d78b9e8e901926a9ce4c06c5'
SOURCE = f'https://github.com/NocturneBear/NBA-Data-2010-2024/tree/{REVISION}'
RATES = ('tsPct', 'pointsPer100', 'assistsPer100', 'reboundsPer100', 'turnoversPer100')


def minutes(value):
    if not value:
        return 0.0
    parts = value.split(':')
    return float(parts[0]) + (float(parts[1]) / 60 if len(parts) > 1 else 0)


def load(names):
    games = defaultdict(lambda: defaultdict(list))
    seen = {}
    for name in names:
        with (CACHE / name).open(encoding='utf-8-sig', newline='') as file:
            for row in csv.DictReader(file):
                m = minutes(row['minutes'])
                if m <= 0:
                    continue
                key = (row['gameId'], row['teamId'], row['personId'])
                if key in seen:
                    if any(seen[key][c] != row[c] for c in ('minutes', *COLUMNS, 'fieldGoalsAttempted', 'freeThrowsAttempted', 'reboundsOffensive')):
                        raise ValueError(f'Conflicting game/player {key}')
                    continue
                seen[key] = dict(row)
                row['m'] = m
                for column in (*COLUMNS, 'fieldGoalsAttempted', 'freeThrowsAttempted', 'reboundsOffensive'):
                    row[column] = float(row[column])
                    if not math.isfinite(row[column]) or row[column] < 0:
                        raise ValueError(f'Invalid box score {key}')
                games[row['gameId']][row['teamId']].append(row)
    return games


def totals(rows):
    return {key: sum(row[key] for row in rows) for key in (*COLUMNS, 'fieldGoalsAttempted', 'freeThrowsAttempted', 'reboundsOffensive', 'm')}


def possessions(a, b):
    return sum(t['fieldGoalsAttempted'] + .44 * t['freeThrowsAttempted'] - t['reboundsOffensive'] + t['turnovers'] for t in (a, b)) / 2


def observations(games, defense=None):
    players = defaultdict(list)
    allowed = defaultdict(lambda: [0.0] * 7)
    for game_id, teams in sorted(games.items()):
        if len(teams) != 2:
            raise ValueError(f'Incomplete game {game_id}')
        ids = sorted(teams)
        for own_id, opp_id in (ids, ids[::-1]):
            own, opp = teams[own_id], teams[opp_id]
            a, b = totals(own), totals(opp)
            poss = possessions(a, b)
            if poss <= 0 or abs(a['m'] - b['m']) > 1:
                raise ValueError(f'Invalid possession/minute accounting {game_id}')
            season = own[0]['season_year']
            allowed[(season, opp_id)][0] += poss
            for i, column in enumerate(COLUMNS, 1):
                allowed[(season, opp_id)][i] += a[column]
            allowed[(season, opp_id)][5] += a['fieldGoalsAttempted']
            allowed[(season, opp_id)][6] += a['freeThrowsAttempted']
            for row in own:
                exposure = poss * row['m'] / (a['m'] / 5)
                context = defense[(season, opp_id)] if defense else [0] * 5
                players[(season, row['personId'])].append({
                    'game': game_id, 'opponent': opp_id, 'minutes': row['m'],
                    'possessions': exposure, 'points': row['points'],
                    'tsa': row['fieldGoalsAttempted'] + .44 * row['freeThrowsAttempted'],
                    'values': [row[c] for c in COLUMNS], 'context': context,
                })
    return players, allowed


def summarize(rows):
    poss = sum(r['possessions'] for r in rows)
    tsa = sum(r['tsa'] for r in rows)
    mins = sum(r['minutes'] for r in rows)
    actual = [sum(r['points'] for r in rows) / (2 * tsa) if tsa else None]
    actual += [100 * sum(r['values'][i] for r in rows) / poss for i in range(4)]
    context = [sum(r['context'][0] * r['tsa'] for r in rows) / tsa if tsa else 0]
    context += [sum(r['context'][i + 1] * r['possessions'] for r in rows) / poss for i in range(4)]
    return actual, context, mins, poss


def difference(regular, post):
    actual, context, mins, poss = summarize(post)
    baseline, reg_context, reg_mins, reg_poss = summarize(regular)
    expected = [None if baseline[i] is None else baseline[i] + context[i] - reg_context[i] for i in range(5)]
    delta = [None if actual[i] is None or expected[i] is None else actual[i] - expected[i] for i in range(5)]
    equivalent = [delta[0]] + [d * (reg_poss / reg_mins) * .36 if d is not None else None for d in delta[1:]]
    return actual, expected, equivalent, mins, poss


def main():
    CACHE.mkdir(exist_ok=True)
    for name in ['playoffs.csv'] + [f'regular_season_box_scores_2010_2024_part_{i}.csv' for i in range(1, 4)]:
        if not (CACHE / name).exists():
            remote = 'play_off_box_scores_2010_2024.csv' if name == 'playoffs.csv' else name
            url = f'https://raw.githubusercontent.com/NocturneBear/NBA-Data-2010-2024/{REVISION}/{remote}'
            with urllib.request.urlopen(url, timeout=60) as response:
                (CACHE / name).write_bytes(response.read())
    regular_games = load([f'regular_season_box_scores_2010_2024_part_{i}.csv' for i in range(1, 4)])
    _, allowed = observations(regular_games)
    league = defaultdict(lambda: [0.0] * 7)
    for (season, _), values in allowed.items():
        for i, value in enumerate(values):
            league[season][i] += value
    defense = {}
    for key, values in allowed.items():
        avg = league[key[0]]
        defense[key] = [values[1] / (2 * (values[5] + .44 * values[6])) - avg[1] / (2 * (avg[5] + .44 * avg[6]))]
        defense[key] += [100 * (values[i] / values[0] - avg[i] / avg[0]) for i in range(1, 5)]
    regular, _ = observations(regular_games, defense)
    playoff, _ = observations(load(['playoffs.csv']), defense)
    samples = []
    for key, rows in sorted(playoff.items()):
        if key not in regular or len(rows) < 4:
            continue
        middle = len(rows) // 2
        left = difference(regular[key], rows[:middle])
        right = difference(regular[key], rows[middle:])
        samples.append((key[0], left[2], right[2], left[3]))
    parameters, report = {}, {}
    for i, channel in enumerate(CHANNELS):
        train = [r for r in samples if r[0] < '2019-20' and r[1][i] is not None and r[2][i] is not None]
        test = [r for r in samples if r[0] >= '2019-20' and r[1][i] is not None and r[2][i] is not None]
        def loss(rows, k):
            return sum((x[i] * m / (m + k) - y[i]) ** 2 for _, x, y, m in rows) / len(rows)
        choices = [90, 180, 360, 720, 1440, 2880, 1000000000]
        k = min(choices, key=lambda k: loss(train, k))
        baseline = sum(y[i] ** 2 for _, _, y, _ in test) / len(test)
        error = loss(test, k)
        enabled = error < baseline and k < 1000000000
        parameters[channel] = k if enabled else None
        report[channel] = {'trainingSamples': len(train), 'heldOutSamples': len(test), 'minutesPrior': k, 'neutralMSE': baseline, 'adjustedMSE': error, 'enabled': enabled}
    by_season = defaultdict(dict)
    rejected = []
    for key, rows in sorted(playoff.items()):
        if key not in regular:
            continue
        season, player = key
        source = json.loads((config.NBA_ROOT / season / 'postseason-stats.json').read_text(encoding='utf-8'))
        recorded = next((p for p in source['players'] if p['playerExternalId'] == player), None)
        if recorded is None or abs(sum(r['points'] for r in rows) - recorded['points']) > .01 or abs(sum(r['minutes'] for r in rows) - recorded['minutes']) > 2 or len(rows) != recorded['gamesPlayed']:
            rejected.append([season, player])
            continue
        actual, expected, delta, mins, poss = difference(regular[key], rows)
        weights = {c: mins / (mins + parameters[c]) if parameters[c] else 0 for c in CHANNELS}
        by_season[season][player] = {'modelVersion': 'opponent-pace-v1', 'sources': [SOURCE], 'possessions': poss, 'opponents': len(set(r['opponent'] for r in rows)), 'expected': dict(zip(RATES, expected)), 'actual': dict(zip(RATES, actual)), 'differences': dict(zip(CHANNELS, delta)), 'weights': weights}
    for season, players in sorted(by_season.items()):
        util.write_json(config.NBA_ROOT / season / 'postseason-adjustments.json', players)
    util.write_json(config.NBA_ROOT / 'playoff-adjustment-validation.json', {'modelVersion': 'opponent-pace-v1', 'trainingSeasons': '2010-11 through 2018-19', 'heldOutSeasons': '2019-20 through 2023-24', 'channels': report, 'rejectedSamples': rejected, 'playerSeasons': sum(map(len, by_season.values()))})
    print(json.dumps(report, indent=2))
    print(f'Adjusted {sum(map(len, by_season.values()))} player-seasons; rejected {len(rejected)} inconsistent samples')


if __name__ == '__main__':
    main()
