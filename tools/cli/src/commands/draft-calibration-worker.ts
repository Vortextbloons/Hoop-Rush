import { parentPort, workerData } from 'node:worker_threads';
import {
  seasonDraftCatalogSchema,
  seasonLeagueSchema,
  seasonRosterTargetsSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { runSeasonDraftCalibrationSeeds } from './season-draft-calibrate.ts';
import { readJson } from '../io.ts';
interface WorkerInput {
  catalogPath: string;
  leaguePath: string;
  seeds: string[];
  targets: string | Record<string, unknown>;
}
function main(): void {
  const input = workerData as WorkerInput;
  const catalog = seasonDraftCatalogSchema.parse(readJson(input.catalogPath));
  const league = seasonLeagueSchema.parse(readJson(input.leaguePath));
  const targets = seasonRosterTargetsSchema.parse(
    typeof input.targets === 'string' ? JSON.parse(input.targets) : input.targets,
  );
  const seeds = input.seeds.map((seed) => seedSchema.parse(seed));
  const runs = runSeasonDraftCalibrationSeeds({
    seeds,
    catalog,
    league,
    targets,
  });
  parentPort?.postMessage({ runs });
}
main();
