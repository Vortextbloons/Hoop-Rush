import { describe, expect, it } from 'vitest';
import type { GameResult, SimulationTeam } from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildGameSimulationInput,
  buildRolesTeam,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { simulateGame } from './game.ts';
import { createEngineContext } from './context.ts';
import { classifyArchetype } from '../domain/archetypes.ts';
const ctx = createEngineContext();
const SEEDS = 300;
interface RoleAccumulator {
  playerId: string;
  usage: number;
  fieldGoalAttempts: number;
  threeAttempts: number;
  assists: number;
  assistOpportunities: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  teamMisses: number;
  opponentMisses: number;
}
function measureRoles(team: SimulationTeam): Map<string, RoleAccumulator> {
  const players = new Map<string, RoleAccumulator>();
  for (let i = 0; i < SEEDS; i += 1) {
    const input = buildGameSimulationInput({
      seed: seedFromString(`roles-gate-${String(i)}`),
      profile: DEFAULT_ERA_SIM_PROFILE,
      home: team,
      away: { ...team, teamId: 'roles-away' },
    });
    const result = simulateGame(input, ctx);
    for (const side of [result.home, result.away] as const) {
      const opponent = side === result.home ? result.away : result.home;
      const misses = (t: GameResult['home']) =>
        t.box.fieldGoals.attempted -
        t.box.fieldGoals.made +
        (t.box.freeThrows.attempted - t.box.freeThrows.made);
      for (const box of side.players) {
        const acc = players.get(box.playerId) ?? {
          playerId: box.playerId,
          usage: 0,
          fieldGoalAttempts: 0,
          threeAttempts: 0,
          assists: 0,
          assistOpportunities: 0,
          offensiveRebounds: 0,
          defensiveRebounds: 0,
          teamMisses: 0,
          opponentMisses: 0,
        };
        acc.fieldGoalAttempts += box.fieldGoals.attempted;
        acc.threeAttempts += box.threes.attempted;
        acc.assists += box.assists;
        acc.offensiveRebounds += box.rebounds.offensive;
        acc.defensiveRebounds += box.rebounds.defensive;
        acc.teamMisses += misses(side);
        acc.opponentMisses += misses(opponent);
        if (box.diagnostics) {
          acc.usage += box.diagnostics.usage;
          acc.assistOpportunities += box.diagnostics.assistOpportunities;
        }
        players.set(box.playerId, acc);
      }
    }
  }
  return players;
}
describe('player-role behavior (roles lineup)', () => {
  const team = buildRolesTeam();
  const measured = measureRoles(team);
  const teamUsage = [...measured.values()].reduce((sum, a) => sum + a.usage, 0);
  const creator = 'p-roles-creator';
  const spacer = 'p-roles-spacer';
  const secondary = 'p-roles-secondary';
  const post = 'p-roles-post';
  const rim = 'p-roles-rim';
  const usageShare = (playerId: string) => {
    const acc = measured.get(playerId);
    return acc ? acc.usage / Math.max(1e-9, teamUsage) : 0;
  };
  const threeRate = (playerId: string) => {
    const acc = measured.get(playerId);
    return acc ? acc.threeAttempts / Math.max(1, acc.fieldGoalAttempts) : 0;
  };
  const assistConversion = (playerId: string) => {
    const acc = measured.get(playerId);
    return acc ? acc.assists / Math.max(1, acc.assistOpportunities) : 0;
  };
  const orebPct = (playerId: string) => {
    const acc = measured.get(playerId);
    return acc ? acc.offensiveRebounds / Math.max(1, acc.teamMisses) : 0;
  };
  const drebPct = (playerId: string) => {
    const acc = measured.get(playerId);
    return acc ? acc.defensiveRebounds / Math.max(1, acc.opponentMisses) : 0;
  };
  it('classifies the five role players into distinct archetypes', () => {
    const archetypes = team.players.map((p) => [p.playerId, classifyArchetype(p)] as const);
    const names = new Map(archetypes.map(([pid, a]) => [pid, a]));
    expect(names.get('p-roles-creator')).toBe('primaryCreator');
    expect(names.get('p-roles-spacer')).toBe('floorSpacer');
    expect(names.get('p-roles-rim')).not.toBe('primaryCreator');
    expect(new Set(archetypes.map(([, a]) => a)).size).toBeGreaterThanOrEqual(4);
  });
  it('produces a clear usage hierarchy ordered by usage tendency', () => {
    expect(usageShare(creator)).toBeGreaterThan(usageShare(secondary));
    expect(usageShare(secondary)).toBeGreaterThan(usageShare(post));
    expect(usageShare(post)).toBeGreaterThan(usageShare(rim));
    expect(usageShare(creator)).toBeGreaterThan(usageShare(spacer));
    expect(usageShare(creator) / Math.max(1e-9, usageShare(rim))).toBeGreaterThan(1.35);
    expect(usageShare(creator)).toBeGreaterThan(0.23);
    expect(usageShare(rim)).toBeLessThan(0.19);
  });
  it('differentiates shot profile: the spacer spaces, the rim runner stays inside', () => {
    expect(threeRate(spacer)).toBeGreaterThan(threeRate(rim) * 1.6);
    expect(threeRate(spacer)).toBeGreaterThan(threeRate(creator) * 1.2);
    expect(threeRate(creator)).toBeGreaterThan(threeRate(post));
  });
  it('credits creation: the primary creator converts more passes into assists', () => {
    expect(assistConversion(creator)).toBeGreaterThan(assistConversion(rim) * 1.1);
    expect(assistConversion(creator)).toBeGreaterThan(assistConversion(post));
  });
  it('puts the bigs on the glass: rim runner leads defensive rebounding', () => {
    expect(drebPct(rim)).toBeGreaterThan(drebPct(creator));
    expect(orebPct(rim)).toBeGreaterThan(orebPct(creator));
    expect(orebPct(post)).toBeGreaterThan(orebPct(spacer));
  });
  it('keeps every role gate inside the frozen era targets', () => {
    const target = (key: string) =>
      DEFAULT_ERA_SIM_PROFILE.targets.playerRoles.find((r) => r.key === key);
    const checks: Array<[string, number]> = [
      ['usageShare.0', usageShare(creator)],
      ['usageShare.1', usageShare(spacer)],
      ['usageShare.2', usageShare(secondary)],
      ['usageShare.3', usageShare(post)],
      ['usageShare.4', usageShare(rim)],
      ['threePointRate.0', threeRate(creator)],
      ['threePointRate.1', threeRate(spacer)],
      ['threePointRate.4', threeRate(rim)],
      ['assistConversion.0', assistConversion(creator)],
      ['assistConversion.4', assistConversion(rim)],
      ['offensiveReboundPct.3', orebPct(post)],
      ['offensiveReboundPct.4', orebPct(rim)],
      ['defensiveReboundPct.4', drebPct(rim)],
    ];
    for (const [key, observed] of checks) {
      const gate = target(key);
      expect(gate, `missing role gate ${key}`).toBeDefined();
      if (gate === undefined) {
        throw new Error(`missing role gate ${key}`);
      }
      const value = gate.target.value;
      const tolerance = gate.target.tolerance;
      expect(
        observed,
        `${key}: observed ${observed.toFixed(4)} outside ${(value - tolerance).toFixed(4)}..${(value + tolerance).toFixed(4)}`,
      ).toBeGreaterThanOrEqual(value - tolerance);
      expect(observed).toBeLessThanOrEqual(value + tolerance);
    }
  });
});
