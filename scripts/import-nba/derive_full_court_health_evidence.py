"""Derive offline Full Court injury-absence evidence from cached NBA snapshots.

Usage:
    python scripts/import-nba/derive_full_court_health_evidence.py \
        --games .raw_nba_cache/playoff-model/kaggle-v533-Games.csv \
        --player-statistics .raw_nba_cache/playoff-model/kaggle-v533-PlayerStatistics.csv \
        --output .raw_nba_cache/full-court-health-evidence.json

The command reads only the two explicit input paths and writes one explicit
output path. It never downloads data and derives no rates or runtime rules.

Assumptions:

* Regular season is defined by ``gameType == "Regular Season"`` in the Games
  schedule, and player rows are accepted only when their ``gameId`` is in that
  schedule. Preseason, playoffs, play-in, All-Star, and separately labeled
  in-season tournament games are excluded.
* August through December belongs to the season starting that year. January
  through July belongs to the prior season. The August 2020 restart belongs
  to 2019-20.
* An appearance is a row with positive minutes or any positive recorded counting
  statistic. Older snapshots sometimes omit minutes while still recording
  statistics, so minutes alone would hide real appearances.
* Some rows omit ``playerteamId`` while retaining ``playerteamName``. The team is
  recovered only when that name exactly matches the scheduled home or away name;
  unattributable rows are skipped as missing coverage.
* A player's roster window for a team is the first through last scheduled team
  game in which that player has a row for that team. Team games outside the
  window are outside the stint, not unknown exposure. Traded players contribute
  one window per team, and episodes never span stints.
* ``knownExposureGames`` counts appearances plus absences with an explicit
  recognized reason: injury, coach's decision, rest, suspension, personal or
  family reasons, G League/two-way/trade, or illness/medical. ``unknownAbsenceGames``
  keeps every other team game in the window explicit: missing rows plus bare
  ``DNP``/``DND``/``NWT``/``OUT``/``Inactive``/``Not With Team`` labels that
  carry no reason. Known exposure and unknown absence partition the window.
* Injury episodes are maximal runs of consecutive team games, within one stint,
  whose documented reason is injury-related. A played game, a non-injury reason,
  a bare or missing reason, or the end of the window ends an episode. Duration is
  the number of consecutive team games missed and is bucketed as 1, 2-3, 4-13,
  or 14+.
* The combined ``Injury/Illness`` label (and generic ``Injured``/``INJ``) is
  counted as injury-related because the snapshot does not separate its parts.
  Explicit illness-only and non-musculoskeletal medical reasons (flu, virus,
  infection, cardiac, dental, and similar) are excluded from injuries while
  remaining known exposure. Combined entries can include illness-only absences,
  and gaps in coverage can hide or split real episodes.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

SCHEMA_VERSION = 1
REGULAR_SEASON = 'Regular Season'

GAME_COLUMNS = (
    'gameId',
    'gameDate',
    'gameType',
    'hometeamId',
    'awayteamId',
    'hometeamName',
    'awayteamName',
)
PLAYER_COLUMNS = (
    'gameId',
    'personId',
    'playerteamId',
    'playerteamName',
    'numMinutes',
    'comment',
    'points',
    'assists',
    'blocks',
    'steals',
    'fieldGoalsAttempted',
    'fieldGoalsMade',
    'threePointersAttempted',
    'threePointersMade',
    'freeThrowsAttempted',
    'freeThrowsMade',
    'reboundsDefensive',
    'reboundsOffensive',
    'reboundsTotal',
    'foulsPersonal',
    'turnovers',
)
COUNTING_COLUMNS = PLAYER_COLUMNS[6:]

DATE_PATTERN = re.compile(r'^(\d{4})-(\d{2})')

COMBINED_INJURY = re.compile(r'\binjury\s*(?:/|\s)\s*illness\b|\binj\s*/\s*ill\b')

MUSCULOSKELETAL_INJURY = re.compile(
    r'\b(?:'
    r'injur\w*|sprain\w*|strain\w*|sore(?!\s+throat)\w*|contus\w*|bruis\w*|fractu\w*|'
    r'broken|tear|torn|concus\w*|conussion|tendin\w*|tenden\w*|tendon\w*|spasm\w*|'
    r'stiff\w*|discomfort|meniscus|acl|mcl|pcl|achill\w*|hamstring\w*|groin|'
    r'quadricep\w*|quad|calves|calf|hip|back|disc|disk|neck|shoulder|collarbone|'
    r'elbow|forearm|wrist|hand|finger\w*|thumb|rib|ribs|abdomin\w*|abdomen|oblique|'
    r'pelvi\w*|thigh|shin|foot|feet|heel|heal\b|toe|metatarsal|metacarpal|knee|knees|'
    r'kneecap|ankle|leg|nose|nasal|eye\w*|jaw|head|lacerat\w*|stitches|sublux\w*|'
    r'dislocat\w*|arthritis|chondromalacia|plantar\w*|fasci\w*|facia\w*|effusion|'
    r'inflamm\w*|swollen|edema|bone|hematoma|synovitis|tricep\w*|trapezius|peroneal|'
    r'patell\w*|ligament\w*|cartilage|sciatic|pointer|jammed|hyperextend\w*|'
    r'hyper extended|pulled|pinky|tightness|tight|tibi\w*|fibul\w*|sternum|acromio|'
    r'clavicular|ulnar|hernia|discectomy|microdiscectomy|calcium|spine|vertebra\w*|'
    r'tailbone|buttock|chest|spleen|lung|loose bodies|stress reaction|compartment|'
    r'osteitis|pubalgia|pubalagia|symphys\w*|symphisitis|nerve root|pinched nerve|'
    r'costochondral|stinger|str muscle|'
    r'hyphema|hythema|cornea\w*|corneal|retina\w*|orbital|eyelid|lip|testic\w*|'
    r'trauma|tarsal|rotator|cuff'
    r')\b'
)

STRONG_INJURY = re.compile(
    r'\b(?:'
    r'sprain\w*|strain\w*|fractu\w*|broken|tear|torn|concus\w*|conussion|'
    r'tendin\w*|tenden\w*|spasm\w*|dislocat\w*|sublux\w*|contus\w*|bruis\w*|'
    r'lacerat\w*|hyperextend\w*|hyper extended|pulled|injur\w*|surgery|surg|'
    r'hernia|discectomy|microdiscectomy|osteitis|pubalgia|pubalagia|symphys\w*|'
    r'symphisitis|str muscle|'
    r'costochondral|stinger|cornea\w*|retina\w*|orbital|testic\w*|trauma|'
    r'rotator|cuff|loose bodies|compartment'
    r')\b'
)

CANCER = re.compile(r'\b(?:cancer|tumou?r|neoplasm|malignan\w*)\b')

MEDICAL = re.compile(
    r'\b(?:'
    r'illness|ilness|ill|sick|sickness|flu|influenza|virus|viral|infect\w*|staph|'
    r'fever|cold|tummy|nausea|stomach|gastric|gastro\w*|gastritis|'
    r'gastrointestinal|intestinal|food poisoning|poisioning|bronchitis|pnuemonia|'
    r'pneumonia|pneumothorax|strep|throat|abscess|abcess|tonsill\w*|tonsilitis|'
    r'chicken pox|salmonella|covid|health and safety|protocols?|resp\w*|sinus\w*|'
    r'dehydration|migra\w*|headache\w*|dizz\w*|vertigo|asthma|diabetes|diabetic|'
    r'heartbeat|heart beat|atrial fibrillation|wolf parkinson|medical|medication|'
    r'dental|tooth|teeth|oral surgery|root canal|hemorrhoid|anxiety|depression|'
    r'append\w*|anemia|ulcer|esophagitis|hives|rash|conjunctivitis|toenail\w*|'
    r'kidney|stye|vision|double vision|blood pressure|seizure|allergic|allergy|cancer'
    r')\b'
)

CONTROL_DECISION = re.compile(
    r'\b(?:'
    r'coach|coaches|decision|rest|resting|load management|management|'
    r'planned recovery|recovery day|maintenance|susp\w*|'
    r'team rules|violation|disciplinary|ineligible|nba sus\b'
    r')\b'
)

ADMIN_REASON = re.compile(
    r'\b(?:'
    r'personal|pesonal|family|bereavement|death|funeral|birth|newborn|baby|wife|'
    r'husband|son|daughter|child|mother|father|g league|d league|nbdl|nbadl|'
    r'development league|developmental league|two way|trade|traded|'
    r'pending trade|transaction|signing|signed|pending physical|not yet|'
    r'yet to report|en route|visa|weather|flight|travel difficulties|'
    r'asian games'
    r')\b'
)

GENERIC_INJURY = re.compile(r'\b(?:inj|injury|injuries|injured|surgery|surgical|surg)\b')

Game = tuple[str, str, str, str, str, str]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--games', required=True, type=Path, help='Games schedule CSV')
    parser.add_argument(
        '--player-statistics',
        required=True,
        type=Path,
        help='Player game statistics CSV',
    )
    parser.add_argument('--output', required=True, type=Path, help='Output JSON path')
    return parser.parse_args(argv)


def season_key(date: str) -> str:
    match = DATE_PATTERN.match(date.strip())
    if match is None:
        raise ValueError(f'Invalid game date: {date!r}')
    year, month = int(match.group(1)), int(match.group(2))
    start = year if month >= 8 and (year, month) != (2020, 8) else year - 1
    return f'{start}-{(start + 1) % 100:02d}'


def positive(value: str) -> bool:
    text = value.strip()
    if not text:
        return False
    try:
        return float(text) > 0
    except ValueError:
        return False


def recorded_appearance(row: dict[str, str]) -> bool:
    minutes = row['numMinutes'].strip()
    if minutes:
        try:
            if float(minutes) > 0:
                return True
        except ValueError:
            if ':' in minutes:
                parts = minutes.split(':')
                try:
                    if float(parts[0]) * 60 + float(parts[1]) > 0:
                        return True
                except (IndexError, ValueError):
                    pass
    return any(positive(row[column]) for column in COUNTING_COLUMNS)


def classify_comment(comment: str) -> str:
    text = ' '.join(comment.replace('_', ' ').replace('-', ' ').lower().split())
    if not text:
        return 'unknown'
    if CANCER.search(text):
        return 'other'
    if CONTROL_DECISION.search(text):
        return 'other'
    if COMBINED_INJURY.search(text):
        return 'injury'
    if MEDICAL.search(text) and not STRONG_INJURY.search(text):
        return 'other'
    if MUSCULOSKELETAL_INJURY.search(text):
        return 'injury'
    if ADMIN_REASON.search(text):
        return 'other'
    if MEDICAL.search(text):
        return 'other'
    if GENERIC_INJURY.search(text):
        return 'injury'
    return 'unknown'


def duration_bucket(games: int) -> int:
    if games <= 1:
        return 0
    if games <= 3:
        return 1
    if games <= 13:
        return 2
    return 3


def load_schedule(
    path: Path,
) -> tuple[dict[str, Game], dict[tuple[str, str], list[tuple[str, str]]]]:
    games: dict[str, Game] = {}
    team_games: dict[tuple[str, str], list[tuple[str, str]]] = defaultdict(list)
    with path.open(encoding='utf-8-sig', newline='') as file:
        reader = csv.DictReader(file)
        missing = [column for column in GAME_COLUMNS if column not in (reader.fieldnames or ())]
        if missing:
            raise ValueError(f'{path} is missing columns: {", ".join(missing)}')
        for row in reader:
            if row['gameType'].strip() != REGULAR_SEASON:
                continue
            game_id = row['gameId'].strip()
            date = row['gameDate'].strip()
            home = row['hometeamId'].strip()
            away = row['awayteamId'].strip()
            home_name = row['hometeamName'].strip()
            away_name = row['awayteamName'].strip()
            if not game_id or not date or not home or not away or home == away:
                raise ValueError(f'Incomplete regular-season game record in {path}')
            season = season_key(date)
            entry = (season, date, home, away, home_name, away_name)
            previous = games.get(game_id)
            if previous is not None and previous != entry:
                raise ValueError(f'Conflicting schedule entries for game {game_id}')
            if previous is not None:
                continue
            games[game_id] = entry
            team_games[(season, home)].append((date, game_id))
            team_games[(season, away)].append((date, game_id))
    for schedule in team_games.values():
        schedule.sort()
    return games, team_games


def load_player_rows(
    path: Path,
    games: dict[str, Game],
) -> dict[tuple[str, str], list[tuple[str, str, str]]]:
    rows: dict[tuple[str, str], list[tuple[str, str, str]]] = defaultdict(list)
    with path.open(encoding='utf-8-sig', newline='') as file:
        reader = csv.DictReader(file)
        missing = [column for column in PLAYER_COLUMNS if column not in (reader.fieldnames or ())]
        if missing:
            raise ValueError(f'{path} is missing columns: {", ".join(missing)}')
        for row in reader:
            game_id = row['gameId'].strip()
            game = games.get(game_id)
            if game is None:
                continue
            season, _, home, away, home_name, away_name = game
            person = row['personId'].strip()
            team = row['playerteamId'].strip()
            if not team:
                name = row['playerteamName'].strip()
                if name and name == home_name:
                    team = home
                elif name and name == away_name:
                    team = away
                else:
                    continue
            if not person or team not in (home, away):
                raise ValueError(f'Invalid player-game row for {game_id} in {path}')
            if recorded_appearance(row):
                status = 'played'
            else:
                status = classify_comment(row['comment'])
            rows[(season, person)].append((team, game_id, status))
    return rows


def rollup_player_season(
    season: str,
    team_rows: list[tuple[str, str, str]],
    team_games: dict[tuple[str, str], list[tuple[str, str]]],
) -> dict[str, object]:
    stints: dict[str, dict[str, str]] = defaultdict(dict)
    for team, game_id, status in team_rows:
        stints[team][game_id] = status

    played = 0
    known = 0
    unknown = 0
    buckets = [0, 0, 0, 0]

    for team, statuses in stints.items():
        schedule = team_games.get((season, team))
        if not schedule:
            continue
        index = {game_id: position for position, (_, game_id) in enumerate(schedule)}
        positions = [index[game_id] for game_id in statuses if game_id in index]
        if not positions:
            continue
        window = schedule[min(positions) : max(positions) + 1]
        run = 0
        for _, game_id in window:
            status = statuses.get(game_id, 'unknown')
            if status == 'played':
                if run:
                    buckets[duration_bucket(run)] += 1
                    run = 0
                played += 1
                known += 1
            elif status == 'injury':
                known += 1
                run += 1
            else:
                if status != 'other':
                    unknown += 1
                else:
                    known += 1
                if run:
                    buckets[duration_bucket(run)] += 1
                    run = 0
        if run:
            buckets[duration_bucket(run)] += 1

    return {
        'externalId': '',
        'playedGames': played,
        'knownExposureGames': known,
        'unknownAbsenceGames': unknown,
        'injuryEpisodesByDuration': buckets,
    }


def build_evidence(
    team_games: dict[tuple[str, str], list[tuple[str, str]]],
    player_rows: dict[tuple[str, str], list[tuple[str, str, str]]],
) -> dict[str, object]:
    by_season: dict[str, list[dict[str, object]]] = defaultdict(list)
    for (season, external_id), rows in player_rows.items():
        evidence = rollup_player_season(season, rows, team_games)
        evidence['externalId'] = external_id
        by_season[season].append(evidence)

    return {
        'schemaVersion': SCHEMA_VERSION,
        'seasons': [
            {
                'seasonKey': season,
                'players': sorted(by_season[season], key=lambda player: player['externalId']),
            }
            for season in sorted(by_season)
        ],
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    games, team_games = load_schedule(args.games)
    player_rows = load_player_rows(args.player_statistics, games)
    evidence = build_evidence(team_games, player_rows)
    text = json.dumps(evidence, ensure_ascii=False, separators=(',', ':')) + '\n'
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(text, encoding='utf-8')

    seasons = evidence['seasons']
    player_seasons = sum(len(season['players']) for season in seasons)
    played = sum(player['playedGames'] for season in seasons for player in season['players'])
    known = sum(
        player['knownExposureGames'] for season in seasons for player in season['players']
    )
    unknown = sum(
        player['unknownAbsenceGames'] for season in seasons for player in season['players']
    )
    episodes = sum(
        sum(player['injuryEpisodesByDuration'])
        for season in seasons
        for player in season['players']
    )
    print(
        f'wrote {args.output}: {len(seasons)} seasons, {player_seasons} player-seasons, '
        f'{played} played games, {known} known exposure, {unknown} unknown absences, '
        f'{episodes} injury episodes',
        file=sys.stderr,
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
