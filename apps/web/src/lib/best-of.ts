import {
  BEST_OF_ATTEMPTS,
  createGameInput,
  deriveAttemptSeed,
  simulateGame,
  type EngineContext,
} from '@hoop-rush/engine';
import type { ChallengeRun, EraSimulationProfile, Seed } from '@hoop-rush/data-contracts';

/**
 * Whole-run best-of-N selection for the challenge worker (spec/01 sandbox
 * loop). Mirrors the engine's simulateChallengeBestOf/chooseBestRun exactly:
 * every attempt simulates the complete 82-game season from an attempt seed
 * derived deterministically from the run seed, and the attempt with the most
 * wins (ties broken by total point differential, then the earlier attempt) is
 * chosen. The chosen seed is a pure function of the run seed; the main thread
 * persists it before any game is revealed. Pure and worker-usable: no DOM, no
 * persistence, no clocks.
 */

export { BEST_OF_ATTEMPTS };

export interface BestOfChoice {
  chosenRunSeed: Seed;
  chosenWins: number;
  chosenLosses: number;
  chosenDifferential: number;
}

interface AttemptScore {
  seed: Seed;
  wins: number;
  losses: number;
  differential: number;
}

/**
 * Simulates every attempt and returns the best record plus its seed. `run` is
 * read-only; only its seed and frozen schedule/players feed the simulation, so
 * a fresh run (games: []) is expected. Games are always simulated from game 1
 * regardless of any recorded results.
 */
export function chooseBestRunFromRun(
  run: ChallengeRun,
  profile: EraSimulationProfile,
  context: EngineContext,
): BestOfChoice {
  let best: AttemptScore | null = null;
  for (let attempt = 0; attempt < BEST_OF_ATTEMPTS; attempt += 1) {
    const score = simulateAttempt(run, profile, context, attempt);
    if (best === null || isBetter(score, best)) best = score;
  }
  if (best === null) {
    throw new Error('chooseBestRunFromRun requires at least one attempt');
  }
  return {
    chosenRunSeed: best.seed,
    chosenWins: best.wins,
    chosenLosses: best.losses,
    chosenDifferential: best.differential,
  };
}

function simulateAttempt(
  run: ChallengeRun,
  profile: EraSimulationProfile,
  context: EngineContext,
  attempt: number,
): AttemptScore {
  const attemptSeed = deriveAttemptSeed(run.runSeed, attempt);
  const attemptRun: ChallengeRun = { ...run, runSeed: attemptSeed };
  let wins = 0;
  let losses = 0;
  let differential = 0;
  for (let gameNumber = 1; gameNumber <= 82; gameNumber += 1) {
    const input = createGameInput(attemptRun, profile, gameNumber);
    const result = simulateGame(input, context);
    const pointsDiff = result.home.box.points - result.away.box.points;
    if (pointsDiff > 0) {
      wins += 1;
    } else if (pointsDiff < 0) {
      losses += 1;
    }
    differential += pointsDiff;
  }
  return { seed: attemptSeed, wins, losses, differential };
}

/** Engine chooseBestRun rule: wins first, then differential, then lower attempt. */
function isBetter(candidate: AttemptScore, current: AttemptScore): boolean {
  const winsBetter = candidate.wins > current.wins;
  const winsTied = candidate.wins === current.wins;
  const differentialBetter = candidate.differential > current.differential;
  return winsBetter || (winsTied && differentialBetter);
}
