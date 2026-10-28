import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  CAP_RUSH_RULES_VERSION,
  CAP_RUSH_SALARY_CURVE_VERSION,
  CAP_RUSH_SAVE_SCHEMA_VERSION,
  CAP_RUSH_SCHEMA_VERSION,
  CAP_RUSH_SEED_DERIVATION_VERSION,
  capRushChoosePositionCommandSchema,
  capRushCommandResultSchema,
  capRushCreateDraftCommandSchema,
  capRushVersionSetSchema,
  commandIdSchema,
  idSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  ENGINE_VERSION,
  adaptCapRushCatalog,
  buildCapRushCatalogIndex,
  capRushStateDigest,
  createCapRushDraftState,
} from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import {
  CAP_RUSH_ACTIVE_DRAFT_RECORD_ID,
  storedCapRushDraftRowSchema,
} from '../schemas/cap-rush-record.ts';
import {
  CapRushCommandConflictError,
  CapRushLoadError,
  CapRushStaleRevisionError,
  DexieCapRushRepository,
} from './cap-rush.ts';
import { HoopRushDatabase } from './dexie.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
} from '../testing/repo-test-support.ts';

function setup() {
  const catalog = buildCapRushTestCatalog();
  const source = capRushTestCatalogSource(catalog);
  const index = buildCapRushCatalogIndex(adaptCapRushCatalog(catalog, source));
  const versionSet = capRushVersionSetSchema.parse({
    schemaVersion: CAP_RUSH_SCHEMA_VERSION,
    rulesVersion: CAP_RUSH_RULES_VERSION,
    salaryCurveVersion: CAP_RUSH_SALARY_CURVE_VERSION,
    seedDerivationVersion: CAP_RUSH_SEED_DERIVATION_VERSION,
    engineVersion: ENGINE_VERSION,
    profileVersion: 'test-profile-v1',
    dataVersion: source.dataVersion,
    catalogVersion: source.catalogVersion,
    catalogHash: source.catalogHash,
    bracketHash: 'b'.repeat(64),
    profileHash: 'c'.repeat(64),
  });
  const command = capRushCreateDraftCommandSchema.parse({
    command: 'create-cap-rush-draft',
    commandId: commandIdSchema.parse('cmd-create'),
    runId: idSchema.parse('run-test'),
    runSeed: seedSchema.parse('abc123def4567890'),
    variant: 'clash',
    versionSet,
    catalog: source,
  });
  const state = createCapRushDraftState(command, index);
  const result = capRushCommandResultSchema.parse({
    schemaVersion: CAP_RUSH_SCHEMA_VERSION,
    commandId: command.commandId,
    runId: state.runId,
    status: 'accepted',
    revisionBefore: 0,
    revisionAfter: state.revision,
    stateDigest: capRushStateDigest(state),
    rejection: null,
  });
  return { index, command, state, result };
}

let db: HoopRushDatabase;
let repository: DexieCapRushRepository;

beforeEach(() => {
  resetIndexedDb();
  db = new HoopRushDatabase(testDatabaseName('cap-rush'));
  repository = new DexieCapRushRepository(db);
});

afterEach(() => {
  db.close();
  restoreIndexedDb();
});

describe('cap rush repository', () => {
  it('persists the created draft and resumes it', async () => {
    const { command, state, result } = setup();
    await repository.applyOutcome({ outcome: { state, result }, command });
    expect(await repository.loadActiveDraft()).toEqual(state);
    expect(await repository.loadCommandResult(command.commandId)).toEqual(result);
  });

  it('keeps the same receipt for a duplicate command id', async () => {
    const { command, state, result } = setup();
    await repository.applyOutcome({ outcome: { state, result }, command });
    const duplicate = await repository.applyOutcome({ outcome: { state, result }, command });
    expect(duplicate).toEqual(result);
    expect(await db.capRushCommands.count()).toBe(1);
  });

  it('rejects reusing a command id with different content', async () => {
    const { command, state, result } = setup();
    await repository.applyOutcome({ outcome: { state, result }, command });
    const choose = capRushChoosePositionCommandSchema.parse({
      command: 'choose-cap-rush-position',
      commandId: command.commandId,
      runId: state.runId,
      expectedRevision: state.revision,
      slot: 'PG',
    });
    const outcome = {
      state,
      result: capRushCommandResultSchema.parse({
        ...result,
        revisionBefore: state.revision,
        revisionAfter: state.revision,
        status: 'rejected',
        rejection: { code: 'phase-mismatch', message: 'test' },
      }),
    };
    await expect(repository.applyOutcome({ outcome, command: choose })).rejects.toBeInstanceOf(
      CapRushCommandConflictError,
    );
  });

  it('rejects a stale revision without changing the draft', async () => {
    const { command, state, result } = setup();
    await repository.applyOutcome({ outcome: { state, result }, command });
    const choose = capRushChoosePositionCommandSchema.parse({
      command: 'choose-cap-rush-position',
      commandId: commandIdSchema.parse('cmd-choose'),
      runId: state.runId,
      expectedRevision: 0,
      slot: 'PG',
    });
    const stale = {
      state,
      result: capRushCommandResultSchema.parse({
        ...result,
        commandId: choose.commandId,
        revisionBefore: 0,
        revisionAfter: state.revision,
        status: 'accepted',
        rejection: null,
      }),
    };
    await expect(
      repository.applyOutcome({ outcome: stale, command: choose }),
    ).rejects.toBeInstanceOf(CapRushStaleRevisionError);
    expect(await repository.loadActiveDraft()).toEqual(state);
  });

  it('clears the active draft and its command receipts', async () => {
    const { command, state, result } = setup();
    await repository.applyOutcome({ outcome: { state, result }, command });
    await repository.clearActiveDraft();
    expect(await repository.loadActiveDraft()).toBeNull();
    expect(await db.capRushCommands.count()).toBe(0);
  });

  it('rejects a stored draft whose digest does not match', async () => {
    const { state } = setup();
    const row = storedCapRushDraftRowSchema.parse({
      saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
      recordId: CAP_RUSH_ACTIVE_DRAFT_RECORD_ID,
      runId: state.runId,
      revision: state.revision,
      stateDigest: '0'.repeat(32),
      draft: state,
      createdAtIso: '2026-01-01T00:00:00.000Z',
      updatedAtIso: '2026-01-01T00:00:00.000Z',
    });
    await db.capRushActive.put(row);
    await expect(repository.loadActiveDraft()).rejects.toBeInstanceOf(CapRushLoadError);
  });

  it('reports an unsupported stored save schema version', async () => {
    await db.capRushActive.put({
      saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION + 1,
      recordId: CAP_RUSH_ACTIVE_DRAFT_RECORD_ID,
      runId: 'run-test',
      revision: 1,
      stateDigest: '0'.repeat(32),
      draft: {},
      createdAtIso: '2026-01-01T00:00:00.000Z',
      updatedAtIso: '2026-01-01T00:00:00.000Z',
    } as never);
    await expect(repository.loadActiveDraft()).rejects.toMatchObject({
      code: 'unsupported',
    });
  });
});
