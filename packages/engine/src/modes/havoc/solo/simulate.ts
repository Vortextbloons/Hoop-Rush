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

function soloResultOf({
  input,
  simulation,
  soloInputDigest,
}: Pick<
  ReturnType<typeof simulateSoloBattle>,
  'input' | 'simulation' | 'soloInputDigest'
>): HavocGameResult {
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
  battle: ReturnType<typeof simulateAuditedSoloBattle>,
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
 * Same simulation and audits as {@link simulateAuditedHavocGame} without the
 * solo tape relabel. Bulk season simulation does not deliver a tape, so this
 * avoids allocating one per game while keeping every accounting guarantee.
 * Replayable tapes come from the recorded path, which replays the same seed.
 */
export function simulateAuditedHavocSummaryGame(
  rawInput: HavocGameInput,
  context: EngineContext,
): { result: HavocGameResult; audit: HavocGameAudit } {
  const battle = simulateAuditedSoloBattle(rawInput, context);
  const result = soloResultOf(battle);
  const findings = auditedFindings(battle, result);
  return { result, audit: { ok: findings.length === 0, findings } };
}
