import type {
  BracketOpponent,
  EraSimulationProfile,
  FixedFiveShared82Result,
  GameResult,
  OpponentBracket,
  Seed,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { checkGameResult } from '../../sim/invariants.ts';
import { simulateGame } from '../../sim/game.ts';
import type { EngineContext } from '../../sim/context.ts';
import {
  fixedFiveH2HSeed,
  fixedFiveSharedGameSeed,
  fixedFiveTiebreakWinner,
  FIXED_FIVE_TIEBREAK_PATH,
} from './seeds.ts';

export function findWeakestOpponent(bracket: OpponentBracket): BracketOpponent {
  if (bracket.opponents.length === 0) throw new Error('bracket has no opponents');
  const sorted = [...bracket.opponents].sort((a, b) => {
    if (a.strength.percentile !== b.strength.percentile)
      return a.strength.percentile - b.strength.percentile;
    if (a.strength.winRate !== b.strength.winRate) return a.strength.winRate - b.strength.winRate;
    return a.opponentId < b.opponentId ? -1 : a.opponentId > b.opponentId ? 1 : 0;
  });
  const weakest = sorted[0];
  if (!weakest) throw new Error('bracket has no opponents');
  return weakest;
}

export function h2hGameNumbersFor(bracket: OpponentBracket, weakestOpponentId: string): number[] {
  return bracket.schedule
    .filter((entry) => entry.opponentId === weakestOpponentId)
    .map((entry) => entry.gameNumber)
    .sort((a, b) => a - b);
}

export interface Shared82SimulationInput {
  p1Team: SimulationTeam;
  p2Team: SimulationTeam;
  bracket: OpponentBracket;
  profile: EraSimulationProfile;
  rootSeed: Seed;
  dataVersion: string;
}

export interface Shared82SimulationOutput {
  result: FixedFiveShared82Result;
  p1Games: GameResult[];
  p2Games: GameResult[];
  h2hResults: GameResult[];
  uniqueSimulations: number;
  weakestReplacedOpponentId: string;
}

function opponentById(bracket: OpponentBracket, opponentId: string): BracketOpponent {
  const opponent = bracket.opponents.find((o) => o.opponentId === opponentId);
  if (!opponent) throw new Error(`unknown opponent ${opponentId}`);
  return opponent;
}

export function displayHomeForH2hIndex(index: number): 'p1' | 'p2' {
  return index % 2 === 0 ? 'p1' : 'p2';
}

export function simulateShared82(
  input: Shared82SimulationInput,
  context: EngineContext,
): Shared82SimulationOutput {
  const weakest = findWeakestOpponent(input.bracket);
  const h2hNumbers = h2hGameNumbersFor(input.bracket, weakest.opponentId);
  const h2hSet = new Set(h2hNumbers);
  const p1Games: GameResult[] = [];
  const p2Games: GameResult[] = [];
  const h2hResults: GameResult[] = [];
  let p1Wins = 0;
  let p2Wins = 0;
  let p1Diff = 0;
  let p2Diff = 0;
  let p1H2hWins = 0;
  let p2H2hWins = 0;

  const h2hIndexByGame = new Map(h2hNumbers.map((gameNumber, index) => [gameNumber, index]));

  for (let gameNumber = 1; gameNumber <= 82; gameNumber += 1) {
    const entry = input.bracket.schedule[gameNumber - 1];
    if (!entry) throw new Error(`schedule missing game ${String(gameNumber)}`);
    if (h2hSet.has(gameNumber)) {
      const seed = fixedFiveH2HSeed(input.rootSeed, gameNumber);
      const result = simulateGame(
        {
          schemaVersion: 2,
          seed,
          gameNumber,
          dataVersion: input.dataVersion,
          profile: input.profile,
          home: input.p1Team,
          away: input.p2Team,
        },
        context,
      );
      const failures = checkGameResult(result);
      if (failures.length > 0)
        throw new Error(`H2H game ${String(gameNumber)} failed invariants: ${failures.join('; ')}`);
      h2hResults.push(result);
      p1Games.push(result);
      const mirrored: GameResult = {
        ...result,
        home: { ...result.away },
        away: { ...result.home },
        winner: result.winner === 'home' ? 'away' : 'home',
        periodScores: { home: result.periodScores.away, away: result.periodScores.home },
      };
      void h2hIndexByGame;
      p2Games.push(mirrored);
      const p1Won = result.winner === 'home';
      if (p1Won) {
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
    const opponent = opponentById(input.bracket, entry.opponentId);
    const p1Seed = fixedFiveSharedGameSeed(input.rootSeed, 'p1', gameNumber);
    const p1Result = simulateGame(
      {
        schemaVersion: 2,
        seed: p1Seed,
        gameNumber,
        dataVersion: input.dataVersion,
        profile: input.profile,
        home: input.p1Team,
        away: {
          teamId: opponent.teamId,
          displayName: opponent.displayName,
          players: opponent.players,
        },
      },
      context,
    );
    const p1Failures = checkGameResult(p1Result);
    if (p1Failures.length > 0)
      throw new Error(
        `shared82 p1 game ${String(gameNumber)} failed invariants: ${p1Failures.join('; ')}`,
      );
    p1Games.push(p1Result);
    if (p1Result.winner === 'home') p1Wins += 1;
    p1Diff += p1Result.home.box.points - p1Result.away.box.points;

    const p2Seed = fixedFiveSharedGameSeed(input.rootSeed, 'p2', gameNumber);
    const p2Result = simulateGame(
      {
        schemaVersion: 2,
        seed: p2Seed,
        gameNumber,
        dataVersion: input.dataVersion,
        profile: input.profile,
        home: input.p2Team,
        away: {
          teamId: opponent.teamId,
          displayName: opponent.displayName,
          players: opponent.players,
        },
      },
      context,
    );
    const p2Failures = checkGameResult(p2Result);
    if (p2Failures.length > 0)
      throw new Error(
        `shared82 p2 game ${String(gameNumber)} failed invariants: ${p2Failures.join('; ')}`,
      );
    p2Games.push(p2Result);
    if (p2Result.winner === 'home') p2Wins += 1;
    p2Diff += p2Result.home.box.points - p2Result.away.box.points;
  }

  const tiebreakWinner = fixedFiveTiebreakWinner(input.rootSeed);
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
      {
        participantId: 'p1',
        wins: p1Wins,
        losses: 82 - p1Wins,
        differential: p1Diff,
        h2hWins: p1H2hWins,
      },
      {
        participantId: 'p2',
        wins: p2Wins,
        losses: 82 - p2Wins,
        differential: p2Diff,
        h2hWins: p2H2hWins,
      },
    ],
    ranking,
    tiebreakPath: FIXED_FIVE_TIEBREAK_PATH,
  };
  return {
    result,
    p1Games,
    p2Games,
    h2hResults,
    uniqueSimulations: result.uniqueSimulations,
    weakestReplacedOpponentId: weakest.opponentId,
  };
}
