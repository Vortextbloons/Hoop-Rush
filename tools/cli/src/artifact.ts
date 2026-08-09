/**
 * Shared artifact-commit, artifact-validate, and worker-chunk plumbing
 * (deduplicated from the season-* calibrate commands).
 *
 * `commitTargetsArtifact` writes a targets JSON artifact and updates the
 * manifest's `season.<key>` content hash exactly when the output path is the
 * command's committed default target; scratch `--out` paths never touch the
 * manifest. `validateTargetsArtifact` runs the `--validate` scaffold shared
 * by the M2.4/M2.5 targets commands. `runWorkerChunk(s)` is the worker-thread
 * chunk runner (chunking, message/error/exit handling, flattening) used by
 * the season calibration cohorts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { sha256Hex, readJson } from './io.ts';
import { makeReport, type CliReport } from './report.ts';

/** Writes a targets artifact and commits its hash into the manifest. */
export function commitTargetsArtifact(args: {
  outPath: string;
  defaultTargetsPath: string;
  manifestPath: string;
  manifestKey: string;
  manifestUrl: string;
  content: unknown;
}): { written: boolean; path: string | null; error: string | null } {
  try {
    const target = resolve(args.outPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(args.content, null, 2)}\n`);
    if (resolve(args.outPath) === resolve(args.defaultTargetsPath)) {
      const manifestPathResolved = resolve(args.manifestPath);
      const manifest = JSON.parse(readFileSync(manifestPathResolved, 'utf8')) as {
        season?: Record<string, { url?: string; contentHash?: string }>;
      };
      if (manifest.season !== undefined) {
        manifest.season[args.manifestKey] = {
          url: args.manifestUrl,
          contentHash: sha256Hex(readFileSync(target)),
        };
        writeFileSync(manifestPathResolved, `${JSON.stringify(manifest, null, 2)}\n`);
      }
    }
    return { written: true, path: target, error: null };
  } catch (error) {
    return {
      written: false,
      path: null,
      error: `cannot write targets: ${(error as Error).message}`,
    };
  }
}

/** The `--validate` report scaffold shared by the targets commands. */
export function validateTargetsArtifact<T>(args: {
  outPath: string;
  schema: z.ZodType<T>;
  command: string;
  extraChecks?: (parsed: T) => { details: string[]; failures: string[] };
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
    const gates = (parsed as { gates?: Record<string, unknown> }).gates;
    if (gates !== undefined) {
      const gatePass = Object.values(gates).every(Boolean);
      if (!gatePass) failuresList.push('artifact records failed calibration gates');
      else details.push('artifact records all-passing gates');
    }
  }
  return makeReport(args.command, {}, { details, failures: failuresList });
}

/** Runs one worker chunk and resolves with its payload. */
export function runWorkerChunk<TResult>(args: {
  workerUrl: URL;
  workerData: unknown;
  payloadKey: string;
}): Promise<TResult> {
  return new Promise<TResult>((resolvePromise, rejectPromise) => {
    const worker = new Worker(args.workerUrl, { workerData: args.workerData });
    worker.on('message', (message: unknown) => {
      resolvePromise((message as Record<string, TResult>)[args.payloadKey] as TResult);
      void worker.terminate();
    });
    worker.on('error', rejectPromise);
    worker.on('exit', (code) => {
      if (code !== 0) rejectPromise(new Error(`worker exited ${String(code)}`));
    });
  });
}

/** Chunks `items` into at most `workers` slices and runs one worker each. */
export function runWorkerChunks<TItem, TResult>(args: {
  workerUrl: URL;
  workerData: (chunk: TItem[]) => unknown;
  items: readonly TItem[];
  workers: number;
  payloadKey: string;
}): Promise<TResult[]> {
  const chunkSize = Math.max(1, Math.ceil(args.items.length / args.workers));
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
