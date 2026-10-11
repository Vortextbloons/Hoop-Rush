import { describe, expect, it } from 'vitest';
import {
  buildFixtureBracket,
  buildGameSimulationInput,
  buildUserTeam,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import type { RunPlayerSelection, SimulationPlayer } from '@hoop-rush/data-contracts';
import {
  LINEUP_STRUCTURE,
  eraIdSchema,
  franchiseIdSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { createEngineContext } from '../sim/kernel.ts';
import { createChallenge, simulateChallenge, type ChallengeCreation } from './commands.ts';
import {
  createLeagueSimulation,
  leagueGamesSimulated,
  leagueQuotas,
  leagueUserGameCounts,
  planLeagueSchedule,
  simulateLeague,
  validateLeagueSchedule,
} from './league.ts';
import { leagueMvp } from './mvp.ts';

const context = createEngineContext();
const SEED_A = seedSchema.parse(seedFromString('league-seed-a'));
const SEED_B = seedSchema.parse(seedFromString('league-seed-b'));
const profile = buildGameSimulationInput().profile;

function fixtureSelections(players: SimulationPlayer[]): RunPlayerSelection[] {
  return players.map((player) => ({
    playerId: player.playerId,
    franchiseId: franchiseIdSchema.parse('lakers'),
    eraId: eraIdSchema.parse('1990s'),
  }));
}

function fixtureCreation(overrides: Partial<ChallengeCreation> = {}): ChallengeCreation {
  const bracket = buildFixtureBracket();
  const team = buildUserTeam();
  return {
    runId: 'league-run-1',
    mode: 'sandbox',
    franchiseId: 'lakers',
    eraId: '1990s',
    homeDisplayName: 'Los Angeles Lakers',
    lineup: {
      structure: LINEUP_STRUCTURE,
      assignments: team.players.map((player, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: player.playerId,
        positions: player.positions,
      })),
    },
    players: team.players,
    selections: fixtureSelections(team.players),
    runSeed: SEED_A,
    dataVersion: profile.dataVersion,
    ratingVersion: 'ratings-v1',
    positionNormalizationVersion: 'position-v1',
    engineVersion: context.engineVersion,
    profile,
    bracket,
    ...overrides,
  };
}

describe('challenge league', () => {
  it('plans a balanced opponent-vs-opponent schedule', () => {
    const bracket = buildFixtureBracket();
    const plan = planLeagueSchedule(bracket);
    expect(validateLeagueSchedule(plan, bracket)).toEqual([]);
    const quotas = leagueQuotas(bracket);
    const userGames = leagueUserGameCounts(bracket);
    expect(plan).toHaveLength(leagueGamesSimulated(bracket));
    expect(plan).toHaveLength(1189);
    const pairCounts = new Map<string, number>();
    const appearances = quotas.map(() => 0);
    for (const game of plan) {
      const key = [game.homeTeamIndex, game.awayTeamIndex].sort().join(':');
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      appearances[game.homeTeamIndex] = (appearances[game.homeTeamIndex] ?? 0) + 1;
      appearances[game.awayTeamIndex] = (appearances[game.awayTeamIndex] ?? 0) + 1;
    }
    expect(pairCounts.size).toBe(435);
    expect(Math.max(...pairCounts.values())).toBeLessThanOrEqual(4);
    expect(quotas.map((quota, index) => quota + (userGames[index] ?? 0))).toEqual(
      Array.from({ length: 30 }, () => 82),
    );
    expect(appearances).toEqual(quotas);
  });

  it('simulates the league deterministically with exact accounting', () => {
    const bracket = buildFixtureBracket();
    const first = simulateLeague({ seed: SEED_A, bracket, profile }, context);
    const second = simulateLeague({ seed: SEED_A, bracket, profile }, context);
    const other = simulateLeague({ seed: SEED_B, bracket, profile }, context);
    expect(second.digest).toBe(first.digest);
    expect(other.digest).not.toBe(first.digest);
    expect(first.gamesSimulated).toBe(leagueGamesSimulated(bracket));
    const quotas = leagueQuotas(bracket);
    for (const [index, team] of first.teams.entries()) {
      expect(team.gamesPlayed).toBe(quotas[index]);
      expect(team.wins + team.losses).toBe(team.gamesPlayed);
    }
    for (const player of first.players) {
      const index = bracket.opponents.findIndex((opponent) => opponent.teamId === player.teamId);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(player.games).toBe(quotas[index]);
    }
    const sim = createLeagueSimulation({ seed: SEED_A, bracket, profile }, context);
    expect(sim.gamesDone).toBe(0);
    sim.advance(100);
    expect(sim.gamesDone).toBe(100);
    expect(() => sim.finish()).toThrow(/incomplete/);
    sim.advance(sim.gamesTotal);
    expect(sim.finish().digest).toBe(first.digest);
  });

  it('accepts a matching league record and ranks a full-season MVP', () => {
    const bracket = buildFixtureBracket();
    const league = simulateLeague({ seed: SEED_A, bracket, profile }, context);
    const run = createChallenge(fixtureCreation({ league }));
    expect(run.league?.digest).toBe(league.digest);
    const finished = simulateChallenge(run, profile, context);
    expect(finished.status).toBe('finished');
    const mvp = leagueMvp(finished);
    expect(mvp).not.toBeNull();
    expect(mvp?.appearances).toBe(82);
    expect(mvp?.averagePoints).toBeLessThan(45);
    expect(mvp?.averagePoints).toBeGreaterThan(0);
  });

  it('keeps the games-only estimate for runs recorded without a league', () => {
    const run = createChallenge(fixtureCreation());
    const finished = simulateChallenge(run, profile, context);
    const mvp = leagueMvp(finished);
    expect(mvp).not.toBeNull();
    expect(mvp?.appearances).toBeGreaterThan(0);
  });

  it('rejects league records that do not match the run', () => {
    const bracket = buildFixtureBracket();
    const league = simulateLeague({ seed: SEED_B, bracket, profile }, context);
    expect(() => createChallenge(fixtureCreation({ league }))).toThrow(
      /league seed must match the run seed/,
    );
    const matching = simulateLeague({ seed: SEED_A, bracket, profile }, context);
    expect(() =>
      createChallenge(fixtureCreation({ league: { ...matching, digest: '0'.repeat(32) } })),
    ).toThrow(/league digest does not match/);
    const shortLeague = {
      ...matching,
      players: matching.players.slice(0, 149),
    };
    expect(() => createChallenge(fixtureCreation({ league: shortLeague }))).toThrow(
      /league record is invalid/,
    );
  });
});
