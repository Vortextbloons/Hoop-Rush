import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildManifest, buildPlayerSeason, buildPool } from '@hoop-rush/test-fixtures';
import { pearsonCorrelation } from './commands/data-defense-bpm-correlation.ts';
import { defenseBpmCorrelationReportSchema } from './report-schemas.ts';
import { expectExit2CleanManifestReport, jsonPayload, runCli, withTmpDir, } from './cli-test-helpers.ts';
const SEASON_KEY = '1996-97';
interface FixtureRow {
    playerExternalId: string;
    defense: number;
    bpm: number;
}
function writeDefenseFixture(dataRoot: string, count: number): string {
    const rows: FixtureRow[] = Array.from({ length: count }, (_, i) => {
        const defense = 40 + (i % 51);
        const noise = (((i * 2654435761) % 2001) - 1000) / 1000;
        return {
            playerExternalId: String(10000 + i),
            defense,
            bpm: 0.5 * defense - 20 + 15 * noise,
        };
    });
    const dataDir = join(dataRoot, 'apps/web/static/data');
    mkdirSync(join(dataDir, 'pools'), { recursive: true });
    writeFileSync(join(dataDir, 'pools', 'lakers-1990s.json'), JSON.stringify(buildPool(rows.map((row) => buildPlayerSeason({
        playerId: `p-${row.playerExternalId}`,
        playerExternalId: row.playerExternalId,
        summaryRatings: {
            overallRating: row.defense,
            offenseRating: 60,
            defenseRating: row.defense,
        },
        provenance: {},
    })))));
    const manifestPath = join(dataDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(buildManifest({
        pools: [
            {
                franchiseId: 'lakers',
                eraId: '1990s',
                url: 'pools/lakers-1990s.json',
                contentHash: 'a'.repeat(64),
            },
        ],
    })));
    const rawDir = join(dataRoot, 'raw-data', 'nba', SEASON_KEY);
    mkdirSync(rawDir, { recursive: true });
    writeFileSync(join(rawDir, 'season-stats.json'), JSON.stringify(rows.map((row) => ({ playerExternalId: row.playerExternalId, boxPlusMinus: row.bpm }))));
    return manifestPath;
}
describe('pearsonCorrelation', () => {
    it('returns 1 for a perfect positive linear relationship', () => {
        expect(pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 10);
    });
    it('returns -1 for a perfect negative linear relationship', () => {
        expect(pearsonCorrelation([1, 2, 3, 4, 5], [5, 4, 3, 2, 1])).toBeCloseTo(-1, 10);
    });
    it('returns 0 for uncorrelated inputs', () => {
        expect(pearsonCorrelation([1, 2, 3], [2, 1, 2])).toBeCloseTo(0, 10);
    });
    it('returns null when either input has zero variance', () => {
        expect(pearsonCorrelation([3, 3, 3], [1, 2, 3])).toBeNull();
        expect(pearsonCorrelation([1, 2, 3], [7, 7, 7])).toBeNull();
    });
    it('returns null for fewer than two pairs or mismatched lengths', () => {
        expect(pearsonCorrelation([], [])).toBeNull();
        expect(pearsonCorrelation([1], [2])).toBeNull();
        expect(pearsonCorrelation([1, 2, 3], [1, 2])).toBeNull();
    });
});
describe('cli: data defense-bpm-correlation', () => {
    it('passes when the sample clears the gate and r stays at or below 0.92', async () => {
        await withTmpDir(async (tmp) => {
            const manifestPath = writeDefenseFixture(tmp, 1050);
            const { code, stdout } = await runCli([
                'data',
                'defense-bpm-correlation',
                '--input',
                manifestPath,
                '--format',
                'json',
            ]);
            expect(code).toBe(0);
            const payload = defenseBpmCorrelationReportSchema.parse(jsonPayload(stdout));
            expect(payload.pass).toBe(true);
            expect(payload.totalRows).toBe(1050);
            expect(payload.sample).toBeGreaterThanOrEqual(1000);
            expect(payload.excluded).toBe(0);
            expect(payload.correlation).not.toBeNull();
            expect(payload.correlation).toBeGreaterThan(0);
            expect(payload.correlation).toBeLessThanOrEqual(0.92);
            expect(payload.perEra).toEqual([
                { eraId: '1990s', sample: 1050, correlation: payload.correlation },
            ]);
        });
    });
    it('fails with a sample-gate failure when fewer than 1000 rows match', async () => {
        await withTmpDir(async (tmp) => {
            const manifestPath = writeDefenseFixture(tmp, 8);
            const { code, stderr } = await runCli([
                'data',
                'defense-bpm-correlation',
                '--input',
                manifestPath,
                '--format',
                'json',
            ]);
            expect(code).toBe(1);
            expect(stderr).not.toMatch(/^\s+at /m);
            expect(stderr).toContain('1000-row gate');
            const payload = defenseBpmCorrelationReportSchema.parse(jsonPayload('', stderr));
            expect(payload.pass).toBe(false);
            expect(payload.totalRows).toBe(8);
            expect(payload.sample).toBe(8);
        });
    });
    it('exits 2 with a clean report on an invalid manifest', async () => {
        await withTmpDir((tmp) => expectExit2CleanManifestReport(['data', 'defense-bpm-correlation'], join(tmp, 'apps/web/static/data')));
    });
});
