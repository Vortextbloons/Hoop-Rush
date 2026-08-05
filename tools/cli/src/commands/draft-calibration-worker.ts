import { parentPort, workerData } from 'node:worker_threads';
import { seasonDraftCatalogSchema, seasonLeagueSchema } from '@hoop-rush/data-contracts';
import { readFileSync } from 'node:fs';
import { runSeasonDraftCalibrationSeeds } from './season-draft-calibrate.ts';

/**
 * Draft-calibration worker (M2.3.5). Each worker loads the packaged catalog
 * and league itself and runs a seed chunk through the authoritative engine
 * draft path; results are posted back as plain data. Worker counts never
 * change seed assignment or results.
 */

interface WorkerInput {
  catalogPath: string;
  leaguePath: string;
  seeds: string[];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function main(): void {
  const input = workerData as WorkerInput;
  const catalog = seasonDraftCatalogSchema.parse(readJson(input.catalogPath));
  const league = seasonLeagueSchema.parse(readJson(input.leaguePath));
  const runs = runSeasonDraftCalibrationSeeds({
    seeds: input.seeds,
    catalog,
    league,
  });
  parentPort?.postMessage({ runs });
}

main();
