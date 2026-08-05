import { describe, expect, it } from 'vitest';
import { HoopRushDatabase } from '../repositories/dexie.ts';
import { buildStubSeasonEngineSeam } from '../testing/season-run-fixture.ts';
import { resetIndexedDb } from '../testing/repo-test-support.ts';
import {
  benchmarkSeasonRunPersistence,
  SEASON_RUN_BUDGET_COMMIT_P95_MS,
  SEASON_RUN_BUDGET_RELOAD_P95_MS,
  SEASON_RUN_BUDGET_STORAGE_BYTES,
} from './season-run.ts';

declare const process: { env: Record<string, string | undefined> };

/**
 * Cheap budget assertions for the Season Run persistence benchmark
 * (spec/2.0/10 M2.3, spec/2.0/12 performance framework). Runs the harness
 * with the stub engine seam (documented pure fold semantics) against
 * fake-indexeddb; the full production measurement runs through the CLI
 * `season benchmark persistence` command with the engine seam.
 *
 * fake-indexeddb degrades every transaction of databases opened after the
 * first in a process, so each sample installs a fresh IDBFactory (an
 * artifact of the test substrate, not of the repository).
 *
 * Frozen budgets:
 * - commit p95 <= 300 ms per block transaction
 * - reload p95 <= 1,000 ms per full validated load
 * - active-run storage <= 25 MB of serialized rows
 *
 * The strict millisecond budgets are asserted only when
 * HOOP_RUSH_PERF_STRICT=1: fake-indexeddb timings flake by construction
 * under load, so the default run keeps the structural assertions and
 * enforces the timing budgets in the dedicated perf job.
 */
describe('season run persistence benchmark', () => {
  function freshFactoryDatabase(): HoopRushDatabase {
    resetIndexedDb();
    return new HoopRushDatabase();
  }

  it('commits and reloads the synthetic full season inside the frozen budgets', async () => {
    const report = await benchmarkSeasonRunPersistence({
      samples: 2,
      seam: buildStubSeasonEngineSeam(),
      createDatabase: freshFactoryDatabase,
    });
    expect(report.dataset).toEqual({
      summaries: 1230,
      retainedDetails: 82,
      acceptedBlocks: 9,
    });
    expect(report.commit.samples).toBe(18);
    expect(report.reload.samples).toBe(2);
    if (process.env.HOOP_RUSH_PERF_STRICT === '1') {
      expect(report.commit.p95Ms).toBeLessThanOrEqual(SEASON_RUN_BUDGET_COMMIT_P95_MS);
      expect(report.reload.p95Ms).toBeLessThanOrEqual(SEASON_RUN_BUDGET_RELOAD_P95_MS);
    }
    expect(report.storage.totalBytes).toBeLessThanOrEqual(SEASON_RUN_BUDGET_STORAGE_BYTES);
    expect(report.storage.totalBytes).toBeGreaterThan(0);
    expect(report.storage.perTable.seasonRunSummaries).toBeGreaterThan(0);
    expect(report.storage.perTable.seasonRuns).toBeGreaterThan(0);
    expect(report.storage.budgetBytes).toBe(SEASON_RUN_BUDGET_STORAGE_BYTES);
    // Per-table accounting reconciles with the total from the same report.
    const perTable = report.storage.perTable;
    expect(perTable.seasonRunSummaries ?? 0).toBeGreaterThan(perTable.seasonRunBlocks ?? 0);
    expect(perTable.seasonRunDetails ?? 0).toBeGreaterThan(perTable.seasonRunIndex ?? 0);
    const sumOfTables = Object.values(perTable).reduce((sum, value) => sum + value, 0);
    expect(sumOfTables).toBe(report.storage.totalBytes);
  }, 120_000);
});
