import unittest
from fetch_roster_advanced import parse_advanced


def row(team='SFW', games='80', minutes='3806', per='31.8', extra=''):
    return (f'<tr><td data-append-csv="chambwi01" data-stat="name_display">Wilt</td>'
            f'<td data-stat="team_name_abbr">{team}</td><td data-stat="games">{games}</td>'
            f'<td data-stat="mp">{minutes}</td><td data-stat="per"><strong>{per}</strong></td>{extra}</tr>')


class RosterAdvancedTests(unittest.TestCase):
    def test_regular_season_only_and_missing_fields_stay_missing(self):
        html = '<table id="advanced">' + row() + '</table><table id="advanced_post">' + row(per='99') + '</table>'
        result = parse_advanced(html)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['per'], 31.8)
        self.assertIsNone(result[0]['usageRate'])
        self.assertIsNone(result[0]['boxPlusMinus'])

    def test_combined_trade_row_is_used_and_zero_is_preserved(self):
        extra = '<td data-stat="bpm">0.0</td><td data-stat="usg_pct">22.5</td>'
        html = '<table id="advanced">' + row('2TM', extra=extra) + row('SFW', '40', '1903') + row('LAL', '40', '1903') + '</table>'
        result = parse_advanced(html)[0]
        self.assertEqual(result['gamesPlayed'], 80)
        self.assertEqual(result['boxPlusMinus'], 0)
        self.assertEqual(result['usageRate'], 22.5)

    def test_empty_ambiguous_and_invalid_tables_fail(self):
        for html in ['<table id="advanced"></table>',
                     '<table id="advanced">' + row('SFW') + row('LAL') + '</table>',
                     '<table id="advanced">' + row(per='NaN') + '</table>']:
            with self.assertRaises(ValueError):
                parse_advanced(html)


if __name__ == '__main__':
    unittest.main()
