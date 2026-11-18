import type {
  HavocGameAudit,
  HavocGameInput,
  HavocGameResult,
  HavocGameTape,
} from '@hoop-rush/data-contracts';
import { havocGameInputSchema } from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../../sim/kernel.ts';
import { havocGameInputDigest } from '../digests.ts';
import {
  battleToSoloResult,
  battleToSoloTape,
  soloToBattleInputValidated,
} from '../core/battle-adapters.ts';
import {
  simulateAuditedHavocBattleGame,
  simulateAuditedHavocBattleSummary,
  simulateValidatedHavocBattleGame,
} from '../core/battle-game.ts';
import { auditHavocSoloIdentity } from './audit.ts';

/**
 * Solo facade over the neutral battle simulator. The solo digest is computed
 * from the parsed solo input, exactly as the pre-battle engine did, so solo
 * digests stay frozen.
 */
function soloInputsOf(rawInput: HavocGameInput) {
  const input = havocGameInputSchema.parse(rawInput);
  const battleInput = soloToBattleInputValidated(input);
  return { input, battleInput, soloInputDigest: havocGameInputDigest(input) };
}

function simulateSoloBattle(rawInput: HavocGameInput, context: EngineContext) {
  const { input, battleInput, soloInputDigest } = soloInputsOf(rawInput);
  const simulation = simulateValidatedHavocBattleGame(battleInput, context);
  return { input, simulation, soloInputDigest };
}

function simulateAuditedSoloBattle(rawInput: HavocGameInput, context: EngineContext) {
  const { input, battleInput, soloInputDigest } = soloInputsOf(rawInput);
  const simulation = simulateAuditedHavocBattleGame(battleInput, context);
  return { input, simulation, soloInputDigest };
}

function simulateAuditedSoloBattleSummary(rawInput: HavocGameInput, context: EngineContext) {
  const { input, battleInput, soloInputDigest } = soloInputsOf(rawInput);
  const simulation = simulateAuditedHavocBattleSummary(battleInput, context);
  return { input, simulation, soloInputDigest };
}

interface SoloResultSource {
  readonly input: HavocGameInput;
  readonly simulation: { readonly result: Parameters<typeof battleToSoloResult>[0] };
  readonly soloInputDigest: string;
}

interface SoloAuditSource extends SoloResultSource {
  readonly simulation: {
    readonly result: Parameters<typeof battleToSoloResult>[0];
    readonly audit: HavocGameAudit;
  };
}

function soloResultOf({ input, simulation, soloInputDigest }: SoloResultSource): HavocGameResult {
  return battleToSoloResult(simulation.result, input.humanSide, soloInputDigest);
}

function soloSimulationOf({
  input,
  simulation,
  soloInputDigest,
}: ReturnType<typeof simulateSoloBattle>): {
  result: HavocGameResult;
  tape: HavocGameTape;
} {
  return {
    result: soloResultOf({ input, simulation, soloInputDigest }),
    tape: battleToSoloTape(simulation.tape, input.humanSide),
  };
}

function auditedFindings(
  battle: SoloAuditSource,
  result: HavocGameResult,
): HavocGameAudit['findings'] {
  const battleAudit = battle.simulation.audit;
  return [
    ...auditHavocSoloIdentity(battle.input, result, { inputDigest: battle.soloInputDigest }),
    ...battleAudit.findings,
  ];
}

export function simulateHavocGame(
  rawInput: HavocGameInput,
  context: EngineContext,
): { result: HavocGameResult; tape: HavocGameTape } {
  return soloSimulationOf(simulateSoloBattle(rawInput, context));
}

export function simulateAuditedHavocGame(
  rawInput: HavocGameInput,
  context: EngineContext,
): { result: HavocGameResult; tape: HavocGameTape; audit: HavocGameAudit } {
  const battle = simulateAuditedSoloBattle(rawInput, context);
  const solo = soloSimulationOf(battle);
  const findings = auditedFindings(battle, solo.result);
  return { ...solo, audit: { ok: findings.length === 0, findings } };
}

/**
 * Same seeded result and audits as {@link simulateAuditedHavocGame} without the
 * solo tape relabel or typed event decoding. Bulk season simulation does not
 * deliver a tape, so this audits the kernel's compact ledger instead and keeps
 * every accounting guarantee. Replayable tapes come from the recorded path,
 * which replays the same seed.
 */
export function simulateAuditedHavocSummaryGame(
  rawInput: HavocGameInput,
  context: EngineContext,
): { result: HavocGameResult; audit: HavocGameAudit } {
  const battle = simulateAuditedSoloBattleSummary(rawInput, context);
  const result = soloResultOf(battle);
  const findings = auditedFindings(battle, result);
  return { result, audit: { ok: findings.length === 0, findings } };
}
