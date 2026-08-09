import { describe, expect, it, vi } from 'vitest';
import type {
  SeasonEffectsState,
  SeasonGameSummary,
  SeasonPendingBlockCandidate,
  SeasonRun,
  SeasonRunCommand,
  SeasonTradeOffer,
} from '@hoop-rush/data-contracts';
import { handleSeasonRunCommand, type SeasonRunCommandContext } from './season-commands.ts';
import { seasonObjectiveChoicesForBlock } from './objectives.ts';
import { openSeasonTradeWindow } from './trades.ts';
import {
  buildEconomyTestRun,
  injuryIdOf,
  withInjury,
  zeroEffectsOf,
} from './season-economy-test-support.ts';

/**
 * M2.5 typed run command tests (spec/2.0/07 M2.5 §8): the six handlers, their
 * deterministic preconditions and typed rejections, state-chain advancement
 * (revision +1 + recomputed digest), and replay determinism. The health
 * seams (risky-rehab outcome rolls, forfeit summaries, pending advancement)
 * are stubbed to their contract semantics until the health workstream lands
 * the real implementations.
 */

vi.mock('./injuries.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./injuries.ts')>();
  return {
    ...original,
    // Contract-conformant stubs: success shortens recovery by one game
    // (minimum one), failure lengthens it by one.
    rollSeasonRehabOutcome: () => 'success' as const,
    applyRiskyRehabOutcome: (
      health: SeasonRun['health'],
      injuryId: string,
      outcome: 'success' | 'failure',
    ) => ({
      ...health,
      injuries: health.injuries.map((injury) =>
        injury.injuryId === injuryId
          ? {
              ...injury,
              missedGamesRemaining:
                outcome === 'success'
                  ? Math.max(1, injury.missedGamesRemaining - 1)
                  : injury.missedGamesRemaining + 1,
              rehabModifier: outcome === 'success' ? (-1 as const) : (1 as const),
            }
          : injury,
      ),
    }),
  };
});

vi.mock('./health.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./health.ts')>();
  const nextGameIdOf = (gameId: string): string => {
    const number = Number(gameId.slice(1));
    return `s${String(number + 1).padStart(6, '0')}`;
  };
  return {
    ...original,
    // Official 2-0 forfeit summary with the human as the loser.
    seasonForfeitSummaryForGame: (
      run: SeasonRun,
      gameId: string,
      humanFranchiseId: string,
    ): SeasonGameSummary => {
      const game = run.games.find((entry) => entry.gameId === gameId);
      const homeFranchiseId = game?.homeFranchiseId ?? 'lakers';
      const awayFranchiseId = game?.awayFranchiseId ?? 'celtics';
      const humanIsHome = homeFranchiseId === humanFranchiseId;
      return {
        schemaVersion: 1,
        summaryVersion: 'season-game-summary-v3',
        gameId,
        round: game?.round ?? 1,
        homeFranchiseId,
        awayFranchiseId,
        status: 'forfeit',
        overtimePeriods: 0,
        homeScore: humanIsHome ? 0 : 2,
        awayScore: humanIsHome ? 2 : 0,
        forfeitLoserFranchiseId: humanFranchiseId,
        homeBox: {
          franchiseId: homeFranchiseId,
          points: 0,
          fieldGoalsMade: 0,
          fieldGoalsAttempted: 0,
          threePointersMade: 0,
          threePointersAttempted: 0,
          freeThrowsMade: 0,
          freeThrowsAttempted: 0,
          offensiveRebounds: 0,
          defensiveRebounds: 0,
          assists: 0,
          steals: 0,
          blocks: 0,
          turnovers: 0,
          fouls: 0,
          possessions: 0,
        },
        awayBox: {
          franchiseId: awayFranchiseId,
          points: 0,
          fieldGoalsMade: 0,
          fieldGoalsAttempted: 0,
          threePointersMade: 0,
          threePointersAttempted: 0,
          freeThrowsMade: 0,
          freeThrowsAttempted: 0,
          offensiveRebounds: 0,
          defensiveRebounds: 0,
          assists: 0,
          steals: 0,
          blocks: 0,
          turnovers: 0,
          fouls: 0,
          possessions: 0,
        },
        homePlayers: [],
        awayPlayers: [],
        injuryEvents: [],
      };
    },
    // Advances the pending candidate to the next game in block order.
    advancePendingAfterForfeit: (
      pending: SeasonPendingBlockCandidate,
      forfeitedGameId: string,
    ): SeasonPendingBlockCandidate => ({
      ...pending,
      nextGameId: nextGameIdOf(forfeitedGameId),
    }),
  };
});

const HUMAN = 'lakers';

/** A fresh run with window 0 open (accepted block 2), revision 1. */
function windowedFixture(seed = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a'): {
  run: SeasonRun;
  effects: SeasonEffectsState;
  catalog: NonNullable<SeasonRunCommandContext['catalog']>;
  context: SeasonRunCommandContext;
} {
  const { run: base, catalog } = buildEconomyTestRun({ seed });
  const result = openSeasonTradeWindow({
    run: base,
    blockIndex: 2,
    rootSeed: base.rootSeed,
    humanFranchiseId: HUMAN,
    catalog,
    effects: zeroEffectsOf(base),
  });
  if (result === null) throw new Error('window did not open');
  const run: SeasonRun = {
    ...base,
    trade: result.trade,
    influence: result.influence,
    transactions: result.transactions,
    rosters: result.rosters,
    ownership: result.ownership,
    rotations: result.rotations,
    health: result.health,
    stateRevision: result.stateRevision,
    stateDigest: result.stateDigest,
  };
  const effects = result.effects;
  return {
    run,
    effects,
    catalog,
    context: { run, pending: null, humanFranchiseId: HUMAN, catalog, effects },
  };
}

/** Every run command without its shared base fields (discrimination kept). */
type SeasonRunCommandFragment = {
  [K in SeasonRunCommand['command']]: Omit<
    Extract<SeasonRunCommand, { command: K }>,
    'schemaVersion' | 'runId' | 'expectedStateRevision' | 'expectedStateDigest'
  >;
}[SeasonRunCommand['command']];

function commandOf(run: SeasonRun, command: SeasonRunCommandFragment): SeasonRunCommand {
  return {
    schemaVersion: 9,
    runId: run.runId,
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
    ...command,
  };
}

/** A run whose window `windowIndex` is closed (offers preserved). */
function withClosedWindow(run: SeasonRun, windowIndex: number): SeasonRun {
  const trade = run.trade;
  if (trade === null) throw new Error('no trade state');
  return {
    ...run,
    trade: {
      ...trade,
      windows: trade.windows.map((window) =>
        window.windowIndex === windowIndex ? { ...window, status: 'closed' as const } : window,
      ),
    },
  };
}

function baseOfferOf(run: SeasonRun): SeasonTradeOffer {
  const offer = run.trade?.windows[0]?.offers.find((entry) => entry.status === 'open');
  if (offer === undefined) throw new Error('no open offer');
  return offer;
}

function pendingOf(
  run: SeasonRun,
  overrides: Partial<SeasonPendingBlockCandidate> = {},
): SeasonPendingBlockCandidate {
  return {
    schemaVersion: 1,
    blockVersion: 'season-block-v3',
    runId: run.runId,
    commandId: 'block-3-command',
    blockIndex: 3,
    expectedRevision: 3,
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
    objectiveId: 'win-six',
    nextGameId: 's000301',
    summaries: [],
    retainedDetails: [],
    effects: zeroEffectsOf(run),
    health: run.health,
    standings: run.standings,
    teamAggregates: [],
    playerAggregates: [],
    rotationDigest: '0'.repeat(32),
    ...overrides,
  };
}

describe('select-block-objective command', () => {
  it('accepts a selection for the current playable block and advances the state chain', () => {
    const { run, context } = windowedFixture();
    const offered = seasonObjectiveChoicesForBlock(run.rootSeed, 0);
    const command = commandOf(run, {
      command: 'select-block-objective',
      commandId: 'select-obj-0',
      blockIndex: 0,
      objectiveId: offered[0] ?? 'win-six',
    });
    const output = handleSeasonRunCommand(command, context);
    expect(output.result.command).toBe('select-block-objective');
    const outputResult = output.result;
    if (outputResult.command !== 'select-block-objective') throw new Error('unexpected command');
    const result = outputResult.result;
    if (result.status !== 'accepted') throw new Error('expected acceptance');
    expect(result.objectiveId).toBe(offered[0]);
    expect(output.run.stateRevision).toBe(run.stateRevision + 1);
    expect(output.run.stateDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(output.run.stateDigest).not.toBe(run.stateDigest);
    expect(output.run.objectives.selections[0]).toEqual({
      objectiveId: offered[0],
      selectedByCommandId: 'select-obj-0',
      success: null,
    });
  });

  it('rejects with run-mismatch, duplicate-command, and stale-state in order', () => {
    const { run, context } = windowedFixture();
    const offered = seasonObjectiveChoicesForBlock(run.rootSeed, 0)[0] ?? 'win-six';
    const runMismatch = handleSeasonRunCommand(
      {
        ...commandOf(run, {
          command: 'select-block-objective',
          commandId: 'cmd-rm',
          blockIndex: 0,
          objectiveId: offered,
        }),
        runId: 'other-run',
      },
      context,
    );
    expect(runMismatch.result.result.status).toBe('rejected');
    if (runMismatch.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(runMismatch.result.result.rejection.code).toBe('run-mismatch');

    // A commandId recorded in the run's transaction history is a duplicate.
    const transactionCommandId = run.transactions.find(
      (entry) => entry.commandId !== null,
    )?.commandId;
    expect(transactionCommandId).toBeDefined();
    const duplicate = handleSeasonRunCommand(
      commandOf(run, {
        command: 'select-block-objective',
        commandId: transactionCommandId ?? 'missing',
        blockIndex: 0,
        objectiveId: offered,
      }),
      context,
    );
    if (duplicate.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(duplicate.result.result.rejection.code).toBe('duplicate-command');

    // A commandId recorded in the influence ledger is also a duplicate.
    const ledgerCommandId = run.influence.ledger.find(
      (entry) => entry.commandId !== null,
    )?.commandId;
    expect(ledgerCommandId).toBeDefined();
    const ledgerDuplicate = handleSeasonRunCommand(
      commandOf(run, {
        command: 'select-block-objective',
        commandId: ledgerCommandId ?? 'missing',
        blockIndex: 0,
        objectiveId: offered,
      }),
      context,
    );
    if (ledgerDuplicate.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(ledgerDuplicate.result.result.rejection.code).toBe('duplicate-command');

    const staleRevision = handleSeasonRunCommand(
      {
        ...commandOf(run, {
          command: 'select-block-objective',
          commandId: 'cmd-stale',
          blockIndex: 0,
          objectiveId: offered,
        }),
        expectedStateRevision: 0,
      },
      context,
    );
    if (staleRevision.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(staleRevision.result.result.rejection.code).toBe('stale-state');
    const staleDigest = handleSeasonRunCommand(
      {
        ...commandOf(run, {
          command: 'select-block-objective',
          commandId: 'cmd-stale-2',
          blockIndex: 0,
          objectiveId: offered,
        }),
        expectedStateDigest: '0'.repeat(32),
      },
      context,
    );
    if (staleDigest.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(staleDigest.result.result.rejection.code).toBe('stale-state');
  });

  it('rejects duplicate-command after the same commandId was already applied', () => {
    const { run, context } = windowedFixture();
    const offered = seasonObjectiveChoicesForBlock(run.rootSeed, 0)[0] ?? 'win-six';
    const first = handleSeasonRunCommand(
      commandOf(run, {
        command: 'select-block-objective',
        commandId: 'select-obj-again',
        blockIndex: 0,
        objectiveId: offered,
      }),
      context,
    );
    if (first.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const replay = handleSeasonRunCommand(
      commandOf(first.run, {
        command: 'select-block-objective',
        commandId: 'select-obj-again',
        blockIndex: 0,
        objectiveId: offered,
      }),
      { ...context, run: first.run },
    );
    expect(replay.result.result.status).toBe('rejected');
    if (replay.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(replay.result.result.rejection.code).toBe('duplicate-command');
  });

  it('rejects not-at-boundary and objective-not-offered', () => {
    const { run, context } = windowedFixture();
    const notAtBoundary = handleSeasonRunCommand(
      commandOf(run, {
        command: 'select-block-objective',
        commandId: 'cmd-boundary',
        blockIndex: 2,
        objectiveId: 'win-six',
      }),
      context,
    );
    if (notAtBoundary.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(notAtBoundary.result.result.rejection.code).toBe('not-at-boundary');

    const offered = seasonObjectiveChoicesForBlock(run.rootSeed, 0);
    const notOfferedId = (
      [
        'win-six',
        'defense-108',
        'rebound-plus-20',
        'availability-eight',
        'bench-320',
        'turnover-130',
      ] as const
    ).find((id) => !offered.includes(id));
    const notOffered = handleSeasonRunCommand(
      commandOf(run, {
        command: 'select-block-objective',
        commandId: 'cmd-not-offered',
        blockIndex: 0,
        objectiveId: notOfferedId ?? 'win-six',
      }),
      context,
    );
    if (notOffered.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(notOffered.result.result.rejection.code).toBe('objective-not-offered');
  });

  it('rejects objective-already-selected and not-at-boundary for future blocks', () => {
    const { run, context } = windowedFixture();
    const offered = seasonObjectiveChoicesForBlock(run.rootSeed, 0)[0] ?? 'win-six';
    const first = handleSeasonRunCommand(
      commandOf(run, {
        command: 'select-block-objective',
        commandId: 'select-obj-0',
        blockIndex: 0,
        objectiveId: offered,
      }),
      context,
    );
    if (first.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const current = first.run;

    const again = handleSeasonRunCommand(
      commandOf(current, {
        command: 'select-block-objective',
        commandId: 'select-obj-0-again',
        blockIndex: 0,
        objectiveId: offered,
      }),
      { ...context, run: current },
    );
    expect(again.result.result.status).toBe('rejected');
    if (again.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(again.result.result.rejection.code).toBe('objective-already-selected');

    const futureBlock = handleSeasonRunCommand(
      commandOf(current, {
        command: 'select-block-objective',
        commandId: 'select-obj-1',
        blockIndex: 1,
        objectiveId: seasonObjectiveChoicesForBlock(current.rootSeed, 1)[0] ?? 'win-six',
      }),
      { ...context, run: current },
    );
    expect(futureBlock.result.result.status).toBe('rejected');
    if (futureBlock.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(futureBlock.result.result.rejection.code).toBe('not-at-boundary');
  });
});

describe('spend-influence command', () => {
  it('accepts an extra-trade-offer spend, tracks the window, and generates offer #4', () => {
    const { run, context } = windowedFixture();
    const command = commandOf(run, {
      command: 'spend-influence',
      commandId: 'spend-extra-1',
      franchiseId: HUMAN,
      purpose: 'extra-trade-offer',
      windowIndex: 0,
    });
    const output = handleSeasonRunCommand(command, context);
    const outputResult = output.result;
    if (outputResult.command !== 'spend-influence') throw new Error('unexpected command');
    const result = outputResult.result;
    if (result.status !== 'accepted') throw new Error('expected acceptance');
    expect(result.purpose).toBe('extra-trade-offer');
    expect(result.ledgerEntry.requestedDelta).toBe(-1);
    expect(result.ledgerEntry.appliedDelta).toBe(-1);
    expect(result.ledgerEntry.balanceAfter).toBe(1);
    expect(result.generatedOffer).not.toBeNull();
    expect(result.generatedOffer?.status).toBe('open');
    expect(result.generatedOffer?.toFranchiseId).toBe(HUMAN);
    expect(output.run.stateRevision).toBe(run.stateRevision + 1);
    const window = output.run.trade?.windows[0];
    expect(window?.offers.some((offer) => offer.offerId === result.generatedOffer?.offerId)).toBe(
      true,
    );
    expect(output.run.influence.windows[HUMAN]).toContainEqual({
      windowIndex: 0,
      extraOfferSpent: true,
    });
    const transaction = output.run.transactions[output.run.transactions.length - 1];
    expect(transaction?.type).toBe('influence-spend');
    expect(transaction?.commandId).toBe('spend-extra-1');
  });

  it('rejects insufficient-balance, window-not-open, already-spent, and no-window', () => {
    const { run, context } = windowedFixture();
    const atFloor: SeasonRun = {
      ...run,
      influence: {
        ...run.influence,
        balances: { ...run.influence.balances, [HUMAN]: -3 },
      },
    };
    const insufficient = handleSeasonRunCommand(
      commandOf(atFloor, {
        command: 'spend-influence',
        commandId: 'spend-insufficient',
        franchiseId: HUMAN,
        purpose: 'extra-trade-offer',
        windowIndex: 0,
      }),
      { ...context, run: atFloor },
    );
    if (insufficient.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(insufficient.result.result.rejection.code).toBe('insufficient-balance');

    const notOpen = handleSeasonRunCommand(
      commandOf(run, {
        command: 'spend-influence',
        commandId: 'spend-not-open',
        franchiseId: HUMAN,
        purpose: 'extra-trade-offer',
        windowIndex: 1,
      }),
      context,
    );
    if (notOpen.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(notOpen.result.result.rejection.code).toBe('window-not-open');

    const first = handleSeasonRunCommand(
      commandOf(run, {
        command: 'spend-influence',
        commandId: 'spend-twice-1',
        franchiseId: HUMAN,
        purpose: 'extra-trade-offer',
        windowIndex: 0,
      }),
      context,
    );
    if (first.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const second = handleSeasonRunCommand(
      commandOf(first.run, {
        command: 'spend-influence',
        commandId: 'spend-twice-2',
        franchiseId: HUMAN,
        purpose: 'extra-trade-offer',
        windowIndex: 0,
      }),
      { ...context, run: first.run },
    );
    if (second.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(second.result.result.rejection.code).toBe('already-spent');

    const noWindowBase = withClosedWindow(run, 0);
    const noWindowTrade = noWindowBase.trade;
    if (noWindowTrade === null) throw new Error('no trade state');
    const windowZero = noWindowTrade.windows[0];
    if (windowZero === undefined) throw new Error('no window 0');
    const noWindowRun: SeasonRun = {
      ...noWindowBase,
      trade: {
        ...noWindowTrade,
        windows: [
          { ...windowZero, windowIndex: 0 },
          { ...windowZero, windowIndex: 1 },
          { ...windowZero, windowIndex: 2 },
        ],
      },
    };
    const noWindow = handleSeasonRunCommand(
      commandOf(noWindowRun, {
        command: 'spend-influence',
        commandId: 'spend-no-window',
        franchiseId: HUMAN,
        purpose: 'extra-trade-offer',
        windowIndex: 0,
      }),
      { ...context, run: noWindowRun },
    );
    if (noWindow.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(noWindow.result.result.rejection.code).toBe('no-window');
  });

  it('accepts a risky-rehab spend on an active injury and records the outcome', () => {
    const { run, context } = windowedFixture();
    const humanRoster = run.rosters.find((roster) => roster.franchiseId === HUMAN);
    const version = humanRoster?.players[0]?.playerVersionId;
    if (version === undefined) throw new Error('no human player');
    const injuryId = injuryIdOf('command-rehab');
    const injured = withInjury(run, {
      injuryId,
      playerVersionId: version,
      franchiseId: HUMAN,
      gameId: 's000001',
      type: 'soft-tissue',
      severity: 'moderate',
      occurredBeforeHalftime: false,
      sameGameReturn: false,
      sameGameReturned: null,
      missedGamesTotal: 4,
      missedGamesRemaining: 4,
      actualReturnRound: null,
      seasonEnding: false,
      rehabModifier: 0,
      recurrenceWindowRoundsRemaining: 0,
      seedPath: ['injuries', 'test'],
    });
    const output = handleSeasonRunCommand(
      commandOf(injured, {
        command: 'spend-influence',
        commandId: 'spend-rehab-1',
        franchiseId: HUMAN,
        purpose: 'risky-rehab',
        injuryId,
      }),
      { ...context, run: injured },
    );
    const outputResult = output.result;
    if (outputResult.command !== 'spend-influence') throw new Error('unexpected command');
    const result = outputResult.result;
    if (result.status !== 'accepted') throw new Error('expected acceptance');
    expect(result.purpose).toBe('risky-rehab');
    expect(result.ledgerEntry.requestedDelta).toBe(-2);
    expect(result.ledgerEntry.balanceAfter).toBe(0);
    expect(result.generatedOffer).toBeNull();
    expect(output.run.influence.rehabs[injuryId]?.outcome).toBe('success');
    const record = output.run.health.injuries.find((injury) => injury.injuryId === injuryId);
    expect(record?.missedGamesRemaining).toBe(3);
    expect(output.run.stateRevision).toBe(injured.stateRevision + 1);
  });

  it('rejects injury-not-active and already-rehabbed', () => {
    const { run, context } = windowedFixture();
    const notActive = handleSeasonRunCommand(
      commandOf(run, {
        command: 'spend-influence',
        commandId: 'spend-not-active',
        franchiseId: HUMAN,
        purpose: 'risky-rehab',
        injuryId: injuryIdOf('missing-injury'),
      }),
      context,
    );
    if (notActive.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(notActive.result.result.rejection.code).toBe('injury-not-active');

    const humanRoster = run.rosters.find((roster) => roster.franchiseId === HUMAN);
    const version = humanRoster?.players[0]?.playerVersionId;
    if (version === undefined) throw new Error('no human player');
    const injuryId = injuryIdOf('command-rehab-2');
    const injured = withInjury(run, {
      injuryId,
      playerVersionId: version,
      franchiseId: HUMAN,
      gameId: 's000001',
      type: 'soft-tissue',
      severity: 'minor',
      occurredBeforeHalftime: false,
      sameGameReturn: false,
      sameGameReturned: null,
      missedGamesTotal: 2,
      missedGamesRemaining: 2,
      actualReturnRound: null,
      seasonEnding: false,
      rehabModifier: 0,
      recurrenceWindowRoundsRemaining: 0,
      seedPath: ['injuries', 'test'],
    });
    const already: SeasonRun = {
      ...injured,
      influence: {
        ...injured.influence,
        rehabs: {
          ...injured.influence.rehabs,
          [injuryId]: { franchiseId: HUMAN, outcome: 'pending', commandId: 'previous-rehab' },
        },
      },
    };
    const output = handleSeasonRunCommand(
      commandOf(already, {
        command: 'spend-influence',
        commandId: 'spend-rehab-again',
        franchiseId: HUMAN,
        purpose: 'risky-rehab',
        injuryId,
      }),
      { ...context, run: already },
    );
    if (output.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(output.result.result.rejection.code).toBe('already-rehabbed');
  });
});

describe('accept-trade-offer command', () => {
  it('applies an open offer atomically and reports both roster changes', () => {
    const { run, context } = windowedFixture();
    const offer = baseOfferOf(run);
    const command = commandOf(run, {
      command: 'accept-trade-offer',
      commandId: 'accept-offer-1',
      windowIndex: 0,
      offerId: offer.offerId,
    });
    const output = handleSeasonRunCommand(command, context);
    const outputResult = output.result;
    if (outputResult.command !== 'accept-trade-offer') throw new Error('unexpected command');
    const result = outputResult.result;
    if (result.status !== 'accepted') throw new Error('expected acceptance');
    expect(result.trade.offerId).toBe(offer.offerId);
    expect(result.trade.status).toBe('accepted');
    expect(result.rosterChanges).toHaveLength(2);
    expect(result.rosterChanges[0]?.franchiseId).toBe(HUMAN);
    expect(result.rosterChanges[1]?.franchiseId).toBe(offer.fromFranchiseId);
    expect(output.run.stateRevision).toBe(run.stateRevision + 1);
    const recorded = output.run.trade?.windows[0]?.offers.find(
      (entry) => entry.offerId === offer.offerId,
    );
    expect(recorded?.status).toBe('accepted');
    const tradeEntry = output.run.transactions[output.run.transactions.length - 1];
    expect(tradeEntry?.type).toBe('trade');
    expect(tradeEntry?.commandId).toBe('accept-offer-1');
  });

  it('rejects offer-unknown, window-not-open, and offer-not-open', () => {
    const { run, context } = windowedFixture();
    const offer = baseOfferOf(run);
    const unknown = handleSeasonRunCommand(
      commandOf(run, {
        command: 'accept-trade-offer',
        commandId: 'accept-unknown',
        windowIndex: 0,
        offerId: 'off-' + 'f'.repeat(32),
      }),
      context,
    );
    if (unknown.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(unknown.result.result.rejection.code).toBe('offer-unknown');

    // Window 0 exists but is closed: window-not-open (offer found, window shut).
    const closedTrade = withClosedWindow(run, 0);
    const notOpen = handleSeasonRunCommand(
      commandOf(closedTrade, {
        command: 'accept-trade-offer',
        commandId: 'accept-not-open',
        windowIndex: 0,
        offerId: offer.offerId,
      }),
      { ...context, run: closedTrade },
    );
    if (notOpen.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(notOpen.result.result.rejection.code).toBe('window-not-open');

    const declined = handleSeasonRunCommand(
      commandOf(run, {
        command: 'decline-trade-offer',
        commandId: 'decline-first',
        windowIndex: 0,
        offerId: offer.offerId,
      }),
      context,
    );
    if (declined.result.result.status !== 'accepted') throw new Error('expected decline');
    const acceptAfterDecline = handleSeasonRunCommand(
      commandOf(declined.run, {
        command: 'accept-trade-offer',
        commandId: 'accept-after-decline',
        windowIndex: 0,
        offerId: offer.offerId,
      }),
      { ...context, run: declined.run },
    );
    if (acceptAfterDecline.result.result.status !== 'rejected')
      throw new Error('expected rejection');
    expect(acceptAfterDecline.result.result.rejection.code).toBe('offer-not-open');
  });

  it('rejects ownership-conflict when a moved player is owned elsewhere', () => {
    const { run, context } = windowedFixture();
    const offer = baseOfferOf(run);
    const conflictingVersion = offer.outgoingPlayerVersionIds[0] ?? '';
    const tampered: SeasonRun = {
      ...run,
      ownership: run.ownership.map((row) =>
        row.playerVersionId === conflictingVersion ? { ...row, ownerFranchiseId: 'celtics' } : row,
      ),
    };
    const output = handleSeasonRunCommand(
      commandOf(tampered, {
        command: 'accept-trade-offer',
        commandId: 'accept-conflict',
        windowIndex: 0,
        offerId: offer.offerId,
      }),
      { ...context, run: tampered },
    );
    if (output.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(output.result.result.rejection.code).toBe('ownership-conflict');
  });

  it('rejects roster-illegal when the swap breaks ten-player legality', () => {
    const { run, context, catalog } = windowedFixture();
    const humanRoster = run.rosters.find((roster) => roster.franchiseId === HUMAN);
    const celticsRoster = run.rosters.find((roster) => roster.franchiseId === 'celtics');
    if (humanRoster === undefined || celticsRoster === undefined)
      throw new Error('missing rosters');
    const playableOf = (version: string): readonly string[] =>
      catalog.candidates.find((candidate) => candidate.playerVersionId === version)?.positions
        .playable ?? [];
    const centerCapable = humanRoster.players.filter((player) =>
      playableOf(player.playerVersionId).includes('C'),
    );
    if (centerCapable.length < 2) throw new Error('fixture human roster needs two centers');
    const outgoing = centerCapable.slice(0, 2).map((player) => player.playerVersionId);
    const pureGuards = celticsRoster.players.filter((player) =>
      playableOf(player.playerVersionId).every((position) => ['PG', 'SG'].includes(position)),
    );
    const incoming = pureGuards.slice(0, 2).map((player) => player.playerVersionId);
    if (outgoing.length < 2 || incoming.length < 2) throw new Error('fixture lacks swap players');
    const illegalOffer: SeasonTradeOffer = {
      offerId: 'off-' + 'e'.repeat(32),
      windowIndex: 0,
      seedPath: ['window', '0', 'offer', '9'],
      toFranchiseId: HUMAN,
      fromFranchiseId: 'celtics',
      outgoingPlayerVersionIds: outgoing,
      incomingPlayerVersionIds: incoming,
      outgoingHealth: outgoing.map(() => ({ available: true, activeInjuryIds: [] })),
      incomingHealth: incoming.map(() => ({ available: true, activeInjuryIds: [] })),
      valueBand: { ratioBasisPoints: 1000, band: '80-120', qualified: true },
      roleFit: { outgoingRoles: ['C', 'C'], incomingRoles: ['G', 'G'], notes: 'test' },
      rosterNeedFacts: { outgoingDepth: 3, incomingDepth: 2, notes: 'test' },
      projectedRotationChanges: 'test',
      projectedChemistryDisruption: { removedPairs: 17, newPairs: 17 },
      status: 'open',
    };
    const baseTrade = run.trade;
    if (baseTrade === null) throw new Error('no trade state');
    const windowZero = baseTrade.windows[0];
    if (windowZero === undefined) throw new Error('no window 0');
    const withOffer: SeasonRun = {
      ...run,
      trade: {
        ...baseTrade,
        windows: [{ ...windowZero, offers: [...windowZero.offers, illegalOffer] }],
      },
    };
    const output = handleSeasonRunCommand(
      commandOf(withOffer, {
        command: 'accept-trade-offer',
        commandId: 'accept-illegal',
        windowIndex: 0,
        offerId: illegalOffer.offerId,
      }),
      { ...context, run: withOffer },
    );
    if (output.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(output.result.result.rejection.code).toBe('roster-illegal');
  });
});

describe('decline-trade-offer command', () => {
  it('marks an open offer declined and advances the state chain', () => {
    const { run, context } = windowedFixture();
    const offer = baseOfferOf(run);
    const output = handleSeasonRunCommand(
      commandOf(run, {
        command: 'decline-trade-offer',
        commandId: 'decline-1',
        windowIndex: 0,
        offerId: offer.offerId,
      }),
      context,
    );
    const outputResult = output.result;
    if (outputResult.command !== 'decline-trade-offer') throw new Error('unexpected command');
    const result = outputResult.result;
    if (result.status !== 'accepted') throw new Error('expected acceptance');
    expect(result.offerId).toBe(offer.offerId);
    expect(output.run.stateRevision).toBe(run.stateRevision + 1);
    const recorded = output.run.trade?.windows[0]?.offers.find(
      (entry) => entry.offerId === offer.offerId,
    );
    expect(recorded?.status).toBe('declined');
    // No roster or ownership change.
    expect(output.run.rosters).toEqual(run.rosters);
    expect(output.run.ownership).toEqual(run.ownership);
  });

  it('rejects offer-unknown, window-not-open, and offer-not-open', () => {
    const { run, context } = windowedFixture();
    const offer = baseOfferOf(run);
    const unknown = handleSeasonRunCommand(
      commandOf(run, {
        command: 'decline-trade-offer',
        commandId: 'decline-unknown',
        windowIndex: 0,
        offerId: 'off-' + 'd'.repeat(32),
      }),
      context,
    );
    if (unknown.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(unknown.result.result.rejection.code).toBe('offer-unknown');

    // Window 0 exists but is closed: window-not-open.
    const closedTrade = withClosedWindow(run, 0);
    const notOpen = handleSeasonRunCommand(
      commandOf(closedTrade, {
        command: 'decline-trade-offer',
        commandId: 'decline-not-open',
        windowIndex: 0,
        offerId: offer.offerId,
      }),
      { ...context, run: closedTrade },
    );
    if (notOpen.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(notOpen.result.result.rejection.code).toBe('window-not-open');

    const first = handleSeasonRunCommand(
      commandOf(run, {
        command: 'decline-trade-offer',
        commandId: 'decline-twice-1',
        windowIndex: 0,
        offerId: offer.offerId,
      }),
      context,
    );
    if (first.result.result.status !== 'accepted') throw new Error('expected decline');
    const second = handleSeasonRunCommand(
      commandOf(first.run, {
        command: 'decline-trade-offer',
        commandId: 'decline-twice-2',
        windowIndex: 0,
        offerId: offer.offerId,
      }),
      { ...context, run: first.run },
    );
    if (second.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(second.result.result.rejection.code).toBe('offer-not-open');
  });
});

describe('resume-season-block command', () => {
  it('accepts a matching pending block without mutating the run', () => {
    const { run, context } = windowedFixture();
    const pending = pendingOf(run);
    const output = handleSeasonRunCommand(
      commandOf(run, {
        command: 'resume-season-block',
        commandId: 'resume-1',
        blockIndex: 3,
        rotationDigest: '0'.repeat(32),
      }),
      { ...context, run, pending },
    );
    const outputResult = output.result;
    if (outputResult.command !== 'resume-season-block') throw new Error('unexpected command');
    const result = outputResult.result;
    if (result.status !== 'accepted') throw new Error('expected acceptance');
    expect(result.nextGameId).toBe('s000301');
    expect(output.run).toBe(run);
    expect(output.pending).toBe(pending);
    expect(output.run.stateRevision).toBe(run.stateRevision);
  });

  it('rejects no-pending-block, block-mismatch, and rotation-digest-mismatch', () => {
    const { run, context } = windowedFixture();
    const pending = pendingOf(run);
    const noPending = handleSeasonRunCommand(
      commandOf(run, {
        command: 'resume-season-block',
        commandId: 'resume-nopending',
        blockIndex: 3,
        rotationDigest: '0'.repeat(32),
      }),
      context,
    );
    if (noPending.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(noPending.result.result.rejection.code).toBe('no-pending-block');

    const mismatch = handleSeasonRunCommand(
      commandOf(run, {
        command: 'resume-season-block',
        commandId: 'resume-mismatch',
        blockIndex: 4,
        rotationDigest: '0'.repeat(32),
      }),
      { ...context, run, pending },
    );
    if (mismatch.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(mismatch.result.result.rejection.code).toBe('block-mismatch');

    const digestMismatch = handleSeasonRunCommand(
      commandOf(run, {
        command: 'resume-season-block',
        commandId: 'resume-digest',
        blockIndex: 3,
        rotationDigest: '1'.repeat(32),
      }),
      { ...context, run, pending },
    );
    if (digestMismatch.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(digestMismatch.result.result.rejection.code).toBe('rotation-digest-mismatch');
  });
});

describe('forfeit-interrupted-game command', () => {
  it('accepts a matching forfeit, appends the summary, and advances the pending', () => {
    const { run, context } = windowedFixture();
    const pending = pendingOf(run);
    const output = handleSeasonRunCommand(
      commandOf(run, {
        command: 'forfeit-interrupted-game',
        commandId: 'forfeit-1',
        blockIndex: 3,
        nextGameId: 's000301',
      }),
      { ...context, run, pending },
    );
    const outputResult = output.result;
    if (outputResult.command !== 'forfeit-interrupted-game') throw new Error('unexpected command');
    const result = outputResult.result;
    if (result.status !== 'accepted') throw new Error('expected acceptance');
    expect(result.forfeitedGameId).toBe('s000301');
    expect(result.nextGameId).toBe('s000302');
    expect(output.pending?.summaries).toHaveLength(1);
    expect(output.pending?.summaries[0]?.status).toBe('forfeit');
    expect(output.pending?.summaries[0]?.forfeitLoserFranchiseId).toBe(HUMAN);
    expect(output.run.stateRevision).toBe(run.stateRevision + 1);
  });

  it('rejects no-pending-block, block-mismatch, and game-mismatch', () => {
    const { run, context } = windowedFixture();
    const pending = pendingOf(run);
    const noPending = handleSeasonRunCommand(
      commandOf(run, {
        command: 'forfeit-interrupted-game',
        commandId: 'forfeit-nopending',
        blockIndex: 3,
        nextGameId: 's000301',
      }),
      context,
    );
    if (noPending.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(noPending.result.result.rejection.code).toBe('no-pending-block');

    const mismatch = handleSeasonRunCommand(
      commandOf(run, {
        command: 'forfeit-interrupted-game',
        commandId: 'forfeit-mismatch',
        blockIndex: 4,
        nextGameId: 's000301',
      }),
      { ...context, run, pending },
    );
    if (mismatch.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(mismatch.result.result.rejection.code).toBe('block-mismatch');

    const gameMismatch = handleSeasonRunCommand(
      commandOf(run, {
        command: 'forfeit-interrupted-game',
        commandId: 'forfeit-gamemismatch',
        blockIndex: 3,
        nextGameId: 's000999',
      }),
      { ...context, run, pending },
    );
    if (gameMismatch.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(gameMismatch.result.result.rejection.code).toBe('game-mismatch');
  });
});

describe('command replay determinism', () => {
  it('produces identical outputs for identical inputs (accepted paths)', () => {
    const { run, context } = windowedFixture();
    const offer = baseOfferOf(run);
    const accept = commandOf(run, {
      command: 'accept-trade-offer',
      commandId: 'replay-accept',
      windowIndex: 0,
      offerId: offer.offerId,
    });
    const first = handleSeasonRunCommand(accept, context);
    const second = handleSeasonRunCommand(accept, { ...context, run: { ...run } });
    expect(first.result).toEqual(second.result);
    expect(first.run).toEqual(second.run);

    const declineCommand = commandOf(run, {
      command: 'decline-trade-offer',
      commandId: 'replay-decline',
      windowIndex: 0,
      offerId: offer.offerId,
    });
    const firstDecline = handleSeasonRunCommand(declineCommand, context);
    const secondDecline = handleSeasonRunCommand(declineCommand, { ...context, run: { ...run } });
    expect(firstDecline.result).toEqual(secondDecline.result);
    expect(firstDecline.run).toEqual(secondDecline.run);
  });

  it('rejected paths leave the run untouched and deterministic', () => {
    const { run, context } = windowedFixture();
    const offer = baseOfferOf(run);
    const command = commandOf(run, {
      command: 'accept-trade-offer',
      commandId: 'replay-rejected',
      windowIndex: 0,
      offerId: 'off-' + '9'.repeat(32),
    });
    const first = handleSeasonRunCommand(command, context);
    const second = handleSeasonRunCommand(command, context);
    expect(first).toEqual(second);
    // Rejected paths return the context run untouched (the engine-facing
    // view attaches the context effects state alongside the snapshot).
    expect(first.run).toEqual({ ...run, effects: context.effects });
    expect(first.result.result.status).toBe('rejected');
    void offer;
  });
});
