import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { checkSeasonGameResult, simulateSeasonGame } from '@hoop-rush/engine';
import { seasonGameSimulationInputSchema } from '@hoop-rush/data-contracts';
import { seasonGameFixtureSchema } from '../fixture-schema.ts';
import {
  seasonGameCalibrationSeed,
  simulateSeasonGameFacts,
  type SeasonGameGameFacts,
} from './season-game.ts';

/**
 * Season-game calibration worker (M2.2). Each worker loads the fixture file
 * itself and runs a seed-index chunk through the authoritative engine
 * calibration path (every game twice for determinism evidence); per-game
 * facts are posted back as plain data. Worker counts and chunk ordering
 * never change the facts, and the main thread aggregates order-insensitively.
 */

interface SeasonGameWorkerInput {
  fixtureId: string;
  fixturePath: string;
  seedIndices: number[];
}

function main(): void {
  const { fixtureId, fixturePath, seedIndices } = workerData as SeasonGameWorkerInput;
  const fixture = seasonGameFixtureSchema.parse(
    JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown,
  );
  const facts: SeasonGameGameFacts[] = seedIndices.map((index) => {
    const seed = seasonGameCalibrationSeed(index);
    const input = seasonGameSimulationInputSchema.parse({ ...fixture.input, seed });
    return simulateSeasonGameFacts(fixtureId, index, input, {
      simulateSeasonGame,
      checkSeasonGameResult,
    });
  });
  parentPort?.postMessage({ facts });
}

main();
