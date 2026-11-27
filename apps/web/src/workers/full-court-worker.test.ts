import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { idSchema } from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  createFullCourtSeasonCheckpoint,
  simulateFullCourtPlayoffGame,
  simulateFullCourtSeasonSlot,
} from '@hoop-rush/engine';
import {
  fullCourtTestPlayoffLock,
  fullCourtTestRouletteSeasonLock,
  fullCourtTestSeasonLock,
} from '../lib/features/full-court/full-court-test-support';
import type { FullCourtWorkerMessage } from '../lib/features/full-court/full-court-worker-protocol';

const LOCK = fullCourtTestSeasonLock();
const PLAYOFFS = fullCourtTestPlayoffLock(LOCK);

const originalSelf = (globalThis as { self?: unknown }).self;
const fakeSelf = {
  postMessage: (() => {}) as (message: FullCourtWorkerMessage) => void,
  onmessage: null as ((event: { data: unknown }) => void) | null,
};

beforeAll(async () => {
  (globalThis as { self?: unknown }).self = fakeSelf;
  await import('./full-court-worker.ts');
});

afterAll(() => {
  if (originalSelf === undefined) {
    delete (globalThis as { self?: unknown }).self;
  } else {
    (globalThis as { self?: unknown }).self = originalSelf;
  }
});

function send(data: unknown): Promise<FullCourtWorkerMessage> {
  return new Promise((resolve) => {
    fakeSelf.postMessage = resolve;
    fakeSelf.onmessage?.({ data });
  });
}

describe('Full Court worker', () => {
  it('rejects an unrecognised request', async () => {
    const message = await send({ schemaVersion: 1 });
    expect(message).toMatchObject({ type: 'full-court-error', requestId: 'unknown' });
  });

  it('hydrates the locked season, then reuses it by run and digest', async () => {
    const initial = createFullCourtSeasonCheckpoint(LOCK);
    const hydrated = await send({
      schemaVersion: 1,
      type: 'full-court-simulate-slot',
      requestId: 'slot-hydrate',
      runId: LOCK.season.runId,
      lockDigest: LOCK.digest,
      lock: LOCK,
      checkpoint: initial,
    });
    if (hydrated.type !== 'full-court-slot-result' || hydrated.outcome.kind !== 'simulated') {
      throw new Error('Expected a simulated opening slot');
    }
    const expected = simulateFullCourtSeasonSlot(LOCK, initial, createEngineContext());
    if (expected.kind !== 'simulated') throw new Error('Expected a direct simulated slot');
    expect(hydrated.outcome).toEqual(expected);

    const reused = await send({
      schemaVersion: 1,
      type: 'full-court-simulate-slot',
      requestId: 'slot-reuse',
      runId: LOCK.season.runId,
      lockDigest: LOCK.digest,
      checkpoint: hydrated.outcome.checkpoint,
    });
    if (reused.type !== 'full-court-slot-result' || reused.outcome.kind !== 'simulated') {
      throw new Error('Expected a simulated second slot');
    }
    const expectedReuse = simulateFullCourtSeasonSlot(
      LOCK,
      hydrated.outcome.checkpoint,
      createEngineContext(),
    );
    if (expectedReuse.kind !== 'simulated') {
      throw new Error('Expected a direct simulated second slot');
    }
    expect(reused.outcome).toEqual(expectedReuse);

    const missing = await send({
      schemaVersion: 1,
      type: 'full-court-simulate-slot',
      requestId: 'slot-missing',
      runId: idSchema.parse('full-court-missing-run'),
      lockDigest: LOCK.digest,
      checkpoint: {
        ...initial,
        runId: idSchema.parse('full-court-missing-run'),
      },
    });
    expect(missing).toMatchObject({ type: 'full-court-error', code: 'lock-missing' });
  }, 120_000);

  it('bootstraps playoffs and remembers the season lock for later slots', async () => {
    const bootstrapped = await send({
      schemaVersion: 1,
      type: 'full-court-simulate-game',
      requestId: 'game-bootstrap',
      runId: LOCK.season.runId,
      lockDigest: PLAYOFFS.lock.digest,
      playoffLock: {
        digest: PLAYOFFS.lock.digest,
        seasonLockDigest: LOCK.digest,
        seasonLock: LOCK,
        standings: PLAYOFFS.lock.standings,
        initialHealth: PLAYOFFS.lock.initialHealth,
        regularScores: PLAYOFFS.lock.regularScores,
        firstGameDay: PLAYOFFS.lock.firstGameDay,
      },
      checkpoint: PLAYOFFS.checkpoint,
    });
    if (
      bootstrapped.type !== 'full-court-game-result' ||
      bootstrapped.outcome.kind !== 'simulated'
    ) {
      throw new Error('Expected a simulated opening playoff game');
    }
    const expectedBootstrap = simulateFullCourtPlayoffGame(
      PLAYOFFS.lock,
      PLAYOFFS.checkpoint,
      createEngineContext(),
    );
    if (expectedBootstrap.kind !== 'simulated') {
      throw new Error('Expected a direct simulated playoff game');
    }
    expect(bootstrapped.outcome).toEqual(expectedBootstrap);

    const referenced = await send({
      schemaVersion: 1,
      type: 'full-court-simulate-game',
      requestId: 'game-reference',
      runId: LOCK.season.runId,
      lockDigest: PLAYOFFS.lock.digest,
      checkpoint: bootstrapped.outcome.checkpoint,
    });
    if (referenced.type !== 'full-court-game-result' || referenced.outcome.kind !== 'simulated') {
      throw new Error('Expected a simulated second playoff game');
    }
    const expectedReference = simulateFullCourtPlayoffGame(
      PLAYOFFS.lock,
      bootstrapped.outcome.checkpoint,
      createEngineContext(),
    );
    if (expectedReference.kind !== 'simulated') {
      throw new Error('Expected a direct simulated second playoff game');
    }
    expect(referenced.outcome).toEqual(expectedReference);

    const slot = await send({
      schemaVersion: 1,
      type: 'full-court-simulate-slot',
      requestId: 'slot-after-bootstrap',
      runId: LOCK.season.runId,
      lockDigest: LOCK.digest,
      checkpoint: createFullCourtSeasonCheckpoint(LOCK),
    });
    if (slot.type !== 'full-court-slot-result') throw new Error('Expected a slot result');
    expect(slot.outcome).not.toMatchObject({ kind: 'season-complete' });
  }, 120_000);

  it('carries pinned roulette attachments through the season lock', async () => {
    const rouletteLock = fullCourtTestRouletteSeasonLock();
    const user = rouletteLock.season.teams.find(
      (team) => team.teamId === rouletteLock.season.userTeamId,
    );
    expect(user?.roulette?.attachments).toHaveLength(1);
    const initial = createFullCourtSeasonCheckpoint(rouletteLock);
    const outcome = await send({
      schemaVersion: 1,
      type: 'full-court-simulate-slot',
      requestId: 'roulette-slot',
      runId: rouletteLock.season.runId,
      lockDigest: rouletteLock.digest,
      lock: rouletteLock,
      checkpoint: initial,
    });
    if (outcome.type !== 'full-court-slot-result' || outcome.outcome.kind !== 'simulated') {
      throw new Error('Expected a simulated roulette slot');
    }
    const expected = simulateFullCourtSeasonSlot(rouletteLock, initial, createEngineContext());
    if (expected.kind !== 'simulated') throw new Error('Expected a direct roulette slot');
    expect(outcome.outcome).toEqual(expected);
    const userGame = outcome.outcome.userGame;
    if (userGame.kind === 'played') {
      const side = userGame.result.home.teamId === rouletteLock.season.userTeamId ? 'home' : 'away';
      expect(userGame.result[side].mutationRollups?.length ?? 0).toBeGreaterThan(0);
    }
  }, 120_000);
});
