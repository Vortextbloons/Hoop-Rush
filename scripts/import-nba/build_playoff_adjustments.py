from __future__ import annotations

import csv
import json
import math
import urllib.request
from collections import defaultdict
from pathlib import Path

from fetch_postseason import config, util

SHOOTING_CONFLICTS = []
CHANNELS = ('tsPct', 'pointsPer36', 'assistsPer36', 'reboundsPer36', 'turnoversPer36')
SHOT_COLUMNS = ('fieldGoalsMade', 'threePointersMade', 'threePointersAttempted', 'freeThrowsMade')
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
                if m <= 0 and row.get('minutePrecision') != '1':
                    continue
                key = (row['gameId'], row['teamId'], row['personId'])
                if key in seen:
                    if any(seen[key][c] != row[c] for c in ('minutes', *COLUMNS, 'fieldGoalsAttempted', 'freeThrowsAttempted', 'reboundsOffensive')):
                        raise ValueError(f'Conflicting game/player {key}')
                    continue
                seen[key] = dict(row)
                row['m'] = m
                row['minutePrecision'] = float(row.get('minutePrecision') or 0)
                for column in (*COLUMNS, 'fieldGoalsAttempted', 'freeThrowsAttempted', 'reboundsOffensive'):
                    row[column] = float(row[column])
                    if not math.isfinite(row[column]) or row[column] < 0:
                        raise ValueError(f'Invalid box score {key}')
                for column in SHOT_COLUMNS:
                    value = row.get(column)
                    row[column] = float(value) if value not in (None, '') else None
                    if row[column] is not None and (not math.isfinite(row[column]) or row[column] < 0):
                        raise ValueError(f'Invalid shooting count {key}')
                if all(row[c] is not None for c in SHOT_COLUMNS):
                    if row['threePointersMade'] > row['threePointersAttempted'] or row['fieldGoalsMade'] > row['fieldGoalsAttempted'] or row['freeThrowsMade'] > row['freeThrowsAttempted'] or row['threePointersMade'] > row['fieldGoalsMade'] or row['threePointersAttempted'] > row['fieldGoalsAttempted'] or row['fieldGoalsMade'] - row['threePointersMade'] > row['fieldGoalsAttempted'] - row['threePointersAttempted'] or abs(2 * row['fieldGoalsMade'] + row['threePointersMade'] + row['freeThrowsMade'] - row['points']) > .01:
                        SHOOTING_CONFLICTS.append(list(key))
                        for column in SHOT_COLUMNS:
                            row[column] = None
                games[row['gameId']][row['teamId']].append(row)
    return games


def shot_counts(row):
    fgm, tpm, tpa, ftm = (row.get(c) for c in SHOT_COLUMNS)
    two = None if fgm is None or tpm is None or tpa is None else (fgm - tpm, row['fieldGoalsAttempted'] - tpa)
    three = None if tpm is None or tpa is None else (tpm, tpa)
    free = None if ftm is None else (ftm, row['freeThrowsAttempted'])
    return [two, three, free]


def shooting_difference(regular, post, index):
    def summary(rows):
        if any(row['shots'][index] is None or row['context'][5 + index] is None for row in rows):
            return None
        made = sum(row['shots'][index][0] for row in rows)
        attempts = sum(row['shots'][index][1] for row in rows)
        if attempts <= 0:
            return None
        context = sum(row['shots'][index][1] * row['context'][5 + index] for row in rows) / attempts
        return made / attempts, context, attempts
    baseline, actual = summary(regular), summary(post)
    if baseline is None or actual is None:
        return None
    expected = max(0, min(1, baseline[0] + actual[1] - baseline[1]))
    return {'expected': expected, 'actual': actual[0], 'difference': actual[0] - expected, 'attempts': actual[2]}


def volume_difference(regular, post):
    def summary(rows):
        poss = sum(row['possessions'] for row in rows)
        if poss <= 0:
            return None
        return sum(row['fga'] for row in rows) * 100 / poss, sum(row['context'][8] * row['possessions'] for row in rows) / poss, poss
    baseline, actual = summary(regular), summary(post)
    if baseline is None or actual is None:
        return None
    expected = baseline[0] * actual[1] / baseline[1]
    delta = actual[0] - expected
    return {'expected': expected, 'actual': actual[0], 'difference': delta, 'possessions': actual[2], 'differencePer36': delta * baseline[2] / sum(r['minutes'] for r in regular) * .36}


def fit_channel(samples, choices, exposure):
    train = [r for r in samples if r[0] < '2019-20']
    test = [r for r in samples if '2019-20' <= r[0] <= '2023-24']
    def loss(rows, prior):
        total = sum(right[exposure] for _, _, right in rows)
        return sum((left['difference'] * left[exposure] / (left[exposure] + prior) - right['difference']) ** 2 * right[exposure] for _, left, right in rows) / total
    prior = min(choices, key=lambda value: loss(train, value))
    baseline = sum(right['difference'] ** 2 * right[exposure] for _, _, right in test) / sum(right[exposure] for _, _, right in test)
    error = loss(test, prior)
    enabled = error < baseline and prior < 1000000000
    return prior if enabled else None, {'trainingSamples': len(train), 'heldOutSamples': len(test), 'prior': prior, 'exposure': exposure, 'neutralMSE': baseline, 'adjustedMSE': error, 'enabled': enabled}


def totals(rows):
    return {key: sum(row[key] for row in rows) for key in (*COLUMNS, 'fieldGoalsAttempted', 'freeThrowsAttempted', 'reboundsOffensive', 'm')}


def possessions(a, b):
    return sum(t['fieldGoalsAttempted'] + .44 * t['freeThrowsAttempted'] - t['reboundsOffensive'] + t['turnovers'] for t in (a, b)) / 2


def observations(games, defense=None):
    players = defaultdict(list)
    allowed = defaultdict(lambda: [0.0] * 13)
    for game_id, teams in sorted(games.items()):
        if len(teams) != 2:
            raise ValueError(f'Incomplete game {game_id}')
        ids = sorted(teams)
        for own_id, opp_id in (ids, ids[::-1]):
            own, opp = teams[own_id], teams[opp_id]
            a, b = totals(own), totals(opp)
            poss = possessions(a, b)
            precision = sum(r.get('minutePrecision', 0) for r in own + opp)
            if poss <= 0 or abs(a['m'] - b['m']) > max(1, precision):
                raise ValueError(f'Invalid possession/minute accounting {game_id}')
            season = own[0]['season_year']
            allowed[(season, opp_id)][0] += poss
            for i, column in enumerate(COLUMNS, 1):
                allowed[(season, opp_id)][i] += a[column]
            allowed[(season, opp_id)][5] += a['fieldGoalsAttempted']
            allowed[(season, opp_id)][6] += a['freeThrowsAttempted']
            shot_totals = [0.0] * 6
            for row in own:
                shot = shot_counts(row)
                for i, pair in enumerate(shot):
                    for j in range(2):
                        index = 2 * i + j
                        shot_totals[index] = None if pair is None or shot_totals[index] is None else shot_totals[index] + pair[j]
            for i, value in enumerate(shot_totals, 7):
                allowed[(season, opp_id)][i] = None if value is None or allowed[(season, opp_id)][i] is None else allowed[(season, opp_id)][i] + value
            for row in own:
                exposure = poss * row['m'] / (a['m'] / 5)
                context = defense[(season, opp_id)] if defense else [0, 1, 1, 1, 1, 0, 0, 0, 1]
                players[(season, row['personId'])].append({
                    'game': game_id, 'opponent': opp_id, 'minutes': row['m'],
                    'possessions': exposure, 'points': row['points'],
                    'tsa': row['fieldGoalsAttempted'] + .44 * row['freeThrowsAttempted'],
                    'values': [row[c] for c in COLUMNS], 'context': context,
                    'fga': row['fieldGoalsAttempted'], 'fta': row['freeThrowsAttempted'],
                    'minutePrecision': row.get('minutePrecision', 0), 'shots': shot_counts(row),
                })
    return players, allowed


def summarize(rows):
    poss = sum(r['possessions'] for r in rows)
    tsa = sum(r['tsa'] for r in rows)
    mins = sum(r['minutes'] for r in rows)
    actual = [sum(r['points'] for r in rows) / (2 * tsa) if tsa else None]
    actual += [100 * sum(r['values'][i] for r in rows) / poss if poss > 0 else None for i in range(4)]
    context = [sum(r['context'][0] * r['tsa'] for r in rows) / tsa if tsa else 0]
    context += [sum(r['context'][i + 1] * r['possessions'] for r in rows) / poss if poss > 0 else 1 for i in range(4)]
    return actual, context, mins, poss


def difference(regular, post):
    actual, context, mins, poss = summarize(post)
    baseline, reg_context, reg_mins, reg_poss = summarize(regular)
    expected = [None if baseline[i] is None else (baseline[i] + context[i] - reg_context[i] if i == 0 else baseline[i] * context[i] / reg_context[i]) for i in range(5)]
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
    from fetch_playoff_history import main as fetch_history, SOURCE as HISTORY_SOURCE
    fetch_history()
    regular_games = load([f'regular_season_box_scores_2010_2024_part_{i}.csv' for i in range(1, 4)] + ['historical-regular.csv'])
    _, allowed = observations(regular_games)
    league = defaultdict(lambda: [0.0] * 13)
    for (season, _), values in allowed.items():
        for i, value in enumerate(values):
            if value is not None:
                league[season][i] += value
    defense = {}
    for key, values in allowed.items():
        avg = league[key[0]]
        defense[key] = [values[1] / (2 * (values[5] + .44 * values[6])) - avg[1] / (2 * (avg[5] + .44 * avg[6]))]
        defense[key] += [(values[i] / values[0]) / (avg[i] / avg[0]) for i in range(1, 5)]
        for offset in (7, 9):
            defense[key].append(values[offset] / values[offset + 1] - avg[offset] / avg[offset + 1] if values[offset] is not None and values[offset + 1] else None)
        defense[key] += [0, (values[5] / values[0]) / (avg[5] / avg[0])]
    regular, _ = observations(regular_games, defense)
    playoff, _ = observations(load(['playoffs.csv', 'historical-playoffs.csv']), defense)
    rejected = []
    canonical = {}
    postseason_canonical = {}
    for season, _ in sorted(regular):
        if season not in canonical:
            path = config.NBA_ROOT / season / 'season-stats.json'
            canonical[season] = {r['playerExternalId']: r for r in json.loads(path.read_text(encoding='utf-8'))}
    for key in list(playoff):
        season, player = key
        recorded = canonical.get(season, {}).get(player)
        rows = regular.get(key, [])
        columns = {'points': 0, 'assists': 1, 'rebounds': 2, 'turnovers': 3}
        if not recorded or not rows or sum(r['minutes'] for r in rows) <= 0 or len(rows) != recorded['gamesPlayed'] or any(recorded.get(c) is None or abs(sum(r['values'][i] for r in rows) - recorded[c]) > .01 for c, i in columns.items()) or abs(sum(r['fga'] for r in rows) - recorded['fga']) > .01 or abs(sum(r['fta'] for r in rows) - recorded['fta']) > .01 or abs(sum(r['minutes'] for r in rows) - recorded['minutes']) > max(2, sum(r.get('minutePrecision', 0) for r in rows)):
            rejected.append([season, player, 'regular-season coverage'])
            del playoff[key]
    for key in list(playoff):
        season, player = key
        if season not in postseason_canonical:
            source = json.loads((config.NBA_ROOT / season / 'postseason-stats.json').read_text(encoding='utf-8'))
            postseason_canonical[season] = {r['playerExternalId']: r for r in source['players']}
        recorded = postseason_canonical[season].get(player)
        rows = playoff[key]
        if recorded is None or sum(r['minutes'] for r in rows) <= 0 or any(recorded.get(c) is None or abs(sum(r['values'][i] for r in rows) - recorded[c]) > .01 for c, i in columns.items()) or abs(sum(r['fga'] for r in rows) - recorded['fga']) > .01 or abs(sum(r['fta'] for r in rows) - recorded['fta']) > .01 or abs(sum(r['minutes'] for r in rows) - recorded['minutes']) > max(2, sum(r.get('minutePrecision', 0) for r in rows)) or len(rows) != recorded['gamesPlayed']:
            rejected.append([season, player, 'playoff coverage'])
            del playoff[key]
    for (season, player), rows in regular.items():
        recorded = canonical[season].get(player)
        if recorded is None:
            continue
        expected = [
            None if any(recorded.get(c) is None for c in ('fgm', 'tpm', 'tpa', 'fga')) else (recorded['fgm'] - recorded['tpm'], recorded['fga'] - recorded['tpa']),
            None if any(recorded.get(c) is None for c in ('tpm', 'tpa')) else (recorded['tpm'], recorded['tpa']),
            None if recorded.get('ftm') is None else (recorded['ftm'], recorded['fta']),
        ]
        for index, counts in enumerate(expected):
            if counts is None or any(row['shots'][index] is None for row in rows) or any(abs(sum(row['shots'][index][j] for row in rows) - counts[j]) > .01 for j in range(2)):
                for row in rows:
                    row['shots'][index] = None
    samples = []
    shooting_samples = [[], [], []]
    volume_samples = []
    for key, rows in sorted(playoff.items()):
        opponents = list(dict.fromkeys(r['opponent'] for r in rows))
        if key not in regular or len(opponents) < 2:
            continue
        early = set(opponents[:len(opponents) // 2])
        left = difference(regular[key], [r for r in rows if r['opponent'] in early])
        right = difference(regular[key], [r for r in rows if r['opponent'] not in early])
        samples.append((key[0], left[2], right[2], left[3]))
        first = [r for r in rows if r['opponent'] in early]
        second = [r for r in rows if r['opponent'] not in early]
        for i in range(3):
            a, b = shooting_difference(regular[key], first, i), shooting_difference(regular[key], second, i)
            if a is not None and b is not None:
                shooting_samples[i].append((key[0], a, b))
        a, b = volume_difference(regular[key], first), volume_difference(regular[key], second)
        if a is not None and b is not None:
            volume_samples.append((key[0], a, b))
    parameters, report = {}, {}
    for i, channel in enumerate(CHANNELS):
        train = [r for r in samples if r[0] < '2019-20' and r[1][i] is not None and r[2][i] is not None]
        test = [r for r in samples if '2019-20' <= r[0] <= '2023-24' and r[1][i] is not None and r[2][i] is not None]
        def loss(rows, k):
            return sum((x[i] * m / (m + k) - y[i]) ** 2 for _, x, y, m in rows) / len(rows)
        choices = [90, 180, 360, 720, 1440, 2880, 1000000000]
        k = min(choices, key=lambda k: loss(train, k))
        baseline = sum(y[i] ** 2 for _, _, y, _ in test) / len(test)
        error = loss(test, k)
        enabled = error < baseline and k < 1000000000
        parameters[channel] = k if enabled else None
        report[channel] = {'trainingSamples': len(train), 'heldOutSamples': len(test), 'minutesPrior': k, 'neutralMSE': baseline, 'adjustedMSE': error, 'enabled': enabled}
    shot_parameters = []
    for name, samples in zip(('twoPoint', 'threePoint', 'freeThrow'), shooting_samples):
        parameter, result = fit_channel(samples, [25, 50, 100, 200, 400, 800, 1600, 1000000000], 'attempts')
        shot_parameters.append(parameter)
        report[name] = result
    volume_parameter, report['shotVolume'] = fit_channel(volume_samples, [250, 500, 1000, 2000, 4000, 8000, 1000000000], 'possessions')
    by_season = defaultdict(dict)
    for key, rows in sorted(playoff.items()):
        if key not in regular:
            continue
        season, player = key
        actual, expected, delta, mins, poss = difference(regular[key], rows)
        weights = {c: mins / (mins + parameters[c]) if parameters[c] else 0 for c in CHANNELS}
        shooting = {}
        for i, name in enumerate(('twoPoint', 'threePoint', 'freeThrow')):
            channel = shooting_difference(regular[key], rows, i)
            shooting[name] = None if channel is None else {**channel, 'weight': channel['attempts'] / (channel['attempts'] + shot_parameters[i]) if shot_parameters[i] else 0}
        volume = volume_difference(regular[key], rows)
        if volume is not None:
            volume['weight'] = volume['possessions'] / (volume['possessions'] + volume_parameter) if volume_parameter else 0
        by_season[season][player] = {'modelVersion': 'opponent-pace-v2', 'shooting': shooting, 'shotVolume': volume, 'sources': [SOURCE if '2010-11' <= season <= '2023-24' else HISTORY_SOURCE], 'minutePrecision': 'whole-minutes' if any(r.get('minutePrecision', 0) for r in rows) else 'seconds', 'possessions': poss, 'opponents': len(set(r['opponent'] for r in rows)), 'expected': dict(zip(RATES, expected)), 'actual': dict(zip(RATES, actual)), 'differences': dict(zip(CHANNELS, delta)), 'weights': weights}
    for season in sorted(canonical):
        players = by_season.get(season, {})
        util.write_json(config.NBA_ROOT / season / 'postseason-adjustments.json', players)
    util.write_json(config.NBA_ROOT / 'playoff-adjustment-validation.json', {'modelVersion': 'opponent-pace-v2', 'trainingSeasons': '1977-78 through 2018-19', 'heldOutSeasons': '2019-20 through 2023-24', 'channels': report, 'rejectedShootingRecords': SHOOTING_CONFLICTS, 'rejectedSamples': rejected, 'playerSeasons': sum(map(len, by_season.values())), 'playerSeasonsBySeason': {season: len(by_season.get(season, {})) for season in sorted(canonical)}})
    print(json.dumps(report, indent=2))
    print(f'Adjusted {sum(map(len, by_season.values()))} player-seasons; rejected {len(rejected)} inconsistent samples')


if __name__ == '__main__':
    main()
