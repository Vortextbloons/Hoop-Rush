import { describe, expect, it } from 'vitest';
import Dexie, { type EntityTable, type Table } from 'dexie';
import { IDBFactory } from 'fake-indexeddb';
import {
  buildChallengeRun,
  buildClassicDraftState,
  buildFixtureEvaluations,
  buildSeasonAiAssignments,
  buildSeasonDraftState,
  buildSeasonLeague,
  buildSeasonRosters,
  buildSeasonRotation,
  fixtureGenerationDigest,
} from '@hoop-rush/test-fixtures';
import {
  SEASON_AI_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROTATION_VERSION,
  seasonDraftStateSchema,
  type SeasonDraftCommandRecord,
  type SeasonLeagueGenerationResult,
} from '@hoop-rush/data-contracts';
import { DexieChallengeRepository } from './dexie.js';
import { DexieSeasonDraftRepository } from './season-draft.js';
import {
  recordFromState,
  SEASON_DRAFT_RECORD_ID,
  type StoredSeasonDraft,
} from '../schemas/season-draft-record.js';
import type { StoredClassicDraft } from '../schemas/classic-draft-record.js';
import type {
  ActiveGameRow,
  ActiveRunCheckpoint,
  CompletedRunIndex,
  StoredRunRecord,
} from '../schemas/run-record.js';

/**
 * Season draft repository contract tests (spec/2.0/03, M2.1): the dedicated
 * Season draft boundary lives in its own `seasonDrafts` table, isolated from
 * the Challenge tables and the Classic draft table. Save stores the full
 * revisioned snapshot with the complete command log in one atomic put; load
 * validates every read and resumes at the exact last-saved revision; corrupt
 * rows throw instead of entering app state. Dexie tests run against
 * fake-indexeddb with one fresh database per test.
 */

/** Replaces the shared fake-indexeddb factory, isolating Dexie versioning. */
function resetIndexedDb(): void {
  const factory = new IDBFactory();
  globalThis.indexedDB = factory;
  Dexie.dependencies.indexedDB = factory;
}

class TestDatabase extends Dexie {
  active!: EntityTable<ActiveRunCheckpoint, 'recordId'>;
  activeGames!: Table<ActiveGameRow, [string, number]>;
  completed!: EntityTable<StoredRunRecord, 'recordId'>;
  history!: EntityTable<CompletedRunIndex, 'recordId'>;
  classicDrafts!: EntityTable<StoredClassicDraft, 'recordId'>;
  seasonDrafts!: EntityTable<StoredSeasonDraft, 'recordId'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ active: 'recordId', completed: 'recordId', history: 'recordId' });
    this.version(2).stores({
      active: 'recordId',
      activeGames: '[runId+gameNumber], runId',
      completed: 'recordId',
      history: 'recordId',
    });
    this.version(3).stores({
      history: 'recordId, completedAtIso',
    });
    this.version(4).stores({
      classicDrafts: 'recordId',
    });
    this.version(5).stores({
      seasonDrafts: 'recordId',
    });
  }
}

interface Adapters {
  season: DexieSeasonDraftRepository;
  challenge: DexieChallengeRepository;
  db: TestDatabase;
}

/** Fresh Dexie-backed repositories with one isolated database per test. */
function makeAdapter(): Adapters {
  const db = new TestDatabase(`test-${String(Math.random())}`);
  return {
    season: new DexieSeasonDraftRepository(db),
    challenge: new DexieChallengeRepository(db),
    db,
  };
}

function runRecord(runId = 'challenge-run-1'): StoredRunRecord {
  return {
    recordId: 'active',
    saveSchemaVersion: 2,
    run: buildChallengeRun({ runId, status: 'active', firstLossGameNumber: null }),
  };
}

function classicRecord(draftId = 'classic-draft-a'): StoredClassicDraft {
  return {
    recordId: 'classic-draft',
    saveSchemaVersion: 1,
    draft: buildClassicDraftState({ draftId }),
  };
}

/** Schema-valid synthetic 30-team generation result for round-trip fixtures. */
function generationResult(seed: string): SeasonLeagueGenerationResult {
  const league = buildSeasonLeague();
  const rosters = buildSeasonRosters(league, seed);
  const aiAssignments = buildSeasonAiAssignments(league);
  const rotations = rosters.map((roster) =>
    buildSeasonRotation(
      roster.franchiseId,
      roster.players.map((player) => player.playerVersionId),
    ),
  );
  return {
    schemaVersion: 1,
    seed,
    aiVersion: SEASON_AI_VERSION,
    rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
    rotationVersion: SEASON_ROTATION_VERSION,
    rosters,
    ownership: rosters.flatMap((roster) =>
      roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        ownerFranchiseId: roster.franchiseId,
      })),
    ),
    rotations,
    aiAssignments,
    evaluations: buildFixtureEvaluations(rosters, aiAssignments),
    diagnostics: {
      seed,
      aiVersion: SEASON_AI_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      teamsGenerated: 30,
      teamsRepaired: 0,
      backtracks: 0,
      nodesVisited: 30,
      nodeBudget: 100000,
      failedTeams: [],
      unmetConstraints: [],
    },
    digest: fixtureGenerationDigest(`generation-${seed}`),
  };
}

/** The saved record without the adapter-stamped timestamp. */
function withoutTimestamp(loaded: StoredSeasonDraft): StoredSeasonDraft {
  const { updatedAtIso: _updatedAtIso, ...record } = loaded;
  return record;
}

describe('season draft repository (dexie)', () => {
  it('opens the v5 database with the seasonDrafts table and keeps the challenge repo working', async () => {
    const { season, challenge, db } = makeAdapter();
    expect(db.tables.map((table) => table.name)).toContain('seasonDrafts');
    await season.saveSeasonDraft(recordFromState(buildSeasonDraftState()));
    await challenge.saveActiveRun(runRecord());
    const loaded = await season.loadSeasonDraft();
    expect(loaded?.draft.runId).toBe('fixture-draft-1');
    expect(await db.seasonDrafts.count()).toBe(1);
    expect((await challenge.loadActiveRun())?.run.runId).toBe('challenge-run-1');
  });

  it('saves and reloads a mid-draft state with null generation', async () => {
    const { season } = makeAdapter();
    const saved = recordFromState(buildSeasonDraftState());
    await season.saveSeasonDraft(saved);
    const loaded = await season.loadSeasonDraft();
    expect(loaded).not.toBeNull();
    expect(withoutTimestamp(loaded as StoredSeasonDraft)).toEqual(saved);
    expect(loaded?.updatedAtIso).toBeDefined();
  });

  it('returns null when no season draft exists', async () => {
    const { season } = makeAdapter();
    expect(await season.loadSeasonDraft()).toBeNull();
  });

  it('persists rejected command log entries without bumping the revision', async () => {
    const { season } = makeAdapter();
    const base = buildSeasonDraftState();
    const rejected: SeasonDraftCommandRecord = {
      status: 'rejected',
      commandId: 'c-reveal-stale',
      revision: base.revision,
      errorCode: 'STALE_REVISION',
      message: 'expected revision 3, got 99',
      command: {
        commandId: 'c-reveal-stale',
        expectedRevision: 99,
        payload: { kind: 'reveal-draft-roll', participantId: 'human-2' },
      },
    };
    const state = seasonDraftStateSchema.parse({
      ...base,
      commandLog: [...base.commandLog, rejected],
    });
    await season.saveSeasonDraft(recordFromState(state));
    const loaded = await season.loadSeasonDraft();
    expect(loaded?.draft.revision).toBe(state.revision);
    expect(loaded?.draft.commandLog).toEqual(state.commandLog);
    const last = loaded?.draft.commandLog.at(-1);
    expect(last).toEqual(rejected);
  });

  it('reloads the exact last saved revision after an interrupted save', async () => {
    const { season } = makeAdapter();
    const saved = recordFromState(buildSeasonDraftState({ revision: 3 }));
    await season.saveSeasonDraft(saved);
    // The domain accepted a fourth command, but the process crashed before
    // the rev-4 snapshot was persisted. Reload must resume at rev 3 exactly.
    const loaded = await season.loadSeasonDraft();
    expect(loaded).not.toBeNull();
    expect(loaded?.draft.revision).toBe(3);
    expect(withoutTimestamp(loaded as StoredSeasonDraft)).toEqual(saved);
  });

  it('round trips a completed generation state', async () => {
    const { season } = makeAdapter();
    const seed = buildSeasonDraftState().rootSeed;
    const generation = generationResult(seed);
    const saved = recordFromState(buildSeasonDraftState(), generation);
    await season.saveSeasonDraft(saved);
    const loaded = await season.loadSeasonDraft();
    expect(loaded).not.toBeNull();
    expect(loaded?.generation).toEqual(generation);
    expect(loaded?.generation?.rosters).toHaveLength(30);
    expect(loaded?.generation?.ownership).toHaveLength(300);
    expect(withoutTimestamp(loaded as StoredSeasonDraft)).toEqual(saved);
  });

  it('surfaces corrupt stored rows instead of returning them', async () => {
    const { season, db } = makeAdapter();
    await season.saveSeasonDraft(recordFromState(buildSeasonDraftState()));
    await db.seasonDrafts.put({
      recordId: SEASON_DRAFT_RECORD_ID,
      saveSchemaVersion: 99,
      draft: buildSeasonDraftState(),
      generation: null,
    } as never);
    await expect(season.loadSeasonDraft()).rejects.toThrow();
    await db.seasonDrafts.put({
      recordId: SEASON_DRAFT_RECORD_ID,
      saveSchemaVersion: 1,
      draft: { corrupted: true },
      generation: null,
    } as never);
    await expect(season.loadSeasonDraft()).rejects.toThrow();
  });

  it('never returns a row with the wrong recordId as the active draft', async () => {
    const { season, db } = makeAdapter();
    await db.seasonDrafts.put({
      recordId: 'other-draft',
      saveSchemaVersion: 1,
      draft: buildSeasonDraftState(),
      generation: null,
    } as never);
    expect(await season.loadSeasonDraft()).toBeNull();
  });

  it('saving and clearing a season draft never touches challenge tables', async () => {
    const { season, db } = makeAdapter();
    await season.saveSeasonDraft(recordFromState(buildSeasonDraftState()));
    expect(await db.classicDrafts.count()).toBe(0);
    expect(await db.active.count()).toBe(0);
    expect(await db.activeGames.count()).toBe(0);
    expect(await db.completed.count()).toBe(0);
    expect(await db.history.count()).toBe(0);
    await season.clearSeasonDraft();
    expect(await db.seasonDrafts.count()).toBe(0);
    expect(await db.classicDrafts.count()).toBe(0);
    expect(await db.active.count()).toBe(0);
    expect(await db.activeGames.count()).toBe(0);
    expect(await db.completed.count()).toBe(0);
    expect(await db.history.count()).toBe(0);
  });

  it('challenge repository writes do not disturb the season draft row', async () => {
    const { season, challenge, db } = makeAdapter();
    const saved = recordFromState(buildSeasonDraftState());
    await season.saveSeasonDraft(saved);
    await challenge.saveClassicDraft(classicRecord());
    await challenge.saveActiveRun(runRecord());
    await challenge.clearClassicDraft();
    await challenge.clearActiveRun();
    const loaded = await season.loadSeasonDraft();
    expect(loaded).not.toBeNull();
    expect(withoutTimestamp(loaded as StoredSeasonDraft)).toEqual(saved);
    expect(await db.seasonDrafts.count()).toBe(1);
  });

  it('clears the season draft; a second clear is a no-op', async () => {
    const { season, db } = makeAdapter();
    await season.saveSeasonDraft(recordFromState(buildSeasonDraftState()));
    await season.clearSeasonDraft();
    expect(await season.loadSeasonDraft()).toBeNull();
    expect(await db.seasonDrafts.count()).toBe(0);
    await season.clearSeasonDraft();
    expect(await season.loadSeasonDraft()).toBeNull();
  });

  it('the latest save replaces the previous one', async () => {
    const { season, db } = makeAdapter();
    await season.saveSeasonDraft(recordFromState(buildSeasonDraftState({ revision: 3 })));
    await season.saveSeasonDraft(recordFromState(buildSeasonDraftState({ revision: 4 })));
    expect((await season.loadSeasonDraft())?.draft.revision).toBe(4);
    expect(await db.seasonDrafts.count()).toBe(1);
  });
});

describe('dexie season draft migration', () => {
  it('opens a v4-era save at schema version 5 and keeps existing rows intact', async () => {
    resetIndexedDb();
    const legacyDb = new Dexie('hoop-rush-saves');
    legacyDb.version(1).stores({ active: 'recordId', completed: 'recordId', history: 'recordId' });
    legacyDb.version(2).stores({
      active: 'recordId',
      activeGames: '[runId+gameNumber], runId',
      completed: 'recordId',
      history: 'recordId',
    });
    legacyDb.version(3).stores({
      history: 'recordId, completedAtIso',
    });
    legacyDb.version(4).stores({
      classicDrafts: 'recordId',
    });
    await legacyDb.open();
    await legacyDb.table('classicDrafts').put({
      recordId: 'classic-draft',
      saveSchemaVersion: 1,
      draft: buildClassicDraftState({ draftId: 'draft-v4' }),
    });
    legacyDb.close();

    const season = new DexieSeasonDraftRepository();
    const challenge = new DexieChallengeRepository();
    expect((await challenge.loadClassicDraft())?.draft.draftId).toBe('draft-v4');
    expect(await season.loadSeasonDraft()).toBeNull();
    await season.saveSeasonDraft(recordFromState(buildSeasonDraftState({ revision: 1 })));
    expect((await season.loadSeasonDraft())?.draft.revision).toBe(1);
  });
});
