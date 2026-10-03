import { workerData } from 'node:worker_threads';
import {
  seasonDraftCatalogSchema,
  seasonLeagueSchema,
  seasonRosterTargetsSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { runSeasonDraftCalibrationSeeds } from './season-draft-calibrate.ts';
import { postWorkerFacts, readWorkerFixture } from '../calibration-harness.ts';

interface WorkerInput {
  catalogPath: string;
  leaguePath: string;
  seeds: string[];
  targets: string | Record<string, unknown>;
}

function main(): void {
  const input = workerData as WorkerInput;
  const catalog = readWorkerFixture(input.catalogPath, seasonDraftCatalogSchema);
  const league = readWorkerFixture(input.leaguePath, seasonLeagueSchema);
  const targets = seasonRosterTargetsSchema.parse(
    typeof input.targets === 'string' ? JSON.parse(input.targets) : input.targets,
  );
  const seeds = input.seeds.map((seed) => seedSchema.parse(seed));
  postWorkerFacts(
    'runs',
    runSeasonDraftCalibrationSeeds({
      seeds,
      catalog,
      league,
      targets,
    }),
  );
}
main();
