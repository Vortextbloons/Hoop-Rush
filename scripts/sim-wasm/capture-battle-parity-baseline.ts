import { writeFileSync } from 'node:fs';
import type { HavocBattleInput, HavocGameInput } from '../../packages/data-contracts/src/index.ts';
import { seedFromString } from '../../packages/data-contracts/src/index.ts';
import {
  apronTargetOf,
  PARITY_SCENARIOS,
  searchSeed,
  type ParityScenario,
} from '../../packages/engine/src/modes/havoc/parity/scenario-inputs.ts';
import {
  outputFeatures,
  outputHashes,
  outputSummary,
  type SimulatedOutput,
} from '../../packages/engine/src/modes/havoc/parity/output-snapshot.ts';
import { createEngineContext } from './legacy-runtime/sim/kernel.ts';
import {
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
  havocBattleGameTapeDigest,
} from './legacy-runtime/modes/havoc/core/battle-digests.ts';
import { simulateAuditedHavocBattleGame } from './legacy-runtime/modes/havoc/core/battle-game.ts';
import { simulateAuditedHavocGame } from './legacy-runtime/modes/havoc/solo/simulate.ts';
import { CapRushApronRuntime } from './legacy-runtime/modes/cap-rush/apron-runtime.ts';

const SEARCH_LIMITS: Record<string, number> = {
  overtime: 384,
  'foul-out': 96,
  'clone-entered': 64,
  'clone-exited': 64,
  fusion: 64,
};

interface ApronBinding {
  readonly runtime: CapRushApronRuntime;
}

function bindApron(scenario: ParityScenario, input: HavocBattleInput): ApronBinding | null {
  if (scenario.apron === undefined) return null;
  const target = apronTargetOf(input, scenario);
  const runtime = new CapRushApronRuntime({
    side: scenario.apron.side,
    rules: { payrollStatus: scenario.apron.payrollStatus },
    targetInstanceId: target.participant.instanceId,
    targetSlot: scenario.apron.targetSlot,
  });
  runtime.bindTarget({
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
  return { runtime };
}

interface CapturedGame {
  readonly output: SimulatedOutput;
  readonly facts: unknown[];
  readonly inputDigest: string;
  readonly resultDigest: string;
  readonly tapeDigest: string;
}

function simulate(
  scenario: ParityScenario,
  input: HavocGameInput | HavocBattleInput,
): CapturedGame {
  const context = createEngineContext();
  if (scenario.kind === 'solo') {
    const output = simulateAuditedHavocGame(input as HavocGameInput, context);
    return {
      output: { result: output.result, tape: output.tape, audit: output.audit, facts: [] },
      facts: [],
      inputDigest: '',
      resultDigest: '',
      tapeDigest: '',
    };
  }
  const battle = input as HavocBattleInput;
  const apron = bindApron(scenario, battle);
  const output = simulateAuditedHavocBattleGame(
    battle,
    context,
    apron === null ? {} : { apron: apron.runtime },
  );
  const facts = apron?.runtime.recordedFacts() ?? [];
  return {
    output: { result: output.result, tape: output.tape, audit: output.audit, facts },
    facts,
    inputDigest: havocBattleGameInputDigest(battle),
    resultDigest: havocBattleGameResultDigest(output.result),
    tapeDigest: havocBattleGameTapeDigest(output.tape),
  };
}

function missingFeatures(scenario: ParityScenario, output: SimulatedOutput): string[] {
  const found = outputFeatures(output);
  return scenario.features.filter((feature) => !found.has(feature));
}

interface CapturedScenario {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly seedText: string;
  readonly seed: string;
  readonly apron: ParityScenario['apron'] | null;
  readonly expected: ReturnType<typeof expectedOf>;
}

function expectedOf(captured: CapturedGame, output: SimulatedOutput) {
  return {
    ...outputHashes(output),
    summary: outputSummary(output),
    inputDigest: captured.inputDigest,
    resultDigest: captured.resultDigest,
    tapeDigest: captured.tapeDigest,
    features: [...outputFeatures(output)].sort(),
  };
}

function captureScenario(scenario: ParityScenario): CapturedScenario {
  const seedsToTry = scenario.features.length === 0 ? [scenario.seedText] : [scenario.seedText];
  let chosenSeed = seedsToTry[0] ?? scenario.seedText;
  let captured: CapturedGame | null = null;

  if (scenario.features.length === 0) {
    captured = simulate(scenario, scenario.build(chosenSeed));
  } else {
    const limit = Math.max(...scenario.features.map((feature) => SEARCH_LIMITS[feature] ?? 64));
    let found = false;
    for (let index = 0; index < limit; index += 1) {
      const seedText = searchSeed(scenario.seedText.replace(/-\d+$/, ''), index);
      const candidate = simulate(scenario, scenario.build(seedText));
      if (missingFeatures(scenario, candidate.output).length === 0) {
        chosenSeed = seedText;
        captured = candidate;
        found = true;
        break;
      }
    }
    if (!found) {
      throw new Error(
        `${scenario.id}: no seed within ${String(limit)} produced ${scenario.features.join(', ')}`,
      );
    }
  }
  if (captured === null) throw new Error(`${scenario.id}: capture failed`);
  const missing = missingFeatures(scenario, captured.output);
  if (missing.length > 0) {
    throw new Error(`${scenario.id}: missing features ${missing.join(', ')}`);
  }
  return {
    id: scenario.id,
    label: scenario.label,
    kind: scenario.kind,
    seedText: chosenSeed,
    seed: seedFromString(chosenSeed),
    apron: scenario.apron ?? null,
    expected: expectedOf(captured, captured.output),
  };
}

const scenarios = PARITY_SCENARIOS.map(captureScenario);
const fixture = {
  note: 'Captured from the frozen pre-migration TypeScript battle/possession runtime. Hashes use the reference canonical JSON implementation, not the Wasm serializer. Regenerate only when intentional rule changes land.',
  baseline: {
    commit: process.env.HOOP_BASELINE_COMMIT ?? '',
    capturedAt: new Date().toISOString(),
    runtime: 'TypeScript battle core + shared possession runtime (frozen copy)',
    serializer: 'reference canonicalJson + seasonDigestHex',
  },
  scenarios,
};

const out = process.argv[2];
if (out === undefined)
  throw new Error('usage: bun capture-battle-parity-baseline.ts <output.json>');
writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(
  JSON.stringify(
    scenarios.map((scenario) => ({
      id: scenario.id,
      seed: scenario.seedText,
      features: scenario.expected.features,
      score: [scenario.expected.summary.homePoints, scenario.expected.summary.awayPoints],
    })),
    null,
    2,
  ),
);
