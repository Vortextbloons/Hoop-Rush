import { workerData } from 'node:worker_threads';
import { checkSeasonGameResult, simulateSeasonGame } from '@hoop-rush/engine';
import {
  seasonGameSimulationInputSchema,
  type SeasonHomeCourtProfile,
} from '@hoop-rush/data-contracts';
import { seasonGameFixtureSchema } from '../fixture-schema.ts';
import { postWorkerFacts, readWorkerFixture } from '../calibration-harness.ts';
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
  const fixture = readWorkerFixture(fixturePath, seasonGameFixtureSchema);
  const facts: SeasonHomeCourtGameFacts[] = seedIndices.map((index) => {
    const seed = seasonGameCalibrationSeed(index);
    const input = seasonGameSimulationInputSchema.parse({ ...fixture.input, seed });
    return simulateSeasonHomeCourtFacts(fixtureId, index, input, profile, {
      simulateSeasonGame,
      checkSeasonGameResult,
    });
  });
  postWorkerFacts('facts', facts);
}
main();
