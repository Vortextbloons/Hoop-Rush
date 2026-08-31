import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SEASON_DRAFT_CATALOG_V3,
  SEASON_DURABILITY_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_STAMINA_VERSION,
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  PLAYER_VERSION_ID_VERSION,
  type Position,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonFreeAgencyBand,
  type SeasonFreeAgencyIndex,
  type SeasonFreeAgencyIndexEntry,
  type SeasonRun,
  type SeasonRosterTargets,
} from '@hoop-rush/data-contracts';
import type { SeasonRunRepository } from '@hoop-rush/persistence';
import type { SeasonRunCommandApplication, SeasonRunSnapshot } from '@hoop-rush/persistence';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import {
  generateSeasonSchedule,
  openSeasonFreeAgencyWindow,
  seasonRunStateDigest,
} from '@hoop-rush/engine';
import { SeasonHubState, describeCommandRejection } from './season-hub-state';
import { clearCachedSeasonSnapshot } from './season-state-cache';
import type { SeasonBlockRunner, SeasonRunnerEvent } from './season-block-runner';
import { buildSubmitBlockEnvelope } from './season-block-submit';
import type { SeasonRunShellData } from './season-shell-context';
const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
const HUMAN = 'lakers';
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
const BAND_CYCLE: SeasonFreeAgencyBand[] = ['featured', 'role', 'role', 'development', 'emergency'];
function fixtureCatalog(run: SeasonRun): SeasonDraftCatalog {
  const candidates: SeasonDraftCandidate[] = [];
  for (const roster of run.rosters) {
    roster.players.forEach((player, slot) => {
      const playable = SLOT_POSITIONS[slot];
      if (playable === undefined) throw new Error('no position pattern for slot');
      candidates.push(catalogCandidate(player.playerVersionId, player.playerId, playable));
    });
  }
  for (let i = 0; i < 30; i += 1) {
    const playable = SLOT_POSITIONS[i % SLOT_POSITIONS.length];
    if (playable === undefined) throw new Error('no position pattern for extra');
    candidates.push(
      catalogCandidate(
        `pv-extra-${String(i).padStart(2, '0')}`,
        `p-extra-${String(i).padStart(2, '0')}`,
        playable,
      ),
    );
  }
  return {
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_V3,
    dataVersion: 'data-v1',
    ratingsVersion: 'ratings-v1',
    positionNormalizationVersion: 'position-v3',
    playerVersionIdVersion: PLAYER_VERSION_ID_VERSION,
    staminaVersion: SEASON_STAMINA_VERSION,
    durabilityVersion: SEASON_DURABILITY_VERSION,
    pools: run.rosters.map((roster) => ({
      franchiseId: roster.franchiseId,
      eraId: '1990s',
      playerVersionIds: roster.players.map((player) => player.playerVersionId),
    })),
    candidates,
  };
}
function catalogCandidate(
  playerVersionId: string,
  playerId: string,
  playable: readonly Position[],
): SeasonDraftCandidate {
  const primary = playable[0];
  if (primary === undefined) throw new Error('no primary position');
  return {
    playerVersionId,
    playerId,
    franchiseId: 'lakers',
    eraId: '1990s',
    seasonKey: '1994-95',
    displayName: playerId,
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
}
function fixtureIndex(catalog: SeasonDraftCatalog): SeasonFreeAgencyIndex {
  const candidates = catalog.candidates
    .filter((candidate) => candidate.playerId.startsWith('p-extra-'))
    .map((candidate, index) => ({
      playerVersionId: candidate.playerVersionId,
      playerId: candidate.playerId,
      displayName: candidate.displayName,
      positions: candidate.positions,
      band: BAND_CYCLE[index % BAND_CYCLE.length] as SeasonFreeAgencyBand,
      minimumInfluence: 1,
      supportedRoles: [
        'rotation',
        'depth',
        'emergency',
      ] as SeasonFreeAgencyIndexEntry['supportedRoles'],
      strengths: ['recorded role coverage'],
      limitations: [],
      durabilityRating: candidate.durability.rating,
      minutesPerGame: candidate.stamina.historicalMpg,
      availability: { healthy: true, notes: '' },
      catalogRef: {
        catalogVersion: catalog.catalogVersion,
        dataVersion: catalog.dataVersion,
        candidateIndex: catalog.candidates.indexOf(candidate),
      },
      derivationEvidence: 'fixture eligibility',
      exclusionEvidence: '',
    }));
  const groupedVersions: Record<string, string[]> = {};
  for (const candidate of candidates) {
    const group = groupedVersions[candidate.playerId] ?? [];
    group.push(candidate.playerVersionId);
    groupedVersions[candidate.playerId] = group;
  }
  return {
    schemaVersion: 1,
    indexVersion: 'free-agency-index-v1',
    dataVersion: 'fixture',
    catalogRef: {
      catalogVersion: catalog.catalogVersion,
      contentHash: '0'.repeat(64),
      candidateCount: catalog.candidates.length,
    },
    candidates,
    groupedVersions,
  };
}
function fixtureTargets(): SeasonRosterTargets {
  return {
    schemaVersion: 2,
    targetsVersion: 'roster-targets-v3',
    policy: {
      bandQuotas: {
        solo: { contender: 4, playoff: 8, average: 10, weaker: 7 },
        duo: { contender: 4, playoff: 8, average: 9, weaker: 7 },
      },
      guaranteedAnchors: { contender: 2, playoff: 1, average: 0, weaker: 0 },
      extraEliteRollProbability: {
        contender: 0.65,
        playoff: 0.35,
        average: 0.2,
        weaker: 0.08,
      },
      tierRanges: {
        contender: { elite: [2, 4], strong: [5, 8], useful: [6, 10] },
        playoff: { elite: [1, 2], strong: [4, 7], useful: [7, 10] },
        average: { elite: [0, 1], strong: [3, 6], useful: [8, 11] },
        weaker: { elite: [0, 1], strong: [1, 4], useful: [7, 10] },
      },
      identityPriorityRoles: {
        'star-chaser': ['primary-creation'],
        'shooting-first': ['perimeter-shooting'],
        'defense-first': ['perimeter-defense'],
        'depth-builder': ['primary-creation'],
        continuity: ['primary-creation'],
        'active-trader': ['primary-creation'],
      },
      roleCoverageThreshold: 35,
      completionTargets: { guards: 4, forwards: 4, centers: 3 },
      poolSize: 20,
      rosterSize: 10,
      percentileTiers: { elite: 0.9, strong: 0.75, useful: 0.5 },
      bandPoolScoreCaps: { contender: 100, playoff: 92, average: 84, weaker: 74 },
      maxPoolStrengthOutliers: 4,
      maxRosterStrengthOutliers: 2,
      nodeBudgets: { anchorMatching: 20000, poolRepair: 40000, rosterSelection: 600000 },
    },
    calibration: {
      calibrationSeedCount: 4,
      validationSeedCount: 2,
      generatedAtIso: '2026-08-14T00:00:00.000Z',
      aiVersion: 'season-ai-v3',
      rosterGenerationVersion: 'roster-generation-v3',
      gates: {
        failureRateMax: 0,
        minBandSeparation: 3,
        anchorFulfillmentMin: 1,
        extraEliteRateTolerance: 0.05,
        heldOutPassShare: 0.95,
        orderInvarianceFailuresMax: 0,
        superTeamIncidenceMax: 0.08,
      },
    },
    measured: {
      bands: {
        contender: { range: [90, 90], median: 90, eliteShare: 1, strongShare: 1, usefulShare: 0 },
        playoff: { range: [80, 80], median: 80, eliteShare: 1, strongShare: 1, usefulShare: 0 },
        average: { range: [70, 70], median: 70, eliteShare: 0, strongShare: 1, usefulShare: 0 },
        weaker: { range: [60, 60], median: 60, eliteShare: 0, strongShare: 1, usefulShare: 0 },
      },
      identities: {
        'star-chaser': { range: [60, 90], median: 70 },
        'depth-builder': { range: [60, 90], median: 70 },
        'defense-first': { range: [60, 90], median: 70 },
        'shooting-first': { range: [60, 90], median: 70 },
        continuity: { range: [60, 80], median: 70 },
        'active-trader': { range: [60, 80], median: 80 },
      },
      anchorFulfillment: 1,
      extraEliteRate: 0.27,
      superTeamIncidence: 0,
      poolLegalityFailures: 0,
      selectionFailures: 0,
      generationFailures: 0,
    },
  };
}
function zeroEffectsOf(run: SeasonRun): SeasonEffectsState {
  return {
    schemaVersion: 2,
    playerStates: run.rosters.flatMap((roster) =>
      roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        fatigueBasisPoints: 0,
        recentLoadBasisPoints: 0,
        lastCompletedRound: 0,
      })),
    ),
    inactivePlayerStates: [],
    pairStates: [],
    archivedPairs: [],
  };
}
interface HubFixture {
  run: SeasonRun;
  effects: SeasonEffectsState;
  catalog: SeasonDraftCatalog;
  index: SeasonFreeAgencyIndex;
}
function hubFixture(): HubFixture {
  const league = buildSeasonLeague({}, { humanFranchiseId: HUMAN });
  const schedule = generateSeasonSchedule({ league, seed: SEED });
  const base = buildSeasonRunFixture({ schedule, league, seed: SEED, humanFranchiseId: HUMAN });
  const effects = zeroEffectsOf(base);
  const catalog = fixtureCatalog(base);
  const index = fixtureIndex(catalog);
  const opened = openSeasonFreeAgencyWindow(
    { run: base, effects, catalog, index, humanFranchiseId: HUMAN },
    0,
    2,
  );
  const run: SeasonRun = {
    ...base,
    freeAgency: opened.freeAgency,
    stateRevision: 1,
    stateDigest: seasonRunStateDigest({
      stateRevision: 1,
      stage: base.stage,
      postseason: base.postseason,
      awards: null,
      completion: null,
      checkpointState: null,
      health: base.health,
      influence: base.influence,
      transactions: [],
      trade: null,
      objectives: base.objectives,
      rosters: base.rosters,
      ownership: base.ownership,
      rotations: base.rotations,
      effects,
      freeAgency: opened.freeAgency,
    }),
  };
  return { run, effects, catalog, index };
}
function hubRepo(initial: SeasonRunSnapshot | null) {
  let active = initial;
  const initialRun = initial?.run ?? null;
  return {
    active,
    loadActiveRun: vi.fn(() => Promise.resolve(active)),
    loadActiveRunIndex: vi.fn(() =>
      Promise.resolve(
        active === null
          ? null
          : {
              runId: active.run.runId,
              rootSeed: active.run.rootSeed,
              humanFranchiseId: HUMAN,
              completedRounds: active.run.cursor.completedRounds,
              revision: active.acceptedBlocks.length,
              humanWins: 0,
              humanLosses: 0,
              updatedAtIso: '2026-01-01T00:00:00.000Z',
            },
      ),
    ),
    loadActiveRunIncompatible: vi.fn(() => Promise.resolve(null)),
    loadBlockSummaries: vi.fn(() => Promise.resolve([])),
    loadRetainedDetails: vi.fn(() => Promise.resolve([])),
    loadBlockHistory: vi.fn(() => Promise.resolve([])),
    commitSeasonBlock: vi.fn(() => Promise.resolve()),
    promoteSeasonDraftToRun: vi.fn(() => Promise.resolve()),
    clearSeasonRun: vi.fn(() => Promise.resolve()),
    forceClearActiveSeasonRun: vi.fn(() => Promise.resolve()),
    savePendingBlock: vi.fn(() => Promise.resolve()),
    loadPendingBlock: vi.fn(() => Promise.resolve(null)),
    discardPendingBlock: vi.fn(() => Promise.resolve()),
    applySeasonRunCommand: vi.fn<SeasonRunRepository['applySeasonRunCommand']>(
      (input: SeasonRunCommandApplication) => {
        const stored = active?.run ?? initialRun;
        if (stored === null) {
          return Promise.reject(new Error('no stored run to apply against'));
        }
        const expected = input.command;
        if (
          expected.expectedStateRevision !== stored.stateRevision ||
          expected.expectedStateDigest !== stored.stateDigest
        ) {
          return Promise.reject(
            new Error(
              `season run command ${String(expected.expectedStateRevision)} asserts stale state (expected revision ${String(stored.stateRevision)})`,
            ),
          );
        }
        active = {
          ...(active ?? {
            run: input.run,
            summaries: [],
            retainedDetails: [],
            acceptedBlocks: [],
          }),
          run: input.run,
          effects: input.effects ?? active?.effects ?? zeroEffectsOf(input.run),
        };
        return Promise.resolve();
      },
    ),
    loadSeasonRunPlayerSlice: vi.fn(() => Promise.resolve(null)),
    upsertSeasonRunPlayerSlice: vi.fn(() => Promise.resolve()),
    commitPostseasonAdvancement: vi.fn(() => Promise.resolve()),
    loadPostseasonSummaries: vi.fn(() => Promise.resolve([])),
    loadPostseasonSummary: vi.fn(() => Promise.resolve(null)),
    loadPostseasonDetails: vi.fn(() => Promise.resolve([])),
    loadCommandLog: vi.fn(() => Promise.resolve(null)),
    promoteChampionToCompleted: vi.fn(() => Promise.resolve()),
    loadCompletedSeason: vi.fn(() => Promise.resolve(null)),
    listCompletedSeasonRuns: vi.fn(() => Promise.resolve([])),
    deleteCompletedSeason: vi.fn(() => Promise.resolve()),
    buildReplayExport: vi.fn(() => Promise.resolve(null)),
  };
}
class FakeRunner implements SeasonBlockRunner {
  private readonly listeners = new Set<(event: SeasonRunnerEvent) => void>();
  startBlock(): string {
    return 'fake-1';
  }
  resumeBlock(): string {
    return 'fake-1';
  }
  cancel(): void {}
  terminate(): void {}
  prewarm(): void {}
  subscribe(listener: (event: SeasonRunnerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
function hubWith(fixture: HubFixture) {
  const repo = hubRepo({
    run: fixture.run,
    summaries: [],
    retainedDetails: [],
    acceptedBlocks: [],
    effects: fixture.effects,
  });
  const hub = new SeasonHubState(repo, new FakeRunner());
  hub.catalog = fixture.catalog;
  hub.freeAgencyIndex = fixture.index;
  hub.freeAgencyTargets = fixtureTargets();
  return { repo, hub };
}
function openWindowOf(run: SeasonRun) {
  return run.freeAgency.windows.find((window) => window.windowIndex === 0) ?? null;
}
describe('SeasonHubState free-agency commands (M2.6.5)', () => {
  afterEach(() => {
    clearCachedSeasonSnapshot();
    vi.restoreAllMocks();
  });
  it('declares interest, rejects a duplicate declaration, and resolves the market', async () => {
    const fixture = hubFixture();
    const { repo, hub } = hubWith(fixture);
    await hub.refresh();
    const window = openWindowOf(hub.snapshot?.run ?? fixture.run);
    if (window === null) throw new Error('expected an open window');
    const first = window.candidates[0];
    const second = window.candidates[1];
    if (first === undefined || second === undefined) {
      throw new Error('expected at least two window candidates');
    }
    await hub.declareFreeAgentInterest({
      windowIndex: 0,
      targets: [
        { playerVersionId: first.playerVersionId, roleExpectation: 'rotation', influence: 1 },
        { playerVersionId: second.playerVersionId, roleExpectation: 'depth', influence: 1 },
      ],
    });
    expect(hub.commandError).toBeNull();
    const declared = openWindowOf(hub.snapshot?.run ?? fixture.run);
    expect(declared?.declarations[HUMAN]?.targets).toHaveLength(2);
    expect(declared?.declarations[HUMAN]?.targets[0]?.playerVersionId).toBe(first.playerVersionId);
    expect(hub.snapshot?.run.stateRevision).toBe(2);
    await hub.declareFreeAgentInterest({
      windowIndex: 0,
      targets: [
        { playerVersionId: first.playerVersionId, roleExpectation: 'rotation', influence: 1 },
      ],
    });
    expect(hub.commandError?.rejection?.code).toBe('free-agency-already-declared');
    const applyCalls = repo.applySeasonRunCommand.mock.calls.length;
    expect(hub.snapshot?.run.stateRevision).toBe(2);
    await hub.resolveFreeAgentMarket({ windowIndex: 0 });
    expect(hub.commandError).toBeNull();
    const resolved = openWindowOf(hub.snapshot?.run ?? fixture.run);
    expect(resolved?.status).toBe('resolved');
    expect(hub.snapshot?.run.stateRevision).toBe(3);
    expect(repo.applySeasonRunCommand.mock.calls.length).toBe(applyCalls + 1);
    const applied = repo.applySeasonRunCommand.mock.calls[applyCalls]?.[0] as {
      command: {
        schemaVersion: number;
      };
      run: SeasonRun;
    };
    expect(applied.command.schemaVersion).toBe(SEASON_RUN_SCHEMA_VERSION);
    expect(applied.run.freeAgency.windows[0]?.status).toBe('resolved');
    hub.destroy();
  });
  it('rejects resolution before the human declares (pending-declaration)', async () => {
    const fixture = hubFixture();
    const { hub } = hubWith(fixture);
    await hub.refresh();
    await hub.resolveFreeAgentMarket({ windowIndex: 0 });
    expect(hub.commandError?.rejection?.code).toBe('free-agency-pending-declaration');
    expect(hub.commandError?.message).toContain('declares or skips');
    expect(hub.snapshot?.run.stateRevision).toBe(1);
    hub.destroy();
  });
  it('records a skip as the final declaration and resolves after it', async () => {
    const fixture = hubFixture();
    const { hub } = hubWith(fixture);
    await hub.refresh();
    await hub.skipFreeAgentMarket({ windowIndex: 0 });
    expect(hub.commandError).toBeNull();
    expect(openWindowOf(hub.snapshot?.run ?? fixture.run)?.declarations[HUMAN]?.targets).toEqual(
      [],
    );
    await hub.declareFreeAgentInterest({
      windowIndex: 0,
      targets: [{ playerVersionId: 'pv-extra-00', roleExpectation: 'rotation', influence: 1 }],
    });
    expect(hub.commandError?.rejection?.code).toBe('free-agency-already-declared');
    await hub.resolveFreeAgentMarket({ windowIndex: 0 });
    expect(hub.commandError).toBeNull();
    expect(openWindowOf(hub.snapshot?.run ?? fixture.run)?.status).toBe('resolved');
    hub.destroy();
  });
  it('replays the declaration from the run snapshot after a reload', async () => {
    const fixture = hubFixture();
    const repo = hubRepo({
      run: fixture.run,
      summaries: [],
      retainedDetails: [],
      acceptedBlocks: [],
      effects: fixture.effects,
    });
    const hubA = new SeasonHubState(repo, new FakeRunner());
    hubA.catalog = fixture.catalog;
    hubA.freeAgencyIndex = fixture.index;
    hubA.freeAgencyTargets = fixtureTargets();
    await hubA.refresh();
    const window = openWindowOf(hubA.snapshot?.run ?? fixture.run);
    const first = window?.candidates[0];
    if (first === undefined) throw new Error('expected a window candidate');
    await hubA.declareFreeAgentInterest({
      windowIndex: 0,
      targets: [
        { playerVersionId: first.playerVersionId, roleExpectation: 'rotation', influence: 1 },
      ],
    });
    expect(hubA.commandError).toBeNull();
    hubA.destroy();
    const hubB = new SeasonHubState(repo, new FakeRunner());
    hubB.catalog = fixture.catalog;
    hubB.freeAgencyIndex = fixture.index;
    hubB.freeAgencyTargets = fixtureTargets();
    await hubB.refresh();
    const replayed = openWindowOf(hubB.snapshot?.run ?? fixture.run);
    expect(replayed?.declarations[HUMAN]?.targets).toHaveLength(1);
    expect(replayed?.declarations[HUMAN]?.targets[0]?.playerVersionId).toBe(first.playerVersionId);
    hubB.destroy();
  });
  it('rejects a stale declaration with stale-state instead of double-applying', async () => {
    const fixture = hubFixture();
    const repo = hubRepo({
      run: fixture.run,
      summaries: [],
      retainedDetails: [],
      acceptedBlocks: [],
      effects: fixture.effects,
    });
    const hubA = new SeasonHubState(repo, new FakeRunner());
    hubA.catalog = fixture.catalog;
    hubA.freeAgencyIndex = fixture.index;
    hubA.freeAgencyTargets = fixtureTargets();
    await hubA.refresh();
    const hubB = new SeasonHubState(repo, new FakeRunner());
    hubB.catalog = fixture.catalog;
    hubB.freeAgencyIndex = fixture.index;
    hubB.freeAgencyTargets = fixtureTargets();
    await hubB.refresh();
    const window = openWindowOf(hubB.snapshot?.run ?? fixture.run);
    const first = window?.candidates[0];
    if (first === undefined) throw new Error('expected a window candidate');
    await hubB.declareFreeAgentInterest({
      windowIndex: 0,
      targets: [
        { playerVersionId: first.playerVersionId, roleExpectation: 'rotation', influence: 1 },
      ],
    });
    expect(hubB.commandError).toBeNull();
    hubB.destroy();
    const applyCalls = repo.applySeasonRunCommand.mock.calls.length;
    await hubA.declareFreeAgentInterest({
      windowIndex: 0,
      targets: [
        { playerVersionId: first.playerVersionId, roleExpectation: 'rotation', influence: 1 },
      ],
    });
    expect(hubA.commandError).not.toBeNull();
    expect(hubA.commandError?.message).toContain('stale');
    expect(repo.applySeasonRunCommand.mock.calls.length).toBe(applyCalls + 1);
    const applied = repo.applySeasonRunCommand.mock.calls[applyCalls]?.[0] as {
      run: SeasonRun;
    };
    expect(applied.run.stateRevision).toBe(2);
    const { handleSeasonRunCommand } = await import('@hoop-rush/engine');
    const authoritative = applied.run;
    const staleOutput = handleSeasonRunCommand(
      {
        schemaVersion: SEASON_RUN_SCHEMA_VERSION,
        command: 'declare-free-agent-interest',
        commandId: 'cmd-stale-engine',
        runId: authoritative.runId,
        expectedStateRevision: 1,
        expectedStateDigest: fixture.run.stateDigest,
        franchiseId: HUMAN,
        windowIndex: 0,
        targets: [
          { playerVersionId: first.playerVersionId, roleExpectation: 'rotation', influence: 1 },
        ],
      },
      {
        run: authoritative,
        pending: null,
        humanFranchiseId: HUMAN,
        effects: fixture.effects,
        catalog: fixture.catalog,
        freeAgencyIndex: fixture.index,
        freeAgencyTargets: fixtureTargets(),
      },
    );
    const staleEnvelope = staleOutput.result;
    if (staleEnvelope.command !== 'declare-free-agent-interest') {
      throw new Error('unexpected command envelope');
    }
    expect(staleEnvelope.result.status).toBe('rejected');
    if (staleEnvelope.result.status === 'accepted') return;
    expect(staleEnvelope.result.rejection.code).toBe('stale-state');
    hubA.destroy();
  });
  it('maps every M2.6.5 free-agency rejection code in describeCommandRejection', () => {
    const dummyFacts = (code: string): Record<string, unknown> => {
      switch (code) {
        case 'free-agency-unresolved':
          return { windowIndex: 0, blockIndex: 3 };
        case 'free-agency-window-not-open':
          return { franchiseId: HUMAN, windowIndex: 1 };
        case 'free-agency-already-resolved':
          return { windowIndex: 0 };
        case 'free-agency-already-declared':
          return { franchiseId: HUMAN, windowIndex: 0 };
        case 'free-agency-target-ineligible':
          return { windowIndex: 0, playerVersionId: 'pv-extra-00' };
        case 'free-agency-duplicate-identity':
          return { playerId: 'p-extra-00', playerVersionId: 'pv-extra-00' };
        case 'free-agency-invalid-priority':
          return { playerVersionId: 'pv-extra-00' };
        case 'free-agency-unsupported-role':
          return {
            playerVersionId: 'pv-extra-00',
            roleExpectation: 'emergency',
            supportedRoles: ['rotation'],
          };
        case 'free-agency-invalid-influence':
          return { playerVersionId: 'pv-extra-00', influence: 0, minimum: 1 };
        case 'free-agency-roster-cap':
          return { franchiseId: HUMAN, rosterSize: 15 };
        case 'free-agency-season-signing-cap':
          return { franchiseId: HUMAN, signingCount: 3 };
        case 'free-agency-season-influence-cap':
          return { franchiseId: HUMAN, seasonSpend: 6 };
        case 'free-agency-insufficient-balance':
          return { franchiseId: HUMAN, balance: 0, required: 2 };
        case 'free-agency-pending-declaration':
          return { franchiseId: HUMAN, windowIndex: 0 };
        case 'free-agency-ownership-conflict':
          return { franchiseId: HUMAN, playerVersionId: 'pv-extra-00', reason: 'test reason' };
        default:
          return {};
      }
    };
    const codes = [
      'free-agency-unresolved',
      'free-agency-window-not-open',
      'free-agency-already-resolved',
      'free-agency-already-declared',
      'free-agency-target-ineligible',
      'free-agency-duplicate-identity',
      'free-agency-invalid-priority',
      'free-agency-unsupported-role',
      'free-agency-invalid-influence',
      'free-agency-roster-cap',
      'free-agency-season-signing-cap',
      'free-agency-season-influence-cap',
      'free-agency-insufficient-balance',
      'free-agency-pending-declaration',
      'free-agency-ownership-conflict',
    ] as const;
    for (const code of codes) {
      const message = describeCommandRejection('declare-free-agent-interest', {
        code,
        ...dummyFacts(code),
      } as never);
      expect(message.length).toBeGreaterThan(10);
    }
    const unresolved = describeCommandRejection('declare-free-agent-interest', {
      code: 'free-agency-unresolved',
      windowIndex: 0,
      blockIndex: 3,
    } as never);
    expect(unresolved).toContain('window 1');
    expect(unresolved).toContain('/season/run/free-agency');
  });
});
describe('block-submit gating (free-agency-unresolved)', () => {
  function gatingRun(fixture: HubFixture): SeasonRun {
    const base = fixture.run;
    return {
      ...base,
      objectives: {
        ...base.objectives,
        selections: {
          3: { objectiveId: 'win-six' as const, selectedByCommandId: 'cmd-obj-3', success: null },
        },
      },
    };
  }
  function gatingShell(run: SeasonRun, effects: SeasonEffectsState): SeasonRunShellData {
    return {
      snapshot: { run, summaries: [], retainedDetails: [], acceptedBlocks: [], effects },
      run,
      humanFranchiseId: HUMAN,
      nextBlockIndex: 3,
      block: { phase: 'idle' },
      editor: {
        validate: () => [],
        rotation: run.rotations.find((rotation) => rotation.franchiseId === HUMAN),
      },
      objectives: run.objectives,
    } as unknown as SeasonRunShellData;
  }
  it('refuses to build a submit envelope while a market window is open', async () => {
    const fixture = hubFixture();
    const window = openWindowOf(fixture.run);
    if (window === null) throw new Error('expected an open window');
    const run = gatingRun(fixture);
    const result = await buildSubmitBlockEnvelope(gatingShell(run, fixture.effects));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.code).toBe('free-agency-unresolved');
    expect(result.error.message).toContain('window 1');
    expect(result.error.message).toContain('/season/run/free-agency');
  });
  it('does not gate submission once the window is resolved', async () => {
    const fixture = hubFixture();
    const base = gatingRun(fixture);
    const run: SeasonRun = {
      ...base,
      freeAgency: {
        ...base.freeAgency,
        windows: base.freeAgency.windows.map((entry) =>
          entry.windowIndex === 0 ? { ...entry, status: 'resolved' } : entry,
        ),
      },
    };
    const result = await buildSubmitBlockEnvelope(gatingShell(run, fixture.effects));
    if (result.ok) {
      expect(result.envelope.command.blockIndex).toBe(3);
      return;
    }
    expect(result.error.code).not.toBe('free-agency-unresolved');
  });
});
