import type {
  PeakPlayerSeason,
  SimulationPlayer,
  SimulationAnchors,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';

/**
 * Adapts packaged peak player-seasons to the explicit SimulationPlayer
 * contract at the application boundary. Only the frozen ratings and tendency
 * keys survive; the summary Overall rating and legacy open-ended records are
 * never passed to the engine.
 */

const RATING_KEYS: readonly (keyof SimulationRatings)[] = [
  'insideScoring',
  'closeShot',
  'midrange',
  'threePoint',
  'freeThrow',
  'ballHandling',
  'passing',
  'offensiveIq',
  'offensiveRebound',
  'defensiveRebound',
  'perimeterDefense',
  'interiorDefense',
  'steal',
  'block',
  'defensiveIq',
  'speed',
  'strength',
  'vertical',
];

const TENDENCY_KEYS: readonly (keyof SimulationTendencies)[] = [
  'usageRate',
  'passRate',
  'shotRate',
  'driveRate',
  'postUpRate',
  'rimFrequency',
  'shortMidFrequency',
  'longMidFrequency',
  'cornerThreeFrequency',
  'aboveBreakThreeFrequency',
  'threePointRate',
  'freeThrowRate',
  'turnoverRate',
  'isolationRate',
  'pickAndRollBallHandlerRate',
  'pickAndRollRollManRate',
  'spotUpRate',
  'transitionRate',
  'cutRate',
  'foulRate',
  'stealAttemptRate',
  'blockAttemptRate',
  'crashOffensiveGlassRate',
];

function clampRating(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function clampTendency(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function ratio(numerator: number, denominator: number, fallback: number): number {
  return denominator > 0 ? numerator / denominator : fallback;
}

function shrunkRatio(
  numerator: number,
  denominator: number,
  prior: number,
  priorAttempts = 80,
): number {
  return denominator > 0
    ? (numerator + prior * priorAttempts) / (denominator + priorAttempts)
    : prior;
}

/**
 * Preserves the selected season's observable production alongside derived
 * ratings. The possession engine uses these as soft anchors, not guarantees,
 * so matchup and era context can still move the result.
 */
function simulationAnchors(player: PeakPlayerSeason): SimulationAnchors {
  const stats = player.stats;
  const games = Math.max(1, stats.gamesPlayed);
  const fieldGoalAttempts = stats.fieldGoalsAttempted;
  const threePointAttempts = stats.threesAttempted;
  const freeThrowAttempts = stats.freeThrowsAttempted;
  const position = player.positions.canonical;
  const fallbackOffensiveShare = position.includes('C')
    ? 0.28
    : position.includes('F')
      ? 0.22
      : 0.15;
  const hasReliableSplit =
    stats.offensiveRebounds !== undefined &&
    stats.defensiveRebounds !== undefined &&
    (stats.offensiveRebounds > 0 ||
      (!position.includes('C') && !(position.includes('F') && stats.rebounds / games > 2.5)));
  const offensiveRebounds = hasReliableSplit
    ? stats.offensiveRebounds!
    : Math.round(stats.rebounds * fallbackOffensiveShare);
  const defensiveRebounds = hasReliableSplit
    ? stats.defensiveRebounds!
    : Math.max(0, stats.rebounds - offensiveRebounds);

  return {
    gamesPlayed: stats.gamesPlayed,
    minutesPerGame: Math.min(60, stats.minutes / games),
    pointsPerGame: stats.points / games,
    reboundsPerGame: stats.rebounds / games,
    offensiveReboundsPerGame: offensiveRebounds / games,
    defensiveReboundsPerGame: defensiveRebounds / games,
    assistsPerGame: stats.assists / games,
    stealsPerGame: stats.steals / games,
    blocksPerGame: stats.blocks / games,
    turnoversPerGame: stats.turnovers / games,
    fieldGoalPct: shrunkRatio(stats.fieldGoalsMade, fieldGoalAttempts, 0.45),
    threePointPct:
      threePointAttempts > 0 ? shrunkRatio(stats.threesMade, threePointAttempts, 0.34) : null,
    freeThrowPct: shrunkRatio(stats.freeThrowsMade, freeThrowAttempts, 0.75),
    threePointAttemptRate: ratio(threePointAttempts, fieldGoalAttempts, 0),
    freeThrowAttemptRate: ratio(freeThrowAttempts, fieldGoalAttempts, 0.2),
  };
}

export function toSimulationPlayer(player: PeakPlayerSeason): SimulationPlayer {
  const sourceRatings = player.detailedRatings as Record<string, number | undefined>;
  const sourceTendencies = player.tendencies as Record<string, number | undefined>;
  const ratings = {} as SimulationRatings;
  for (const key of RATING_KEYS) {
    const value = sourceRatings[key];
    ratings[key] = typeof value === 'number' ? clampRating(value) : 50;
  }
  const tendencies = {} as SimulationTendencies;
  for (const key of TENDENCY_KEYS) {
    const value = sourceTendencies[key];
    tendencies[key] = typeof value === 'number' ? clampTendency(value) : 0;
  }
  return {
    playerId: player.playerId,
    displayName: player.displayName,
    positions: player.positions.canonical,
    heightInches: player.heightInches,
    weightLbs: player.weightLbs,
    ratings,
    tendencies,
    anchors: simulationAnchors(player),
  };
}
