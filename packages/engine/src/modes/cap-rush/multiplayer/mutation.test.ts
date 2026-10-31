import { describe, expect, test } from 'bun:test';
import type {
  CapRushMultiplayerCommand,
  CapRushMultiplayerCommandPayload,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerState,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  POSITIONS,
  commandIdSchema,
  idSchema,
  playerIdSchema,
} from '@hoop-rush/data-contracts';
import {
  applyCapRushMultiplayerCommand,
  capRushMultiplayerStateDigest,
  createCapRushMultiplayerState,
  type CapRushMultiplayerEnvironment,
} from './state.ts';
import { capRushMultiplayerLockDigest } from './state.ts';
import { capRushMultiplayerActiveRound } from './auction.ts';
import { capRushTestSetup } from '../cap-rush-test-support.ts';
import {
  capRushTestDate,
  capRushTestEnvironment,
  capRushTestRootSeed,
} from './shared-league.test-support.ts';

interface Harness {
  readonly state: CapRushMultiplayerState;
  readonly environment: CapRushMultiplayerEnvironment;
  readonly commands: CapRushMultiplayerCommand[];
}

const ROOT = capRushTestRootSeed();
const ENVIRONMENT: CapRushMultiplayerEnvironment = {
  ...capRushTestEnvironment(capRushTestSetup()),
  variant: 'roulette',
};

function runCommand(
  state: CapRushMultiplayerState,
  commands: CapRushMultiplayerCommand[],
  actor: CapRushMultiplayerSeatId,
  payload: CapRushMultiplayerCommandPayload,
  acceptedAtIso: string,
): CapRushMultiplayerState {
  const command: CapRushMultiplayerCommand = {
    schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
    roomId: idSchema.parse('room-test'),
    commandId: commandIdSchema.parse(`cmd-${String(commands.length)}`),
    ordinal: commands.length,
    actorParticipantId: actor,
    expectedRevision: commands.length,
    acceptedAtIso,
    payload,
  };
  commands.push(command);
  const outcome = applyCapRushMultiplayerCommand(state, command, ENVIRONMENT);
  if (!outcome.ok) {
    throw new Error(`${payload.kind} rejected (${outcome.code}): ${outcome.message}`);
  }
  return outcome.state;
}

function prepareRecruitment(bidDollars: number | null): Harness {
  const commands: CapRushMultiplayerCommand[] = [];
  let clock = capRushTestDate();
  const at = (offset = 0) => new Date(clock + offset).toISOString();
  let state = createCapRushMultiplayerState(ROOT);
  state = runCommand(state, commands, 'p1', { kind: 'start' }, at());
  if (bidDollars !== null) {
    const lot = capRushMultiplayerActiveRound(
      state.recruitment as NonNullable<typeof state.recruitment>,
    ).auctions[0];
    if (lot === undefined) throw new Error('no active lot');
    state = runCommand(
      state,
      commands,
      'p1',
      { kind: 'bid', round: 0, playerId: lot.playerId, totalDollars: bidDollars },
      at(1_000),
    );
  }
  for (let round = 0; round < POSITIONS.length; round += 1) {
    clock += 61_000;
    state = runCommand(state, commands, 'p1', { kind: 'close-due-auctions', round }, at());
  }
  return { state, environment: ENVIRONMENT, commands };
}

function lock(harn: Harness): CapRushMultiplayerState {
  const digest = capRushMultiplayerLockDigest(harn.state);
  if (digest === null) throw new Error('no lock digest');
  let state = runCommand(
    harn.state,
    harn.commands,
    'p1',
    { kind: 'confirm-lock', stateDigest: digest },
    new Date(capRushTestDate()).toISOString(),
  );
  state = runCommand(
    state,
    harn.commands,
    'p2',
    { kind: 'confirm-lock', stateDigest: digest },
    new Date(capRushTestDate()).toISOString(),
  );
  return state;
}

function purchase(
  state: CapRushMultiplayerState,
  commands: CapRushMultiplayerCommand[],
  purchaseId: 'standard' | 'surge',
  targetPlayerId: string,
) {
  const command: CapRushMultiplayerCommand = {
    schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
    roomId: idSchema.parse('room-test'),
    commandId: commandIdSchema.parse(`cmd-${String(commands.length)}`),
    ordinal: commands.length,
    actorParticipantId: 'p1',
    expectedRevision: commands.length,
    acceptedAtIso: new Date(capRushTestDate()).toISOString(),
    payload: {
      kind: 'purchase-mutation',
      purchase: purchaseId,
      targetPlayerId: playerIdSchema.parse(targetPlayerId),
    },
  };
  commands.push(command);
  return applyCapRushMultiplayerCommand(state, command, ENVIRONMENT);
}

describe('cap rush multiplayer mutation receipts', () => {
  test('uses the actual winning bid and auto-sign salaries for payroll and eligibility', () => {
    const base = prepareRecruitment(null);
    const basePicks = base.state.locked?.seats.p1.picks ?? [];
    const basePayroll = base.state.locked?.seats.p1.payrollDollars ?? 0;
    const basePg = basePicks.find((pick) => pick.slot === 'PG');
    if (basePg === undefined) throw new Error('no base PG');
    const firstRound = base.state.recruitment?.rounds[0];
    if (firstRound === undefined) throw new Error('no first round');
    const pgMinimum = Math.min(
      ...firstRound.auctions.map(
        (auction) =>
          base.state.recruitment?.market.players.find(
            (player) => player.playerId === auction.playerId,
          )?.minimumBidDollars ?? Number.POSITIVE_INFINITY,
      ),
    );
    const targetPayroll = 110_000_000;
    const bid = targetPayroll - (basePayroll - basePg.salaryDollars);
    expect(bid).toBeGreaterThan(pgMinimum);

    const harn = prepareRecruitment(bid);
    const picks = harn.state.locked?.seats.p1.picks ?? [];
    const pg = picks.find((pick) => pick.slot === 'PG');
    if (pg === undefined) throw new Error('no locked PG');
    expect(pg.salaryDollars).toBe(bid);
    const payroll = harn.state.locked?.seats.p1.payrollDollars ?? 0;
    expect(payroll).toBe(picks.reduce((total, pick) => total + pick.salaryDollars, 0));
    expect(payroll).toBeGreaterThan(95_000_000);
    expect(payroll).toBeLessThanOrEqual(120_000_000);

    const prepared = harn.state;
    expect(prepared.phase).toBe('preparation');

    const standard = purchase(prepared, harn.commands, 'standard', pg.playerId);
    expect(standard.ok).toBe(true);
    if (!standard.ok) return;
    const seat = standard.state.locked?.seats.p1;
    if (seat === undefined || seat.spin === null) throw new Error('no receipt');
    expect(seat.spin.purchase).toBe('standard');
    expect(seat.spin.priceDollars).toBe(10_000_000);
    expect(seat.spin.payrollDollars).toBe(payroll);
    expect(seat.spin.target.playerVersionId).toBe(pg.playerVersionId);
    expect(seat.spin.receiptDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(seat.payrollDollars).toBe(payroll);
    const mutated = seat.team.starters.find(
      (starter) => starter.source.playerVersionId === pg.playerVersionId,
    );
    expect(mutated?.mutationPackage.length ?? 0).toBeGreaterThan(0);

    const locked = lock({ ...harn, state: standard.state });
    expect(locked.phase).toBe('season');

    const surge = purchase(standard.state, harn.commands, 'surge', pg.playerId);
    expect(surge.ok).toBe(false);
    if (surge.ok) return;
    expect(surge.code).toBe('budget-rejected');
  });

  test('rejects every spin above the normal cap eligibility ceiling', () => {
    const harn = prepareRecruitment(150_000_000);
    const payroll = harn.state.locked?.seats.p1.payrollDollars ?? 0;
    expect(payroll).toBeGreaterThan(120_000_000);
    const pick = harn.state.locked?.seats.p1.picks[0];
    if (pick === undefined) throw new Error('no pick');
    const prepared = harn.state;
    const standard = purchase(prepared, harn.commands, 'standard', pick.playerId);
    expect(standard.ok).toBe(false);
    if (standard.ok) return;
    expect(standard.code).toBe('budget-rejected');
    const surge = purchase(prepared, harn.commands, 'surge', pick.playerId);
    expect(surge.ok).toBe(false);
    if (surge.ok) return;
    expect(surge.code).toBe('budget-rejected');
  });

  test('keeps player payroll separate from mutation spending across two purchases', () => {
    const harn = prepareRecruitment(40_000_000);
    const pick = harn.state.locked?.seats.p1.picks[0];
    if (pick === undefined) throw new Error('no pick');
    const payroll = harn.state.locked?.seats.p1.payrollDollars ?? 0;
    expect(payroll).toBeLessThan(95_000_000);
    const prepared = harn.state;
    const first = purchase(prepared, harn.commands, 'standard', pick.playerId);
    if (!first.ok) throw new Error(first.message);
    const secondPick = first.state.locked?.seats.p1.picks[1];
    if (secondPick === undefined) throw new Error('no second pick');
    const second = purchase(first.state, harn.commands, 'standard', secondPick.playerId);
    if (!second.ok) throw new Error(second.message);
    const seat = second.state.locked?.seats.p1;
    if (seat === undefined) throw new Error('no seat');
    expect(seat.additionalSpins).toHaveLength(1);
    expect(seat.payrollDollars).toBe(payroll);
    const locked = lock({ ...harn, state: second.state });
    expect(locked.phase).toBe('season');
    expect(capRushMultiplayerStateDigest(locked).length).toBe(32);
  });
});
