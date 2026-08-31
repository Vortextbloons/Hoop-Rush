import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import {
  checkSeasonGameResult,
  simulateSeasonGame,
  simulateSeasonGameWithEffects,
} from '@hoop-rush/engine';
import { seasonGameSimulationInputSchema } from '@hoop-rush/data-contracts';
import { seasonGameFixtureSchema } from '../fixture-schema.ts';
import { seasonGameCalibrationSeed, simulateSeasonGameFacts } from './season-game.ts';
interface SeasonGameWorkerInput {
  fixtureId: string;
  fixturePath: string;
  seedIndices: number[];
  effects?: boolean;
}
function main(): void {
  const { fixtureId, fixturePath, seedIndices, effects } = workerData as SeasonGameWorkerInput;
  const fixture = seasonGameFixtureSchema.parse(
    JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown,
  );
  const facts = seedIndices.map((index) => {
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
  });
  void Promise.all(facts).then((resolved) => {
    parentPort?.postMessage({ facts: resolved });
  });
}
main();
