import type { DraftDuelTapeStatLine } from '@hoop-rush/data-contracts';
import type { GameObservers } from './game.ts';
import type { Rng } from './rng.ts';
import type { GameWasm, PreparedWasmGame } from './wasm-game.ts';
import { GAME_WASM_BYTES } from './wasm/game-wasm.gen.ts';

let module: WebAssembly.Module | undefined;
let shared: GameWasm | undefined;

export function gameWasmRuntime(
  observers?: GameObservers,
  rng?: Rng,
  prepared?: PreparedWasmGame,
): GameWasm {
  if (observers === undefined && rng === undefined && shared !== undefined) return shared;
  module ??= new WebAssembly.Module(GAME_WASM_BYTES);
  let wasm: GameWasm;
  const instance = new WebAssembly.Instance(module, {
    env: {
      rng_next: () => {
        if (rng === undefined) throw new Error('simulation: missing injected RNG');
        return rng.next();
      },
      rng_chance: (probability: number) => {
        if (rng === undefined) throw new Error('simulation: missing injected RNG');
        return rng.chance(probability) ? 1 : 0;
      },
      rng_pick: (pointer: number, length: number) => {
        const table = prepared?.pickTables.get((pointer - wasm.input_ptr()) / 8);
        if (rng === undefined || table === undefined || table.items.length + 1 !== length) {
          throw new Error('simulation: missing injected pick table');
        }
        const selected = rng.weightedPickTable(table.items, table.table);
        const index = table.items.indexOf(selected);
        if (index < 0) throw new Error('simulation: injected RNG returned an unknown item');
        return index;
      },
      observe: (
        kind: number,
        period: number,
        offense: 0 | 1,
        clockSeconds: number,
        secondsElapsed: number,
        ended: number,
      ) => {
        const output = new Float64Array(wasm.memory.buffer, wasm.output_ptr(), 481);
        const homeScore = output[1] ?? 0;
        const awayScore = output[241] ?? 0;
        if (kind === 2) {
          observers?.onPeriod?.({ period, homeScore, awayScore });
          return;
        }
        const line = (offset: number, team: boolean): DraftDuelTapeStatLine =>
          [
            ...Array.from(output.subarray(offset, offset + 14)),
            team ? (output[offset + 14] ?? 0) : 0,
          ] as DraftDuelTapeStatLine;
        observers?.onTrip?.({
          period,
          offense,
          clockSeconds,
          secondsElapsed,
          ended: ended !== 0,
          homeScore,
          awayScore,
          homeLines: Array.from({ length: 5 }, (_, i) => line(36 + i * 35, false)),
          awayLines: Array.from({ length: 5 }, (_, i) => line(276 + i * 35, false)),
          homeTeamLine: line(1, true),
          awayTeamLine: line(241, true),
        });
      },
    },
  });
  wasm = instance.exports as unknown as GameWasm;
  if (observers === undefined && rng === undefined) shared = wasm;
  return wasm;
}
