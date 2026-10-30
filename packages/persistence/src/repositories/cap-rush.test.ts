import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type {
  CapRushAcceptGameCommand,
  CapRushDraftState,
  CapRushReport,
  CapRushStoredGame,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_GAME_COUNT,
  CAP_RUSH_RULES_VERSION,
  CAP_RUSH_SALARY_CURVE_VERSION,
  CAP_RUSH_SAVE_SCHEMA_VERSION,
  CAP_RUSH_SCHEMA_VERSION,
  CAP_RUSH_SEED_DERIVATION_VERSION,
  POSITIONS,
  capRushAcceptGameCommandSchema,
  capRushCardSchema,
  capRushChoosePositionCommandSchema,
  capRushCommandResultSchema,
  capRushCreateDraftCommandSchema,
  capRushDraftStateSchema,
  capRushFinalizeSeasonCommandSchema,
  capRushLockLineupCommandSchema,
  capRushOfferIdSchema,
  capRushVersionSetSchema,
  commandIdSchema,
  idSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  ENGINE_VERSION,
  adaptCapRushCatalog,
  applyCapRushCommand,
  buildCapRushCatalogIndex,
  buildCapRushLockedInputs,
  capRushEmptyAggregate,
  capRushFoldAggregate,
  capRushReport,
  capRushStateDigest,
  capRushStoredGameOf,
  createEngineContext,
  createCapRushDraftState,
  simulateCapRushGame,
  soloToBattleInput,
  soloToBattleTape,
} from '@hoop-rush/engine';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCapRushTestCatalog,
  buildFixtureBracket,
  capRushTestCatalogSource,
} from '@hoop-rush/test-fixtures';
import {
  CAP_RUSH_ACTIVE_DRAFT_RECORD_ID,
  storedCapRushDraftRowSchema,
  storedCapRushHistoryRowSchema,
} from '../schemas/cap-rush-record.ts';
import {
  CapRushCommandConflictError,
  CapRushLoadError,
  CapRushStaleRevisionError,
  DexieCapRushRepository,
  capRushReportCommandError,
} from './cap-rush.ts';
import { HOOP_RUSH_DATABASE_V9_STORES, HoopRushDatabase } from './dexie.ts';
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

function lockedRun() {
  const { index, command: createCommand, state: created, result: createResult } = setup();
  const picks = POSITIONS.map((slot, ordinal) => {
    const player = index.bySlot.get(slot)?.[0];
    if (player === undefined) throw new Error(`test catalog has no ${slot}`);
    return {
      pickOrdinal: ordinal,
      slot,
      card: capRushCardSchema.parse({
        cardId: `crc-${String(ordinal).repeat(32)}`,
        offerId: capRushOfferIdSchema.parse(`cro-${'0'.repeat(32)}`),
        cardIndex: ordinal,
        slot,
        bucket: 'budget',
        source: player,
        salaryDollars: 10_000_000,
      }),
    };
  });
  const locked = buildCapRushLockedInputs({
    runId: created.runId,
    runSeed: created.runSeed,
    variant: created.variant,
    versionSet: created.versionSet,
    catalog: created.catalog,
    picks,
    spin: null,
    bracket: buildFixtureBracket(),
    profile: DEFAULT_ERA_SIM_PROFILE,
  });
  const state = capRushDraftStateSchema.parse({
    ...created,
    revision: created.revision + 1,
    stage: 'locked',
    round: 5,
    offer: null,
    picks,
    locked,
  });
  const command = capRushLockLineupCommandSchema.parse({
    command: 'lock-cap-rush-lineup',
    commandId: commandIdSchema.parse('cmd-lock'),
    runId: state.runId,
    expectedRevision: created.revision,
    picks: picks.map((pick) => ({ slot: pick.slot, cardId: pick.card.cardId })),
  });
  const result = capRushCommandResultSchema.parse({
    schemaVersion: CAP_RUSH_SCHEMA_VERSION,
    commandId: command.commandId,
    runId: state.runId,
    status: 'accepted',
    revisionBefore: created.revision,
    revisionAfter: state.revision,
    stateDigest: capRushStateDigest(state),
    rejection: null,
  });
  return { index, createCommand, createResult, created, command, result, state };
}

async function startLockedRun(repo: DexieCapRushRepository): Promise<ReturnType<typeof lockedRun>> {
  const run = lockedRun();
  await repo.applyOutcome({
    outcome: { state: run.created, result: run.createResult },
    command: run.createCommand,
  });
  await repo.applyOutcome({
    outcome: { state: run.state, result: run.result },
    command: run.command,
  });
  return run;
}

function acceptBundle(
  index: ReturnType<typeof lockedRun>['index'],
  state: CapRushDraftState,
  gameNumber: number,
): {
  state: CapRushDraftState;
  result: ReturnType<typeof applyCapRushCommand>['result'];
  command: CapRushAcceptGameCommand;
  game: CapRushStoredGame;
} {
  if (state.locked === null) throw new Error('accept requires locked inputs');
  const simulation = simulateCapRushGame({
    locked: state.locked,
    gameNumber,
    context: createEngineContext(),
  });
  const game = capRushStoredGameOf(simulation);
  const command: CapRushAcceptGameCommand = capRushAcceptGameCommandSchema.parse({
    command: 'accept-cap-rush-game',
    commandId: commandIdSchema.parse(`cmd-game-${String(gameNumber)}`),
    runId: state.runId,
    expectedRevision: state.revision,
    cursor: gameNumber,
    inputDigest: game.summary.inputDigest,
    resultDigest: game.summary.resultDigest,
    isolations: simulation.facts.filter((fact) => fact.kind === 'isolation').length,
    strikes: simulation.facts.filter((fact) => fact.kind === 'strike').length,
    summary: game.summary,
  });
  return { ...applyCapRushCommand(state, command, { index }), command, game };
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

  it('opens the playoff game store for a run without playoff games', async () => {
    expect(await repository.listPlayoffGames('run-test')).toEqual([]);
    expect(HOOP_RUSH_DATABASE_V9_STORES.capRushPlayoffGames).toBe('[runId+gameId], runId');
  });

  it('allows reports from both finalize commands', () => {
    const seasonReport = { postseason: undefined } as unknown as CapRushReport;
    const postseasonReport = { postseason: {} } as unknown as CapRushReport;
    const seasonCommand = { command: 'finalize-cap-rush-season' } as never;
    const postseasonCommand = { command: 'finalize-cap-rush-postseason' } as never;
    expect(capRushReportCommandError({ command: seasonCommand, report: seasonReport })).toBeNull();
    expect(
      capRushReportCommandError({ command: postseasonCommand, report: postseasonReport }),
    ).toBeNull();
    expect(capRushReportCommandError({ command: postseasonCommand, report: seasonReport })).toBe(
      'a postseason finalize report requires its bracket',
    );
    expect(capRushReportCommandError({ command: seasonCommand, report: postseasonReport })).toBe(
      'a regular-season report cannot carry a postseason bracket',
    );
    expect(
      capRushReportCommandError({
        command: { command: 'accept-cap-rush-game' } as never,
        report: seasonReport,
      }),
    ).toBe('a cap rush report requires a finalize command');
  });

  it('rejects a changed outcome state before persisting its verified digest', async () => {
    const { command, state, result } = setup();
    await expect(
      repository.applyOutcome({
        outcome: { state: { ...state, revision: state.revision + 1 }, result },
        command,
      }),
    ).rejects.toBeInstanceOf(CapRushLoadError);
    expect(await db.capRushActive.count()).toBe(0);
    expect(await db.capRushCommands.count()).toBe(0);
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

  it('recognizes an older salary curve in a locked active run as unsupported', async () => {
    await startLockedRun(repository);
    const row = await db.capRushActive.get(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
    if (!row || !row.draft.locked) throw new Error('missing locked run');
    await db.capRushActive.put({
      ...row,
      draft: {
        ...row.draft,
        versionSet: { ...row.draft.versionSet, salaryCurveVersion: 'cap-rush-salary-v1' },
        locked: {
          ...row.draft.locked,
          versionSet: { ...row.draft.locked.versionSet, salaryCurveVersion: 'cap-rush-salary-v1' },
        },
      },
    } as never);
    await expect(repository.loadActiveDraft()).rejects.toMatchObject({ code: 'unsupported' });
    expect(await db.capRushActive.get(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID)).toBeDefined();
    await repository.clearActiveDraft();
    expect(await repository.loadActiveDraft()).toBeNull();
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

  it('round-trips an accepted game beside the draft revision', async () => {
    const { index, state } = await startLockedRun(repository);
    const bundle = acceptBundle(index, state, 1);
    expect(bundle.result.status).toBe('accepted');
    await repository.applyOutcome({
      outcome: { state: bundle.state, result: bundle.result },
      command: bundle.command,
      game: bundle.game,
    });
    expect(await repository.readRunGame(state.runId, 1)).toEqual(bundle.game);
    expect(await repository.listRunGames(state.runId)).toEqual([bundle.game]);
    expect((await repository.loadActiveDraft())?.season.games).toEqual([bundle.game.summary]);
    expect(await repository.readRunGame(state.runId, 2)).toBeNull();

    db.close();
    await db.open();
    const reopened = new DexieCapRushRepository(db);
    expect(await reopened.readRunGame(state.runId, 1)).toEqual(bundle.game);
    expect(await reopened.listRunGames(state.runId)).toHaveLength(1);
  });

  it('atomically saves and resumes playback, blocks advance, and resolves without changing simulation state', async () => {
    const { index, state } = await startLockedRun(repository);
    if (state.locked === null) throw new Error('missing locked inputs');
    const simulation = simulateCapRushGame({
      locked: state.locked,
      gameNumber: 1,
      context: createEngineContext(),
    });
    const bundle = acceptBundle(index, state, 1);
    const game = {
      ...bundle.game,
      playback: {
        input: soloToBattleInput(simulation.input),
        tape: soloToBattleTape(simulation.tape, simulation.result.humanSide),
        facts: [...simulation.facts],
        cursor: 0,
      },
    };
    await repository.applyOutcome({
      outcome: { state: bundle.state, result: bundle.result },
      command: bundle.command,
      game,
    });
    expect((await repository.readRunGame(state.runId, 1))?.playback).toEqual(game.playback);
    const next = acceptBundle(index, bundle.state, 2);
    await expect(
      repository.applyOutcome({
        outcome: { state: next.state, result: next.result },
        command: next.command,
        game: next.game,
      }),
    ).rejects.toThrow('pending broadcast');
    await repository.updatePlayback(state.runId, 1, 10, false);
    await repository.updatePlayback(state.runId, 1, 5, false);
    expect((await repository.readRunGame(state.runId, 1))?.playback?.cursor).toBe(10);
    await expect(repository.updatePlayback(state.runId, 1, 10, true)).rejects.toThrow(
      'final event',
    );
    const total = simulation.tape.events.length + simulation.tape.scoring.length;
    await repository.updatePlayback(state.runId, 1, total, true);
    expect((await repository.readRunGame(state.runId, 1))?.playback).toBeUndefined();
    expect(await repository.loadActiveDraft()).toEqual(bundle.state);
    await repository.applyOutcome({
      outcome: { state: next.state, result: next.result },
      command: next.command,
      game: next.game,
    });
    expect((await repository.loadActiveDraft())?.season.games.length).toBe(2);
  });

  it('rejects a malformed stored game record on read', async () => {
    const { index, state } = await startLockedRun(repository);
    const bundle = acceptBundle(index, state, 1);
    await repository.applyOutcome({
      outcome: { state: bundle.state, result: bundle.result },
      command: bundle.command,
      game: bundle.game,
    });
    await db.capRushGames.put({
      saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
      runId: state.runId,
      gameNumber: 1,
      game: { ...bundle.game, summary: { ...bundle.game.summary, humanPoints: -5 } },
      updatedAtIso: '2026-01-01T00:00:00.000Z',
    } as never);
    await expect(repository.readRunGame(state.runId, 1)).rejects.toMatchObject({
      code: 'malformed',
    });
    await expect(repository.listRunGames(state.runId)).rejects.toBeInstanceOf(CapRushLoadError);
    await db.capRushGames.put({
      saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION + 1,
      runId: state.runId,
      gameNumber: 1,
      game: bundle.game,
      updatedAtIso: '2026-01-01T00:00:00.000Z',
    } as never);
    await expect(repository.readRunGame(state.runId, 1)).rejects.toMatchObject({
      code: 'unsupported',
    });
  });

  it('orders history newest first across completed runs', async () => {
    const rows = [
      { runId: 'run-older', completedAtIso: '2026-01-01T00:00:00.000Z', wins: 50, losses: 32 },
      { runId: 'run-newer', completedAtIso: '2026-03-01T00:00:00.000Z', wins: 82, losses: 0 },
      { runId: 'run-middle', completedAtIso: '2026-02-01T00:00:00.000Z', wins: 60, losses: 22 },
    ];
    for (const row of rows) {
      await db.capRushHistory.put(
        storedCapRushHistoryRowSchema.parse({
          saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
          runId: row.runId,
          variant: 'roulette',
          payrollStatus: 'first-apron',
          payrollDollars: 130_000_000,
          wins: row.wins,
          losses: row.losses,
          perfectSeason: row.losses === 0,
          completedAtIso: row.completedAtIso,
        }),
      );
    }
    const history = await repository.listHistory();
    expect(history.map((entry) => entry.runId as string)).toEqual([
      'run-newer',
      'run-middle',
      'run-older',
    ]);
    expect(history[0]).toMatchObject({ wins: 82, perfectSeason: true, variant: 'roulette' });
  });

  it('commits nothing when a stored game cannot be written', async () => {
    const { index, state } = await startLockedRun(repository);
    const bundle = acceptBundle(index, state, 1);
    const failWrite = vi
      .spyOn(db.capRushGames, 'put')
      .mockRejectedValueOnce(new Error('save failed'));
    await expect(
      repository.applyOutcome({
        outcome: { state: bundle.state, result: bundle.result },
        command: bundle.command,
        game: bundle.game,
      }),
    ).rejects.toThrow('save failed');
    failWrite.mockRestore();
    expect(await repository.readRunGame(state.runId, 1)).toBeNull();
    expect(await repository.loadCommandResult(bundle.command.commandId)).toBeNull();
    expect(await repository.loadActiveDraft()).toEqual(state);
  });

  it('writes the completed report and history entry in the finalize transaction', async () => {
    const { index, state } = await startLockedRun(repository);
    if (state.locked === null) throw new Error('expected locked inputs');
    const games: CapRushStoredGame[] = [];
    let aggregate = capRushEmptyAggregate();
    const apronTriggers = { isolations: 0, strikes: 0 };
    for (let gameNumber = 1; gameNumber <= CAP_RUSH_GAME_COUNT; gameNumber += 1) {
      const simulation = simulateCapRushGame({
        locked: state.locked,
        gameNumber,
        context: createEngineContext(),
      });
      const game = capRushStoredGameOf(simulation);
      games.push(game);
      aggregate = capRushFoldAggregate(aggregate, game.summary);
      apronTriggers.isolations += simulation.facts.filter(
        (fact) => fact.kind === 'isolation',
      ).length;
      apronTriggers.strikes += simulation.facts.filter((fact) => fact.kind === 'strike').length;
    }
    const completed: CapRushDraftState = capRushDraftStateSchema.parse({
      ...state,
      revision: state.revision + CAP_RUSH_GAME_COUNT,
      season: {
        games: games.map((game) => game.summary),
        aggregate,
        apronTriggers,
        completedAt: null,
      },
    });
    await db.capRushActive.put(
      storedCapRushDraftRowSchema.parse({
        saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
        recordId: CAP_RUSH_ACTIVE_DRAFT_RECORD_ID,
        runId: completed.runId,
        revision: completed.revision,
        stateDigest: capRushStateDigest(completed),
        draft: completed,
        createdAtIso: '2026-04-01T00:00:00.000Z',
        updatedAtIso: '2026-04-30T00:00:00.000Z',
      }),
    );
    const completedAt = '2026-05-01T00:00:00.000Z';
    const finalize = capRushFinalizeSeasonCommandSchema.parse({
      command: 'finalize-cap-rush-season',
      commandId: commandIdSchema.parse('cmd-finalize'),
      runId: completed.runId,
      expectedRevision: completed.revision,
    });
    const outcome = applyCapRushCommand(completed, finalize, { index, nowIso: () => completedAt });
    expect(outcome.result.status).toBe('accepted');
    const report = buildReportOf(outcome.state, games);

    const failWrite = vi
      .spyOn(db.capRushHistory, 'put')
      .mockRejectedValueOnce(new Error('history failed'));
    await expect(repository.applyOutcome({ outcome, command: finalize, report })).rejects.toThrow(
      'history failed',
    );
    failWrite.mockRestore();
    expect(await repository.readReport(state.runId)).toBeNull();
    expect(await repository.listHistory()).toEqual([]);
    expect(await repository.loadCommandResult('cmd-finalize')).toBeNull();

    await repository.applyOutcome({ outcome, command: finalize, report });
    expect(await repository.readReport(state.runId)).toEqual(report);
    expect(await repository.readCompletedRun(state.runId)).toEqual({
      entry: {
        runId: state.runId,
        variant: 'clash',
        payrollStatus: 'under-cap',
        payrollDollars: 50_000_000,
        wins: outcome.state.season.aggregate.wins,
        losses: outcome.state.season.aggregate.losses,
        perfectSeason: outcome.state.season.aggregate.perfectSeason,
        completedAtIso: completedAt,
      },
      report,
    });
    expect(await repository.readCompletedRun('run-missing')).toBeNull();
  }, 30000);
});

function buildReportOf(
  state: CapRushDraftState,
  games: readonly CapRushStoredGame[],
): CapRushReport {
  if (state.locked === null) throw new Error('a report requires locked inputs');
  return capRushReport({
    locked: state.locked,
    games,
    aggregate: state.season.aggregate,
    apronTriggers: state.season.apronTriggers,
  });
}
