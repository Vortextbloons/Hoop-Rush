import { playInGameIdOf, playoffGameIdOf, type ConferenceId } from '@hoop-rush/data-contracts';
export const SEASON_POSTSEASON_RISKY_REHAB_COST = 2;
export const POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER = '0'.repeat(32);
export const CONFERENCES: readonly ConferenceId[] = ['east', 'west'];
export const FIRST_ROUND_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 7],
  [3, 4],
  [2, 5],
  [1, 6],
];
export const HOME_COURT_GAMES: ReadonlySet<number> = new Set([1, 2, 5, 7]);
export const PLAY_IN_GAME_ORDER: readonly string[] = [
  playInGameIdOf('east', 'seven-eight'),
  playInGameIdOf('east', 'nine-ten'),
  playInGameIdOf('east', 'final'),
  playInGameIdOf('west', 'seven-eight'),
  playInGameIdOf('west', 'nine-ten'),
  playInGameIdOf('west', 'final'),
];
export const PLAYOFF_SERIES_IDS: readonly string[] = [
  'east-first-round-1',
  'east-first-round-2',
  'east-first-round-3',
  'east-first-round-4',
  'east-semifinal-1',
  'east-semifinal-2',
  'east-conference-final',
  'west-first-round-1',
  'west-first-round-2',
  'west-first-round-3',
  'west-first-round-4',
  'west-semifinal-1',
  'west-semifinal-2',
  'west-conference-final',
  'finals',
];
export const POSTSEASON_GAME_ORDER: readonly string[] = [
  ...PLAY_IN_GAME_ORDER,
  ...PLAYOFF_SERIES_IDS.flatMap((seriesId) =>
    [1, 2, 3, 4, 5, 6, 7].map((gameNumber) => playoffGameIdOf(seriesId, gameNumber)),
  ),
];
