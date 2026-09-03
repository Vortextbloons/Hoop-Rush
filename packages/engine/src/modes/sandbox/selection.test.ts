import { describe, expect, it } from 'vitest';
import {
  buildFixtureBracket,
  buildGameSimulationInput,
  buildUserTeam,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import type { ChallengeRun } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/context.ts';
import {
  createChallenge,
  simulateChallenge,
  type ChallengeCreation,
  type ChallengeCreationBase,
} from '../../challenge/commands.ts';
import { deriveAttemptSeed } from '../../challenge/seeds.ts';
import {
  BEST_OF_ATTEMPTS,
  chooseBestRun,
  chooseBestRunSeed,
  scoreRun,
  simulateChallengeBestOf,
} from './selection.ts';
const context = createEngineContext();
function fixtureCreation(overrides: Partial<ChallengeCreationBase> = {}): ChallengeCreation {
  const bracket = buildFixtureBracket();
  const team = buildUserTeam();
  return {
    runId: 'run-selection',
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
    selections: team.players.map((player) => ({
      playerId: player.playerId,
      franchiseId: 'lakers',
      eraId: '1990s',
    })),
    runSeed: seedFromString('selection-run'),
    dataVersion: 'data-v1',
    ratingVersion: 'ratings-v1',
    positionNormalizationVersion: 'position-v1',
    engineVersion: context.engineVersion,
    profile: buildGameSimulationInput().profile,
    bracket,
    ...overrides,
  };
}
function fakeRun(wins: number, differential: number): ChallengeRun {
  return {
    aggregates: {
      team: { wins, losses: 82 - wins, gamesPlayed: 82 },
      players: [],
    },
    games: [
      { gameNumber: 1, home: { box: { points: 101 } }, away: { box: { points: 101 } } },
      {
        gameNumber: 2,
        home: { box: { points: 100 + differential } },
        away: { box: { points: 100 } },
      },
    ],
  } as unknown as ChallengeRun;
}
describe('sandbox selection', () => {
  it('scores a run by wins and exact season point differential', () => {
    const run = fakeRun(60, 120);
    expect(scoreRun(run)).toEqual({ wins: 60, differential: 120 });
  });
  it('prefers more wins', () => {
    const loser = fakeRun(55, 400);
    const winner = fakeRun(56, -50);
    expect(chooseBestRun([loser, winner])).toBe(winner);
  });
  it('breaks win ties by point differential', () => {
    const lowDiff = fakeRun(60, 30);
    const highDiff = fakeRun(60, 60);
    expect(chooseBestRun([lowDiff, highDiff])).toBe(highDiff);
  });
  it('breaks full ties to the earlier attempt', () => {
    const first = fakeRun(60, 50);
    const second = fakeRun(60, 50);
    expect(chooseBestRun([first, second])).toBe(first);
  });
  it('rejects an empty attempt list', () => {
    expect(() => chooseBestRun([])).toThrow(/at least one attempt/);
  });
  it('simulates every attempt and returns a finished run', () => {
    const creation = fixtureCreation();
    const chosen = simulateChallengeBestOf(creation, creation.profile, context);
    expect(chosen.status).toBe('finished');
    expect(chosen.games).toHaveLength(82);
    expect(chosen.aggregates.team.gamesPlayed).toBe(82);
    expect(chosen.aggregates.team.wins + chosen.aggregates.team.losses).toBe(82);
  });
  it('chooses one of the derived attempt seeds', () => {
    const creation = fixtureCreation();
    const chosen = simulateChallengeBestOf(creation, creation.profile, context);
    const attemptSeeds = Array.from({ length: BEST_OF_ATTEMPTS }, (_, attempt) =>
      deriveAttemptSeed(creation.runSeed, attempt),
    );
    expect(attemptSeeds).toContain(chosen.runSeed);
  });
  it('is deterministic: the same run seed chooses the same attempt', () => {
    const creation = fixtureCreation();
    const first = simulateChallengeBestOf(creation, creation.profile, context);
    const second = simulateChallengeBestOf(creation, creation.profile, context);
    expect(second.runSeed).toBe(first.runSeed);
    expect(second.aggregates.team.wins).toBe(first.aggregates.team.wins);
  });
  it('chosen run equals a direct simulation of the chosen seed', () => {
    const creation = fixtureCreation();
    const chosen = simulateChallengeBestOf(creation, creation.profile, context);
    const direct = simulateChallenge(
      createChallenge({ ...creation, runSeed: chosen.runSeed }),
      creation.profile,
      context,
    );
    expect(direct.aggregates.team.wins).toBe(chosen.aggregates.team.wins);
    expect(direct.firstLossGameNumber).toBe(chosen.firstLossGameNumber);
    for (let i = 0; i < 82; i += 1) {
      expect(direct.games[i]?.home.box.points).toBe(chosen.games[i]?.home.box.points);
      expect(direct.games[i]?.away.box.points).toBe(chosen.games[i]?.away.box.points);
    }
  });
});
describe('chooseBestRunSeed (worker best-of)', () => {
  it('matches simulateChallengeBestOf for the same creation', () => {
    const creation = fixtureCreation();
    const engineChosen = simulateChallengeBestOf(creation, creation.profile, context);
    const chosen = chooseBestRunSeed(
      createChallenge({ ...creation, runSeed: creation.runSeed }),
      creation.profile,
      context,
    );
    expect(chosen.chosenRunSeed).toBe(engineChosen.runSeed);
    expect(chosen.chosenWins).toBe(engineChosen.aggregates.team.wins);
    expect(chosen.chosenLosses).toBe(engineChosen.aggregates.team.losses);
    let differential = 0;
    for (const game of engineChosen.games) {
      differential += game.home.box.points - game.away.box.points;
    }
    expect(chosen.chosenDifferential).toBe(differential);
  });
});
