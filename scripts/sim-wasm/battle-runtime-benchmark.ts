import { deepStrictEqual } from 'node:assert';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus, platform, release, arch } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HavocBattleInput, HavocGameInput } from '../../packages/data-contracts/src/index.ts';
import {
  apronTargetOf,
  PARITY_SCENARIOS,
  type ParityScenario,
} from '../../packages/engine/src/modes/havoc/parity/scenario-inputs.ts';
import {
  outputHashes,
  outputFeatures,
  type OutputHashes,
  type SimulatedOutput,
} from '../../packages/engine/src/modes/havoc/parity/output-snapshot.ts';
import { createEngineContext as createLegacyContext } from './legacy-runtime/sim/kernel.ts';
import { CapRushApronRuntime as LegacyApron } from './legacy-runtime/modes/cap-rush/apron-runtime.ts';
import { simulateAuditedHavocBattleGame as simulateLegacyBattle } from './legacy-runtime/modes/havoc/core/battle-game.ts';
import { simulateAuditedHavocGame as simulateLegacySolo } from './legacy-runtime/modes/havoc/solo/simulate.ts';
import { createEngineContext as createCurrentContext } from '../../packages/engine/src/sim/kernel.ts';
import { CapRushApronRuntime as CurrentApron } from '../../packages/engine/src/modes/cap-rush/apron-runtime.ts';
import { simulateAuditedHavocBattleGame as simulateCurrentBattle } from '../../packages/engine/src/modes/havoc/core/battle-game.ts';
import { simulateAuditedHavocGame as simulateCurrentSolo } from '../../packages/engine/src/modes/havoc/solo/simulate.ts';
import {
  havocBattleGameResultDigest,
  havocBattleGameTapeDigest,
} from '../../packages/engine/src/modes/havoc/core/battle-digests.ts';

/**
 * Compares the frozen pre-migration TypeScript battle runtime with the live
 * production battle runtime on identical inputs. Parity is checked with the
 * reference canonical serializer before any timing. Timed work includes the
 * simulation, audit, and the same production digest functions on both sides.
 */

const GAMES_PER_ROUND = Number(process.env.HOOP_BENCH_GAMES ?? 6);
const ROUNDS = Number(process.env.HOOP_BENCH_ROUNDS ?? 9);
if (!Number.isInteger(GAMES_PER_ROUND) || GAMES_PER_ROUND < 1) {
  throw new Error('HOOP_BENCH_GAMES must be a positive integer');
}
if (!Number.isInteger(ROUNDS) || ROUNDS < 3) {
  throw new Error('HOOP_BENCH_ROUNDS must be an integer >= 3');
}

type RuntimeName = 'legacy-ts' | 'current';

interface Runtime {
  readonly name: RuntimeName;
  readonly battle: typeof simulateLegacyBattle;
  readonly solo: typeof simulateLegacySolo;
  readonly context: ReturnType<typeof createLegacyContext>;
  readonly apron: typeof LegacyApron;
}

const legacyRuntime: Runtime = {
  name: 'legacy-ts',
  battle: simulateLegacyBattle,
  solo: simulateLegacySolo,
  context: createLegacyContext(),
  apron: LegacyApron,
};

const currentRuntime: Runtime = {
  name: 'current',
  battle: simulateCurrentBattle,
  solo: simulateCurrentSolo,
  context: createCurrentContext(),
  apron: CurrentApron,
};

function bindApron(
  runtime: Runtime,
  scenario: ParityScenario,
  input: HavocBattleInput,
): InstanceType<typeof LegacyApron> | null {
  if (scenario.apron === undefined) return null;
  const target = apronTargetOf(input, scenario);
  const apron = new runtime.apron({
    side: scenario.apron.side,
    rules: { payrollStatus: scenario.apron.payrollStatus },
    targetInstanceId: target.participant.instanceId,
    targetSlot: scenario.apron.targetSlot,
  });
  apron.bindTarget({
    playerId: target.participant.source.playerId,
    ...(target.participant.source.playerVersionId === null
      ? {}
      : { playerVersionId: target.participant.source.playerVersionId }),
    displayName: target.participant.source.displayName,
    positions: target.participant.source.positions,
    heightInches: target.participant.effective.physical.heightInches,
    weightLbs: target.participant.effective.physical.weightLbs,
    ratings: target.participant.effective.ratings,
    tendencies: target.participant.effective.tendencies,
  });
  return apron;
}

interface RunOutput {
  readonly output: SimulatedOutput;
  readonly facts: readonly unknown[];
}

interface OutputDigests {
  readonly resultDigest: string;
  readonly tapeDigest: string;
}

function sharedDigests(output: SimulatedOutput): OutputDigests {
  return {
    resultDigest: havocBattleGameResultDigest(output.result as never),
    tapeDigest: havocBattleGameTapeDigest(output.tape as never),
  };
}

function runScenario(runtime: Runtime, scenario: ParityScenario): RunOutput {
  const input = scenario.build(scenario.seedText);
  if (scenario.kind === 'solo') {
    const output = runtime.solo(input as HavocGameInput, runtime.context);
    return {
      output: { result: output.result, tape: output.tape, audit: output.audit, facts: [] },
      facts: [],
    };
  }
  const battle = input as HavocBattleInput;
  const apron = bindApron(runtime, scenario, battle);
  const output = runtime.battle(battle, runtime.context, apron === null ? {} : { apron });
  const facts = apron?.recordedFacts() ?? [];
  return {
    output: { result: output.result, tape: output.tape, audit: output.audit, facts },
    facts,
  };
}

/** Timed body: simulation + audit + the shared production digest pair. */
function runTimed(
  runtime: Runtime,
  scenario: ParityScenario,
  input: HavocGameInput | HavocBattleInput,
): string {
  if (scenario.kind === 'solo') {
    const output = runtime.solo(input as HavocGameInput, runtime.context);
    return `${havocBattleGameResultDigest(output.result)}:${havocBattleGameTapeDigest(output.tape)}`;
  }
  const battle = input as HavocBattleInput;
  const apron = bindApron(runtime, scenario, battle);
  const output = runtime.battle(battle, runtime.context, apron === null ? {} : { apron });
  return `${havocBattleGameResultDigest(output.result)}:${havocBattleGameTapeDigest(output.tape)}`;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

interface BenchmarkRow {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly seed: string;
  readonly apron: ParityScenario['apron'] | null;
  readonly parity: boolean;
  readonly legacy: OutputHashes | null;
  readonly current: OutputHashes | null;
  readonly legacyDigests: OutputDigests | null;
  readonly currentDigests: OutputDigests | null;
  readonly legacyMs: number;
  readonly currentMs: number;
  readonly speedup: number | null;
  readonly currentChanged: boolean;
}

const legacyRoot = fileURLToPath(new URL('./legacy-runtime', import.meta.url));
const productionRoot = fileURLToPath(new URL('../../packages/engine/src', import.meta.url));

function tsFilesUnder(root: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (statSync(full).isDirectory()) {
      files.push(...tsFilesUnder(full));
    } else if (name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

/** Ignores import plumbing, which necessarily differs for the standalone copy. */
function normalizeRuntimeSource(source: string): string {
  return source
    .replace(/\bimport\s+(?:type\s+)?[\s\S]*?from\s+['"][^'"]+['"]\s*;?/g, '')
    .replace(/\bexport\s+(?:type\s+)?\{[\s\S]*?\}\s*from\s+['"][^'"]+['"]\s*;?/g, '')
    .replace(/\bexport\s+\*\s+from\s+['"][^'"]+['"]\s*;?/g, '')
    .replace(/\s+/g, '');
}

function runtimeIdentity(): {
  readonly currentMatchesFrozenRuntime: boolean;
  readonly havocChanged: boolean;
  readonly apronChanged: boolean;
  readonly comparedFiles: number;
  readonly changedFiles: readonly string[];
} {
  const changed: string[] = [];
  const files = tsFilesUnder(legacyRoot);
  for (const legacyFile of files) {
    const relativePath = legacyFile.slice(legacyRoot.length + 1).replaceAll('\\', '/');
    const productionFile = join(productionRoot, relativePath);
    try {
      const legacy = normalizeRuntimeSource(readFileSync(legacyFile, 'utf8'));
      const production = normalizeRuntimeSource(readFileSync(productionFile, 'utf8'));
      if (legacy !== production) changed.push(relativePath);
    } catch {
      changed.push(relativePath);
    }
  }
  return {
    currentMatchesFrozenRuntime: changed.length === 0,
    havocChanged: changed.some((file) => !file.startsWith('modes/cap-rush/')),
    apronChanged: changed.some((file) => file.startsWith('modes/cap-rush/')),
    comparedFiles: files.length,
    changedFiles: changed,
  };
}

const identity = runtimeIdentity();

const rows: BenchmarkRow[] = [];
let parityFailures = 0;

for (const scenario of PARITY_SCENARIOS) {
  const input = scenario.build(scenario.seedText);
  const legacy = runScenario(legacyRuntime, scenario);
  const current = runScenario(currentRuntime, scenario);
  for (const feature of scenario.features) {
    if (
      !outputFeatures(legacy.output).has(feature) ||
      !outputFeatures(current.output).has(feature)
    ) {
      throw new Error(`${scenario.id}: benchmark input does not exercise ${feature}`);
    }
  }
  const legacyHashes = outputHashes(legacy.output);
  const currentHashes = outputHashes(current.output);
  const legacyDigests = sharedDigests(legacy.output);
  const currentDigests = sharedDigests(current.output);
  let parity = true;
  try {
    deepStrictEqual(current.output, legacy.output);
    deepStrictEqual(currentDigests, legacyDigests);
  } catch (error) {
    parity = false;
    console.error(`${scenario.id}: complete output parity failed`, error);
  }
  if (!parity) parityFailures += 1;

  // Warm both paths once so lazy Wasm/module initialization is outside the median.
  runTimed(legacyRuntime, scenario, input);
  runTimed(currentRuntime, scenario, input);

  const legacyTimes: number[] = [];
  const currentTimes: number[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    for (let offset = 0; offset < 2; offset += 1) {
      const order = (round + offset) % 2;
      const runtime = order === 0 ? legacyRuntime : currentRuntime;
      const start = performance.now();
      for (let game = 0; game < GAMES_PER_ROUND; game += 1) {
        runTimed(runtime, scenario, input);
      }
      const elapsed = performance.now() - start;
      (order === 0 ? legacyTimes : currentTimes).push(elapsed);
    }
  }

  const legacyMs = median(legacyTimes);
  const currentMs = median(currentTimes);
  const currentChanged =
    scenario.apron === undefined
      ? identity.havocChanged
      : identity.havocChanged || identity.apronChanged;
  const speedup = parity && currentChanged && currentMs > 0 ? legacyMs / currentMs : null;
  rows.push({
    id: scenario.id,
    label: scenario.label,
    kind: scenario.kind,
    seed: scenario.seedText,
    apron: scenario.apron ?? null,
    parity,
    legacy: legacyHashes,
    current: currentHashes,
    legacyDigests,
    currentDigests,
    legacyMs,
    currentMs,
    speedup,
    currentChanged,
  });
  console.log(
    JSON.stringify({
      id: scenario.id,
      parity,
      legacyMs: Number(legacyMs.toFixed(2)),
      currentMs: Number(currentMs.toFixed(2)),
      speedup: speedup === null ? null : Number(speedup.toFixed(2)),
    }),
  );
}

const results = {
  note: identity.currentMatchesFrozenRuntime
    ? 'PENDING: the live production battle/possession sources still match the frozen pre-migration runtime, so there is no migration speedup to report. Speedups are withheld (null). Re-run after the production port lands.'
    : !identity.havocChanged
      ? 'PARTIAL: the Havoc/shared-possession port has not changed the compared sources, so Havoc speedups are withheld (null). Cap Rush rows only use the current production apron runtime.'
      : parityFailures === 0
        ? 'Legacy = frozen pre-migration TypeScript battle/possession runtime. Current = live production runtime. Both sides use the same production digest/serializer functions inside the timed section, and parity is checked first with the reference canonical serializer.'
        : 'PARITY FAILURE: at least one scenario produced different result/tape/audit/facts hashes. Speedups are withheld (null) for failing rows. Do not publish these numbers.',
  capturedAt: new Date().toISOString(),
  metadata: {
    bun: Bun.version,
    node: process.version,
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    parallelism: availableParallelism(),
    runtimeIdentity: identity,
  },
  rounds: ROUNDS,
  gamesPerRound: GAMES_PER_ROUND,
  parity: parityFailures === 0,
  rows,
};

const out = process.argv[2] ?? 'sim-wasm-battle-runtime-results.json';
writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
console.log(`wrote ${out}`);
if (parityFailures > 0) {
  throw new Error(`${String(parityFailures)} parity failure(s); speedups withheld`);
}
