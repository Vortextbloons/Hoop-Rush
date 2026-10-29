import { describe, expect, it } from 'bun:test';
import type { CapRushApronRules, SimulationPlayer } from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_CLASH_ISOLATION_EVERY,
  CAP_RUSH_HERO_BALL_ISOLATION_EVERY,
  CAP_RUSH_STRIKE_EVERY,
  capRushIsolationDue,
  capRushIsolationReason,
  capRushStrikeApplies,
  capRushStrikeDue,
} from '@hoop-rush/data-contracts';
import { CapRushApronRuntime } from './apron-runtime.ts';

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

  it('strikes every sixth opponent possession in the second apron', () => {
    const hits: number[] = [];
    for (let ordinal = 1; ordinal <= 18; ordinal += 1) {
      if (capRushStrikeDue(SECOND, ordinal)) hits.push(ordinal);
    }
    expect(hits).toEqual([6, 12, 18]);
    expect(CAP_RUSH_STRIKE_EVERY).toBe(6);
  });
});

describe('cap rush apron runtime', () => {
  it('only starts isolating on the user side', () => {
    const apron = runtime(FIRST, 0);
    for (let possession = 1; possession <= 5; possession += 1) {
      apron.beginPossession(0);
      expect(apron.isolationActive()).toBe(false);
      apron.endPossession();
    }
    apron.beginPossession(0);
    expect(apron.isolationActive()).toBe(true);
    apron.endPossession();
  });

  it('never isolates the opponent side', () => {
    const apron = runtime(SECOND, 0);
    for (let possession = 1; possession <= 12; possession += 1) {
      apron.beginPossession(1);
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
    for (let possession = 1; possession <= 6; possession += 1) {
      second.beginPossession(1);
      expect(second.strikeActive()).toBe(possession === 6);
      second.endPossession();
      first.beginPossession(1);
      expect(first.strikeActive()).toBe(false);
      first.endPossession();
    }
  });

  it('records a typed fact for every isolation and strike', () => {
    const apron = runtime(SECOND, 0);
    for (let possession = 1; possession <= 6; possession += 1) {
      apron.beginPossession(0);
      apron.endPossession();
      apron.beginPossession(1);
      apron.endPossession();
    }
    const facts = apron.recordedFacts();
    const isolations = facts.filter((fact) => fact.kind === 'isolation');
    const strikes = facts.filter((fact) => fact.kind === 'strike');
    expect(isolations.map((fact) => fact.possessionOrdinal)).toEqual([3, 6]);
    expect(strikes.map((fact) => fact.possessionOrdinal)).toEqual([6]);
    expect(isolations.every((fact) => fact.side === 'home')).toBe(true);
    expect(isolations[0]).toMatchObject({
      reason: 'hero-ball',
      targetSlot: 'C',
      payrollStatus: 'second-apron',
    });
  });

  it('reports the forced actor and struck defender only during their possession', () => {
    const apron = runtime(SECOND, 0);
    const target = { playerId: 'p-target' } as unknown as SimulationPlayer;
    const team = { teamId: 't', displayName: 'T', players: [target] };
    apron.bindTarget(target);
    for (let possession = 1; possession <= 2; possession += 1) {
      apron.beginPossession(0);
      expect(apron.forcedActor(team)).toBeNull();
      apron.endPossession();
      apron.beginPossession(1);
      expect(apron.struckDefender(team)).toBeNull();
      apron.endPossession();
    }
    apron.beginPossession(0);
    expect(apron.forcedActor(team)).toBe(target);
    expect(apron.struckDefender(team)).toBeNull();
    apron.endPossession();
    apron.beginPossession(1);
    apron.beginPossession(1);
    apron.beginPossession(1);
    expect(apron.struckDefender(team)).toBeNull();
    apron.endPossession();
  });

  it('restores ordinary participation once the possession ends', () => {
    const apron = runtime(SECOND, 0);
    const target = { playerId: 'p-target' } as unknown as SimulationPlayer;
    const team = { teamId: 't', displayName: 'T', players: [target] };
    apron.bindTarget(target);
    apron.beginPossession(1);
    apron.beginPossession(1);
    expect(apron.forcedActor(team)).toBeNull();
    apron.endPossession();
    expect(apron.forcedActor(team)).toBeNull();
    expect(apron.struckDefender(team)).toBeNull();
  });

  it('resolves the target by identity when the roster object differs', () => {
    const apron = runtime(SECOND, 0);
    const bound = {
      playerId: 'p-target',
      playerVersionId: 'v-target',
    } as unknown as SimulationPlayer;
    const rebuilt = {
      playerId: 'p-target',
      playerVersionId: 'v-target',
    } as unknown as SimulationPlayer;
    const team = { teamId: 't', displayName: 'T', players: [rebuilt] };
    apron.bindTarget(bound);
    apron.beginPossession(0);
    apron.beginPossession(0);
    apron.beginPossession(0);
    expect(apron.forcedActor(team)).toBe(rebuilt);
  });
});
