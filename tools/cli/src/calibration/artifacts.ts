import { parentPort, Worker } from 'node:worker_threads';
import { z } from 'zod';
import { parseCount } from '../args.ts';
import { readJson } from '../io.ts';
import { makeReport, type CliReport } from '../report.ts';
export function validateTargetsArtifact<T>(args: {
  outPath: string;
  schema: z.ZodType<T>;
  command: string;
  extraChecks?: (parsed: T) => {
    details: string[];
    failures: string[];
  };
}): CliReport {
  const failuresList: string[] = [];
  const details: string[] = [];
  let parsed: T | null = null;
  try {
    parsed = args.schema.parse(readJson(args.outPath));
    details.push(`artifact ${args.outPath} validates against the schema`);
  } catch (error) {
    failuresList.push(`artifact fails validation: ${(error as Error).message}`);
  }
  if (parsed !== null) {
    const extra = args.extraChecks?.(parsed) ?? { details: [], failures: [] };
    details.push(...extra.details);
    failuresList.push(...extra.failures);
    const gates = (
      parsed as {
        gates?: Record<string, unknown>;
      }
    ).gates;
    if (gates !== undefined) {
      const gatePass = Object.values(gates).every(Boolean);
      if (!gatePass) failuresList.push('artifact records failed calibration gates');
      else details.push('artifact records all-passing gates');
    }
  }
  return makeReport(args.command, {}, { details, failures: failuresList });
}
export function makeTargetsValidator<T>(opts: {
  schema: z.ZodType<T>;
  command: string;
  detail: string;
}): (args: unknown, outPath: string) => CliReport {
  return (args, outPath) => {
    void args;
    return validateTargetsArtifact({
      outPath,
      schema: opts.schema,
      command: opts.command,
      extraChecks: () => ({ details: [opts.detail], failures: [] }),
    });
  };
}
export function runWorkerChunk<TResult>(args: {
  workerUrl: URL;
  workerData: unknown;
  payloadKey: string;
}): Promise<TResult> {
  return new Promise<TResult>((resolvePromise, rejectPromise) => {
    let settled = false;
    const worker = new Worker(args.workerUrl, { workerData: args.workerData });
    worker.on('message', (message: unknown) => {
      if (settled) return;
      settled = true;
      resolvePromise((message as Record<string, TResult>)[args.payloadKey] as TResult);
      void worker.terminate().catch(() => {});
    });
    worker.on('error', (error: Error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    });
    worker.on('exit', (code) => {
      if (settled) return;
      if (code !== 0) rejectPromise(new Error(`worker exited ${String(code)}`));
    });
  });
}
export function runWorkerChunks<TItem, TResult>(args: {
  workerUrl: URL;
  workerData: (chunk: TItem[]) => unknown;
  items: readonly TItem[];
  workers: number;
  payloadKey: string;
}): Promise<TResult[]> {
  const safeWorkers = Math.max(1, Math.floor(args.workers));
  const chunkSize = Math.max(1, Math.ceil(args.items.length / safeWorkers));
  const chunks: TItem[][] = [];
  for (let i = 0; i < args.items.length; i += chunkSize) {
    chunks.push(args.items.slice(i, i + chunkSize));
  }
  return Promise.all(
    chunks.map((chunk) =>
      runWorkerChunk<TResult[]>({
        workerUrl: args.workerUrl,
        workerData: args.workerData(chunk),
        payloadKey: args.payloadKey,
      }),
    ),
  ).then((results) => results.flat());
}

export interface SeedCountCalibration {
  calibrationCount: number;
  validationCount: number;
  workers: number;
}

export function resolveCountCalibrationArgs(
  args: {
    workers?: string | null;
    'calibration-seeds'?: string | null;
    'validation-seeds'?: string | null;
  },
  opts: {
    calibrationDefault: number;
    validationDefault: number;
    workersDefault?: number;
    clampWorkers?: boolean;
  },
): SeedCountCalibration {
  const calibrationCount = parseCount(
    args['calibration-seeds'] ?? undefined,
    '--calibration-seeds',
    opts.calibrationDefault,
  );
  const validationCount = parseCount(
    args['validation-seeds'] ?? undefined,
    '--validation-seeds',
    opts.validationDefault,
  );
  const rawWorkers = parseCount(args.workers ?? undefined, '--workers', opts.workersDefault ?? 4);
  return {
    calibrationCount,
    validationCount,
    workers: opts.clampWorkers === true ? Math.max(1, rawWorkers) : rawWorkers,
  };
}

export function createSeedChunkRunner<TSeed, TResult>(opts: {
  workerUrl: URL;
  payloadKey: string;
  buildWorkerData: (chunk: TSeed[], extra?: Record<string, unknown>) => unknown;
}): (
  seeds: readonly TSeed[],
  workers: number,
  extra?: Record<string, unknown>,
) => Promise<TResult[]> {
  return (seeds, workers, extra) =>
    runWorkerChunks<TSeed, TResult>({
      workerUrl: opts.workerUrl,
      workerData: (chunk) => opts.buildWorkerData(chunk, extra),
      items: seeds,
      workers,
      payloadKey: opts.payloadKey,
    });
}

export function postWorkerFacts(payloadKey: string, facts: unknown): void {
  void Promise.resolve(facts).then((resolved) => {
    parentPort?.postMessage({ [payloadKey]: resolved });
  });
}
