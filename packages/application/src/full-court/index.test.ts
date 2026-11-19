import { expect, mock, test } from 'bun:test';
import {
  fullCourtCreateDraftCommandSchema,
  fullCourtPickPlayerCommandSchema,
  type FullCourtCommandResult,
} from '@hoop-rush/data-contracts';
import { createFullCourtDraftState, fullCourtDraftIndexOf } from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { submitFullCourtDraftCommand, type FullCourtDraftRepository } from './index.ts';

test('stores a rejected attempt and returns its receipt on retry', async () => {
  const catalog = buildCapRushTestCatalog({ overalls: [70, 72] });
  const source = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, source);
  const create = fullCourtCreateDraftCommandSchema.parse({
    command: 'create-full-court-draft',
    commandId: 'create',
    runId: 'application-draft',
    runSeed: '0123456789abcdef',
    variant: 'standard',
    catalog: source,
  });
  const state = createFullCourtDraftState(create, index);
  const command = fullCourtPickPlayerCommandSchema.parse({
    command: 'pick-full-court-player',
    commandId: 'stale',
    runId: state.runId,
    expectedRevision: 0,
    playerVersionId: catalog.candidates[0]?.playerVersionId,
  });
  let receipt: FullCourtCommandResult | null = null;
  const repository = {
    load: mock(() => Promise.resolve(state)),
    getReceipt: mock(() => Promise.resolve(receipt)),
    commit: mock<FullCourtDraftRepository['commit']>((_, __, result) => {
      receipt = result;
      return Promise.resolve(result);
    }),
  } satisfies FullCourtDraftRepository;

  const rejected = await submitFullCourtDraftCommand(command, { repository, index });
  expect(rejected.rejection?.code).toBe('stale-revision');
  expect(repository.commit).toHaveBeenCalledWith(command, state, rejected);
  expect(await submitFullCourtDraftCommand(command, { repository, index })).toEqual(rejected);
  expect(repository.load).toHaveBeenCalledTimes(1);
  expect(repository.commit).toHaveBeenCalledTimes(1);
});
