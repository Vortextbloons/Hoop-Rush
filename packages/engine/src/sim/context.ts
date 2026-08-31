import type { Rng } from './rng.ts';
import { createRng } from './rng.ts';
import { ENGINE_VERSION } from './constants.ts';
export interface EngineContext {
  engineVersion: string;
  rngFactory: (seed: string) => Rng;
}
export function createEngineContext(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    engineVersion: ENGINE_VERSION,
    rngFactory: createRng,
    ...overrides,
  };
}
