import { expect, it } from 'bun:test';
import { buildGameSimulationInput, seedFromString } from '@hoop-rush/test-fixtures';
import { seedSchema } from '@hoop-rush/data-contracts';
import { simulateRecordedGame as reference } from '../archive/code/sim/tape.ts';
import { simulateRecordedGame } from './tape.ts';
import { createEngineContext } from './kernel.ts';
import { createRng } from './rng.ts';
it('preserves complete recorded tapes, overtime and injected RNG across repeated games', () => {
  for (const context of [
    createEngineContext(),
    createEngineContext({ rngFactory: (seed) => createRng(seed) }),
  ]) {
    for (let i = 0; i < 60; i++) {
      const input = buildGameSimulationInput({
        seed: seedSchema.parse(seedFromString(i === 0 ? 'ot-v21-8' : `tape-parity-${String(i)}`)),
      });
      expect(simulateRecordedGame(input, context)).toEqual(reference(input, context));
    }
  }
});
