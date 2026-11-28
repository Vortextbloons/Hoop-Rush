import { describe, expect, test } from 'bun:test';
import { createEngineContext, simulateGame } from '@hoop-rush/engine';
import { buildGameSimulationInput } from '@hoop-rush/test-fixtures';
import type {
  FixedFiveCompetitionResult,
  FixedFiveWorkerResultEntry,
} from '@hoop-rush/data-contracts';
import { seedSchema } from '@hoop-rush/data-contracts';
import { fixedFiveAchievementCandidates, fixedFiveCareerFacts } from './profile-results.js';

describe('fixed five career facts', () => {
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
    const candidates = fixedFiveAchievementCandidates('p2', result, entries, null);
    expect(candidates.map((candidate) => candidate.id)).toContain('bring-out-the-brooms');
    expect(candidates.map((candidate) => candidate.id)).not.toContain('upset-of-the-year');
    expect(fixedFiveAchievementCandidates('p2', result, entries.slice(1), null)).toEqual([]);
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
    const candidates = fixedFiveAchievementCandidates('p2', result, entries, null);
    expect(candidates.map((candidate) => candidate.id)).toContain('the-splash-brothers');

    const oneLoss: FixedFiveCompetitionResult = {
      ...result,
      participants: result.participants.map((participant) =>
        participant.participantId === 'p2' ? { ...participant, wins: 81, losses: 1 } : participant,
      ),
    };
    expect(fixedFiveAchievementCandidates('p2', oneLoss, entries, null)).toEqual([]);
  });

  test('awards individual stat-line achievements from verified boxes', () => {
    const game = simulateGame(buildGameSimulationInput(), createEngineContext());
    const reboundLine = game.away.players[0];
    if (reboundLine === undefined) throw new Error('Missing test player');
    const h2h = {
      ...game,
      home: { ...game.home, teamId: 'p1' },
      away: {
        ...game.away,
        teamId: 'p2',
        players: [
          { ...reboundLine, rebounds: { ...reboundLine.rebounds, total: 30 } },
          ...game.away.players.slice(1),
        ],
      },
      winner: 'away' as const,
    };
    const result: FixedFiveCompetitionResult = {
      competition: 'duel',
      games: Array.from({ length: 4 }, (_, index) => ({
        gameNumber: index + 1,
        seed: seedSchema.parse(game.seed),
        winner: 'p2' as const,
      })),
      p1Wins: 0,
      p2Wins: 4,
      winner: 'p2',
      stoppedAtGame: 4,
    };
    const entries: FixedFiveWorkerResultEntry[] = Array.from({ length: 4 }, (_, index) => ({
      tag: 'duel',
      game: { ...h2h, gameNumber: index + 1 },
    }));
    const candidates = fixedFiveAchievementCandidates('p2', result, entries, null);
    expect(candidates.map((candidate) => candidate.id)).toContain('board-man-gets-paid');
  });

  test('awards Dame Time from a verified one-point Game 7', () => {
    const game = simulateGame(buildGameSimulationInput(), createEngineContext());
    const winners = ['p1', 'p2', 'p1', 'p2', 'p1', 'p2', 'p1'] as const;
    const result: FixedFiveCompetitionResult = {
      competition: 'duel',
      games: winners.map((winner, index) => ({
        gameNumber: index + 1,
        seed: seedSchema.parse(game.seed),
        winner,
      })),
      p1Wins: 4,
      p2Wins: 3,
      winner: 'p1',
      stoppedAtGame: 7,
    };
    const entries: FixedFiveWorkerResultEntry[] = winners.map((winner, index) => {
      const homeWins = winner === 'p1';
      return {
        tag: 'duel',
        game: {
          ...game,
          gameNumber: index + 1,
          home: {
            ...game.home,
            teamId: 'p1',
            box: {
              ...game.home.box,
              points: 100 + (homeWins ? (index === 6 ? 1 : 7) : 0),
            },
          },
          away: {
            ...game.away,
            teamId: 'p2',
            box: {
              ...game.away.box,
              points: 100 + (homeWins ? 0 : index === 6 ? 1 : 7),
            },
          },
          winner: homeWins ? 'home' : 'away',
        },
      };
    });
    const candidates = fixedFiveAchievementCandidates('p1', result, entries, null);
    expect(candidates.map((candidate) => candidate.id)).toContain('dame-time');
  });
});
