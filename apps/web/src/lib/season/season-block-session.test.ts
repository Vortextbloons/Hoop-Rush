import { describe, expect, it, vi } from 'vitest';
import {
  PLAYER_VERSION_ID_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_DRAFT_CATALOG_VERSION,
  SEASON_DURABILITY_VERSION,
  SEASON_NEUTRAL_HOME_COURT,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_STAMINA_VERSION,
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  commandIdSchema,
  eraIdSchema,
  franchiseIdSchema,
  idSchema,
  seedSchema,
  type Position,
  type SeasonChallengeDeal,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonInvalidRosterInterruption,
  type SeasonPendingBlockCandidate,
  type SeasonRun,
  type SeasonSchedule,
  type SeasonSubmitBlockCommand,
} from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildSeasonLeague,
  buildSeasonRunFixture,
} from '@hoop-rush/test-fixtures';
import { dealSeasonBlockChallenges, generateSeasonSchedule } from '@hoop-rush/engine';
import {
  SeasonSession,
  type SeasonAssetPort,
  type SeasonRunRepositoryPort,
  type SeasonSessionOptions,
} from '@hoop-rush/application/season';
import type { CommitSeasonBlockInput, SeasonRunSnapshot } from '@hoop-rush/persistence';
import { seasonRotationSetDigest } from '@hoop-rush/engine';
import { createFakeSeasonBlockRunner } from './testing/fake-season-block-runner';

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

function makeRepository(run: SeasonRun, effects: SeasonEffectsState) {
  const snapshot: SeasonRunSnapshot = {
    run,
    summaries: [],
    retainedDetails: [],
    acceptedBlocks: [],
    effects,
  };
  const repository = {
    loadActiveRunIndex: vi.fn(() => Promise.resolve(null)),
    loadActiveRun: vi.fn(() => Promise.resolve(snapshot)),
    loadBlockSummaries: vi.fn(() => Promise.resolve([])),
    loadRetainedDetails: vi.fn(() => Promise.resolve([])),
    loadBlockHistory: vi.fn(() => Promise.resolve([])),
    commitSeasonBlock: vi.fn<(input: CommitSeasonBlockInput) => Promise<void>>(() =>
      Promise.resolve(),
    ),
    promoteSeasonDraftToRun: vi.fn(() => Promise.resolve(undefined)),
    clearSeasonRun: vi.fn(() => Promise.resolve(undefined)),
    forceClearActiveSeasonRun: vi.fn(() => Promise.resolve(undefined)),
    savePendingBlock: vi.fn<
      (
        pending: SeasonPendingBlockCandidate,
        interruption: SeasonInvalidRosterInterruption,
      ) => Promise<void>
    >(() => Promise.resolve()),
    loadPendingBlock: vi.fn(() => Promise.resolve(null)),
    loadPendingInterruption: vi.fn(() => Promise.resolve(null)),
    discardPendingBlock: vi.fn(() => Promise.resolve(undefined)),
    applySeasonRunCommand: vi.fn(() => Promise.resolve(undefined)),
    loadSeasonRunPlayerSlice: vi.fn(() => Promise.resolve(null)),
    upsertSeasonRunPlayerSlice: vi.fn(() => Promise.resolve(undefined)),
    commitPostseasonAdvancement: vi.fn(() => Promise.resolve(undefined)),
    loadPostseasonSummaries: vi.fn(() => Promise.resolve([])),
    loadPostseasonSummary: vi.fn(() => Promise.resolve(null)),
    loadPostseasonDetails: vi.fn(() => Promise.resolve([])),
    loadCommandLog: vi.fn(() => Promise.resolve(null)),
    promoteChampionToCompleted: vi.fn(() => Promise.resolve(undefined)),
    loadCompletedSeason: vi.fn(() => Promise.resolve(null)),
    listCompletedSeasonRuns: vi.fn(() => Promise.resolve([])),
    deleteCompletedSeason: vi.fn(() => Promise.resolve(undefined)),
    buildReplayExport: vi.fn(() => Promise.resolve(null)),
  } satisfies SeasonRunRepositoryPort;
  return repository;
}

function fixtureBlock0(): {
  run: SeasonRun;
  schedule: SeasonSchedule;
  effects: SeasonEffectsState;
  command: SeasonSubmitBlockCommand;
  challengeDeal: SeasonChallengeDeal;
  startCatalogUrl: string;
  startCatalogHash: string;
  startProfileUrl: string;
  startProfileHash: string;
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
  const commandId = commandIdSchema.parse('cmd-session-1');
  const command: SeasonSubmitBlockCommand = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    blockVersion: SEASON_BLOCK_VERSION,
    command: 'submit-season-block',
    commandId,
    runId: idSchema.parse(run.runId),
    expectedRevision: 0,
    blockIndex: 0,
    rotationDigest: seasonRotationSetDigest(run.rotations),
    objectiveId: null,
    challengeIds: [...challengeDeal.challengeIds],
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
  };
  return {
    run,
    schedule,
    effects: buildZeroEffects(run),
    command,
    challengeDeal,
    startCatalogUrl: 'in-process:season-draft-catalog',
    startCatalogHash: '0'.repeat(64),
    startProfileUrl: 'in-process:era-simulation-profile',
    startProfileHash: '0'.repeat(64),
  };
}

describe('season block session integration', () => {
  it('runs the real block job through the session commit and publishes the snapshot', async () => {
    const { run, schedule, effects, command, challengeDeal, ...urls } = fixtureBlock0();
    const catalog = catalogOf(run);
    const repository = makeRepository(run, effects);
    const runner = createFakeSeasonBlockRunner({
      schedule,
      catalog,
      profile: buildEraSimulationProfile(),
    });
    const announcements: Array<{ kind: string; runId: string | null; revision?: number }> = [];
    const assets: SeasonAssetPort = {
      loadEraProfile: () => Promise.resolve(buildEraSimulationProfile()),
      loadDraftCatalog: () => Promise.resolve(catalog),
      loadFreeAgencyIndex: () =>
        Promise.reject(new Error('the free-agency index is unavailable in this test')),
      loadFreeAgencyTargets: () =>
        Promise.reject(new Error('the free-agency targets are unavailable in this test')),
      loadHomeCourtProfile: () => Promise.resolve({ ...SEASON_NEUTRAL_HOME_COURT }),
      loadArtifactUrls: () =>
        Promise.resolve({
          catalogUrl: urls.startCatalogUrl,
          catalogHash: urls.startCatalogHash,
          profileUrl: urls.startProfileUrl,
          profileHash: urls.startProfileHash,
        }),
      loadSchedule: () => Promise.resolve(schedule),
    };
    const session = new SeasonSession({
      repository,
      blockRunner: runner,
      assets,
      notifier: {
        announce: (mutation) => {
          announcements.push(mutation);
        },
        onMutation: () => () => {},
        close: () => {},
      },
      clock: { now: () => 0, sleep: () => Promise.resolve() },
      ids: { id: (prefix) => `${prefix}-integration-1` },
      draftCleaner: { clearDraftSave: () => Promise.resolve() },
    } satisfies SeasonSessionOptions);
    await session.refresh();

    session.startBlock({
      command,
      start: {
        run,
        effects,
        rotations: run.rotations,
        blockIndex: 0,
        expectedRevision: 0,
        rotationDigest: command.rotationDigest,
        commandId: command.commandId,
        humanFranchiseId: franchiseIdSchema.parse('lakers'),
        objectiveId: null,
        challengeDeal,
        homeCourt: SEASON_NEUTRAL_HOME_COURT,
        catalogUrl: urls.startCatalogUrl,
        catalogHash: urls.startCatalogHash,
        profileUrl: urls.startProfileUrl,
        profileHash: urls.startProfileHash,
      },
    });

    await vi.waitFor(
      () => {
        expect(repository.commitSeasonBlock).toHaveBeenCalledTimes(1);
        expect(session.block.phase).toBe('idle');
      },
      { timeout: 90000 },
    );
    const commit = repository.commitSeasonBlock.mock.calls[0]?.[0] as CommitSeasonBlockInput;
    expect(commit).toMatchObject({
      runId: run.runId,
      revision: 1,
      commandId: command.commandId,
      rotationDigest: command.rotationDigest,
      expectedStateRevision: run.stateRevision,
      expectedStateDigest: run.stateDigest,
      window: null,
    });
    expect(commit.stateDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(commit.objectives).toBeDefined();
    expect(commit.checkpointState).toMatchObject({ runId: run.runId, blockIndex: 0 });
    expect(session.snapshot?.run.runId).toBe(run.runId);
    expect(session.snapshot?.acceptedBlocks).toHaveLength(1);
    expect(session.snapshot?.summaries.length).toBeGreaterThan(0);
    expect(session.snapshot?.run.cursor.completedRounds).toBe(10);
    expect(session.pending).toBeNull();
    expect(session.interruption).toBeNull();
    expect(announcements).toContainEqual({
      kind: 'commit',
      runId: run.runId,
      revision: 1,
      committedAt: 0,
    });
    session.destroy();
  }, 120000);
});
