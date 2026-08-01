import type { GameResult, GameSimulationInput } from '@hoop-rush/data-contracts';
import type { EngineContext } from './context.js';
import { simulateGame } from './game.js';
import { checkGameResult } from './invariants.js';

/**
 * Public engine boundary (spec/10): `simulateGame(input, context): GameResult`.
 * The seed and versioned inputs live in the serializable input; the RNG
 * factory is injected through the context. The result is validated against
 * the exact invariants before it leaves the engine.
 */
export function simulateGameWithCheck(
  input: GameSimulationInput,
  context: EngineContext,
): GameResult {
  const result = simulateGame(input, context);
  const failures = checkGameResult(result);
  if (failures.length > 0) {
    throw new Error(`simulateGame produced an invalid result: ${failures.join('; ')}`);
  }
  return result;
}

export { simulateGame };
export * from './context.js';
export * from './rng.js';
export * from './constants.js';
export * from './invariants.js';
export * from './facts.js';
