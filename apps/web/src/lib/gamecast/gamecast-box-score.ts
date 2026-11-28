import type { MadeAttempted } from '@hoop-rush/data-contracts';
import type { PlayerStatColumn, PlayerStatsTotals } from '#lib/components/player-stats-table.js';
import { ratioPct, trueShootingPct } from '#lib/format.js';

/** The shared shape of a player line in the neutral gamecast box scores. */
export interface GamecastBoxScoreLine {
  readonly minutes: number;
  readonly points: number;
  readonly fieldGoals: MadeAttempted;
  readonly threes: MadeAttempted;
  readonly freeThrows: MadeAttempted;
  readonly rebounds: { readonly total: number };
  readonly assists: number;
  readonly steals: number;
  readonly blocks: number;
  readonly turnovers: number;
  readonly fouls: number;
}

export type GamecastBoxScoreColumnKey =
  | 'points'
  | 'rebounds'
  | 'assists'
  | 'steals'
  | 'blocks'
  | 'turnovers'
  | 'fouls'
  | 'fieldGoals'
  | 'threes'
  | 'freeThrows'
  | 'fieldGoalPct'
  | 'trueShootingPct'
  | 'usagePct';

const LABELS: Record<GamecastBoxScoreColumnKey, string> = {
  points: 'PTS',
  rebounds: 'REB',
  assists: 'AST',
  steals: 'STL',
  blocks: 'BLK',
  turnovers: 'TO',
  fouls: 'PF',
  fieldGoals: 'FG',
  threes: '3P',
  freeThrows: 'FT',
  fieldGoalPct: 'FG%',
  trueShootingPct: 'TS%',
  usagePct: 'USG%',
};

function valueOf(key: GamecastBoxScoreColumnKey, row: GamecastBoxScoreLine): string | number {
  switch (key) {
    case 'points':
      return row.points;
    case 'rebounds':
      return row.rebounds.total;
    case 'assists':
      return row.assists;
    case 'steals':
      return row.steals;
    case 'blocks':
      return row.blocks;
    case 'turnovers':
      return row.turnovers;
    case 'fouls':
      return row.fouls;
    case 'fieldGoals':
      return `${String(row.fieldGoals.made)}-${String(row.fieldGoals.attempted)}`;
    case 'threes':
      return `${String(row.threes.made)}-${String(row.threes.attempted)}`;
    case 'freeThrows':
      return `${String(row.freeThrows.made)}-${String(row.freeThrows.attempted)}`;
    case 'fieldGoalPct':
      return ratioPct(row.fieldGoals.made, row.fieldGoals.attempted);
    case 'trueShootingPct':
      return trueShootingPct(row.points, row.fieldGoals.attempted, row.freeThrows.attempted);
    case 'usagePct':
      return '—';
  }
}

/**
 * Column definitions shared by the five-man Gamecast recap and Full Court.
 * Callers choose the order and any mode-only columns (minutes, energy) themselves.
 */
export function gamecastBoxScoreColumns(
  keys: readonly GamecastBoxScoreColumnKey[],
): PlayerStatColumn<GamecastBoxScoreLine>[] {
  return keys.map((key) => ({
    key,
    label: LABELS[key],
    value: (row: GamecastBoxScoreLine) => valueOf(key, row),
    ...(key === 'points' ? { cellClass: 'ui-stats-value-strong' } : {}),
  }));
}

export interface GamecastBoxScoreTotals {
  readonly minutes: number;
  readonly points: number;
  readonly rebounds: number;
  readonly assists: number;
  readonly steals: number;
  readonly blocks: number;
  readonly turnovers: number;
  readonly fouls: number;
  readonly fieldGoals: MadeAttempted;
  readonly threes: MadeAttempted;
  readonly freeThrows: MadeAttempted;
}

/** Sum player lines for the footer of a gamecast box score. */
export function gamecastBoxScoreLineTotals(
  players: readonly GamecastBoxScoreLine[],
): GamecastBoxScoreTotals {
  let minutes = 0;
  let points = 0;
  let rebounds = 0;
  let assists = 0;
  let steals = 0;
  let blocks = 0;
  let turnovers = 0;
  let fouls = 0;
  let fgm = 0;
  let fga = 0;
  let tpm = 0;
  let tpa = 0;
  let ftm = 0;
  let fta = 0;
  for (const player of players) {
    minutes += player.minutes;
    points += player.points;
    rebounds += player.rebounds.total;
    assists += player.assists;
    steals += player.steals;
    blocks += player.blocks;
    turnovers += player.turnovers;
    fouls += player.fouls;
    fgm += player.fieldGoals.made;
    fga += player.fieldGoals.attempted;
    tpm += player.threes.made;
    tpa += player.threes.attempted;
    ftm += player.freeThrows.made;
    fta += player.freeThrows.attempted;
  }
  return {
    minutes,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    turnovers,
    fouls,
    fieldGoals: { made: fgm, attempted: fga },
    threes: { made: tpm, attempted: tpa },
    freeThrows: { made: ftm, attempted: fta },
  };
}

/** Map team totals onto the columns shared by the gamecast box scores. */
export function gamecastBoxScoreTotals(
  totals: GamecastBoxScoreTotals,
): PlayerStatsTotals<GamecastBoxScoreLine> {
  return {
    value: (column) => {
      switch (column.key) {
        case 'minutes':
          return totals.minutes;
        case 'points':
          return totals.points;
        case 'rebounds':
          return totals.rebounds;
        case 'assists':
          return totals.assists;
        case 'steals':
          return totals.steals;
        case 'blocks':
          return totals.blocks;
        case 'turnovers':
          return totals.turnovers;
        case 'fouls':
          return totals.fouls;
        case 'fieldGoals':
          return `${String(totals.fieldGoals.made)}-${String(totals.fieldGoals.attempted)}`;
        case 'threes':
          return `${String(totals.threes.made)}-${String(totals.threes.attempted)}`;
        case 'freeThrows':
          return `${String(totals.freeThrows.made)}-${String(totals.freeThrows.attempted)}`;
        case 'fieldGoalPct':
          return ratioPct(totals.fieldGoals.made, totals.fieldGoals.attempted);
        case 'trueShootingPct':
          return trueShootingPct(
            totals.points,
            totals.fieldGoals.attempted,
            totals.freeThrows.attempted,
          );
        case 'usagePct':
          return '100.0%';
        default:
          return '—';
      }
    },
  };
}
