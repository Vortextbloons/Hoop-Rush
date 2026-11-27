/* eslint-disable @typescript-eslint/await-thenable, @typescript-eslint/no-confusing-void-expression -- bun-types declares .resolves/.rejects matchers as void; Bun docs require awaiting them */
import { describe, expect, it } from 'bun:test';
import { idSchema, seedSchema, type FullCourtCoachingRule } from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  createFullCourtSeasonCheckpoint,
  fullCourtTrainingCampSeed,
  simulateFullCourtTrainingCamp,
} from '@hoop-rush/engine';
import type { FullCourtWorkerMessage } from './full-court-worker-protocol';
import { createFullCourtWorkerRunner } from './full-court-worker-runner';
import { fullCourtTestPlayoffLock, fullCourtTestSeasonLock } from './full-court-test-support';

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }

  asWorker(): Worker {
    return this as unknown as Worker;
  }
}

const LOCK = fullCourtTestSeasonLock();
const PLAYOFFS = fullCourtTestPlayoffLock(LOCK);
const CHECKPOINT = createFullCourtSeasonCheckpoint(LOCK);

function slotResult(requestId: string): FullCourtWorkerMessage {
  return {
    schemaVersion: 1,
    type: 'full-court-slot-result',
    requestId,
    outcome: { kind: 'season-complete' },
  };
}

function gameResult(requestId: string): FullCourtWorkerMessage {
  return {
    schemaVersion: 1,
    type: 'full-court-game-result',
    requestId,
    outcome: { kind: 'playoffs-complete' },
  };
}

function errorMessage(requestId: string): FullCourtWorkerMessage {
  return {
    schemaVersion: 1,
    type: 'full-court-error',
    requestId,
    code: 'internal',
    message: 'boom',
  };
}

function requestIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `full-court-test-${String(next)}`;
  };
}

function postedRequest(fake: FakeWorker, index: number): Record<string, unknown> {
  const request = fake.posted[index];
  if (typeof request !== 'object' || request === null) throw new Error('missing request');
  return request as Record<string, unknown>;
}

describe('FullCourtWorkerRunner', () => {
  it('sends the locked season once and references it by run and digest later', async () => {
    const fake = new FakeWorker();
    const runner = createFullCourtWorkerRunner({
      createWorker: () => fake.asWorker(),
      newRequestId: requestIds(),
    });
    const first = runner.simulateSlot(LOCK, CHECKPOINT);
    expect(postedRequest(fake, 0)).toMatchObject({
      type: 'full-court-simulate-slot',
      runId: LOCK.season.runId,
      lockDigest: LOCK.digest,
      lock: LOCK,
    });
    fake.emit(slotResult('full-court-test-1'));
    await expect(first).resolves.toMatchObject({ kind: 'season-complete' });

    const second = runner.simulateSlot(LOCK, CHECKPOINT);
    expect(postedRequest(fake, 1)).toMatchObject({
      type: 'full-court-simulate-slot',
      runId: LOCK.season.runId,
      lockDigest: LOCK.digest,
    });
    expect(postedRequest(fake, 1)).not.toHaveProperty('lock');
    fake.emit(slotResult('full-court-test-2'));
    await second;

    const changed = { ...LOCK, digest: seedSchema.parse('b'.repeat(32)) };
    const third = runner.simulateSlot(changed, {
      ...CHECKPOINT,
      lockDigest: changed.digest,
    });
    expect(postedRequest(fake, 2)).toHaveProperty('lock', changed);
    fake.emit(slotResult('full-court-test-3'));
    await third;

    const otherRun = {
      ...LOCK,
      season: { ...LOCK.season, runId: idSchema.parse('full-court-other-run') },
      digest: seedSchema.parse('c'.repeat(32)),
    };
    const fourth = runner.simulateSlot(otherRun, {
      ...CHECKPOINT,
      runId: otherRun.season.runId,
      lockDigest: otherRun.digest,
    });
    expect(postedRequest(fake, 3)).toHaveProperty('lock', otherRun);
    fake.emit(slotResult('full-court-test-4'));
    await fourth;
  });

  it('validates and forwards ordered coaching rules in slot options', async () => {
    const fake = new FakeWorker();
    const runner = createFullCourtWorkerRunner({
      createWorker: () => fake.asWorker(),
      newRequestId: requestIds(),
    });
    const userTeam = LOCK.season.teams.find(({ teamId }) => teamId === LOCK.season.userTeamId);
    if (userTeam === undefined) throw new Error('missing user team');
    const rules: FullCourtCoachingRule[] = [
      {
        ruleId: 'closing',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 8,
        lineup: userTeam.roster.slice(0, 5).map(({ playerId }) => playerId),
      },
    ];
    const pending = runner.simulateSlot(LOCK, CHECKPOINT, { rules });
    expect(postedRequest(fake, 0)).toMatchObject({ options: { rules } });
    fake.emit(slotResult('full-court-test-1'));
    await pending;

    const invalid = runner.simulateSlot(LOCK, CHECKPOINT, {
      rules: [
        {
          ruleId: 'bad',
          kind: 'foul-trouble',
          playerId: 'p1',
          foulLimit: 9,
        } as unknown as FullCourtCoachingRule,
      ],
    });
    await expect(invalid).rejects.toThrow('invalid full court worker request');
  });

  it('validates and forwards an offensive hierarchy in slot options', async () => {
    const fake = new FakeWorker();
    const runner = createFullCourtWorkerRunner({
      createWorker: () => fake.asWorker(),
      newRequestId: requestIds(),
    });
    const userTeam = LOCK.season.teams.find(({ teamId }) => teamId === LOCK.season.userTeamId);
    if (userTeam === undefined) throw new Error('missing user team');
    const hierarchy = {
      primaryPlayerId: userTeam.roster[0]?.playerId ?? '',
      secondaryPlayerId: userTeam.roster[1]?.playerId ?? '',
      floorGeneralPlayerId: userTeam.roster[2]?.playerId ?? '',
    };
    const pending = runner.simulateSlot(LOCK, CHECKPOINT, { hierarchy });
    expect(postedRequest(fake, 0)).toMatchObject({ options: { hierarchy } });
    fake.emit(slotResult('full-court-test-1'));
    await pending;

    const duplicated = runner.simulateSlot(LOCK, CHECKPOINT, {
      hierarchy: { primaryPlayerId: 'p1', secondaryPlayerId: 'p1' },
    });
    await expect(duplicated).rejects.toThrow('invalid full court worker request');

    const empty = runner.simulateSlot(LOCK, CHECKPOINT, { hierarchy: {} });
    await expect(empty).rejects.toThrow('invalid full court worker request');
  });

  it('validates and forwards a star-staggering rotation through slot, playoff, and practice jobs', async () => {
    const fake = new FakeWorker();
    const runner = createFullCourtWorkerRunner({
      createWorker: () => fake.asWorker(),
      newRequestId: requestIds(),
    });
    const rotation = { staggerStars: true };

    const slot = runner.simulateSlot(LOCK, CHECKPOINT, { rotation });
    expect(postedRequest(fake, 0)).toMatchObject({ options: { rotation } });
    fake.emit(slotResult('full-court-test-1'));
    await slot;

    const game = runner.simulateGame(PLAYOFFS.lock, PLAYOFFS.checkpoint, { rotation });
    expect(postedRequest(fake, 1)).toMatchObject({ options: { rotation } });
    fake.emit(gameResult('full-court-test-2'));
    await game;

    const fixture = LOCK.season.games.find(
      (entry) =>
        entry.slot === 1 &&
        (entry.homeTeamId === LOCK.season.userTeamId ||
          entry.awayTeamId === LOCK.season.userTeamId),
    );
    if (fixture === undefined) throw new Error('missing opening fixture');
    const opponentTeamId =
      fixture.homeTeamId === LOCK.season.userTeamId ? fixture.awayTeamId : fixture.homeTeamId;
    const seed = fullCourtTrainingCampSeed(LOCK.season.runSeed, 'fcs-stagger-test');
    const report = simulateFullCourtTrainingCamp(
      LOCK.season,
      { seed, opponentTeamId, rotation },
      createEngineContext(),
    );
    const simulatePractice = runner.simulatePractice?.bind(runner);
    if (simulatePractice === undefined) throw new Error('practice runner is unavailable');
    const practice = simulatePractice(LOCK, {
      seed,
      opponentTeamId,
      options: { rotation },
    });
    expect(postedRequest(fake, 2)).toMatchObject({
      type: 'full-court-simulate-practice',
      options: { rotation },
    });
    fake.emit({
      schemaVersion: 1,
      type: 'full-court-practice-result',
      requestId: 'full-court-test-3',
      report,
    });
    await practice;

    const invalid = runner.simulateSlot(LOCK, CHECKPOINT, {
      rotation: { staggerStars: 'yes' } as unknown as { staggerStars: boolean },
    });
    await expect(invalid).rejects.toThrow('invalid full court worker request');
  });

  it('bootstraps playoff inputs with the season lock, then only references the cache', async () => {
    const fake = new FakeWorker();
    const runner = createFullCourtWorkerRunner({
      createWorker: () => fake.asWorker(),
      newRequestId: requestIds(),
    });
    const first = runner.simulateGame(PLAYOFFS.lock, PLAYOFFS.checkpoint);
    const request = postedRequest(fake, 0);
    expect(request).toMatchObject({
      type: 'full-court-simulate-game',
      runId: LOCK.season.runId,
      lockDigest: PLAYOFFS.lock.digest,
    });
    expect(request.playoffLock).toMatchObject({
      digest: PLAYOFFS.lock.digest,
      seasonLockDigest: LOCK.digest,
      seasonLock: LOCK,
    });
    fake.emit(gameResult('full-court-test-1'));
    await expect(first).resolves.toMatchObject({ kind: 'playoffs-complete' });

    const second = runner.simulateGame(PLAYOFFS.lock, PLAYOFFS.checkpoint);
    expect(postedRequest(fake, 1)).not.toHaveProperty('playoffLock');
    fake.emit(gameResult('full-court-test-2'));
    await second;

    // The playoff bootstrap hydrated the season too, so a later slot reuses it.
    const slot = runner.simulateSlot(LOCK, CHECKPOINT);
    expect(postedRequest(fake, 2)).not.toHaveProperty('lock');
    fake.emit(slotResult('full-court-test-3'));
    await slot;
  });

  it('omits the nested season lock after a slot already hydrated it', async () => {
    const fake = new FakeWorker();
    const runner = createFullCourtWorkerRunner({
      createWorker: () => fake.asWorker(),
      newRequestId: requestIds(),
    });
    const slot = runner.simulateSlot(LOCK, CHECKPOINT);
    fake.emit(slotResult('full-court-test-1'));
    await slot;

    const game = runner.simulateGame(PLAYOFFS.lock, PLAYOFFS.checkpoint);
    const request = postedRequest(fake, 1);
    expect(request.playoffLock).toMatchObject({
      digest: PLAYOFFS.lock.digest,
      seasonLockDigest: LOCK.digest,
    });
    expect(
      (request.playoffLock as Record<string, unknown> | undefined)?.seasonLock,
    ).toBeUndefined();
    fake.emit(gameResult('full-court-test-2'));
    await game;
  });

  it('rehydrates after a worker error and rejects concurrent jobs', async () => {
    let current = new FakeWorker();
    const runner = createFullCourtWorkerRunner({
      createWorker: () => current.asWorker(),
      newRequestId: requestIds(),
    });
    const failed = runner.simulateSlot(LOCK, CHECKPOINT);
    const concurrent = runner.simulateSlot(LOCK, CHECKPOINT);
    await expect(concurrent).rejects.toThrow('a full court job is already running');
    current.emit(errorMessage('full-court-test-1'));
    await expect(failed).rejects.toThrow('internal: boom');
    expect(current.terminated).toBe(true);

    const replacement = new FakeWorker();
    current = replacement;
    const next = runner.simulateSlot(LOCK, CHECKPOINT);
    expect(postedRequest(replacement, 0)).toHaveProperty('lock', LOCK);
    replacement.emit(slotResult('full-court-test-3'));
    await next;
  });

  it('sends the locked season with a practice request and returns the compact report', async () => {
    const fake = new FakeWorker();
    const runner = createFullCourtWorkerRunner({
      createWorker: () => fake.asWorker(),
      newRequestId: requestIds(),
    });
    const fixture = LOCK.season.games.find(
      (game) =>
        game.slot === 1 &&
        (game.homeTeamId === LOCK.season.userTeamId || game.awayTeamId === LOCK.season.userTeamId),
    );
    if (fixture === undefined) throw new Error('missing opening fixture');
    const opponentTeamId =
      fixture.homeTeamId === LOCK.season.userTeamId ? fixture.awayTeamId : fixture.homeTeamId;
    const seed = fullCourtTrainingCampSeed(LOCK.season.runSeed, 'fcs-practice-test');
    const report = simulateFullCourtTrainingCamp(
      LOCK.season,
      { seed, opponentTeamId },
      createEngineContext(),
    );
    const simulatePractice = runner.simulatePractice?.bind(runner);
    if (simulatePractice === undefined) throw new Error('practice runner is unavailable');
    const pending = simulatePractice(LOCK, { seed, opponentTeamId });
    expect(postedRequest(fake, 0)).toMatchObject({
      type: 'full-court-simulate-practice',
      runId: LOCK.season.runId,
      lockDigest: LOCK.digest,
      lock: LOCK,
      seed,
      opponentTeamId,
    });
    fake.emit({
      schemaVersion: 1,
      type: 'full-court-practice-result',
      requestId: 'full-court-test-1',
      report,
    });
    await expect(pending).resolves.toEqual(report);

    const second = simulatePractice(LOCK, { seed, opponentTeamId });
    expect(postedRequest(fake, 1)).not.toHaveProperty('lock');
    fake.emit({
      schemaVersion: 1,
      type: 'full-court-practice-result',
      requestId: 'full-court-test-2',
      report,
    });
    await second;
  });

  it('disposes the worker and rejects an in-flight job', async () => {
    const fake = new FakeWorker();
    const runner = createFullCourtWorkerRunner({
      createWorker: () => fake.asWorker(),
      newRequestId: requestIds(),
    });
    const pending = runner.simulateGame(PLAYOFFS.lock, PLAYOFFS.checkpoint);
    runner.dispose();
    await expect(pending).rejects.toThrow('disposed');
    expect(fake.terminated).toBe(true);
  });
});
