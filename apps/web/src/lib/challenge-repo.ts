import { DexieChallengeRepository } from '@hoop-rush/persistence';

/**
 * Application-level singleton for the concrete IndexedDB challenge
 * repository. Pages import this directly; only browser code calls it.
 */
export const challengeRepository = new DexieChallengeRepository();
