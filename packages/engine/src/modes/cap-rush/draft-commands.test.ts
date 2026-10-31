import { describe, expect, it } from 'bun:test';
import type { CapRushDraftPick, CapRushDraftState, Position } from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_HARD_LIMIT_DOLLARS,
  CAP_RUSH_REROLL_LIMIT,
  POSITIONS,
  capRushDraftStateSchema,
  commandIdSchema,
} from '@hoop-rush/data-contracts';
import { applyCapRushCommand } from './draft-commands.ts';
import { capRushOfferLegalCardIds } from './feasibility.ts';
import { generateCapRushOffer } from './offers.ts';
import { capRushStateDigest } from './state-digest.ts';
import { capRushSalaryDollars } from './salary.ts';
import { capRushTestSetup, type CapRushTestSetup } from './cap-rush-test-support.ts';

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return [[]];
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += 1) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    const head = items[index];
    if (head === undefined) continue;
    for (const tail of permutations(rest)) result.push([head, ...tail]);
  }
  return result;
}

function commandId(prefix: string, revision: number) {
  return commandIdSchema.parse(`${prefix}-${String(revision)}`);
}

function choose(
  setup: CapRushTestSetup,
  state: CapRushDraftState,
  slot: Position,
): CapRushDraftState {
  const outcome = applyCapRushCommand(
    state,
    {
      command: 'choose-cap-rush-position',
      commandId: commandId(`cmd-choose-${slot.toLowerCase()}`, state.revision),
      runId: state.runId,
      expectedRevision: state.revision,
      slot,
    },
    { index: setup.index },
  );
  expect(outcome.result.status).toBe('accepted');
  return outcome.state;
}

function signCheapestLegal(setup: CapRushTestSetup, state: CapRushDraftState): CapRushDraftState {
  const offer = state.offer;
  if (offer === null) throw new Error('missing offer');
  const legal = new Set(capRushOfferLegalCardIds(state, setup.index, offer.cards));
  const card = [...offer.cards]
    .filter((entry) => legal.has(entry.cardId))
    .sort((left, right) => left.salaryDollars - right.salaryDollars)[0];
  if (card === undefined) throw new Error('offer has no legal signing');
  const outcome = applyCapRushCommand(
    state,
    {
      command: 'sign-cap-rush-card',
      commandId: commandId(`cmd-sign-${card.slot.toLowerCase()}`, state.revision),
      runId: state.runId,
      expectedRevision: state.revision,
      offerId: offer.offerId,
      cardId: card.cardId,
    },
    { index: setup.index },
  );
  expect(outcome.result.status).toBe('accepted');
  return outcome.state;
}

function playOrder(setup: CapRushTestSetup, order: readonly Position[]): CapRushDraftState {
  let state = setup.state;
  for (const slot of order) {
    state = choose(setup, state, slot);
    state = signCheapestLegal(setup, state);
  }
  return state;
}

function reroll(setup: CapRushTestSetup, state: CapRushDraftState) {
  const offer = state.offer;
  if (offer === null) throw new Error('missing offer');
  const protectedCard = offer.cards[0];
  if (protectedCard === undefined) throw new Error('missing card');
  return applyCapRushCommand(
    state,
    {
      command: 'reroll-cap-rush-offer',
      commandId: commandId('cmd-reroll', state.revision),
      runId: state.runId,
      expectedRevision: state.revision,
      offerId: offer.offerId,
      protectedCardId: protectedCard.cardId,
    },
    { index: setup.index },
  );
}

function fabricatedPicks(
  setup: CapRushTestSetup,
  entries: ReadonlyArray<{ slot: Position; overall: number }>,
): CapRushDraftPick[] {
  return entries.map(({ slot, overall }, pickOrdinal) => {
    const player = (setup.index.bySlot.get(slot) ?? []).find(
      (entry) => entry.originalOverall === overall,
    );
    if (player === undefined) throw new Error(`missing ${slot} ${String(overall)}`);
    return {
      pickOrdinal,
      slot,
      card: {
        cardId: `crc-${String(pickOrdinal + 1).repeat(32)}`,
        offerId: `cro-${'a'.repeat(32)}`,
        cardIndex: pickOrdinal,
        slot,
        bucket: 'star',
        source: player,
        salaryDollars: capRushSalaryDollars(player.originalOverall, player.seasonKey),
      },
    };
  });
}

describe('cap rush draft state', () => {
  it('creates a fresh select-position draft', () => {
    const setup = capRushTestSetup({});
    expect(setup.state.revision).toBe(1);
    expect(setup.state.stage).toBe('select-position');
    expect(setup.state.round).toBe(1);
    expect(setup.state.offer).toBeNull();
    expect(setup.state.rerollsRemaining).toBe(CAP_RUSH_REROLL_LIMIT);
    expect(setup.state.variant).toBe('clash');
  });

  it('rejects a second create for the same run', () => {
    const setup = capRushTestSetup({});
    const outcome = applyCapRushCommand(setup.state, setup.createCommand, {
      index: setup.index,
    });
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('phase-mismatch');
  });
});

describe('cap rush five-round draft', () => {
  it('completes all 120 exact-position orders within the hard limit', () => {
    const setup = capRushTestSetup({});
    const orders = permutations(POSITIONS);
    expect(orders).toHaveLength(120);
    for (const order of orders) {
      const state = playOrder(setup, order);
      expect(state.stage).toBe('complete');
      expect(state.picks).toHaveLength(5);
      expect(new Set(state.picks.map((pick) => pick.slot)).size).toBe(5);
      expect(new Set(state.picks.map((pick) => pick.card.source.playerId)).size).toBe(5);
      expect(
        state.picks.reduce((total, pick) => total + pick.card.salaryDollars, 0),
      ).toBeLessThanOrEqual(CAP_RUSH_HARD_LIMIT_DOLLARS);
    }
  });

  it('replays the same commands to the same state and digest', () => {
    const setup = capRushTestSetup({});
    const order: Position[] = ['C', 'PG', 'PF', 'SG', 'SF'];
    const left = playOrder(setup, order);
    const right = playOrder(setup, order);
    expect(right).toEqual(left);
    expect(capRushStateDigest(right)).toBe(capRushStateDigest(left));
  });

  it('shares rerolls across rounds', () => {
    const setup = capRushTestSetup({});
    let state = choose(setup, setup.state, 'PG');
    const first = reroll(setup, state);
    expect(first.result.status).toBe('accepted');
    state = signCheapestLegal(setup, first.state);
    expect(state.rerollsRemaining).toBe(1);
    state = choose(setup, state, 'SG');
    const second = reroll(setup, state);
    expect(second.result.status).toBe('accepted');
    expect(second.state.rerollsRemaining).toBe(0);
    const third = reroll(setup, second.state);
    expect(third.result.status).toBe('rejected');
    expect(third.result.rejection?.code).toBe('reroll-spent');
  });

  it('rejects a stale revision without changing state', () => {
    const setup = capRushTestSetup({});
    const outcome = applyCapRushCommand(
      setup.state,
      {
        command: 'choose-cap-rush-position',
        commandId: commandIdSchema.parse('cmd-stale'),
        runId: setup.state.runId,
        expectedRevision: setup.state.revision - 1,
        slot: 'PG',
      },
      { index: setup.index },
    );
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('stale-revision');
    expect(outcome.state).toBe(setup.state);
  });

  it('rejects choosing a position while an offer is open', () => {
    const setup = capRushTestSetup({});
    const state = choose(setup, setup.state, 'PG');
    const outcome = applyCapRushCommand(
      state,
      {
        command: 'choose-cap-rush-position',
        commandId: commandIdSchema.parse('cmd-double'),
        runId: state.runId,
        expectedRevision: state.revision,
        slot: 'SG',
      },
      { index: setup.index },
    );
    expect(outcome.result.rejection?.code).toBe('phase-mismatch');
  });

  it('rejects choosing an already filled position', () => {
    const setup = capRushTestSetup({});
    let state = choose(setup, setup.state, 'PG');
    state = signCheapestLegal(setup, state);
    const outcome = applyCapRushCommand(
      state,
      {
        command: 'choose-cap-rush-position',
        commandId: commandIdSchema.parse('cmd-taken'),
        runId: state.runId,
        expectedRevision: state.revision,
        slot: 'PG',
      },
      { index: setup.index },
    );
    expect(outcome.result.rejection?.code).toBe('position-taken');
  });

  it('rejects a signing from a different offer', () => {
    const setup = capRushTestSetup({});
    const state = choose(setup, setup.state, 'PG');
    const offer = state.offer;
    if (offer === null) throw new Error('missing offer');
    const outcome = applyCapRushCommand(
      state,
      {
        command: 'sign-cap-rush-card',
        commandId: commandIdSchema.parse('cmd-wrong-offer'),
        runId: state.runId,
        expectedRevision: state.revision,
        offerId: `cro-${'f'.repeat(32)}`,
        cardId: offer.cards[0]?.cardId ?? '',
      },
      { index: setup.index },
    );
    expect(outcome.result.rejection?.code).toBe('offer-mismatch');
  });

  it('rejects rerolling without protecting a visible card', () => {
    const setup = capRushTestSetup({});
    const state = choose(setup, setup.state, 'PG');
    const offer = state.offer;
    if (offer === null) throw new Error('missing offer');
    const outcome = applyCapRushCommand(
      state,
      {
        command: 'reroll-cap-rush-offer',
        commandId: commandIdSchema.parse('cmd-bad-protect'),
        runId: state.runId,
        expectedRevision: state.revision,
        offerId: offer.offerId,
        protectedCardId: `crc-${'f'.repeat(32)}`,
      },
      { index: setup.index },
    );
    expect(outcome.result.rejection?.code).toBe('protected-card-required');
  });

  it('rejects generation failure without consuming the reroll or changing the offer', () => {
    const setup = capRushTestSetup({
      overalls: [99, 90, 89, 86, 79, 77, 74, 70, 65, 60],
    });
    const state = choose(setup, setup.state, 'PG');
    const outcome = reroll(setup, state);
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('generation-failed');
    expect(outcome.state).toBe(state);
    expect(outcome.state.rerollsRemaining).toBe(CAP_RUSH_REROLL_LIMIT);
  });

  it('rejects an unaffordable signing', () => {
    const setup = capRushTestSetup({});
    const picks = fabricatedPicks(setup, [
      { slot: 'C', overall: 99 },
      { slot: 'SG', overall: 97 },
      { slot: 'SF', overall: 86 },
    ]);
    const offer = generateCapRushOffer({
      index: setup.index,
      runSeed: setup.state.runSeed,
      round: 4,
      slot: 'PG',
      offerRevision: 0,
      picks,
    });
    const state = capRushDraftStateSchema.parse({
      ...setup.state,
      stage: 'review-offer',
      round: 4,
      offer,
      picks,
    });
    const card = offer.cards.find((entry) => entry.bucket === 'star');
    if (card === undefined) throw new Error('missing star card');
    const outcome = applyCapRushCommand(
      state,
      {
        command: 'sign-cap-rush-card',
        commandId: commandIdSchema.parse('cmd-broke'),
        runId: state.runId,
        expectedRevision: state.revision,
        offerId: offer.offerId,
        cardId: card.cardId,
      },
      { index: setup.index },
    );
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('budget-rejected');
  });
});
