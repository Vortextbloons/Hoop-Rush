/**
 * Worker-thread entry for parallel ratings derivation (ratings/compute.ts
 * run()). Computes ratings for a season slice; each season writes its own
 * roster.json, so concurrent workers never touch the same file.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { computeForSeason } from './compute.ts';

const data = workerData as { seasons: string[]; force: boolean };
if (parentPort === null) {
  throw new Error('ratings worker must run inside a worker thread');
}

for (const season of data.seasons) {
  computeForSeason(season, data.force);
}
parentPort.postMessage({ done: data.seasons.length });
