import { describe, expect, it } from 'bun:test';
import type {
  FullCourtDraftState,
  FullCourtPurchaseReportCommand,
  FullCourtReportTarget,
} from '@hoop-rush/data-contracts';
import {
  FULL_COURT_DEFAULT_MONEY,
  FULL_COURT_MAX_REPORTS,
  commandIdSchema,
  fullCourtDraftStateSchema,
  fullCourtMoneyConfigSchema,
  fullCourtReportPriceDollars,
  fullCourtReportScope,
} from '@hoop-rush/data-contracts';
import {
  applyFullCourtCommand,
  createFullCourtDraftState,
  fullCourtPurchasePhaseRejection,
} from './draft-commands.ts';
import {
  fullCourtPayrollDollars,
  fullCourtPayrollStatus,
  fullCourtWarChestDollars,
} from './draft-economy.ts';
import { fullCourtSalaryDollarsOf } from './draft-catalog.ts';
import { fullCourtStateDigest } from './state-digest.ts';
import { fullCourtTestSetup, type FullCourtTestSetup } from './draft-test-support.ts';

function commandId(prefix: string, revision: number) {
  return commandIdSchema.parse(`${prefix}-${String(revision)}`);
}

function cheapest(setup: FullCourtTestSetup, overall = 60, slot = 'PG') {
  const player = (setup.index.bySlot.get(slot as never) ?? []).find(
    (entry) => entry.originalOverall === overall,
  );
  if (player === undefined) throw new Error(`missing ${slot} ${String(overall)}`);
  return player;
}

function pick(
  setup: FullCourtTestSetup,
  state: FullCourtDraftState,
  overall = 60,
  slot = 'PG',
): FullCourtDraftState {
  const player = cheapest(setup, overall, slot);
  const outcome = applyFullCourtCommand(
    state,
    {
      command: 'pick-full-court-player',
      commandId: commandId(`cmd-pick-${String(state.revision)}`, state.revision),
      runId: state.runId,
      expectedRevision: state.revision,
      playerVersionId: player.playerVersionId,
    },
    { index: setup.index },
  );
  expect(outcome.result.status).toBe('accepted');
  return outcome.state;
}

function sixPickState(setup: FullCourtTestSetup, money = FULL_COURT_DEFAULT_MONEY) {
  let state = createFullCourtDraftState({ ...setup.createCommand, money }, setup.index);
  const entries: Array<{ slot: string; overall: number }> = [
    { slot: 'PG', overall: 60 },
    { slot: 'SG', overall: 60 },
    { slot: 'SF', overall: 60 },
    { slot: 'PF', overall: 60 },
    { slot: 'C', overall: 60 },
    { slot: 'PG', overall: 62 },
  ];
  for (const entry of entries) state = pick(setup, state, entry.overall, entry.slot);
  return state;
}

function finish(setup: FullCourtTestSetup, state: FullCourtDraftState): FullCourtDraftState {
  const outcome = applyFullCourtCommand(
    state,
    {
      command: 'finish-full-court-draft',
      commandId: commandId(`cmd-finish-${String(state.revision)}`, state.revision),
      runId: state.runId,
      expectedRevision: state.revision,
    },
    { index: setup.index },
  );
  expect(outcome.result.status).toBe('accepted');
  return outcome.state;
}

function buy(
  setup: FullCourtTestSetup,
  state: FullCourtDraftState,
  target: FullCourtReportTarget,
  id = `cmd-buy-${String(state.revision)}`,
) {
  return applyFullCourtCommand(
    state,
    {
      command: 'purchase-full-court-report',
      commandId: commandId(id, state.revision),
      runId: state.runId,
      expectedRevision: state.revision,
      target,
    },
    { index: setup.index },
  );
}

describe('full court report purchases', () => {
  it('rejects a purchase past the report limit without charging the War Chest', () => {
    const setup = fullCourtTestSetup();
    let state = finish(setup, sixPickState(setup));
    for (let game = 1; game <= FULL_COURT_MAX_REPORTS; game++) {
      const purchase = buy(setup, state, {
        kind: 'opponent-film',
        gameId: `fixture-${String(game)}`,
        opponentTeamId: 'celtics',
      });
      expect(purchase.result.status).toBe('accepted');
      state = purchase.state;
    }
    const overLimit = buy(setup, state, { kind: 'lineup-fit' });
    expect(overLimit.result.rejection?.code).toBe('report-unavailable');
    expect(overLimit.state).toEqual(state);
  });

  it('publishes one price and one access scope per report kind', () => {
    expect(fullCourtReportPriceDollars('player-scouting')).toBe(2_000_000);
    expect(fullCourtReportPriceDollars('lineup-fit')).toBe(5_000_000);
    expect(fullCourtReportPriceDollars('opponent-film')).toBe(3_000_000);
    expect(fullCourtReportPriceDollars('training-camp')).toBe(15_000_000);
    expect(fullCourtReportScope('player-scouting')).toBe('run');
    expect(fullCourtReportScope('lineup-fit')).toBe('run');
    expect(fullCourtReportScope('opponent-film')).toBe('run');
    expect(fullCourtReportScope('training-camp')).toBe('run');
  });

  it('charges one scouting receipt without touching payroll', () => {
    const setup = fullCourtTestSetup();
    const player = cheapest(setup);
    const payrollBefore = fullCourtPayrollDollars(setup.state.picks);
    const digestBefore = fullCourtStateDigest(setup.state);
    const outcome = buy(setup, setup.state, {
      kind: 'player-scouting',
      playerVersionId: player.playerVersionId,
    });
    expect(outcome.result.status).toBe('accepted');
    expect(outcome.state.revision).toBe(2);
    expect(outcome.state.picks).toEqual([]);
    expect(outcome.state.spending).toHaveLength(1);
    expect(outcome.state.spending[0]?.kind).toBe('scouting');
    expect(outcome.state.spending[0]?.dollars).toBe(fullCourtReportPriceDollars('player-scouting'));
    expect(outcome.state.reports ?? []).toHaveLength(1);
    const report = outcome.state.reports?.[0];
    expect(report?.kind).toBe('player-scouting');
    expect(report?.target).toEqual({
      kind: 'player-scouting',
      playerVersionId: player.playerVersionId,
    });
    expect(report?.reportId).toBe(outcome.state.spending[0]?.entryId);
    expect(report?.purchasedRevision).toBe(2);
    expect(fullCourtPayrollDollars(outcome.state.picks)).toBe(payrollBefore);
    expect(fullCourtWarChestDollars(outcome.state)).toBe(
      FULL_COURT_DEFAULT_MONEY.startingWarChestDollars -
        fullCourtReportPriceDollars('player-scouting'),
    );
    expect(fullCourtStateDigest(outcome.state)).not.toBe(digestBefore);
  });

  it('rejects a second purchase of the same target and keeps one charge', () => {
    const setup = fullCourtTestSetup();
    const target: FullCourtReportTarget = {
      kind: 'player-scouting',
      playerVersionId: cheapest(setup).playerVersionId,
    };
    const first = buy(setup, setup.state, target);
    expect(first.result.status).toBe('accepted');
    const again = buy(setup, first.state, target);
    expect(again.result.status).toBe('rejected');
    expect(again.result.rejection?.code).toBe('report-owned');
    expect(again.state).toBe(first.state);
    expect(again.state.spending).toHaveLength(1);
  });

  it('rejects a reused command id even with a different target', () => {
    const setup = fullCourtTestSetup();
    const first = buy(setup, setup.state, {
      kind: 'player-scouting',
      playerVersionId: cheapest(setup).playerVersionId,
    });
    const reused = applyFullCourtCommand(
      first.state,
      {
        command: 'purchase-full-court-report',
        commandId: commandIdSchema.parse('cmd-buy-1-1'),
        runId: first.state.runId,
        expectedRevision: first.state.revision,
        target: {
          kind: 'player-scouting',
          playerVersionId: cheapest(setup, 62).playerVersionId,
        },
      },
      { index: setup.index },
    );
    expect(reused.result.rejection?.code).toBe('command-conflict');
    expect(reused.state).toBe(first.state);
  });

  it('rejects a stale retry of the same command', () => {
    const setup = fullCourtTestSetup();
    const target: FullCourtReportTarget = {
      kind: 'player-scouting',
      playerVersionId: cheapest(setup).playerVersionId,
    };
    const first = buy(setup, setup.state, target);
    const retry = applyFullCourtCommand(
      first.state,
      {
        command: 'purchase-full-court-report',
        commandId: commandId('cmd-buy-1', 1),
        runId: first.state.runId,
        expectedRevision: 1,
        target,
      },
      { index: setup.index },
    );
    expect(retry.result.rejection?.code).toBe('stale-revision');
    expect(retry.state).toBe(first.state);
  });

  it('rejects a purchase that would leave too little for a legal completion', () => {
    const setup = fullCourtTestSetup();
    const money = fullCourtMoneyConfigSchema.parse({
      ...FULL_COURT_DEFAULT_MONEY,
      startingWarChestDollars: 22_104_999,
    });
    const state = createFullCourtDraftState({ ...setup.createCommand, money }, setup.index);
    const outcome = buy(setup, state, {
      kind: 'player-scouting',
      playerVersionId: cheapest(setup).playerVersionId,
    });
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('budget-rejected');
    expect(outcome.state).toBe(state);
    expect(outcome.state.spending).toEqual([]);
  });

  it('rejects an unknown catalog player', () => {
    const setup = fullCourtTestSetup();
    const outcome = buy(setup, setup.state, {
      kind: 'player-scouting',
      playerVersionId: `pv-${'f'.repeat(32)}`,
    });
    expect(outcome.result.rejection?.code).toBe('player-unavailable');
  });

  it('allows buying run perks at the beginning before the roster is confirmed', () => {
    const setup = fullCourtTestSetup();
    let state = setup.state;
    for (const target of [
      { kind: 'lineup-fit' },
      { kind: 'opponent-film' },
      { kind: 'training-camp' },
    ] as const) {
      const outcome = buy(setup, state, target);
      expect(outcome.result.status).toBe('accepted');
      state = outcome.state;
    }
    expect(state.reports ?? []).toHaveLength(3);
  });

  it('sells lineup fit and one film per fixture after confirmation', () => {
    const setup = fullCourtTestSetup();
    const confirmed = finish(setup, sixPickState(setup));
    const payrollBefore = fullCourtPayrollDollars(confirmed.picks);
    const lineup = buy(setup, confirmed, { kind: 'lineup-fit' });
    expect(lineup.result.status).toBe('accepted');
    expect(lineup.state.reports?.[0]?.kind).toBe('lineup-fit');
    expect(fullCourtPayrollDollars(lineup.state.picks)).toBe(payrollBefore);
    const filmTarget: FullCourtReportTarget = {
      kind: 'opponent-film',
      gameId: 'full-court-game-1',
      opponentTeamId: 'celtics',
    };
    const film = buy(setup, lineup.state, filmTarget);
    expect(film.result.status).toBe('accepted');
    expect(film.state.reports ?? []).toHaveLength(2);
    expect(film.state.reports?.[1]?.target).toEqual(filmTarget);
    const repeat = buy(setup, film.state, filmTarget);
    expect(repeat.result.rejection?.code).toBe('report-owned');
  });

  it('sells training camp once after confirmation without touching payroll', () => {
    const setup = fullCourtTestSetup();
    const confirmed = finish(setup, sixPickState(setup));
    const payrollBefore = fullCourtPayrollDollars(confirmed.picks);
    const warChestBefore = fullCourtWarChestDollars(confirmed);
    const camp = buy(setup, confirmed, { kind: 'training-camp' });
    expect(camp.result.status).toBe('accepted');
    expect(camp.state.reports?.[0]?.kind).toBe('training-camp');
    expect(camp.state.spending.at(-1)).toMatchObject({
      kind: 'scouting',
      dollars: fullCourtReportPriceDollars('training-camp'),
    });
    expect(fullCourtPayrollDollars(camp.state.picks)).toBe(payrollBefore);
    expect(fullCourtWarChestDollars(camp.state)).toBe(
      warChestBefore - fullCourtReportPriceDollars('training-camp'),
    );
    const repeat = buy(setup, camp.state, { kind: 'training-camp' });
    expect(repeat.result.rejection?.code).toBe('report-owned');
    expect(repeat.state).toEqual(camp.state);
  });

  it('rejects training camp when the War Chest cannot cover the price', () => {
    const setup = fullCourtTestSetup();
    const confirmed = finish(setup, sixPickState(setup));
    const payroll = fullCourtPayrollDollars(confirmed.picks);
    const broke = fullCourtDraftStateSchema.parse({
      ...confirmed,
      money: { ...confirmed.money, startingWarChestDollars: payroll + 1 },
    });
    const camp = buy(setup, broke, { kind: 'training-camp' });
    expect(camp.result.rejection?.code).toBe('budget-rejected');
    expect(camp.state).toEqual(broke);
  });

  it('never moves the apron status', () => {
    const setup = fullCourtTestSetup();
    const money = fullCourtMoneyConfigSchema.parse({
      ...FULL_COURT_DEFAULT_MONEY,
      capLineDollars: 1,
      firstApronDollars: 2,
    });
    const state = sixPickState(setup, money);
    const before = fullCourtPayrollStatus(fullCourtPayrollDollars(state.picks), money);
    expect(before).toBe('second-apron');
    const outcome = buy(setup, state, {
      kind: 'player-scouting',
      playerVersionId: state.picks[0]?.player.playerVersionId ?? cheapest(setup).playerVersionId,
    });
    expect(outcome.result.status).toBe('accepted');
    expect(fullCourtPayrollDollars(outcome.state.picks)).toBe(fullCourtPayrollDollars(state.picks));
    expect(fullCourtPayrollStatus(fullCourtPayrollDollars(outcome.state.picks), money)).toBe(
      before,
    );
  });

  it('replays to the same reports, receipts, and digest', () => {
    const setup = fullCourtTestSetup();
    const target: FullCourtReportTarget = {
      kind: 'player-scouting',
      playerVersionId: cheapest(setup).playerVersionId,
    };
    const left = buy(setup, setup.state, target).state;
    const right = buy(setup, setup.state, target).state;
    expect(right).toEqual(left);
    expect(right.reports?.[0]?.reportId).toBe(left.reports?.[0]?.reportId);
    expect(fullCourtStateDigest(right)).toBe(fullCourtStateDigest(left));
  });

  it('loads a pre-report state without adding a reports field', () => {
    const setup = fullCourtTestSetup();
    const legacy = Object.fromEntries(
      Object.entries(setup.state).filter(([key]) => key !== 'reports'),
    );
    const parsed = fullCourtDraftStateSchema.parse(legacy);
    expect(parsed.reports).toBeUndefined();
    expect(fullCourtStateDigest(parsed)).toBe(fullCourtStateDigest(setup.state));
  });

  it('tolerates an unmatched scouting entry from an older draft', () => {
    const setup = fullCourtTestSetup();
    const parsed = fullCourtDraftStateSchema.parse({
      ...setup.state,
      spending: [
        {
          entryId: `fcs-${'a'.repeat(32)}`,
          kind: 'scouting',
          dollars: 1,
          commandId: 'cmd-legacy-scouting',
        },
      ],
    });
    expect(parsed.reports).toBeUndefined();
    expect(parsed.spending).toHaveLength(1);
  });

  it('refuses a report record without its matching War Chest charge', () => {
    const setup = fullCourtTestSetup();
    const bought = buy(setup, setup.state, {
      kind: 'player-scouting',
      playerVersionId: cheapest(setup).playerVersionId,
    }).state;
    const parsed = fullCourtDraftStateSchema.safeParse({ ...bought, spending: [] });
    expect(parsed.success).toBe(false);
  });

  it('keeps report salary arithmetic out of the pick ledger', () => {
    const setup = fullCourtTestSetup();
    const player = cheapest(setup);
    const bought = buy(setup, setup.state, {
      kind: 'player-scouting',
      playerVersionId: player.playerVersionId,
    }).state;
    expect(fullCourtSalaryDollarsOf(player)).toBeGreaterThan(0);
    expect(bought.spending.some((entry) => entry.kind === 'salary')).toBe(false);
  });

  it('closes training camp once the regular season has started', () => {
    const setup = fullCourtTestSetup();
    const confirmed = finish(setup, sixPickState(setup));
    const command: FullCourtPurchaseReportCommand = {
      command: 'purchase-full-court-report',
      commandId: commandId('cmd-camp-phase', confirmed.revision),
      runId: confirmed.runId,
      expectedRevision: confirmed.revision,
      target: { kind: 'training-camp' },
    };
    const open = {
      completedThroughSlot: 0,
      postseasonStarted: false,
      playedGameIds: new Set<string>(),
    };
    expect(
      fullCourtPurchasePhaseRejection(confirmed, command, { ...open, completedThroughSlot: null }),
    ).toBeNull();
    expect(fullCourtPurchasePhaseRejection(confirmed, command, open)).toBeNull();
    for (const phase of [
      { ...open, completedThroughSlot: 1 },
      { ...open, postseasonStarted: true },
    ]) {
      const closed = fullCourtPurchasePhaseRejection(confirmed, command, phase);
      expect(closed?.status).toBe('rejected');
      expect(closed?.rejection?.code).toBe('report-unavailable');
      expect(closed?.revisionBefore).toBe(confirmed.revision);
      expect(closed?.revisionAfter).toBe(confirmed.revision);
      expect(closed?.stateDigest).toBe(fullCourtStateDigest(confirmed));
    }
  });

  it('closes roster fit and league film once the regular season has started', () => {
    const setup = fullCourtTestSetup();
    const confirmed = finish(setup, sixPickState(setup));
    const open = {
      completedThroughSlot: 0,
      postseasonStarted: false,
      playedGameIds: new Set<string>(),
    };
    const cases: readonly {
      target: FullCourtReportTarget;
      message: string;
    }[] = [
      {
        target: { kind: 'lineup-fit' },
        message: 'Roster fit closes before the first regular-season game.',
      },
      {
        target: { kind: 'opponent-film' },
        message: 'League opponent film closes before the first regular-season game.',
      },
    ];
    for (const { target, message } of cases) {
      const command: FullCourtPurchaseReportCommand = {
        command: 'purchase-full-court-report',
        commandId: commandId(`cmd-${target.kind}-phase`, confirmed.revision),
        runId: confirmed.runId,
        expectedRevision: confirmed.revision,
        target,
      };
      expect(fullCourtPurchasePhaseRejection(confirmed, command, open)).toBeNull();
      for (const phase of [
        { ...open, completedThroughSlot: 1 },
        { ...open, postseasonStarted: true },
      ]) {
        const closed = fullCourtPurchasePhaseRejection(confirmed, command, phase);
        expect(closed?.status).toBe('rejected');
        expect(closed?.rejection?.message).toBe(message);
      }
    }
  });

  it('closes opponent film once its fixture is committed', () => {
    const setup = fullCourtTestSetup();
    const confirmed = finish(setup, sixPickState(setup));
    const command: FullCourtPurchaseReportCommand = {
      command: 'purchase-full-court-report',
      commandId: commandId('cmd-film-phase', confirmed.revision),
      runId: confirmed.runId,
      expectedRevision: confirmed.revision,
      target: { kind: 'opponent-film', gameId: 'game-1', opponentTeamId: 'celtics' },
    };
    const open = {
      completedThroughSlot: 1,
      postseasonStarted: false,
      playedGameIds: new Set<string>(['game-0']),
    };
    expect(fullCourtPurchasePhaseRejection(confirmed, command, open)).toBeNull();
    const stale = fullCourtPurchasePhaseRejection(confirmed, command, {
      ...open,
      playedGameIds: new Set(['game-1']),
    });
    expect(stale?.status).toBe('rejected');
    expect(stale?.rejection?.code).toBe('report-unavailable');
    expect(stale?.stateDigest).toBe(fullCourtStateDigest(confirmed));
  });
});
