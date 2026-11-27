import { expect, mock, test } from 'bun:test';
import {
  commandIdSchema,
  fullCourtCreateDraftCommandSchema,
  fullCourtPickPlayerCommandSchema,
  fullCourtPurchaseReportCommandSchema,
  seedSchema,
  type FullCourtCommandResult,
  type FullCourtDraftState,
} from '@hoop-rush/data-contracts';
import {
  applyFullCourtCommand,
  createFullCourtDraftState,
  fullCourtDraftIndexOf,
} from '@hoop-rush/engine';
import type { FullCourtPurchasePhase } from '@hoop-rush/engine';
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

const PURCHASE_CATALOG = buildCapRushTestCatalog({ overalls: [70, 71, 72, 73, 74, 75] });
const PURCHASE_SOURCE = capRushTestCatalogSource(PURCHASE_CATALOG);
const PURCHASE_INDEX = fullCourtDraftIndexOf(PURCHASE_CATALOG, PURCHASE_SOURCE);

function confirmedDraftState(runId: string): FullCourtDraftState {
  let draft = createFullCourtDraftState(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse(`create-${runId}`),
      runId,
      runSeed: seedSchema.parse('a'.repeat(32)),
      variant: 'standard',
      catalog: PURCHASE_SOURCE,
    }),
    PURCHASE_INDEX,
  );
  for (const candidate of PURCHASE_CATALOG.candidates.filter(
    (player) => player.positions.primary === 'PG',
  )) {
    draft = applyFullCourtCommand(
      draft,
      {
        command: 'pick-full-court-player',
        commandId: commandIdSchema.parse(`pick-${runId}-${String(draft.revision)}`),
        runId: draft.runId,
        expectedRevision: draft.revision,
        playerVersionId: candidate.playerVersionId,
      },
      { index: PURCHASE_INDEX },
    ).state;
  }
  const finished = applyFullCourtCommand(
    draft,
    {
      command: 'finish-full-court-draft',
      commandId: commandIdSchema.parse(`finish-${runId}`),
      runId: draft.runId,
      expectedRevision: draft.revision,
    },
    { index: PURCHASE_INDEX },
  );
  if (finished.result.status !== 'accepted') throw new Error('Test draft did not confirm');
  return finished.state;
}

function purchaseCommand(state: FullCourtDraftState) {
  return fullCourtPurchaseReportCommandSchema.parse({
    command: 'purchase-full-court-report',
    commandId: `camp-${state.runId}`,
    runId: state.runId,
    expectedRevision: state.revision,
    target: { kind: 'training-camp' },
  });
}

/** Mirrors the Dexie repository: the guard runs inside commit, before any write. */
function guardedRepository(state: FullCourtDraftState, phase: FullCourtPurchasePhase) {
  let receipt: FullCourtCommandResult | null = null;
  return {
    load: mock(() => Promise.resolve(state)),
    getReceipt: mock(() => Promise.resolve(receipt)),
    commit: mock<FullCourtDraftRepository['commit']>((_command, _state, result, options) => {
      const blocked = options?.guard?.(phase) ?? null;
      if (blocked !== null) return Promise.resolve(blocked);
      receipt = result;
      return Promise.resolve(result);
    }),
  } satisfies FullCourtDraftRepository;
}

test('refuses an accepted purchase when the durable phase already closed', async () => {
  const state = confirmedDraftState('application-purchase-closed');
  const command = purchaseCommand(state);
  const repository = guardedRepository(state, {
    completedThroughSlot: 1,
    postseasonStarted: false,
    playedGameIds: new Set<string>(),
  });

  const rejected = await submitFullCourtDraftCommand(command, {
    repository,
    index: PURCHASE_INDEX,
  });
  expect(rejected.status).toBe('rejected');
  expect(rejected.rejection?.code).toBe('report-unavailable');
  expect(rejected.rejection?.message).toBe(
    'Training camp closes before the first regular-season game.',
  );
  expect(repository.commit).toHaveBeenCalledTimes(1);
  expect(repository.getReceipt).toHaveBeenCalledTimes(1);
  expect(await submitFullCourtDraftCommand(command, { repository, index: PURCHASE_INDEX })).toEqual(
    rejected,
  );
  expect(repository.commit).toHaveBeenCalledTimes(2);
});

test('keeps an accepted purchase receipt once the durable phase closes', async () => {
  const state = confirmedDraftState('application-purchase-first');
  const command = purchaseCommand(state);
  const repository = guardedRepository(state, {
    completedThroughSlot: 0,
    postseasonStarted: false,
    playedGameIds: new Set<string>(),
  });
  const accepted = await submitFullCourtDraftCommand(command, {
    repository,
    index: PURCHASE_INDEX,
  });
  expect(accepted.status).toBe('accepted');
  expect(accepted.rejection).toBeNull();
  expect(repository.commit).toHaveBeenCalledTimes(1);

  expect(await submitFullCourtDraftCommand(command, { repository, index: PURCHASE_INDEX })).toEqual(
    accepted,
  );
  expect(repository.commit).toHaveBeenCalledTimes(1);
});

test('creates new drafts with a deterministic seeded pool through the application entry point', async () => {
  const catalog = buildCapRushTestCatalog();
  const source = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, source);
  const create = fullCourtCreateDraftCommandSchema.parse({
    command: 'create-full-court-draft',
    commandId: 'create-pooled',
    runId: 'application-pooled-draft',
    runSeed: '0123456789abcdef',
    variant: 'standard',
    catalog: source,
  });
  let committedState = null as FullCourtDraftState | null;
  const repository = {
    load: mock(() => Promise.resolve(committedState)),
    getReceipt: mock(() => Promise.resolve(null)),
    commit: mock<FullCourtDraftRepository['commit']>((_, state, result) => {
      committedState = state;
      return Promise.resolve(result);
    }),
  } satisfies FullCourtDraftRepository;

  const result = await submitFullCourtDraftCommand(create, { repository, index });
  expect(result.status).toBe('accepted');
  expect(committedState?.pool).toBeDefined();
  expect(committedState?.pool?.playerVersionIds.length).toBeGreaterThanOrEqual(60);
  expect(committedState?.pool?.playerVersionIds.length).toBeLessThanOrEqual(90);
});
