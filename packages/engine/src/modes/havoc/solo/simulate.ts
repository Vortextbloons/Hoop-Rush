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

function soloSimulationOf({ input, simulation }: ReturnType<typeof simulateSoloBattle>): {
  result: HavocGameResult;
  tape: HavocGameTape;
} {
  return {
    result: battleToSoloResult(simulation.result, input.humanSide, havocGameInputDigest(input)),
    tape: battleToSoloTape(simulation.tape, input.humanSide),
  };
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
  const battleAudit = auditHavocBattleGame(
    battle.battleInput,
    battle.simulation.result,
    battle.simulation.tape,
  );
  const solo = soloSimulationOf(battle);
  const findings = [...auditHavocSoloIdentity(battle.input, solo.result), ...battleAudit.findings];
  return { ...solo, audit: { ok: findings.length === 0, findings } };
}
