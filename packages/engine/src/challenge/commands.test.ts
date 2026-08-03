import { describe, expect, it } from 'vitest';
import {
  buildFixtureBracket,
  buildGameSimulationInput,
  buildUserTeam,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import type { GameResult, RunPlayerSelection, SimulationPlayer } from '@hoop-rush/data-contracts';
import { challengeRunSchema } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../sim/context.js';
import { simulateGame } from '../sim/game.js';
import {
  abandonChallenge,
  acceptGameResult,
  createChallenge,
  createGameInput,
  createNextGameInput,
  simulateChallenge,
  validateBracketContent,
  type ChallengeCreation,
  type ChallengeCreationBase,
} from './commands.js';
import { deriveGameSeed } from './seeds.js';
import { addGameToAggregates, zeroRunAggregates } from './aggregates.js';

const context = createEngineContext();

function defaultSelections(
  players: SimulationPlayer[],
  franchiseId = 'lakers',
  eraId = '1990s',
): RunPlayerSelection[] {
  return players.map((player) => ({
    playerId: player.playerId,
    franchiseId,
    eraId,
  }));
}

function fixtureCreation(overrides: Partial<ChallengeCreationBase> = {}): ChallengeCreation {
  const bracket = buildFixtureBracket();
  const team = buildUserTeam();
  return {
    runId: 'run-1',
    mode: 'sandbox',
    franchiseId: 'lakers',
    eraId: '1990s',
    homeDisplayName: 'Los Angeles Lakers',
    lineup: {
      structure: ['G', 'G', 'F', 'F', 'C'],
      assignments: team.players.map((player, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: player.playerId,
        positions: player.positions,
      })),
    },
    players: team.players,
    selections: defaultSelections(team.players),
    runSeed: seedFromString('fixture-run-1'),
    dataVersion: 'data-v1',
    ratingVersion: 'ratings-v1',
    positionNormalizationVersion: 'position-v1',
    engineVersion: context.engineVersion,
    profile: buildGameSimulationInput().profile,
    bracket,
    ...overrides,
  };
}

describe('challenge commands', () => {
  it('creates an accepted active run with zeroed aggregates', () => {
    const run = createChallenge(fixtureCreation());
    expect(challengeRunSchema.safeParse(run).success).toBe(true);
    expect(run.status).toBe('active');
    expect(run.games).toHaveLength(0);
    expect(run.aggregates.team.gamesPlayed).toBe(0);
    expect(run.aggregates.players).toHaveLength(5);
    expect(run.firstLossGameNumber).toBeNull();
    expect(run.versions.bracketVersion).toBe('bracket-v1');
    expect(run.versions.seedDerivationVersion).toBe('seed-v1');
    expect(run.bracket.opponents).toHaveLength(30);
    expect(run.bracket.schedule).toHaveLength(82);
  });

  it('accepts a free-form run with a null franchiseId and selections', () => {
    const run = createChallenge(fixtureCreation({ franchiseId: null }));
    expect(run.franchiseId).toBeNull();
    expect(run.selections).toHaveLength(5);
    expect(challengeRunSchema.safeParse(run).success).toBe(true);
  });

  it('requires the eraId to match the simulation profile era', () => {
    const creation = fixtureCreation({ eraId: '2010s' });
    expect(() => createChallenge(creation)).toThrow(/must match the era profile era/);
  });

  it('rejects an illegal lineup', () => {
    const creation = fixtureCreation();
    creation.lineup = {
      ...creation.lineup,
      assignments: creation.lineup.assignments.map((assignment, i) =>
        i === 0 ? { ...assignment, positions: ['C'] } : assignment,
      ),
    };
    expect(() => createChallenge(creation)).toThrow(/lineup is not legal/);
  });

  it('rejects a creation whose lineup references missing snapshots', () => {
    const creation = fixtureCreation();
    creation.players = creation.players.slice(0, 4);
    expect(() => createChallenge(creation)).toThrow(/player snapshots/);
  });

  it('rejects a creation with a malformed bracket', () => {
    const creation = fixtureCreation();
    creation.bracket = {
      ...creation.bracket,
      schedule: creation.bracket.schedule.slice(0, 81),
    };
    expect(() => createChallenge(creation)).toThrow(/schedule must contain 82 games/);
  });

  it('rejects a creation whose data version differs from the profile', () => {
    const creation = fixtureCreation({ dataVersion: 'other' });
    expect(() => createChallenge(creation)).toThrow(/dataVersion/);
  });

  it('builds the next game input with the derived seed and scheduled opponent', () => {
    const run = createChallenge(fixtureCreation());
    const input = createNextGameInput(run, buildGameSimulationInput().profile);
    expect(input).not.toBeNull();
    expect(input?.gameNumber).toBe(1);
    expect(input?.seed).toBe(deriveGameSeed(run.runSeed, 1));
    expect(input?.home.teamId).toBe('user');
    const opening = run.bracket.opponents.find((o) => o.opponentId === 'lakers-1990s-opening');
    expect(input?.away.teamId).toBe(opening?.teamId);
    expect(input?.away.players).toHaveLength(5);
  });

  it('returns null for the next input when the run is finished', () => {
    const finished = createChallenge(fixtureCreation());
    const completed = simulateChallenge(finished, buildGameSimulationInput().profile, context);
    expect(completed.status).toBe('finished');
    expect(createNextGameInput(completed, buildGameSimulationInput().profile)).toBeNull();
  });

  it('accepts one verified game result and accumulates aggregates', () => {
    const run = createChallenge(fixtureCreation());
    const input = createNextGameInput(run, buildGameSimulationInput().profile);
    expect(input).not.toBeNull();
    if (input === null) {
      throw new Error('expected a next game input for an active run');
    }
    const result = simulateGame(input, context);
    const next = acceptGameResult(run, result);
    expect(next.games).toHaveLength(1);
    expect(next.aggregates.team.gamesPlayed).toBe(1);
    const expected = addGameToAggregates(run.aggregates, result);
    expect(next.aggregates).toEqual(expected);
    expect(next.aggregates.team.wins + next.aggregates.team.losses).toBe(1);
  });

  it('aggregates equal the sum of stored box scores (property)', () => {
    const run = createChallenge(fixtureCreation());
    const completed = simulateChallenge(run, buildGameSimulationInput().profile, context);
    expect(completed.games).toHaveLength(82);
    const summed = zeroRunAggregates(run.players);
    for (const game of completed.games) {
      const folded = addGameToAggregates(summed, game);
      Object.assign(summed, folded);
    }
    expect(completed.aggregates).toEqual(summed);
    for (const player of completed.aggregates.players) {
      const pointsFromGames = completed.games.reduce(
        (total, game) =>
          total + (game.home.players.find((p) => p.playerId === player.playerId)?.points ?? 0),
        0,
      );
      expect(player.points).toBe(pointsFromGames);
    }
  });

  it('simulates all 82 games with a consistent record and outcome', () => {
    const run = createChallenge(fixtureCreation());
    const completed = simulateChallenge(run, buildGameSimulationInput().profile, context);
    expect(completed.games).toHaveLength(82);
    const games = completed.games.map((g) => g.gameNumber);
    expect(games).toEqual(Array.from({ length: 82 }, (_, i) => i + 1));
    expect(completed.aggregates.team.wins + completed.aggregates.team.losses).toBe(82);
    expect(completed.status).toBe('finished');
    if (completed.firstLossGameNumber === null) {
      expect(completed.outcome).toBe('perfect');
      expect(completed.aggregates.team.losses).toBe(0);
    } else {
      expect(completed.outcome).toBe('eliminated');
      expect(completed.aggregates.team.losses).toBeGreaterThan(0);
    }
  });

  it('the first loss matches the first losing result', () => {
    const run = createChallenge(fixtureCreation());
    const completed = simulateChallenge(run, buildGameSimulationInput().profile, context);
    const firstLossIndex = completed.games.findIndex((g) => g.winner === 'away');
    expect(completed.firstLossGameNumber).toBe(firstLossIndex === -1 ? null : firstLossIndex + 1);
  });

  it('an interrupted run resumes byte-for-byte', () => {
    const run = createChallenge(fixtureCreation());
    const profileInput = buildGameSimulationInput().profile;
    const uninterrupted = simulateChallenge(run, profileInput, context);

    let interrupted = run;
    for (let i = 0; i < 37; i += 1) {
      const input = createNextGameInput(interrupted, profileInput);
      if (input === null) {
        throw new Error(`expected a next game input at game ${String(i + 1)}`);
      }
      interrupted = acceptGameResult(interrupted, simulateGame(input, context));
    }
    const resumed = simulateChallenge(interrupted, profileInput, context);
    expect(resumed).toEqual(uninterrupted);
  });

  it('rejects a result with the wrong game number', () => {
    const run = createChallenge(fixtureCreation());
    const input = createGameInput(run, buildGameSimulationInput().profile, 2);
    const result = simulateGame(input, context);
    expect(() => acceptGameResult(run, result)).toThrow(/expected game 1, got game 2/);
  });

  it('rejects a result whose seed does not derive from the run seed', () => {
    const run = createChallenge(fixtureCreation());
    const input = createGameInput(run, buildGameSimulationInput().profile, 1);
    const result = { ...simulateGame(input, context), seed: seedFromString('tampered') };
    expect(() => acceptGameResult(run, result)).toThrow(/does not derive from the run seed/);
  });

  it('rejects a result from the wrong opponent', () => {
    const run = createChallenge(fixtureCreation());
    const input = createGameInput(run, buildGameSimulationInput().profile, 1);
    const result = simulateGame(input, context);
    const swapped: GameResult = {
      ...result,
      away: { ...result.away, teamId: 'boston', displayName: 'Boston Celtics' },
    };
    expect(() => acceptGameResult(run, swapped)).toThrow(/does not match scheduled/);
  });

  it('rejects a result with a mismatched engine version', () => {
    const run = createChallenge(fixtureCreation());
    const input = createGameInput(run, buildGameSimulationInput().profile, 1);
    const result = { ...simulateGame(input, context), engineVersion: 'old-engine-v1' };
    expect(() => acceptGameResult(run, result)).toThrow(/engine version mismatch/);
  });

  it('rejects a result with a mismatched era profile version', () => {
    const run = createChallenge(fixtureCreation());
    const input = createGameInput(run, buildGameSimulationInput().profile, 1);
    const result = { ...simulateGame(input, context), profileVersion: 'other-profile-v1' };
    expect(() => acceptGameResult(run, result)).toThrow(/era profile version mismatch/);
  });

  it('rejects a result when the run is not active', () => {
    const run = createChallenge(fixtureCreation());
    const abandoned = abandonChallenge(run);
    const input = createGameInput(run, buildGameSimulationInput().profile, 1);
    const result = simulateGame(input, context);
    expect(() => acceptGameResult(abandoned, result)).toThrow(/not active/);
  });

  it('abandonChallenge marks the run abandoned and rejects double abandon', () => {
    const run = createChallenge(fixtureCreation());
    const abandoned = abandonChallenge(run);
    expect(abandoned.status).toBe('abandoned');
    expect(() => abandonChallenge(abandoned)).toThrow(/cannot abandon/);
  });

  it('bracket content validation catches duplicates and broken references', () => {
    const bracket = buildFixtureBracket();
    const failures = validateBracketContent(bracket);
    expect(failures).toEqual([]);

    const last = bracket.opponents[28];
    const first = bracket.opponents[0];
    if (last === undefined || first === undefined) {
      throw new Error('fixture bracket requires 30 opponents');
    }
    const withDuplicate = {
      ...bracket,
      opponents: [...bracket.opponents.slice(0, 29), { ...last, opponentId: first.opponentId }],
    };
    expect(validateBracketContent(withDuplicate).join('; ')).toContain('duplicate opponentId');
  });
});
