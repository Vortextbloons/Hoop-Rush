import type { EraSimulationProfile, GameResult, SimulationTeam } from '@hoop-rush/data-contracts';
import type { EngineContext } from '../sim/context.js';
import { simulateGame } from '../sim/game.js';
import { BENCHMARK_VERSION, BENCHMARK_WEIGHTS } from './benchmarks.js';

/**
 * Lineup evaluation (spec/01 authored opponent requirements, spec/06
 * difficulty calibration). `evaluateLineupBalance` measures the five required
 * dimensions from detailed possession ratings and tendencies; a lineup
 * missing any dimension cannot be authored into the bracket.
 * `evaluateLineupStrength` measures the weighted win rate against the fixed
 * weak/medium/strong benchmark matrix with alternating sides.
 */

export interface LineupBalance {
  /** Ball creation: passing, handling, IQ, and usage tendencies. */
  creation: number;
  /** Perimeter shooting: three-point, midrange, and free-throw skill. */
  shooting: number;
  /** Interior presence: inside scoring, finishing, and rim protection. */
  interiorPresence: number;
  /** Rebounding: offensive and defensive glass. */
  rebounding: number;
  /** Defense: perimeter/interior contests, disruption, and IQ. */
  defense: number;
  /** Whether every dimension clears the required balance floor. */
  ok: boolean;
}

/** Minimum lineup-average dimension value for an authored opponent (spec/01 #3). */
export const BALANCE_FLOOR = 55;

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

/** Measures the five required balance dimensions for a legal five-player team. */
export function evaluateLineupBalance(team: SimulationTeam): LineupBalance {
  const creationValues: number[] = [];
  const shootingValues: number[] = [];
  const interiorValues: number[] = [];
  const reboundingValues: number[] = [];
  const defenseValues: number[] = [];

  for (const player of team.players) {
    const r = player.ratings;
    const t = player.tendencies;
    creationValues.push(
      (r.passing + r.ballHandling + r.offensiveIq + Math.min(100, t.usageRate + 60)) / 4,
    );
    shootingValues.push(
      (r.threePoint + r.midrange + r.freeThrow + Math.min(100, t.threePointRate + 55)) / 4,
    );
    interiorValues.push(
      (r.insideScoring +
        r.closeShot +
        r.block +
        r.interiorDefense +
        Math.min(100, t.postUpRate + 55)) /
        5,
    );
    reboundingValues.push((r.offensiveRebound + r.defensiveRebound) / 2);
    defenseValues.push(
      (r.perimeterDefense + r.interiorDefense + r.steal + r.block + r.defensiveIq) / 5,
    );
  }

  const balance: LineupBalance = {
    creation: mean(creationValues),
    shooting: mean(shootingValues),
    interiorPresence: mean(interiorValues),
    rebounding: mean(reboundingValues),
    defense: mean(defenseValues),
    ok: true,
  };
  balance.ok =
    balance.creation >= BALANCE_FLOOR &&
    balance.shooting >= BALANCE_FLOOR &&
    balance.interiorPresence >= BALANCE_FLOOR &&
    balance.rebounding >= BALANCE_FLOOR &&
    balance.defense >= BALANCE_FLOOR;
  return balance;
}

export interface StrengthOptions {
  /** Seeded games per benchmark team; the lineup alternates sides. */
  samplesPerBenchmark: number;
  /** Seed prefix so different candidates/measurements never share draws. */
  seedBase: string;
}

export interface StrengthMeasurement {
  winRate: number;
  gamesPlayed: number;
  /** Win rate per benchmark, keyed by benchmark team id. */
  byBenchmark: Record<string, { games: number; wins: number }>;
}

/**
 * Measures lineup strength as the weighted win rate against the fixed
 * benchmark matrix (spec/01 #4). For every benchmark the candidate plays half
 * its seeded games as the home side and half as the away side; seeds are a
 * pure function of the seed base and index, so measurements are reproducible
 * and independent of scheduling.
 */
export function evaluateLineupStrength(
  team: SimulationTeam,
  context: EngineContext,
  profile: EraSimulationProfile,
  options: StrengthOptions,
): StrengthMeasurement {
  const { samplesPerBenchmark, seedBase } = options;
  const byBenchmark: StrengthMeasurement['byBenchmark'] = {};
  let weightedWins = 0;
  let totalGames = 0;

  for (const { team: benchmark, weight } of BENCHMARK_WEIGHTS) {
    let wins = 0;
    for (let i = 0; i < samplesPerBenchmark; i += 1) {
      const homeFirst = i % 2 === 0;
      const seed = strengthSeed(seedBase, benchmark.teamId, i);
      const input = {
        schemaVersion: 2 as const,
        seed,
        gameNumber: 1,
        dataVersion: profile.dataVersion,
        profile,
        home: homeFirst ? team : benchmark,
        away: homeFirst ? benchmark : team,
      };
      const result: GameResult = simulateGame(input, context);
      if (result.winner === (homeFirst ? 'home' : 'away')) wins += 1;
      totalGames += 1;
    }
    byBenchmark[benchmark.teamId] = { games: samplesPerBenchmark, wins };
    weightedWins += (wins / samplesPerBenchmark) * weight;
  }

  return { winRate: weightedWins, gamesPlayed: totalGames, byBenchmark };
}

/** Deterministic seed for one measurement game (worker-count independent). */
export function strengthSeed(seedBase: string, benchmarkId: string, index: number): string {
  let hash = 0x811c9dc5;
  const value = `${seedBase}|${benchmarkId}|${String(index)}`;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(4);
}

export { BENCHMARK_VERSION };
