import type {
  PeakPlayerSeason,
  SimulationPlayer,
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
  };
}
