import type {
  SimulationPlayer,
  SimulationRatings,
  SimulationTeam,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import { playerIdSchema } from '@hoop-rush/data-contracts';
export const BENCHMARK_VERSION = 'benchmark-v1';
const SLOT_POSITIONS: SimulationPlayer['positions'][] = [['PG'], ['SG'], ['SF'], ['PF'], ['C']];
const BENCHMARK_TENDENCIES: SimulationTendencies = {
  usageRate: 20,
  passRate: 30,
  shotRate: 25,
  driveRate: 18,
  postUpRate: 5,
  rimFrequency: 30,
  shortMidFrequency: 20,
  longMidFrequency: 14,
  cornerThreeFrequency: 8,
  aboveBreakThreeFrequency: 12,
  threePointRate: 20,
  freeThrowRate: 22,
  turnoverRate: 12,
  isolationRate: 10,
  pickAndRollBallHandlerRate: 25,
  pickAndRollRollManRate: 10,
  spotUpRate: 20,
  transitionRate: 15,
  cutRate: 10,
  foulRate: 2,
  stealAttemptRate: 8,
  blockAttemptRate: 10,
  crashOffensiveGlassRate: 12,
};
function scaleRatings(targetCenter: number): SimulationRatings {
  const base: SimulationRatings = {
    insideScoring: 78,
    closeShot: 70,
    midrange: 68,
    threePoint: 65,
    freeThrow: 74,
    ballHandling: 70,
    passing: 70,
    offensiveIq: 70,
    offensiveRebound: 60,
    defensiveRebound: 65,
    perimeterDefense: 62,
    interiorDefense: 62,
    steal: 60,
    block: 60,
    defensiveIq: 62,
    speed: 70,
    strength: 65,
    vertical: 66,
  };
  const shifted = {} as SimulationRatings;
  for (const [key, value] of Object.entries(base)) {
    shifted[key as keyof SimulationRatings] = Math.max(
      30,
      Math.min(95, Math.round(value + (targetCenter - 65))),
    );
  }
  return shifted;
}
function benchmarkTeam(teamId: string, displayName: string, targetCenter: number): SimulationTeam {
  return {
    teamId,
    displayName,
    players: SLOT_POSITIONS.map((positions, i) => ({
      playerId: playerIdSchema.parse(`bm-${teamId}-${String(i + 1)}`),
      displayName: `${displayName} ${String(i + 1)}`,
      positions,
      heightInches: 78,
      weightLbs: 215,
      ratings: scaleRatings(targetCenter),
      tendencies: { ...BENCHMARK_TENDENCIES },
    })),
  };
}
export const WEAK_BENCHMARK = benchmarkTeam('benchmark-weak', 'Benchmark Weak', 48);
export const MEDIUM_BENCHMARK = benchmarkTeam('benchmark-medium', 'Benchmark Medium', 65);
export const STRONG_BENCHMARK = benchmarkTeam('benchmark-strong', 'Benchmark Strong', 85);
export const BENCHMARK_WEIGHTS: ReadonlyArray<{
  team: SimulationTeam;
  weight: number;
}> = [
  { team: STRONG_BENCHMARK, weight: 0.25 },
  { team: MEDIUM_BENCHMARK, weight: 0.5 },
  { team: WEAK_BENCHMARK, weight: 0.25 },
];
