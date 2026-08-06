import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import {
  checkSeasonGameResult,
  createSeasonEffectsState,
  simulateSeasonGame,
  simulateSeasonGameWithEffects,
} from '@hoop-rush/engine';
import { seasonGameSimulationInputSchema } from '@hoop-rush/data-contracts';
import { seasonGameFixtureSchema } from '../fixture-schema.ts';
import { seasonGameCalibrationSeed } from './season-game.ts';
import {
  simulateSeasonEffectsGameFacts,
  withFixtureStamina,
  type SeasonEffectsGameFacts,
} from './season-effects.ts';

/**
 * Season effects calibration worker (M2.4). Each worker loads the fixture
 * file itself and runs a seed-index chunk through the authoritative engine
 * calibration path (every game once neutral and once with the representative
 * effects state, double-run for determinism evidence); per-game facts are
 * posted back as plain data. Worker counts and chunk ordering never change
 * the facts.
 */

interface SeasonEffectsWorkerInput {
  fixtureId: string;
  fixturePath: string;
  seedIndices: number[];
}

function main(): void {
  const { fixtureId, fixturePath, seedIndices } = workerData as SeasonEffectsWorkerInput;
  const fixture = seasonGameFixtureSchema.parse(
    JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown,
  );
  const facts: SeasonEffectsGameFacts[] = seedIndices.map((index) => {
    const seed = seasonGameCalibrationSeed(index);
    const input = seasonGameSimulationInputSchema.parse({
      ...withFixtureStamina(fixture.input),
      seed,
    });
    return simulateSeasonEffectsGameFacts(fixtureId, index, input, {
      simulateSeasonGame,
      checkSeasonGameResult,
      simulateSeasonGameWithEffects,
      createSeasonEffectsState,
    });
  });
  parentPort?.postMessage({ facts });
}

main();
