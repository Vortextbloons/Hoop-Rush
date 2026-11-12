import { deepStrictEqual } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildGameSimulationInput } from '../../packages/test-fixtures/src/index.ts';
import { createEngineContext } from '../../packages/engine/src/sim/kernel.ts';
import * as currentGame from '../../packages/engine/src/sim/wasm-game.ts';
import { gameWasmRuntime } from '../../packages/engine/src/sim/wasm-runtime.ts';
import { HavocBattleWasmSimulation } from '../../packages/engine/src/modes/havoc/core/battle-wasm.ts';
import { PARITY_SCENARIOS } from '../../packages/engine/src/modes/havoc/parity/scenario-inputs.ts';
import type { HavocBattleInput } from '../../packages/data-contracts/src/index.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'hoop-wasm-optimization-'));
if (dirname(temporary) !== resolve(tmpdir()))
  throw new Error('Unexpected benchmark temporary directory');
const baseline = process.env.HOOP_BENCH_BASE ?? 'HEAD';
const rounds = 15;
const rows: Array<{ workload: string; games: number; beforeMs: number; afterMs: number }> = [];
const original = (path: string): string =>
  execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, encoding: 'utf8' });

function baselineModule(path: string, overrides: Record<string, string> = {}): string {
  const source = original(path).replace(/from\s+'([^']+)'/g, (match: string, specifier: string) => {
    const target =
      overrides[specifier] ??
      (specifier === '@hoop-rush/data-contracts'
        ? join(root, 'packages/data-contracts/src/index.ts')
        : specifier.startsWith('.')
          ? resolve(root, dirname(path), specifier)
          : undefined);
    return target === undefined ? match : `from '${pathToFileURL(target).href}'`;
  });
  const target = join(temporary, path.split('/').at(-1)!);
  writeFileSync(target, source);
  return pathToFileURL(target).href;
}

function measure(
  workload: string,
  games: number,
  before: () => unknown,
  after: () => unknown,
): void {
  deepStrictEqual(after(), before());
  const samples: [number[], number[]] = [[], []];
  for (let round = -2; round < rounds; round++) {
    for (let offset = 0; offset < 2; offset++) {
      const side = (round + offset + 2) % 2;
      const run = side === 0 ? before : after;
      const start = performance.now();
      for (let game = 0; game < games; game++) run();
      if (round >= 0) samples[side as 0 | 1].push(performance.now() - start);
    }
  }
  const medians = samples.map((values) => values.sort((a, b) => a - b)[7]!);
  const row = { workload, games, beforeMs: medians[0]!, afterMs: medians[1]! };
  rows.push(row);
  console.log(JSON.stringify(row));
}

try {
  const oldGame = (await import(
    baselineModule('packages/engine/src/sim/wasm-game.ts')
  )) as typeof currentGame;
  const oldBytes = join(temporary, 'possession-wasm.gen.ts');
  writeFileSync(oldBytes, original('packages/engine/src/sim/wasm/possession-wasm.gen.ts'));
  const oldBattle = (await import(
    baselineModule('packages/engine/src/modes/havoc/core/battle-wasm.ts', {
      '../../../sim/wasm/possession-wasm.gen.ts': oldBytes,
    })
  )) as { HavocBattleWasmSimulation: typeof HavocBattleWasmSimulation };
  const context = createEngineContext();
  const input = buildGameSimulationInput();
  const prepared = currentGame.prepareWasmGame(input);
  const wasm = gameWasmRuntime();
  measure(
    'standard prepared result',
    1000,
    () => oldGame.simulateWasmGame(wasm, input, prepared, context),
    () => currentGame.simulateWasmGame(wasm, input, prepared, context),
  );
  for (const scenario of PARITY_SCENARIOS) {
    if (scenario.kind !== 'battle' || scenario.apron !== undefined) continue;
    const battle = scenario.build(scenario.seedText) as HavocBattleInput;
    measure(
      scenario.id,
      40,
      () => new oldBattle.HavocBattleWasmSimulation(battle, context).run(),
      () => new HavocBattleWasmSimulation(battle, context).run(),
    );
  }
  const output = process.argv[2] ?? join(tmpdir(), 'hoop-rush-optimization-results.json');
  writeFileSync(
    output,
    JSON.stringify(
      {
        baseline,
        baselineCommit: execFileSync('git', ['rev-parse', baseline], {
          cwd: root,
          encoding: 'utf8',
        }).trim(),
        bun: Bun.version,
        cpu: cpus()[0]?.model,
        rounds,
        parity: true,
        note: 'Alternating baseline/current in one Bun process. Standard includes result decoding; battles include preparation and raw decoding, excluding schema validation, audit and digests. No apron scenarios. Desktop timings only.',
        rows,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`wrote ${output}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
