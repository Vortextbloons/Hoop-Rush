import { describe, expect, it } from 'bun:test';
import type { HavocBattleInput, HavocGameInput } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../../sim/kernel.ts';
import { CapRushApronRuntime } from '../../cap-rush/apron-runtime.ts';
import {
  apronTargetOf,
  PARITY_SCENARIOS,
  type ParityApron,
  type ParityScenario,
} from './scenario-inputs.ts';
import {
  outputFeatures,
  outputHashes,
  outputSummary,
  type SimulatedOutput,
} from './output-snapshot.ts';
import {
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
  havocBattleGameTapeDigest,
} from '../core/battle-digests.ts';
import { simulateAuditedHavocBattleGame } from '../core/battle-game.ts';
import { simulateAuditedHavocGame } from '../solo/simulate.ts';
import fixtureJson from './fixtures/battle-parity.golden.json';

interface GoldenScenario {
  readonly id: string;
  readonly seedText: string;
  readonly kind: 'solo' | 'battle';
  readonly apron: ParityApron | null;
  readonly expected: {
    readonly resultHash: string;
    readonly tapeHash: string;
    readonly auditHash: string;
    readonly factsHash: string;
    readonly inputDigest: string;
    readonly resultDigest: string;
    readonly tapeDigest: string;
    readonly features: readonly string[];
    readonly summary: {
      readonly homePoints: number;
      readonly awayPoints: number;
      readonly overtimePeriods: number;
      readonly tapeEvents: number;
      readonly tapeScoring: number;
      readonly auditOk: boolean;
      readonly findingCodes: readonly string[];
      readonly facts: number;
    };
  };
}

interface GoldenFixture {
  readonly scenarios: readonly GoldenScenario[];
}

const fixture = fixtureJson as GoldenFixture;

function buildInput(golden: GoldenScenario): HavocGameInput | HavocBattleInput {
  return buildScenario(golden).build(golden.seedText);
}

function buildScenario(golden: GoldenScenario): ParityScenario {
  const scenario = SCENARIOS_BY_ID[golden.id];
  if (scenario === undefined) throw new Error(`missing live scenario ${golden.id}`);
  return scenario;
}

const SCENARIOS_BY_ID: Record<string, ParityScenario> = Object.fromEntries(
  PARITY_SCENARIOS.map((scenario) => [scenario.id, scenario]),
);

function bindProductionApron(
  golden: GoldenScenario,
  input: HavocBattleInput,
): CapRushApronRuntime | null {
  if (golden.apron === null) return null;
  const scenario = buildScenario(golden);
  const target = apronTargetOf(input, scenario);
  const runtime = new CapRushApronRuntime({
    side: golden.apron.side,
    rules: { payrollStatus: golden.apron.payrollStatus },
    targetInstanceId: target.participant.instanceId,
    targetSlot: golden.apron.targetSlot,
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
  return runtime;
}

function simulate(golden: GoldenScenario): {
  readonly output: SimulatedOutput;
  readonly facts: readonly unknown[];
  readonly digests: Record<string, string>;
} {
  const input = buildInput(golden);
  const context = createEngineContext();
  if (golden.kind === 'solo') {
    const output = simulateAuditedHavocGame(input as HavocGameInput, context);
    return {
      output: { result: output.result, tape: output.tape, audit: output.audit, facts: [] },
      facts: [],
      digests: {},
    };
  }
  const battle = input as HavocBattleInput;
  const apron = bindProductionApron(golden, battle);
  const output = simulateAuditedHavocBattleGame(battle, context, apron === null ? {} : { apron });
  const facts = apron?.recordedFacts() ?? [];
  return {
    output: { result: output.result, tape: output.tape, audit: output.audit, facts },
    facts,
    digests: {
      inputDigest: havocBattleGameInputDigest(battle),
      resultDigest: havocBattleGameResultDigest(output.result),
      tapeDigest: havocBattleGameTapeDigest(output.tape),
    },
  };
}

describe('Havoc/Cap Rush Rust migration parity', () => {
  it('covers every declared parity scenario exactly once', () => {
    expect(fixture.scenarios.map((scenario) => scenario.id).sort()).toEqual(
      PARITY_SCENARIOS.map((scenario) => scenario.id).sort(),
    );
  });

  for (const golden of fixture.scenarios) {
    it(`${golden.id} matches golden result, tape, audit, facts, and digests`, () => {
      const { output, digests } = simulate(golden);
      expect(outputHashes(output), `${golden.id} hashes`).toEqual({
        resultHash: golden.expected.resultHash,
        tapeHash: golden.expected.tapeHash,
        auditHash: golden.expected.auditHash,
        factsHash: golden.expected.factsHash,
      });
      expect(outputSummary(output), `${golden.id} summary`).toEqual(golden.expected.summary);
      if (golden.kind === 'battle') {
        expect(digests, `${golden.id} production digests`).toEqual({
          inputDigest: golden.expected.inputDigest,
          resultDigest: golden.expected.resultDigest,
          tapeDigest: golden.expected.tapeDigest,
        });
      } else {
        expect(digests, `${golden.id} solo digests`).toEqual({});
      }
      expect([...outputFeatures(output)].sort(), `${golden.id} features`).toEqual([
        ...golden.expected.features,
      ]);
      expect(outputSummary(output).auditOk, `${golden.id} audit ok`).toBe(true);
    });
  }
});
