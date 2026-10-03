import { workerData } from 'node:worker_threads';
import { loadCollectionCatalog } from './collection.ts';
import { loadCollectionGameRules } from './collection-game.ts';
import { postWorkerFacts } from '../calibration-harness.ts';
import {
  projectCollectionGameJob,
  type CollectionGameProjectionJob,
} from './collection-game-projection.ts';

function main(): void {
  const { manifestPath, jobs } = workerData as {
    manifestPath: string;
    jobs: CollectionGameProjectionJob[];
  };
  const { catalog } = loadCollectionCatalog(manifestPath);
  const { rules } = loadCollectionGameRules(manifestPath);
  postWorkerFacts(
    'projections',
    jobs.map((job) => projectCollectionGameJob(catalog, rules, job)),
  );
}

main();
