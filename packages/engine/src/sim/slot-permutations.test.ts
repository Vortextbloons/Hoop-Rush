import { describe, expect, it } from 'vitest';
import type { GameResult, PlayerBoxScore, SimulationTeam } from '@hoop-rush/data-contracts';
import { seedSchema } from '@hoop-rush/data-contracts';
import {
  buildGameSimulationInput,
  buildSlotPermutationTeams,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { simulateGame } from './game.ts';
import { createEngineContext } from './context.ts';
const ctx = createEngineContext();
const PERMUTATIONS = buildSlotPermutationTeams();
const SEEDS = 200;
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined)
    throw new Error(`slot permutation fixture missing entry ${String(index)}`);
  return value;
}
function runPermutation(team: SimulationTeam, seeds: string[]) {
  const games: GameResult[] = seeds.map((seed) =>
    simulateGame(
      buildGameSimulationInput({
        seed: seedSchema.parse(seedFromString(seed)),
        home: team,
        away: team,
      }),
      ctx,
    ),
  );
  const players = new Map<string, PlayerBoxScore>();
  for (const game of games) {
    for (const side of [game.home, game.away]) {
      for (const player of side.players) {
        const current = players.get(player.playerId);
        players.set(player.playerId, current ? mergeBox(current, player) : player);
      }
    }
  }
  return { games, players };
}
function mergeBox(a: PlayerBoxScore, b: PlayerBoxScore): PlayerBoxScore {
  const sum = (
    x: {
      made: number;
      attempted: number;
    },
    y: {
      made: number;
      attempted: number;
    },
  ) => ({
    made: x.made + y.made,
    attempted: x.attempted + y.attempted,
  });
  return {
    ...a,
    points: a.points + b.points,
    minutes: a.minutes + b.minutes,
    fieldGoals: sum(a.fieldGoals, b.fieldGoals),
    threes: sum(a.threes, b.threes),
    freeThrows: sum(a.freeThrows, b.freeThrows),
    rebounds: {
      total: a.rebounds.total + b.rebounds.total,
      offensive: a.rebounds.offensive + b.rebounds.offensive,
      defensive: a.rebounds.defensive + b.rebounds.defensive,
    },
    assists: a.assists + b.assists,
    steals: a.steals + b.steals,
    blocks: a.blocks + b.blocks,
    turnovers: a.turnovers + b.turnovers,
    fouls: a.fouls + b.fouls,
    diagnostics:
      a.diagnostics && b.diagnostics
        ? {
            usage: a.diagnostics.usage + b.diagnostics.usage,
            shotZones: a.diagnostics.shotZones.map((zone, i) => ({
              zone: zone.zone,
              attempts: zone.attempts + (b.diagnostics?.shotZones[i]?.attempts ?? 0),
              makes: zone.makes + (b.diagnostics?.shotZones[i]?.makes ?? 0),
            })),
            assistOpportunities:
              a.diagnostics.assistOpportunities + b.diagnostics.assistOpportunities,
            offensiveReboundChances:
              a.diagnostics.offensiveReboundChances + b.diagnostics.offensiveReboundChances,
            defensiveReboundChances:
              a.diagnostics.defensiveReboundChances + b.diagnostics.defensiveReboundChances,
            contestedShots: a.diagnostics.contestedShots + b.diagnostics.contestedShots,
          }
        : a.diagnostics,
  };
}
function usageShare(player: PlayerBoxScore, teamUsage: number): number {
  return player.diagnostics ? player.diagnostics.usage / Math.max(1e-9, teamUsage) : 0;
}
function threePointRate(player: PlayerBoxScore): number {
  return (
    player.threes.attempted / Math.max(1, player.threes.attempted + player.fieldGoals.attempted)
  );
}
function teamUsage(playerBoxes: Iterable<PlayerBoxScore>): number {
  let total = 0;
  for (const player of playerBoxes) total += player.diagnostics?.usage ?? 0;
  return total;
}
describe('assigned-position responsibility across legal slot permutations', () => {
  it('keeps the creator as the primary initiator even from the center slot', () => {
    const seeds = Array.from({ length: SEEDS }, (_, i) => `slot-lead-${String(i)}`);
    const creatorAtCenter = runPermutation(at(PERMUTATIONS, 4), seeds);
    const usage = teamUsage(creatorAtCenter.players.values());
    const creator = creatorAtCenter.players.get('p-slot-creator');
    if (creator === undefined) throw new Error('fixture missing creator');
    const creatorShare = usageShare(creator, usage);
    for (const [playerId, player] of creatorAtCenter.players) {
      if (playerId === 'p-slot-creator') continue;
      expect(creatorShare).toBeGreaterThan(usageShare(player, usage) + 0.01);
    }
  });
  it('preserves the shooter shot profile across permutations', () => {
    const seeds = Array.from({ length: SEEDS }, (_, i) => `slot-shot-${String(i)}`);
    const rates = PERMUTATIONS.map((team) => {
      const result = runPermutation(team, seeds);
      const shooter = result.players.get('p-slot-shooter');
      if (shooter === undefined) throw new Error('fixture missing shooter');
      return threePointRate(shooter);
    });
    const spread = Math.max(...rates) - Math.min(...rates);
    expect(spread).toBeLessThanOrEqual(0.03);
  });
});
