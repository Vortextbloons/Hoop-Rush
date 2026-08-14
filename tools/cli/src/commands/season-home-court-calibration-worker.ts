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
