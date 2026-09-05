import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
export function defaultWorkerCount(cap: number): number {
  if (process.env.NODE_ENV === 'test') return 1;
  return Math.min(cap, availableParallelism());
}
export function chunkList<T>(items: readonly T[], workers: number): T[][] {
  const count = Math.max(1, Math.trunc(workers));
  if (count <= 1 || items.length <= 1) return [[...items]];
  const size = Math.ceil(items.length / count);
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}
export function runWorker<Result>(workerUrl: URL, workerData: unknown): Promise<Result> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { workerData });
    let settled = false;
    worker.once('message', (result: Result) => {
      settled = true;
      void worker.terminate();
      resolve(result);
    });
    worker.once('error', (error) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    worker.once('exit', (code) => {
      if (settled || code === 0) return;
      settled = true;
      reject(new Error(`worker exited with code ${String(code)}`));
    });
  });
}
export async function runParallel<T, R>(
  items: readonly T[],
  workerUrl: URL,
  toWorkerData: (chunk: T[]) => unknown,
  chunkFn: (items: readonly T[], workers: number) => T[][] = chunkList,
  workers?: number,
  cap = 8,
): Promise<R[]> {
  const count = workers === undefined ? defaultWorkerCount(cap) : Math.max(1, Math.trunc(workers));
  if (count <= 1 || items.length <= 1) return [];
  const chunks = chunkFn(items, count);
  return Promise.all(chunks.map((chunk) => runWorker<R>(workerUrl, toWorkerData(chunk))));
}
