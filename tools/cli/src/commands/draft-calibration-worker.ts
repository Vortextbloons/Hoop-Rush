import { parentPort, workerData } from 'node:worker_threads';
import {
  seasonDraftCatalogSchema,
  seasonLeagueSchema,
  seasonRosterTargetsSchema,
} from '@hoop-rush/data-contracts';
import { readFileSync } from 'node:fs';
import { runSeasonDraftCalibrationSeeds } from './season-draft-calibrate.ts';
interface WorkerInput {
  catalogPath: string;
  leaguePath: string;
  seeds: string[];
  targets: string | Record<string, unknown>;
}
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
function main(): void {
  const input = workerData as WorkerInput;
  const catalog = seasonDraftCatalogSchema.parse(readJson(input.catalogPath));
  const league = seasonLeagueSchema.parse(readJson(input.leaguePath));
  const targets = seasonRosterTargetsSchema.parse(
    typeof input.targets === 'string' ? JSON.parse(input.targets) : input.targets,
  );
  const runs = runSeasonDraftCalibrationSeeds({
    seeds: input.seeds,
    catalog,
    league,
    targets,
  });
  parentPort?.postMessage({ runs });
}
main();
