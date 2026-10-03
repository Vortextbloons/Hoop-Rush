import { workerData } from 'node:worker_threads';
import {
  checkSeasonGameResult,
  simulateSeasonGame,
  simulateSeasonGameWithEffects,
} from '@hoop-rush/engine';
import { seasonGameSimulationInputSchema } from '@hoop-rush/data-contracts';
import { seasonGameFixtureSchema } from '../fixture-schema.ts';
import { postWorkerFacts, readWorkerFixture } from '../calibration-harness.ts';
import { seasonGameCalibrationSeed, simulateSeasonGameFacts } from './season-game.ts';

interface SeasonGameWorkerInput {
  fixtureId: string;
  fixturePath: string;
  seedIndices: number[];
  effects?: boolean;
}

function main(): void {
  const { fixtureId, fixturePath, seedIndices, effects } = workerData as SeasonGameWorkerInput;
  const fixture = readWorkerFixture(fixturePath, seasonGameFixtureSchema);
  postWorkerFacts(
    'facts',
    Promise.all(
      seedIndices.map((index) => {
        const seed = seasonGameCalibrationSeed(index);
        const input = seasonGameSimulationInputSchema.parse({ ...fixture.input, seed });
        return simulateSeasonGameFacts(
          fixtureId,
          index,
          input,
          {
            simulateSeasonGame,
            checkSeasonGameResult,
            simulateSeasonGameWithEffects,
          },
          effects ?? false,
        );
      }),
    ),
  );
}
main();
