import { parentPort, workerData } from 'node:worker_threads';
import { runSeasonRosterCalibrationSeeds } from '@hoop-rush/engine';
import { seasonDraftCatalogSchema, seasonLeagueSchema } from '@hoop-rush/data-contracts';
import { readFileSync } from 'node:fs';

/**
 * Roster-calibration worker (M2.1). Each worker loads the packaged catalog
 * and league itself and runs a seed chunk through the authoritative engine
 * calibration path; results are posted back as plain data. Worker counts
 * never change seed assignment or results.
 */

interface WorkerInput {
  catalogPath: string;
  leaguePath: string;
  seeds: string[];
  humanRosters: Array<{ franchiseId: string; playerVersionIds: string[] }>;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function main(): void {
  const input = workerData as WorkerInput;
  const catalog = seasonDraftCatalogSchema.parse(readJson(input.catalogPath));
  const league = seasonLeagueSchema.parse(readJson(input.leaguePath));
  const runs = runSeasonRosterCalibrationSeeds({
    seeds: input.seeds,
    catalog,
    league,
    humanRosters: input.humanRosters,
  });
  parentPort?.postMessage({ runs });
}

main();
