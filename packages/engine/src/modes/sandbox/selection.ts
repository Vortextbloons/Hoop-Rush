import type { ChallengeRun, EraSimulationProfile, Seed } from '@hoop-rush/data-contracts';
import {
  createChallenge,
  createGameInput,
  simulateChallenge,
  type ChallengeCreation,
} from '../../challenge/commands.ts';
import { deriveAttemptSeed } from '../../challenge/seeds.ts';
import { simulateGame } from '../../sim/game.ts';
import type { EngineContext } from '../../sim/context.ts';

/**
 * Sandbox whole-run best-of-N selection (spec/01 sandbox loop). Sandbox
 * simulates every attempt of the complete 82-game challenge from seeds
 * derived deterministically from the run seed, then keeps the attempt with
 * the best record. The chosen attempt's seed becomes the authoritative run
 * seed, so per-game seed derivation, replay, resume, and result validation
 * all continue to work on the single accepted run.
 *
 * The comparison is wins first, then total point differential, then the
 * lower attempt index. The rule is deterministic under the run seed: the
 * chosen seed is a pure function of the run seed.
 */

/** Number of whole-run attempts sandbox simulates and compares. */
export const BEST_OF_ATTEMPTS = 2;

export interface RunScore {
  wins: number;
  /** Season point differential: user points minus opponent points. */
  differential: number;
}

/** Exact comparison score of a finished run (never estimates). */
export function scoreRun(run: ChallengeRun): RunScore {
  let differential = 0;
  for (const game of run.games) {
    differential += game.home.box.points - game.away.box.points;
  }
  return { wins: run.aggregates.team.wins, differential };
}

/** Wins first, then differential; ties resolve to the earlier attempt. */
function isBetterScore(candidate: RunScore, current: RunScore): boolean {
  const winsBetter = candidate.wins > current.wins;
  const winsTied = candidate.wins === current.wins;
  const differentialBetter = candidate.differential > current.differential;
  return winsBetter || (winsTied && differentialBetter);
}

/** Returns the run with the highest score; ties resolve to the earlier attempt. */
export function chooseBestRun(runs: readonly ChallengeRun[]): ChallengeRun {
  const [first, ...rest] = runs;
  if (!first) {
    throw new Error('chooseBestRun requires at least one attempt run');
  }
  let best: ChallengeRun = first;
  let bestScore = scoreRun(first);
  for (const candidate of rest) {
    const candidateScore = scoreRun(candidate);
    if (isBetterScore(candidateScore, bestScore)) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  return best;
}

/**
 * Creates the run, simulates `attempts` complete seasons from derived attempt
 * seeds (BEST_OF_ATTEMPTS by default), and returns the chosen attempt's
 * finished run. All attempts always finish; the returned run is a normal
 * accepted ChallengeRun whose runSeed is the chosen attempt seed.
 */
export function simulateChallengeBestOf(
  creation: ChallengeCreation,
  profile: EraSimulationProfile,
  context: EngineContext,
  attempts: number = BEST_OF_ATTEMPTS,
): ChallengeRun {
  const runs: ChallengeRun[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const attemptRun = createChallenge({
      ...creation,
      runSeed: deriveAttemptSeed(creation.runSeed, attempt),
    });
    runs.push(simulateChallenge(attemptRun, profile, context));
  }
  return chooseBestRun(runs);
}

export interface BestOfChoice {
  chosenRunSeed: Seed;
  chosenWins: number;
  chosenLosses: number;
  chosenDifferential: number;
}

/**
 * Whole-run best-of selection for the challenge worker: simulates every
 * attempt of the complete 82-game season from derived attempt seeds and
 * reports the chosen attempt's seed and record. Games are not recorded (the
 * main thread re-saves the chosen seed before the paced reveal), so the rule
 * is identical to chooseBestRun (spec/01) without materializing 82 results.
 */
export function chooseBestRunSeed(
  run: ChallengeRun,
  profile: EraSimulationProfile,
  context: EngineContext,
): BestOfChoice {
  let best: { seed: Seed; score: RunScore } | null = null;
  for (let attempt = 0; attempt < BEST_OF_ATTEMPTS; attempt += 1) {
    const attemptSeed = deriveAttemptSeed(run.runSeed, attempt);
    const attemptRun = { ...run, runSeed: attemptSeed };
    let wins = 0;
    let differential = 0;
    for (let gameNumber = 1; gameNumber <= 82; gameNumber += 1) {
      const input = createGameInput(attemptRun, profile, gameNumber);
      const result = simulateGame(input, context);
      const pointsDiff = result.home.box.points - result.away.box.points;
      if (pointsDiff > 0) wins += 1;
      differential += pointsDiff;
    }
    const score: RunScore = { wins, differential };
    if (best === null || isBetterScore(score, best.score)) {
      best = { seed: attemptSeed, score };
    }
  }
  if (best === null) {
    throw new Error('chooseBestRunSeed requires at least one attempt');
  }
  return {
    chosenRunSeed: best.seed,
    chosenWins: best.score.wins,
    chosenLosses: 82 - best.score.wins,
    chosenDifferential: best.score.differential,
  };
}
