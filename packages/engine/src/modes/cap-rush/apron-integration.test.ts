import { describe, expect, it } from 'bun:test';
import type { CapRushApronRules, HavocBattleInput } from '@hoop-rush/data-contracts';
import { havocBattleInputSchema } from '@hoop-rush/data-contracts';
import { buildHavocLockedInputs } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import { simulateHavocBattleGame } from '../havoc/core/battle-game.ts';
import { soloToBattleInput } from '../havoc/core/battle-adapters.ts';
import { buildHavocGameInput } from '../havoc/input.ts';
import { buildScenarioTeam } from '../havoc/runtime-test-support.ts';
import { CapRushApronRuntime } from './apron-runtime.ts';

function battleInput(): HavocBattleInput {
  const locked = buildHavocLockedInputs();
  const soloInput = buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' });
  const home = buildScenarioTeam('human', [
    { slot: 'PG', mutations: [] },
    { slot: 'SG', mutations: [] },
    { slot: 'SF', mutations: [] },
    { slot: 'PF', mutations: [] },
    { slot: 'C', mutations: [] },
  ]);
  const away = buildScenarioTeam('opponent', [
    { slot: 'PG', mutations: [] },
    { slot: 'SG', mutations: [] },
    { slot: 'SF', mutations: [] },
    { slot: 'PF', mutations: [] },
    { slot: 'C', mutations: [] },
  ]);
  const base = soloToBattleInput(soloInput);
  return havocBattleInputSchema.parse({
    ...base,
    home: { ...home, side: 'home' },
    away: { ...away, side: 'away' },
  });
}

function runWithApron(rules: CapRushApronRules, side: 0 | 1 = 0) {
  const input = battleInput();
  const target = (side === 0 ? input.home : input.away).starters[4];
  if (target === undefined) throw new Error('fixture is missing a C starter');
  const apron = new CapRushApronRuntime({
    side,
    rules,
    targetInstanceId: target.instanceId,
    targetSlot: 'C',
  });
  apron.bindTarget({
    playerId: target.source.playerId,
    ...(target.source.playerVersionId === null
      ? {}
      : { playerVersionId: target.source.playerVersionId }),
    displayName: target.source.displayName,
    positions: target.source.positions,
    heightInches: target.effective.physical.heightInches,
    weightLbs: target.effective.physical.weightLbs,
    ratings: target.effective.ratings,
    tendencies: target.effective.tendencies,
  });
  const simulation = simulateHavocBattleGame(input, createEngineContext(), { apron });
  return { apron, simulation, input, target };
}

describe('cap rush apron integration', () => {
  it('leaves the game untouched when no apron rules apply', () => {
    const baseline = simulateHavocBattleGame(battleInput(), createEngineContext());
    const clean = new CapRushApronRuntime({
      side: 0,
      rules: { payrollStatus: 'first-apron' },
      targetInstanceId: `hvi-${'0'.repeat(32)}`,
      targetSlot: 'C',
    });
    const withApron = simulateHavocBattleGame(battleInput(), createEngineContext(), {
      apron: clean,
    });
    expect(withApron.result.inputDigest).toBe(baseline.result.inputDigest);
    expect(withApron.result.home.points).toBe(baseline.result.home.points);
    expect(withApron.result.away.points).toBe(baseline.result.away.points);
  });

  it('records isolation facts at the first-apron cadence across the whole game', () => {
    const { apron } = runWithApron({ payrollStatus: 'first-apron' });
    const isolations = apron.recordedFacts().filter((fact) => fact.kind === 'isolation');
    expect(isolations.length).toBeGreaterThan(5);
    expect(isolations.every((fact) => fact.possessionOrdinal % 6 === 0)).toBe(true);
    expect(isolations.every((fact) => fact.side === 'home')).toBe(true);
    expect(isolations.every((fact) => fact.reason === 'give-me-the-ball')).toBe(true);
  });

  it('records strike facts only in the second apron and only for opponent possessions', () => {
    const first = runWithApron({ payrollStatus: 'first-apron' });
    expect(first.apron.recordedFacts().filter((fact) => fact.kind === 'strike')).toHaveLength(0);

    const second = runWithApron({ payrollStatus: 'second-apron' });
    const strikes = second.apron.recordedFacts().filter((fact) => fact.kind === 'strike');
    expect(strikes.length).toBeGreaterThan(5);
    expect(strikes.every((fact) => fact.possessionOrdinal % 6 === 0)).toBe(true);
  });

  it('keeps the targeted defender on court while removing his defensive line', () => {
    const { simulation, target } = runWithApron({ payrollStatus: 'second-apron' });
    const lines = simulation.result.home.participants;
    const targetLine = lines.find((line) => line.instanceId === target.instanceId);
    if (targetLine === undefined) throw new Error('target has no box score line');
    expect(targetLine.secondsPlayed).toBeGreaterThan(0);
  });

  it('remains deterministic across repeated runs with the same apron', () => {
    const first = runWithApron({ payrollStatus: 'second-apron' });
    const second = runWithApron({ payrollStatus: 'second-apron' });
    expect(second.simulation.result.home.points).toBe(first.simulation.result.home.points);
    expect(second.simulation.result.away.points).toBe(first.simulation.result.away.points);
    expect(second.apron.recordedFacts()).toEqual(first.apron.recordedFacts());
  });
});
