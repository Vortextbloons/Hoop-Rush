import type {
  HavocBattleEvent,
  HavocBattleInput,
  HavocBattleResult,
  HavocBattleTape,
  HavocGameAudit,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  havocBattleInputSchema,
  havocBattleResultSchema,
  havocBattleTapeSchema,
} from '@hoop-rush/data-contracts';
import type { ApronRuntimeHooks } from '../../../sim/apron-runtime.ts';
import type { EngineContext } from '../../../sim/kernel.ts';
import type { Rng } from '../../../sim/rng.ts';
import { auditHavocBattleGame, type HavocBattleAuditFacts } from './battle-audit.ts';
import { havocBattleGameInputDigest } from './battle-digests.ts';
import { HavocBattleWasmSimulation } from './battle-wasm.ts';
export { HAVOC_SCORING_SOURCE_MUTATION, havocFieldGoalValue } from './battle-scoring.ts';
export type {
  HavocFieldGoalContribution,
  HavocFieldGoalValue,
  HavocFieldGoalValueInput,
} from './battle-scoring.ts';

export { HavocSimulationExhaustedError } from './battle-error.ts';

export interface HavocCoverageAssignment {
  assignment: Array<{ shooterInstanceId: string; defenderInstanceId: string }>;
  uncoveredInstanceIds: string[];
  helpInstanceIds: string[];
}

export function havocCoverageAssignment(
  offenseInstanceIds: readonly string[],
  defenseInstanceIds: readonly string[],
  matchWeight: (defenderInstanceId: string, shooterInstanceId: string) => number,
  rng: Rng,
): HavocCoverageAssignment {
  const assignment: HavocCoverageAssignment['assignment'] = [];
  const covered = new Set<string>();
  const used = new Set<string>();
  for (const defenderId of defenseInstanceIds) {
    const candidates = offenseInstanceIds.filter((instanceId) => !covered.has(instanceId));
    if (candidates.length === 0) break;
    const weights = candidates.map((candidate) =>
      Math.max(0.0001, matchWeight(defenderId, candidate)),
    );
    const chosen = rng.weightedPick(candidates, weights);
    assignment.push({ shooterInstanceId: chosen, defenderInstanceId: defenderId });
    covered.add(chosen);
    used.add(defenderId);
  }
  return {
    assignment,
    uncoveredInstanceIds: offenseInstanceIds.filter((instanceId) => !covered.has(instanceId)),
    helpInstanceIds: defenseInstanceIds.filter((instanceId) => !used.has(instanceId)),
  };
}

export interface HavocBattleOptions {
  readonly apron?: ApronRuntimeHooks;
}

interface HavocBattleRun {
  readonly result: HavocBattleResult;
  readonly tape: HavocBattleTape;
  /** Facts the simulation already established; the audit reuses them. */
  readonly auditFacts: HavocBattleAuditFacts;
}

function runBattle(
  input: HavocBattleInput,
  context: EngineContext,
  options: HavocBattleOptions,
): { raw: ReturnType<HavocBattleWasmSimulation['run']>; inputDigest: string } {
  const apron = options.apron?.battleApronStates?.() ?? [];
  const simulation = new HavocBattleWasmSimulation(input, context, apron);
  try {
    return { raw: simulation.run(), inputDigest: havocBattleGameInputDigest(input) };
  } finally {
    options.apron?.completeBattle?.();
  }
}

function buildRun(
  input: HavocBattleInput,
  context: EngineContext,
  options: HavocBattleOptions,
): HavocBattleRun {
  const { raw, inputDigest } = runBattle(input, context, options);
  const overtimePeriods = raw.overtimePeriods;
  const result = havocBattleResultSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    gameNumber: input.gameNumber,
    variant: input.variant,
    seed: input.seed,
    engineVersion: context.engineVersion,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    profileVersion: input.profile.profileVersion,
    dataVersion: input.versionSet.dataVersion,
    home: raw.home,
    away: raw.away,
    winner: raw.home.points > raw.away.points ? 'home' : 'away',
    overtimePeriods,
    inputDigest,
    rollups: raw.rollups,
    highlights: raw.highlights,
  });
  const tape: HavocBattleTape = {
    schemaVersion: HAVOC_SCHEMA_VERSION,
    gameNumber: input.gameNumber,
    variant: input.variant,
    seed: input.seed,
    events: raw.events,
    scoring: raw.scoring,
  };
  return {
    result,
    tape,
    auditFacts: { inputDigest: result.inputDigest, resultValidated: true },
  };
}

export function simulateHavocBattleGame(
  rawInput: HavocBattleInput,
  context: EngineContext,
  options: HavocBattleOptions = {},
): { result: HavocBattleResult; tape: HavocBattleTape } {
  return simulateValidatedHavocBattleGame(havocBattleInputSchema.parse(rawInput), context, options);
}

export function simulateValidatedHavocBattleGame(
  input: HavocBattleInput,
  context: EngineContext,
  options: HavocBattleOptions = {},
): { result: HavocBattleResult; tape: HavocBattleTape } {
  const battle = buildRun(input, context, options);
  return { result: battle.result, tape: havocBattleTapeSchema.parse(battle.tape) };
}

export function simulateAuditedHavocBattleGame(
  input: HavocBattleInput,
  context: EngineContext,
  options: HavocBattleOptions = {},
): { result: HavocBattleResult; tape: HavocBattleTape; audit: HavocGameAudit } {
  const battle = buildRun(input, context, options);
  const audit = auditHavocBattleGame(input, battle.result, battle.tape, battle.auditFacts);
  let tape: HavocBattleTape | undefined;
  return {
    result: battle.result,
    audit,
    get tape() {
      return (tape ??= havocBattleTapeSchema.parse(battle.tape));
    },
  };
}

export type { HavocBattleEvent };
