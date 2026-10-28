import { describe, expect, test } from 'bun:test';
import { createEngineContext, simulateGame } from '@hoop-rush/engine';
import { buildGameSimulationInput } from '@hoop-rush/test-fixtures';
import type {
  FixedFiveCompetitionResult,
  FixedFiveWorkerResultEntry,
} from '@hoop-rush/data-contracts';
import { publicProfileSchema, seedSchema } from '@hoop-rush/data-contracts';
import { fixedFiveCareerFacts } from './profile-results.js';

describe('fixed five career facts', () => {
  test('room profile excludes local identity and achievement progress', () => {
    const result = publicProfileSchema.parse({
      participantId: 'p1',
      name: 'RimReaper',
      avatar: 'ball',
      border: 'classic',
      nameColor: 'white',
      title: 'none',
      featuredAchievement: null,
      games: 12,
      wins: 7,
      bestStreak: 3,
      id: '00000000-0000-4000-8000-000000000001',
      achievements: ['welcome'],
      multiplayerStreak: 4,
    });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('achievements');
    expect(result).not.toHaveProperty('multiplayerStreak');
  });
  test('selects the local team and refuses an incomplete season', () => {
    const game = simulateGame(buildGameSimulationInput(), createEngineContext());
    const h2h = {
      ...game,
      gameNumber: 1,
      home: { ...game.home, teamId: 'p1' },
      away: { ...game.away, teamId: 'p2' },
      winner: 'away' as const,
    };
    const result: FixedFiveCompetitionResult = {
      competition: 'duel',
      games: [
        { gameNumber: 1, seed: seedSchema.parse(game.seed), winner: 'p2' },
        { gameNumber: 2, seed: seedSchema.parse(game.seed), winner: 'p2' },
        { gameNumber: 3, seed: seedSchema.parse(game.seed), winner: 'p2' },
        { gameNumber: 4, seed: seedSchema.parse(game.seed), winner: 'p2' },
      ],
      p1Wins: 0,
      p2Wins: 4,
      winner: 'p2',
      stoppedAtGame: 4,
    };
    const entries: FixedFiveWorkerResultEntry[] = Array.from({ length: 4 }, (_, index) => ({
      tag: 'duel',
      game: { ...h2h, gameNumber: index + 1 },
    }));
    const facts = fixedFiveCareerFacts('p2', result, entries);
    expect(facts?.map((fact) => fact.won)).toEqual([true, true, true, true]);
    expect(facts?.[0]?.players).toEqual(h2h.away.players);
    expect(fixedFiveCareerFacts('p2', result, entries.slice(1))).toBeNull();
  });

  test('counts each shared season game once for the selected participant', () => {
    const game = simulateGame(buildGameSimulationInput(), createEngineContext());
    const entries: FixedFiveWorkerResultEntry[] = [];
    for (let gameNumber = 1; gameNumber <= 82; gameNumber += 1) {
      if (gameNumber === 1) {
        entries.push({
          tag: 'h2h',
          game: {
            ...game,
            gameNumber,
            home: { ...game.home, teamId: 'p1' },
            away: { ...game.away, teamId: 'p2' },
            winner: 'away',
          },
        });
      } else {
        entries.push({
          tag: 'p1',
          game: { ...game, gameNumber, home: { ...game.home, teamId: 'p1' }, winner: 'away' },
        });
        entries.push({
          tag: 'p2',
          game: { ...game, gameNumber, home: { ...game.home, teamId: 'p2' }, winner: 'home' },
        });
      }
    }
    const result: FixedFiveCompetitionResult = {
      competition: 'shared-82',
      gamesPerParticipant: 82,
      uniqueSimulations: 163,
      weakestReplacedOpponentId: 'opponent',
      h2hGameNumbers: [1],
      participants: [
        { participantId: 'p1', wins: 0, losses: 82, differential: 0, h2hWins: 0 },
        { participantId: 'p2', wins: 82, losses: 0, differential: 0, h2hWins: 1 },
      ],
      ranking: ['p2', 'p1'],
      tiebreakPath: 'wins',
    };
    const facts = fixedFiveCareerFacts('p2', result, entries);
    expect(facts).toHaveLength(82);
    expect(facts?.every((item) => item.won)).toBe(true);
    expect(facts?.[0]?.players).toEqual(game.away.players);
  });
});
