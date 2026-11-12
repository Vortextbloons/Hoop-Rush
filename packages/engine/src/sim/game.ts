import type {
  DraftDuelTapeStatLine,
  GameResult,
  GameSimulationInput,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from './kernel.ts';
import { createRng } from './rng.ts';
import {
  prepareWasmGame,
  simulateWasmGame,
  type PreparedWasmGame,
  type TeamPrepCache,
} from './wasm-game.ts';
import { gameWasmRuntime } from './wasm-runtime.ts';
import type { SideIndex } from './recorder.ts';

export interface TripObservation {
  period: number;
  offense: SideIndex;
  clockSeconds: number;
  secondsElapsed: number;
  ended: boolean;
  homeScore: number;
  awayScore: number;
  homeLines: readonly DraftDuelTapeStatLine[];
  awayLines: readonly DraftDuelTapeStatLine[];
  homeTeamLine: DraftDuelTapeStatLine;
  awayTeamLine: DraftDuelTapeStatLine;
}
export interface PeriodObservation {
  period: number;
  homeScore: number;
  awayScore: number;
}
export interface GameObservers {
  onTrip?: (observation: TripObservation) => void;
  onPeriod?: (observation: PeriodObservation) => void;
}

function simulatePreparedGame(
  input: GameSimulationInput,
  context: EngineContext,
  prepared: PreparedWasmGame,
  observers?: GameObservers,
): GameResult {
  const external = context.rngFactory !== createRng;
  const rng = external ? context.rngFactory(input.seed) : undefined;
  const mask =
    (observers?.onTrip === undefined ? 0 : 1) | (observers?.onPeriod === undefined ? 0 : 2);
  const wasm = gameWasmRuntime(observers, rng, prepared);
  return simulateWasmGame(wasm, input, prepared, context, external, mask);
}
export function simulateGame(
  input: GameSimulationInput,
  context: EngineContext,
  observers?: GameObservers,
): GameResult {
  return simulatePreparedGame(
    input,
    context,
    prepareWasmGame(input, context.rngFactory !== createRng),
    observers,
  );
}
export function createGameBatchSimulator(
  context: EngineContext,
): (input: GameSimulationInput, observers?: GameObservers) => GameResult {
  type Players = SimulationTeam['players'];
  const profiles = new WeakMap<
    GameSimulationInput['profile'],
    WeakMap<Players, WeakMap<Players, PreparedWasmGame>>
  >();
  const teamPreps: TeamPrepCache = new WeakMap();
  return (input, observers) => {
    let homes = profiles.get(input.profile);
    if (homes === undefined) {
      homes = new WeakMap();
      profiles.set(input.profile, homes);
    }
    let opponents = homes.get(input.home.players);
    if (opponents === undefined) {
      opponents = new WeakMap();
      homes.set(input.home.players, opponents);
    }
    let prepared = opponents.get(input.away.players);
    if (prepared === undefined) {
      prepared = prepareWasmGame(input, context.rngFactory !== createRng, teamPreps);
      opponents.set(input.away.players, prepared);
    }
    return simulatePreparedGame(input, context, prepared, observers);
  };
}
