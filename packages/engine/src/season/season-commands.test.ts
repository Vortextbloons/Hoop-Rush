import { describe, expect, it, vi } from 'vitest';
import {
  playoffGameIdOf,
  seasonRunSchema,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGameEffectsTransition,
  type SeasonGameSimulationInput,
  type SeasonGameSimulationResult,
  type SeasonGameSideResult,
  type SeasonGameSummary,
  type SeasonPendingBlockCandidate,
  type SeasonRotation,
  type SeasonRun,
  type SeasonRunCommand,
  type SeasonTradeOffer,
  type Position,
} from '@hoop-rush/data-contracts';
import { buildEraSimulationProfile } from '@hoop-rush/test-fixtures';
import { buildEmptyCampaignState, normalizeCampaignState } from './campaign.ts';
import { handleSeasonRunCommand, type SeasonRunCommandContext } from './season-commands.ts';
import { seasonObjectiveChoicesForBlock } from './objectives.ts';
import { openSeasonTradeWindow } from './trades.ts';
import {
  buildEconomyTestRun,
  injuryIdOf,
  withInjury,
  zeroEffectsOf,
} from './season-economy-test-support.ts';
import { seasonPlayerAvailable } from './injuries.ts';
import { matchStartingFive } from './rotation.ts';
import { zeroSeasonGameTransition, type SeasonPostseasonGameResolver } from './postseason.ts';

vi.mock('./injuries.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./injuries.ts')>();
  return {
    ...original,

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
const TEST_SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';

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

type SeasonRunCommandFragment = {
  [K in SeasonRunCommand['command']]: Omit<
    Extract<SeasonRunCommand, { command: K }>,
    'schemaVersion' | 'runId' | 'expectedStateRevision' | 'expectedStateDigest'
  >;
}[SeasonRunCommand['command']];

function commandOf(run: SeasonRun, command: SeasonRunCommandFragment): SeasonRunCommand {
  return {
    schemaVersion: 11,
    runId: run.runId,
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
    ...command,
  };
}

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
    blockVersion: 'season-block-v5',
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
      rehabModifier: 0 as const,
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
      rehabModifier: 0 as const,
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

    const nonCenters = celticsRoster.players.filter(
      (player) => !playableOf(player.playerVersionId).includes('C'),
    );
    const incoming = nonCenters.slice(0, 2).map((player) => player.playerVersionId);
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

    expect(first.run).toEqual({ ...run, effects: context.effects });
    expect(first.result.result.status).toBe('rejected');
    void offer;
  });
});

function forcedCompletedResult(
  gameInput: SeasonGameSimulationInput,
  homeScore: number,
  awayScore: number,
  pregameEffects: SeasonEffectsState,
): { result: SeasonGameSimulationResult; transition: SeasonGameEffectsTransition } {
  const homeWon = homeScore > awayScore;
  const sideOf = (side: 'home' | 'away', score: number): SeasonGameSideResult => {
    const team = side === 'home' ? gameInput.home : gameInput.away;
    const fgm = Math.floor(score / 2);
    const ftm = score % 2;
    return {
      teamId: team.teamId,
      displayName: team.displayName,
      franchiseId: team.franchiseId,
      score,
      periodScores: [score],
      box: {
        points: score,
        fieldGoals: { made: fgm, attempted: fgm },
        threes: { made: 0, attempted: 0 },
        freeThrows: { made: ftm, attempted: ftm },
        rebounds: { total: 0, offensive: 0, defensive: 0, team: 0 },
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        possessions: 60,
        diagnostics: {
          assistedFieldGoals: 0,
          unassistedFieldGoals: fgm,
          reboundOpportunities: 0,
          contestedShots: 0,
        },
      },
      players: team.players.map((player, index) => ({
        playerVersionId: player.playerVersionId,
        playerId: player.playerId,
        seconds: 1440,
        minutes: 24,
        points: index === 0 ? score : 0,
        fieldGoals: { made: index === 0 ? fgm : 0, attempted: index === 0 ? fgm : 0 },
        threes: { made: 0, attempted: 0 },
        freeThrows: { made: index === 0 ? ftm : 0, attempted: index === 0 ? ftm : 0 },
        rebounds: { total: 0, offensive: 0, defensive: 0 },
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        diagnostics: {
          usage: 0,
          shotZones: [],
          assistOpportunities: 0,
          offensiveReboundChances: 0,
          defensiveReboundChances: 0,
          contestedShots: 0,
        },
      })),
      shotZones: [],
      returns: [],
    };
  };
  return {
    result: {
      schemaVersion: 1,
      outcome: 'completed',
      seed: gameInput.seed,
      gameNumber: gameInput.gameNumber,
      dataVersion: gameInput.dataVersion,
      engineVersion: 'engine-v1',
      profileVersion: gameInput.profile.profileVersion,
      winner: homeWon ? 'home' : 'away',
      overtimePeriods: 0,
      home: sideOf('home', homeScore),
      away: sideOf('away', awayScore),
      substitutions: [],
      unitStints: [],
      deviations: [],
      foulOuts: [],
      removals: [],
    },
    transition: zeroSeasonGameTransition(pregameEffects),
  };
}

function forcedPostseasonResolver(
  plan: (home: string, away: string, gameId: string) => 'home' | 'away',
): SeasonPostseasonGameResolver {
  return ({ gameId, gameInput, pregameEffects }) => {
    const winnerSide = plan(gameInput.home.franchiseId, gameInput.away.franchiseId, gameId);
    return forcedCompletedResult(
      gameInput,
      winnerSide === 'home' ? 110 : 90,
      winnerSide === 'home' ? 90 : 110,
      pregameEffects,
    );
  };
}

function humanWinsEveryGame(home: string, away: string): 'home' | 'away' {
  if (home === HUMAN) return 'home';
  if (away === HUMAN) return 'away';
  return 'home';
}

function homeTeamWinsEveryGame(): 'home' {
  return 'home';
}

function eastTopTen(league: SeasonRun['league']): string[] {
  return league.teams
    .filter((team) => team.conference === 'east')
    .map((team) => team.franchiseId)
    .slice(0, 10);
}

function westTopTenWithout(league: SeasonRun['league'], excluded: string): string[] {
  return league.teams
    .filter((team) => team.conference === 'west')
    .map((team) => team.franchiseId)
    .filter((id) => id !== excluded)
    .slice(0, 10);
}

function postseasonFixture(
  options: {
    seed?: string;
    resolver?: SeasonPostseasonGameResolver;
    rankings?: (input: {
      league: SeasonRun['league'];
      standings: SeasonRun['standings'];
      seed: string;
    }) => { east: string[]; west: string[] };

    regularSeasonSummaries?: SeasonGameSummary[];
  } = {},
): SeasonRunCommandContext & {
  run: SeasonRun;
  catalog: SeasonDraftCatalog;
  profile: ReturnType<typeof buildEraSimulationProfile>;
} {
  const { run: base, catalog } = buildEconomyTestRun({ seed: options.seed });
  const run: SeasonRun = {
    ...base,
    cursor: { schemaVersion: 1, completedRounds: 82 },
  };
  return {
    run,
    pending: null,
    humanFranchiseId: HUMAN,
    catalog,
    effects: zeroEffectsOf(run),
    profile: buildEraSimulationProfile(),
    regularSeasonSummaries: options.regularSeasonSummaries,
    rankings:
      options.rankings ??
      (({ league }) => ({
        east: eastTopTen(league),
        west: [
          ...westTopTenWithout(league, HUMAN).slice(0, 6),
          HUMAN,
          ...westTopTenWithout(league, HUMAN).slice(6, 9),
        ],
      })),
    postseasonGameResolver: options.resolver ?? forcedPostseasonResolver(homeTeamWinsEveryGame),
  };
}

function regularSeasonSummariesOf(run: SeasonRun): SeasonGameSummary[] {
  const rosterByFranchise = new Map(run.rosters.map((roster) => [roster.franchiseId, roster]));
  const linesOf = (franchiseId: string) => {
    const roster = rosterByFranchise.get(franchiseId);
    if (roster === undefined) throw new Error(`no roster for ${franchiseId}`);
    return roster.players.map((player, index) => ({
      playerVersionId: player.playerVersionId,
      seconds: 2880 - index * 120,
      started: index < 5,
      points: 20 - index,
      fieldGoalsMade: 8 - index,
      fieldGoalsAttempted: 16 - index,
      threePointersMade: 2,
      threePointersAttempted: 5,
      freeThrowsMade: 4,
      freeThrowsAttempted: 5,
      offensiveRebounds: 1,
      defensiveRebounds: 5 - Math.floor(index / 3),
      assists: 6 - Math.floor(index / 2),
      steals: 1,
      blocks: 1,
      turnovers: 2,
      fouls: 2,
    }));
  };
  return run.games
    .filter((game) => game.round === 1)
    .map((game) => {
      const homePlayers = linesOf(game.homeFranchiseId);
      const awayPlayers = linesOf(game.awayFranchiseId);
      const boxOf = (franchiseId: string, players: ReturnType<typeof linesOf>) => ({
        franchiseId,
        points: players.reduce((sum, line) => sum + line.points, 0),
        fieldGoalsMade: players.reduce((sum, line) => sum + line.fieldGoalsMade, 0),
        fieldGoalsAttempted: players.reduce((sum, line) => sum + line.fieldGoalsAttempted, 0),
        threePointersMade: players.reduce((sum, line) => sum + line.threePointersMade, 0),
        threePointersAttempted: players.reduce((sum, line) => sum + line.threePointersAttempted, 0),
        freeThrowsMade: players.reduce((sum, line) => sum + line.freeThrowsMade, 0),
        freeThrowsAttempted: players.reduce((sum, line) => sum + line.freeThrowsAttempted, 0),
        offensiveRebounds: players.reduce((sum, line) => sum + line.offensiveRebounds, 0),
        defensiveRebounds: players.reduce((sum, line) => sum + line.defensiveRebounds, 0),
        assists: players.reduce((sum, line) => sum + line.assists, 0),
        steals: players.reduce((sum, line) => sum + line.steals, 0),
        blocks: players.reduce((sum, line) => sum + line.blocks, 0),
        turnovers: players.reduce((sum, line) => sum + line.turnovers, 0),
        fouls: players.reduce((sum, line) => sum + line.fouls, 0),
        possessions: 100,
      });
      return {
        schemaVersion: 1,
        summaryVersion: 'season-game-summary-v3',
        gameId: game.gameId,
        round: game.round,
        homeFranchiseId: game.homeFranchiseId,
        awayFranchiseId: game.awayFranchiseId,
        status: 'final' as const,
        overtimePeriods: 0,
        homeScore: boxOf(game.homeFranchiseId, homePlayers).points,
        awayScore: boxOf(game.awayFranchiseId, awayPlayers).points,
        forfeitLoserFranchiseId: null,
        injuryEvents: [],
        homeBox: boxOf(game.homeFranchiseId, homePlayers),
        awayBox: boxOf(game.awayFranchiseId, awayPlayers),
        homePlayers,
        awayPlayers,
      } satisfies SeasonGameSummary;
    });
}

function restedRotation(run: SeasonRun, franchiseId: string, catalog: SeasonDraftCatalog) {
  const saved = run.rotations.find((rotation) => rotation.franchiseId === franchiseId);
  if (saved === undefined) throw new Error(`no rotation for ${franchiseId}`);
  const roster = run.rosters.find((entry) => entry.franchiseId === franchiseId);
  if (roster === undefined) throw new Error(`no roster for ${franchiseId}`);
  const playableOf = new Map<string, readonly Position[]>();
  for (const player of roster.players) {
    const candidate = catalog.candidates.find(
      (entry) => entry.playerVersionId === player.playerVersionId,
    );
    playableOf.set(player.playerVersionId, candidate?.positions.playable ?? []);
  }
  const members = roster.players.map((player) => ({
    playerVersionId: player.playerVersionId,
    playable: playableOf.get(player.playerVersionId) ?? [],
  }));
  const available = members.filter((member) =>
    seasonPlayerAvailable(run.health, member.playerVersionId),
  );
  const starters = matchStartingFive(available);
  if (starters === null) throw new Error(`no legal five available for ${franchiseId}`);
  const starterIds = new Set(starters.map((starter) => starter.playerVersionId));
  const benchAvailable = available.filter((member) => !starterIds.has(member.playerVersionId));
  const benchInjured = members.filter(
    (member) => !starterIds.has(member.playerVersionId) && !available.includes(member),
  );
  const plan = new Map<string, number>();
  for (const starter of starters) plan.set(starter.playerVersionId, 32);
  for (const member of benchAvailable) plan.set(member.playerVersionId, 16);
  for (const member of benchInjured) plan.set(member.playerVersionId, 0);
  const capacity = (id: string): number => 48 - (plan.get(id) ?? 0);
  let total = [...plan.values()].reduce((sum, value) => sum + value, 0);
  const orderedIds = [...plan.keys()].sort();
  for (;;) {
    if (total >= 240) break;
    const candidate = orderedIds.find((id) => capacity(id) > 0);
    if (candidate === undefined) throw new Error(`cannot fill 240 minutes for ${franchiseId}`);
    plan.set(candidate, (plan.get(candidate) ?? 0) + 1);
    total += 1;
  }
  return {
    ...saved,
    starters: starters.map((starter) => starter.playerVersionId),
    benchOrder: [...benchAvailable, ...benchInjured].map((member) => member.playerVersionId),
    targetMinutes: roster.players.map((player) => ({
      playerVersionId: player.playerVersionId,
      minutes: plan.get(player.playerVersionId) ?? 0,
    })),
    closingFive: starters.map((starter) => starter.playerVersionId),
  };
}

function expectSchemaValidRun(run: SeasonRun): void {
  const parsed = seasonRunSchema.safeParse(run);
  if (!parsed.success) {
    throw new Error(`run fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
}

describe('start-postseason command', () => {
  it('accepts from a completed regular season and moves to the play-in stage', () => {
    const context = postseasonFixture();
    const output = handleSeasonRunCommand(
      commandOf(context.run, { command: 'start-postseason', commandId: 'start-1' }),
      context,
    );
    const outputResult = output.result;
    if (outputResult.command !== 'start-postseason') throw new Error('unexpected command');
    const result = outputResult.result;
    if (result.status !== 'accepted') throw new Error('expected acceptance');
    expect(result.stage).toBe('play-in');
    expect(result.postseasonSeed).toMatch(/^[0-9a-f]{16,64}$/);
    expect(result.nextGameId).toBe('pi-east-seven-eight');
    expect(output.run.stage).toBe('play-in');
    expect(output.run.postseason.playIn.east.ranking).toHaveLength(10);
    expect(output.run.postseason.playIn.west.ranking).toHaveLength(10);
    expect(output.run.stateRevision).toBe(context.run.stateRevision + 1);
    expectSchemaValidRun(output.run);
  });

  it('rejects an incomplete regular season and a run that already started', () => {
    const context = postseasonFixture();
    const incomplete = {
      ...context.run,
      cursor: { schemaVersion: 1 as const, completedRounds: 80 },
    };
    const incompleteOutput = handleSeasonRunCommand(
      commandOf(incomplete, { command: 'start-postseason', commandId: 'start-incomplete' }),
      { ...context, run: incomplete },
    );
    if (incompleteOutput.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(incompleteOutput.result.result.rejection.code).toBe('invalid-stage');
    const started = handleSeasonRunCommand(
      commandOf(context.run, { command: 'start-postseason', commandId: 'start-1' }),
      context,
    );
    if (started.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const again = handleSeasonRunCommand(
      commandOf(started.run, { command: 'start-postseason', commandId: 'start-2' }),
      { ...context, run: started.run },
    );
    if (again.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(again.result.result.rejection.code).toBe('invalid-stage');
  });

  it('rejects invalid rankings with integrity-failure and a stale state', () => {
    const context = postseasonFixture();
    const badRankings = postseasonFixture({
      rankings: ({ league }) => ({
        east: eastTopTen(league),

        west: [...westTopTenWithout(league, HUMAN).slice(0, 9), ...eastTopTen(league).slice(0, 1)],
      }),
    });
    const output = handleSeasonRunCommand(
      commandOf(context.run, { command: 'start-postseason', commandId: 'start-bad' }),
      badRankings,
    );
    if (output.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(output.result.result.rejection.code).toBe('integrity-failure');
    const stale = handleSeasonRunCommand(
      commandOf(
        { ...context.run, stateRevision: context.run.stateRevision + 5 },
        { command: 'start-postseason', commandId: 'start-stale' },
      ),
      context,
    );
    if (stale.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(stale.result.result.rejection.code).toBe('stale-state');
  });

  it('rejects a run mismatch', () => {
    const context = postseasonFixture();
    const other = buildEconomyTestRun({ runId: 'other-run' }).run;
    const mismatch = handleSeasonRunCommand(
      commandOf(other, { command: 'start-postseason', commandId: 'start-mismatch' }),
      context,
    );
    if (mismatch.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(mismatch.result.result.rejection.code).toBe('run-mismatch');
  });
});

describe('advance-postseason command', () => {
  it('runs the whole tournament when the human rotation stays valid', () => {
    const context = postseasonFixture({
      seed: TEST_SEED,
      resolver: forcedPostseasonResolver(humanWinsEveryGame),
    });
    const start = handleSeasonRunCommand(
      commandOf(context.run, { command: 'start-postseason', commandId: 'start-1' }),
      context,
    );
    if (start.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const output = handleSeasonRunCommand(
      commandOf(start.run, { command: 'advance-postseason', commandId: 'adv-1' }),
      { ...context, run: start.run },
    );
    const outputResult = output.result;
    if (outputResult.command !== 'advance-postseason') throw new Error('unexpected command');
    const result = outputResult.result;
    if (result.status !== 'accepted') throw new Error('expected acceptance');

    expect(result.stage).toBe('completed');
    expect(result.nextDecision).toBe('none');
    expect(result.advancedGameIds).toContain('pi-east-seven-eight');
    expect(result.advancedGameIds).toContain('pi-west-seven-eight');
    expect(result.advancedGameIds).toContain(playoffGameIdOf('finals', 1));
    expect(output.run.stage).toBe('completed');
    expectSchemaValidRun(output.run);
  });

  it('derives the season awards from the recorded summaries when the tournament completes', () => {
    const context = postseasonFixture({
      seed: TEST_SEED,
      resolver: forcedPostseasonResolver(humanWinsEveryGame),
      regularSeasonSummaries: regularSeasonSummariesOf(postseasonFixture().run),
    });
    const start = handleSeasonRunCommand(
      commandOf(context.run, { command: 'start-postseason', commandId: 'start-1' }),
      context,
    );
    if (start.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const output = handleSeasonRunCommand(
      commandOf(start.run, { command: 'advance-postseason', commandId: 'adv-1' }),
      { ...context, run: start.run },
    );
    const outputResult = output.result;
    if (outputResult.command !== 'advance-postseason') throw new Error('unexpected command');
    const result = outputResult.result;
    if (result.status !== 'accepted') throw new Error('expected acceptance');
    expect(result.stage).toBe('completed');

    const awards = output.run.awards;
    expect(awards).not.toBeNull();
    expect(awards?.runId).toBe(output.run.runId);
    expect(awards?.allLeagueFirstTeam).toHaveLength(5);
    const leagueFranchises = new Set(output.run.league.teams.map((team) => team.franchiseId));
    expect(leagueFranchises.has(awards?.mvp.franchiseId ?? '')).toBe(true);
    expect(output.run.completion?.championFranchiseId).toBe(HUMAN);
    expectSchemaValidRun(output.run);
  });

  it('stops at a human game whose rotation plans minutes for injured players', () => {
    const context = postseasonFixture({ resolver: forcedPostseasonResolver(humanWinsEveryGame) });
    const start = handleSeasonRunCommand(
      commandOf(context.run, { command: 'start-postseason', commandId: 'start-1' }),
      context,
    );
    if (start.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const humanRoster = start.run.rosters.find((roster) => roster.franchiseId === HUMAN);
    if (humanRoster === undefined) throw new Error('no human roster');
    const injuries = humanRoster.players.slice(0, 2).map((player, index) => ({
      injuryId: `inj-${'9'.repeat(31)}${String(index)}`,
      playerVersionId: player.playerVersionId,
      franchiseId: HUMAN,
      gameId: 's000001',
      type: 'lower-body' as const,
      severity: 'season-ending' as const,
      occurredBeforeHalftime: true,
      sameGameReturn: false,
      sameGameReturned: null,
      missedGamesTotal: 999,
      missedGamesRemaining: 999,
      actualReturnRound: null,
      seasonEnding: true,
      rehabModifier: 0 as const,
      recurrenceWindowRoundsRemaining: 0,
      seedPath: ['injuries', 's000001', player.playerVersionId, 'occurrence'],
    }));
    const injured = { ...start.run, health: { ...start.run.health, injuries } };
    const output = handleSeasonRunCommand(
      commandOf(injured, { command: 'advance-postseason', commandId: 'adv-1' }),
      { ...context, run: injured },
    );
    const outputResult = output.result;
    if (outputResult.command !== 'advance-postseason') throw new Error('unexpected command');
    const result = outputResult.result;
    if (result.status !== 'accepted') throw new Error('expected acceptance');
    expect(result.nextDecision).toBe('rotation');
    expect(result.nextGameId).toBe('pi-west-seven-eight');
    expect(result.advancedGameIds).toEqual([
      'pi-east-seven-eight',
      'pi-east-nine-ten',
      'pi-east-final',
    ]);
    expect(result.aiNextGameId).toBeNull();
  });

  it('rejects wrong-game targets, invalid stages, and stale states', () => {
    const context = postseasonFixture();
    const start = handleSeasonRunCommand(
      commandOf(context.run, { command: 'start-postseason', commandId: 'start-1' }),
      context,
    );
    if (start.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const firstAdvance = handleSeasonRunCommand(
      commandOf(start.run, {
        command: 'advance-postseason',
        commandId: 'adv-first',
        targetGameId: 'pi-east-nine-ten',
      }),
      { ...context, run: start.run },
    );
    if (firstAdvance.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const wrongGame = handleSeasonRunCommand(
      commandOf(firstAdvance.run, {
        command: 'advance-postseason',
        commandId: 'adv-wrong',

        targetGameId: 'pi-east-seven-eight',
      }),
      { ...context, run: firstAdvance.run },
    );
    if (wrongGame.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(wrongGame.result.result.rejection.code).toBe('wrong-game');
    if (wrongGame.result.result.rejection.code !== 'wrong-game') throw new Error('unexpected');
    expect(wrongGame.result.result.rejection.nextGameId).toBe('pi-east-final');
    const wrongStage = handleSeasonRunCommand(
      commandOf(context.run, { command: 'advance-postseason', commandId: 'adv-stage' }),
      context,
    );
    if (wrongStage.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(wrongStage.result.result.rejection.code).toBe('invalid-stage');
    const stale = handleSeasonRunCommand(
      commandOf(
        { ...start.run, stateRevision: start.run.stateRevision + 3 },
        { command: 'advance-postseason', commandId: 'adv-stale' },
      ),
      { ...context, run: start.run },
    );
    if (stale.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(stale.result.result.rejection.code).toBe('stale-state');
  });
});

describe('submit-postseason-rotation command', () => {
  function humanInjuredRun(context: SeasonRunCommandContext): SeasonRun {
    const humanRoster = context.run.rosters.find((roster) => roster.franchiseId === HUMAN);
    if (humanRoster === undefined) throw new Error('no human roster');
    const injuries = humanRoster.players.slice(0, 2).map((player, index) => ({
      injuryId: `inj-${'7'.repeat(31)}${String(index)}`,
      playerVersionId: player.playerVersionId,
      franchiseId: HUMAN,
      gameId: 's000001',
      type: 'lower-body' as const,
      severity: 'season-ending' as const,
      occurredBeforeHalftime: true,
      sameGameReturn: false,
      sameGameReturned: null,
      missedGamesTotal: 999,
      missedGamesRemaining: 999,
      actualReturnRound: null,
      seasonEnding: true,
      rehabModifier: 0 as const,
      recurrenceWindowRoundsRemaining: 0,
      seedPath: ['injuries', 's000001', player.playerVersionId, 'occurrence'],
    }));
    return { ...context.run, health: { ...context.run.health, injuries } };
  }

  function advancedToHumanGame(): {
    context: SeasonRunCommandContext & { catalog: SeasonDraftCatalog };
    run: SeasonRun;
  } {
    const context = postseasonFixture({ resolver: forcedPostseasonResolver(humanWinsEveryGame) });
    const start = handleSeasonRunCommand(
      commandOf(context.run, { command: 'start-postseason', commandId: 'start-1' }),
      context,
    );
    if (start.result.result.status !== 'accepted') throw new Error('expected acceptance');

    const injured = humanInjuredRun({ ...context, run: start.run });
    const advance = handleSeasonRunCommand(
      commandOf(injured, { command: 'advance-postseason', commandId: 'adv-1' }),
      { ...context, run: injured },
    );
    const advanceResult = advance.result;
    if (advanceResult.command !== 'advance-postseason') throw new Error('unexpected command');
    if (advanceResult.result.status !== 'accepted') throw new Error('expected acceptance');
    if (
      advanceResult.result.nextDecision !== 'rotation' ||
      advanceResult.result.nextGameId === null
    ) {
      throw new Error('expected a rotation decision');
    }
    return { context: { ...context, run: advance.run }, run: advance.run };
  }

  it('accepts a legal rotation and locks it into the run', () => {
    const { context, run } = advancedToHumanGame();
    const rotation = restedRotation(run, HUMAN, context.catalog);
    const output = handleSeasonRunCommand(
      commandOf(run, {
        command: 'submit-postseason-rotation',
        commandId: 'sub-1',
        targetGameId: 'pi-west-seven-eight',
        rotation: { franchiseId: HUMAN, rotation },
      }),
      context,
    );
    const outputResult = output.result;
    if (outputResult.command !== 'submit-postseason-rotation')
      throw new Error('unexpected command');
    const result = outputResult.result;
    if (result.status !== 'accepted') throw new Error('expected acceptance');
    expect(result.targetGameId).toBe('pi-west-seven-eight');
    expect(result.franchiseId).toBe(HUMAN);
    expect(result.rotationDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(output.run.rotations.find((entry) => entry.franchiseId === HUMAN)).toEqual(rotation);
    expect(output.run.stateRevision).toBe(run.stateRevision + 1);
    expectSchemaValidRun(output.run);
  });

  it('applies a risky-rehab spend with the recorded ledger entry and transaction', () => {
    const { context, run } = advancedToHumanGame();
    const rotation = restedRotation(run, HUMAN, context.catalog);
    const humanRoster = run.rosters.find((roster) => roster.franchiseId === HUMAN);
    if (humanRoster === undefined) throw new Error('no human roster');
    const player = humanRoster.players[0];
    if (player === undefined) throw new Error('no player');
    const injuryId = injuryIdOf('postseason-rehab');
    const withInjuryRun = withInjury(run, {
      injuryId,
      playerVersionId: player.playerVersionId,
      franchiseId: HUMAN,
      gameId: 's000001',
      type: 'lower-body',
      severity: 'moderate',
      occurredBeforeHalftime: true,
      sameGameReturn: false,
      sameGameReturned: null,
      missedGamesTotal: 4,
      missedGamesRemaining: 4,
      actualReturnRound: null,
      seasonEnding: false,
      rehabModifier: 0 as const,
      recurrenceWindowRoundsRemaining: 0,
      seedPath: [
        'postseason-injuries',
        'pi-west-seven-eight',
        player.playerVersionId,
        'occurrence',
      ],
    });
    const output = handleSeasonRunCommand(
      commandOf(withInjuryRun, {
        command: 'submit-postseason-rotation',
        commandId: 'sub-rehab',
        targetGameId: 'pi-west-seven-eight',
        rotation: { franchiseId: HUMAN, rotation, riskyRehabInjuryId: injuryId },
      }),
      { ...context, run: withInjuryRun },
    );
    const outputResult = output.result;
    if (outputResult.command !== 'submit-postseason-rotation')
      throw new Error('unexpected command');
    if (outputResult.result.status !== 'accepted') throw new Error('expected acceptance');
    const ledgerEntry = output.run.influence.ledger.find(
      (entry) => entry.commandId === 'sub-rehab',
    );
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry?.source).toBe('risky-rehab');
    expect(ledgerEntry?.requestedDelta).toBe(-2);
    const balanceAfter = output.run.influence.balances[HUMAN];
    expect(balanceAfter).toBe((context.run.influence.balances[HUMAN] ?? 0) - 2);
    expect(output.run.transactions.some((entry) => entry.commandId === 'sub-rehab')).toBe(true);
    const injuryAfter = output.run.health.injuries.find((entry) => entry.injuryId === injuryId);
    expect(injuryAfter?.rehabModifier).not.toBe(0);
    expectSchemaValidRun(output.run);
  });

  it('rejects wrong-game targets, invalid rotations, unavailable players, and rehab balance', () => {
    const { context, run } = advancedToHumanGame();
    const rotation = restedRotation(run, HUMAN, context.catalog);

    const wrongTarget = handleSeasonRunCommand(
      commandOf(run, {
        command: 'submit-postseason-rotation',
        commandId: 'sub-wrongtarget',
        targetGameId: 'pi-east-final',
        rotation: { franchiseId: HUMAN, rotation },
      }),
      context,
    );
    if (wrongTarget.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(wrongTarget.result.result.rejection.code).toBe('wrong-game');

    const broken: SeasonRotation = {
      ...rotation,
      starters: [
        rotation.starters[0] ?? '',
        rotation.starters[0] ?? '',
        ...rotation.starters.slice(2),
      ],
    };
    const invalidRotation = handleSeasonRunCommand(
      commandOf(run, {
        command: 'submit-postseason-rotation',
        commandId: 'sub-invalid',
        targetGameId: 'pi-west-seven-eight',
        rotation: { franchiseId: HUMAN, rotation: broken },
      }),
      context,
    );
    if (invalidRotation.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(invalidRotation.result.result.rejection.code).toBe('invalid-rotation');

    const humanRoster = run.rosters.find((roster) => roster.franchiseId === HUMAN);
    if (humanRoster === undefined) throw new Error('no human roster');
    const player = humanRoster.players[0];
    if (player === undefined) throw new Error('no player');
    const withInjuryRun = withInjury(run, {
      injuryId: injuryIdOf('postseason-unavailable'),
      playerVersionId: player.playerVersionId,
      franchiseId: HUMAN,
      gameId: 's000001',
      type: 'lower-body',
      severity: 'moderate',
      occurredBeforeHalftime: true,
      sameGameReturn: false,
      sameGameReturned: null,
      missedGamesTotal: 3,
      missedGamesRemaining: 3,
      actualReturnRound: null,
      seasonEnding: false,
      rehabModifier: 0 as const,
      recurrenceWindowRoundsRemaining: 0,
      seedPath: [
        'postseason-injuries',
        'pi-west-seven-eight',
        player.playerVersionId,
        'occurrence',
      ],
    });

    const saved = run.rotations.find((entry) => entry.franchiseId === HUMAN);
    if (saved === undefined) throw new Error('no human rotation');
    const unavailable = handleSeasonRunCommand(
      commandOf(withInjuryRun, {
        command: 'submit-postseason-rotation',
        commandId: 'sub-unavailable',
        targetGameId: 'pi-west-seven-eight',
        rotation: { franchiseId: HUMAN, rotation: saved },
      }),
      { ...context, run: withInjuryRun },
    );
    if (unavailable.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(unavailable.result.result.rejection.code).toBe('unavailable-player');

    const poor = {
      ...withInjuryRun,
      influence: {
        ...withInjuryRun.influence,
        balances: { ...withInjuryRun.influence.balances, [HUMAN]: -2 },
      },
    };
    const insufficient = handleSeasonRunCommand(
      commandOf(poor, {
        command: 'submit-postseason-rotation',
        commandId: 'sub-poor',
        targetGameId: 'pi-west-seven-eight',
        rotation: {
          franchiseId: HUMAN,
          rotation,
          riskyRehabInjuryId: injuryIdOf('postseason-unavailable'),
        },
      }),
      { ...context, run: poor },
    );
    if (insufficient.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(insufficient.result.result.rejection.code).toBe('insufficient-rehab-resources');
    expect(insufficient.result.result.rejection).toMatchObject({ required: 2 });

    const rehabRun = withInjury(run, {
      injuryId: injuryIdOf('postseason-duplicate'),
      playerVersionId: player.playerVersionId,
      franchiseId: HUMAN,
      gameId: 's000001',
      type: 'lower-body',
      severity: 'moderate',
      occurredBeforeHalftime: true,
      sameGameReturn: false,
      sameGameReturned: null,
      missedGamesTotal: 3,
      missedGamesRemaining: 3,
      actualReturnRound: null,
      seasonEnding: false,
      rehabModifier: 0 as const,
      recurrenceWindowRoundsRemaining: 0,
      seedPath: [
        'postseason-injuries',
        'pi-west-seven-eight',
        player.playerVersionId,
        'occurrence',
      ],
    });
    const rehabCommand = commandOf(rehabRun, {
      command: 'submit-postseason-rotation',
      commandId: 'sub-duplicate',
      targetGameId: 'pi-west-seven-eight',
      rotation: {
        franchiseId: HUMAN,
        rotation,
        riskyRehabInjuryId: injuryIdOf('postseason-duplicate'),
      },
    });
    const firstRehab = handleSeasonRunCommand(rehabCommand, { ...context, run: rehabRun });
    if (firstRehab.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const duplicate = handleSeasonRunCommand(rehabCommand, { ...context, run: firstRehab.run });
    if (duplicate.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(duplicate.result.result.rejection.code).toBe('duplicate-command');
  });
});

describe('spectate-postseason-game command', () => {
  it('spectates the current game after elimination and rejects wrong targets', () => {
    const context = postseasonFixture({
      resolver: forcedPostseasonResolver((home, away) => {
        if (home === HUMAN) return 'away';
        if (away === HUMAN) return 'home';
        return 'home';
      }),
    });
    const start = handleSeasonRunCommand(
      commandOf(context.run, { command: 'start-postseason', commandId: 'start-1' }),
      context,
    );
    if (start.result.result.status !== 'accepted') throw new Error('expected acceptance');

    const advance = handleSeasonRunCommand(
      commandOf(start.run, {
        command: 'advance-postseason',
        commandId: 'adv-1',
        targetGameId: 'po-west-first-round-1-g1',
      }),
      { ...context, run: start.run },
    );
    const advanceResult = advance.result;
    if (advanceResult.command !== 'advance-postseason') throw new Error('unexpected command');
    if (advanceResult.result.status !== 'accepted') throw new Error('expected acceptance');

    const wrongTarget = handleSeasonRunCommand(
      commandOf(advance.run, {
        command: 'spectate-postseason-game',
        commandId: 'spec-wrong',
        targetGameId: 'po-west-first-round-1-g5',
      }),
      { ...context, run: advance.run },
    );
    if (wrongTarget.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(wrongTarget.result.result.rejection.code).toBe('wrong-game');

    const output = handleSeasonRunCommand(
      commandOf(advance.run, {
        command: 'spectate-postseason-game',
        commandId: 'spec-1',
        targetGameId: 'po-west-first-round-1-g2',
      }),
      { ...context, run: advance.run },
    );
    const outputResult = output.result;
    if (outputResult.command !== 'spectate-postseason-game') throw new Error('unexpected command');
    const result = outputResult.result;
    if (result.status !== 'accepted') throw new Error('expected acceptance');
    expect(result.advancedGameIds).toEqual(['po-west-first-round-1-g2']);
    expect(output.postseasonSummaries?.[0]?.gameId).toBe('po-west-first-round-1-g2');
    expect(output.run.stateRevision).toBe(advance.run.stateRevision + 1);
    expectSchemaValidRun(output.run);
  });

  it('rejects an invalid stage (regular season) and a stale state', () => {
    const context = postseasonFixture();
    const wrongStage = handleSeasonRunCommand(
      commandOf(context.run, {
        command: 'spectate-postseason-game',
        commandId: 'spec-stage',
        targetGameId: 'pi-east-seven-eight',
      }),
      context,
    );
    if (wrongStage.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(wrongStage.result.result.rejection.code).toBe('invalid-stage');
    const stale = handleSeasonRunCommand(
      commandOf(
        { ...context.run, stateRevision: context.run.stateRevision + 1 },
        {
          command: 'spectate-postseason-game',
          commandId: 'spec-stale',
          targetGameId: 'pi-east-seven-eight',
        },
      ),
      context,
    );
    if (stale.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(stale.result.result.rejection.code).toBe('stale-state');
  });
});

describe('fast-forward-postseason command', () => {
  it('completes an eliminated run with the champion and completion state', () => {
    const context = postseasonFixture({
      resolver: forcedPostseasonResolver((home, away) => {
        if (home === HUMAN) return 'away';
        if (away === HUMAN) return 'home';
        return 'home';
      }),
      rankings: ({ league }) => ({
        east: eastTopTen(league),
        west: westTopTenWithout(league, HUMAN).slice(0, 10),
      }),
    });

    const start = handleSeasonRunCommand(
      commandOf(context.run, { command: 'start-postseason', commandId: 'start-1' }),
      context,
    );
    if (start.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const output = handleSeasonRunCommand(
      commandOf(start.run, { command: 'fast-forward-postseason', commandId: 'ff-1' }),
      { ...context, run: start.run },
    );
    const outputResult = output.result;
    if (outputResult.command !== 'fast-forward-postseason') throw new Error('unexpected command');
    const result = outputResult.result;
    if (result.status !== 'accepted') throw new Error('expected acceptance');
    expect(result.stage).toBe('completed');
    expect(result.championFranchiseId).toMatch(/^[a-z0-9._:-]+$/);
    expect(output.run.stage).toBe('completed');
    expect(output.run.completion?.championFranchiseId).toBe(result.championFranchiseId);
    expect(output.run.completion?.almanacDigest).toBe('0'.repeat(32));
    expect(output.run.completion?.finalizedAtStateRevision).toBe(output.run.stateRevision);
    expect(output.run.postseason.championFranchiseId).toBe(result.championFranchiseId);
    expect(output.postseasonSummaries?.length).toBeGreaterThan(20);
    expectSchemaValidRun(output.run);
  });

  it('rejects an active human, an invalid stage, and a bad target', () => {
    const context = postseasonFixture({ resolver: forcedPostseasonResolver(humanWinsEveryGame) });

    const activeStart = handleSeasonRunCommand(
      commandOf(context.run, { command: 'start-postseason', commandId: 'start-1' }),
      context,
    );
    if (activeStart.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const activeHuman = handleSeasonRunCommand(
      commandOf(activeStart.run, {
        command: 'fast-forward-postseason',
        commandId: 'ff-active',
        targetGameId: 'po-east-first-round-1-g1',
      }),
      { ...context, run: activeStart.run },
    );
    if (activeHuman.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(activeHuman.result.result.rejection.code).toBe('integrity-failure');

    const wrongStage = handleSeasonRunCommand(
      commandOf(context.run, { command: 'fast-forward-postseason', commandId: 'ff-stage' }),
      context,
    );
    if (wrongStage.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(wrongStage.result.result.rejection.code).toBe('invalid-stage');

    const aiOnly = postseasonFixture({
      rankings: (input) => ({
        east: eastTopTen(input.league),
        west: westTopTenWithout(input.league, HUMAN),
      }),
    });
    const start = handleSeasonRunCommand(
      commandOf(aiOnly.run, { command: 'start-postseason', commandId: 'start-1' }),
      aiOnly,
    );
    if (start.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const advance = handleSeasonRunCommand(
      commandOf(start.run, {
        command: 'advance-postseason',
        commandId: 'adv-1',
        targetGameId: 'pi-west-nine-ten',
      }),
      { ...aiOnly, run: start.run },
    );
    if (advance.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const badTarget = handleSeasonRunCommand(
      commandOf(advance.run, {
        command: 'fast-forward-postseason',
        commandId: 'ff-badtarget',
        targetGameId: 'pi-east-seven-eight',
      }),
      { ...aiOnly, run: advance.run },
    );
    if (badTarget.result.result.status !== 'rejected') throw new Error('expected rejection');
    expect(badTarget.result.result.rejection.code).toBe('integrity-failure');
  });
});

describe('campaign commands', () => {
  function campaignFixture(seed = TEST_SEED): SeasonRunCommandContext & {
    run: SeasonRun;
    catalog: SeasonDraftCatalog;
  } {
    const { run: base, catalog } = buildEconomyTestRun({ seed });
    const run: SeasonRun = {
      ...base,
      campaign: buildEmptyCampaignState(),
    };
    return {
      run,
      pending: null,
      humanFranchiseId: HUMAN,
      catalog,
      effects: zeroEffectsOf(run),
    };
  }

  it('select-gm-identity generates two offers for the current block', () => {
    const context = campaignFixture();
    const output = handleSeasonRunCommand(
      commandOf(context.run, {
        command: 'select-gm-identity',
        commandId: 'gm-1',
        identity: 'team-identity',
        focus: 'defense',
      }),
      context,
    );
    if (output.result.result.status !== 'accepted') throw new Error('expected acceptance');
    const campaign = normalizeCampaignState(output.run.campaign);
    expect(campaign.startingIdentity).toBe('team-identity');
    expect(campaign.startingFocus).toBe('defense');
    expect(campaign.offers[0]).toHaveLength(2);
  });
});
