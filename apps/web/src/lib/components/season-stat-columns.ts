import type { PlayerStatColumn } from './player-stats-table.js';

export type SeasonStatKey =
  | 'games'
  | 'points'
  | 'rebounds'
  | 'assists'
  | 'steals'
  | 'blocks'
  | 'turnovers'
  | 'fgPct'
  | 'threePct'
  | 'ftPct'
  | 'tsPct'
  | 'usagePct'
  | 'fgAttempts'
  | 'threeAttempts'
  | 'ftAttempts'
  | 'threeMade';

const LABELS: Record<SeasonStatKey, string> = {
  games: 'GP',
  points: 'PTS',
  rebounds: 'REB',
  assists: 'AST',
  steals: 'STL',
  blocks: 'BLK',
  turnovers: 'TOV',
  fgPct: 'FG%',
  threePct: '3P%',
  ftPct: 'FT%',
  tsPct: 'TS%',
  usagePct: 'USG%',
  fgAttempts: 'FGA',
  threeAttempts: '3PA',
  ftAttempts: 'FTA',
  threeMade: '3PM',
};

export type SeasonStatFormatters<Row> = {
  readonly [Key in SeasonStatKey]?: (row: Row) => string | number;
};

export interface SeasonStatColumnOptions {
  /** Only where games played actually varies (Full Court benches). */
  includeGames?: boolean;
  /** Attempts and makes move after usage so the box-score core stays first. */
  includeDetailed?: boolean;
}

/**
 * One column order for every season/aggregate player table:
 * counting stats, then percentages, then usage, then optional attempts.
 */
export function seasonStatColumns<Row>(
  formatters: SeasonStatFormatters<Row>,
  options: SeasonStatColumnOptions = {},
): PlayerStatColumn<Row>[] {
  const order: SeasonStatKey[] = [
    ...(options.includeGames === true ? (['games'] as const) : []),
    'points',
    'rebounds',
    'assists',
    'steals',
    'blocks',
    'turnovers',
    'fgPct',
    'threePct',
    'ftPct',
    'tsPct',
    'usagePct',
    ...(options.includeDetailed === true
      ? (['fgAttempts', 'threeAttempts', 'ftAttempts', 'threeMade'] as const)
      : []),
  ];

  return order
    .filter((key) => formatters[key] !== undefined)
    .map((key) => ({
      key,
      label: LABELS[key],
      value: formatters[key] as (row: Row) => string | number,
      ...(key === 'points' ? { cellClass: 'font-bold' } : {}),
    }));
}
