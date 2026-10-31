import unittest

from build_playoff_adjustments import difference, possessions, shooting_difference, volume_difference
from fetch_playoff_history import game_season, normalize_game_minutes, normalized_row, COLUMNS


def sample(minutes, exposure, points, assists, rebounds, turnovers, context=None):
    return {'minutes': minutes, 'possessions': exposure, 'points': points, 'tsa': points / 1.2, 'values': [points, assists, rebounds, turnovers], 'context': context or [0, 1, 1, 1, 1]}


class PlayoffAdjustmentTests(unittest.TestCase):
    def test_slower_pace_does_not_create_a_penalty(self):
        regular = [sample(36, 75, 30, 6, 9, 3)]
        playoffs = [sample(36, 60, 24, 4.8, 7.2, 2.4)]
        _, _, delta, _, _ = difference(regular, playoffs)
        for value in delta:
            self.assertAlmostEqual(value, 0)

    def test_opponent_difficulty_explains_a_decline_without_full_team_penalty(self):
        regular = [sample(36, 75, 30, 6, 9, 3)]
        playoffs = [sample(36, 75, 27, 6, 9, 3, [0, .9, 1, 1, 1])]
        actual, expected, delta, _, _ = difference(regular, playoffs)
        self.assertAlmostEqual(actual[1], expected[1])
        self.assertAlmostEqual(delta[1], 0)

    def test_regular_schedule_and_each_channel_have_their_own_adjustment(self):
        regular = [sample(36, 75, 30, 6, 9, 3, [0, .9, 1, 1, 1])]
        playoffs = [sample(36, 75, 30, 7, 9, 4, [0, .9, 1, 1, 1])]
        _, _, delta, _, _ = difference(regular, playoffs)
        self.assertAlmostEqual(delta[1], 0)
        self.assertGreater(delta[2], 0)
        self.assertAlmostEqual(delta[3], 0)
        self.assertGreater(delta[4], 0)

    def test_possession_estimate_is_symmetric(self):
        a = {'fieldGoalsAttempted': 90, 'freeThrowsAttempted': 20, 'reboundsOffensive': 10, 'turnovers': 12}
        b = {'fieldGoalsAttempted': 85, 'freeThrowsAttempted': 25, 'reboundsOffensive': 8, 'turnovers': 15}
        self.assertEqual(possessions(a, b), possessions(b, a))


class ShootingModelTests(unittest.TestCase):
    def shooting_sample(self, made=50, attempts=100, fga=20, points=30, defense=0):
        return {'shots': [(made, attempts), (10, 30), (15, 20)], 'context': [0, 1, 1, 1, 1, defense, 0, 0, 1], 'possessions': 100, 'minutes': 36, 'fga': fga, 'points': points}

    def test_harder_two_point_defense_does_not_create_a_shooting_penalty(self):
        regular = [self.shooting_sample()]
        post = [self.shooting_sample(made=45, defense=-.05)]
        result = shooting_difference(regular, post, 0)
        self.assertAlmostEqual(result['difference'], 0)
        self.assertEqual(result['attempts'], 100)

    def test_separates_shooting_types_and_unavailable_attempts(self):
        regular, post = [self.shooting_sample()], [self.shooting_sample(made=60)]
        self.assertGreater(shooting_difference(regular, post, 0)['difference'], 0)
        self.assertEqual(shooting_difference(regular, post, 1)['difference'], 0)
        post[0]['shots'][2] = None
        self.assertIsNone(shooting_difference(regular, post, 2))

    def test_lower_scoring_does_not_reduce_shot_volume_when_attempts_are_unchanged(self):
        regular = [self.shooting_sample(points=30)]
        post = [self.shooting_sample(points=20)]
        self.assertEqual(volume_difference(regular, post)['differencePer36'], 0)
        post[0]['fga'] = 25
        self.assertGreater(volume_difference(regular, post)['differencePer36'], 0)


class HistoricalSourceTests(unittest.TestCase):
    def test_uses_game_identity_for_bubble_and_lockout_seasons_and_excludes_cup_finals(self):
        self.assertEqual(game_season('29800001'), '1998-99')
        self.assertEqual(game_season('41900401'), '2019-20')
        self.assertEqual(game_season('42500401'), '2025-26')
        self.assertIsNone(game_season('62500001'))
        self.assertIsNone(game_season('12500001'))

    def test_recovers_minute_second_encoding_only_when_team_duration_supports_it(self):
        rows = [{'teamId': team, 'minutes': str(value)} for team in ('a', 'b') for value in [30.15, 29.45] * 4]
        normalize_game_minutes(rows)
        self.assertAlmostEqual(float(rows[0]['minutes']), 30.25)
        self.assertAlmostEqual(sum(float(row['minutes']) for row in rows if row['teamId'] == 'a'), 240)
        self.assertTrue(all(row['minutePrecision'] == 0 for row in rows))

    def test_preserves_decimal_minutes_and_marks_whole_minute_precision(self):
        rows = [{'teamId': team, 'minutes': str(value)} for team in ('a', 'b') for value in [30.25, 29.75] * 4]
        normalize_game_minutes(rows)
        self.assertEqual(float(rows[0]['minutes']), 30.25)
        rows = [{'teamId': team, 'minutes': '30'} for team in ('a', 'b') for _ in range(8)]
        normalize_game_minutes(rows)
        self.assertTrue(all(row['minutePrecision'] == 1 for row in rows))

    def test_rejects_missing_counting_stats_instead_of_imputing_zero(self):
        row = {'gameId': '42500401', 'playerteamId': 'a', 'personId': '1', 'numMinutes': '30', **{c: '0' for c in COLUMNS}}
        row['turnovers'] = ''
        self.assertIsNone(normalized_row(row, {'hometeamId': 'a', 'awayteamId': 'b'}))

    def test_keeps_recorded_stats_when_whole_minutes_truncate_a_short_appearance_to_zero(self):
        row = {'gameId': '29600001', 'playerteamId': 'a', 'personId': '1', 'numMinutes': '0.0', **{c: '0' for c in COLUMNS}}
        row['reboundsTotal'] = '1'
        normalized = normalized_row(row, {'hometeamId': 'a', 'awayteamId': 'b'})
        self.assertIsNotNone(normalized)
        self.assertEqual(normalized['reboundsTotal'], 1)
        self.assertEqual(normalized['minutePrecision'], 1)


if __name__ == '__main__':
    unittest.main()
