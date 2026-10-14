import type { HavocGameInput, HavocGameResult, HavocGameTape } from '@hoop-rush/data-contracts';
import { havocGameInputSchema } from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../../sim/kernel.ts';
import { havocGameInputDigest } from '../digests.ts';
import {
  battleToSoloResult,
  battleToSoloTape,
  soloToBattleInput,
} from '../core/battle-adapters.ts';
import { simulateHavocBattleGame } from '../core/battle-game.ts';

/**
 * Solo facade over the neutral battle simulator. The solo digest is computed
 * from the parsed solo input, exactly as the pre-battle engine did, so solo
 * digests stay frozen.
 */
export function simulateHavocGame(
  rawInput: HavocGameInput,
  context: EngineContext,
): { result: HavocGameResult; tape: HavocGameTape } {
  const input = havocGameInputSchema.parse(rawInput);
  const battleInput = soloToBattleInput(input);
  const simulation = simulateHavocBattleGame(battleInput, context);
  return {
    result: battleToSoloResult(simulation.result, input.humanSide, havocGameInputDigest(input)),
    tape: battleToSoloTape(simulation.tape, input.humanSide),
  };
}
