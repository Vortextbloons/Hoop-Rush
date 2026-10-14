import type {
  EraSimulationProfile,
  FixedFiveDuelResult,
  FixedFiveParticipantId,
  GameResult,
  GameSimulationInput,
  GameTapeEvent,
  Seed,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { checkGameResult } from '../../sim/invariants.ts';
import { simulateGame } from '../../sim/game.ts';
import { simulateRecordedGame } from '../../sim/tape.ts';
import type { EngineContext } from '../../sim/kernel.ts';
import { fixedFiveDuelGameSeed } from './seeds.ts';
import { summarizeDuelGames } from './results.ts';
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
export type DuelGameEvent = { tag: 'duel'; game: GameResult };

export function duelHomeParticipantId(gameNumber: number): FixedFiveParticipantId {
  return gameNumber % 2 === 1 ? 'p1' : 'p2';
}

export function duelGameSimulationInput(
  input: DuelSimulationInput,
  gameNumber: number,
): GameSimulationInput {
  const homeParticipantId = duelHomeParticipantId(gameNumber);
  const home = homeParticipantId === 'p1' ? input.p1Team : input.p2Team;
  const away = homeParticipantId === 'p1' ? input.p2Team : input.p1Team;
  return {
    schemaVersion: 2,
    seed: fixedFiveDuelGameSeed(input.rootSeed, gameNumber),
    gameNumber,
    dataVersion: input.dataVersion,
    profile: input.profile,
    home,
    away,
  };
}

export interface RecordedDuelGame {
  gameNumber: number;
  seed: Seed;
  homeParticipantId: FixedFiveParticipantId;
  awayParticipantId: FixedFiveParticipantId;
  result: GameResult;
  tape: GameTapeEvent[];
}

export function simulateRecordedDuelGame(
  input: DuelSimulationInput,
  gameNumber: number,
  context: EngineContext,
): RecordedDuelGame {
  const simulationInput = duelGameSimulationInput(input, gameNumber);
  const { result, tape } = simulateRecordedGame(simulationInput, context);
  const failures = checkGameResult(result);
  if (failures.length > 0)
    throw new Error(`duel game ${String(gameNumber)} failed invariants: ${failures.join('; ')}`);
  const homeParticipantId = duelHomeParticipantId(gameNumber);
  return {
    gameNumber,
    seed: simulationInput.seed,
    homeParticipantId,
    awayParticipantId: homeParticipantId === 'p1' ? 'p2' : 'p1',
    result,
    tape,
  };
}

export function* duelGameEvents(
  input: DuelSimulationInput,
  context: EngineContext,
): Generator<DuelGameEvent, void, undefined> {
  let p1Wins = 0;
  let p2Wins = 0;
  for (let gameNumber = 1; gameNumber <= 7; gameNumber += 1) {
    if (p1Wins === 4 || p2Wins === 4) break;
    const result = simulateGame(duelGameSimulationInput(input, gameNumber), context);
    const failures = checkGameResult(result);
    if (failures.length > 0)
      throw new Error(`duel game ${String(gameNumber)} failed invariants: ${failures.join('; ')}`);
    yield { tag: 'duel', game: result };
    const homeIsP1 = result.home.teamId === input.p1Team.teamId;
    const p1Won = (result.winner === 'home') === homeIsP1;
    if (p1Won) p1Wins += 1;
    else p2Wins += 1;
  }
}
export function simulateDuelSeries(
  input: DuelSimulationInput,
  context: EngineContext,
): DuelSimulationOutput {
  const games: GameResult[] = [];
  for (const event of duelGameEvents(input, context)) {
    games.push(event.game);
  }
  return summarizeDuelGames({
    games,
    p1TeamId: input.p1Team.teamId,
    p2TeamId: input.p2Team.teamId,
    p1PlayerIds: input.p1Team.players.map((player) => player.playerId),
    p2PlayerIds: input.p2Team.players.map((player) => player.playerId),
    rootSeed: input.rootSeed,
  });
}
