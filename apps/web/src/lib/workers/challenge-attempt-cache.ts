import type { ChallengeRun, EraSimulationProfile, GameResult } from '@hoop-rush/data-contracts';

export const CHALLENGE_GAMES_PER_RUN = 82;

/**
 * Everything a challenge game input is derived from. The seed and game number pick
 * the RNG stream; the rest feed team preparation. Over-inclusion can only cause a
 * missed reuse, never a wrong result.
 */
export function challengeAttemptIdentity(
  run: ChallengeRun,
  profile: EraSimulationProfile,
  engineVersion: string,
): string {
  return JSON.stringify([
    run.runSeed,
    run.eraProfileVersion,
    run.versions,
    run.homeDisplayName,
    run.players,
    run.bracket,
    profile,
    engineVersion,
  ]);
}

interface RetainedAttempt {
  identity: string;
  games: readonly GameResult[];
}

/**
 * Holds at most one fully simulated attempt so the worker can replay the winning
 * best-of attempt instead of simulating the same seeded games again. The entry is
 * dropped as soon as it is read, does not match, or is cleared.
 */
export class ChallengeAttemptCache {
  private attempt: RetainedAttempt | null = null;

  retain(
    run: ChallengeRun,
    profile: EraSimulationProfile,
    engineVersion: string,
    games: readonly GameResult[],
  ): void {
    this.attempt =
      games.length === CHALLENGE_GAMES_PER_RUN
        ? { identity: challengeAttemptIdentity(run, profile, engineVersion), games }
        : null;
  }

  take(
    run: ChallengeRun,
    profile: EraSimulationProfile,
    engineVersion: string,
    startGameNumber: number,
  ): readonly GameResult[] | null {
    const attempt = this.attempt;
    this.attempt = null;
    if (attempt === null) return null;
    // Only a run starting from game 1 replays the whole retained attempt. A resume
    // mid-season (or a run that already holds games) is not the retained attempt.
    if (startGameNumber !== 1 || run.games.length > 0) return null;
    return attempt.identity === challengeAttemptIdentity(run, profile, engineVersion)
      ? attempt.games
      : null;
  }

  clear(): void {
    this.attempt = null;
  }
}
