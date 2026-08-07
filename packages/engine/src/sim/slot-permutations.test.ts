import { describe, expect, it } from 'vitest';
import type { GameResult, PlayerBoxScore, SimulationTeam } from '@hoop-rush/data-contracts';
import {
  buildGameSimulationInput,
  buildSlotPermutationTeams,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { simulateGame } from './game.ts';
import { createEngineContext } from './context.ts';

const ctx = createEngineContext();
const PERMUTATIONS = buildSlotPermutationTeams();
/** Seeds for attribution-sensitive assertions (usage share moves in small steps). */
const SEEDS = 400;

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined)
    throw new Error(`slot permutation fixture missing entry ${String(index)}`);
  return value;
}

/** Mirrored games of one permutation over shared seeds, with per-player accumulation by playerId. */
function runPermutation(team: SimulationTeam, seeds: string[]) {
  const games: GameResult[] = seeds.map((seed) =>
    simulateGame(
      buildGameSimulationInput({
        seed: seedFromString(seed),
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
  const sum = (x: { made: number; attempted: number }, y: { made: number; attempted: number }) => ({
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
  it('shifts usage, rebound attribution, rim contests, and blocks by player ID', () => {
    // Player-to-slot order per permutation (creator, shooter, wing, post, rim):
    // P1 [0,1,2,3,4]  P2 [1,0,2,3,4]  P3 [0,1,3,2,4]  -> rim at C
    // P4 [1,2,0,4,3]  P5 [1,2,3,4,0]  P6 [0,1,2,4,3]  -> rim at F (post at C)
    const seeds = Array.from({ length: SEEDS }, (_, i) => `slot-attr-${String(i)}`);
    const byPermutation = PERMUTATIONS.map((team) => runPermutation(team, seeds));
    const rimAtCenter = byPermutation.slice(0, 3);
    const rimAtForward = byPermutation.slice(3);
    const creatorAtCenter = at(byPermutation, 4);

    const box = (players: Map<string, PlayerBoxScore>, playerId: string) => {
      const player = players.get(playerId);
      if (player === undefined) throw new Error(`slot permutation fixture missing ${playerId}`);
      return player;
    };
    const avg = (
      results: ReturnType<typeof runPermutation>[],
      pick: (p: PlayerBoxScore) => number,
    ) =>
      results.reduce((sum, result) => sum + pick(box(result.players, 'p-slot-rim')), 0) /
      results.length;

    // Usage changes by player ID: the rim protector initiates more often from
    // a forward slot (initiation 1.02 vs 0.92), so his usage share rises.
    const rimUsageCenter = avg(rimAtCenter, (p) => p.diagnostics?.usage ?? 0);
    const rimUsageForward = avg(rimAtForward, (p) => p.diagnostics?.usage ?? 0);
    expect(rimUsageForward).toBeGreaterThan(rimUsageCenter);

    // Rebound attribution changes by player ID: the rim protector grabs more
    // offensive and defensive boards from the center slot (rebounding 1.10 vs
    // 1.04) than from a forward slot.
    const rimDrebCenter = avg(rimAtCenter, (p) => p.rebounds.defensive);
    const rimDrebForward = avg(rimAtForward, (p) => p.rebounds.defensive);
    expect(rimDrebCenter).toBeGreaterThan(rimDrebForward + 100);
    const rimOrebCenter = avg(rimAtCenter, (p) => p.rebounds.offensive);
    const rimOrebForward = avg(rimAtForward, (p) => p.rebounds.offensive);
    expect(rimOrebCenter).toBeGreaterThan(rimOrebForward);

    // Defender assignments change by player ID: from a forward slot the rim
    // protector draws the same-slot-group matchup bonus far more often, so
    // his total contested shots rise.
    const rimContestsCenter = avg(rimAtCenter, (p) => p.diagnostics?.contestedShots ?? 0);
    const rimContestsForward = avg(rimAtForward, (p) => p.diagnostics?.contestedShots ?? 0);
    expect(rimContestsForward).toBeGreaterThan(rimContestsCenter + 200);

    // Rim-protection assignment changes by player ID: with the post playing
    // center (rim-protection 1.10) and the rim protector at forward (1.04),
    // the post's block production rises above its forward-slot baseline.
    const postBlocks = (players: Map<string, PlayerBoxScore>) => box(players, 'p-slot-post').blocks;
    const postAtCenter = [at(byPermutation, 3), at(byPermutation, 5)].reduce(
      (sum, result) => sum + postBlocks(result.players),
      0,
    );
    const postAtForward = [0, 1, 2, 4].reduce(
      (sum, i) => sum + postBlocks(at(byPermutation, i).players),
      0,
    );
    expect(postAtCenter / 2).toBeGreaterThan(postAtForward / 4);

    // Usage shares visibly redistribute across the five players between the
    // natural order and the creator-at-center order (creator initiation
    // weight drops 0.92/1.08; feed compensation keeps each move bounded).
    const naturalUsage = teamUsage(byPermutation[0]?.players.values() ?? []);
    const centerUsage = teamUsage(creatorAtCenter.players.values());
    let usageRedistribution = 0;
    for (const playerId of [
      'p-slot-creator',
      'p-slot-shooter',
      'p-slot-wing',
      'p-slot-post',
      'p-slot-rim',
    ]) {
      usageRedistribution += Math.abs(
        usageShare(box(at(byPermutation, 0).players, playerId), naturalUsage) -
          usageShare(box(creatorAtCenter.players, playerId), centerUsage),
      );
    }
    expect(usageRedistribution).toBeGreaterThan(0.004);

    // Responsibility visibly moves across the five players: no permutation's
    // per-player attribution is identical to the natural order's.
    for (const [index, result] of byPermutation.entries()) {
      if (index === 0) continue;
      let differs = false;
      for (const playerId of [
        'p-slot-creator',
        'p-slot-shooter',
        'p-slot-wing',
        'p-slot-post',
        'p-slot-rim',
      ]) {
        const a = box(result.players, playerId);
        const b = box(at(byPermutation, 0).players, playerId);
        if (a.rebounds.defensive !== b.rebounds.defensive || a.blocks !== b.blocks) differs = true;
      }
      expect(differs).toBe(true);
    }
  });

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

  it('keeps team-level scoring within 3% across permutations', () => {
    const seeds = Array.from({ length: 100 }, (_, i) => `slot-team-${String(i)}`);
    const totals = PERMUTATIONS.map((team) => {
      const { games } = runPermutation(team, seeds);
      let points = 0;
      let possessions = 0;
      for (const game of games) {
        points += game.home.box.points + game.away.box.points;
        possessions += game.home.box.possessions + game.away.box.possessions;
      }
      const gamesCount = games.length * 2;
      return {
        pointsPerGame: points / gamesCount,
        offensiveRating: (points / Math.max(1e-9, possessions)) * 100,
      };
    });
    for (const key of ['pointsPerGame', 'offensiveRating'] as const) {
      const values = totals.map((t) => t[key]);
      const max = Math.max(...values);
      const min = Math.min(...values);
      expect(max / min).toBeLessThanOrEqual(1.03);
    }
  });

  it('keeps the paired win-rate spread across permutations within 6 percentage points', () => {
    const seeds = Array.from({ length: 200 }, (_, i) => `slot-win-${String(i)}`);
    const rates: number[] = [];
    for (let i = 0; i < PERMUTATIONS.length; i += 1) {
      const a = at(PERMUTATIONS, i);
      const b = at(PERMUTATIONS, (i + 1) % PERMUTATIONS.length);
      let wins = 0;
      for (const seed of seeds) {
        const result = simulateGame(
          buildGameSimulationInput({ seed: seedFromString(seed), home: a, away: b }),
          ctx,
        );
        if (result.winner === 'home') wins += 1;
      }
      rates.push(wins / seeds.length);
    }
    const spread = Math.max(...rates) - Math.min(...rates);
    expect(spread).toBeLessThanOrEqual(0.06 + 1e-9);
  });
});
