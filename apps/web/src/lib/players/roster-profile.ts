import type { PlayoffPerformance, RosterDetailsEntry } from '@hoop-rush/data-contracts';
import {
  defaultSlotForPositions,
  type PlayerProfileInput,
  type PlayerProfileStatGroup,
  type PlayerProfileStats,
  type ProfileSample,
} from '#lib/players/player-profile.js';

type RosterStats = RosterDetailsEntry['stats'];

/** Below this, a playoff sample is noise rather than evidence. */
const MINIMUM_POSTSEASON_GAMES = 10;
const MINIMUM_POSTSEASON_MINUTES = 100;

function perGame(total: number | null, games: number): number | null {
  if (total === null || games <= 0) return null;
  return total / games;
}

function ratio(made: number | null, attempted: number | null): number | null {
  if (made === null || attempted === null || attempted <= 0) return null;
  return made / attempted;
}

/** Converts the stored season totals into the per-game line the panel shows. */
export function rosterProfileStats(stats: RosterStats): PlayerProfileStats {
  const games = stats.gamesPlayed;
  return {
    gamesPlayed: games,
    minutes: perGame(stats.minutes, games),
    points: perGame(stats.points, games),
    rebounds: perGame(stats.rebounds, games),
    assists: perGame(stats.assists, games),
    steals: perGame(stats.steals, games),
    blocks: perGame(stats.blocks, games),
    turnovers: perGame(stats.turnovers, games),
    fgPct: ratio(stats.fieldGoalsMade, stats.fieldGoalsAttempted),
    threePct: ratio(stats.threesMade, stats.threesAttempted),
    ftPct: ratio(stats.freeThrowsMade, stats.freeThrowsAttempted),
    tsPct: stats.tsPct,
    efgPct: stats.efgPct,
    usageRate: stats.usageRate,
    per: stats.per,
    boxPlusMinus: stats.boxPlusMinus,
  };
}

export interface RosterProfileSource {
  readonly playerId: string;
  readonly displayName: string;
  readonly franchiseId: string;
  readonly eraId: string;
  readonly seasonKey: string;
  readonly positionsPlayable: readonly string[];
  readonly overall: number;
  readonly offense: number;
  readonly defense: number;
  readonly detail: RosterDetailsEntry | null;
  readonly playoffPerformance?: PlayoffPerformance | null;
}

/** Playoff-versus-regular-season deltas, shown only when a sample exists. */
function postseasonGroupsOf(
  performance: PlayoffPerformance | null | undefined,
): PlayerProfileStatGroup[] | null {
  if (performance === null || performance === undefined) return null;
  const games = performance.playoffs.gamesPlayed;
  // A handful of minutes cannot establish playoff form; say nothing instead of
  // implying a signal from three games.
  if (
    games < MINIMUM_POSTSEASON_GAMES ||
    performance.playoffs.minutes < MINIMUM_POSTSEASON_MINUTES
  ) {
    return null;
  }
  const d = performance.differences;
  const signed = (value: number | null, digits = 1): string =>
    value === null || !Number.isFinite(value)
      ? '\u2014'
      : `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
  return [
    {
      title: 'Playoff sample',
      rows: [
        { label: 'Games', value: String(games) },
        { label: 'Minutes', value: Math.round(performance.playoffs.minutes).toString() },
        { label: 'PTS /36', value: signed(d.pointsPer36) },
        { label: 'AST /36', value: signed(d.assistsPer36) },
        { label: 'REB /36', value: signed(d.reboundsPer36) },
        { label: 'TS%', value: signed(d.tsPct, 3) },
      ],
    },
  ];
}

/**
 * Profile input for a roster row. Ratings come from the roster-details artifact,
 * so a row without details still renders identity but no rating sections.
 */
export function rosterProfileInput(
  row: RosterProfileSource,
  franchiseLabel: string,
): PlayerProfileInput | null {
  const detail = row.detail;
  if (detail === null || detail.ratings === undefined || detail.tendencies === undefined) {
    return null;
  }
  return {
    displayName: row.displayName,
    franchiseLabel,
    seasonKey: row.seasonKey,
    positions: row.positionsPlayable,
    heightInches: detail.heightInches,
    weightLbs: detail.weightLbs,
    overall: row.overall,
    offense: row.offense,
    defense: row.defense,
    ratings: detail.ratings,
    tendencies: detail.tendencies,
    anchors: null,
    stats: rosterProfileStats(detail.stats),
    postseason:
      postseasonGroupsOf(row.playoffPerformance) ??
      postseasonGroupsOf(detail.playoffPerformance ?? null),
    slot: defaultSlotForPositions(row.positionsPlayable),
  };
}

export interface RosterProfileSampleSource {
  readonly detail: RosterDetailsEntry | null;
  readonly positionsPlayable: readonly string[];
}

/**
 * Percentile samples for the whole roster. Positions come from the players index
 * row, since the details artifact does not repeat them.
 */
export function rosterProfileSamples(
  rows: readonly RosterProfileSampleSource[],
): readonly ProfileSample[] {
  const samples: ProfileSample[] = [];
  for (const row of rows) {
    const detail = row.detail;
    if (detail === null || detail.ratings === undefined || detail.tendencies === undefined) {
      continue;
    }
    samples.push({
      positions: row.positionsPlayable,
      ratings: detail.ratings,
      tendencies: detail.tendencies,
    });
  }
  return samples;
}
