import type {
  FullCourtSeasonCheckpoint,
  FullCourtSeasonScore,
  FullCourtWatchedReplay,
} from '@hoop-rush/data-contracts';
import {
  createFullCourtSeasonCheckpoint,
  type FullCourtSeasonLock,
  type FullCourtSeasonSlotOptions,
  type FullCourtSeasonSlotOutcome,
} from '@hoop-rush/engine';
import { buildFullCourtWatchedReplay } from './replay.ts';

export interface FullCourtSeasonRepository {
  load(runId: string): Promise<FullCourtSeasonCheckpoint | null>;
  listScores(runId: string): Promise<readonly FullCourtSeasonScore[]>;
  create(checkpoint: FullCourtSeasonCheckpoint): Promise<void>;
  commitSlot(
    checkpoint: FullCourtSeasonCheckpoint,
    scores: readonly FullCourtSeasonScore[],
    options?: { readonly watchedReplay?: FullCourtWatchedReplay },
  ): Promise<{ readonly status: 'committed' | 'replayed' }>;
}

interface FullCourtSeasonDependencies {
  readonly repository: FullCourtSeasonRepository;
  readonly simulateSlot: (
    lock: FullCourtSeasonLock,
    checkpoint: FullCourtSeasonCheckpoint,
    options: FullCourtSeasonSlotOptions,
  ) => FullCourtSeasonSlotOutcome | Promise<FullCourtSeasonSlotOutcome>;
}

function requireMatchingLock(
  checkpoint: FullCourtSeasonCheckpoint,
  lock: FullCourtSeasonLock,
): void {
  if (checkpoint.runId !== lock.season.runId || checkpoint.lockDigest !== lock.digest) {
    throw new Error('Full Court save needs its original locked season inputs');
  }
}

export async function startFullCourtSeason(
  lock: FullCourtSeasonLock,
  repository: FullCourtSeasonRepository,
): Promise<FullCourtSeasonCheckpoint> {
  const runId = lock.season.runId;
  const existing = await repository.load(runId);
  if (existing !== null) {
    requireMatchingLock(existing, lock);
    return existing;
  }
  await repository.create(createFullCourtSeasonCheckpoint(lock));
  const saved = await repository.load(runId);
  if (saved === null) throw new Error('Full Court season checkpoint was not created');
  requireMatchingLock(saved, lock);
  return saved;
}

export async function advanceFullCourtSeasonSlot(
  input: {
    readonly lock: FullCourtSeasonLock;
    readonly expectedThroughSlot: number;
    readonly options?: FullCourtSeasonSlotOptions;
  },
  dependencies: FullCourtSeasonDependencies,
): Promise<
  FullCourtSeasonSlotOutcome | { readonly kind: 'stale'; readonly completedThroughSlot: number }
> {
  const { lock } = input;
  const { repository, simulateSlot } = dependencies;
  const runId = lock.season.runId;
  const checkpoint = await repository.load(runId);
  if (checkpoint === null) throw new Error('Start the Full Court season before simulating a slot');
  requireMatchingLock(checkpoint, lock);
  if (checkpoint.completedThroughSlot !== input.expectedThroughSlot) {
    return { kind: 'stale', completedThroughSlot: checkpoint.completedThroughSlot };
  }
  const outcome = await simulateSlot(lock, checkpoint, input.options ?? {});
  if (outcome.kind !== 'simulated') return outcome;
  requireMatchingLock(outcome.checkpoint, lock);
  const slot = checkpoint.completedThroughSlot + 1;
  if (outcome.checkpoint.completedThroughSlot !== slot) {
    throw new Error('Full Court simulation did not return the next slot');
  }
  const fixtures = new Map(
    lock.season.games.filter((game) => game.slot === slot).map((game) => [game.gameId, game]),
  );
  if (
    outcome.scores.length !== fixtures.size ||
    new Set(outcome.scores.map((score) => score.gameId)).size !== fixtures.size ||
    outcome.scores.some((score) => {
      const expected = fixtures.get(score.gameId);
      return (
        expected === undefined ||
        score.slot !== slot ||
        score.homeTeamId !== expected.homeTeamId ||
        score.awayTeamId !== expected.awayTeamId ||
        outcome.checkpoint.healthByTeam[score.homeTeamId]?.throughDay !== expected.dayOffset ||
        outcome.checkpoint.healthByTeam[score.awayTeamId]?.throughDay !== expected.dayOffset
      );
    })
  ) {
    throw new Error('Full Court simulation returned scores outside the locked slot');
  }
  const userFixture = [...fixtures.values()].find(
    (game) =>
      game.homeTeamId === lock.season.userTeamId || game.awayTeamId === lock.season.userTeamId,
  );
  const watchedReplay =
    input.options?.record === true &&
    userFixture !== undefined &&
    outcome.userGame.kind === 'played' &&
    outcome.userGame.tape !== null
      ? buildFullCourtWatchedReplay({
          phase: 'regular',
          runId: lock.season.runId,
          seasonLockDigest: lock.digest,
          lockDigest: lock.digest,
          gameId: userFixture.gameId,
          slot,
          dayOffset: userFixture.dayOffset,
          userTeamId: lock.season.userTeamId,
          game: outcome.userGame,
        })
      : undefined;
  await repository.commitSlot(
    outcome.checkpoint,
    outcome.scores,
    watchedReplay === undefined ? undefined : { watchedReplay },
  );
  return outcome;
}
