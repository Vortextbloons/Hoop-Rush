import { describe, expect, it } from 'bun:test';
import type { CapRushDraftPick, CapRushDraftState, Position } from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_CAP_LINE_DOLLARS,
  POSITIONS,
  capRushCardIdSchema,
  capRushCardSchema,
  capRushDraftStateSchema,
  capRushEmptySeasonState,
  capRushOfferIdSchema,
  capRushSpinTierSeed,
  commandIdSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { applyCapRushCommand } from './draft-commands.ts';
import {
  capRushPayrollDollars,
  capRushSpinDefinitionsForTier,
  capRushSpinEligibility,
  capRushSpinTargetOf,
  drawCapRushSpinTier,
  buildCapRushSpinReceipt,
} from './spin.ts';
import { createRng } from '../../sim/rng.ts';
import { capRushTestSetup, type CapRushTestSetup } from './cap-rush-test-support.ts';

function playerForSlot(setup: CapRushTestSetup, slot: Position) {
  const player = setup.index.bySlot.get(slot)?.[0];
  if (player === undefined) throw new Error(`test catalog has no ${slot}`);
  return player;
}

function buildCompleteState(
  setup: CapRushTestSetup,
  salaries: readonly number[],
  variant: 'clash' | 'roulette' = 'roulette',
): CapRushDraftState {
  const picks: CapRushDraftPick[] = POSITIONS.map((slot, index) => {
    const player = playerForSlot(setup, slot);
    const salaryDollars = salaries[index] ?? 0;
    return {
      pickOrdinal: index,
      slot,
      card: capRushCardSchema.parse({
        cardId: `crc-${String(index).repeat(32)}`,
        offerId: capRushOfferIdSchema.parse(`cro-${'0'.repeat(32)}`),
        cardIndex: index,
        slot,
        bucket: 'budget',
        source: player,
        salaryDollars,
      }),
    };
  });
  return capRushDraftStateSchema.parse({
    schemaVersion: setup.state.schemaVersion,
    runId: setup.state.runId,
    revision: 12,
    runSeed: setup.state.runSeed,
    variant,
    versionSet: setup.state.versionSet,
    catalog: setup.state.catalog,
    stage: 'complete',
    round: 5,
    offer: null,
    rerollsRemaining: 2,
    picks,
    spin: variant === 'roulette' ? { status: 'pending' } : { status: 'unavailable' },
    locked: null,
    season: capRushEmptySeasonState(),
  });
}

function payrollSplit(total: number): number[] {
  return [total - 4, 1, 1, 1, 1];
}

function purchase(
  setup: CapRushTestSetup,
  state: CapRushDraftState,
  purchaseId: 'standard' | 'premium',
  targetCardId = state.picks[0]?.card.cardId ?? '',
) {
  return applyCapRushCommand(
    state,
    {
      command: 'purchase-cap-rush-spin',
      commandId: commandIdSchema.parse(`cmd-spin-${String(state.revision)}`),
      runId: state.runId,
      expectedRevision: state.revision,
      purchase: purchaseId,
      targetCardId: capRushCardIdSchema.parse(targetCardId),
    },
    { index: setup.index },
  );
}

function skip(setup: CapRushTestSetup, state: CapRushDraftState) {
  return applyCapRushCommand(
    state,
    {
      command: 'skip-cap-rush-spin',
      commandId: commandIdSchema.parse(`cmd-skip-${String(state.revision)}`),
      runId: state.runId,
      expectedRevision: state.revision,
    },
    { index: setup.index },
  );
}

describe('cap rush spin eligibility', () => {
  it('applies the purchase-specific payroll ceiling', () => {
    expect(capRushSpinEligibility(105_000_000, 'standard').eligible).toBe(true);
    expect(capRushSpinEligibility(105_000_001, 'standard').eligible).toBe(false);
    expect(capRushSpinEligibility(90_000_000, 'premium').eligible).toBe(true);
    expect(capRushSpinEligibility(90_000_001, 'premium').eligible).toBe(false);
    expect(capRushSpinEligibility(110_000_000, 'standard').eligible).toBe(false);
    expect(capRushSpinEligibility(110_000_000, 'standard').priceDollars).toBe(15_000_000);
    expect(capRushSpinEligibility(110_000_000, 'standard').maxEligiblePayrollDollars).toBe(
      105_000_000,
    );
  });

  it('keeps every purchase under the normal cap by construction', () => {
    expect(CAP_RUSH_CAP_LINE_DOLLARS - 15_000_000).toBe(105_000_000);
    expect(CAP_RUSH_CAP_LINE_DOLLARS - 30_000_000).toBe(90_000_000);
  });
});

describe('cap rush spin purchase', () => {
  it('buys exactly one mutation at the payroll ceiling', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(setup, payrollSplit(105_000_000));
    const outcome = purchase(setup, state, 'standard');
    expect(outcome.result.status).toBe('accepted');
    if (outcome.state.spin.status !== 'purchased') throw new Error('spin was not purchased');
    const receipt = outcome.state.spin.receipt;
    expect(receipt.purchase).toBe('standard');
    expect(receipt.priceDollars).toBe(15_000_000);
    expect(receipt.payrollDollars).toBe(capRushPayrollDollars(state.picks));
    expect(receipt.target).toEqual(capRushSpinTargetOf(state.picks[0] as CapRushDraftPick));
    expect(capRushSpinDefinitionsForTier(receipt.tier)).toContain(receipt.entry.mutationId);
    expect(receipt.receiptDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(outcome.state.revision).toBe(state.revision + 1);
  });

  it('is deterministic and independent of the chosen target', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(setup, payrollSplit(100_000_000));
    const first = purchase(setup, state, 'standard');
    const replay = purchase(setup, state, 'standard');
    const otherTarget = purchase(setup, state, 'standard', state.picks[3]?.card.cardId ?? '');
    if (first.state.spin.status !== 'purchased') throw new Error('spin was not purchased');
    if (replay.state.spin.status !== 'purchased') throw new Error('replay did not purchase');
    if (otherTarget.state.spin.status !== 'purchased') throw new Error('target did not purchase');
    expect(replay.state.spin.receipt.receiptDigest).toBe(first.state.spin.receipt.receiptDigest);
    expect(otherTarget.state.spin.receipt.tier).toBe(first.state.spin.receipt.tier);
    expect(otherTarget.state.spin.receipt.entry).toEqual(first.state.spin.receipt.entry);
    expect(otherTarget.state.spin.receipt.target.pickOrdinal).toBe(3);
    expect(otherTarget.state.spin.receipt.receiptDigest).not.toBe(
      first.state.spin.receipt.receiptDigest,
    );
  });

  it('derives spin streams from the run seed', () => {
    const first = seedSchema.parse('abc123def4567890');
    const second = seedSchema.parse('0123456789abcdef');
    expect(capRushSpinTierSeed(first)).not.toBe(capRushSpinTierSeed(second));
    const setup = capRushTestSetup();
    const state = buildCompleteState(setup, payrollSplit(100_000_000));
    const pick = state.picks[0] as CapRushDraftPick;
    const purchased = [first, second].map((runSeed) =>
      buildCapRushSpinReceipt({
        runSeed,
        purchase: 'standard',
        payrollDollars: capRushPayrollDollars(state.picks),
        pick,
      }),
    );
    expect(purchased[0]?.receiptDigest).not.toBe(purchased[1]?.receiptDigest);
  });

  it('rejects an unaffordable purchase without moving the revision', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(setup, payrollSplit(110_000_000));
    const outcome = purchase(setup, state, 'standard');
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('spin-ineligible');
    expect(outcome.state.revision).toBe(state.revision);
  });

  it('rejects a target that is not on the roster', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(setup, payrollSplit(100_000_000));
    const outcome = purchase(setup, state, 'standard', `crc-${'f'.repeat(32)}`);
    expect(outcome.result.rejection?.code).toBe('target-unknown');
  });

  it('buys multiple spins for distinct players up to the cap and replays deterministically', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(setup, payrollSplit(90_000_000));
    const first = purchase(setup, state, 'standard');
    expect(purchase(setup, first.state, 'standard').result.rejection?.code).toBe(
      'spin-unavailable',
    );
    const secondPick = state.picks[1];
    if (secondPick === undefined) throw new Error('missing second locked pick');
    const target = secondPick.card.cardId;
    const second = purchase(setup, first.state, 'standard', target);
    const replay = purchase(setup, first.state, 'standard', target);
    expect(second.result.status).toBe('accepted');
    expect(second.state).toEqual(replay.state);
    if (second.state.spin.status !== 'purchased') throw new Error('spin was not purchased');
    expect(second.state.spin.additionalReceipts?.[0]?.payrollDollars).toBe(105_000_000);
    expect(second.state.spin.additionalReceipts?.[0]?.target.cardId).toBe(target);
    expect(
      purchase(setup, second.state, 'standard', state.picks[2]?.card.cardId ?? '').result.rejection
        ?.code,
    ).toBe('spin-ineligible');
  });

  it('skips the spin and then refuses a purchase', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(setup, payrollSplit(100_000_000));
    const skipped = skip(setup, state);
    expect(skipped.result.status).toBe('accepted');
    expect(skipped.state.spin.status).toBe('skipped');
    expect(purchase(setup, skipped.state, 'standard').result.rejection?.code).toBe(
      'spin-unavailable',
    );
  });

  it('has no spin in Cap Clash', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(setup, payrollSplit(100_000_000), 'clash');
    expect(purchase(setup, state, 'standard').result.rejection?.code).toBe('spin-unavailable');
    expect(skip(setup, state).result.rejection?.code).toBe('spin-unavailable');
  });

  it('rejects a spin decision while the draft is incomplete', () => {
    const setup = capRushTestSetup();
    const state = capRushDraftStateSchema.parse({
      ...setup.state,
      variant: 'roulette',
    });
    expect(purchase(setup, state, 'standard', `crc-${'1'.repeat(32)}`).result.rejection?.code).toBe(
      'phase-mismatch',
    );
  });

  it('refuses a stored spin receipt whose price disagrees with its purchase', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(setup, payrollSplit(100_000_000));
    const bought = purchase(setup, state, 'standard').state;
    const spin = bought.spin;
    if (spin.status !== 'purchased') throw new Error('spin was not purchased');
    const tampered = { ...spin.receipt, priceDollars: 30_000_000 };
    expect(() =>
      capRushDraftStateSchema.parse({
        ...bought,
        spin: { status: 'purchased', receipt: tampered },
      }),
    ).toThrow();
  });
});

describe('cap rush spin tier draw', () => {
  it('matches the published categorical odds over a seeded cohort', () => {
    const counts = { 1: 0, 2: 0, 3: 0 };
    const draws = 4000;
    for (let index = 0; index < draws; index += 1) {
      const runSeed = seedSchema.parse(index.toString(16).padStart(16, '0'));
      const tier = drawCapRushSpinTier(createRng(capRushSpinTierSeed(runSeed)), 'standard');
      counts[tier] += 1;
    }
    expect(counts[1] / draws).toBeGreaterThan(0.55);
    expect(counts[1] / draws).toBeLessThan(0.65);
    expect(counts[2] / draws).toBeGreaterThan(0.26);
    expect(counts[2] / draws).toBeLessThan(0.34);
    expect(counts[3] / draws).toBeGreaterThan(0.07);
    expect(counts[3] / draws).toBeLessThan(0.13);
  });

  it('materializes a single definition from the rolled tier', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(setup, payrollSplit(90_000_000));
    const receipt = buildCapRushSpinReceipt({
      runSeed: state.runSeed,
      purchase: 'premium',
      payrollDollars: capRushPayrollDollars(state.picks),
      pick: state.picks[2] as CapRushDraftPick,
    });
    expect(capRushSpinDefinitionsForTier(receipt.tier)).toContain(receipt.entry.mutationId);
    expect(
      receipt.effective.authoritativeChannels.every((channel) => typeof channel === 'string'),
    ).toBe(true);
  });
});
