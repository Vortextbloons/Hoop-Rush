import type {
  EraSimulationProfile,
  FixedFiveDuelResult,
  GameResult,
  Seed,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { checkGameResult } from '../../sim/invariants.ts';
import { simulateGame } from '../../sim/game.ts';
import type { EngineContext } from '../../sim/context.ts';
import { fixedFiveDuelGameSeed } from './seeds.ts';

export interface DuelSimulationInput {
  p1Team: SimulationTeam;
  p2Team: SimulationTeam;
  profile: EraSimulationProfile;
  rootSeed: Seed;
  dataVersion: string;
}

export interface DuelSimulationOutput {
  result: FixedFiveDuelResult;
  games: GameResult[];
}

export function simulateDuelSeries(
  input: DuelSimulationInput,
  context: EngineContext,
): DuelSimulationOutput {
  const games: GameResult[] = [];
  let p1Wins = 0;
  let p2Wins = 0;
  for (let gameNumber = 1; gameNumber <= 7; gameNumber += 1) {
    if (p1Wins === 4 || p2Wins === 4) break;
    const seed = fixedFiveDuelGameSeed(input.rootSeed, gameNumber);
    const displayHomeP1 = gameNumber % 2 === 1;
    const home = displayHomeP1 ? input.p1Team : input.p2Team;
    const away = displayHomeP1 ? input.p2Team : input.p1Team;
    const result = simulateGame(
      {
        schemaVersion: 2,
        seed,
        gameNumber,
        dataVersion: input.dataVersion,
        profile: input.profile,
        home,
        away,
      },
      context,
    );
    const failures = checkGameResult(result);
    if (failures.length > 0)
      throw new Error(`duel game ${String(gameNumber)} failed invariants: ${failures.join('; ')}`);
    games.push(result);
    const homeIsP1 = result.home.teamId === input.p1Team.teamId;
    const p1Won = (result.winner === 'home') === homeIsP1;
    if (p1Won) p1Wins += 1;
    else p2Wins += 1;
  }
  if (p1Wins !== 4 && p2Wins !== 4) {
    throw new Error(
      `duel series must end 4-x within seven games (got ${String(p1Wins)}-${String(p2Wins)})`,
    );
  }
  const winner = p1Wins === 4 ? 'p1' : 'p2';
  const duelGames: FixedFiveDuelResult['games'] = games.map((game, index) => {
    const gameNumber = index + 1;
    const homeIsP1 = game.home.teamId === input.p1Team.teamId;
    const p1Won = (game.winner === 'home') === homeIsP1;
    return { gameNumber, seed: game.seed, winner: p1Won ? 'p1' : 'p2' };
  });
  const result: FixedFiveDuelResult = {
    competition: 'duel',
    games: duelGames,
    p1Wins,
    p2Wins,
    winner,
    stoppedAtGame: games.length,
  };
  return { result, games };
}
