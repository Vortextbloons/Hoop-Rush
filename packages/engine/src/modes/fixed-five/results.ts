import type {
  FixedFiveDuelResult,
  FixedFiveShared82Result,
  GameResult,
  OpponentBracket,
  Seed,
} from '@hoop-rush/data-contracts';
import { checkGameResult } from '../../sim/invariants.ts';
import {
  FIXED_FIVE_TIEBREAK_PATH,
  fixedFiveDuelGameSeed,
  fixedFiveH2HSeed,
  fixedFiveSharedGameSeed,
  fixedFiveTiebreakWinner,
} from './seeds.ts';
import { findWeakestOpponent, h2hGameNumbersFor } from './shared82.ts';

function assertClean(result: GameResult, label: string): void {
  const failures = checkGameResult(result);
  if (failures.length > 0) {
    throw new Error(`${label} failed invariants: ${failures.join('; ')}`);
  }
}

export interface Shared82GameGroups {
  bracket: OpponentBracket;
  rootSeed: Seed;
  h2h: GameResult[];
  p1NonH2h: GameResult[];
  p2NonH2h: GameResult[];
}

export interface Shared82Summary {
  result: FixedFiveShared82Result;
  p1Games: GameResult[];
  p2Games: GameResult[];
  h2hResults: GameResult[];
}

export function summarizeShared82Games(groups: Shared82GameGroups): Shared82Summary {
  const weakest = findWeakestOpponent(groups.bracket);
  const h2hNumbers = h2hGameNumbersFor(groups.bracket, weakest.opponentId);
  const h2hSet = new Set(h2hNumbers);
  if (groups.h2h.length !== h2hNumbers.length) {
    throw new Error(
      `shared82 needs ${String(h2hNumbers.length)} H2H results (got ${String(groups.h2h.length)})`,
    );
  }
  const nonH2hCount = 82 - h2hNumbers.length;
  if (groups.p1NonH2h.length !== nonH2hCount || groups.p2NonH2h.length !== nonH2hCount) {
    throw new Error(
      `shared82 needs ${String(nonH2hCount)} non-H2H results per participant (got ${String(groups.p1NonH2h.length)}/${String(groups.p2NonH2h.length)})`,
    );
  }
  const h2hByGame = new Map(groups.h2h.map((game) => [game.gameNumber, game]));
  const p1ByGame = new Map(groups.p1NonH2h.map((game) => [game.gameNumber, game]));
  const p2ByGame = new Map(groups.p2NonH2h.map((game) => [game.gameNumber, game]));
  const p1Games: GameResult[] = [];
  const p2Games: GameResult[] = [];
  const h2hResults: GameResult[] = [];
  let p1Wins = 0;
  let p2Wins = 0;
  let p1Diff = 0;
  let p2Diff = 0;
  let p1H2hWins = 0;
  let p2H2hWins = 0;
  for (let gameNumber = 1; gameNumber <= 82; gameNumber += 1) {
    if (h2hSet.has(gameNumber)) {
      const result = h2hByGame.get(gameNumber);
      if (!result) throw new Error(`shared82 is missing H2H game ${String(gameNumber)}`);
      if (result.seed !== fixedFiveH2HSeed(groups.rootSeed, gameNumber)) {
        throw new Error(`H2H game ${String(gameNumber)} seed does not derive from the root seed`);
      }
      assertClean(result, `H2H game ${String(gameNumber)}`);
      h2hResults.push(result);
      p1Games.push(result);
      p2Games.push({
        ...result,
        home: { ...result.away },
        away: { ...result.home },
        winner: result.winner === 'home' ? 'away' : 'home',
        periodScores: { home: result.periodScores.away, away: result.periodScores.home },
      });
      if (result.winner === 'home') {
        p1Wins += 1;
        p1H2hWins += 1;
      } else {
        p2Wins += 1;
        p2H2hWins += 1;
      }
      const diff = result.home.box.points - result.away.box.points;
      p1Diff += diff;
      p2Diff -= diff;
      continue;
    }
    const p1Result = p1ByGame.get(gameNumber);
    const p2Result = p2ByGame.get(gameNumber);
    if (!p1Result || !p2Result) {
      throw new Error(`shared82 is missing game ${String(gameNumber)} for a participant`);
    }
    if (p1Result.seed !== fixedFiveSharedGameSeed(groups.rootSeed, 'p1', gameNumber)) {
      throw new Error(`shared82 p1 game ${String(gameNumber)} seed does not derive from the root seed`);
    }
    if (p2Result.seed !== fixedFiveSharedGameSeed(groups.rootSeed, 'p2', gameNumber)) {
      throw new Error(`shared82 p2 game ${String(gameNumber)} seed does not derive from the root seed`);
    }
    assertClean(p1Result, `shared82 p1 game ${String(gameNumber)}`);
    assertClean(p2Result, `shared82 p2 game ${String(gameNumber)}`);
    p1Games.push(p1Result);
    p2Games.push(p2Result);
    if (p1Result.winner === 'home') p1Wins += 1;
    if (p2Result.winner === 'home') p2Wins += 1;
    p1Diff += p1Result.home.box.points - p1Result.away.box.points;
    p2Diff += p2Result.home.box.points - p2Result.away.box.points;
  }
  const tiebreakWinner = fixedFiveTiebreakWinner(groups.rootSeed);
  let ranking: ['p1', 'p2'] | ['p2', 'p1'];
  if (p1Wins !== p2Wins) {
    ranking = p1Wins > p2Wins ? ['p1', 'p2'] : ['p2', 'p1'];
  } else if (p1Diff !== p2Diff) {
    ranking = p1Diff > p2Diff ? ['p1', 'p2'] : ['p2', 'p1'];
  } else {
    ranking = tiebreakWinner === 'p1' ? ['p1', 'p2'] : ['p2', 'p1'];
  }
  const result: FixedFiveShared82Result = {
    competition: 'shared-82',
    gamesPerParticipant: 82,
    uniqueSimulations: 82 + 82 - h2hNumbers.length,
    weakestReplacedOpponentId: weakest.opponentId,
    h2hGameNumbers: h2hNumbers,
    participants: [
      { participantId: 'p1', wins: p1Wins, losses: 82 - p1Wins, differential: p1Diff, h2hWins: p1H2hWins },
      { participantId: 'p2', wins: p2Wins, losses: 82 - p2Wins, differential: p2Diff, h2hWins: p2H2hWins },
    ],
    ranking,
    tiebreakPath: FIXED_FIVE_TIEBREAK_PATH,
  };
  return { result, p1Games, p2Games, h2hResults };
}

export interface DuelGameGroup {
  games: GameResult[];
  p1TeamId: string;
  p2TeamId: string;
  rootSeed: Seed;
}

export function summarizeDuelGames(group: DuelGameGroup): {
  result: FixedFiveDuelResult;
  games: GameResult[];
} {
  const games = [...group.games].sort((a, b) => a.gameNumber - b.gameNumber);
  if (games.length < 4 || games.length > 7) {
    throw new Error(`duel series must contain 4..7 games (got ${String(games.length)})`);
  }
  let p1Wins = 0;
  let p2Wins = 0;
  games.forEach((game, index) => {
    const expectedNumber = index + 1;
    if (game.gameNumber !== expectedNumber) {
      throw new Error(
        `duel game out of order: expected ${String(expectedNumber)}, got ${String(game.gameNumber)}`,
      );
    }
    if (game.seed !== fixedFiveDuelGameSeed(group.rootSeed, game.gameNumber)) {
      throw new Error(`duel game ${String(game.gameNumber)} seed does not derive from the root seed`);
    }
    assertClean(game, `duel game ${String(game.gameNumber)}`);
    const homeIsP1 = game.home.teamId === group.p1TeamId;
    if (!homeIsP1 && game.home.teamId !== group.p2TeamId) {
      throw new Error(`duel game ${String(game.gameNumber)} home team is not a participant`);
    }
    const p1Won = (game.winner === 'home') === homeIsP1;
    if (p1Won) p1Wins += 1;
    else p2Wins += 1;
    if ((p1Wins === 4 || p2Wins === 4) && index !== games.length - 1) {
      throw new Error(`duel series must stop immediately at four wins (extra game ${String(game.gameNumber)})`);
    }
  });
  if (p1Wins !== 4 && p2Wins !== 4) {
    throw new Error(
      `duel series must end 4-x within seven games (got ${String(p1Wins)}-${String(p2Wins)})`,
    );
  }
  const winner = p1Wins === 4 ? 'p1' : 'p2';
  return {
    result: {
      competition: 'duel',
      games: games.map((game) => {
        const homeIsP1 = game.home.teamId === group.p1TeamId;
        const p1Won = (game.winner === 'home') === homeIsP1;
        return { gameNumber: game.gameNumber, seed: game.seed, winner: p1Won ? 'p1' : 'p2' };
      }),
      p1Wins,
      p2Wins,
      winner,
      stoppedAtGame: games.length,
    },
    games,
  };
}
