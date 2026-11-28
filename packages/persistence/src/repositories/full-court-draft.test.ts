import { afterEach, expect, test } from 'bun:test';
import {
  CAP_RUSH_TAKEOVER_TEAMS,
  FULL_COURT_DRAFT_SCHEMA_VERSION,
  FULL_COURT_HEALTH_VERSION,
  FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
  canonicalJson,
  capRushLeagueGameId,
  commandIdSchema,
  fullCourtCreateDraftCommandSchema,
  fullCourtDraftStateSchema,
  fullCourtPickPlayerCommandSchema,
  fullCourtPurchaseReportCommandSchema,
  idSchema,
  seedSchema,
  seasonDigestHex,
  type FullCourtCommandResult,
  type FullCourtDraftState,
} from '@hoop-rush/data-contracts';
import {
  applyFullCourtCommand,
  createFullCourtDraftState,
  fullCourtDraftIndexOf,
  fullCourtPurchasePhaseRejection,
  fullCourtStateDigest,
} from '@hoop-rush/engine';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import {
  openTestDatabasePair,
  resetIndexedDb,
  restoreIndexedDb,
} from '../testing/repo-test-support.ts';
import type { HoopRushDatabase } from './dexie.ts';
import { DexieFullCourtDraftRepository } from './full-court-draft.ts';
import type { StoredFullCourtSeasonCheckpoint } from '../schemas/full-court-season-record.ts';

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
    const { reports, ...previousState } = stored.state;
    expect(reports).toBeUndefined();
    await second.table('fullCourtDrafts').put({
      ...stored,
      state: previousState,
      stateDigest: seasonDigestHex(
        `full-court-draft-state-v1\u0000${canonicalJson(previousState)}`,
      ),
    });
    expect(await other.load(create.runId)).toEqual(winning.state);
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

const PURCHASE_CATALOG = buildCapRushTestCatalog({ overalls: [70, 71, 72, 73, 74, 75] });
const PURCHASE_SOURCE = capRushTestCatalogSource(PURCHASE_CATALOG);
const PURCHASE_INDEX = fullCourtDraftIndexOf(PURCHASE_CATALOG, PURCHASE_SOURCE);

function confirmedDraftState(runId: string): FullCourtDraftState {
  let draft = createFullCourtDraftState(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse(`create-${runId}`),
      runId: idSchema.parse(runId),
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

function seasonCheckpointRecord(
  runId: string,
  completedThroughSlot: 0 | 1,
): StoredFullCourtSeasonCheckpoint {
  const parsedRunId = idSchema.parse(runId);
  const healthByTeam: StoredFullCourtSeasonCheckpoint['checkpoint']['healthByTeam'] = {};
  if (completedThroughSlot === 1) {
    for (let index = 0; index < CAP_RUSH_TAKEOVER_TEAMS; index++) {
      const teamId = `team${String(index)}`;
      healthByTeam[teamId] = {
        version: FULL_COURT_HEALTH_VERSION,
        teamId,
        throughDay: 1,
        players: {},
      };
    }
  }
  return {
    saveSchemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
    runId: parsedRunId,
    checkpoint: {
      schemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
      runId: parsedRunId,
      lockDigest: seedSchema.parse('b'.repeat(32)),
      completedThroughSlot,
      healthByTeam,
    },
  };
}

async function putConfirmedDraft(db: HoopRushDatabase, state: FullCourtDraftState): Promise<void> {
  await db.fullCourtDrafts.put({
    saveSchemaVersion: FULL_COURT_DRAFT_SCHEMA_VERSION,
    runId: state.runId,
    state,
    stateDigest: fullCourtStateDigest(state),
  });
}

function campPurchase(state: FullCourtDraftState) {
  const command = fullCourtPurchaseReportCommandSchema.parse({
    command: 'purchase-full-court-report',
    commandId: `camp-command-${state.runId}`,
    runId: state.runId,
    expectedRevision: state.revision,
    target: { kind: 'training-camp' },
  });
  const outcome = applyFullCourtCommand(state, command, { index: PURCHASE_INDEX });
  expect(outcome.result.status).toBe('accepted');
  return { command, outcome };
}

function filmPurchase(state: FullCourtDraftState, gameId: string) {
  const command = fullCourtPurchaseReportCommandSchema.parse({
    command: 'purchase-full-court-report',
    commandId: `film-command-${state.runId}`,
    runId: state.runId,
    expectedRevision: state.revision,
    target: { kind: 'opponent-film', gameId, opponentTeamId: 'team1' },
  });
  const outcome = applyFullCourtCommand(state, command, { index: PURCHASE_INDEX });
  expect(outcome.result.status).toBe('accepted');
  return { command, outcome };
}

test('refuses a training camp purchase after another connection commits the opener', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-purchase-closed');
  try {
    const state = confirmedDraftState('full-court-closed-run');
    await putConfirmedDraft(first, state);
    await second.fullCourtSeasonCheckpoints.put(seasonCheckpointRecord(state.runId, 0));
    const { command, outcome } = campPurchase(state);

    // The opener lands on the other connection after this tab loaded slot 0.
    await second.fullCourtSeasonCheckpoints.put(seasonCheckpointRecord(state.runId, 1));

    const repository = new DexieFullCourtDraftRepository(first);
    const committed = await repository.commit(command, outcome.state, outcome.result, {
      guard: (phase) => fullCourtPurchasePhaseRejection(state, command, phase),
    });
    expect(committed.status).toBe('rejected');
    expect(committed.rejection?.message).toBe(
      'Training camp closes before the first regular-season game.',
    );
    expect(await repository.getReceipt(command)).toBeNull();
    expect(await first.fullCourtDraftCommands.count()).toBe(0);
    expect(await repository.load(state.runId)).toEqual(state);
  } finally {
    first.close();
    second.close();
  }
});

test('sells training camp before the opener and replays its receipt after the season advances', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-purchase-first');
  try {
    const state = confirmedDraftState('full-court-purchase-first-run');
    await putConfirmedDraft(first, state);
    await first.fullCourtSeasonCheckpoints.put(seasonCheckpointRecord(state.runId, 0));
    const { command, outcome } = campPurchase(state);
    const repository = new DexieFullCourtDraftRepository(first);
    const guard = (phase: Parameters<typeof fullCourtPurchasePhaseRejection>[2]) =>
      fullCourtPurchasePhaseRejection(state, command, phase);

    expect(await repository.commit(command, outcome.state, outcome.result, { guard })).toEqual(
      outcome.result,
    );
    expect((await repository.load(state.runId))?.reports?.[0]?.kind).toBe('training-camp');

    await second.fullCourtSeasonCheckpoints.put(seasonCheckpointRecord(state.runId, 1));
    expect(await repository.commit(command, outcome.state, outcome.result, { guard })).toEqual(
      outcome.result,
    );
    expect(
      (await repository.load(state.runId))?.spending.filter((entry) => entry.kind === 'scouting'),
    ).toHaveLength(1);
    expect(await first.fullCourtDraftCommands.count()).toBe(1);
  } finally {
    first.close();
    second.close();
  }
});

test('sells training camp on a legacy draft without a season checkpoint', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-purchase-legacy');
  try {
    const confirmed = confirmedDraftState('full-court-purchase-legacy-run');
    const { reports: _reports, ...legacy } = confirmed;
    const state = fullCourtDraftStateSchema.parse(legacy);
    await putConfirmedDraft(first, state);
    const { command, outcome } = campPurchase(state);
    const repository = new DexieFullCourtDraftRepository(second);
    expect(
      await repository.commit(command, outcome.state, outcome.result, {
        guard: (phase) => fullCourtPurchasePhaseRejection(state, command, phase),
      }),
    ).toEqual(outcome.result);
    expect(
      (await repository.load(state.runId))?.spending.filter((entry) => entry.kind === 'scouting'),
    ).toHaveLength(1);
  } finally {
    first.close();
    second.close();
  }
});

test('sells training camp before the season opens', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-camp');
  try {
    const state = confirmedDraftState('full-court-camp-run');
    await putConfirmedDraft(first, state);
    const { command, outcome } = campPurchase(state);
    const repository = new DexieFullCourtDraftRepository(second);
    expect(
      await repository.commit(command, outcome.state, outcome.result, {
        guard: (phase) => fullCourtPurchasePhaseRejection(state, command, phase),
      }),
    ).toEqual(outcome.result);
    expect((await repository.load(state.runId))?.reports?.[0]?.kind).toBe('training-camp');
    expect(await first.fullCourtSeasonCheckpoints.get(state.runId)).toBeUndefined();
  } finally {
    first.close();
    second.close();
  }
});

test('refuses opponent film once its fixture is committed', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-film-stale');
  try {
    const state = confirmedDraftState('full-court-film-run');
    await putConfirmedDraft(first, state);
    const gameId = capRushLeagueGameId(1, 'team0', 'team1');
    await second.fullCourtSeasonCheckpoints.put(seasonCheckpointRecord(state.runId, 1));
    await second.fullCourtSeasonScores.put({
      saveSchemaVersion: FULL_COURT_SEASON_SAVE_SCHEMA_VERSION,
      runId: state.runId,
      gameId,
      score: {
        gameId,
        slot: 1,
        homeTeamId: 'team0',
        awayTeamId: 'team1',
        outcome: { kind: 'played', homePoints: 100, awayPoints: 90 },
      },
    });
    const { command, outcome } = filmPurchase(state, gameId);
    const repository = new DexieFullCourtDraftRepository(first);
    const committed = await repository.commit(command, outcome.state, outcome.result, {
      guard: (phase) => fullCourtPurchasePhaseRejection(state, command, phase),
    });
    expect(committed.status).toBe('rejected');
    expect(committed.rejection?.message).toBe('Film study is available for your next game.');
    expect(await repository.getReceipt(command)).toBeNull();
    expect(await repository.load(state.runId)).toEqual(state);
  } finally {
    first.close();
    second.close();
  }
});

test('serializes a guarded purchase against the opener from a second connection', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-purchase-race');
  try {
    const state = confirmedDraftState('full-court-purchase-race-run');
    await putConfirmedDraft(first, state);
    await first.fullCourtSeasonCheckpoints.put(seasonCheckpointRecord(state.runId, 0));
    const { command, outcome } = campPurchase(state);
    const repository = new DexieFullCourtDraftRepository(first);
    const commitPurchase = () =>
      repository.commit(command, outcome.state, outcome.result, {
        guard: (phase) => fullCourtPurchasePhaseRejection(state, command, phase),
      });
    const commitOpener = () =>
      second.transaction('rw', second.fullCourtSeasonCheckpoints, async () => {
        await second.fullCourtSeasonCheckpoints.put(seasonCheckpointRecord(state.runId, 1));
      });

    const [opener, purchase] = await Promise.allSettled([commitOpener(), commitPurchase()]);
    expect(opener.status).toBe('fulfilled');
    expect(purchase.status).toBe('fulfilled');
    const finalDraft = await repository.load(state.runId);
    if (finalDraft === null) throw new Error('Missing committed draft');
    const accepted = finalDraft.reports?.some((report) => report.kind === 'training-camp') ?? false;
    const receipt = await repository.getReceipt(command);
    if (accepted) {
      expect(receipt).toEqual(outcome.result);
      expect(finalDraft.spending.filter((entry) => entry.kind === 'scouting')).toHaveLength(1);
    } else {
      expect(finalDraft).toEqual(state);
      expect(receipt).toBeNull();
      expect(await first.fullCourtDraftCommands.count()).toBe(0);
    }
    expect(await second.fullCourtSeasonCheckpoints.get(state.runId)).toBeDefined();
  } finally {
    first.close();
    second.close();
  }
});
