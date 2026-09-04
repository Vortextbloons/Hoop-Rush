import type {
  SeasonGameSummary,
  SeasonPlayerAggregate,
  SeasonRoster,
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
  playerAggregates?: readonly SeasonPlayerAggregate[];
}): SeasonPlayerStatsView {
  const { roster, summaries } = input;
  const players = input.playerAggregates ?? foldSeasonAggregates(summaries).players;
  const byVersion = new Map(players.map((player) => [player.playerVersionId, player]));
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
  let gamesPlayed = 0;
  let seconds = 0;
  let points = 0;
  let offensiveRebounds = 0;
  let defensiveRebounds = 0;
  let assists = 0;
  let steals = 0;
  let blocks = 0;
  let turnovers = 0;
  let fouls = 0;
  let fieldGoalsMade = 0;
  let fieldGoalsAttempted = 0;
  let threePointersMade = 0;
  let threePointersAttempted = 0;
  let freeThrowsMade = 0;
  let freeThrowsAttempted = 0;
  for (const summary of input.summaries) {
    if (summary.status === 'forfeit') continue;
    for (const lines of [summary.homePlayers, summary.awayPlayers]) {
      for (const line of lines) {
        if (line.playerVersionId !== input.playerVersionId) continue;
        gamesPlayed += 1;
        seconds += line.seconds;
        points += line.points;
        offensiveRebounds += line.offensiveRebounds;
        defensiveRebounds += line.defensiveRebounds;
        assists += line.assists;
        steals += line.steals;
        blocks += line.blocks;
        turnovers += line.turnovers;
        fouls += line.fouls;
        fieldGoalsMade += line.fieldGoalsMade;
        fieldGoalsAttempted += line.fieldGoalsAttempted;
        threePointersMade += line.threePointersMade;
        threePointersAttempted += line.threePointersAttempted;
        freeThrowsMade += line.freeThrowsMade;
        freeThrowsAttempted += line.freeThrowsAttempted;
      }
    }
  }
  if (gamesPlayed === 0) return null;
  const rate = (value: number): number => value / gamesPlayed;
  const rebounds = offensiveRebounds + defensiveRebounds;
  return {
    playerVersionId: input.playerVersionId,
    displayName: input.displayName,
    seasonKey: input.seasonKey,
    eraId: input.eraId,
    franchiseId: input.franchiseId,
    positions: input.playablePositions(input.playerVersionId),
    overallRating: input.overallRatingOf(input.playerVersionId),
    gamesPlayed,
    minutes: seconds / 60,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    turnovers,
    fouls,
    fieldGoalsMade,
    fieldGoalsAttempted,
    threePointersMade,
    threePointersAttempted,
    freeThrowsMade,
    freeThrowsAttempted,
    minutesPerGame: rate(seconds) / 60,
    pointsPerGame: rate(points),
    reboundsPerGame: rate(rebounds),
    assistsPerGame: rate(assists),
    stealsPerGame: rate(steals),
    blocksPerGame: rate(blocks),
    turnoversPerGame: rate(turnovers),
    fieldGoalPct: pct(fieldGoalsMade, fieldGoalsAttempted),
    threePointPct: pct(threePointersMade, threePointersAttempted),
    freeThrowPct: pct(freeThrowsMade, freeThrowsAttempted),
  };
}
