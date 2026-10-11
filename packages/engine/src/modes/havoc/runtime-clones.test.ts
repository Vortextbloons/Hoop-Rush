import { describe, expect, it } from 'vitest';
import type { HavocMutationId, SimulationRatings } from '@hoop-rush/data-contracts';
import { POSITIONS } from '@hoop-rush/data-contracts';
import { createRng } from '../../sim/rng.ts';
import { havocCoverageAssignment } from './game.ts';
import { auditHavocGame } from './audit.ts';
import {
  buildScenarioTeam,
  runScenario,
  searchScenario,
  type ScenarioSlot,
} from './runtime-test-support.ts';

const ATHLETIC: Partial<SimulationRatings> = {
  insideScoring: 75,
  closeShot: 75,
  midrange: 65,
  threePoint: 60,
  freeThrow: 75,
  ballHandling: 80,
  passing: 75,
  offensiveIq: 75,
  offensiveRebound: 80,
  defensiveRebound: 75,
  perimeterDefense: 70,
  interiorDefense: 70,
  steal: 65,
  block: 65,
  defensiveIq: 70,
  speed: 85,
  strength: 75,
  vertical: 80,
};

function fullCloneRoster(): ScenarioSlot[] {
  return POSITIONS.map((slot) => ({
    slot,
    mutations: ['clone-army'] as HavocMutationId[],
    ratings: ATHLETIC,
  }));
}

describe('havoc participant mechanics', () => {
  it('fields five to ten active actors with independent clone identity', () => {
    const human = buildScenarioTeam('human', fullCloneRoster());
    const away = buildScenarioTeam(
      'opponent',
      POSITIONS.map((slot) => ({ slot, mutations: [] })),
    );
    const run = runScenario(human, away, 'havoc-ten-actors');
    expect(run.result.home.participants.length).toBe(10);
    const clones = run.result.home.participants.filter((line) => line.kind === 'clone');
    expect(clones.length).toBe(5);
    for (const clone of clones) {
      expect(clone.ownerInstanceId).not.toBeNull();
      const ownerInstance = run.input.home.starters.find(
        (starter) => starter.instanceId === clone.ownerInstanceId,
      );
      expect(ownerInstance).toBeDefined();
      expect(clone.secondsPlayed).toBeGreaterThan(0);
    }
    const instances = [
      ...run.result.home.participants.map((line) => line.instanceId),
      ...run.result.away.participants.map((line) => line.instanceId),
    ];
    expect(new Set(instances).size).toBe(instances.length);
    for (const event of run.tape.events) {
      if (event.kind !== 'assist') continue;
      expect(event.assisterInstanceId).not.toBe(event.scorerInstanceId);
    }
    expect(auditHavocGame(run.input, run.result, run.tape).ok).toBe(true);
  });

  it('keeps source-identical teammates distinct at runtime', () => {
    const shared = buildScenarioTeam('human', [
      { slot: 'PG', mutations: ['clone-army'], ratings: ATHLETIC },
      { slot: 'SG', mutations: [], ratings: ATHLETIC },
      { slot: 'SF', mutations: [], ratings: ATHLETIC },
      { slot: 'PF', mutations: [], ratings: ATHLETIC },
      { slot: 'C', mutations: [], ratings: ATHLETIC },
    ]);
    const first = shared.starters[0];
    if (first === undefined) throw new Error('missing starter');
    const starters = shared.starters.map((starter, index) =>
      index === 1 ? { ...starter, source: first.source, effective: first.effective } : starter,
    );
    const replacements = shared.replacements.map((replacement, index) =>
      index === 1 ? { ...replacement, source: first.source } : replacement,
    );
    const human = { ...shared, starters, replacements };
    const away = buildScenarioTeam(
      'opponent',
      POSITIONS.map((slot) => ({ slot, mutations: [] })),
    );
    const run = runScenario(human, away, 'havoc-source-collision');
    const sourceIds = starters.map((starter) => starter.source.playerId);
    expect(new Set(sourceIds).size).toBeLessThan(sourceIds.length);
    expect(auditHavocGame(run.input, run.result, run.tape).ok).toBe(true);
    const assists = run.tape.events.filter((event) => event.kind === 'assist');
    for (const assist of assists) {
      expect(assist.assisterInstanceId).not.toBe(assist.scorerInstanceId);
    }
    expect(run.result.home.participants.length).toBe(6);
  });

  it('removes a clone when its owner exits', () => {
    const human = buildScenarioTeam('human', [
      { slot: 'PG', mutations: ['clone-army'], ratings: ATHLETIC },
      {
        slot: 'SG',
        mutations: [],
        ratings: { ...ATHLETIC, strength: 99, interiorDefense: 99, defensiveIq: 10 },
      },
      { slot: 'SF', mutations: [], ratings: ATHLETIC },
      { slot: 'PF', mutations: [], ratings: ATHLETIC },
      { slot: 'C', mutations: [], ratings: ATHLETIC },
    ]);
    const away = buildScenarioTeam(
      'opponent',
      POSITIONS.map((slot) => ({ slot, mutations: [] })),
    );
    const run = searchScenario(96, human, away, (candidate) =>
      candidate.tape.events.some((event) => event.kind === 'clone' && event.outcome === 'exited'),
    );
    expect(run, 'expected a clone removal').not.toBeNull();
    if (run === null) return;
    const exit = run.tape.events.find(
      (event) => event.kind === 'clone' && event.outcome === 'exited',
    );
    if (exit?.kind !== 'clone') throw new Error('missing clone exit');
    const owner = run.tape.events.find(
      (event) => event.kind === 'substitution' && event.outInstanceId === exit.ownerInstanceId,
    );
    expect(owner).toBeDefined();
    expect(exit.reason === 'owner-exited' || exit.reason === 'fouled-out').toBe(true);
  });

  it('never respawns clones after they foul out', () => {
    const human = buildScenarioTeam('human', fullCloneRoster());
    const away = buildScenarioTeam(
      'opponent',
      POSITIONS.map((slot) => ({ slot, mutations: [] })),
    );
    const run = searchScenario(
      160,
      human,
      away,
      (candidate) =>
        candidate.tape.events.some(
          (event) =>
            event.kind === 'clone' && event.outcome === 'exited' && event.reason === 'fouled-out',
        ),
      'havoc-clone-foul-out',
    );
    if (run === null) return;
    for (const cloneLine of run.result.home.participants.filter((line) => line.kind === 'clone')) {
      const entered = run.tape.events.filter(
        (event) =>
          event.kind === 'clone' &&
          event.outcome === 'entered' &&
          event.cloneInstanceId === cloneLine.instanceId,
      );
      const exited = run.tape.events.filter(
        (event) =>
          event.kind === 'clone' &&
          event.outcome === 'exited' &&
          event.cloneInstanceId === cloneLine.instanceId,
      );
      expect(entered.length).toBeLessThanOrEqual(1);
      expect(exited.length).toBeLessThanOrEqual(1);
    }
  });

  it('reproduces the same ten-actor game byte for byte', () => {
    const human = buildScenarioTeam('human', fullCloneRoster());
    const away = buildScenarioTeam(
      'opponent',
      POSITIONS.map((slot) => ({ slot, mutations: [] })),
    );
    const first = runScenario(human, away, 'havoc-ten-det');
    const second = runScenario(human, away, 'havoc-ten-det');
    expect(first.tapeDigest).toBe(second.tapeDigest);
    expect(first.resultDigest).toBe(second.resultDigest);
  });
});

describe('havoc coverage assignment', () => {
  it('covers each actor and defender at most once and leaves surplus actors uncovered', () => {
    const offense = Array.from({ length: 8 }, (_value, index) => `off-${String(index)}`);
    const defense = Array.from({ length: 5 }, (_value, index) => `def-${String(index)}`);
    const rng = createRng('coverage-test');
    const result = havocCoverageAssignment(offense, defense, () => 1, rng);
    expect(result.assignment.length).toBe(5);
    expect(new Set(result.assignment.map((pair) => pair.shooterInstanceId)).size).toBe(5);
    expect(new Set(result.assignment.map((pair) => pair.defenderInstanceId)).size).toBe(5);
    expect(result.uncoveredInstanceIds.length).toBe(3);
    expect(result.helpInstanceIds.length).toBe(0);
  });

  it('leaves surplus defenders as help when the offense is smaller', () => {
    const offense = ['off-0', 'off-1', 'off-2', 'off-3', 'off-4'];
    const defense = ['def-0', 'def-1', 'def-2', 'def-3', 'def-4', 'def-5', 'def-6'];
    const rng = createRng('coverage-help');
    const result = havocCoverageAssignment(offense, defense, () => 1, rng);
    expect(result.assignment.length).toBe(5);
    expect(result.uncoveredInstanceIds).toEqual([]);
    expect(result.helpInstanceIds.length).toBe(2);
  });

  it('is deterministic for a fixed seed and stable actor order', () => {
    const offense = ['off-0', 'off-1', 'off-2', 'off-3', 'off-4', 'off-5'];
    const defense = ['def-0', 'def-1', 'def-2', 'def-3', 'def-4'];
    const first = havocCoverageAssignment(offense, defense, () => 1, createRng('cov-1'));
    const second = havocCoverageAssignment(offense, defense, () => 1, createRng('cov-1'));
    expect(first).toEqual(second);
    const third = havocCoverageAssignment(offense, defense, () => 1, createRng('cov-2'));
    expect(third).not.toEqual(first);
  });
});
