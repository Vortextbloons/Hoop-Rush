import { deepStrictEqual } from 'node:assert';
import { writeFileSync } from 'node:fs';
import {
  buildGameSimulationInput,
  seedFromString,
} from '../../packages/test-fixtures/src/index.ts';
import { seedSchema } from '../../packages/data-contracts/src/index.ts';
import { createEngineContext } from '../../packages/engine/src/sim/kernel.ts';
import { simulateRecordedGame as before } from '../../packages/engine/src/archive/code/sim/tape.ts';
import { simulateRecordedGame as after } from '../../packages/engine/src/sim/tape.ts';
const context = createEngineContext();
const inputs = Array.from({ length: 200 }, (_, i) =>
  buildGameSimulationInput({ seed: seedSchema.parse(seedFromString(`recording-${i}`)) }),
);
for (const input of inputs) deepStrictEqual(after(input, context), before(input, context));
const times: number[][] = [[], []];
for (let round = 0; round < 11; round++)
  for (let offset = 0; offset < 2; offset++) {
    const backend = (round + offset) % 2;
    const run = [before, after][backend]!;
    const start = performance.now();
    for (const input of inputs) run(input, context);
    times[backend]!.push(performance.now() - start);
  }
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const beforeMs = median(times[0]!);
const afterMs = median(times[1]!);
const result = {
  games: inputs.length,
  rounds: 11,
  parity: true,
  beforeMs,
  afterMs,
  speedup: beforeMs / afterMs,
  reductionPercent: (1 - afterMs / beforeMs) * 100,
  runtime: Bun.version,
};
writeFileSync('sim-wasm-recording-results.json', JSON.stringify(result, null, 2));
console.log(result);
