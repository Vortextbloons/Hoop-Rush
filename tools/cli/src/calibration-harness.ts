import { readFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
import { z } from 'zod';
import { parseCount, parseSeedRange, parseWorkers } from './args.ts';
import { runWorkerChunks } from './artifact.ts';
import { seedIndexRange } from './commands/season-calibration.ts';

export function seedRangeCalibrateOptions(
  extra: Record<string, boolean> = {},
): Record<string, boolean> {
  return {
    'seed-from': true,
    'seed-to': true,
    workers: true,
    out: true,
    manifest: true,
    format: true,
    ...extra,
  };
}

export function seedCountCalibrateOptions(
  extra: Record<string, boolean> = {},
): Record<string, boolean> {
  return {
    workers: true,
    'calibration-seeds': true,
    'validation-seeds': true,
    out: true,
    manifest: true,
    format: true,
    ...extra,
  };
}

export type SeedRangeSplitMode = 'split' | 'append';

export interface SeedRangeCalibration {
  from: number;
  to: number;
  workers: number;
  calibrationIndices: number[];
  validationIndices: number[];
}

export function resolveCalibrationArgs(
  args: {
    'seed-from'?: string | null;
    'seed-to'?: string | null;
    workers?: string | null;
  },
  opts: {
    calibrationSeedCount: number;
    validationSeedCount: number;
    defaultWorkers?: number;
    clampWorkers?: boolean;
    mode?: SeedRangeSplitMode;
    error?: new (message: string) => Error;
  },
): SeedRangeCalibration {
  const mode = opts.mode ?? 'split';
  const fallbackTotal =
    mode === 'split'
      ? opts.calibrationSeedCount + opts.validationSeedCount - 1
      : opts.calibrationSeedCount - 1;
  const { from, to } = parseSeedRange(
    args,
    fallbackTotal,
    opts.error === undefined ? { requireOrder: true } : { requireOrder: true, error: opts.error },
  );
  const workers = parseWorkers(
    args,
    opts.defaultWorkers ?? 1,
    opts.clampWorkers === true ? { clampToAtLeastOne: true } : {},
  );
  if (mode === 'append') {
    return {
      from,
      to,
      workers,
      calibrationIndices: seedIndexRange(from, to),
      validationIndices: seedIndexRange(to + 1, to + opts.validationSeedCount),
    };
  }
  return {
    from,
    to,
    workers,
    calibrationIndices: seedIndexRange(from, Math.min(to, opts.calibrationSeedCount - 1)),
    validationIndices: seedIndexRange(Math.max(from, opts.calibrationSeedCount), to),
  };
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

export async function runCalibratedSeeds<T>(
  calibration: () => Promise<T[]> | T[],
  validation: () => Promise<T[]> | T[],
): Promise<{ calibration: T[]; validation: T[]; durationMs: number }> {
  const started = Date.now();
  const calibrationFacts = await calibration();
  const validationFacts = await validation();
  return {
    calibration: calibrationFacts,
    validation: validationFacts,
    durationMs: Date.now() - started,
  };
}

export interface FixtureCohortRunner<TFacts> {
  (request: {
    fixtures: Array<{ fixtureId: string; path: string }>;
    seedIndices: number[];
    workers: number;
    extra?: Record<string, unknown>;
  }): Promise<TFacts[]>;
}

export function createFixtureCohortRunner<TFacts>(opts: {
  workerUrl: URL;
  payloadKey: string;
  buildWorkerData: (
    fixture: { fixtureId: string; path: string },
    seedIndices: number[],
    extra?: Record<string, unknown>,
  ) => unknown;
}): FixtureCohortRunner<TFacts> {
  return async (request) => {
    const perFixture = await Promise.all(
      request.fixtures.map((fixture) =>
        runWorkerChunks<number, TFacts>({
          workerUrl: opts.workerUrl,
          workerData: (seedIndices) => opts.buildWorkerData(fixture, seedIndices, request.extra),
          items: request.seedIndices,
          workers: request.workers,
          payloadKey: opts.payloadKey,
        }),
      ),
    );
    return perFixture.flat();
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

const workerFixtureCache = new Map<string, unknown>();

export function readWorkerFixture<T>(path: string, schema: z.ZodType<T>): T {
  const cached = workerFixtureCache.get(path);
  if (cached !== undefined) return schema.parse(cached);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  workerFixtureCache.set(path, raw);
  return schema.parse(raw);
}

export function postWorkerFacts(payloadKey: string, facts: unknown): void {
  void Promise.resolve(facts).then((resolved) => {
    parentPort?.postMessage({ [payloadKey]: resolved });
  });
}
