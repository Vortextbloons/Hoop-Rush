import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildManifest } from '@hoop-rush/test-fixtures';
import { EXIT_OK, EXIT_USAGE_OR_DATA_ERROR } from '../report.ts';
import { dataCoverage } from './data-coverage.ts';
let dir: string;
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hoop-rush-coverage-'));
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});
describe('dataCoverage', () => {
    it('reports a missing manifest as a usage/data error', async () => {
        const report = await dataCoverage({ input: join(dir, 'missing.json') });
        expect(report.ok).toBe(false);
        expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
        expect(report.failures[0]).toContain('manifest not found or unreadable');
    });
    it('reports invalid JSON as a usage/data error', async () => {
        const path = join(dir, 'manifest.json');
        await writeFile(path, 'not json', 'utf8');
        const report = await dataCoverage({ input: path });
        expect(report.ok).toBe(false);
        expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
        expect(report.failures[0]).toContain('not valid JSON');
    });
    it('reports a manifest that fails the schema', async () => {
        const path = join(dir, 'manifest.json');
        await writeFile(path, JSON.stringify({ schemaVersion: 99 }), 'utf8');
        const report = await dataCoverage({ input: path });
        expect(report.ok).toBe(false);
        expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
        expect(report.failures[0]).toContain('manifest fails the schema');
    });
    it('aggregates the availability matrix of a valid manifest', async () => {
        const path = join(dir, 'manifest.json');
        await writeFile(path, JSON.stringify(buildManifest()), 'utf8');
        const report = await dataCoverage({ input: path });
        expect(report.ok).toBe(true);
        expect(report.exitCode).toBe(EXIT_OK);
        const payload = report.payload as {
            matrixSize: number;
            available: number;
            unavailable: number;
            byReason: Record<string, number>;
            rows: Array<{
                status: string;
            }>;
        };
        expect(payload.matrixSize).toBe(30 * 7);
        expect(payload.available).toBe(0);
        expect(payload.unavailable).toBe(30 * 7);
        expect(payload.byReason['source-incomplete']).toBe(30 * 7);
    });
    it('filters rows by franchise and status', async () => {
        const path = join(dir, 'manifest.json');
        await writeFile(path, JSON.stringify(buildManifest()), 'utf8');
        const lakers = await dataCoverage({ input: path, franchise: 'lakers' });
        const payload = lakers.payload as {
            matrixSize: number;
            rows: Array<{
                franchiseId: string;
            }>;
        };
        expect(payload.matrixSize).toBe(7);
        expect(payload.rows.every((row) => row.franchiseId === 'lakers')).toBe(true);
        const available = await dataCoverage({ input: path, status: 'available' });
        expect((available.payload as {
            matrixSize: number;
        }).matrixSize).toBe(0);
    });
});
