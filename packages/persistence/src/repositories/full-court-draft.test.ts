import { afterEach, expect, test } from 'bun:test';
import {
  FULL_COURT_DRAFT_SCHEMA_VERSION,
  commandIdSchema,
  fullCourtCreateDraftCommandSchema,
  fullCourtPickPlayerCommandSchema,
  idSchema,
  seedSchema,
  type FullCourtCommandResult,
} from '@hoop-rush/data-contracts';
import {
  applyFullCourtCommand,
  createFullCourtDraftState,
  fullCourtDraftIndexOf,
  fullCourtStateDigest,
} from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import {
  openTestDatabasePair,
  resetIndexedDb,
  restoreIndexedDb,
} from '../testing/repo-test-support.ts';
import { DexieFullCourtDraftRepository } from './full-court-draft.ts';

afterEach(restoreIndexedDb);

test('reopens a draft and serializes competing writes without charging a replay twice', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court');
  try {
    const repository = new DexieFullCourtDraftRepository(first);
    const catalog = buildCapRushTestCatalog({ overalls: [70, 72] });
    const source = capRushTestCatalogSource(catalog);
    const index = fullCourtDraftIndexOf(catalog, source);
    const create = fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse('create'),
      runId: idSchema.parse('full-court-run'),
      runSeed: seedSchema.parse('0123456789abcdef'),
      variant: 'standard',
      catalog: source,
    });
    const draft = createFullCourtDraftState(create, index);
    const created: FullCourtCommandResult = {
      schemaVersion: FULL_COURT_DRAFT_SCHEMA_VERSION,
      runId: create.runId,
      commandId: create.commandId,
      revisionBefore: 0,
      revisionAfter: draft.revision,
      status: 'accepted',
      stateDigest: fullCourtStateDigest(draft),
      rejection: null,
    };
    await repository.commit(create, draft, created);

    const [firstPlayer, secondPlayer] = catalog.candidates;
    if (firstPlayer === undefined || secondPlayer === undefined)
      throw new Error('Missing draft candidates');
    const pick = fullCourtPickPlayerCommandSchema.parse({
      command: 'pick-full-court-player',
      runId: create.runId,
      commandId: 'pick-one',
      expectedRevision: draft.revision,
      playerVersionId: firstPlayer.playerVersionId,
    });
    const sameRevision = {
      ...pick,
      commandId: commandIdSchema.parse('pick-two'),
      playerVersionId: secondPlayer.playerVersionId,
    };
    const firstPick = applyFullCourtCommand(draft, pick, { index });
    const secondPick = applyFullCourtCommand(draft, sameRevision, { index });
    const other = new DexieFullCourtDraftRepository(second);
    const writes = await Promise.allSettled([
      repository.commit(pick, firstPick.state, firstPick.result),
      other.commit(sameRevision, secondPick.state, secondPick.result),
    ]);
    expect(writes.map((write) => write.status).sort()).toEqual(['fulfilled', 'rejected']);
    const winning = writes[0].status === 'fulfilled' ? firstPick : secondPick;
    const winningCommand = writes[0].status === 'fulfilled' ? pick : sameRevision;
    first.close();
    expect(await other.load(create.runId)).toEqual(winning.state);
    expect(await other.commit(winningCommand, winning.state, winning.result)).toEqual(
      winning.result,
    );
    await expect(other.getReceipt({ ...winningCommand, expectedRevision: 0 })).rejects.toThrow(
      'reused with a different payload',
    );
    expect(await second.fullCourtDraftCommands.count()).toBe(2);
    expect((await other.load(create.runId))?.spending).toHaveLength(1);

    const stale = {
      ...winningCommand,
      commandId: commandIdSchema.parse('stale'),
      expectedRevision: draft.revision,
    };
    const rejected = applyFullCourtCommand(winning.state, stale, { index });
    expect(rejected.result.rejection?.code).toBe('stale-revision');
    expect(await other.commit(stale, rejected.state, rejected.result)).toEqual(rejected.result);
    expect(await other.getReceipt(stale)).toEqual(rejected.result);
    await expect(
      other.getReceipt({ ...stale, expectedRevision: winning.state.revision }),
    ).rejects.toThrow('reused with a different payload');
    expect(await other.load(create.runId)).toEqual(winning.state);

    const stored = await second.fullCourtDrafts.get(create.runId);
    if (stored === undefined) throw new Error('Missing committed draft');
    const wrongSalary = {
      ...stored.state,
      picks: stored.state.picks.map((pick) => ({ ...pick, salaryDollars: 1 })),
      spending: stored.state.spending.map((charge) => ({ ...charge, dollars: 1 })),
    };
    await second.fullCourtDrafts.put({
      ...stored,
      state: wrongSalary,
      stateDigest: fullCourtStateDigest(wrongSalary),
    });
    await expect(other.load(create.runId)).rejects.toThrow(
      'roster salary differs from the salary curve',
    );

    await second.table('fullCourtDrafts').put({ ...stored, saveSchemaVersion: 99 });
    await expect(other.load(create.runId)).rejects.toThrow('stored save schema 99');

    await second.fullCourtDrafts.put({
      ...stored,
      state: { ...stored.state, runId: idSchema.parse('other-run') },
    });
    await expect(other.load(create.runId)).rejects.toThrow('Draft run ID differs from its key');

    await second.fullCourtDrafts.put({
      ...stored,
      state: { ...stored.state, runSeed: seedSchema.parse('fedcba9876543210') },
    });
    await expect(other.load(create.runId)).rejects.toThrow('draft digest differs from its state');
  } finally {
    first.close();
    second.close();
  }
});
