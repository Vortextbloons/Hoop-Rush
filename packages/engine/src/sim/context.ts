import type { Rng } from './rng.ts';
import { createRng } from './rng.ts';
import { ENGINE_VERSION } from './constants.ts';

/**
 * Engine context (spec/10 public boundary). The RNG factory is injected so
 * deterministic domain code never touches platform randomness or clocks; the
 * engine version is reported with every result and persisted with runs.
 */

export interface EngineContext {
  engineVersion: string;
  /** Creates a fresh deterministic RNG stream for one seed. */
  rngFactory: (seed: string) => Rng;
}

export function createEngineContext(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    engineVersion: ENGINE_VERSION,
    rngFactory: createRng,
    ...overrides,
  };
}
