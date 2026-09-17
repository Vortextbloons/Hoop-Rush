import { describe, expect, it, vi } from 'vitest';
import {
  SEASON_NEUTRAL_HOME_COURT,
  commandIdSchema,
  franchiseIdSchema,
  seedSchema,
  type SeasonEffectsState,
  type SeasonRun,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import {
  generateSeasonSchedule,
  seasonCheckpointDigest,
  seasonRotationSetDigest,
} from '@hoop-rush/engine';
import { acceptWorkerResult } from './season-block-runner';
import type { SeasonRunnerEvent } from './season-block-runner';
import {
  FAKE_SEASON_BLOCK_CHECKPOINT_COMMITTABLE,
  FAKE_SEASON_BLOCK_NON_COMMITTABLE_REASON,
  FAKE_SEASON_BLOCK_RUNNER_SOURCE,
  createFakeSeasonBlockRunner,
} from './fake-season-block-runner';

const commitSeasonBlock = vi.hoisted(() => vi.fn(() => Promise.resolve(undefined)));
vi.mock('$lib/season/season-repo', () => ({
  getSeasonRunRepository: () =>
    Promise.resolve({
      commitSeasonBlock,
      loadPendingBlock: () => Promise.resolve(null),
      loadActiveRun: () => Promise.resolve(null),
      savePendingBlock: () => Promise.resolve(undefined),
    }),
}));
vi.mock('@hoop-rush/persistence', async (importOriginal) => {
  const original = await importOriginal<typeof import('@hoop-rush/persistence')>();
  return { ...original, loadActiveRunWithSchedule: () => Promise.resolve(null) };
});

const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: franchiseIdSchema.parse('lakers') });

function buildZeroEffects(run: SeasonRun): SeasonEffectsState {
  const playerStates = run.rosters.flatMap((roster) =>
    roster.players.map((player) => ({
      playerVersionId: player.playerVersionId,
      fatigueBasisPoints: 0,
      recentLoadBasisPoints: 0,
      lastCompletedRound: 0,
    })),
  );
  const pairStates: SeasonEffectsState['pairStates'] = [];
  for (const roster of run.rosters) {
    const ids = roster.players.map((player) => player.playerVersionId).sort();
    for (let i = 0; i < ids.length; i += 1) {
      const a = ids[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < ids.length; j += 1) {
        const b = ids[j];
        if (b === undefined) continue;
        pairStates.push({ a, b, sharedPossessions: 0 });
      }
    }
  }
  return {
    schemaVersion: 2,
    playerStates,
    inactivePlayerStates: [],
    pairStates,
    archivedPairs: [],
  };
}

async function runFakeBlock0(): Promise<{ events: SeasonRunnerEvent[]; schedule: SeasonSchedule }> {
  const schedule = generateSeasonSchedule({
    league: LEAGUE,
    seed: seedSchema.parse('a'.repeat(32)),
  });
  const run = buildSeasonRunFixture({ schedule, stateDigest: 'a'.repeat(32) });
  const runner = createFakeSeasonBlockRunner();
  const events: SeasonRunnerEvent[] = [];
  let wake: (() => void) | null = null;
  const terminal = new Promise<SeasonRunnerEvent>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('timed out waiting for terminal event'));
    }, 20000);
    const pump = (): void => {
      const done = events.find((event) => event.type === 'complete' || event.type === 'error');
      if (done !== undefined) {
        clearTimeout(timeout);
        resolve(done);
      }
    };
    wake = pump;
    void pump;
  });
  runner.subscribe((event) => {
    events.push(event);
    wake?.();
  });
  runner.startBlock({
    run,
    effects: buildZeroEffects(run),
    rotations: run.rotations,
    blockIndex: 0,
    expectedRevision: 0,
    rotationDigest: seasonRotationSetDigest(run.rotations),
    commandId: commandIdSchema.parse('cmd-fake-1'),
    humanFranchiseId: franchiseIdSchema.parse('lakers'),
    objectiveId: 'win-six',
    homeCourt: SEASON_NEUTRAL_HOME_COURT,
    catalogUrl: 'https://example.test/season/draft-catalog.json',
    catalogHash: '0'.repeat(64),
    profileUrl: 'https://example.test/season/era-sim.json',
    profileHash: '0'.repeat(64),
  });
  const done = await terminal;
  runner.terminate();
  if (done.type !== 'complete') {
    throw new Error(
      `fake runner ended with ${done.type}: ${done.type === 'error' ? done.message : 'no complete'}`,
    );
  }
  return { events, schedule };
}

describe('fake season block runner contract', () => {
  it('is labeled non-committable', () => {
    expect(FAKE_SEASON_BLOCK_RUNNER_SOURCE).toBe('fake-season-block-runner');
    expect(FAKE_SEASON_BLOCK_CHECKPOINT_COMMITTABLE).toBe(false);
    expect(FAKE_SEASON_BLOCK_NON_COMMITTABLE_REASON).toMatch(/bypass digest\/commit/);
  });

  it('emits the same event types in the same order as the real runner', async () => {
    const { events } = await runFakeBlock0();
    expect(events.length).toBeGreaterThan(2);
    expect(events[0]?.type).toBe('started');
    const middle = events.slice(1, -1);
    expect(middle.length).toBeGreaterThan(0);
    for (const event of middle) expect(event.type).toBe('progress');
    expect(events[events.length - 1]?.type).toBe('complete');
    const requestIds = new Set(events.map((event) => event.requestId));
    expect(requestIds.size).toBe(1);
    let lastCompleted = -1;
    let gamesTotal = -1;
    for (const event of events) {
      if (event.type !== 'progress') continue;
      expect(event.blockIndex).toBe(0);
      if (gamesTotal < 0) gamesTotal = event.gamesTotal;
      expect(event.gamesTotal).toBe(gamesTotal);
      expect(event.gamesCompleted).toBeGreaterThan(lastCompleted);
      lastCompleted = event.gamesCompleted;
      expect(typeof event.humanRecordInBlock.wins).toBe('number');
      expect(typeof event.humanRecordInBlock.losses).toBe('number');
      expect(Array.isArray(event.humanResults)).toBe(true);
      expect(event.leaguePulse).toBeDefined();
      expect(
        event.leaguePulse.closest === null || typeof event.leaguePulse.closest === 'object',
      ).toBe(true);
    }
    expect(lastCompleted).toBe(gamesTotal);
  }, 30000);

  it('fails the real digest/commit gate loudly instead of looking committable', async () => {
    const { events } = await runFakeBlock0();
    const complete = events[events.length - 1];
    if (complete?.type !== 'complete') throw new Error('expected a complete event');
    const checkpoint = complete.checkpoint;
    expect(seasonCheckpointDigest(checkpoint)).not.toBe(checkpoint.digest);
    const failures = acceptWorkerResult(checkpoint, {
      runId: checkpoint.runId,
      blockIndex: 0,
      revision: 0,
      rotationDigest: checkpoint.rotationDigest,
      expectedStateRevision: checkpoint.expectedStateRevision,
      expectedStateDigest: checkpoint.expectedStateDigest,
    });
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((failure) => failure.includes('digest does not verify'))).toBe(true);
  }, 30000);
});
