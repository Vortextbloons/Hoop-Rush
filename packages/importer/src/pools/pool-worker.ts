import { parentPort, workerData } from 'node:worker_threads';
import { buildPoolForTarget, type PoolWorkerData, type PoolWorkerResult } from './compute.ts';

const data = workerData as PoolWorkerData;
if (parentPort === null) {
  throw new Error('pool worker must run inside a worker thread');
}

const careerLabels =
  data.careerLabels === null
    ? null
    : new Map(
        data.careerLabels.map(([pid, labels]) => [pid, new Set(labels)] as [string, Set<string>]),
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
