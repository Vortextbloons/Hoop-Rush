import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepStrictEqual } from 'node:assert';
import { createEngineContext } from '../../packages/engine/src/index.ts';
import { simulateGame } from '../../packages/engine/src/archive/code/sim/game.ts';
import {
  createRng,
  fnv1a32,
  type Rng,
  type WeightedPickTable,
} from '../../packages/engine/src/sim/rng.ts';
import { buildInput, fixtureSeed, loadFixture } from '../../tools/cli/src/commands/sim.ts';
import { loadPackagedData, PackagedData } from '../../tools/cli/src/commands/data-loader.ts';

const temporary = mkdtempSync(join(tmpdir(), 'hoop-rush-wasm-'));
try {
  const binary = join(temporary, 'rng.wasm');
  execFileSync('rustc', [
    fileURLToPath(new URL('./rng.rs', import.meta.url)),
    '--crate-type',
    'cdylib',
    '--target',
    'wasm32-unknown-unknown',
    '-C',
    'opt-level=3',
    '-C',
    'lto=fat',
    '-C',
    'panic=abort',
    '-o',
    binary,
  ]);
  const bytes = readFileSync(binary);
  const started = performance.now();
  const { instance } = await WebAssembly.instantiate(bytes);
  const wasm = instance.exports as unknown as {
    memory: WebAssembly.Memory;
    output_ptr(): number;
    fill(state: number, count: number): number;
  };
  const initializationMs = performance.now() - started;
  function factory(size: number): (seed: string) => Rng {
    return (seed) => {
      let state = fnv1a32(seed);
      let cursor = size;
      const buffer = new Float64Array(size);
      const next = () => {
        if (cursor === size) {
          state = wasm.fill(state, size);
          buffer.set(new Float64Array(wasm.memory.buffer, wasm.output_ptr(), size));
          cursor = 0;
        }
        return buffer[cursor++]!;
      };
      const pickTable = <T>(items: readonly T[], table: WeightedPickTable): T => {
        if (items.length === 0) throw new Error('empty items');
        if (table.total <= 0) return api.pick(items);
        let roll = next() * table.total;
        for (let i = 0; i < items.length; i++) {
          const weight = table.weights[i] ?? 0;
          if (roll < weight) return items[i]!;
          roll -= weight;
        }
        return items[items.length - 1]!;
      };
      const api: Rng = {
        next,
        chance: (p) => (p <= 0 ? false : p >= 1 ? true : next() < p),
        nextInt: (min, max) => {
          if (max < min) throw new Error('invalid range');
          return max === min ? min : Math.floor(next() * (max - min + 1)) + min;
        },
        pick: (items) => {
          if (!items.length) throw new Error('empty items');
          return items[api.nextInt(0, items.length - 1)]!;
        },
        weightedPickTable: pickTable,
        weightedPick: (items, weights) => {
          if ('total' in weights) return pickTable(items, weights);
          if (items.length !== weights.length) throw new Error('length mismatch');
          const clamped = weights.map((w) => {
            if (!Number.isFinite(w)) throw new Error('invalid weight');
            return Math.max(0, w);
          });
          return pickTable(items, { weights: clamped, total: clamped.reduce((a, b) => a + b, 0) });
        },
      };
      return api;
    };
  }
  const packaged = loadPackagedData();
  const profile = new PackagedData(packaged.manifest, packaged.dir).eraProfile();
  const inputs = ['equal', 'strong-medium', 'strong-weak'].flatMap((id) => {
    const fixture = loadFixture(id);
    return Array.from({ length: 300 }, (_, i) =>
      buildInput({ fixture, profile, seed: fixtureSeed(id, i), variant: false }),
    );
  });
  const variants = [
    { name: 'TypeScript', context: createEngineContext() },
    ...[1, 64, 256, 1024, 4096].map((size) => ({
      name: `Rust/Wasm RNG ${size}`,
      context: createEngineContext({ rngFactory: factory(size) }),
    })),
  ];
  for (const size of [1, 64, 256, 1024, 4096]) {
    const reference = createRng('parity-🏀');
    const candidate = factory(size)('parity-🏀');
    for (let i = 0; i < 20000; i++) deepStrictEqual(candidate.next(), reference.next());
  }
  const referenceResults = inputs.map((input) => simulateGame(input, variants[0]!.context));
  for (const variant of variants.slice(1)) {
    inputs.forEach((input, i) =>
      deepStrictEqual(simulateGame(input, variant.context), referenceResults[i]),
    );
  }
  console.log(
    `Parity passed: ${inputs.length} complete game results per backend; 20,000 RNG draws per buffer size.`,
  );
  const samples = variants.map(() => [] as number[]);
  for (let round = 0; round < 12; round++) {
    for (let offset = 0; offset < variants.length; offset++) {
      const index = (round + offset) % variants.length;
      const variant = variants[index]!;
      const start = performance.now();
      for (const input of inputs) simulateGame(input, variant.context);
      samples[index]!.push(performance.now() - start);
    }
  }
  const results = variants.map((variant, i) => {
    const sorted = samples[i]!.toSorted((a, b) => a - b);
    return {
      backend: variant.name,
      medianBatchMs: (sorted[5]! + sorted[6]!) / 2,
      minBatchMs: sorted[0],
      maxBatchMs: sorted.at(-1),
    };
  });
  const report = {
    runtime: process.version,
    bun: Bun.version,
    gamesPerBatch: inputs.length,
    rounds: 12,
    wasmBytes: bytes.length,
    initializationMs,
    parity: 'passed',
    results,
  };
  writeFileSync(
    new URL('../../sim-wasm-results.json', import.meta.url),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.table(results);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
