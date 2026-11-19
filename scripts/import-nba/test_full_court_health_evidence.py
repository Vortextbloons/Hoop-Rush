import csv
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

from derive_full_court_health_evidence import (
    COUNTING_COLUMNS,
    GAME_COLUMNS,
    PLAYER_COLUMNS,
    build_evidence,
    classify_comment,
    load_player_rows,
    load_schedule,
    main,
)


def game_row(
    game_id,
    day,
    game_type='Regular Season',
    home='1',
    away='2',
    home_name='Home',
    away_name='Away',
):
    return {
        'gameId': game_id,
        'gameDate': f'2024-10-{day:02d} 19:00:00',
        'gameType': game_type,
        'hometeamId': home,
        'awayteamId': away,
        'hometeamName': home_name,
        'awayteamName': away_name,
    }


def player_row(
    game_id,
    person_id,
    team_id='1',
    team_name='',
    minutes='30',
    comment='',
    **stats,
):
    row = {column: '0' for column in COUNTING_COLUMNS}
    row.update(
        {
            'gameId': game_id,
            'personId': person_id,
            'playerteamId': team_id,
            'playerteamName': team_name,
            'numMinutes': minutes,
            'comment': comment,
        }
    )
    row.update({column: str(value) for column, value in stats.items()})
    return row


def write_snapshot(directory: Path, games, players):
    games_path = directory / 'Games.csv'
    players_path = directory / 'PlayerStatistics.csv'
    with games_path.open('w', encoding='utf-8', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=GAME_COLUMNS)
        writer.writeheader()
        writer.writerows(games)
    with players_path.open('w', encoding='utf-8', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=PLAYER_COLUMNS)
        writer.writeheader()
        writer.writerows(players)
    return games_path, players_path


def derive(games, players):
    with tempfile.TemporaryDirectory() as name:
        games_path, players_path = write_snapshot(Path(name), games, players)
        schedule, team_games = load_schedule(games_path)
        rows = load_player_rows(players_path, schedule)
        return build_evidence(team_games, rows)


def by_player(evidence, season='2024-25'):
    entry = next(item for item in evidence['seasons'] if item['seasonKey'] == season)
    return {player['externalId']: player for player in entry['players']}


class MixedReasonTests(unittest.TestCase):
    def test_coach_rest_suspension_and_illness_are_known_but_not_injuries(self):
        games = [game_row(f'g{index}', index + 1) for index in range(8)]
        players = [player_row(f'g{index}', '7') for index in range(4)]
        players += [
            player_row('g4', '7', minutes='0', comment="DND - Coach's Decision"),
            player_row('g5', '7', minutes='0', comment='DND - Rest'),
            player_row('g6', '7', minutes='0', comment='DND - NBA Suspension'),
            player_row('g7', '7', minutes='0', comment='DND - Illness'),
        ]
        player = by_player(derive(games, players))['7']
        self.assertEqual(player['playedGames'], 4)
        self.assertEqual(player['knownExposureGames'], 8)
        self.assertEqual(player['unknownAbsenceGames'], 0)
        self.assertEqual(player['injuryEpisodesByDuration'], [0, 0, 0, 0])

    def test_explicit_rest_wins_over_an_incidental_body_part(self):
        self.assertEqual(classify_comment('DND - Right Knee Rest'), 'other')
        self.assertEqual(classify_comment('DND - Rest (Injury/Illness)'), 'other')
        self.assertEqual(classify_comment("DNP - Coach's Decision right shoulder"), 'other')
        self.assertEqual(classify_comment('DND - Left Leg Infection'), 'other')


class EpisodeTests(unittest.TestCase):
    def test_consecutive_absences_group_into_one_episode_per_run(self):
        games = [game_row(f'g{index}', index + 1) for index in range(25)]
        injured = set(range(0, 1)) | set(range(2, 5)) | set(range(6, 10)) | set(range(11, 25))
        players = [
            player_row(
                f'g{index}',
                '9',
                minutes='0' if index in injured else '28',
                comment='DND - Sprained Left Ankle' if index in injured else '',
            )
            for index in range(25)
        ]
        player = by_player(derive(games, players))['9']
        self.assertEqual(player['playedGames'], 3)
        self.assertEqual(player['knownExposureGames'], 25)
        self.assertEqual(player['unknownAbsenceGames'], 0)
        self.assertEqual(player['injuryEpisodesByDuration'], [1, 1, 1, 1])

    def test_played_games_separate_episodes_and_combined_label_counts(self):
        games = [game_row(f'g{index}', index + 1) for index in range(6)]
        comments = [
            'DND - Sprained Left Ankle',
            'DND - Sprained Left Ankle',
            '',
            'DND - Injury/Illness',
            'NWT - Injury/Illness',
            '',
        ]
        players = [
            player_row(
                f'g{index}',
                '4',
                minutes='30' if comments[index] == '' else '0',
                comment=comments[index],
            )
            for index in range(6)
        ]
        player = by_player(derive(games, players))['4']
        self.assertEqual(player['playedGames'], 2)
        self.assertEqual(player['knownExposureGames'], 6)
        self.assertEqual(player['injuryEpisodesByDuration'], [0, 2, 0, 0])
        self.assertEqual(classify_comment('Inactive - Injury/Illness'), 'injury')


class CoverageTests(unittest.TestCase):
    def test_missing_rows_and_bare_dnp_labels_stay_unknown(self):
        games = [game_row(f'g{index}', index + 1) for index in range(8)]
        players = [
            player_row('g0', '3'),
            player_row('g1', '3', minutes='0', comment="DND - Coach's Decision"),
            player_row('g3', '3', minutes='0', comment='DND'),
            player_row('g5', '3', minutes='0', comment='NWT - Personal Reasons'),
            player_row('g7', '3'),
        ]
        evidence = derive(games, players)
        player = by_player(evidence)['3']
        self.assertEqual(player['playedGames'], 2)
        self.assertEqual(player['knownExposureGames'], 4)
        self.assertEqual(player['unknownAbsenceGames'], 4)

        second = [
            player_row('g2', '8'),
            player_row('g4', '8'),
        ]
        player = by_player(derive(games, second))['8']
        self.assertEqual(player['playedGames'], 2)
        self.assertEqual(player['knownExposureGames'], 2)
        self.assertEqual(player['unknownAbsenceGames'], 1)

    def test_traded_player_windows_do_not_create_unknown_games(self):
        games = [game_row(f'g{index}', index + 1) for index in range(8)]
        players = [
            player_row('g0', '5', team_id='1'),
            player_row('g1', '5', team_id='1', minutes='0', comment='DND - Sore Right Knee'),
            player_row('g4', '5', team_id='2'),
            player_row('g5', '5', team_id='2', minutes='0', comment='DND - Sore Left Knee'),
        ]
        player = by_player(derive(games, players))['5']
        self.assertEqual(player['playedGames'], 2)
        self.assertEqual(player['knownExposureGames'], 4)
        self.assertEqual(player['unknownAbsenceGames'], 0)
        self.assertEqual(player['injuryEpisodesByDuration'], [2, 0, 0, 0])


class ScheduleFilterTests(unittest.TestCase):
    def test_august_2020_regular_season_games_belong_to_2019_20(self):
        bubble_game = {**game_row('g0', 14), 'gameDate': '2020-08-14 19:00:00'}
        evidence = derive([bubble_game], [player_row('g0', '11')])
        self.assertEqual(by_player(evidence, '2019-20')['11']['playedGames'], 1)

    def test_non_regular_games_are_ignored_by_schedule_id(self):
        games = [
            game_row('g0', 1),
            game_row('g1', 2),
            game_row('p0', 3, game_type='Playoffs'),
            game_row('c0', 4, game_type='NBA Emirates Cup'),
            game_row('s0', 5, game_type='Preseason'),
        ]
        players = [
            player_row('g0', '11'),
            player_row('g1', '11', minutes='0', comment='DND - Torn ACL'),
            player_row('p0', '11', minutes='0', comment='DND - Torn ACL'),
            player_row('c0', '11', minutes='0', comment='DND - Torn ACL'),
            player_row('s0', '11', minutes='0', comment='DND - Torn ACL'),
            player_row('p0', '12', minutes='0', comment='DND - Torn ACL'),
        ]
        evidence = derive(games, players)
        player = by_player(evidence)['11']
        self.assertEqual(player['playedGames'], 1)
        self.assertEqual(player['knownExposureGames'], 2)
        self.assertEqual(player['unknownAbsenceGames'], 0)
        self.assertEqual(player['injuryEpisodesByDuration'], [1, 0, 0, 0])
        self.assertNotIn('12', by_player(evidence))


class AppearanceTests(unittest.TestCase):
    def test_missing_numeric_markers_do_not_prove_appearance(self):
        player = player_row('g0', '22', minutes='N/A', points='-')
        self.assertEqual(by_player(derive([game_row('g0', 1)], [player]))['22']['playedGames'], 0)

    def test_blank_team_id_is_recovered_from_the_scheduled_team_name(self):
        games = [
            game_row('g0', 1, home_name='Hawks', away_name='Celtics'),
            game_row('g1', 2, home_name='Hawks', away_name='Celtics'),
            game_row('g2', 3, home_name='Hawks', away_name='Celtics'),
        ]
        players = [
            player_row('g0', '21', team_id='', team_name='Hawks', points=10),
            player_row('g1', '21', team_id='', team_name='Celtics', points=8),
            player_row('g2', '21', team_id='', team_name='Unknown'),
        ]
        player = by_player(derive(games, players))['21']
        self.assertEqual(player['playedGames'], 2)
        self.assertEqual(player['knownExposureGames'], 2)
        self.assertEqual(player['unknownAbsenceGames'], 0)

    def test_statistics_prove_appearances_when_minutes_are_missing(self):
        games = [game_row(f'g{index}', index + 1) for index in range(4)]
        players = [
            player_row('g0', '6', minutes='', points=12),
            player_row('g1', '6', minutes='0', comment='DND - Sprained Right Ankle'),
            player_row('g2', '6', minutes='0.0', reboundsTotal=1),
            player_row('g3', '6', minutes='', comment=''),
        ]
        player = by_player(derive(games, players))['6']
        self.assertEqual(player['playedGames'], 2)
        self.assertEqual(player['knownExposureGames'], 3)
        self.assertEqual(player['unknownAbsenceGames'], 1)
        self.assertEqual(player['injuryEpisodesByDuration'], [1, 0, 0, 0])


class CliTests(unittest.TestCase):
    def test_cli_output_is_deterministic_and_has_the_compact_shape(self):
        games = [game_row(f'g{index}', index + 1) for index in range(3)]
        players = [
            player_row('g0', '20'),
            player_row('g0', '3', minutes='0', comment='DND - Sprained Left Ankle'),
            player_row('g1', '3', minutes='0', comment='DND - Sprained Left Ankle'),
            player_row('g1', '20'),
            player_row('g2', '3'),
            player_row('g2', '20'),
        ]
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            games_path, players_path = write_snapshot(directory, games, players)
            first = directory / 'first.json'
            second = directory / 'second.json'
            arguments = [
                '--games',
                str(games_path),
                '--player-statistics',
                str(players_path),
            ]
            with redirect_stderr(io.StringIO()):
                self.assertEqual(main([*arguments, '--output', str(first)]), 0)
                self.assertEqual(main([*arguments, '--output', str(second)]), 0)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            payload = json.loads(first.read_text(encoding='utf-8'))

        self.assertEqual(list(payload), ['schemaVersion', 'seasons'])
        self.assertEqual(payload['schemaVersion'], 1)
        self.assertEqual(len(payload['seasons']), 1)
        season = payload['seasons'][0]
        self.assertEqual(list(season), ['seasonKey', 'players'])
        self.assertEqual(season['seasonKey'], '2024-25')
        self.assertEqual([player['externalId'] for player in season['players']], ['20', '3'])
        self.assertEqual(
            list(season['players'][0]),
            [
                'externalId',
                'playedGames',
                'knownExposureGames',
                'unknownAbsenceGames',
                'injuryEpisodesByDuration',
            ],
        )
        self.assertEqual(season['players'][1]['injuryEpisodesByDuration'], [0, 1, 0, 0])


if __name__ == '__main__':
    unittest.main()
