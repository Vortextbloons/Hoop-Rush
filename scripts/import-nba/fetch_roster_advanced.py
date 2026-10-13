from __future__ import annotations

import argparse
import json
import math
import re
import time
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class AdvancedTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.row = None
        self.field = None
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'table':
            self.active = attrs.get('id') == 'advanced'
        if not self.active:
            return
        if tag == 'tr':
            self.row = {}
        if tag in ('td', 'th') and self.row is not None:
            self.field = attrs.get('data-stat')
            if self.field:
                self.row[self.field] = ''
            if attrs.get('data-append-csv'):
                self.row['bbrefId'] = attrs['data-append-csv']

    def handle_data(self, data):
        if self.active and self.row is not None and self.field:
            self.row[self.field] += data

    def handle_endtag(self, tag):
        if tag == 'tr' and self.active:
            if self.row and self.row.get('bbrefId'):
                self.rows.append(self.row)
            self.row = None
        if tag in ('td', 'th'):
            self.field = None
        if tag == 'table':
            self.active = False


def number(value):
    if value is None or not str(value).strip():
        return None
    result = float(value)
    if not math.isfinite(result):
        raise ValueError('non-finite advanced statistic')
    return result


def parse_advanced(html):
    table = AdvancedTable()
    table.feed(html)
    grouped = {}
    for row in table.rows:
        grouped.setdefault(row['bbrefId'], []).append(row)
    players = []
    for bbref_id, rows in sorted(grouped.items()):
        combined = [r for r in rows if r.get('team_name_abbr', r.get('team_id')) == 'TOT'
                    or re.fullmatch(r'\d+TM', r.get('team_name_abbr', ''))]
        if len(rows) > 1 and len(combined) != 1:
            raise ValueError(f'ambiguous season total for {bbref_id}')
        row = combined[0] if combined else rows[0]
        games = number(row.get('games', row.get('g')))
        minutes = number(row.get('mp'))
        if games is None or games <= 0 or games != int(games) or minutes is None or minutes <= 0:
            raise ValueError(f'invalid advanced-stat workload for {bbref_id}')
        players.append({'bbrefId': bbref_id, 'displayName': row.get('name_display', row.get('player', '')).strip(),
                        'gamesPlayed': int(games), 'minutes': minutes,
                        'per': number(row.get('per')), 'boxPlusMinus': number(row.get('bpm')),
                        'usageRate': number(row.get('usg_pct'))})
    if not players:
        raise ValueError('historical advanced table is missing or empty')
    return players


def run(seasons):
    import requests
    for season in sorted(set(seasons)):
        if not re.fullmatch(r'\d{4}-\d{2}', season):
            raise ValueError(f'invalid season: {season}')
        url = f'https://www.basketball-reference.com/leagues/NBA_{int(season[:4]) + 1}_advanced.html'
        cache = ROOT / '.raw_nba_cache' / f'bbref_advanced_{season}.html'
        cache.parent.mkdir(parents=True, exist_ok=True)
        if cache.exists():
            html = cache.read_text(encoding='utf-8')
        else:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            html = response.text
            parse_advanced(html)
            cache.write_text(html, encoding='utf-8')
            time.sleep(3.1)
        players = parse_advanced(html)
        output = ROOT / 'raw-data' / 'nba' / season / 'roster-advanced.json'
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({'schemaVersion': 1, 'seasonKey': season,
                                     'sourceUrl': url, 'players': players}, indent=2), encoding='utf-8')
        print(f'{season}: {len(players)} published advanced-stat records', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--seasons', nargs='+')
    args = parser.parse_args()
    if args.seasons:
        seasons = args.seasons
    else:
        details = json.loads((ROOT / 'apps/web/static/data/roster-details.json').read_text(encoding='utf-8-sig'))
        seasons = {p['seasonKey'] for p in details['players']
                   if any(p['stats'][k] is None for k in ('per', 'boxPlusMinus', 'usageRate'))}
    run(seasons)
