import { workerData } from 'node:worker_threads';
import {
  checkSeasonGameResult,
  createSeasonEffectsState,
  simulateSeasonGame,
  simulateSeasonGameWithEffects,
} from '@hoop-rush/engine';
import { seasonGameSimulationInputSchema } from '@hoop-rush/data-contracts';
import { seasonGameFixtureSchema } from '../fixture-schema.ts';
import { postWorkerFacts, readWorkerFixture } from '../calibration-harness.ts';
import { seasonGameCalibrationSeed } from './season-game.ts';
import {
  simulateSeasonEffectsGameFacts,
  withFixtureStamina,
  type SeasonEffectsGameFacts,
} from './season-effects.ts';

interface SeasonEffectsWorkerInput {
  fixtureId: string;
  fixturePath: string;
  seedIndices: number[];
}

function main(): void {
  const { fixtureId, fixturePath, seedIndices } = workerData as SeasonEffectsWorkerInput;
  const fixture = readWorkerFixture(fixturePath, seasonGameFixtureSchema);
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
  postWorkerFacts('facts', facts);
}
main();
