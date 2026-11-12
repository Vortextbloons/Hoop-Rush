import { describe, expect, it } from 'bun:test';
import type { CapRushApronRules, SimulationPlayer } from '@hoop-rush/data-contracts';
import { capRushStrikeDue } from '@hoop-rush/data-contracts';
import { CapRushApronRuntime } from './apron-runtime.ts';
import { battleKernel } from '../havoc/core/battle-wasm.ts';

function createApronWasm(side: 0 | 1, rules: CapRushApronRules) {
  const kernel = battleKernel();
  const handle = kernel.apron_create(side, rules.payrollStatus === 'second-apron' ? 2 : 1);
  return {
    apron_interception_chance: (offense: number) =>
      kernel.apron_interception_chance(handle, offense),
    apron_begin: (offense: number) => kernel.apron_begin(handle, offense),
    apron_offense_ordinal: () => kernel.apron_offense_ordinal(handle),
    apron_defense_ordinal: () => kernel.apron_defense_ordinal(handle),
    apron_strike: () => kernel.apron_strike(handle),
    apron_isolation: () => kernel.apron_isolation(handle),
    apron_record_interception: () => kernel.apron_record_interception(handle),
    apron_end: () => kernel.apron_end(handle),
    apron_fact_count: () => kernel.apron_fact_count(handle),
    apron_fact_kind: (index: number) => kernel.apron_fact_kind(handle, index),
    apron_fact_ordinal: (index: number) => kernel.apron_fact_ordinal(handle, index),
  };
}

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

function player(playerId: string, playerVersionId: string | null = null): SimulationPlayer {
  return {
    playerId,
    ...(playerVersionId === null ? {} : { playerVersionId }),
  } as unknown as SimulationPlayer;
}

describe('cap rush apron wasm module', () => {
  it('keeps older runtimes independent after more than sixteen are created', () => {
    const original = runtime(SECOND);
    original.beginPossession(1);
    const others = Array.from({ length: 20 }, () => runtime(FIRST, 1));
    for (const other of others) other.beginPossession(0);
    expect(original.beginPossession(1).offenseOrdinal).toBe(2);
    for (const other of others) expect(other.state()?.offenseOrdinal).toBe(1);
  });

  it('keeps counters, rules, and numeric fact records in the Rust kernel', () => {
    const wasm = createApronWasm(0, SECOND);
    expect(wasm.apron_interception_chance(0)).toBe(0.07);
    expect(wasm.apron_interception_chance(1)).toBe(0);
    for (let ordinal = 1; ordinal <= 8; ordinal += 1) {
      expect(wasm.apron_begin(1)).toBe(0);
      expect(wasm.apron_offense_ordinal()).toBe(ordinal);
      expect(wasm.apron_defense_ordinal()).toBe(0);
      expect(wasm.apron_strike()).toBe(ordinal === 8 ? 1 : 0);
      expect(wasm.apron_isolation()).toBe(0);
      expect(wasm.apron_record_interception()).toBe(0);
      wasm.apron_end();
    }
    expect(wasm.apron_fact_count()).toBe(9);
    expect(wasm.apron_fact_kind(7)).toBe(1);
    expect(wasm.apron_fact_ordinal(7)).toBe(8);
    expect(wasm.apron_fact_kind(8)).toBe(2);
    expect(wasm.apron_fact_ordinal(8)).toBe(8);
  });

  it('ignores interception records outside a possession and rejects bad inputs', () => {
    const wasm = createApronWasm(1, FIRST);
    expect(wasm.apron_record_interception()).toBe(1);
    expect(wasm.apron_fact_count()).toBe(0);
    expect(wasm.apron_begin(2)).toBe(1);
    expect(wasm.apron_interception_chance(0)).toBe(0);
    expect(wasm.apron_interception_chance(1)).toBe(0.015);
  });
});

describe('cap rush apron facts through the wasm-backed runtime', () => {
  it('preserves the live facts array across subsequent possessions', () => {
    const apron = runtime(SECOND);
    const facts = apron.recordedFacts();
    for (let i = 0; i < 8; i++) apron.beginPossession(1);
    expect(facts).toHaveLength(1);
    apron.onPassIntercepted(player('passer'), player('defender'));
    expect(facts).toHaveLength(2);
    expect(apron.recordedFacts()).toBe(facts);
  });

  it('materializes strike and interception facts in kernel order', () => {
    const apron = runtime(SECOND, 0);
    const passer = player('p-passer');
    const defender = player('p-defender');
    const expected = [];
    for (let possession = 1; possession <= 16; possession += 1) {
      apron.beginPossession(1);
      const strike = capRushStrikeDue(SECOND, possession);
      expect(apron.strikeActive()).toBe(strike);
      if (strike) {
        expected.push({ kind: 'strike', possessionOrdinal: possession } as const);
      }
      apron.onPassIntercepted(passer, defender);
      expected.push({ kind: 'pass-interception', possessionOrdinal: possession } as const);
      apron.endPossession();
    }
    expect(
      apron.recordedFacts().map((fact) => ({
        kind: fact.kind,
        possessionOrdinal: fact.possessionOrdinal,
      })),
    ).toEqual(expected);
    expect(
      apron
        .recordedFacts()
        .filter(
          (fact) => fact.kind === 'pass-interception' && fact.defenderPlayerId !== 'p-defender',
        ),
    ).toEqual([]);
  });

  it('resolves the target by bound id without a bound player object', () => {
    const apron = runtime(SECOND, 0);
    apron.bindTargetId('p-target', 'v-target');
    const target = player('p-target', 'v-target');
    const team = { teamId: 't', displayName: 'T', players: [player('p-other'), target] };
    for (let possession = 1; possession <= 8; possession += 1) {
      apron.beginPossession(1);
    }
    expect(apron.struckDefender(team)).toBe(target);
  });

  it('drops interception records once the possession has ended', () => {
    const apron = runtime(FIRST, 0);
    apron.beginPossession(0);
    apron.endPossession();
    apron.onPassIntercepted(player('p-passer'), player('p-defender'));
    expect(apron.recordedFacts()).toEqual([]);
  });
});
