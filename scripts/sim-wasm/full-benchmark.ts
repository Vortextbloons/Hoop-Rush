import { deepStrictEqual } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkGameResult,
  createEngineContext,
  createGameBatchSimulator,
  simulateGame,
} from '../../packages/engine/src/index.ts';
import {
  buildInput,
  fixtureSeed,
  listFixtureIds,
  loadFixture,
} from '../../tools/cli/src/commands/sim.ts';
import { loadPackagedData, PackagedData } from '../../tools/cli/src/commands/data-loader.ts';
import { leagueAverageTeam, poolStrengthLineups } from '../../tools/cli/src/commands/calibrate.ts';
import { prepareWasmGame, simulateWasmGame, type GameWasm } from './game.ts';

const temporary = mkdtempSync(join(tmpdir(), 'hoop-rush-full-wasm-'));
try {
  const binary = join(temporary, 'game.wasm');
  execFileSync('rustc', [
    fileURLToPath(new URL('./game.rs', import.meta.url)),
    '--edition=2024',
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
    '-C',
    'codegen-units=1',
    '-C',
    'strip=symbols',
    '-o',
    binary,
  ]);
  const bytes = readFileSync(binary);
  const startup = performance.now();
  const { instance } = await WebAssembly.instantiate(bytes);
  const initializationMs = performance.now() - startup;
  const wasm = instance.exports as unknown as GameWasm;
  deepStrictEqual(WebAssembly.Module.imports(new WebAssembly.Module(bytes)), []);
  deepStrictEqual(wasm.simulate(0, 0), 1);
  const packaged = loadPackagedData();
  const data = new PackagedData(packaged.manifest, packaged.dir);
  const profile = data.eraProfile();
  const context = createEngineContext();
  let parityGames = 0;
  let overtimeGames = 0;
  for (const fixtureId of listFixtureIds()) {
    const fixture = loadFixture(fixtureId);
    for (const variant of [false, true]) {
      const template = buildInput({ fixture, profile, seed: fixtureSeed(fixtureId, 0), variant });
      const prepared = prepareWasmGame(template);
      for (let i = 0; i < 100; i++) {
        const input = { ...template, seed: fixtureSeed(fixtureId, i) };
        const reference = simulateGame(input, context);
        const candidate = simulateWasmGame(wasm, input, prepared);
        try {
          deepStrictEqual(candidate, reference);
        } catch (error) {
          console.error(`Parity failed: ${fixtureId}, variant=${variant}, seed=${input.seed}`);
          throw error;
        }
        const accounting = checkGameResult(candidate);
        if (accounting.length > 0)
          throw new Error(`Accounting failed: ${JSON.stringify(accounting)}`);
        parityGames++;
        if (candidate.overtimePeriods > 0) overtimeGames++;
      }
    }
    console.log(`Parity: ${fixtureId} passed.`);
  }
  for (const era of ['1960s', '1990s', '2020s'] as const) {
    const pool = data.pool('lakers', era);
    const { strong, weak } = poolStrengthLineups(pool);
    const average = leagueAverageTeam(pool);
    for (const [home, away] of [
      [strong, weak],
      [average, average],
      [weak, strong],
    ] as const) {
      const template = {
        ...buildInput({
          fixture: loadFixture('equal'),
          profile,
          seed: fixtureSeed(era, 0),
          variant: false,
        }),
        home,
        away,
      };
      const prepared = prepareWasmGame(template);
      for (let i = 0; i < 200; i++) {
        const input = { ...template, seed: fixtureSeed(era, i) };
        const reference = simulateGame(input, context);
        const candidate = simulateWasmGame(wasm, input, prepared);
        deepStrictEqual(candidate, reference, `Pool parity: ${era}, seed=${input.seed}`);
        deepStrictEqual(checkGameResult(candidate), []);
        parityGames++;
        if (candidate.overtimePeriods > 0) overtimeGames++;
      }
    }
    console.log(`Parity: ${era} anchored/reconstructed player pools passed.`);
  }
  const matchups = ['equal', 'strong-medium', 'strong-weak'].map((id) => {
    const fixture = loadFixture(id);
    const input = buildInput({ fixture, profile, seed: fixtureSeed(id, 0), variant: false });
    return { input, prepared: prepareWasmGame(input), id };
  });
  const games = matchups.flatMap(({ input, prepared, id }) =>
    Array.from({ length: 300 }, (_, i) => ({
      input: { ...input, seed: fixtureSeed(id, i) },
      prepared,
    })),
  );
  const batch = createGameBatchSimulator(context);
  const backends = [
    {
      name: 'TypeScript simulateGame',
      run: (game: (typeof games)[number]) => simulateGame(game.input, context),
    },
    { name: 'TypeScript prepared batch', run: (game: (typeof games)[number]) => batch(game.input) },
    {
      name: 'Rust/Wasm full game (prepared)',
      run: (game: (typeof games)[number]) => simulateWasmGame(wasm, game.input, game.prepared),
    },
  ];
  for (const backend of backends) for (const game of games) backend.run(game);
  const samples = backends.map(() => [] as number[]);
  for (let round = 0; round < 15; round++) {
    for (let offset = 0; offset < backends.length; offset++) {
      const index = (round + offset) % backends.length;
      const start = performance.now();
      for (const game of games) backends[index]!.run(game);
      samples[index]!.push(performance.now() - start);
    }
  }
  const results = backends.map((backend, i) => {
    const sorted = samples[i]!.toSorted((a, b) => a - b);
    return {
      backend: backend.name,
      medianBatchMs: sorted[7]!,
      p95BatchMs: sorted[14]!,
      minBatchMs: sorted[0]!,
      gamesPerSecond: 900000 / sorted[7]!,
    };
  });
  const cold = matchups.map(({ input, id }) => {
    const timings = [[], []] as [number[], number[]];
    for (let round = 0; round < 30; round++) {
      for (let offset = 0; offset < 2; offset++) {
        const backend = (round + offset) % 2;
        const start = performance.now();
        if (backend === 0) simulateGame(input, context);
        else simulateWasmGame(wasm, input, prepareWasmGame(input));
        timings[backend]!.push(performance.now() - start);
      }
    }
    const median = (values: number[]) => {
      const sorted = values.toSorted((a, b) => a - b);
      return (sorted[14]! + sorted[15]!) / 2;
    };
    return {
      fixture: id,
      typescriptMs: median(timings[0]),
      wasmPreparationAndGameMs: median(timings[1]),
    };
  });
  const base = matchups[0]!.input;
  const opponents = Array.from({ length: 30 }, (_, i) => ({
    ...base.away,
    players: base.away.players.map((player) => ({
      ...player,
      ratings: {
        ...player.ratings,
        speed: Math.min(100, Math.max(0, player.ratings.speed + i - 15)),
      },
    })),
  }));
  const schedule = Array.from({ length: 82 }, (_, i) => ({
    ...base,
    away: opponents[i % 30]!,
    seed: fixtureSeed('wasm-season', i),
    gameNumber: i + 1,
  }));
  const schedulePreparation = opponents.map((away) => prepareWasmGame({ ...base, away }));
  schedule.forEach((input, i) => {
    const candidate = simulateWasmGame(wasm, input, schedulePreparation[i % 30]!);
    deepStrictEqual(candidate, simulateGame(input, context));
    deepStrictEqual(checkGameResult(candidate), []);
    parityGames++;
    if (candidate.overtimePeriods > 0) overtimeGames++;
  });
  const seasonSamples = [[], []] as [number[], number[]];
  for (let round = 0; round < 21; round++) {
    for (let offset = 0; offset < 2; offset++) {
      const backend = (round + offset) % 2;
      const start = performance.now();
      if (backend === 0) {
        const run = createGameBatchSimulator(context);
        for (const input of schedule) run(input);
      } else {
        const prepared = opponents.map((away) => prepareWasmGame({ ...base, away }));
        schedule.forEach((input, i) => simulateWasmGame(wasm, input, prepared[i % 30]!));
      }
      if (round > 0) seasonSamples[backend]!.push(performance.now() - start);
    }
  }
  const season82 = seasonSamples.map((samples, i) => {
    const sorted = samples.toSorted((a, b) => a - b);
    return {
      backend: i === 0 ? 'TypeScript prepared batch' : 'Rust/Wasm including preparation',
      medianMs: (sorted[9]! + sorted[10]!) / 2,
      p95Ms: sorted[18]!,
    };
  });
  const report = {
    runtime: process.version,
    bun: Bun.version,
    cpu: cpus()[0]?.model,
    platform: process.platform,
    arch: process.arch,
    wasmBytes: bytes.length,
    initializationMs,
    parityGames,
    overtimeGames,
    gamesPerBatch: games.length,
    rounds: 15,
    results,
    cold,
    season82,
    limitations: [
      'Standard fixed-five games only; Havoc/Cap Rush hooks and playback observers are not ported.',
      'TypeScript prepares immutable matchup probabilities and formats complete game results.',
      'Warm timings include input copying, Rust game execution, output decoding and facts.',
      'Cold measurements include probability-table preparation; compilation is excluded.',
      'Desktop Bun results are not mobile browser measurements.',
    ],
  };
  writeFileSync(
    new URL('../../sim-wasm-full-results.json', import.meta.url),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.table(results);
  console.table(cold);
  console.table(season82);
  console.log(
    JSON.stringify({ wasmBytes: bytes.length, initializationMs, parityGames, overtimeGames }),
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
