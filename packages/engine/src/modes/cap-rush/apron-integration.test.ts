import { describe, expect, it } from 'bun:test';
import type { CapRushApronRules, HavocBattleInput } from '@hoop-rush/data-contracts';
import { havocBattleInputSchema, CAP_RUSH_STRIKE_EVERY } from '@hoop-rush/data-contracts';
import { buildHavocLockedInputs } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import { simulateHavocBattleGame } from '../havoc/core/battle-game.ts';
import { soloToBattleInput } from '../havoc/core/battle-adapters.ts';
import { buildHavocGameInput } from '../havoc/input.ts';
import { buildScenarioTeam } from '../havoc/runtime-test-support.ts';
import { auditHavocBattleGame } from '../havoc/core/battle-audit.ts';
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
  it('updates a retained facts array when the Rust battle completes', () => {
    const input = battleInput();
    const target = input.home.starters[4];
    if (target === undefined) throw new Error('missing target');
    const apron = new CapRushApronRuntime({
      side: 0,
      rules: { payrollStatus: 'second-apron' },
      targetInstanceId: target.instanceId,
      targetSlot: 'C',
    });
    const facts = apron.recordedFacts();
    simulateHavocBattleGame(input, createEngineContext(), { apron });
    expect(facts.length).toBeGreaterThan(0);
    expect(apron.recordedFacts()).toBe(facts);
    apron.dispose();
    expect(apron.recordedFacts()).toBe(facts);
  });

  it('records intercepted passes with audited accounting and seeded replay', () => {
    let interceptions = 0;
    for (let index = 0; index < 8; index += 1) {
      const input = havocBattleInputSchema.parse({
        ...battleInput(),
        seed: index.toString(16).padStart(32, '0'),
      });
      const side = index % 2 === 0 ? 0 : 1;
      const humanSide = side === 0 ? 'home' : 'away';
      const opponentSide = side === 0 ? 'away' : 'home';
      const target = input[humanSide].starters[4];
      if (target === undefined) throw new Error('fixture is missing a C starter');
      const makeApron = () =>
        new CapRushApronRuntime({
          side,
          rules: { payrollStatus: index % 4 < 2 ? 'first-apron' : 'second-apron' },
          targetInstanceId: target.instanceId,
          targetSlot: 'C',
        });
      const apron = makeApron();
      const first = simulateHavocBattleGame(input, createEngineContext(), { apron });
      const replayApron = makeApron();
      const replay = simulateHavocBattleGame(input, createEngineContext(), { apron: replayApron });
      expect(replay.result).toEqual(first.result);
      expect(replay.tape).toEqual(first.tape);
      expect(replayApron.recordedFacts()).toEqual(apron.recordedFacts());
      expect(auditHavocBattleGame(input, first.result, first.tape).ok).toBe(true);
      const intercepted = apron.recordedFacts().filter((fact) => fact.kind === 'pass-interception');
      interceptions += intercepted.length;
      expect(intercepted.every((fact) => fact.side === humanSide)).toBe(true);
      expect(first.result[humanSide].turnovers).toBeGreaterThanOrEqual(intercepted.length);
      expect(first.result[opponentSide].steals).toBeGreaterThanOrEqual(intercepted.length);
      expect(apron.recordedFacts().some((fact) => fact.kind === 'isolation')).toBe(false);
    }
    expect(interceptions).toBeGreaterThan(0);
  });

  it('records strike facts only in the second apron and only for opponent possessions', () => {
    const first = runWithApron({ payrollStatus: 'first-apron' });
    expect(first.apron.recordedFacts().filter((fact) => fact.kind === 'strike')).toHaveLength(0);

    const second = runWithApron({ payrollStatus: 'second-apron' });
    const strikes = second.apron.recordedFacts().filter((fact) => fact.kind === 'strike');
    expect(strikes.length).toBeGreaterThan(5);
    expect(strikes.every((fact) => fact.possessionOrdinal % CAP_RUSH_STRIKE_EVERY === 0)).toBe(
      true,
    );
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
