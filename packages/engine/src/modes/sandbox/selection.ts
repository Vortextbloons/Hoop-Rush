import type { ChallengeRun, EraSimulationProfile } from '@hoop-rush/data-contracts';
import { createChallenge, simulateChallenge, type ChallengeCreation } from '../../challenge/commands.js';
import { deriveAttemptSeed } from '../../challenge/seeds.js';
import type { EngineContext } from '../../sim/context.js';

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

/** Returns the run with the highest score; ties resolve to the earlier attempt. */
export function chooseBestRun(runs: readonly ChallengeRun[]): ChallengeRun {
  const [first, ...rest] = runs;
  if (!first) {
    throw new Error('chooseBestRun requires at least one attempt run');
  }
  let bestIndex = 0;
  let best = scoreRun(first);
  rest.forEach((candidate, offset) => {
    const index = offset + 1;
    const candidateScore = scoreRun(candidate);
    const winsBetter = candidateScore.wins > best.wins;
    const winsTied = candidateScore.wins === best.wins;
    const differentialBetter = candidateScore.differential > best.differential;
    if (winsBetter || (winsTied && differentialBetter)) {
      bestIndex = index;
      best = candidateScore;
    }
  });
  return runs[bestIndex];
}

/**
 * Creates the run, simulates BEST_OF_ATTEMPTS complete seasons from derived
 * attempt seeds, and returns the chosen attempt's finished run. All attempts
 * always finish; the returned run is a normal accepted ChallengeRun whose
 * runSeed is the chosen attempt seed.
 */
export function simulateChallengeBestOf(
  creation: ChallengeCreation,
  profile: EraSimulationProfile,
  context: EngineContext,
): ChallengeRun {
  const attempts: ChallengeRun[] = [];
  for (let attempt = 0; attempt < BEST_OF_ATTEMPTS; attempt += 1) {
    const attemptRun = createChallenge({
      ...creation,
      runSeed: deriveAttemptSeed(creation.runSeed, attempt),
    });
    attempts.push(simulateChallenge(attemptRun, profile, context));
  }
  return chooseBestRun(attempts);
}
