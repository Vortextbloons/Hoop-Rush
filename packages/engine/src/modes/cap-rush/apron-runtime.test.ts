import { describe, expect, it } from 'bun:test';
import type { CapRushApronRules, SimulationPlayer } from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_CLASH_ISOLATION_EVERY,
  CAP_RUSH_HERO_BALL_ISOLATION_EVERY,
  CAP_RUSH_RULES_VERSION,
  CAP_RUSH_STRIKE_EVERY,
  capRushIsolationDue,
  capRushIsolationReason,
  capRushStrikeApplies,
  capRushStrikeDue,
} from '@hoop-rush/data-contracts';
import { CapRushApronRuntime, capRushApronRuntimeFor } from './apron-runtime.ts';

const FIRST: CapRushApronRules = { payrollStatus: 'first-apron' };
const SECOND: CapRushApronRules = { payrollStatus: 'second-apron' };

function runtime(rules: CapRushApronRules, side: 0 | 1 = 0): CapRushApronRuntime {
  return new CapRushApronRuntime({
    side,
    rules,
    targetInstanceId: `hvi-${'a'.repeat(32)}`,
    targetSlot: 'C',
  });
}

function ordinalsWhere(rules: CapRushApronRules, count: number): number[] {
  const hits: number[] = [];
  for (let ordinal = 1; ordinal <= count; ordinal += 1) {
    if (capRushIsolationDue(rules, ordinal)) hits.push(ordinal);
  }
  return hits;
}

describe('cap rush isolation cadence', () => {
  it('fires every sixth possession in the first apron', () => {
    expect(ordinalsWhere(FIRST, 18)).toEqual([6, 12, 18]);
    expect(CAP_RUSH_CLASH_ISOLATION_EVERY).toBe(6);
  });

  it('fires every third possession in the second apron', () => {
    expect(ordinalsWhere(SECOND, 12)).toEqual([3, 6, 9, 12]);
    expect(CAP_RUSH_HERO_BALL_ISOLATION_EVERY).toBe(3);
  });

  it('names the mechanism after the apron it belongs to', () => {
    expect(capRushIsolationReason(FIRST)).toBe('give-me-the-ball');
    expect(capRushIsolationReason(SECOND)).toBe('hero-ball');
  });

  it('rejects a nonpositive possession ordinal', () => {
    expect(() => capRushIsolationDue(FIRST, 0)).toThrow();
    expect(() => capRushIsolationDue(FIRST, 1.5)).toThrow();
  });
});

describe('cap rush strike cadence', () => {
  it('never strikes in the first apron', () => {
    expect(capRushStrikeApplies(FIRST)).toBe(false);
    for (let ordinal = 1; ordinal <= 18; ordinal += 1) {
      expect(capRushStrikeDue(FIRST, ordinal)).toBe(false);
    }
  });

  it('strikes every eighth opponent possession in the second apron', () => {
    const hits: number[] = [];
    for (let ordinal = 1; ordinal <= 18; ordinal += 1) {
      if (capRushStrikeDue(SECOND, ordinal)) hits.push(ordinal);
    }
    expect(hits).toEqual([8, 16]);
    expect(CAP_RUSH_STRIKE_EVERY).toBe(8);
  });
});

describe('cap rush apron runtime', () => {
  it('never forces isolation on the user side under current rules', () => {
    const apron = runtime(SECOND, 0);
    for (let possession = 1; possession <= 12; possession += 1) {
      apron.beginPossession(0);
      expect(apron.isolationActive()).toBe(false);
      apron.endPossession();
    }
  });

  it('counts ordinals per team independently', () => {
    const apron = runtime(FIRST, 0);
    apron.beginPossession(0);
    apron.beginPossession(1);
    apron.beginPossession(1);
    const state = apron.beginPossession(1);
    expect(state.offenseOrdinal).toBe(3);
    expect(state.defenseOrdinal).toBe(1);
  });

  it('strikes only opponent possessions, in the second apron only', () => {
    const second = runtime(SECOND, 0);
    const first = runtime(FIRST, 0);
    for (let possession = 1; possession <= 16; possession += 1) {
      second.beginPossession(1);
      expect(second.strikeActive()).toBe(possession === 8 || possession === 16);
      second.endPossession();
      first.beginPossession(1);
      expect(first.strikeActive()).toBe(false);
      first.endPossession();
    }
  });

  it('records strike facts only in the second apron', () => {
    const apron = runtime(SECOND, 0);
    for (let possession = 1; possession <= 16; possession += 1) {
      apron.beginPossession(1);
      apron.endPossession();
    }
    const facts = apron.recordedFacts();
    expect(facts.every((fact) => fact.kind === 'strike')).toBe(true);
    expect(facts.map((fact) => fact.possessionOrdinal)).toEqual([8, 16]);
  });

  it('never forces usage during opponent possessions', () => {
    const apron = runtime(SECOND, 0);
    const target = { playerId: 'p-target' } as unknown as SimulationPlayer;
    const team = { teamId: 't', displayName: 'T', players: [target] };
    apron.bindTarget(target);
    for (let possession = 1; possession <= 24; possession += 1) {
      apron.beginPossession(0);
      expect(apron.forcedActor(team)).toBeNull();
      apron.endPossession();
    }
  });

  it('resolves the struck defender during strike possessions', () => {
    const apron = runtime(SECOND, 0);
    const target = { playerId: 'p-target' } as unknown as SimulationPlayer;
    const team = { teamId: 't', displayName: 'T', players: [target] };
    apron.bindTarget(target);
    for (let possession = 1; possession <= 7; possession += 1) {
      apron.beginPossession(1);
      expect(apron.struckDefender(team)).toBeNull();
      apron.endPossession();
    }
    apron.beginPossession(1);
    expect(apron.struckDefender(team)).toBe(target);
  });
});

describe('cap rush telegraphed passes rules', () => {
  it('uses the eighth-possession strike cadence without restoring forced usage', () => {
    const apron = new CapRushApronRuntime({
      side: 0,
      rules: SECOND,
      targetInstanceId: `hvi-${'a'.repeat(32)}`,
      targetSlot: 'C',
    });
    const strikes: number[] = [];
    for (let ordinal = 1; ordinal <= 24; ordinal += 1) {
      apron.beginPossession(1);
      if (apron.strikeActive()) strikes.push(ordinal);
      apron.endPossession();
      apron.beginPossession(0);
      expect(apron.isolationActive()).toBe(false);
      expect(apron.strikeActive()).toBe(false);
      apron.endPossession();
    }
    expect(strikes).toEqual([8, 16, 24]);
  });

  it('only increases interception risk for the user offense', () => {
    for (const side of [0, 1] as const) {
      for (const rules of [FIRST, SECOND]) {
        const apron = new CapRushApronRuntime({
          side,
          rules,
          targetInstanceId: `hvi-${'a'.repeat(32)}`,
          targetSlot: 'C',
        });
        expect(apron.passInterceptionChance(side)).toBe(rules === FIRST ? 0.015 : 0.07);
        expect(apron.passInterceptionChance(side === 0 ? 1 : 0)).toBe(0);
      }
    }
  });

  it('builds apron runtime only for apron payroll statuses', () => {
    expect(
      capRushApronRuntimeFor(
        {
          versionSet: { rulesVersion: CAP_RUSH_RULES_VERSION },
          payrollStatus: 'under-cap',
          target: { instanceId: `hvi-${'a'.repeat(32)}`, slot: 'C' },
          human: { starters: [] },
        },
        'home',
      ),
    ).toBeUndefined();
  });
});
