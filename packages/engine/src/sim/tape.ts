import type {
  DraftDuelTapeEvent,
  DraftDuelTapeStatLine,
  GameResult,
  GameSimulationInput,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from './kernel.ts';
import { createRng } from './rng.ts';
import { prepareWasmGame, simulateWasmGame } from './wasm-game.ts';
import { gameWasmRuntime } from './wasm-runtime.ts';

export interface RecordedGameOutput {
  result: GameResult;
  tape: DraftDuelTapeEvent[];
}
export function simulateRecordedGame(
  input: GameSimulationInput,
  context: EngineContext,
): RecordedGameOutput {
  const external = context.rngFactory !== createRng;
  const prepared = prepareWasmGame(input, external);
  const wasm = gameWasmRuntime({}, external ? context.rngFactory(input.seed) : undefined, prepared);
  const result = simulateWasmGame(wasm, input, prepared, context, external, 4);
  const data = new Float64Array(wasm.memory.buffer, wasm.tape_ptr(), wasm.tape_len());
  const tape: DraftDuelTapeEvent[] = [];
  let cursor = 0;
  const next = () => data[cursor++] ?? 0;
  const line = () => {
    const value = new Array<number>(15) as DraftDuelTapeStatLine;
    for (let field = 0; field < 15; field++) value[field] = data[cursor + field] ?? 0;
    cursor += 15;
    return value;
  };
  while (cursor < data.length) {
    const kind = next();
    const period = next();
    const offense = next() as 0 | 1;
    const clockSeconds = next();
    const secondsElapsed = next();
    const ended = next() !== 0;
    const homeScore = next();
    const awayScore = next();
    const index = tape.length;
    if (kind === 2) {
      tape.push({ kind: 'period', index, period, homeScore, awayScore });
    } else {
      const homeTeamDeltas = line();
      const homeDeltas = Array.from({ length: 5 }, line);
      const awayTeamDeltas = line();
      const awayDeltas = Array.from({ length: 5 }, line);
      tape.push({
        kind: 'trip',
        index,
        period,
        offense,
        clockSeconds,
        secondsElapsed,
        ended,
        homeScore,
        awayScore,
        homeTeamDeltas,
        homeDeltas,
        awayTeamDeltas,
        awayDeltas,
      });
    }
  }
  return { result, tape };
}
