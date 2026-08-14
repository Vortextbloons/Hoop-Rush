import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SEASON_BLOCK_COUNT } from '@hoop-rush/data-contracts';
import { SeasonBlockCancelledError, simulateSeasonBlock } from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { seasonBenchmarkReportSchema } from '../report-schemas.ts';
import {
  createSeasonBlockRunner,
  rollForwardTo,
  runBlockThroughHandler,
  runnerBlockCommand,
  runnerPipelineInput,
  type SeasonBlockRunnerState,
} from './season-block.ts';

export const SEASON_BENCHMARK_OPTIONS: Record<string, boolean> = {
  input: true,
  manifest: true,
  profile: true,
  samples: true,
  out: true,
  format: true,
};

export const SEASON_BUDGET_NORMAL_BLOCK_MS = 3000;
export const SEASON_BUDGET_FINAL_BLOCK_MS = 1000;
export const SEASON_BUDGET_FULL_SEASON_MS = 30000;

function writeBenchmarkReport(out: string | null, payload: unknown): string | null {
  if (out === null) return null;
  const target = resolve(out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
  return target;
}

function timed(
  state: SeasonBlockRunnerState,
  blockIndex: number,
): { digest: string; durationMs: number } {
  const started = performance.now();
  const checkpoint = runBlockThroughHandler(state, blockIndex);
  return { digest: checkpoint.digest, durationMs: performance.now() - started };
}

export function seasonBenchmarkBlock(args: {
  input: string | null;
  manifest: string | null;
  profile: string | null;
  out: string | null;
}): CliReport {
  const state = createSeasonBlockRunner({
    runPath: args.input,
    manifestPath: args.manifest,
    profileEra: args.profile,
  });
  const perBlock: Array<{ blockIndex: number; digest: string; durationMs: number }> = [];

  const normal = timed(state, 0);
  perBlock.push({ blockIndex: 0, digest: normal.digest, durationMs: normal.durationMs });
  const normalWithinBudget = normal.durationMs <= SEASON_BUDGET_NORMAL_BLOCK_MS;

  rollForwardTo(state, SEASON_BLOCK_COUNT - 1);
  const finalStarted = performance.now();
  const final = timed(state, SEASON_BLOCK_COUNT - 1);
  const finalDurationMs = performance.now() - finalStarted;
  perBlock.push({
    blockIndex: SEASON_BLOCK_COUNT - 1,
    digest: final.digest,
    durationMs: final.durationMs,
  });
  const finalWithinBudget = finalDurationMs <= SEASON_BUDGET_FINAL_BLOCK_MS;

  const pass = normalWithinBudget && finalWithinBudget;
  const payload = seasonBenchmarkReportSchema.parse({
    schemaVersion: 1,
    command: 'season benchmark block',
    runId: state.run.runId,
    durationMs: normal.durationMs + finalDurationMs,
    budgetMs: null,
    withinBudget: null,
    digest: null,
    identicalDigests: null,
    perBlock,
    persistence: null,
    auditFailures: [],
    outPath: null,
    pass,
  });
  const outPath = writeBenchmarkReport(args.out, payload);
  payload.outPath = outPath;
  const details = [
    `run ${state.run.runId}`,
    `normal block 0: ${normal.durationMs.toFixed(0)}ms (budget ${String(SEASON_BUDGET_NORMAL_BLOCK_MS)}ms) ${normalWithinBudget ? 'OK' : 'OVER'}`,
    `final block 8: ${finalDurationMs.toFixed(0)}ms (budget ${String(SEASON_BUDGET_FINAL_BLOCK_MS)}ms) ${finalWithinBudget ? 'OK' : 'OVER'}`,
    ...perBlock.map(
      (entry) =>
        `block ${String(entry.blockIndex)} ${entry.digest} (${entry.durationMs.toFixed(0)}ms)`,
    ),
    `report ${outPath ?? 'not written (pass --out <path>)'}`,
  ];
  const failures: string[] = [];
  if (!normalWithinBudget) {
    failures.push(
      `normal block ${normal.durationMs.toFixed(0)}ms exceeds the ${String(SEASON_BUDGET_NORMAL_BLOCK_MS)}ms budget`,
    );
  }
  if (!finalWithinBudget) {
    failures.push(
      `final block ${finalDurationMs.toFixed(0)}ms exceeds the ${String(SEASON_BUDGET_FINAL_BLOCK_MS)}ms budget`,
    );
  }
  return makeReport(
    'season benchmark block',
    { run: state.run.runId },
    { details, failures, payload },
  );
}

export function seasonBenchmarkFull(args: {
  input: string | null;
  manifest: string | null;
  profile: string | null;
  out: string | null;
}): CliReport {
  const state = createSeasonBlockRunner({
    runPath: args.input,
    manifestPath: args.manifest,
    profileEra: args.profile,
  });
  const started = performance.now();
  const perBlock: Array<{ blockIndex: number; digest: string; durationMs: number }> = [];
  for (let blockIndex = 0; blockIndex < SEASON_BLOCK_COUNT; blockIndex += 1) {
    const block = timed(state, blockIndex);
    perBlock.push({
      blockIndex,
      digest: block.digest,
      durationMs: block.durationMs,
    });
  }
  const durationMs = performance.now() - started;
  const finalDigest = perBlock[perBlock.length - 1]?.digest ?? '';
  const withinBudget = durationMs <= SEASON_BUDGET_FULL_SEASON_MS;
  const payload = seasonBenchmarkReportSchema.parse({
    schemaVersion: 1,
    command: 'season benchmark full',
    runId: state.run.runId,
    durationMs,
    budgetMs: SEASON_BUDGET_FULL_SEASON_MS,
    withinBudget,
    digest: finalDigest,
    identicalDigests: null,
    perBlock,
    persistence: null,
    auditFailures: [],
    outPath: null,
    pass: withinBudget,
  });
  const outPath = writeBenchmarkReport(args.out, payload);
  payload.outPath = outPath;
  const details = [
    `run ${state.run.runId}`,
    `full season ${durationMs.toFixed(0)}ms (budget ${String(SEASON_BUDGET_FULL_SEASON_MS)}ms) ${withinBudget ? 'OK' : 'OVER'}`,
    `final digest ${finalDigest}`,
    `report ${outPath ?? 'not written (pass --out <path>)'}`,
  ];
  const failures = withinBudget
    ? []
    : [
        `full season ${durationMs.toFixed(0)}ms exceeds the ${String(SEASON_BUDGET_FULL_SEASON_MS)}ms budget`,
      ];
  return makeReport(
    'season benchmark full',
    { run: state.run.runId },
    { details, failures, payload },
  );
}

export function seasonBenchmarkDeterminism(args: {
  input: string | null;
  manifest: string | null;
  profile: string | null;
  out: string | null;
}): CliReport {
  const runnerRun = (): { runId: string; digests: string[] } => {
    const state = createSeasonBlockRunner({
      runPath: args.input,
      manifestPath: args.manifest,
      profileEra: args.profile,
    });
    const digests: string[] = [];
    for (let blockIndex = 0; blockIndex < SEASON_BLOCK_COUNT; blockIndex += 1) {
      digests.push(runBlockThroughHandler(state, blockIndex).digest);
    }
    return { runId: state.run.runId, digests };
  };
  const first = runnerRun();
  const second = runnerRun();

  const interrupted = (() => {
    const state = createSeasonBlockRunner({
      runPath: args.input,
      manifestPath: args.manifest,
      profileEra: args.profile,
    });
    rollForwardTo(state, 3);
    const input = runnerPipelineInput(state, runnerBlockCommand(state, 3));
    let cancelled = false;
    try {
      simulateSeasonBlock(input, { cancelAfterGames: 75 });
    } catch (error) {
      if (error instanceof SeasonBlockCancelledError) cancelled = true;
      else throw error;
    }
    if (!cancelled) {
      throw new Error('determinism benchmark: cancellation seam did not trigger');
    }

    const checkpoint = simulateSeasonBlock(input);
    return [...first.digests.slice(0, 3), checkpoint.digest];
  })();

  const identicalDigests = JSON.stringify(first.digests) === JSON.stringify(second.digests);
  const identicalInterrupted =
    JSON.stringify(interrupted) === JSON.stringify(first.digests.slice(0, interrupted.length));
  const pass = identicalDigests && identicalInterrupted;
  const payload = seasonBenchmarkReportSchema.parse({
    schemaVersion: 1,
    command: 'season benchmark determinism',
    runId: first.runId,
    durationMs: 0,
    budgetMs: null,
    withinBudget: null,
    digest: first.digests[first.digests.length - 1] ?? null,
    identicalDigests,
    perBlock: first.digests.map((digest, blockIndex) => ({
      blockIndex,
      digest,
      durationMs: 0,
    })),
    persistence: null,
    auditFailures: [],
    outPath: null,
    pass,
  });
  const outPath = writeBenchmarkReport(args.out, payload);
  payload.outPath = outPath;
  const details = [
    `two uninterrupted full-season runs: ${identicalDigests ? 'identical digests' : 'DIVERGED'}`,
    `interrupted-resume run: ${identicalInterrupted ? 'identical digests' : 'DIVERGED'}`,
    `final digest ${first.digests[first.digests.length - 1] ?? 'n/a'}`,
    `report ${outPath ?? 'not written (pass --out <path>)'}`,
  ];
  const failures: string[] = [];
  if (!identicalDigests) failures.push('uninterrupted full-season digests diverged');
  if (!identicalInterrupted) failures.push('interrupted-resume digests diverged');
  return makeReport(
    'season benchmark determinism',
    { run: first.runId },
    { details, failures, payload },
  );
}

export async function seasonBenchmarkPersistence(args: {
  samples: string | null;
  out: string | null;
}): Promise<CliReport> {
  const samples = Math.max(1, Number.parseInt(args.samples ?? '1', 10) || 1);
  let report: Awaited<
    ReturnType<typeof import('@hoop-rush/persistence').benchmarkSeasonRunPersistence>
  >;
  try {
    const { IDBFactory, IDBKeyRange } = await import('fake-indexeddb');
    const environment = globalThis as { indexedDB?: unknown; IDBKeyRange?: unknown };
    environment.indexedDB = new IDBFactory();
    environment.IDBKeyRange = IDBKeyRange;
    const { Dexie } = await import('dexie');
    const { HoopRushDatabase } = await import('@hoop-rush/persistence');
    const { benchmarkSeasonRunPersistence } = await import('@hoop-rush/persistence');
    report = await benchmarkSeasonRunPersistence({
      samples,
      createDatabase: () => {
        Dexie.dependencies.indexedDB = new IDBFactory();
        Dexie.dependencies.IDBKeyRange = IDBKeyRange;
        return new HoopRushDatabase();
      },
    });
  } catch (error) {
    const failedPayload = seasonBenchmarkReportSchema.parse({
      schemaVersion: 1,
      command: 'season benchmark persistence',
      runId: 'season-benchmark-persistence',
      durationMs: 0,
      budgetMs: null,
      withinBudget: null,
      digest: null,
      identicalDigests: null,
      persistence: null,
      auditFailures: [],
      outPath: null,
      pass: false,
    });
    return makeReport(
      'season benchmark persistence',
      { samples: args.samples },
      {
        failures: [`persistence benchmark harness unavailable: ${(error as Error).message}`],
        payload: failedPayload,
        exitCode: 1,
      },
    );
  }
  const commitOk = report.commit.p95Ms <= report.budgets.commitP95Ms;
  const reloadOk = report.reload.p95Ms <= report.budgets.reloadP95Ms;
  const storageOk = report.storage.totalBytes <= report.budgets.storageBytes;
  const pass = commitOk && reloadOk && storageOk;
  const payload = seasonBenchmarkReportSchema.parse({
    schemaVersion: 1,
    command: 'season benchmark persistence',
    runId: 'season-benchmark-persistence',
    durationMs: 0,
    budgetMs: null,
    withinBudget: null,
    digest: null,
    identicalDigests: null,
    persistence: report,
    auditFailures: [],
    outPath: null,
    pass,
  });
  const outPath = writeBenchmarkReport(args.out, payload);
  payload.outPath = outPath;
  const details = [
    `dataset: ${String(report.dataset.summaries)} summaries · ${String(report.dataset.retainedDetails)} retained details · ${String(report.dataset.acceptedBlocks)} accepted blocks`,
    `commit p95 ${report.commit.p95Ms.toFixed(0)}ms (budget ${String(report.budgets.commitP95Ms)}ms) ${commitOk ? 'OK' : 'OVER'}`,
    `reload p95 ${report.reload.p95Ms.toFixed(0)}ms (budget ${String(report.budgets.reloadP95Ms)}ms) ${reloadOk ? 'OK' : 'OVER'}`,
    `storage ${(report.storage.totalBytes / 1024 / 1024).toFixed(1)} MB (budget ${(report.budgets.storageBytes / 1024 / 1024).toFixed(1)} MB) ${storageOk ? 'OK' : 'OVER'}`,
    `report ${outPath ?? 'not written (pass --out <path>)'}`,
  ];
  const failures: string[] = [];
  if (!commitOk) failures.push('persistence commit p95 exceeds the budget');
  if (!reloadOk) failures.push('persistence reload p95 exceeds the budget');
  if (!storageOk) failures.push('persistence storage exceeds the budget');
  return makeReport('season benchmark persistence', { samples }, { details, failures, payload });
}
