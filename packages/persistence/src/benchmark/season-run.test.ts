import { describe, expect, it } from 'vitest';
import { HoopRushDatabase } from '../repositories/dexie.ts';
import { buildStubSeasonEngineSeam } from '../testing/season-run-fixture.ts';
import { resetIndexedDb } from '../testing/repo-test-support.ts';
import { benchmarkSeasonRunPersistence, SEASON_RUN_BUDGET_COMMIT_P95_MS, SEASON_RUN_BUDGET_RELOAD_P95_MS, SEASON_RUN_BUDGET_STORAGE_BYTES, } from './season-run.ts';
declare const process: {
    env: Record<string, string | undefined>;
};
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
        const perTable = report.storage.perTable;
        expect(perTable.seasonRunSummaries ?? 0).toBeGreaterThan(perTable.seasonRunBlocks ?? 0);
        expect(perTable.seasonRunDetails ?? 0).toBeGreaterThan(perTable.seasonRunIndex ?? 0);
        const sumOfTables = Object.values(perTable).reduce((sum, value) => sum + value, 0);
        expect(sumOfTables).toBe(report.storage.totalBytes);
    }, 120000);
});
