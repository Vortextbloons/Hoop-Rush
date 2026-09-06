import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEASON_NEUTRAL_HOME_COURT,
  SEASON_WORKER_WIRE_SCHEMA_VERSION,
  commandIdSchema,
  franchiseIdSchema,
  seasonGameIdSchema,
  seedSchema,
  type SeasonRun,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import { generateSeasonSchedule, seasonRotationSetDigest } from '@hoop-rush/engine';
import { createSeasonBlockRunner, type SeasonRunnerEvent } from './season-block-runner';

const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: franchiseIdSchema.parse('lakers') });

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: unknown[] = [];
  private listeners: Array<(event: MessageEvent<unknown>) => void> = [];
  constructor(public url: string) {
    FakeWorker.instances.push(this);
  }
  postMessage(data: unknown): void {
    this.posted.push(data);
  }
  addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void {
    if (type === 'message') this.listeners.push(listener);
  }
  removeEventListener(): void {}
  emit(data: unknown): void {
    for (const listener of [...this.listeners]) listener({ data } as MessageEvent<unknown>);
  }
  terminate(): void {}
}

function rotationDigest(run: SeasonRun): string {
  return seasonRotationSetDigest(run.rotations);
}

function makeRun(schedule: SeasonSchedule): SeasonRun {
  const base = buildSeasonRunFixture({ schedule, stateDigest: 'a'.repeat(32) });
  return {
    ...base,
    objectives: {
      ...base.objectives,
      selections: {
        0: {
          objectiveId: 'win-six' as const,
          selectedByCommandId: commandIdSchema.parse('cmd-select-0'),
          success: null,
        },
      },
    },
  };
}

function zeroEffects(run: SeasonRun) {
  const playerStates = run.rosters.flatMap((r) =>
    r.players.map((p) => ({
      playerVersionId: p.playerVersionId,
      fatigueBasisPoints: 0,
      recentLoadBasisPoints: 0,
      lastCompletedRound: 0,
    })),
  );
  const pairStates: Array<{ a: string; b: string; sharedPossessions: number }> = [];
  for (const roster of run.rosters) {
    const ids = roster.players.map((p) => p.playerVersionId).sort();
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
    schemaVersion: 2 as const,
    playerStates,
    inactivePlayerStates: [],
    pairStates,
    archivedPairs: [],
  };
}

function scoreline(gameId: string) {
  return {
    gameId: seasonGameIdSchema.parse(gameId),
    homeFranchiseId: franchiseIdSchema.parse('lakers'),
    homeScore: 112,
    awayScore: 108,
    awayFranchiseId: franchiseIdSchema.parse('celtics'),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush() {
  for (let i = 0; i < 10; i += 1) await tick();
}
function artifacts() {
  return Promise.resolve({
    catalogUrl: 'u',
    catalogHash: '0'.repeat(64),
    profileUrl: 'p',
    profileHash: '0'.repeat(64),
  });
}
function makeRepository(run: SeasonRun) {
  const snapshot = {
    run,
    summaries: [],
    retainedDetails: [],
    acceptedBlocks: [],
    effects: zeroEffects(run),
  };
  return {
    loadActiveRunIndex: vi.fn(() => Promise.resolve(null)),
    loadActiveRun: vi.fn(() => Promise.resolve(snapshot)),
    loadBlockSummaries: vi.fn(() => Promise.resolve([])),
    loadRetainedDetails: vi.fn(() => Promise.resolve([])),
    loadBlockHistory: vi.fn(() => Promise.resolve([])),
    commitSeasonBlock: vi.fn(() => Promise.resolve(undefined)),
    promoteSeasonDraftToRun: vi.fn(() => Promise.resolve(undefined)),
    clearSeasonRun: vi.fn(() => Promise.resolve(undefined)),
    forceClearActiveSeasonRun: vi.fn(() => Promise.resolve(undefined)),
    savePendingBlock: vi.fn(() => Promise.resolve(undefined)),
    loadPendingBlock: vi.fn(() => Promise.resolve(null)),
    discardPendingBlock: vi.fn(() => Promise.resolve(undefined)),
    applySeasonRunCommand: vi.fn(() => Promise.resolve(undefined)),
    loadSeasonRunPlayerSlice: vi.fn(() => Promise.resolve(null)),
    upsertSeasonRunPlayerSlice: vi.fn(() => Promise.resolve(undefined)),
  };
}

describe('season block runner live v10', () => {
  let schedule: SeasonSchedule;
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('fetch', () => Promise.reject(new Error('stubbed')));
    schedule = generateSeasonSchedule({ league: LEAGUE, seed: seedSchema.parse('a'.repeat(32)) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function startWithRunner() {
    const run = makeRun(schedule);
    const repository = makeRepository(run);
    const runner = createSeasonBlockRunner({
      repository,
      schedule,
      workerUrl: 'fake.ts',
      artifacts,
    });
    return { runner, run };
  }

  function startInput(run: SeasonRun) {
    return {
      run,
      effects: zeroEffects(run),
      rotations: run.rotations,
      blockIndex: 0,
      expectedRevision: 0,
      rotationDigest: rotationDigest(run),
      commandId: commandIdSchema.parse('cmd-1'),
      humanFranchiseId: franchiseIdSchema.parse('lakers'),
      objectiveId: 'win-six' as const,
      homeCourt: SEASON_NEUTRAL_HOME_COURT,
      catalogUrl: 'u',
      catalogHash: '0'.repeat(64),
      profileUrl: 'p',
      profileHash: '0'.repeat(64),
    };
  }

  it('forwards v10 human results and league pulse', async () => {
    const { runner, run } = startWithRunner();
    const events: SeasonRunnerEvent[] = [];
    runner.subscribe((e) => events.push(e));
    runner.startBlock(startInput(run));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    const started = events.find((e) => e.type === 'started');
    const requestId = started && 'requestId' in started ? started.requestId : 'missing';
    const line = scoreline('s000001');
    worker?.emit({
      schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-block-progress',
      requestId,
      blockIndex: 0,
      gamesCompleted: 1,
      gamesTotal: 150,
      latestGameId: 's000001',
      latestResult: line,
      isHumanGame: true,
      humanRecordInBlock: { wins: 1, losses: 0 },
      humanResults: [line],
      leaguePulse: { closest: line, blowout: line, highestScoring: line },
    });
    await flush();
    const progress = events.find((e) => e.type === 'progress');
    expect(progress).toBeDefined();
    if (progress?.type !== 'progress') throw new Error('expected progress');
    expect(progress.isHumanGame).toBe(true);
    expect(progress.humanRecordInBlock).toEqual({ wins: 1, losses: 0 });
    expect(progress.humanResults).toHaveLength(1);
    expect(progress.leaguePulse.closest?.gameId).toBe('s000001');
  });

  it('drops stale and unparsable messages', async () => {
    const { runner, run } = startWithRunner();
    const events: SeasonRunnerEvent[] = [];
    runner.subscribe((e) => events.push(e));
    runner.startBlock(startInput(run));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    const line = scoreline('s000001');
    worker?.emit({
      schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-block-progress',
      requestId: 'stale-id',
      blockIndex: 0,
      gamesCompleted: 1,
      gamesTotal: 150,
      latestGameId: 's000001',
      latestResult: line,
      isHumanGame: false,
      humanRecordInBlock: { wins: 0, losses: 0 },
      humanResults: [],
      leaguePulse: { closest: line, blowout: line, highestScoring: line },
    });
    const started = events.find((e) => e.type === 'started');
    const requestId = started && 'requestId' in started ? started.requestId : 'x';
    worker?.emit({ schemaVersion: 3, type: 'season-block-progress', requestId });
    await flush();
    expect(events.filter((e) => e.type === 'progress')).toHaveLength(0);
  });

  it('maps cancelled to cancelled and invariant-failure to error', async () => {
    const { runner, run } = startWithRunner();
    const events: SeasonRunnerEvent[] = [];
    runner.subscribe((e) => events.push(e));
    runner.startBlock(startInput(run));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    const started = events.find((e) => e.type === 'started');
    const requestId = started && 'requestId' in started ? started.requestId : 'x';
    worker?.emit({
      schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-block-error',
      requestId,
      code: 'cancelled',
      message: 'block cancelled between games',
      seed: null,
      gameId: null,
      blockIndex: 0,
    });
    await flush();
    expect(events.some((e) => e.type === 'cancelled')).toBe(true);
  });
});
