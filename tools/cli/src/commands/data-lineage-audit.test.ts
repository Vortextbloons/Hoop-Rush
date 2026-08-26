import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HoopRushManifest } from '@hoop-rush/data-contracts';
import { buildManifest } from '@hoop-rush/test-fixtures';
import { dataLineageAudit } from './data-lineage-audit.ts';
import { EXIT_CHECKS_FAILED, EXIT_OK } from '../report.ts';
let dir: string;
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hoop-rush-lineage-'));
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
});
async function writeManifest(manifest: HoopRushManifest): Promise<string> {
    const path = join(dir, 'manifest.json');
    await writeFile(path, JSON.stringify(manifest));
    return path;
}
describe('dataLineageAudit logo metadata', () => {
    it('passes when every segment carries verified logo candidates', async () => {
        const path = await writeManifest(buildManifest());
        const report = await dataLineageAudit({ input: path });
        expect(report.ok).toBe(true);
        expect(report.exitCode).toBe(EXIT_OK);
        expect(report.failures).toEqual([]);
        const payload = report.payload as {
            logoFailures: string[];
            segmentCount: number;
        };
        expect(payload.segmentCount).toBe(4);
        expect(payload.logoFailures).toEqual([]);
    });
    it('flags segments without logo candidates', async () => {
        const manifest = buildManifest({
            franchiseLineage: [
                {
                    modernFranchiseId: 'lakers',
                    historicalTeamId: '1610612747',
                    validFromSeasonKey: '1960-61',
                    displayName: 'Los Angeles Lakers',
                    city: 'Los Angeles',
                    abbreviation: 'LAL',
                    sourceIdentityIds: ['1610612747'],
                    lineageRuleVersion: 'lineage-v1',
                },
            ],
        });
        const path = await writeManifest(manifest);
        const report = await dataLineageAudit({ input: path });
        expect(report.ok).toBe(false);
        expect(report.exitCode).toBe(EXIT_CHECKS_FAILED);
        const payload = report.payload as {
            logoFailures: string[];
        };
        expect(payload.logoFailures[0]).toMatch(/has no logo candidates/);
    });
    it('flags non-https logo candidate URLs', async () => {
        const manifest = buildManifest();
        const lineage = manifest.franchiseLineage.map((segment, index) => ({
            ...segment,
            logoCandidates: [
                {
                    url: index === 0 ? 'http://example.com/logo.png' : 'https://example.com/logo.png',
                    source: 'test',
                },
            ],
        }));
        const path = await writeManifest(buildManifest({ franchiseLineage: lineage }));
        const report = await dataLineageAudit({ input: path });
        expect(report.ok).toBe(false);
        const payload = report.payload as {
            logoFailures: string[];
        };
        expect(payload.logoFailures.some((f) => f.includes('must be https'))).toBe(true);
    });
});
describe('dataLineageAudit --verify-logos', () => {
    function imageResponse(contentType: string): () => Promise<Response> {
        return () => {
            const buffer = new Uint8Array(2048).fill(0);
            return Promise.resolve(new Response(buffer, { status: 200, headers: { 'content-type': contentType } }));
        };
    }
    it('verifies reachable primary candidates as images', async () => {
        vi.stubGlobal('fetch', vi.fn(imageResponse('image/png')));
        const path = await writeManifest(buildManifest());
        const report = await dataLineageAudit({ input: path, verifyLogos: true });
        expect(report.ok).toBe(true);
        const payload = report.payload as {
            logoVerificationFailures: string[];
        };
        expect(payload.logoVerificationFailures).toEqual([]);
    });
    it('fails on unreachable primary candidates', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 404 }))));
        const path = await writeManifest(buildManifest());
        const report = await dataLineageAudit({ input: path, verifyLogos: true });
        expect(report.ok).toBe(false);
        const payload = report.payload as {
            logoVerificationFailures: string[];
        };
        expect(payload.logoVerificationFailures.length).toBeGreaterThan(0);
        expect(payload.logoVerificationFailures[0]).toMatch(/returned HTTP 404/);
    });
    it('fails on non-image primary candidates', async () => {
        vi.stubGlobal('fetch', vi.fn(imageResponse('text/html')));
        const path = await writeManifest(buildManifest());
        const report = await dataLineageAudit({ input: path, verifyLogos: true });
        expect(report.ok).toBe(false);
        const payload = report.payload as {
            logoVerificationFailures: string[];
        };
        expect(payload.logoVerificationFailures[0]).toMatch(/is not an image/);
    });
});
