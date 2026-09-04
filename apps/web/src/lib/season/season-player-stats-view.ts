import type { SeasonGameSummary, SeasonRoster } from '@hoop-rush/data-contracts';
import {
  eraIdSchema,
  franchiseIdSchema,
  playerIdSchema,
  seasonKeySchema,
} from '@hoop-rush/data-contracts';
import { foldSeasonAggregates } from './season-presentation';
export interface SeasonPlayerStatsRow {
  playerVersionId: string;
  displayName: string;
  seasonKey: string;
  eraId: string;
  franchiseId: string;
  positions: readonly string[];
  overallRating: number | null;
  gamesPlayed: number;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threePointersMade: number;
  threePointersAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  minutesPerGame: number;
  pointsPerGame: number;
  reboundsPerGame: number;
  assistsPerGame: number;
  stealsPerGame: number;
  blocksPerGame: number;
  turnoversPerGame: number;
  fieldGoalPct: number | null;
  threePointPct: number | null;
  freeThrowPct: number | null;
}
export interface SeasonPlayerStatsView {
  franchiseId: string;
  rows: SeasonPlayerStatsRow[];
  hasStats: boolean;
}
export type SeasonPlayerStatsMeasure = 'perGame' | 'totals';
export type SeasonPlayerStatsSortKey =
  | 'displayName'
  | 'gamesPlayed'
  | 'minutesPerGame'
  | 'pointsPerGame'
  | 'reboundsPerGame'
  | 'assistsPerGame'
  | 'stealsPerGame'
  | 'blocksPerGame'
  | 'turnoversPerGame'
  | 'minutes'
  | 'points'
  | 'rebounds'
  | 'assists'
  | 'steals'
  | 'blocks'
  | 'turnovers'
  | 'fouls'
  | 'fieldGoalPct'
  | 'threePointPct'
  | 'freeThrowPct';
function pct(made: number, attempted: number): number | null {
  return attempted > 0 ? made / attempted : null;
}
export function humanSeasonPlayerStats(input: {
  roster: SeasonRoster;
  summaries: readonly SeasonGameSummary[];
  overallRatingOf: (playerVersionId: string) => number | null;
  playablePositions: (playerVersionId: string) => readonly string[];
}): SeasonPlayerStatsView {
  const { roster, summaries } = input;
  const byVersion = new Map(
    foldSeasonAggregates(summaries).players.map((player) => [player.playerVersionId, player]),
  );
  const rows: SeasonPlayerStatsRow[] = roster.players.map((entry) => {
    const aggregate = byVersion.get(entry.playerVersionId) ?? null;
    const games = aggregate?.gamesPlayed ?? 0;
    const rate = (value: number): number => (games > 0 ? value / games : 0);
    const offensiveRebounds = aggregate?.offensiveRebounds ?? 0;
    const defensiveRebounds = aggregate?.defensiveRebounds ?? 0;
    const seconds = aggregate?.seconds ?? 0;
    return {
      playerVersionId: entry.playerVersionId,
      displayName: entry.displayName,
      seasonKey: entry.seasonKey,
      eraId: entry.eraId,
      franchiseId: entry.franchiseId,
      positions: input.playablePositions(entry.playerVersionId),
      overallRating: input.overallRatingOf(entry.playerVersionId),
      gamesPlayed: games,
      minutes: seconds / 60,
      points: aggregate?.points ?? 0,
      rebounds: offensiveRebounds + defensiveRebounds,
      assists: aggregate?.assists ?? 0,
      steals: aggregate?.steals ?? 0,
      blocks: aggregate?.blocks ?? 0,
      turnovers: aggregate?.turnovers ?? 0,
      fouls: aggregate?.fouls ?? 0,
      fieldGoalsMade: aggregate?.fieldGoalsMade ?? 0,
      fieldGoalsAttempted: aggregate?.fieldGoalsAttempted ?? 0,
      threePointersMade: aggregate?.threePointersMade ?? 0,
      threePointersAttempted: aggregate?.threePointersAttempted ?? 0,
      freeThrowsMade: aggregate?.freeThrowsMade ?? 0,
      freeThrowsAttempted: aggregate?.freeThrowsAttempted ?? 0,
      minutesPerGame: rate(seconds) / 60,
      pointsPerGame: rate(aggregate?.points ?? 0),
      reboundsPerGame: rate(offensiveRebounds + defensiveRebounds),
      assistsPerGame: rate(aggregate?.assists ?? 0),
      stealsPerGame: rate(aggregate?.steals ?? 0),
      blocksPerGame: rate(aggregate?.blocks ?? 0),
      turnoversPerGame: rate(aggregate?.turnovers ?? 0),
      fieldGoalPct:
        aggregate === null ? null : pct(aggregate.fieldGoalsMade, aggregate.fieldGoalsAttempted),
      threePointPct:
        aggregate === null
          ? null
          : pct(aggregate.threePointersMade, aggregate.threePointersAttempted),
      freeThrowPct:
        aggregate === null ? null : pct(aggregate.freeThrowsMade, aggregate.freeThrowsAttempted),
    };
  });
  return { franchiseId: roster.franchiseId, rows, hasStats: summaries.length > 0 };
}
export function playerSeasonStatsRow(input: {
  playerVersionId: string;
  displayName: string;
  seasonKey: string;
  eraId: string;
  franchiseId: string;
  summaries: readonly SeasonGameSummary[];
  overallRatingOf: (playerVersionId: string) => number | null;
  playablePositions: (playerVersionId: string) => readonly string[];
}): SeasonPlayerStatsRow | null {
  const view = humanSeasonPlayerStats({
    roster: {
      franchiseId: franchiseIdSchema.parse(input.franchiseId),
      players: [
        {
          playerVersionId: input.playerVersionId,
          playerId: playerIdSchema.parse('p-trade-detail'),
          franchiseId: franchiseIdSchema.parse(input.franchiseId),
          eraId: eraIdSchema.parse(input.eraId),
          seasonKey: seasonKeySchema.parse(input.seasonKey),
          displayName: input.displayName,
        },
      ],
    },
    summaries: input.summaries,
    overallRatingOf: input.overallRatingOf,
    playablePositions: input.playablePositions,
  });
  const row = view.rows[0];
  return row !== undefined && row.gamesPlayed > 0 ? row : null;
}
