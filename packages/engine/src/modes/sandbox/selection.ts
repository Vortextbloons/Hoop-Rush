import type { ChallengeRun, EraSimulationProfile } from '@hoop-rush/data-contracts';
import {
  createChallenge,
  simulateChallenge,
  type ChallengeCreation,
} from '../../challenge/commands.ts';
import { deriveAttemptSeed } from '../../challenge/seeds.ts';
import type { EngineContext } from '../../sim/kernel.ts';
export function simulateChallengeAttempts(
  creation: ChallengeCreation,
  profile: EraSimulationProfile,
  context: EngineContext,
  attempts: number,
): ChallengeRun[] {
  const runs: ChallengeRun[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const attemptRun = createChallenge({
      ...creation,
      runSeed: deriveAttemptSeed(creation.runSeed, attempt),
    });
    runs.push(simulateChallenge(attemptRun, profile, context));
  }
  return runs;
}
