import { describe, expect, it } from 'bun:test';
import type { FullCourtCoachingRule, SimulationPlayer } from '@hoop-rush/data-contracts';
import {
  FULL_COURT_FOUL_LIMIT,
  FULL_COURT_FATIGUE_STEPS,
  FULL_COURT_MAX_PLAYER_SECONDS,
  FULL_COURT_MAX_ROSTER,
  FULL_COURT_MIN_ROSTER,
  FULL_COURT_PACE_DEVIATION_SECONDS,
  FULL_COURT_REGULATION_SECONDS,
  FULL_COURT_REGULATION_TEAM_SECONDS,
  FULL_COURT_RULE_COOLDOWN_SECONDS,
  FULL_COURT_SEVERE_FATIGUE_ENERGY,
  FULL_COURT_TIRED_ENERGY,
  FullCourtSetupError,
  drainedEnergy,
  fatigueLevelOf,
  fatiguePenaltyOf,
  fatiguedPlayer,
  isClosingWindow,
  planSubstitution,
  recoveredEnergy,
  resolveRotationPlan,
  staminaProfileOf,
  unitNameFor,
  type FullCourtRotationContext,
  type FullCourtRotationPlan,
  type FullCourtRotationSnapshot,
  type FullCourtRuleRuntimeState,
  type FullCourtSetupErrorCode,
} from './rotation.ts';
import { fullCourtTestPlayer, fullCourtTestRoster } from './game-test-support.ts';

function expectSetupError(run: () => unknown, code: FullCourtSetupErrorCode): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(FullCourtSetupError);
    expect((error as FullCourtSetupError).code).toBe(code);
    return;
  }
  throw new Error(`expected FullCourtSetupError with code ${code}`);
}

function idsOf(plan: FullCourtRotationPlan): string[] {
  return plan.roster.map((player) => player.playerId);
}

function startingIds(plan: FullCourtRotationPlan): string[] {
  return plan.startingSlots.map((index) => plan.roster[index]?.playerId ?? '');
}

function snapshotOfPlan(
  plan: FullCourtRotationPlan,
  overrides: Partial<FullCourtRotationSnapshot> = {},
): FullCourtRotationSnapshot {
  return {
    plan,
    slots: plan.startingSlots,
    energies: plan.roster.map(() => 1),
    fouls: plan.roster.map(() => 0),
    emergency: plan.roster.map(() => false),
    playedSeconds: plan.roster.map(() => 0),
    stintSeconds: plan.roster.map(() => 0),
    ...overrides,
  };
}

const EARLY: FullCourtRotationContext = {
  globalSeconds: 600,
  period: 0,
  periodSecondsRemaining: 120,
  scoreMargin: 0,
};

const CLOSING: FullCourtRotationContext = {
  globalSeconds: 2760,
  period: 3,
  periodSecondsRemaining: 60,
  scoreMargin: 3,
};

describe('rotation plan construction', () => {
  it('rejects rosters outside five to twelve players', () => {
    expectSetupError(() => resolveRotationPlan([]), 'roster-size');
    expectSetupError(
      () => resolveRotationPlan(fullCourtTestRoster('tiny', FULL_COURT_MIN_ROSTER - 1)),
      'roster-size',
    );
    expectSetupError(
      () => resolveRotationPlan(fullCourtTestRoster('huge', FULL_COURT_MAX_ROSTER + 1)),
      'roster-size',
    );
    expect(() =>
      resolveRotationPlan(fullCourtTestRoster('min', FULL_COURT_MIN_ROSTER)),
    ).not.toThrow();
    expect(() =>
      resolveRotationPlan(fullCourtTestRoster('max', FULL_COURT_MAX_ROSTER)),
    ).not.toThrow();
  });

  it('rejects duplicate players', () => {
    const roster = fullCourtTestRoster('dup', 6);
    const first = roster[0];
    if (first === undefined) throw new Error('fixture missing');
    expectSetupError(
      () => resolveRotationPlan([first, ...roster.slice(1), first]),
      'duplicate-player',
    );
  });

  it('requires five available players and honors the availability seam', () => {
    const roster = fullCourtTestRoster('avail', 7);
    expectSetupError(
      () =>
        resolveRotationPlan(
          roster,
          {},
          roster.map((player, index) => ({ playerId: player.playerId, available: index < 3 })),
        ),
      'insufficient-available',
    );
    const plan = resolveRotationPlan(
      roster,
      {},
      roster.map((player, index) => ({ playerId: player.playerId, available: index !== 0 })),
    );
    expect(plan.available[0]).toBe(false);
    expect(plan.available.filter(Boolean)).toHaveLength(6);
    expect(plan.targetSeconds[0]).toBe(0);
    expect(startingIds(plan)).not.toContain(roster[0]?.playerId ?? '');
    expect(plan.startingSlots).toHaveLength(FULL_COURT_MIN_ROSTER);
  });

  it('allocates exactly 240 regulation minutes across a deep roster', () => {
    const plan = resolveRotationPlan(fullCourtTestRoster('deep', 12));
    const total = plan.targetSeconds.reduce((sum, value) => sum + value, 0);
    expect(total).toBe(FULL_COURT_REGULATION_TEAM_SECONDS);
    expect(plan.notes.map((note) => note.code)).toContain('auto-rotation');
    for (const seconds of plan.targetSeconds) {
      expect(seconds).toBeGreaterThanOrEqual(0);
      expect(seconds).toBeLessThanOrEqual(FULL_COURT_MAX_PLAYER_SECONDS);
    }
  });

  it('keeps an explicit legal plan unchanged and normalizes an illegal one', () => {
    const roster = fullCourtTestRoster('targets', 8);
    const legal: Record<string, number> = {};
    const minutes = [38, 36, 34, 32, 30, 26, 24, 20];
    roster.forEach((player, index) => {
      legal[player.playerId] = minutes[index] ?? 0;
    });
    const exact = resolveRotationPlan(roster, { minuteTargets: legal });
    expect(exact.notes.map((note) => note.code)).not.toContain('targets-scaled');
    expect(exact.targetSeconds.reduce((sum, value) => sum + value, 0)).toBe(
      FULL_COURT_REGULATION_TEAM_SECONDS,
    );

    const short: Record<string, number> = {};
    roster.forEach((player) => {
      short[player.playerId] = 12;
    });
    const scaled = resolveRotationPlan(roster, { minuteTargets: short });
    expect(scaled.notes.map((note) => note.code)).toContain('targets-scaled');
    expect(scaled.targetSeconds.reduce((sum, value) => sum + value, 0)).toBe(
      FULL_COURT_REGULATION_TEAM_SECONDS,
    );
  });

  it('fills a short minute plan from available reserves and gives injured players zero minutes', () => {
    const roster = fullCourtTestRoster('short-handed', 8);
    const minuteTargets = Object.fromEntries(
      roster.map((player, index) => [player.playerId, index < 5 ? 48 : 0]),
    );
    const plan = resolveRotationPlan(roster, { minuteTargets }, [
      { playerId: roster[0]?.playerId ?? '', available: false, reason: 'injury' },
    ]);
    expect(plan.targetSeconds.slice(0, 5)).toEqual([0, 2880, 2880, 2880, 2880]);
    expect(plan.targetSeconds.slice(5).reduce((sum, seconds) => sum + seconds, 0)).toBe(2880);
    expect(plan.notes.map((note) => note.code)).toContain('targets-scaled');
  });

  it('rejects out-of-range minute targets and malformed lineups', () => {
    const roster = fullCourtTestRoster('bad', 7);
    const target = roster[0]?.playerId ?? '';
    expectSetupError(
      () => resolveRotationPlan(roster, { minuteTargets: { [target]: 49 } }),
      'invalid-target',
    );
    expectSetupError(
      () => resolveRotationPlan(roster, { minuteTargets: { [target]: -1 } }),
      'invalid-target',
    );
    expectSetupError(
      () => resolveRotationPlan(roster, { startingFive: [target] }),
      'invalid-lineup',
    );
    expectSetupError(
      () => resolveRotationPlan(roster, { startingFive: [target, target, target, target, target] }),
      'invalid-lineup',
    );
    expectSetupError(
      () =>
        resolveRotationPlan(roster, { startingFive: ['ghost', target, target, target, target] }),
      'invalid-lineup',
    );
  });

  it('substitutes an unavailable starter instead of fielding four', () => {
    const roster = fullCourtTestRoster('starters', 7);
    const requested = roster.slice(0, 5).map((player) => player.playerId);
    const plan = resolveRotationPlan(roster, { startingFive: requested }, [
      { playerId: requested[0] ?? '', available: false, reason: 'injury' },
    ]);
    expect(startingIds(plan)).not.toContain(requested[0] ?? '');
    expect(new Set(plan.startingSlots).size).toBe(FULL_COURT_MIN_ROSTER);
    expect(plan.notes.map((note) => note.code)).toContain('starter-unavailable');
  });

  it('resolves named units by roster membership and reports their name', () => {
    const roster = fullCourtTestRoster('units', 8);
    const starters = roster.slice(0, 5).map((player) => player.playerId);
    const bench = roster.slice(5, 8).map((player) => player.playerId);
    const closing = [...starters.slice(0, 3), ...bench.slice(0, 2)];
    const plan = resolveRotationPlan(roster, {
      startingFive: starters,
      closingFive: closing,
      units: [{ name: 'Closing Five', playerIds: closing }],
    });
    expect(unitNameFor(plan, plan.closingSlots)).toBe('Closing Five');
    expect(unitNameFor(plan, plan.startingSlots)).toBeNull();
    expect(plan.units).toEqual([
      { name: 'Closing Five', rosterIndices: plan.closingSlots.slice(0, 5) },
    ]);
  });

  it('derives stamina from workload and honors catalog ratings', () => {
    const lowMinutes = fullCourtTestPlayer({ prefix: 'low', index: 0, minutesPerGame: 14 });
    const highMinutes = fullCourtTestPlayer({ prefix: 'high', index: 0, minutesPerGame: 40 });
    const sparse = fullCourtTestPlayer({
      prefix: 'sparse',
      index: 0,
      minutesPerGame: 40,
      gamesPlayed: 1,
    });
    const unknown: SimulationPlayer = { ...lowMinutes, anchors: undefined };

    const low = staminaProfileOf(lowMinutes);
    const high = staminaProfileOf(highMinutes);
    expect(high.capacityScale).toBeGreaterThan(low.capacityScale);
    expect(low.source).toBe('historical-workload');
    expect(unknown.anchors).toBeUndefined();
    expect(staminaProfileOf(unknown).source).toBe('prior');

    // Sparse evidence shrinks toward the neutral prior instead of trusting 40 mpg.
    const sparseScale = staminaProfileOf(sparse).capacityScale;
    expect(sparseScale).toBeGreaterThan(low.capacityScale);
    expect(sparseScale).toBeLessThan(high.capacityScale);

    const elite = staminaProfileOf(lowMinutes, { rating: 95 });
    const poor = staminaProfileOf(lowMinutes, { rating: 45 });
    expect(elite.source).toBe('catalog-rating');
    expect(elite.capacityScale).toBeGreaterThan(poor.capacityScale);
    expect(staminaProfileOf(lowMinutes, { stamina: 0.5 }).source).toBe('override');
  });

  it('drains by live time and restores on the bench', () => {
    const profile = staminaProfileOf(fullCourtTestPlayer({ prefix: 'e', index: 0 }));
    const half = drainedEnergy(1, profile, FULL_COURT_REGULATION_SECONDS / 2);
    expect(half).toBeLessThan(1);
    expect(half).toBeGreaterThan(0);
    const full = drainedEnergy(1, profile, FULL_COURT_REGULATION_SECONDS * 2);
    expect(full).toBe(0);
    expect(recoveredEnergy(0, FULL_COURT_REGULATION_SECONDS * 2)).toBe(1);
  });

  it('maps energy onto bounded, accelerated fatigue levels', () => {
    expect(fatigueLevelOf(1)).toBe(0);
    expect(fatigueLevelOf(0)).toBe(FULL_COURT_FATIGUE_STEPS);
    expect(fatiguePenaltyOf(0)).toBe(0);
    expect(fatiguePenaltyOf(FULL_COURT_FATIGUE_STEPS)).toBe(1);
    // Early steps cost less than late ones, so a short stint barely matters.
    expect(fatiguePenaltyOf(2)).toBeLessThan(fatiguePenaltyOf(3) - fatiguePenaltyOf(2));

    const base = fullCourtTestPlayer({ prefix: 'fat', index: 0, rating: 80 });
    expect(fatiguedPlayer(base, 0)).toBe(base);
    const tired = fatiguedPlayer(base, FULL_COURT_FATIGUE_STEPS);
    expect(tired.playerId).toBe(base.playerId);
    expect(tired.playerVersionId).toBe(base.playerVersionId);
    expect(tired.ratings.ballHandling).toBeLessThan(base.ratings.ballHandling);
    expect(tired.ratings.threePoint).toBeLessThan(base.ratings.threePoint);
    expect(tired.ratings.defensiveIq).toBeLessThan(base.ratings.defensiveIq);
    // Fatigue must not turn a starter into a non-player.
    for (const key of Object.keys(base.ratings) as Array<keyof SimulationPlayer['ratings']>) {
      expect(tired.ratings[key]).toBeGreaterThanOrEqual(40);
    }
  });
});

describe('substitution decisions', () => {
  it('exits a disqualified player at the next opportunity', () => {
    const plan = resolveRotationPlan(fullCourtTestRoster('foul', 7));
    const out = plan.startingSlots[2] ?? 0;
    const fouls = plan.roster.map((_player, index) => (index === out ? FULL_COURT_FOUL_LIMIT : 0));
    const decision = planSubstitution(snapshotOfPlan(plan, { fouls }), EARLY);
    expect(decision.kind).toBe('swap');
    if (decision.kind !== 'swap') return;
    expect(decision.reason).toBe('foul-out');
    expect(decision.outIndex).toBe(out);
    expect(plan.startingSlots).not.toContain(decision.inIndex);
  });

  it('uses emergency continuation when nobody can replace a disqualified player', () => {
    // Five players, all disqualified: the rules leave nobody to come in.
    const plan = resolveRotationPlan(fullCourtTestRoster('stuck', FULL_COURT_MIN_ROSTER));
    const fouls = plan.roster.map(() => FULL_COURT_FOUL_LIMIT);
    const decision = planSubstitution(snapshotOfPlan(plan, { fouls }), EARLY);
    expect(decision.kind).toBe('emergency');
  });

  it('replaces a severely fatigued player with a fresher reserve', () => {
    const plan = resolveRotationPlan(fullCourtTestRoster('tired', 8));
    const out = plan.startingSlots[0] ?? 0;
    const energies = plan.roster.map((_player, index) =>
      index === out ? FULL_COURT_SEVERE_FATIGUE_ENERGY - 0.05 : 1,
    );
    const stintSeconds = plan.startingSlots.map(() => 600);
    const decision = planSubstitution(snapshotOfPlan(plan, { energies, stintSeconds }), EARLY);
    expect(decision.kind).toBe('swap');
    if (decision.kind !== 'swap') return;
    expect(decision.outIndex).toBe(out);
    expect(decision.reason).toBe('fatigue');
    expect(plan.startingSlots).not.toContain(decision.inIndex);
  });

  it('brings the closing five in during a close fourth quarter', () => {
    const roster = fullCourtTestRoster('closer', 9);
    const five = roster.slice(0, 5).map((player) => player.playerId);
    const closing = roster.slice(4, 9).map((player) => player.playerId);
    const plan = resolveRotationPlan(roster, { startingFive: five, closingFive: closing });
    const decision = planSubstitution(snapshotOfPlan(plan), CLOSING);
    expect(decision.kind).toBe('swap');
    if (decision.kind !== 'swap') return;
    expect(decision.reason).toBe('closing-five');
    expect(plan.closingSlots).toContain(decision.inIndex);
    expect(plan.closingSlots).not.toContain(decision.outIndex);
  });

  it('keeps the closing five on the floor once they are out there', () => {
    const roster = fullCourtTestRoster('closer2', 9);
    const five = roster.slice(0, 5).map((player) => player.playerId);
    const closing = roster.slice(4, 9).map((player) => player.playerId);
    const plan = resolveRotationPlan(roster, { startingFive: five, closingFive: closing });
    const decision = planSubstitution(snapshotOfPlan(plan, { slots: plan.closingSlots }), CLOSING);
    expect(decision.kind).toBe('none');
  });

  it.each([FULL_COURT_SEVERE_FATIGUE_ENERGY, FULL_COURT_TIRED_ENERGY])(
    'keeps a closer benched after a fatigue swap with %s energy',
    (energy) => {
      const roster = fullCourtTestRoster('spent-closer', 8);
      const five = roster.slice(0, 5).map((player) => player.playerId);
      const plan = resolveRotationPlan(roster, { startingFive: five, closingFive: five });
      const tired = plan.startingSlots[0] ?? 0;
      const snapshot = snapshotOfPlan(plan, {
        energies: roster.map((_, index) => (index === tired ? energy : 1)),
        stintSeconds: five.map(() => 600),
      });
      const swap = planSubstitution(snapshot, CLOSING);
      expect(swap.kind).toBe('swap');
      if (swap.kind !== 'swap') return;
      expect(swap.reason).toBe('fatigue');
      expect(swap.outIndex).toBe(tired);
      const slots = snapshot.slots.map((slot, index) =>
        index === swap.slot ? swap.inIndex : slot,
      );
      expect(planSubstitution({ ...snapshot, slots }, CLOSING).kind).toBe('none');
    },
  );

  it('does not pull a starter before the minimum stint elapses', () => {
    const plan = resolveRotationPlan(fullCourtTestRoster('stint', 9));
    const out = plan.startingSlots[0] ?? 0;
    const energies = plan.roster.map((_player, index) =>
      index === out ? FULL_COURT_TIRED_ENERGY - 0.05 : 1,
    );
    const decision = planSubstitution(
      snapshotOfPlan(plan, { energies, stintSeconds: plan.startingSlots.map(() => 30) }),
      EARLY,
    );
    expect(decision.kind).toBe('none');
  });

  it('paces a star whose minutes run ahead of plan', () => {
    const roster = fullCourtTestRoster('pace', 9);
    const star = roster[0];
    if (star === undefined) throw new Error('fixture missing');
    const targets: Record<string, number> = { [star.playerId]: 36 };
    for (const player of roster.slice(1, 5)) targets[player.playerId] = 36;
    for (const player of roster.slice(5)) targets[player.playerId] = 18;
    const plan = resolveRotationPlan(roster, { minuteTargets: targets });
    const starSlot = plan.startingSlots.indexOf(0);
    expect(starSlot).toBeGreaterThanOrEqual(0);

    const behind = plan.roster.map((_player, index) =>
      index === 0 ? (plan.targetSeconds[0] ?? 0) : 0,
    );
    const decision = planSubstitution(
      snapshotOfPlan(plan, {
        playedSeconds: behind,
        stintSeconds: plan.startingSlots.map((index) => (index === 0 ? 900 : 10)),
      }),
      EARLY,
    );
    expect(decision.kind).toBe('swap');
    if (decision.kind !== 'swap') return;
    expect(decision.reason).toBe('minute-target');
    expect(decision.outIndex).toBe(0);
  });

  it('never removes an emergency continuation player', () => {
    const plan = resolveRotationPlan(fullCourtTestRoster('em', 6));
    const stuck = plan.startingSlots[0] ?? 0;
    const energies = plan.roster.map((_player, index) => (index === stuck ? 0 : 1));
    const emergency = plan.roster.map((_player, index) => index === stuck);
    const decision = planSubstitution(
      snapshotOfPlan(plan, {
        energies,
        emergency,
        stintSeconds: plan.startingSlots.map(() => 900),
      }),
      EARLY,
    );
    if (decision.kind === 'swap') expect(decision.outIndex).not.toBe(stuck);
  });

  it('leaves a healthy rotation alone', () => {
    const plan = resolveRotationPlan(fullCourtTestRoster('healthy', 8));
    const decision = planSubstitution(
      snapshotOfPlan(plan, { stintSeconds: plan.startingSlots.map(() => 120) }),
      EARLY,
    );
    expect(decision.kind).toBe('none');
  });

  it('resolves equal candidates by stable roster order', () => {
    const roster = fullCourtTestRoster('stable', 8);
    const plan = resolveRotationPlan(roster, {
      startingFive: roster.slice(0, 5).map((player) => player.playerId),
      substitutionPriority: {},
    });
    const out = plan.startingSlots[3] ?? 0;
    const fouls = plan.roster.map((_player, index) => (index === out ? FULL_COURT_FOUL_LIMIT : 0));
    const run = () =>
      planSubstitution(
        snapshotOfPlan(plan, { fouls, playedSeconds: plan.roster.map(() => 0) }),
        EARLY,
      );
    const first = run();
    const second = run();
    expect(first).toEqual(second);
    expect(idsOf(plan)).toEqual(roster.map((player) => player.playerId));
  });

  it('only treats the closing window as live in a close fourth quarter', () => {
    expect(isClosingWindow(CLOSING)).toBe(true);
    expect(isClosingWindow({ ...CLOSING, period: 2 })).toBe(false);
    expect(isClosingWindow({ ...CLOSING, scoreMargin: 25 })).toBe(false);
    // Overtime is always a closing window.
    expect(isClosingWindow({ ...CLOSING, period: 4, scoreMargin: 25 })).toBe(true);
  });

  it('keeps the pace threshold generous enough for a 48-minute game', () => {
    // A 36-minute starter is never 150 seconds "ahead" of plan at quarter speed.
    const plan = resolveRotationPlan(fullCourtTestRoster('pace2', 8));
    const expectedAtQuarter = plan.roster.map(
      (_player, index) => (plan.targetSeconds[index] ?? 0) * 0.25,
    );
    const played = expectedAtQuarter.map((value) => value + FULL_COURT_PACE_DEVIATION_SECONDS - 1);
    const decision = planSubstitution(
      snapshotOfPlan(plan, {
        playedSeconds: played,
        stintSeconds: plan.startingSlots.map(() => 200),
      }),
      { ...EARLY, globalSeconds: FULL_COURT_REGULATION_SECONDS * 0.25 },
    );
    expect(decision.kind).toBe('none');
  });
});

function ruleStateOf(plan: FullCourtRotationPlan): FullCourtRuleRuntimeState {
  return {
    activated: plan.rules.map(() => false),
    cooldownsUntil: plan.rules.map(() => 0),
    boundarySeconds: -1,
    boundaryRuleIndex: -1,
  };
}

const RULE_CLOSING: FullCourtRotationContext = {
  globalSeconds: FULL_COURT_REGULATION_SECONDS - 300,
  period: 3,
  periodSecondsRemaining: 300,
  scoreMargin: 5,
  legalWindow: true,
};

function idAt(ids: readonly string[], index: number): string {
  const id = ids[index];
  if (id === undefined) throw new Error('Full Court test roster is missing a player');
  return id;
}

function lineupOf(ids: readonly string[], ...indexes: number[]): string[] {
  return indexes.map((index) => idAt(ids, index));
}

describe('coaching rules', () => {
  it('resolves the ordered first applicable rule and ignores the lower-priority rule', () => {
    const roster = fullCourtTestRoster('rules', 9);
    const ids = roster.map((player) => player.playerId);
    const rules: FullCourtCoachingRule[] = [
      {
        ruleId: 'first',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 8,
        lineup: lineupOf(ids, 1, 2, 4, 5, 6),
      },
      {
        ruleId: 'second',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 8,
        lineup: lineupOf(ids, 0, 1, 2, 3, 7),
      },
    ];
    const plan = resolveRotationPlan(roster, { startingFive: ids.slice(0, 5), rules });
    const state = ruleStateOf(plan);
    const decision = planSubstitution(snapshotOfPlan(plan), RULE_CLOSING, state);
    expect(decision.kind).toBe('swap');
    if (decision.kind !== 'swap') return;
    expect(decision.reason).toBe('coach-rule');
    expect(decision.inIndex).toBe(5);
    expect(state.boundaryRuleIndex).toBe(0);
  });

  it('activates a closing lineup once and supersedes lower closing rules', () => {
    const roster = fullCourtTestRoster('rules-once', 9);
    const ids = roster.map((player) => player.playerId);
    const rules: FullCourtCoachingRule[] = [
      {
        ruleId: 'first',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 8,
        lineup: lineupOf(ids, 1, 2, 4, 5, 6),
      },
      {
        ruleId: 'second',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 8,
        lineup: lineupOf(ids, 0, 1, 2, 3, 7),
      },
    ];
    const plan = resolveRotationPlan(roster, { startingFive: ids.slice(0, 5), rules });
    const state = ruleStateOf(plan);
    const slots = [...plan.startingSlots];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const decision = planSubstitution(
        snapshotOfPlan(plan, { slots, energies: plan.roster.map(() => 1) }),
        RULE_CLOSING,
        state,
      );
      if (decision.kind !== 'swap') break;
      slots[decision.slot] = decision.inIndex;
    }
    expect(new Set(slots)).toEqual(new Set([1, 2, 4, 5, 6]));
    expect(state.activated).toEqual([true, true]);
    expect(planSubstitution(snapshotOfPlan(plan, { slots }), RULE_CLOSING, state).kind).toBe(
      'none',
    );
  });

  it('keeps a lower closing rule live when only its time window, not its margin, is satisfied', () => {
    const roster = fullCourtTestRoster('rules-margin', 9);
    const ids = roster.map((player) => player.playerId);
    const rules: FullCourtCoachingRule[] = [
      {
        ruleId: 'lead',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 8,
        lineup: lineupOf(ids, 1, 2, 4, 5, 6),
      },
      {
        ruleId: 'one-possession',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 2,
        lineup: lineupOf(ids, 0, 3, 5, 7, 8),
      },
    ];
    const plan = resolveRotationPlan(roster, { startingFive: ids.slice(0, 5), rules });
    const state = ruleStateOf(plan);
    const slots = [...plan.startingSlots];
    const applyWindow = (context: FullCourtRotationContext): void => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const decision = planSubstitution(snapshotOfPlan(plan, { slots }), context, state);
        if (decision.kind !== 'swap') return;
        slots[decision.slot] = decision.inIndex;
      }
    };

    // The higher rule owns a five-point game and is spent as a one-shot.
    applyWindow(RULE_CLOSING);
    expect(new Set(slots)).toEqual(new Set([1, 2, 4, 5, 6]));
    // The lower rule's own margin condition did not hold, so it stays available.
    expect(state.activated).toEqual([true, false]);

    // A later dead ball inside the same time window is now a one-possession game.
    applyWindow({
      ...RULE_CLOSING,
      globalSeconds: FULL_COURT_REGULATION_SECONDS - 200,
      periodSecondsRemaining: 200,
      scoreMargin: 1,
    });
    expect(new Set(slots)).toEqual(new Set([0, 3, 5, 7, 8]));
    expect(state.activated).toEqual([true, true]);
  });

  it('keeps a chosen closing rule lineup through the same dead-ball boundary', () => {
    const roster = fullCourtTestRoster('rules-boundary', 9);
    const ids = roster.map((player) => player.playerId);
    const ruleLineup = lineupOf(ids, 1, 2, 4, 5, 6);
    const ruleIndices = [1, 2, 4, 5, 6];
    const rules: FullCourtCoachingRule[] = [
      {
        ruleId: 'lead',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 8,
        lineup: ruleLineup,
      },
    ];
    const plan = resolveRotationPlan(roster, {
      startingFive: ids.slice(0, 5),
      closingFive: lineupOf(ids, 0, 3, 5, 7, 8),
      rules,
    });
    const state = ruleStateOf(plan);
    const slots = [...plan.startingSlots];
    const lateWindow: FullCourtRotationContext = {
      globalSeconds: FULL_COURT_REGULATION_SECONDS - 120,
      period: 3,
      periodSecondsRemaining: 120,
      scoreMargin: 5,
      legalWindow: true,
    };
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const decision = planSubstitution(snapshotOfPlan(plan, { slots }), lateWindow, state);
      if (decision.kind !== 'swap') break;
      slots[decision.slot] = decision.inIndex;
    }

    expect(new Set(slots)).toEqual(new Set(ruleIndices));
    // The staff closing five is also live here but must not replace the rule
    // lineup at the same dead ball.
    expect(planSubstitution(snapshotOfPlan(plan, { slots }), lateWindow, state).kind).toBe('none');
    expect(new Set(slots)).toEqual(new Set(ruleIndices));
  });

  it('keeps forced disqualification exits ahead of a matching rule', () => {
    const roster = fullCourtTestRoster('rules-forced', 9);
    const ids = roster.map((player) => player.playerId);
    const rules: FullCourtCoachingRule[] = [
      {
        ruleId: 'closing',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 8,
        lineup: lineupOf(ids, 1, 2, 4, 5, 6),
      },
    ];
    const plan = resolveRotationPlan(roster, { startingFive: ids.slice(0, 5), rules });
    const fouls = plan.roster.map((_player, index) => (index === 0 ? FULL_COURT_FOUL_LIMIT : 0));
    const decision = planSubstitution(
      snapshotOfPlan(plan, { fouls }),
      RULE_CLOSING,
      ruleStateOf(plan),
    );
    expect(decision.kind).toBe('swap');
    if (decision.kind !== 'swap') return;
    expect(decision.reason).toBe('foul-out');
    expect(decision.outIndex).toBe(0);
  });

  it('skips a foul-trouble rule when its named reserve is unavailable', () => {
    const roster = fullCourtTestRoster('rules-foul', 8);
    const ids = roster.map((player) => player.playerId);
    const rules: FullCourtCoachingRule[] = [
      {
        ruleId: 'foul',
        kind: 'foul-trouble',
        playerId: idAt(ids, 0),
        foulLimit: 4,
        replacementPlayerId: idAt(ids, 5),
      },
    ];
    const availability = roster.map((player, index) => ({
      playerId: player.playerId,
      available: index !== 5,
    }));
    const plan = resolveRotationPlan(
      roster,
      { startingFive: ids.slice(0, 5), rules },
      availability,
    );
    const fouls = plan.roster.map((_player, index) => (index === 0 ? 4 : 0));
    const decision = planSubstitution(
      snapshotOfPlan(plan, { fouls }),
      { ...EARLY, legalWindow: true },
      ruleStateOf(plan),
    );
    expect(decision.kind).toBe('none');
  });

  it('replaces a player in foul trouble with the chosen reserve', () => {
    const roster = fullCourtTestRoster('rules-foul-ok', 8);
    const ids = roster.map((player) => player.playerId);
    const rules: FullCourtCoachingRule[] = [
      {
        ruleId: 'foul',
        kind: 'foul-trouble',
        playerId: idAt(ids, 0),
        foulLimit: 4,
        replacementPlayerId: idAt(ids, 5),
      },
    ];
    const plan = resolveRotationPlan(roster, { startingFive: ids.slice(0, 5), rules });
    const fouls = plan.roster.map((_player, index) => (index === 0 ? 4 : 0));
    const state = ruleStateOf(plan);
    const decision = planSubstitution(
      snapshotOfPlan(plan, { fouls }),
      { ...EARLY, legalWindow: true },
      state,
    );
    expect(decision.kind).toBe('swap');
    if (decision.kind !== 'swap') return;
    expect(decision.reason).toBe('coach-rule');
    expect(decision.outIndex).toBe(plan.startingSlots[0] ?? -1);
    expect(decision.inIndex).toBe(5);
    expect(state.cooldownsUntil[0]).toBe(EARLY.globalSeconds + FULL_COURT_RULE_COOLDOWN_SECONDS);
  });

  it('does not run rules outside a legal substitution window', () => {
    const roster = fullCourtTestRoster('rules-window', 9);
    const ids = roster.map((player) => player.playerId);
    const rules: FullCourtCoachingRule[] = [
      {
        ruleId: 'closing',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 8,
        lineup: lineupOf(ids, 1, 2, 4, 5, 6),
      },
    ];
    const plan = resolveRotationPlan(roster, { startingFive: ids.slice(0, 5), rules });
    const decision = planSubstitution(
      snapshotOfPlan(plan),
      { ...RULE_CLOSING, legalWindow: false },
      ruleStateOf(plan),
    );
    expect(decision.kind).toBe('none');
  });

  it('rejects rules that name players outside the roster', () => {
    const roster = fullCourtTestRoster('rules-unknown', 8);
    const rules: FullCourtCoachingRule[] = [
      {
        ruleId: 'unknown',
        kind: 'foul-trouble',
        playerId: 'missing-player',
        foulLimit: 4,
      },
    ];
    expectSetupError(() => resolveRotationPlan(roster, { rules }), 'unknown-player');
  });

  it('rejects repeated players inside a rule lineup', () => {
    const roster = fullCourtTestRoster('rules-dup', 8);
    const ids = roster.map((player) => player.playerId);
    const rules: FullCourtCoachingRule[] = [
      {
        ruleId: 'repeat',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 8,
        lineup: lineupOf(ids, 0, 1, 2, 3, 3),
      },
    ];
    expectSetupError(() => resolveRotationPlan(roster, { rules }), 'invalid-lineup');
  });
});

describe('coaching rule precedence', () => {
  it('lets an already-satisfied higher rule suppress lower closing rules', () => {
    const roster = fullCourtTestRoster('rules-satisfied', 9);
    const ids = roster.map((player) => player.playerId);
    const starting = ids.slice(0, 5);
    const rules: FullCourtCoachingRule[] = [
      {
        ruleId: 'already',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 8,
        lineup: starting,
      },
      {
        ruleId: 'lower',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 8,
        lineup: lineupOf(ids, 1, 2, 4, 5, 6),
      },
    ];
    const plan = resolveRotationPlan(roster, { startingFive: starting, rules });
    const state = ruleStateOf(plan);
    expect(planSubstitution(snapshotOfPlan(plan), RULE_CLOSING, state).kind).toBe('none');
    expect(state.activated).toEqual([false, false]);
    expect(state.boundaryRuleIndex).toBe(0);
  });
});
