/**
 * Worker-thread entry for parallel pool builds (pools/compute.ts run()).
 *
 * Receives one era-homogeneous target chunk plus the shared manifest, bbref
 * id map, and career position labels. Each worker keeps its season cache warm
 * across the chunk, so every season's JSON is parsed once per chunk instead of
 * once per target. Posts the TargetBuildResult list back to the main thread,
 * which alone updates the manifest, coverage report, and players index.
 */
import { parentPort, workerData } from 'node:worker_threads';
import {
  buildPoolForTarget,
  type PoolWorkerData,
  type PoolWorkerResult,
} from './compute.js';

const data = workerData as PoolWorkerData;
if (parentPort === null) {
  throw new Error('pool worker must run inside a worker thread');
}

const careerLabels =
  data.careerLabels === null
    ? null
    : new Map(
        [...data.careerLabels.entries()].map(([pid, labels]) => [pid, new Set(labels)]),
      );

const results: PoolWorkerResult['results'] = [];
for (const [franchiseId, eraId] of data.targets) {
  results.push(
    buildPoolForTarget(
      franchiseId,
      eraId,
      data.manifest,
      data.bbrefIds,
      data.withAssets,
      careerLabels,
      true,
    ),
  );
}
parentPort.postMessage({ results } satisfies PoolWorkerResult);
