import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seasonRunSchema } from '@hoop-rush/data-contracts';
import { seasonScheduleAuditReportSchema, seasonScheduleGenerateReportSchema, } from './report-schemas.ts';
import { jsonPayload, REPO_ROOT, runCli, withTmpDir } from './cli-test-helpers.ts';
const PACKAGED_LEAGUE = 'apps/web/static/data/season/league.json';
const PACKAGED_SCHEDULE = 'apps/web/static/data/season/schedule.json';
describe('cli: committed Season Run fixture', () => {
    it('is a complete, schema-valid 30-team season snapshot', () => {
        const fixturePath = join(REPO_ROOT, 'tools/cli/src/fixtures/season-run.json');
        const parsed = seasonRunSchema.parse(JSON.parse(readFileSync(fixturePath, 'utf8')));
        expect(parsed.rosters).toHaveLength(30);
        expect(parsed.ownership).toHaveLength(300);
        expect(parsed.games).toHaveLength(1230);
        expect(parsed.cursor.completedRounds).toBe(0);
        const versionIds = parsed.rosters.flatMap((roster) => roster.players.map((p) => p.playerVersionId));
        expect(new Set(versionIds).size).toBe(300);
        expect(parsed.postseason.bracket).toBeNull();
    });
});
describe('cli: season schedule generate', () => {
    it('emits a preview/hash report without writing', async () => {
        const { code, stdout } = await runCli(['season', 'schedule', 'generate', '--format', 'json']);
        expect(code).toBe(0);
        const payload = seasonScheduleGenerateReportSchema.parse(jsonPayload(stdout));
        expect(payload.pass).toBe(true);
        expect(payload.wrote).toBe(false);
        expect(payload.outPath).toBeNull();
        expect(payload.rounds).toBe(82);
        expect(payload.games).toBe(1230);
        expect(payload.sha256).toMatch(/^[0-9a-f]{64}$/);
    });
    it('writes the artifact with --out, regenerates byte-identically, and diverges under a different seed', async () => {
        await withTmpDir(async (tmp) => {
            const first = join(tmp, 'schedule-a.json');
            const second = join(tmp, 'schedule-b.json');
            const seeded = join(tmp, 'schedule-seeded.json');
            const run = (out: string, seed?: string) => runCli([
                'season',
                'schedule',
                'generate',
                ...(seed === undefined ? [] : ['--seed', seed]),
                '--out',
                out,
                '--format',
                'json',
            ]);
            const { code, stdout } = await run(first);
            expect(code).toBe(0);
            const payload = seasonScheduleGenerateReportSchema.parse(jsonPayload(stdout));
            expect(payload.wrote).toBe(true);
            expect(payload.outPath).toBe(first);
            const written = readFileSync(first, 'utf8');
            expect(createHash('sha256').update(written).digest('hex')).toBe(payload.sha256);
            const parsed = JSON.parse(written) as {
                games: unknown[];
                rounds: number;
            };
            expect(parsed.games).toHaveLength(1230);
            expect(parsed.rounds).toBe(82);
            const secondRun = await run(second);
            expect(secondRun.code).toBe(0);
            expect(readFileSync(second, 'utf8')).toBe(written);
            const seededRun = await run(seeded, 'feedfacefeedfacefeedfacefeedface');
            expect(seededRun.code).toBe(0);
            const seededPayload = seasonScheduleGenerateReportSchema.parse(jsonPayload(seededRun.stdout));
            expect(seededPayload.sha256).not.toBe(payload.sha256);
            expect(readFileSync(seeded, 'utf8')).not.toBe(written);
        });
    });
});
describe('cli: season schedule audit', () => {
    it('passes the packaged league and schedule artifacts', async () => {
        const { code, stdout } = await runCli(['season', 'schedule', 'audit', '--format', 'json']);
        expect(code).toBe(0);
        const payload = seasonScheduleAuditReportSchema.parse(jsonPayload(stdout));
        expect(payload.pass).toBe(true);
        expect(payload.auditFailures).toBe(0);
        expect(payload.regenerationIdentical).toBe(true);
        expect(payload.manifestVerified).toBe(true);
        expect(payload.games).toBe(1230);
        expect(payload.rounds).toBe(82);
    });
    it('exits 1 with a clean report on a corrupted schedule artifact', async () => {
        await withTmpDir(async (tmp) => {
            const packaged = JSON.parse(readFileSync(join(REPO_ROOT, PACKAGED_SCHEDULE), 'utf8')) as {
                games: Array<{
                    gameId: string;
                    homeFranchiseId: string;
                    awayFranchiseId: string;
                }>;
            };
            const swapped = packaged.games.map((game, index) => index === 0
                ? {
                    ...game,
                    homeFranchiseId: game.awayFranchiseId,
                    awayFranchiseId: game.homeFranchiseId,
                }
                : game);
            const badPath = join(tmp, 'bad-schedule.json');
            writeFileSync(badPath, JSON.stringify({ ...packaged, games: swapped }));
            const { code, stderr } = await runCli([
                'season',
                'schedule',
                'audit',
                '--schedule',
                badPath,
                '--format',
                'json',
            ]);
            expect(code).toBe(1);
            expect(stderr).not.toMatch(/^\s+at /m);
            const payload = seasonScheduleAuditReportSchema.parse(jsonPayload('', stderr));
            expect(payload.pass).toBe(false);
            expect(payload.regenerationIdentical).toBe(false);
        });
    });
    it('exits 2 with a clean report when an artifact is missing', async () => {
        await withTmpDir(async (tmp) => {
            const missing = join(tmp, 'missing-schedule.json');
            const { code, stderr } = await runCli([
                'season',
                'schedule',
                'audit',
                '--schedule',
                missing,
                '--format',
                'json',
            ]);
            expect(code).toBe(2);
            expect(stderr).not.toMatch(/^\s+at /m);
        });
    });
    it('reports a manifest content hash mismatch', async () => {
        await withTmpDir(async (tmp) => {
            const leagueContent = readFileSync(join(REPO_ROOT, PACKAGED_LEAGUE), 'utf8');
            const scheduleContent = readFileSync(join(REPO_ROOT, PACKAGED_SCHEDULE), 'utf8');
            const manifestDir = join(tmp, 'manifest-season');
            const leagueUrl = join(manifestDir, 'season', 'league.json');
            const scheduleUrl = join(manifestDir, 'season', 'schedule.json');
            mkdirSync(dirname(leagueUrl), { recursive: true });
            writeFileSync(leagueUrl, leagueContent);
            writeFileSync(scheduleUrl, scheduleContent);
            const manifestPath = join(manifestDir, 'manifest.json');
            writeFileSync(manifestPath, JSON.stringify({
                schemaVersion: 1,
                dataVersion: 'm2.0',
                season: {
                    league: {
                        url: leagueUrl,
                        contentHash: createHash('sha256').update(leagueContent).digest('hex'),
                    },
                    schedule: { url: scheduleUrl, contentHash: '0'.repeat(64) },
                },
            }));
            const { code, stderr } = await runCli([
                'season',
                'schedule',
                'audit',
                '--manifest',
                manifestPath,
                '--format',
                'json',
            ]);
            expect(code).toBe(1);
            expect(stderr).not.toMatch(/^\s+at /m);
            const payload = seasonScheduleAuditReportSchema.parse(jsonPayload('', stderr));
            expect(payload.manifestVerified).toBe(false);
            expect(payload.pass).toBe(false);
        });
    });
});
