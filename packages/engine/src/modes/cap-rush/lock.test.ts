import { describe, expect, it } from 'bun:test';
import type { CapRushDraftPick, CapRushDraftState, Position } from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_GAME_COUNT,
  POSITIONS,
  capRushCardSchema,
  capRushDraftStateSchema,
  capRushEmptySeasonState,
  capRushOfferIdSchema,
  canonicalJson,
  seasonKeySchema,
  commandIdSchema,
} from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { simulateCapRushGame } from './season.ts';
import { havocGameTapeDigest } from '../havoc/digests.ts';
import { applyCapRushCommand } from './draft-commands.ts';
import { capRushEffectiveRatings, capRushPayrollStatus } from './salary.ts';
import { capRushHighestPaidOf } from './lock.ts';
import { capRushTestSetup, type CapRushTestSetup } from './cap-rush-test-support.ts';

function playerForSlot(setup: CapRushTestSetup, slot: Position) {
  const player = setup.index.bySlot.get(slot)?.[0];
  if (player === undefined) throw new Error(`test catalog has no ${slot}`);
  return player;
}

function buildCompleteState(
  setup: CapRushTestSetup,
  salaries: readonly number[],
  variant: 'clash' | 'roulette' = 'clash',
  spin: CapRushDraftState['spin'] = { status: 'unavailable' },
): CapRushDraftState {
  const picks: CapRushDraftPick[] = POSITIONS.map((slot, index) => {
    const player = playerForSlot(setup, slot);
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
        salaryDollars: salaries[index] ?? 0,
      }),
    };
  });
  return capRushDraftStateSchema.parse({
    schemaVersion: setup.state.schemaVersion,
    runId: setup.state.runId,
    revision: 9,
    runSeed: setup.state.runSeed,
    variant,
    versionSet: setup.state.versionSet,
    catalog: setup.state.catalog,
    stage: 'complete',
    round: 5,
    offer: null,
    rerollsRemaining: 2,
    picks,
    spin,
    locked: null,
    season: capRushEmptySeasonState(),
  });
}

function lock(
  setup: CapRushTestSetup,
  state: CapRushDraftState,
  picks = state.picks.map((pick) => ({ slot: pick.slot, cardId: pick.card.cardId })),
) {
  return applyCapRushCommand(
    state,
    {
      command: 'lock-cap-rush-lineup',
      commandId: commandIdSchema.parse(`cmd-lock-${String(state.revision)}`),
      runId: state.runId,
      expectedRevision: state.revision,
      picks,
    },
    { index: setup.index, lockSources: setup.lockSources },
  );
}

describe('cap rush highest-paid target', () => {
  it('locks the largest salary regardless of draft order', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(setup, [1_000, 9_000, 5_000, 3_000, 2_000]);
    const target = capRushHighestPaidOf(state.picks, state.runSeed);
    expect(target.pickOrdinal).toBe(1);
    expect(target.slot).toBe('SG');
  });

  it('breaks salary ties with canonical slot order, not draft order', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(setup, [7_000, 7_000, 7_000, 7_000, 7_000]);
    expect(capRushHighestPaidOf(state.picks, state.runSeed).slot).toBe('PG');
    const reordered = capRushDraftStateSchema.parse({
      ...state,
      picks: [...state.picks].reverse().map((pick, index) => ({ ...pick, pickOrdinal: index })),
    });
    expect(capRushHighestPaidOf(reordered.picks, reordered.runSeed).slot).toBe('PG');
  });
});

describe('cap rush lineup lock', () => {
  it('locks a completed draft and pins the season inputs', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(
      setup,
      [20_000_000, 20_000_000, 20_000_000, 20_000_000, 30_000_000],
    );
    const outcome = lock(setup, state);
    expect(outcome.result.status).toBe('accepted');
    expect(outcome.state.stage).toBe('locked');
    expect(outcome.state.revision).toBe(state.revision + 1);

    const locked = outcome.state.locked;
    expect(locked).not.toBeNull();
    if (locked === null) throw new Error('lock did not produce inputs');
    expect(locked.payrollDollars).toBe(110_000_000);
    expect(locked.payrollStatus).toBe('under-cap');
    expect(locked.schedule).toHaveLength(CAP_RUSH_GAME_COUNT);
    expect(locked.opponents).toHaveLength(30);
    expect(locked.picks).toHaveLength(5);
    expect(locked.spin).toBeNull();
    expect(locked.target.slot).toBe('C');
  });

  it('carries apron-reduced ratings into the locked human team', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(
      setup,
      [30_000_000, 30_000_000, 30_000_000, 30_000_000, 30_000_000],
    );
    const outcome = lock(setup, state);
    const locked = outcome.state.locked;
    if (locked === null) throw new Error('lock did not produce inputs');
    expect(locked.payrollStatus).toBe('second-apron');

    const starter = locked.human.starters[0];
    const pick = state.picks[0];
    if (starter === undefined || pick === undefined) throw new Error('missing starter');
    const expected = capRushEffectiveRatings(pick.card.source.profile.ratings, 'second-apron');
    expect(starter.effective.ratings).toEqual(expected);
    expect(starter.effective.ratings.passing).toBe(
      Math.max(0, pick.card.source.profile.ratings.passing - 8),
    );
  });

  it('leaves under-cap ratings untouched', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(
      setup,
      [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000],
    );
    const outcome = lock(setup, state);
    const locked = outcome.state.locked;
    if (locked === null) throw new Error('lock did not produce inputs');
    const starter = locked.human.starters[0];
    const pick = state.picks[0];
    if (starter === undefined || pick === undefined) throw new Error('missing starter');
    expect(starter.effective.ratings).toEqual(pick.card.source.profile.ratings);
  });

  it('replaces the first apron with the second in the locked profile', () => {
    const setup = capRushTestSetup();
    const first = buildCompleteState(
      setup,
      [25_000_000, 25_000_000, 25_000_000, 25_000_000, 25_000_000],
    );
    const second = buildCompleteState(
      setup,
      [30_000_000, 30_000_000, 30_000_000, 30_000_000, 30_000_000],
    );
    expect(capRushPayrollStatus(125_000_000)).toBe('first-apron');
    expect(capRushPayrollStatus(150_000_000)).toBe('second-apron');
    const firstLock = lock(setup, first).state.locked;
    const secondLock = lock(setup, second).state.locked;
    if (firstLock === null || secondLock === null) throw new Error('lock did not produce inputs');
    const firstStarter = firstLock.human.starters[0];
    const secondStarter = secondLock.human.starters[0];
    if (firstStarter === undefined || secondStarter === undefined) throw new Error('missing');
    expect(secondStarter.effective.ratings.insideScoring).toBeLessThan(
      firstStarter.effective.ratings.insideScoring,
    );
  });

  it('refuses to lock before the draft is complete', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(
      setup,
      [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000],
    );
    const partial = capRushDraftStateSchema.parse({
      ...state,
      stage: 'select-position',
      round: 2,
      picks: state.picks.slice(0, 1),
    });
    const outcome = lock(setup, partial);
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('phase-mismatch');
    expect(outcome.state.locked).toBeNull();
  });

  it('refuses picks that do not match the completed draft', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(
      setup,
      [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000],
    );
    const tampered = state.picks.map((pick, index) => ({
      slot: pick.slot,
      cardId: index === 0 ? `crc-${'f'.repeat(32)}` : pick.card.cardId,
    }));
    const outcome = lock(setup, state, tampered);
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('incomplete-lineup');
    expect(outcome.state.revision).toBe(state.revision);
  });

  it('refuses to lock a pending Roulette spin decision', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(
      setup,
      [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000],
      'roulette',
      { status: 'pending' },
    );
    const outcome = lock(setup, state);
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('spin-unavailable');
    expect(outcome.state.locked).toBeNull();
  });

  it('locks a Roulette draft whose spin was skipped', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(
      setup,
      [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000],
      'roulette',
      { status: 'skipped' },
    );
    const outcome = lock(setup, state);
    expect(outcome.result.status).toBe('accepted');
    expect(outcome.state.locked?.spin).toBeNull();
  });

  it('refuses a second lock', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(
      setup,
      [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000],
    );
    const first = lock(setup, state);
    if (first.state.locked === null) throw new Error('lock did not produce inputs');
    const second = lock(setup, first.state);
    expect(second.result.status).toBe('rejected');
    expect(second.result.rejection?.code).toBe('already-locked');
  });

  it('rejects a lock on a stale revision', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(
      setup,
      [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000],
    );
    const outcome = applyCapRushCommand(
      state,
      {
        command: 'lock-cap-rush-lineup',
        commandId: commandIdSchema.parse('cmd-lock-stale'),
        runId: state.runId,
        expectedRevision: state.revision - 1,
        picks: state.picks.map((pick) => ({ slot: pick.slot, cardId: pick.card.cardId })),
      },
      { index: setup.index, lockSources: setup.lockSources },
    );
    expect(outcome.result.rejection?.code).toBe('stale-revision');
    expect(outcome.state.stage).toBe('complete');
  });

  it('rejects a lock without bracket and profile sources', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(
      setup,
      [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000],
    );
    const outcome = applyCapRushCommand(
      state,
      {
        command: 'lock-cap-rush-lineup',
        commandId: commandIdSchema.parse('cmd-lock-nosources'),
        runId: state.runId,
        expectedRevision: state.revision,
        picks: state.picks.map((pick) => ({ slot: pick.slot, cardId: pick.card.cardId })),
      },
      { index: setup.index },
    );
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('generation-failed');
  });

  it('pins the schedule to the frozen bracket without regeneration', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(
      setup,
      [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000],
    );
    const locked = lock(setup, state).state.locked;
    if (locked === null) throw new Error('lock did not produce inputs');
    const bracketSchedule = [...setup.lockSources.bracket.schedule].sort(
      (left, right) => left.gameNumber - right.gameNumber,
    );
    expect(locked.schedule.map((entry) => entry.opponentId)).toEqual(
      bracketSchedule.map((entry) => entry.opponentId),
    );
    expect(locked.opponents.map((opponent) => opponent.opponentId).sort()).toEqual(
      setup.lockSources.bracket.opponents.map((opponent) => opponent.opponentId).sort(),
    );
  });

  it('replays the same lock to identical locked inputs', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(
      setup,
      [12_000_000, 11_000_000, 10_000_000, 9_000_000, 8_000_000],
    );
    const first = lock(setup, state).state.locked;
    const second = lock(setup, state).state.locked;
    expect(first).toEqual(second);
  });

  it('locks a draft whose positions were chosen out of canonical order', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(
      setup,
      [12_000_000, 11_000_000, 10_000_000, 9_000_000, 8_000_000],
    );
    const order: Position[] = ['C', 'SG', 'PG', 'PF', 'SF'];
    const shuffled = capRushDraftStateSchema.parse({
      ...state,
      picks: order.map((slot, index) => {
        const pick = state.picks.find((entry) => entry.slot === slot);
        if (pick === undefined) throw new Error(`missing ${slot}`);
        return { ...pick, pickOrdinal: index };
      }),
    });
    const outcome = lock(setup, shuffled);
    expect(outcome.result.status).toBe('accepted');
    const locked = outcome.state.locked;
    if (locked === null) throw new Error('lock did not produce inputs');
    expect(locked.human.starters.map((starter) => starter.slot)).toEqual([...POSITIONS]);
    expect(locked.human.replacements.map((replacement) => replacement.slot)).toEqual([
      ...POSITIONS,
    ]);
    expect(locked.picks.map((pick) => pick.pickOrdinal)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('cap rush locked spin and replacement roles', () => {
  it('attaches the purchased mutation to the spin target only', () => {
    const setup = capRushTestSetup();
    const base = buildCompleteState(
      setup,
      [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000],
      'roulette',
      { status: 'pending' },
    );
    const target = base.picks[2];
    if (target === undefined) throw new Error('missing target pick');
    const bought = applyCapRushCommand(
      base,
      {
        command: 'purchase-cap-rush-spin',
        commandId: commandIdSchema.parse('cmd-lock-spin'),
        runId: base.runId,
        expectedRevision: base.revision,
        purchase: 'standard',
        targetCardId: target.card.cardId,
      },
      { index: setup.index },
    );
    expect(bought.result.status).toBe('accepted');
    const secondTarget = base.picks[1];
    if (secondTarget === undefined) throw new Error('missing second locked pick');
    const second = applyCapRushCommand(
      bought.state,
      {
        command: 'purchase-cap-rush-spin',
        commandId: commandIdSchema.parse('cmd-lock-spin-2'),
        runId: base.runId,
        expectedRevision: bought.state.revision,
        purchase: 'standard',
        targetCardId: secondTarget.card.cardId,
      },
      { index: setup.index },
    );
    const outcome = lock(setup, second.state);
    expect(outcome.result.status).toBe('accepted');
    const locked = outcome.state.locked;
    if (locked === null) throw new Error('lock did not produce inputs');
    expect(locked.spin).not.toBeNull();
    expect(locked.additionalSpins).toHaveLength(1);

    const mutatedStarters = locked.human.starters.filter(
      (starter) => starter.mutationPackage.length > 0,
    );
    expect(mutatedStarters).toHaveLength(2);
    expect(mutatedStarters.map((starter) => starter.source.playerId)).toContain(
      target.card.source.playerId,
    );
    expect(mutatedStarters.map((starter) => starter.source.playerId)).toContain(
      secondTarget.card.source.playerId,
    );
  });

  it('gives the replacement apron penalties without the mutation', () => {
    const setup = capRushTestSetup();
    const state = buildCompleteState(
      setup,
      [30_000_000, 30_000_000, 30_000_000, 30_000_000, 30_000_000],
      'clash',
    );
    const locked = lock(setup, state).state.locked;
    if (locked === null) throw new Error('lock did not produce inputs');
    const starter = locked.human.starters[3];
    const replacement = locked.human.replacements[3];
    const pick = state.picks[3];
    if (starter === undefined || replacement === undefined || pick === undefined) {
      throw new Error('missing participant');
    }
    expect(replacement.ownerInstanceId).toBe(starter.instanceId);
    expect(replacement.mutationPackage).toEqual([]);
    expect(replacement.effective.ratings).toEqual(starter.effective.ratings);
    expect(replacement.effective.ratings.passing).toBe(
      Math.max(0, pick.card.source.profile.ratings.passing - 8),
    );
  });
  it('retains the frozen franchise season and canonical opponent overall without changing its effective profile', () => {
    const setup = capRushTestSetup();
    const bracket = setup.lockSources.bracket;
    const opponent = bracket.opponents[0];
    if (opponent === undefined) throw new Error('missing opponent');
    const players = opponent.players.map((player) => ({ ...player, overall: 95 }));
    const configured = {
      ...setup,
      lockSources: {
        ...setup.lockSources,
        bracket: {
          ...bracket,
          opponents: bracket.opponents.map((entry) =>
            entry === opponent
              ? { ...entry, seasonKey: seasonKeySchema.parse('2005-06'), players }
              : entry,
          ),
        },
      },
    };
    const before = canonicalJson(configured.lockSources.bracket);
    const locked = lock(
      configured,
      buildCompleteState(configured, [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000]),
    ).state.locked;
    const team = locked?.opponents.find((entry) => entry.opponentId === opponent.opponentId)?.team;
    if (team === undefined) throw new Error('missing frozen opponent');
    expect(canonicalJson(configured.lockSources.bracket)).toBe(before);
    if (locked === null) throw new Error('missing locked inputs');
    const original = lock(
      setup,
      buildCompleteState(setup, [10_000_000, 10_000_000, 10_000_000, 10_000_000, 10_000_000]),
    ).state.locked;
    if (original === null) throw new Error('missing original locked inputs');
    const originalSimulation = simulateCapRushGame({
      locked: original,
      gameNumber: 1,
      context: createEngineContext(),
    });
    const decoratedSimulation = simulateCapRushGame({
      locked,
      gameNumber: 1,
      context: createEngineContext(),
    });
    expect(decoratedSimulation.result.home).toEqual(originalSimulation.result.home);
    expect(decoratedSimulation.result.away).toEqual(originalSimulation.result.away);
    expect(havocGameTapeDigest(decoratedSimulation.tape)).toBe(
      havocGameTapeDigest(originalSimulation.tape),
    );
    for (const participant of [...team.starters, ...team.replacements]) {
      const player = players.find((entry) => entry.playerId === participant.source.playerId);
      if (player === undefined) throw new Error('missing source player');
      expect(participant.source.originalOverall).toBe(95);
      expect(participant.source.overallSource).toBe('catalog');
      expect(participant.source.seasonKey).toBe(seasonKeySchema.parse('2005-06'));
      expect(participant.effective.ratings).toEqual(player.ratings);
      expect(participant.effective.tendencies).toEqual(player.tendencies);
    }
  });
});
