import { describe, expect, it } from 'bun:test';
import {
  createChallenge,
  createEngineContext,
  deriveAttemptSeed,
  gameResultDigest,
  simulateChallenge,
  type ChallengeCreation,
} from '../../index.ts';
import { simulateChallengeAttempts } from './selection.ts';
import {
  buildChallengeRun,
  buildEraSimulationProfile,
  buildFixtureBracket,
} from '@hoop-rush/test-fixtures';
import { eraIdSchema, franchiseIdSchema } from '@hoop-rush/data-contracts';

const PROFILE = buildEraSimulationProfile();
const context = createEngineContext();
const RUN = buildChallengeRun({ runId: 'selection-run' });
const FRANCHISE_ID = franchiseIdSchema.parse(RUN.franchiseId ?? 'lakers');
const ERA_ID = eraIdSchema.parse(RUN.eraId);

const CREATION: ChallengeCreation = {
  runId: RUN.runId,
  mode: 'sandbox',
  franchiseId: FRANCHISE_ID,
  eraId: ERA_ID,
  homeDisplayName: RUN.homeDisplayName,
  lineup: RUN.lineup,
  players: RUN.players,
  selections: RUN.players.map((player) => ({
    playerId: player.playerId,
    franchiseId: FRANCHISE_ID,
    eraId: ERA_ID,
  })),
  runSeed: RUN.runSeed,
  dataVersion: RUN.versions.dataVersion,
  ratingVersion: RUN.versions.ratingVersion,
  positionNormalizationVersion: RUN.versions.positionNormalizationVersion,
  engineVersion: context.engineVersion,
  profile: PROFILE,
  bracket: buildFixtureBracket(),
};

function digests(results: readonly { readonly gameNumber: number }[]): string[] {
  return results.map((result) => gameResultDigest(result as never));
}

describe('simulateChallengeAttempts', () => {
  it('derives each attempt seed in order from the base seed', () => {
    const runs = simulateChallengeAttempts(CREATION, PROFILE, context, 2);
    expect(runs.map((run) => run.runSeed)).toEqual([
      deriveAttemptSeed(CREATION.runSeed, 0),
      deriveAttemptSeed(CREATION.runSeed, 1),
    ]);
  });

  it('preserves the first attempt game outputs when replayed from its seed', () => {
    const first = simulateChallengeAttempts(CREATION, PROFILE, context, 1)[0];
    if (first === undefined) throw new Error('missing first attempt');
    const attemptSeed = deriveAttemptSeed(CREATION.runSeed, 0);
    const replayed = simulateChallenge(
      createChallenge({ ...CREATION, runSeed: attemptSeed }),
      PROFILE,
      context,
    );
    expect(first.runSeed).toBe(attemptSeed);
    expect(digests(first.games)).toEqual(digests(replayed.games));
  });
});
