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
  soloToBattleInput,
} from '../core/battle-adapters.ts';
import { simulateHavocBattleGame } from '../core/battle-game.ts';
import { auditHavocBattleGame } from '../core/battle-audit.ts';
import { auditHavocSoloIdentity } from './audit.ts';

/**
 * Solo facade over the neutral battle simulator. The solo digest is computed
 * from the parsed solo input, exactly as the pre-battle engine did, so solo
 * digests stay frozen.
 */
function simulateSoloBattle(rawInput: HavocGameInput, context: EngineContext) {
  const input = havocGameInputSchema.parse(rawInput);
  const battleInput = soloToBattleInput(input);
  const simulation = simulateHavocBattleGame(battleInput, context);
  return { input, battleInput, simulation };
}

function soloResultOf({
  input,
  simulation,
}: Pick<ReturnType<typeof simulateSoloBattle>, 'input' | 'simulation'>): HavocGameResult {
  return battleToSoloResult(simulation.result, input.humanSide, havocGameInputDigest(input));
}

function soloSimulationOf({ input, simulation }: ReturnType<typeof simulateSoloBattle>): {
  result: HavocGameResult;
  tape: HavocGameTape;
} {
  return {
    result: soloResultOf({ input, simulation }),
    tape: battleToSoloTape(simulation.tape, input.humanSide),
  };
}

function auditedFindings(
  battle: ReturnType<typeof simulateSoloBattle>,
  result: HavocGameResult,
): HavocGameAudit['findings'] {
  const battleAudit = auditHavocBattleGame(
    battle.battleInput,
    battle.simulation.result,
    battle.simulation.tape,
  );
  return [...auditHavocSoloIdentity(battle.input, result), ...battleAudit.findings];
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
  const battle = simulateSoloBattle(rawInput, context);
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
  const battle = simulateSoloBattle(rawInput, context);
  const result = soloResultOf(battle);
  const findings = auditedFindings(battle, result);
  return { result, audit: { ok: findings.length === 0, findings } };
}
