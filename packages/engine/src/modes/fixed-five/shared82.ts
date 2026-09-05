import type {
  BracketOpponent,
  EraSimulationProfile,
  GameResult,
  OpponentBracket,
  Seed,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { checkGameResult } from '../../sim/invariants.ts';
import { simulateGame } from '../../sim/game.ts';
import type { EngineContext } from '../../sim/context.ts';
import { fixedFiveH2HSeed, fixedFiveSharedGameSeed } from './seeds.ts';
import { summarizeShared82Games, type Shared82Summary } from './results.ts';
export function findWeakestOpponent<
  T extends {
    opponentId: string;
    strength: {
      percentile: number;
      winRate: number;
    };
  },
>(bracket: { opponents: readonly T[] }): T {
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
export interface Shared82SimulationOutput extends Shared82Summary {
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
  const h2h: GameResult[] = [];
  const p1NonH2h: GameResult[] = [];
  const p2NonH2h: GameResult[] = [];
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
      h2h.push(result);
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
    p1NonH2h.push(p1Result);
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
    p2NonH2h.push(p2Result);
  }
  const summary = summarizeShared82Games({
    bracket: input.bracket,
    rootSeed: input.rootSeed,
    h2h,
    p1NonH2h,
    p2NonH2h,
  });
  return {
    ...summary,
    uniqueSimulations: summary.result.uniqueSimulations,
    weakestReplacedOpponentId: summary.result.weakestReplacedOpponentId,
  };
}
