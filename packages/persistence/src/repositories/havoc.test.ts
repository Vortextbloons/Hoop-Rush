import { afterEach, describe, expect, it, vi } from 'bun:test';
import Dexie from 'dexie';
import { HOOP_RUSH_DATABASE_V5_STORES } from './dexie.ts';
import {
  HAVOC_GAME_COUNT,
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SAVE_SCHEMA_VERSION,
  POSITIONS,
  canonicalJson,
  havocAbandonRunCommandSchema,
  havocAcceptGameCommandSchema,
  havocAcceptNormalGameCommandSchema,
  havocCommandResultSchema,
  havocCompleteComparisonCommandSchema,
  havocCreateDraftCommandSchema,
  havocGameResultSchema,
  havocGameSummarySchema,
  havocGameTapeSchema,
  havocLockLineupCommandSchema,
  havocPickCardCommandSchema,
  havocReportSchema,
  havocRerollOfferCommandSchema,
  havocRunStateSchema,
  idSchema,
  playerIdSchema,
  seasonDigestHex,
  type CommandId,
  type HavocCommand,
  type HavocCommandResult,
  type HavocComparison,
  type HavocDraftCard,
  type HavocDraftPick,
  type HavocGameResult,
  type HavocGameSummary,
  type HavocGameTape,
  type HavocReport,
  type HavocRunState,
  type HavocStatDelta,
  type HavocVariant,
  type Id,
  type Position,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_FIXTURE_SEED,
  buildHavocCard,
  buildHavocDraftPick,
  buildHavocDraftState,
  buildHavocGameResult,
  buildHavocGameSummary,
  buildHavocRunState,
  buildHavocRunStateLocked,
  buildHavocSourcePlayer,
  buildHavocStatLine,
  buildHavocVersionSet,
} from '@hoop-rush/test-fixtures';
import {
  DexieHavocRepository,
  HavocActiveRunExistsError,
  HavocCommandConflictError,
  HavocLoadError,
  HavocOutcomeIntegrityError,
  HavocStaleRevisionError,
  type HavocCommandOutcome,
  type HavocLoadFailureCode,
} from './havoc.ts';
import {
  HAVOC_ACTIVE_RECORD_ID,
  storedHavocHistoryRowSchema,
  type StoredHavocActiveRun,
  type StoredHavocCommandRow,
} from '../schemas/havoc-record.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
  TestDatabase,
} from '../testing/repo-test-support.ts';

const RUN_ID = idSchema.parse('havoc-run-1');
const RUN_ID_2 = idSchema.parse('havoc-run-2');
const OFFER_1 = `hvo-${'3'.repeat(32)}`;
const OFFER_2 = `hvo-${'6'.repeat(32)}`;
const OFFER_3 = `hvo-${'9'.repeat(32)}`;

const ZERO_DELTA: HavocStatDelta = {
  secondsPlayed: 0,
  minutes: 0,
  points: 0,
  fieldGoalsMade: 0,
  fieldGoalAttempts: 0,
  threesMade: 0,
  threesAttempted: 0,
  freeThrowsMade: 0,
  freeThrowsAttempted: 0,
  rebounds: 0,
  offensiveRebounds: 0,
  defensiveRebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  fouls: 0,
  adjustments: 0,
  productionIndex: 0,
};

afterEach(restoreIndexedDb);

function createRepository(name: string): { db: TestDatabase; repo: DexieHavocRepository } {
  resetIndexedDb();
  const db = new TestDatabase(testDatabaseName(name));
  return { db, repo: new DexieHavocRepository(db) };
}

function commandKey(commandId: string): CommandId {
  return commandId as CommandId;
}

function runKey(runId: string): Id {
  return runId as Id;
}

function offerCards(slot: Position, offerId: string, start: number): HavocDraftCard[] {
  return [0, 1, 2].map((index) => {
    const ordinal = start + index;
    return buildHavocCard({
      slot,
      offerId,
      cardId: `hvc-${ordinal.toString(16).padStart(32, '0')}`,
      source: buildHavocSource(`p-havoc-${String(ordinal)}`, slot),
    });
  });
}

function buildHavocSource(playerId: string, slot: Position) {
  return buildHavocSourcePlayer({
    playerId: playerIdSchema.parse(playerId),
    displayName: playerId,
    positions: [slot],
  });
}

function buildCreateCommand(commandId: string, runId = RUN_ID): HavocCommand {
  const draft = buildHavocDraftState();
  return havocCreateDraftCommandSchema.parse({
    schemaVersion: 1,
    commandId,
    runId,
    command: 'create-havoc-draft',
    runSeed: HAVOC_FIXTURE_SEED,
    versionSet: buildHavocVersionSet(),
    catalog: draft.catalog,
  });
}

function buildRerollCommand(
  commandId: string,
  expectedRevision: number,
  offerId: string,
): HavocCommand {
  return havocRerollOfferCommandSchema.parse({
    schemaVersion: 1,
    commandId,
    runId: RUN_ID,
    expectedRevision,
    command: 'reroll-havoc-offer',
    offerId,
  });
}

function buildPickCommand(
  commandId: string,
  expectedRevision: number,
  offerId: string,
  cardId: string,
): HavocCommand {
  return havocPickCardCommandSchema.parse({
    schemaVersion: 1,
    commandId,
    runId: RUN_ID,
    expectedRevision,
    command: 'pick-havoc-card',
    offerId,
    cardId,
  });
}

function buildLockCommand(
  commandId: string,
  expectedRevision: number,
  picks: readonly HavocDraftPick[],
): HavocCommand {
  return havocLockLineupCommandSchema.parse({
    schemaVersion: 1,
    commandId,
    runId: RUN_ID,
    expectedRevision,
    command: 'lock-havoc-lineup',
    picks: picks.map((pick) => ({ slot: pick.slot, cardId: pick.card.cardId })),
  });
}

function buildAbandonCommand(commandId: string, expectedRevision: number): HavocCommand {
  return havocAbandonRunCommandSchema.parse({
    schemaVersion: 1,
    commandId,
    runId: RUN_ID,
    expectedRevision,
    command: 'abandon-havoc-run',
  });
}

function buildCompleteComparisonCommand(
  commandId: string,
  expectedRevision: number,
  comparison: HavocComparison,
): HavocCommand {
  return havocCompleteComparisonCommandSchema.parse({
    schemaVersion: 1,
    commandId,
    runId: RUN_ID,
    expectedRevision,
    command: 'complete-havoc-comparison',
    comparisonDigest: seasonDigestHex('comparison'),
    reportDigest: seasonDigestHex('report'),
    mvp: comparison.mvp,
  });
}

function makeAcceptCommand(
  commandId: string,
  runId: string,
  expectedRevision: number,
  cursor: number,
  variant: HavocVariant,
  summary: HavocGameSummary,
): HavocCommand {
  if (variant === 'havoc') {
    return havocAcceptGameCommandSchema.parse({
      schemaVersion: 1,
      commandId,
      runId,
      expectedRevision,
      command: 'accept-havoc-game',
      cursor,
      inputDigest: summary.inputDigest,
      resultDigest: summary.resultDigest,
      summary,
    });
  }
  return havocAcceptNormalGameCommandSchema.parse({
    schemaVersion: 1,
    commandId,
    runId,
    expectedRevision,
    command: 'accept-havoc-normal-game',
    cursor,
    inputDigest: summary.inputDigest,
    resultDigest: summary.resultDigest,
    summary,
  });
}

function acceptedOutcome(
  state: HavocRunState,
  revisionBefore: number,
  commandId: string,
  stateDigest = seasonDigestHex(`${commandId}:${String(state.revision)}`),
): HavocCommandOutcome {
  return {
    state,
    result: havocCommandResultSchema.parse({
      schemaVersion: 1,
      commandId,
      runId: state.runId,
      status: 'accepted',
      revisionBefore,
      revisionAfter: state.revision,
      stateDigest,
      rejection: null,
    }),
  };
}

function rejectedOutcome(state: HavocRunState, commandId: string): HavocCommandOutcome {
  return {
    state,
    result: havocCommandResultSchema.parse({
      schemaVersion: 1,
      commandId,
      runId: state.runId,
      status: 'rejected',
      revisionBefore: state.revision,
      revisionAfter: state.revision,
      stateDigest: seasonDigestHex(`${commandId}:${String(state.revision)}:rejected`),
      rejection: { code: 'offer-mismatch', message: 'fixture rejection' },
    }),
  };
}

function buildGameTape(gameNumber: number, variant: HavocVariant): HavocGameTape {
  return havocGameTapeSchema.parse({
    schemaVersion: 1,
    gameNumber,
    variant,
    seed: HAVOC_FIXTURE_SEED,
    events: [],
    scoring: [],
  });
}

interface GameBundle {
  result: HavocGameResult;
  inputDigest: string;
  resultDigest: string;
  summary: HavocGameSummary;
  command: HavocCommand;
  nextState: HavocRunState;
  commandId: string;
}

function advanceForGame(
  state: HavocRunState,
  gameNumber: number,
  variant: HavocVariant,
): HavocRunState {
  const aggregate = variant === 'havoc' ? state.havocAggregate : state.normalAggregate;
  const nextAggregate = {
    games: aggregate.games + 1,
    wins: aggregate.wins + 1,
    losses: aggregate.losses,
    pointsFor: aggregate.pointsFor + 100,
    pointsAgainst: aggregate.pointsAgainst + 90,
    adjustments: aggregate.adjustments,
  };
  const final = gameNumber === HAVOC_GAME_COUNT;
  const isHavoc = variant === 'havoc';
  return havocRunStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    havocCursor: isHavoc ? gameNumber : state.havocCursor,
    normalCursor: isHavoc ? state.normalCursor : gameNumber,
    havocAggregate: isHavoc ? nextAggregate : state.havocAggregate,
    normalAggregate: isHavoc ? state.normalAggregate : nextAggregate,
    perfectSeason: isHavoc && final ? nextAggregate.losses === 0 : state.perfectSeason,
    comparisonStatus: isHavoc && final ? 'running' : state.comparisonStatus,
    completionState: isHavoc && final ? 'comparison' : state.completionState,
  });
}

function buildGame(
  state: HavocRunState,
  gameNumber: number,
  variant: HavocVariant,
  commandId: string,
): GameBundle {
  const result = havocGameResultSchema.parse(buildHavocGameResult({ gameNumber, variant }));
  const resultDigest = seasonDigestHex(canonicalJson(result));
  const inputDigest = result.inputDigest;
  const summary = havocGameSummarySchema.parse(
    buildHavocGameSummary({
      gameNumber,
      variant,
      seed: result.seed,
      humanSide: result.humanSide,
      humanScore: result.home.points,
      opponentScore: result.away.points,
      outcome: 'win',
      periods: { human: result.home.periods, opponent: result.away.periods },
      resultDigest,
      inputDigest,
    }),
  );
  const nextState = advanceForGame(state, gameNumber, variant);
  return {
    result,
    inputDigest,
    resultDigest,
    summary,
    command: makeAcceptCommand(
      commandId,
      state.runId,
      state.revision,
      gameNumber,
      variant,
      summary,
    ),
    nextState,
    commandId,
  };
}

function buildComparisonFixture(runId: string): HavocComparison {
  const line = buildHavocStatLine();
  const totals = {
    games: HAVOC_GAME_COUNT,
    wins: 50,
    losses: 32,
    pointsFor: 8200,
    pointsAgainst: 8000,
    differential: 200,
    averagePointsFor: 100,
    averagePointsAgainst: 97.56,
    largestPointsFor: 132,
    largestPointsAgainst: 128,
    adjustments: 24,
  };
  const games = Array.from({ length: HAVOC_GAME_COUNT }, (_value, index) => ({
    gameNumber: index + 1,
    opponentId: 'opponent-a',
    humanHome: index % 2 === 0,
    havoc: {
      humanScore: 100,
      opponentScore: 90,
      outcome: 'win' as const,
      resultDigest: 'a'.repeat(32),
    },
    normal: {
      humanScore: 98,
      opponentScore: 92,
      outcome: 'win' as const,
      resultDigest: 'b'.repeat(32),
    },
    deltas: { pointsFor: 2, pointsAgainst: -2, margin: 4 },
    flips: { havocWinNormalLoss: false, normalWinHavocLoss: false },
    highlights: [],
  }));
  return {
    schemaVersion: 1,
    comparisonVersion: 'havoc-comparison-v1',
    mvpIndexVersion: 'havoc-mvp-index-v1',
    runId,
    havoc: totals,
    normal: {
      ...totals,
      wins: 45,
      losses: 37,
      pointsFor: 8100,
      pointsAgainst: 8100,
      differential: 0,
    },
    winsGained: 5,
    differentialDelta: 200,
    games,
    slots: POSITIONS.map((slot, index) => ({
      slot,
      displayName: `Slot ${String(index)}`,
      playerId: playerIdSchema.parse(`p-havoc-${String(index + 1)}`),
      playerVersionId: null,
      havoc: {
        combined: line,
        lines: [
          {
            kind: 'starter' as const,
            instanceId: `hvi-havoc-${String(index)}`,
            displayName: `Slot ${String(index)}`,
            line,
          },
        ],
      },
      normal: {
        combined: line,
        lines: [
          {
            kind: 'starter' as const,
            instanceId: `hvi-normal-${String(index)}`,
            displayName: `Slot ${String(index)}`,
            line,
          },
        ],
      },
      deltas: ZERO_DELTA,
      productionIndex: { havoc: 100, normal: 90, gain: 10 },
    })),
    mutations: [],
    mvp: {
      slot: 'PG',
      playerId: playerIdSchema.parse('p-havoc-1'),
      playerVersionId: null,
      displayName: 'Slot 0',
      havocIndex: 100,
      normalIndex: 90,
      gain: 10,
    },
    mvpIndexWeights: {
      points: 10,
      rebounds: 12,
      assists: 15,
      steals: 30,
      blocks: 30,
      turnovers: -10,
    },
    largestPositiveDifferences: [],
    largestNegativeDifferences: [],
  };
}

function buildReportFixture(
  runId: string,
  status: HavocReport['status'],
  comparison: HavocComparison | null,
): HavocReport {
  return havocReportSchema.parse({
    schemaVersion: 1,
    reportVersion: 'havoc-report-v1',
    runId,
    versions: buildHavocVersionSet(),
    status,
    lineup: POSITIONS.map((slot, index) => ({
      slot,
      displayName: `Slot ${String(index)}`,
      nickname: `Freak ${String(index)}`,
      playerId: `p-havoc-${String(index + 1)}`,
      playerVersionId: null,
      tier: 1,
      mutations: [{ mutationId: 'growth-spurt', sampledHeightDelta: 8 }],
    })),
    havoc: {
      games: HAVOC_GAME_COUNT,
      wins: 50,
      losses: 32,
      pointsFor: 8200,
      pointsAgainst: 8000,
      differential: 200,
      averagePointsFor: 100,
      averagePointsAgainst: 97.56,
      largestPointsFor: 132,
      largestPointsAgainst: 128,
      adjustments: 24,
    },
    normal: status === 'complete' ? buildComparisonFixture(runId).normal : null,
    perfectSeason: false,
    directMutationPoints: 24,
    mvp: comparison === null ? null : comparison.mvp,
    comparison,
    topGains: [],
    topLosses: [],
    wildestGames: [],
  });
}

function buildDraftChainStates(): {
  create: HavocRunState;
  reroll: HavocRunState;
  pick: HavocRunState;
  locked: HavocRunState;
  pick0: HavocDraftPick;
} {
  const create = buildHavocRunState({
    runId: RUN_ID,
    revision: 1,
    draft: buildHavocDraftState({ runId: RUN_ID, revision: 1 }),
  });
  const reroll = buildHavocRunState({
    runId: RUN_ID,
    revision: 2,
    draft: buildHavocDraftState({
      runId: RUN_ID,
      revision: 2,
      offerId: OFFER_2,
      offerIndex: 1,
      rerollUsed: true,
      cards: offerCards('PG', OFFER_2, 10),
    }),
  });
  const pick0 = buildHavocDraftPick(0);
  const pick = buildHavocRunState({
    runId: RUN_ID,
    revision: 3,
    draft: buildHavocDraftState({
      runId: RUN_ID,
      revision: 3,
      round: 2,
      slot: 'SG',
      offerId: OFFER_3,
      offerIndex: 1,
      rerollUsed: true,
      cards: offerCards('SG', OFFER_3, 20),
      picks: [pick0],
    }),
  });
  const locked = buildHavocRunStateLocked({ runId: RUN_ID, revision: 4 });
  return { create, reroll, pick, locked, pick0 };
}

async function applyDraftChain(
  repo: DexieHavocRepository,
  withCommands: boolean,
): Promise<ReturnType<typeof buildDraftChainStates>> {
  const states = buildDraftChainStates();
  await repo.applyOutcome(
    withCommands
      ? {
          outcome: acceptedOutcome(states.create, 0, 'cmd-create'),
          command: buildCreateCommand('cmd-create'),
        }
      : { outcome: acceptedOutcome(states.create, 0, 'cmd-create') },
  );
  expect(await repo.loadActiveRun()).toEqual(states.create);
  await repo.applyOutcome(
    withCommands
      ? {
          outcome: acceptedOutcome(states.reroll, 1, 'cmd-reroll'),
          command: buildRerollCommand('cmd-reroll', 1, OFFER_1),
        }
      : { outcome: acceptedOutcome(states.reroll, 1, 'cmd-reroll') },
  );
  expect(await repo.loadActiveRun()).toEqual(states.reroll);
  await repo.applyOutcome(
    withCommands
      ? {
          outcome: acceptedOutcome(states.pick, 2, 'cmd-pick'),
          command: buildPickCommand('cmd-pick', 2, OFFER_2, states.pick0.card.cardId),
        }
      : { outcome: acceptedOutcome(states.pick, 2, 'cmd-pick') },
  );
  expect(await repo.loadActiveRun()).toEqual(states.pick);
  const lockedInputs = states.locked.locked;
  if (lockedInputs === null) throw new Error('locked fixture missing inputs');
  await repo.applyOutcome(
    withCommands
      ? {
          outcome: acceptedOutcome(states.locked, 3, 'cmd-lock'),
          command: buildLockCommand('cmd-lock', 3, lockedInputs.picks),
        }
      : { outcome: acceptedOutcome(states.locked, 3, 'cmd-lock') },
  );
  expect(await repo.loadActiveRun()).toEqual(states.locked);
  return states;
}

function lateSeasonState(locked: HavocRunState): HavocRunState {
  return havocRunStateSchema.parse({
    ...locked,
    revision: 5,
    havocCursor: HAVOC_GAME_COUNT - 1,
    havocAggregate: {
      games: HAVOC_GAME_COUNT - 1,
      wins: 63,
      losses: 18,
      pointsFor: 8100,
      pointsAgainst: 7900,
      adjustments: 0,
    },
    comparisonStatus: 'not-started',
    completionState: 'season',
  });
}

async function archiveRunAtGame82(
  repo: DexieHavocRepository,
  locked: HavocRunState,
): Promise<{ final: HavocRunState; game: GameBundle }> {
  const state = lateSeasonState(locked);
  await repo.applyOutcome({
    outcome: acceptedOutcome(state, locked.revision, 'cmd-batch-81'),
  });
  const game = buildGame(state, HAVOC_GAME_COUNT, 'havoc', 'cmd-game-82');
  await repo.applyOutcome({
    outcome: acceptedOutcome(game.nextState, state.revision, game.commandId),
    command: game.command,
    game: { result: game.result, inputDigest: game.inputDigest, resultDigest: game.resultDigest },
  });
  return { final: game.nextState, game };
}

async function applyGameBundle(
  repo: DexieHavocRepository,
  state: HavocRunState,
  bundle: GameBundle,
  extras: { tape?: HavocGameTape } = {},
): Promise<HavocCommandResult> {
  return repo.applyOutcome({
    outcome: acceptedOutcome(bundle.nextState, state.revision, bundle.commandId),
    command: bundle.command,
    game: {
      result: bundle.result,
      inputDigest: bundle.inputDigest,
      resultDigest: bundle.resultDigest,
    },
    ...(extras.tape === undefined
      ? {}
      : { tape: { tape: extras.tape, tapeDigest: seasonDigestHex('tape'), selectedRank: 1 } }),
  });
}

async function expectHavocLoadError(
  promise: Promise<unknown>,
  code: HavocLoadFailureCode,
): Promise<HavocLoadError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HavocLoadError) {
      expect(error.code).toBe(code);
      return error;
    }
    throw error;
  }
  throw new Error(`expected HavocLoadError(${code})`);
}

describe('DexieHavocRepository', () => {
  it('applies create, reroll, pick, and lock commands with revision tracking', async () => {
    const { db, repo } = createRepository('havoc-draft-chain');
    const states = await applyDraftChain(repo, true);
    const active = await repo.loadActiveRun();
    expect(active).toEqual(states.locked);
    const raw = await db.havocActiveRuns.get(HAVOC_ACTIVE_RECORD_ID);
    expect(raw?.revision).toBe(4);
    expect(raw?.stateDigest).toBe(seasonDigestHex(`cmd-lock:${String(states.locked.revision)}`));
    expect(await db.havocCommands.count()).toBe(4);
    const createReceipt = await repo.loadCommandResult('cmd-create');
    expect(createReceipt?.status).toBe('accepted');
    expect(createReceipt?.revisionAfter).toBe(1);
    const rerollReceipt = await repo.loadCommandResult('cmd-reroll');
    expect(rerollReceipt?.revisionBefore).toBe(1);
    expect(await repo.loadCommandResult('cmd-missing')).toBeNull();
    db.close();
  });

  it('keeps duplicate command ids idempotent without command payloads', async () => {
    const { db, repo } = createRepository('havoc-idempotent');
    const states = await applyDraftChain(repo, false);
    const createOutcome = acceptedOutcome(states.create, 0, 'cmd-create');
    const first = await repo.applyOutcome({ outcome: createOutcome });
    const second = await repo.applyOutcome({ outcome: createOutcome });
    expect(second).toEqual(first);
    const rerollOutcome = acceptedOutcome(states.reroll, 1, 'cmd-reroll');
    const rerollFirst = await repo.applyOutcome({ outcome: rerollOutcome });
    const rerollSecond = await repo.applyOutcome({ outcome: rerollOutcome });
    expect(rerollSecond).toEqual(rerollFirst);
    expect((await repo.loadActiveRun())?.revision).toBe(4);
    expect(await db.havocCommands.count()).toBe(4);
    const stored = await db.havocCommands.get(commandKey('cmd-create'));
    expect(stored?.command).toBeNull();
    db.close();
  });

  it('rejects a changed payload under an existing command id', async () => {
    const { db, repo } = createRepository('havoc-conflict');
    const states = await applyDraftChain(repo, true);
    const duplicateCommand = havocCreateDraftCommandSchema.parse({
      ...buildCreateCommand('cmd-create'),
      runSeed: seasonDigestHex('different-seed'),
    });
    const conflicting = acceptedOutcome(
      states.create,
      0,
      'cmd-create',
      seasonDigestHex('different-state'),
    );
    await expect(
      repo.applyOutcome({ outcome: conflicting, command: duplicateCommand }),
    ).rejects.toBeInstanceOf(HavocCommandConflictError);
    await expect(repo.applyOutcome({ outcome: conflicting })).rejects.toBeInstanceOf(
      HavocCommandConflictError,
    );
    expect((await repo.loadActiveRun())?.revision).toBe(4);
    db.close();
  });

  it('rejects stale revisions from a second reader', async () => {
    const { db, repo } = createRepository('havoc-stale');
    await applyDraftChain(repo, true);
    const stale = buildHavocRunState({
      runId: RUN_ID,
      revision: 4,
      draft: buildHavocDraftState({ runId: RUN_ID, revision: 4 }),
    });
    await expect(
      repo.applyOutcome({ outcome: acceptedOutcome(stale, 3, 'cmd-stale') }),
    ).rejects.toBeInstanceOf(HavocStaleRevisionError);
    expect((await repo.loadActiveRun())?.revision).toBe(4);
    expect(await repo.loadCommandResult('cmd-stale')).toBeNull();
    expect(await db.havocCommands.count()).toBe(4);
    db.close();
  });

  it('loses the second of two concurrent accepts for the same cursor', async () => {
    const { db, repo } = createRepository('havoc-race');
    const states = await applyDraftChain(repo, true);
    const first = buildGame(states.locked, 1, 'havoc', 'cmd-race-a');
    const second = buildGame(states.locked, 1, 'havoc', 'cmd-race-b');
    const settled = await Promise.allSettled([
      applyGameBundle(repo, states.locked, first),
      applyGameBundle(repo, states.locked, second),
    ]);
    const fulfilled = settled.filter(
      (entry): entry is PromiseFulfilledResult<HavocCommandResult> => entry.status === 'fulfilled',
    );
    const rejected = settled.filter(
      (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(HavocStaleRevisionError);
    expect((await repo.loadActiveRun())?.revision).toBe(5);
    expect(await repo.listRunGames(RUN_ID, 'havoc')).toHaveLength(1);
    const winner = fulfilled[0]?.value;
    expect([first.commandId, second.commandId]).toContain(
      winner?.commandId as typeof first.commandId,
    );
    expect(await repo.readRunGame(RUN_ID, 'havoc', 1)).not.toBeNull();
    expect(await repo.listRunGames(RUN_ID, 'normal')).toHaveLength(0);
    db.close();
  });

  it('stores locked inputs once while checkpoints advance and hydrate after reopening', async () => {
    const { db, repo } = createRepository('havoc-compact-progress');
    const states = await applyDraftChain(repo, true);
    const first = buildGame(states.locked, 1, 'havoc', 'cmd-compact-1');
    const snapshotWrites = vi.spyOn(db.table('havocLockedInputs'), 'put');
    await applyGameBundle(repo, states.locked, first);
    expect(snapshotWrites).not.toHaveBeenCalled();
    const row = await db.havocActiveRuns.get(HAVOC_ACTIVE_RECORD_ID);
    expect(JSON.stringify(row)).not.toContain('opponents');
    expect(await db.table('havocLockedInputs').count()).toBe(1);
    db.close();
    await db.open();
    const resumed = await new DexieHavocRepository(db).loadActiveRun();
    expect(resumed).toEqual(first.nextState);
    if (resumed === null || resumed.locked === null) throw new Error('expected a resumed run');
    const locked = resumed.locked;
    expect(() => {
      locked.human.displayName = 'Changed after reloading';
    }).toThrow();
    const second = buildGame(resumed, 2, 'havoc', 'cmd-compact-2');
    await applyGameBundle(new DexieHavocRepository(db), resumed, second);
    expect(await repo.loadActiveRun()).toEqual(second.nextState);
    db.close();
  });
  it('loads a version-5 inline save and splits it atomically on the next accepted game', async () => {
    const { db, repo } = createRepository('havoc-v5-upgrade');
    const state = buildDraftChainStates().locked;
    const legacy = new Dexie(db.name);
    legacy.version(5).stores(HOOP_RUSH_DATABASE_V5_STORES);
    await legacy.table('havocActiveRuns').put({
      saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
      recordId: HAVOC_ACTIVE_RECORD_ID,
      runId: state.runId,
      revision: state.revision,
      stateDigest: seasonDigestHex('legacy-state'),
      state,
      createdAtIso: '2026-10-28T00:00:00.000Z',
      updatedAtIso: '2026-10-28T00:00:00.000Z',
    });
    legacy.close();
    expect(await repo.loadActiveRun()).toEqual(state);
    expect(await db.havocLockedInputs.count()).toBe(0);
    const game = buildGame(state, 1, 'havoc', 'cmd-v5-game');
    const failedWrite = vi
      .spyOn(db.havocGames, 'put')
      .mockRejectedValueOnce(new Error('save failed'));
    await expect(applyGameBundle(repo, state, game)).rejects.toThrow('save failed');
    failedWrite.mockRestore();
    expect(await db.havocLockedInputs.count()).toBe(0);
    expect(await repo.loadActiveRun()).toEqual(state);
    await applyGameBundle(repo, state, game);
    expect(await db.havocLockedInputs.count()).toBe(1);
    expect(JSON.stringify(await db.havocActiveRuns.get(HAVOC_ACTIVE_RECORD_ID))).not.toContain(
      'opponents',
    );
    expect(await repo.loadActiveRun()).toEqual(game.nextState);
    db.close();
  });

  it('rejects missing or changed locked snapshots when resuming', async () => {
    const { db, repo } = createRepository('havoc-snapshot-corruption');
    await applyDraftChain(repo, true);
    const snapshot = await db.havocLockedInputs.get(RUN_ID);
    if (snapshot === undefined) throw new Error('expected locked inputs');
    await db.havocLockedInputs.delete(RUN_ID);
    await expectHavocLoadError(repo.loadActiveRun(), 'corrupt');
    await db.havocLockedInputs.put({
      ...snapshot,
      locked: {
        ...snapshot.locked,
        human: { ...snapshot.locked.human, displayName: 'Changed snapshot' },
      },
    });
    await expectHavocLoadError(repo.loadActiveRun(), 'corrupt');
    db.close();
  });

  it('rejects changed locked inputs without saving the game or advancing progress', async () => {
    const { db, repo } = createRepository('havoc-locked-drift');
    const states = await applyDraftChain(repo, true);
    const game = buildGame(states.locked, 1, 'havoc', 'cmd-drift-game');
    if (game.nextState.locked === null) throw new Error('expected locked state');
    game.nextState.locked.human.displayName = 'Changed input';
    await expect(applyGameBundle(repo, states.locked, game)).rejects.toBeInstanceOf(
      HavocOutcomeIntegrityError,
    );
    expect(await repo.readRunGame(RUN_ID, 'havoc', 1)).toBeNull();
    expect(await repo.loadCommandResult(game.commandId)).toBeNull();
    expect(await repo.loadActiveRun()).toEqual(states.locked);
    db.close();
  });

  it('commits a game result, its summary command, and aggregate state together', async () => {
    const { db, repo } = createRepository('havoc-game-commit');
    const states = await applyDraftChain(repo, true);
    const game = buildGame(states.locked, 1, 'havoc', 'cmd-game-1');
    await repo.applyOutcome({
      outcome: acceptedOutcome(game.nextState, 4, game.commandId),
      command: game.command,
      game: { result: game.result, inputDigest: game.inputDigest, resultDigest: game.resultDigest },
    });
    const active = await repo.loadActiveRun();
    expect(active?.havocCursor).toBe(1);
    expect(active?.havocAggregate).toMatchObject({ games: 1, wins: 1, losses: 0 });
    const receipt = await repo.loadCommandResult('cmd-game-1');
    expect(receipt?.status).toBe('accepted');
    const stored = await db.havocCommands.get(commandKey('cmd-game-1'));
    expect(stored?.command?.command).toBe('accept-havoc-game');
    if (stored?.command?.command !== 'accept-havoc-game') {
      throw new Error('expected the stored accept command');
    }
    expect(stored.command.summary).toEqual(game.summary);
    const read = await repo.readRunGame(RUN_ID, 'havoc', 1);
    expect(read?.resultDigest).toBe(game.resultDigest);
    expect(read?.result).toEqual(game.result);
    expect(await repo.listRunGames(RUN_ID, 'havoc')).toHaveLength(1);
    db.close();
  });

  it('resumes a mid-batch run and keeps accepting later games', async () => {
    const { db, repo } = createRepository('havoc-mid-batch');
    const states = await applyDraftChain(repo, true);
    const first = buildGame(states.locked, 1, 'havoc', 'cmd-game-1');
    await applyGameBundle(repo, states.locked, first);
    const resumed = await repo.loadActiveRun();
    if (resumed === null) throw new Error('expected an active run');
    expect(resumed.havocCursor).toBe(1);
    const second = buildGame(resumed, 2, 'havoc', 'cmd-game-2');
    await applyGameBundle(repo, resumed, second);
    expect((await repo.loadActiveRun())?.havocCursor).toBe(2);
    const games = await repo.listRunGames(RUN_ID, 'havoc');
    expect(games.map((game) => game.gameNumber)).toEqual([1, 2]);
    db.close();
  });

  it('archives at game 82 and keeps the completed run addressable by id', async () => {
    const { db, repo } = createRepository('havoc-archive');
    const states = await applyDraftChain(repo, true);
    const { final, game } = await archiveRunAtGame82(repo, states.locked);
    expect(await repo.loadActiveRun()).toBeNull();
    const completed = await repo.readCompletedRun(RUN_ID);
    expect(completed?.state).toEqual(final);
    expect(completed?.state.havocCursor).toBe(HAVOC_GAME_COUNT);
    expect(completed?.report).toBeNull();
    expect(await repo.readComparison(RUN_ID)).toBeNull();
    const history = await repo.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      runId: RUN_ID,
      havocWins: 64,
      havocLosses: 18,
      comparisonStatus: 'running',
      completionState: 'comparison',
    });
    const storedGame = await repo.readRunGame(RUN_ID, 'havoc', HAVOC_GAME_COUNT);
    expect(storedGame?.resultDigest).toBe(game.resultDigest);

    await repo.applyOutcome({
      outcome: acceptedOutcome(
        buildHavocRunState({
          runId: RUN_ID_2,
          revision: 1,
          draft: buildHavocDraftState({ runId: RUN_ID_2, revision: 1 }),
        }),
        0,
        'cmd-create-2',
      ),
      command: buildCreateCommand('cmd-create-2', RUN_ID_2),
    });
    expect((await repo.loadActiveRun())?.runId).toBe(RUN_ID_2);
    const completedAfterRestart = await repo.readCompletedRun(RUN_ID);
    expect(completedAfterRestart?.state).toEqual(final);
    expect(await repo.listHistory()).toHaveLength(1);
    db.close();
  });

  it('resumes a partial normal comparison against the completed run id', async () => {
    const { db, repo } = createRepository('havoc-normal-resume');
    const states = await applyDraftChain(repo, true);
    const { final } = await archiveRunAtGame82(repo, states.locked);
    const secondRun = buildHavocRunState({
      runId: RUN_ID_2,
      revision: 1,
      draft: buildHavocDraftState({ runId: RUN_ID_2, revision: 1 }),
    });
    await repo.applyOutcome({
      outcome: acceptedOutcome(secondRun, 0, 'cmd-create-2'),
      command: buildCreateCommand('cmd-create-2', RUN_ID_2),
    });
    expect((await repo.loadActiveRun())?.runId).toBe(RUN_ID_2);
    const normal1 = buildGame(final, 1, 'normal', 'cmd-normal-1');
    await applyGameBundle(repo, final, normal1);
    const resumed = await repo.readCompletedRun(RUN_ID);
    expect(resumed?.state.normalCursor).toBe(1);
    expect(resumed?.state.normalAggregate).toMatchObject({ games: 1, wins: 1 });
    expect((await repo.loadActiveRun())?.runId).toBe(RUN_ID_2);
    expect((await repo.loadActiveRun())?.revision).toBe(1);
    const normalGames = await repo.listRunGames(RUN_ID, 'normal');
    expect(normalGames).toHaveLength(1);
    expect(await repo.listRunGames(RUN_ID, 'havoc')).toHaveLength(1);
    const normal2 = buildGame(resumed?.state ?? final, 2, 'normal', 'cmd-normal-2');
    await applyGameBundle(repo, resumed?.state ?? final, normal2);
    expect((await repo.readCompletedRun(RUN_ID))?.state.normalCursor).toBe(2);
    expect(await repo.listHistory()).toHaveLength(1);
    db.close();
  });

  it('finalizes the comparison and report without duplicating history', async () => {
    const { db, repo } = createRepository('havoc-finalize');
    const states = await applyDraftChain(repo, true);
    const { final } = await archiveRunAtGame82(repo, states.locked);
    const normal1 = buildGame(final, 1, 'normal', 'cmd-normal-1');
    await applyGameBundle(repo, final, normal1);
    const beforeFinal = await repo.readCompletedRun(RUN_ID);
    if (beforeFinal === null) throw new Error('expected a completed run');
    const comparison = buildComparisonFixture(RUN_ID);
    const report = buildReportFixture(RUN_ID, 'complete', comparison);
    const completeState = havocRunStateSchema.parse({
      ...beforeFinal.state,
      revision: beforeFinal.state.revision + 1,
      normalCursor: HAVOC_GAME_COUNT,
      normalAggregate: {
        games: HAVOC_GAME_COUNT,
        wins: 45,
        losses: 37,
        pointsFor: 8100,
        pointsAgainst: 8100,
        adjustments: 0,
      },
      comparisonStatus: 'complete',
      completionState: 'complete',
    });
    await repo.applyOutcome({
      outcome: acceptedOutcome(completeState, beforeFinal.state.revision, 'cmd-complete'),
      command: buildCompleteComparisonCommand(
        'cmd-complete',
        beforeFinal.state.revision,
        comparison,
      ),
      comparison,
      report,
    });
    expect(await repo.readComparison(RUN_ID)).toEqual(comparison);
    expect(await repo.readReport(RUN_ID)).toEqual(report);
    const history = await repo.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      runId: RUN_ID,
      comparisonStatus: 'complete',
      completionState: 'complete',
    });
    const completed = await repo.readCompletedRun(RUN_ID);
    expect(completed?.state.completionState).toBe('complete');
    expect(completed?.report).toEqual(report);
    db.close();
  });

  it('abandons an active run and preserves completed history for the next run', async () => {
    const { db, repo } = createRepository('havoc-abandon');
    const states = await applyDraftChain(repo, true);
    const abandonedState = havocRunStateSchema.parse({
      ...states.locked,
      revision: 5,
      completionState: 'abandoned',
    });
    await repo.applyOutcome({
      outcome: acceptedOutcome(abandonedState, 4, 'cmd-abandon'),
      command: buildAbandonCommand('cmd-abandon', 4),
    });
    expect(await repo.loadActiveRun()).toBeNull();
    const completed = await repo.readCompletedRun(RUN_ID);
    expect(completed?.state.completionState).toBe('abandoned');
    const history = await repo.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.completionState).toBe('abandoned');
    const secondRun = buildHavocRunState({
      runId: RUN_ID_2,
      revision: 1,
      draft: buildHavocDraftState({ runId: RUN_ID_2, revision: 1 }),
    });
    await repo.applyOutcome({
      outcome: acceptedOutcome(secondRun, 0, 'cmd-create-2'),
      command: buildCreateCommand('cmd-create-2', RUN_ID_2),
    });
    expect((await repo.loadActiveRun())?.runId).toBe(RUN_ID_2);
    expect(await repo.listHistory()).toHaveLength(1);
    db.close();
  });

  it('frees the singleton when a draft is abandoned', async () => {
    const { db, repo } = createRepository('havoc-abandon-draft');
    const states = buildDraftChainStates();
    await repo.applyOutcome({
      outcome: acceptedOutcome(states.create, 0, 'cmd-create'),
      command: buildCreateCommand('cmd-create'),
    });
    const abandonedDraft: HavocRunState = {
      ...states.create,
      revision: 2,
      completionState: 'abandoned',
    };
    await repo.applyOutcome({ outcome: acceptedOutcome(abandonedDraft, 1, 'cmd-abandon-draft') });
    expect(await repo.loadActiveRun()).toBeNull();
    expect(await repo.readCompletedRun(RUN_ID)).toBeNull();
    expect(await repo.listHistory()).toEqual([]);
    const receipt = await repo.loadCommandResult('cmd-abandon-draft');
    expect(receipt?.status).toBe('accepted');
    const secondRun = buildHavocRunState({
      runId: RUN_ID_2,
      revision: 1,
      draft: buildHavocDraftState({ runId: RUN_ID_2, revision: 1 }),
    });
    await repo.applyOutcome({
      outcome: acceptedOutcome(secondRun, 0, 'cmd-create-2'),
      command: buildCreateCommand('cmd-create-2', RUN_ID_2),
    });
    expect((await repo.loadActiveRun())?.runId).toBe(RUN_ID_2);
    db.close();
  });

  it('rejects a second active run while one exists', async () => {
    const { db, repo } = createRepository('havoc-singleton');
    await applyDraftChain(repo, true);
    const secondRun = buildHavocRunState({
      runId: RUN_ID_2,
      revision: 1,
      draft: buildHavocDraftState({ runId: RUN_ID_2, revision: 1 }),
    });
    await expect(
      repo.applyOutcome({
        outcome: acceptedOutcome(secondRun, 0, 'cmd-create-2'),
        command: buildCreateCommand('cmd-create-2', RUN_ID_2),
      }),
    ).rejects.toBeInstanceOf(HavocActiveRunExistsError);
    expect((await repo.loadActiveRun())?.runId).toBe(RUN_ID);
    db.close();
  });

  it('lists lightweight history newest first without hydrating games or tapes', async () => {
    const { db, repo } = createRepository('havoc-history');
    const older = storedHavocHistoryRowSchema.parse({
      saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
      runId: 'havoc-run-older',
      createdAtIso: '2026-01-01T00:00:00.000Z',
      updatedAtIso: '2026-01-02T00:00:00.000Z',
      havocWins: HAVOC_GAME_COUNT,
      havocLosses: 0,
      perfectSeason: true,
      comparisonStatus: 'complete',
      completionState: 'complete',
    });
    const newer = storedHavocHistoryRowSchema.parse({
      saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
      runId: 'havoc-run-newer',
      createdAtIso: '2026-02-01T00:00:00.000Z',
      updatedAtIso: '2026-02-02T00:00:00.000Z',
      havocWins: 10,
      havocLosses: 72,
      perfectSeason: false,
      comparisonStatus: 'not-started',
      completionState: 'abandoned',
    });
    await db.havocHistory.bulkPut([older, newer]);
    const gamesSpy = vi.spyOn(db.havocGames, 'toArray');
    const tapesSpy = vi.spyOn(db.havocRetainedTapes, 'toArray');
    const completedSpy = vi.spyOn(db.havocCompletedRuns, 'toArray');
    const history = await repo.listHistory();
    expect(history.map((entry) => entry.runId)).toEqual(['havoc-run-newer', 'havoc-run-older']);
    expect(Object.keys(history[0] ?? {}).sort()).toEqual([
      'comparisonStatus',
      'completionState',
      'createdAtIso',
      'havocLosses',
      'havocWins',
      'perfectSeason',
      'runId',
      'updatedAtIso',
    ]);
    expect(history[0]?.perfectSeason).toBe(false);
    expect(gamesSpy).not.toHaveBeenCalled();
    expect(tapesSpy).not.toHaveBeenCalled();
    expect(completedSpy).not.toHaveBeenCalled();
    db.close();
  });

  it('round-trips retained tapes and rejects corrupt ones', async () => {
    const { db, repo } = createRepository('havoc-tapes');
    const states = await applyDraftChain(repo, true);
    const tape = buildGameTape(1, 'havoc');
    const game = buildGame(states.locked, 1, 'havoc', 'cmd-game-tape');
    await applyGameBundle(repo, states.locked, game, { tape });
    expect(await repo.readRetainedTape(RUN_ID, 1)).toEqual(tape);
    expect(await repo.readRetainedTape(RUN_ID, 2)).toBeNull();
    const standalone = buildGameTape(3, 'havoc');
    await repo.writeRetainedTape(RUN_ID, 3, standalone, 'c'.repeat(32), 4);
    const raw = await db.havocRetainedTapes.get([RUN_ID, 3]);
    expect(raw?.selectedRank).toBe(4);
    expect(await repo.readRetainedTape(RUN_ID, 3)).toEqual(standalone);
    if (raw === undefined) throw new Error('expected a retained tape row');
    await db.havocRetainedTapes.put({ ...raw, tape: { ...raw.tape, gameNumber: 9 } });
    await expectHavocLoadError(repo.readRetainedTape(RUN_ID, 3), 'corrupt');
    db.close();
  });

  it('rejects outcome artifacts that disagree with the accepted command', async () => {
    const { db, repo } = createRepository('havoc-artifact-mismatch');
    const states = await applyDraftChain(repo, true);
    const game = buildGame(states.locked, 1, 'havoc', 'cmd-game-1');
    const tamperedSummary = havocGameSummarySchema.parse({
      ...game.summary,
      humanScore: game.summary.humanScore + 1,
    });
    const tamperedCommand = makeAcceptCommand('cmd-game-1', RUN_ID, 4, 1, 'havoc', tamperedSummary);
    await expect(
      repo.applyOutcome({
        outcome: acceptedOutcome(game.nextState, 4, 'cmd-game-1'),
        command: tamperedCommand,
        game: {
          result: game.result,
          inputDigest: game.inputDigest,
          resultDigest: game.resultDigest,
        },
      }),
    ).rejects.toBeInstanceOf(HavocOutcomeIntegrityError);
    expect(await repo.listRunGames(RUN_ID, 'havoc')).toEqual([]);
    await expect(
      repo.applyOutcome({
        outcome: acceptedOutcome(game.nextState, 4, 'cmd-game-1'),
        command: game.command,
        game: {
          result: game.result,
          inputDigest: seasonDigestHex('wrong-input'),
          resultDigest: game.resultDigest,
        },
      }),
    ).rejects.toBeInstanceOf(HavocOutcomeIntegrityError);
    db.close();
  });

  it('rejects rejected outcomes that carry artifacts', async () => {
    const { db, repo } = createRepository('havoc-rejected-artifacts');
    const states = await applyDraftChain(repo, true);
    await expect(
      repo.applyOutcome({
        outcome: rejectedOutcome(states.locked, 'cmd-rejected'),
        tape: { tape: buildGameTape(1, 'havoc'), tapeDigest: seasonDigestHex('tape') },
      }),
    ).rejects.toBeInstanceOf(HavocOutcomeIntegrityError);
    expect(await repo.loadCommandResult('cmd-rejected')).toBeNull();
    db.close();
  });

  it('records rejected outcomes without touching the run state', async () => {
    const { db, repo } = createRepository('havoc-rejected-record');
    const states = await applyDraftChain(repo, true);
    const outcome = rejectedOutcome(states.locked, 'cmd-rejected');
    const returned = await repo.applyOutcome({ outcome });
    expect(returned.status).toBe('rejected');
    const active = await repo.loadActiveRun();
    expect(active?.revision).toBe(4);
    expect(await repo.loadCommandResult('cmd-rejected')).toEqual(outcome.result);
    db.close();
  });

  it('rejects corrupt records visibly and never repairs them', async () => {
    const { db, repo } = createRepository('havoc-corrupt');
    await applyDraftChain(repo, true);
    const raw = await db.havocActiveRuns.get(HAVOC_ACTIVE_RECORD_ID);
    if (raw === undefined) throw new Error('expected an active row');
    await db.havocActiveRuns.put({ ...raw, state: { ...raw.state, revision: 99 } });
    await expectHavocLoadError(repo.loadActiveRun(), 'corrupt');
    expect(await db.havocActiveRuns.count()).toBe(1);

    const commandRow = await db.havocCommands.get(commandKey('cmd-create'));
    if (commandRow === undefined) throw new Error('expected a command row');
    const corruptCommand = {
      ...commandRow,
      result: { ...commandRow.result, status: 'bogus' },
    } as unknown as StoredHavocCommandRow;
    await db.havocCommands.put(corruptCommand);
    await expectHavocLoadError(repo.loadCommandResult('cmd-create'), 'corrupt');
    expect(await db.havocCommands.count()).toBe(4);

    const historyRow = storedHavocHistoryRowSchema.parse({
      saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
      runId: RUN_ID,
      createdAtIso: '2026-01-01T00:00:00.000Z',
      updatedAtIso: '2026-01-01T00:00:00.000Z',
      havocWins: 0,
      havocLosses: 0,
      perfectSeason: false,
      comparisonStatus: 'not-started',
      completionState: 'season',
    });
    await db.havocHistory.put({ ...historyRow, havocWins: 'many' } as unknown as never);
    await expectHavocLoadError(repo.listHistory(), 'corrupt');
    expect(await db.havocHistory.count()).toBe(1);
    db.close();
  });

  it('rejects unsupported save versions visibly', async () => {
    const { db, repo } = createRepository('havoc-unsupported');
    await applyDraftChain(repo, true);
    const raw = await db.havocActiveRuns.get(HAVOC_ACTIVE_RECORD_ID);
    if (raw === undefined) throw new Error('expected an active row');
    await db.havocActiveRuns.put({
      ...raw,
      saveSchemaVersion: 99,
    } as unknown as StoredHavocActiveRun);
    await expectHavocLoadError(repo.loadActiveRun(), 'unsupported');
    expect(await db.havocActiveRuns.count()).toBe(1);
    db.close();
  });

  it('reports legacy v1 rules as unsupported and allows explicit discard', async () => {
    const { db, repo } = createRepository('havoc-legacy-v1');
    await applyDraftChain(repo, true);
    const raw = await db.havocActiveRuns.get(HAVOC_ACTIVE_RECORD_ID);
    if (raw === undefined) throw new Error('expected an active row');
    const v1State = JSON.parse(
      JSON.stringify(raw.state)
        .replaceAll(HAVOC_RULES_VERSION, 'havoc-rules-v1')
        .replaceAll(HAVOC_MUTATION_CATALOG_VERSION, 'havoc-mutations-v1'),
    ) as typeof raw.state;
    await db.havocActiveRuns.put({ ...raw, state: v1State });
    const error = await expectHavocLoadError(repo.loadActiveRun(), 'unsupported');
    expect(error.diagnostics.join('; ')).toContain('havoc-rules-v1');
    expect(await db.havocActiveRuns.count()).toBe(1);
    await repo.clearActiveRun();
    expect(await repo.loadActiveRun()).toBeNull();
    expect(await db.havocActiveRuns.count()).toBe(0);
    db.close();
  });

  it('rolls back every table when one write in the commit fails', async () => {
    const { db, repo } = createRepository('havoc-rollback');
    const states = await applyDraftChain(repo, true);
    const { final } = await archiveRunAtGame82(repo, states.locked);
    const normal1 = buildGame(final, 1, 'normal', 'cmd-normal-rollback');
    const spy = vi.spyOn(db.havocHistory, 'put').mockImplementation(() => {
      throw new Error('injected-havoc-write-failure');
    });
    await expect(applyGameBundle(repo, final, normal1)).rejects.toThrow(
      'injected-havoc-write-failure',
    );
    spy.mockRestore();
    const completed = await repo.readCompletedRun(RUN_ID);
    expect(completed?.state.revision).toBe(final.revision);
    expect(completed?.state.normalCursor).toBe(0);
    expect(await repo.readRunGame(RUN_ID, 'normal', 1)).toBeNull();
    expect(await repo.loadCommandResult('cmd-normal-rollback')).toBeNull();
    const history = await repo.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.completionState).toBe('comparison');
    db.close();
  });

  it('aborts the transaction when a stored row fails validation mid-commit', async () => {
    const { db, repo } = createRepository('havoc-failing-parse');
    const states = await applyDraftChain(repo, true);
    const { final } = await archiveRunAtGame82(repo, states.locked);
    const historyRow = await db.havocHistory.get(runKey(RUN_ID));
    if (historyRow === undefined) throw new Error('expected a history row');
    await db.havocHistory.put({
      ...historyRow,
      havocWins: 'many',
    } as unknown as typeof historyRow);
    const normal1 = buildGame(final, 1, 'normal', 'cmd-normal-parse');
    await expectHavocLoadError(applyGameBundle(repo, final, normal1), 'corrupt');
    const completed = await repo.readCompletedRun(RUN_ID);
    expect(completed?.state.normalCursor).toBe(0);
    expect(await repo.readRunGame(RUN_ID, 'normal', 1)).toBeNull();
    expect(await repo.loadCommandResult('cmd-normal-parse')).toBeNull();
    expect(await db.havocHistory.count()).toBe(1);
    db.close();
  });
});
