import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { checkSeasonGameResult, simulateSeasonGame } from '@hoop-rush/engine';
import {
  seasonGameSimulationInputSchema,
  type SeasonHomeCourtProfile,
} from '@hoop-rush/data-contracts';
import { seasonGameFixtureSchema } from '../fixture-schema.ts';
import { seasonGameCalibrationSeed } from './season-game.ts';
import {
  simulateSeasonHomeCourtFacts,
  type SeasonHomeCourtGameFacts,
} from './season-home-court.ts';

/**
 * Season home-court calibration worker (M2.3). Each worker loads the fixture
 * file itself and runs a seed-index chunk through the authoritative engine
 * calibration path (every game twice: neutral adapter and the tuned home
 * profile); per-game facts are posted back as plain data. Worker counts and
 * chunk ordering never change the facts, and the main thread aggregates
 * order-insensitively.
 */

interface SeasonHomeCourtWorkerInput {
  fixtureId: string;
  fixturePath: string;
  seedIndices: number[];
  profile: SeasonHomeCourtProfile;
}

function main(): void {
  const { fixtureId, fixturePath, seedIndices, profile } = workerData as SeasonHomeCourtWorkerInput;
  const fixture = seasonGameFixtureSchema.parse(
    JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown,
  );
  const facts: SeasonHomeCourtGameFacts[] = seedIndices.map((index) => {
    const seed = seasonGameCalibrationSeed(index);
    const input = seasonGameSimulationInputSchema.parse({ ...fixture.input, seed });
    return simulateSeasonHomeCourtFacts(fixtureId, index, input, profile, {
      simulateSeasonGame,
      checkSeasonGameResult,
    });
  });
  parentPort?.postMessage({ facts });
}

main();
