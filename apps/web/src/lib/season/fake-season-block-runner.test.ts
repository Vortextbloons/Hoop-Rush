import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLAYER_VERSION_ID_VERSION,
  SEASON_DRAFT_CATALOG_VERSION,
  SEASON_DURABILITY_VERSION,
  SEASON_NEUTRAL_HOME_COURT,
  SEASON_STAMINA_VERSION,
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  commandIdSchema,
  eraIdSchema,
  franchiseIdSchema,
  seedSchema,
  type Position,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonPendingBlockCandidate,
  type SeasonRun,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildSeasonLeague,
  buildSeasonRunFixture,
} from '@hoop-rush/test-fixtures';
import {
  assembleSeasonPendingBlock,
  dealSeasonBlockChallenges,
  generateSeasonSchedule,
  seasonCheckpointDigest,
  seasonRotationSetDigest,
} from '@hoop-rush/engine';
import { acceptWorkerResult } from './season-block-runner';
import type { SeasonBlockStartInput, SeasonRunnerEvent } from './season-block-runner';
import type { SeasonRunSnapshot } from '@hoop-rush/persistence';

const commitSeasonBlock = vi.hoisted(() => vi.fn(() => Promise.resolve(undefined)));
const savePendingBlock = vi.hoisted(() => vi.fn(() => Promise.resolve(undefined)));
const loadPendingBlock = vi.hoisted(() =>
  vi.fn((): Promise<SeasonPendingBlockCandidate | null> => Promise.resolve(null)),
);
const loadActiveRun = vi.hoisted(() =>
  vi.fn((): Promise<SeasonRunSnapshot | null> => Promise.resolve(null)),
);
let createFakeSeasonBlockRunner: (typeof import('./fake-season-block-runner'))['createFakeSeasonBlockRunner'];

beforeEach(async () => {
  vi.resetModules();
  vi.doMock('$lib/season/season-repo', () => ({
    getSeasonRunRepository: () =>
      Promise.resolve({
        commitSeasonBlock,
        savePendingBlock,
        loadPendingBlock,
        loadActiveRun,
        loadBlockHistory: () => Promise.resolve([]),
        loadRetainedDetails: () => Promise.resolve([]),
      }),
  }));
  createFakeSeasonBlockRunner = (await import('./fake-season-block-runner'))
    .createFakeSeasonBlockRunner;
});

const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: franchiseIdSchema.parse('lakers') });

const SLOT_POSITIONS: ReadonlyArray<readonly Position[]> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF', 'C'],
  ['C'],
];

function catalogOf(run: SeasonRun): SeasonDraftCatalog {
  const candidates: SeasonDraftCandidate[] = run.rosters.flatMap((roster) =>
    roster.players.map((player, slot) => {
      const playable = SLOT_POSITIONS[slot];
      if (playable === undefined) throw new Error(`no position pattern for slot ${String(slot)}`);
      const primary = playable[0];
      if (primary === undefined) throw new Error(`no primary position for slot ${String(slot)}`);
      return {
        playerVersionId: player.playerVersionId,
        playerId: player.playerId,
        franchiseId: roster.franchiseId,
        eraId: player.eraId,
        seasonKey: player.seasonKey,
        displayName: player.displayName,
        playerExternalId: '101',
        positions: {
          primary,
          secondary: playable.slice(1),
          playable: [...playable],
          normalizationVersion: 'position-v3',
        },
        heightInches: 79,
        weightLbs: 215,
        summaryRatings: { overallRating: 90, offenseRating: 92, defenseRating: 84 },
        detailedRatings: { ...SIMULATION_RATINGS },
        tendencies: { ...SIMULATION_TENDENCIES },
        stamina: { rating: 70, historicalMpg: 30, derivationVersion: SEASON_STAMINA_VERSION },
        durability: { rating: 70, derivationVersion: SEASON_DURABILITY_VERSION },
      };
    }),
  );
  return {
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
    dataVersion: 'data-v1',
    ratingsVersion: 'ratings-v1',
    positionNormalizationVersion: 'position-v3',
    playerVersionIdVersion: PLAYER_VERSION_ID_VERSION,
    staminaVersion: SEASON_STAMINA_VERSION,
    durabilityVersion: SEASON_DURABILITY_VERSION,
    pools: run.rosters.map((roster) => ({
      franchiseId: roster.franchiseId,
      eraId: eraIdSchema.parse('1990s'),
      playerVersionIds: roster.players.map((player) => player.playerVersionId),
    })),
    candidates,
  };
}

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

function snapshotOf(run: SeasonRun, effects: SeasonEffectsState): SeasonRunSnapshot {
  return {
    run,
    summaries: [],
    retainedDetails: [],
    acceptedBlocks: [],
    effects,
  };
}

function fixtureBlock0(): {
  run: SeasonRun;
  schedule: SeasonSchedule;
  input: SeasonBlockStartInput;
} {
  const schedule = generateSeasonSchedule({
    league: LEAGUE,
    seed: seedSchema.parse('a'.repeat(32)),
  });
  const run = buildSeasonRunFixture({ schedule, stateDigest: 'a'.repeat(32) });
  const humanFranchiseId = franchiseIdSchema.parse('lakers');
  const challengeDeal = dealSeasonBlockChallenges(run.rootSeed, 0, {
    league: run.league,
    schedule,
    standings: run.standings,
    humanFranchiseId,
  });
  if (challengeDeal === null) throw new Error('block 0 must be offered a challenge deal');
  const input: SeasonBlockStartInput = {
    run,
    effects: buildZeroEffects(run),
    rotations: run.rotations,
    blockIndex: 0,
    expectedRevision: 0,
    rotationDigest: seasonRotationSetDigest(run.rotations),
    commandId: commandIdSchema.parse('cmd-fake-1'),
    humanFranchiseId,
    objectiveId: null,
    challengeDeal,
    homeCourt: SEASON_NEUTRAL_HOME_COURT,
    catalogUrl: 'https://example.test/season/draft-catalog.json',
    catalogHash: '0'.repeat(64),
    profileUrl: 'https://example.test/season/era-sim.json',
    profileHash: '0'.repeat(64),
  };
  return { run, schedule, input };
}

function collect(runner: ReturnType<typeof createFakeSeasonBlockRunner>): {
  events: SeasonRunnerEvent[];
  terminal: Promise<SeasonRunnerEvent>;
} {
  const events: SeasonRunnerEvent[] = [];
  let wake: () => void = () => {};
  const terminal = new Promise<SeasonRunnerEvent>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('timed out waiting for terminal event'));
    }, 60000);
    wake = () => {
      const done = events.find(
        (event) =>
          event.type === 'complete' || event.type === 'error' || event.type === 'interrupted',
      );
      if (done !== undefined) {
        clearTimeout(timeout);
        resolve(done);
      }
    };
  });
  runner.subscribe((event) => {
    events.push(event);
    wake();
  });
  return { events, terminal };
}

describe('fake season block runner contract', () => {
  it('emits the same event types in the same order as the real runner', async () => {
    const { run, schedule, input } = fixtureBlock0();
    loadActiveRun.mockResolvedValue(snapshotOf(run, input.effects));
    const runner = createFakeSeasonBlockRunner({
      schedule,
      catalog: catalogOf(run),
      profile: buildEraSimulationProfile(),
    });
    const { events, terminal } = collect(runner);
    runner.startBlock(input);
    const done = await terminal;
    runner.terminate();
    if (done.type !== 'complete') {
      throw new Error(
        `fake runner ended with ${done.type}: ${done.type === 'error' ? done.message : 'no complete'}`,
      );
    }
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
  }, 90000);

  it('produces an engine checkpoint that passes the real digest/commit gate', async () => {
    const { run, schedule, input } = fixtureBlock0();
    loadActiveRun.mockResolvedValue(snapshotOf(run, input.effects));
    const runner = createFakeSeasonBlockRunner({
      schedule,
      catalog: catalogOf(run),
      profile: buildEraSimulationProfile(),
    });
    const { events, terminal } = collect(runner);
    runner.startBlock(input);
    const done = await terminal;
    runner.terminate();
    if (done.type !== 'complete') {
      throw new Error(
        `fake runner ended with ${done.type}: ${done.type === 'error' ? done.message : 'no complete'}`,
      );
    }
    const checkpoint = done.checkpoint;
    expect(seasonCheckpointDigest(checkpoint)).toBe(checkpoint.digest);
    expect(
      acceptWorkerResult(checkpoint, {
        runId: checkpoint.runId,
        blockIndex: 0,
        revision: 0,
        rotationDigest: checkpoint.rotationDigest,
        expectedStateRevision: checkpoint.expectedStateRevision,
        expectedStateDigest: checkpoint.expectedStateDigest,
      }),
    ).toEqual([]);
    expect(checkpoint.gameSummaries.length).toBeGreaterThan(0);
    expect(commitSeasonBlock).toHaveBeenCalled();
    expect(events[events.length - 1]?.type).toBe('complete');
  }, 90000);

  it('resumes from a saved pending candidate and completes the block', async () => {
    const { run, schedule, input } = fixtureBlock0();
    const effects = buildZeroEffects(run);
    const firstGame = schedule.games
      .filter((game) => game.round >= 1 && game.round <= 10)
      .sort((a, b) => (a.gameId < b.gameId ? -1 : 1))[0];
    if (firstGame === undefined) throw new Error('block 0 has no games');
    const pending = assembleSeasonPendingBlock({
      run,
      commandId: input.commandId,
      blockIndex: 0,
      expectedRevision: 0,
      expectedStateRevision: run.stateRevision,
      expectedStateDigest: run.stateDigest,
      objectiveId: null,
      challengeDeal: input.challengeDeal,
      nextGameId: firstGame.gameId,
      summaries: [],
      retainedDetails: [],
      effects,
      health: run.health,
      rotationDigest: seasonRotationSetDigest(run.rotations),
    });
    loadPendingBlock.mockResolvedValueOnce(pending);
    loadActiveRun.mockResolvedValue(snapshotOf(run, effects));
    const runner = createFakeSeasonBlockRunner({
      schedule,
      catalog: catalogOf(run),
      profile: buildEraSimulationProfile(),
    });
    const { events, terminal } = collect(runner);
    runner.resumeBlock({
      runId: run.runId,
      blockIndex: 0,
      expectedRevision: 0,
      rotationDigest: seasonRotationSetDigest(run.rotations),
      commandId: input.commandId,
      rotations: run.rotations,
      humanFranchiseId: franchiseIdSchema.parse('lakers'),
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
        `fake resume ended with ${done.type}: ${done.type === 'error' ? done.message : 'no complete'}`,
      );
    }
    expect(seasonCheckpointDigest(done.checkpoint)).toBe(done.checkpoint.digest);
    expect(events[0]?.type).toBe('started');
    expect(events[events.length - 1]?.type).toBe('complete');
  }, 90000);

  it('fails loudly when there is no pending block to resume', async () => {
    const { run, schedule, input } = fixtureBlock0();
    loadActiveRun.mockResolvedValue(snapshotOf(run, input.effects));
    loadPendingBlock.mockResolvedValueOnce(null);
    const runner = createFakeSeasonBlockRunner({
      schedule,
      catalog: catalogOf(run),
      profile: buildEraSimulationProfile(),
    });
    const { terminal } = collect(runner);
    runner.resumeBlock({
      runId: run.runId,
      blockIndex: 0,
      expectedRevision: 0,
      rotationDigest: seasonRotationSetDigest(run.rotations),
      commandId: input.commandId,
      rotations: run.rotations,
      humanFranchiseId: franchiseIdSchema.parse('lakers'),
      homeCourt: SEASON_NEUTRAL_HOME_COURT,
      catalogUrl: 'https://example.test/season/draft-catalog.json',
      catalogHash: '0'.repeat(64),
      profileUrl: 'https://example.test/season/era-sim.json',
      profileHash: '0'.repeat(64),
    });
    const done = await terminal;
    runner.terminate();
    expect(done.type).toBe('error');
    if (done.type === 'error') expect(done.message).toMatch(/no pending block/);
  }, 30000);
});
