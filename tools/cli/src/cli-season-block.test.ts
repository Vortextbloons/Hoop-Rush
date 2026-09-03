import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { seasonCandidateCheckpointSchema } from '@hoop-rush/data-contracts';
import { seasonBlockAuditReportSchema, seasonBlockSimulateReportSchema, seasonFullSimulateReportSchema, } from './report-schemas.ts';
import { jsonPayload, REPO_ROOT, runCli, TMP } from './cli-test-helpers.ts';
const SEASON_RUN = join(REPO_ROOT, 'tools/cli/src/fixtures/season-run.json');
const BLOCK_ZERO_DIGEST = 'b4a56279ab857e9567e8a0f3f4c7d749';
describe('cli: season block simulate', () => {
    let blockZero: Awaited<ReturnType<typeof runCli>>;
    beforeAll(async () => {
        blockZero = await runCli([
            'season',
            'block',
            'simulate',
            '--input',
            SEASON_RUN,
            '--format',
            'json',
        ]);
    }, 60000);
    it('simulates block 0 over the committed fixture with a clean audit', () => {
        const { code, stdout, stderr } = blockZero;
        expect(code).toBe(0);
        const payload = seasonBlockSimulateReportSchema.parse(jsonPayload(stdout, stderr));
        expect(payload.pass).toBe(true);
        expect(payload.blockIndex).toBe(0);
        expect(payload.summaryCount).toBe(150);
        expect(payload.retainedDetailCount).toBe(10);
        expect(payload.completedRounds).toBe(10);
        expect(payload.digest).toBe(BLOCK_ZERO_DIGEST);
        expect(payload.auditFailures).toEqual([]);
    });
    it('accepts an explicit --block and rejects an out-of-range block', async () => {
        const ok = await runCli([
            'season',
            'block',
            'simulate',
            '--input',
            SEASON_RUN,
            '--block',
            '0',
            '--format',
            'json',
        ]);
        expect(ok.code).toBe(0);
        const bad = await runCli([
            'season',
            'block',
            'simulate',
            '--input',
            SEASON_RUN,
            '--block',
            '9',
            '--format',
            'json',
        ]);
        expect(bad.code).not.toBe(0);
    });
    it('audits a saved candidate checkpoint with digest verification', async () => {
        const { code, stdout, stderr } = blockZero;
        expect(code).toBe(0);
        const simulate = seasonBlockSimulateReportSchema.parse(jsonPayload(stdout, stderr));
        expect(simulate.pass).toBe(true);
        const checkpointPath = join(TMP, 'block0-checkpoint.json');
        const candidate = await produceBlockZeroCheckpoint();
        writeFileSync(checkpointPath, `${JSON.stringify(candidate, null, 2)}\n`);
        const audit = await runCli([
            'season',
            'block',
            'audit',
            '--input',
            checkpointPath,
            '--run',
            SEASON_RUN,
            '--format',
            'json',
        ]);
        expect(audit.code).toBe(0);
        const payload = seasonBlockAuditReportSchema.parse(jsonPayload(audit.stdout, audit.stderr));
        expect(payload.pass).toBe(true);
        expect(payload.digest).toBe(payload.recomputedDigest);
        expect(payload.digest).toBe(BLOCK_ZERO_DIGEST);
        expect(payload.auditFailures).toEqual([]);
    });
});
describe('cli: season full simulate', () => {
    it('runs all nine blocks and reports deterministic per-block digests', async () => {
        const { code, stdout, stderr } = await runCli([
            'season',
            'full',
            'simulate',
            '--input',
            SEASON_RUN,
            '--format',
            'json',
        ]);
        expect(code).toBe(0);
        const report = seasonFullSimulateReportSchema.parse(jsonPayload(stdout, stderr));
        expect(report.pass).toBe(true);
        expect(report.blockDigests).toHaveLength(9);
        expect(report.summaries).toBe(1230);
        expect(report.blockDigests[0]?.digest).toBe(BLOCK_ZERO_DIGEST);
        expect(report.blockDigests[8]?.digest).toBe(report.finalDigest);
    }, 300000);
});
async function produceBlockZeroCheckpoint(): Promise<ReturnType<typeof seasonCandidateCheckpointSchema.parse>> {
    const { seasonRunSchema } = await import('@hoop-rush/data-contracts');
    const { createSeasonBlockRunner, rollForwardTo, runBlockThroughHandler } = await import('../src/commands/season-block.ts');
    const state = createSeasonBlockRunner({ runPath: SEASON_RUN });
    rollForwardTo(state, 0);
    const checkpoint = runBlockThroughHandler(state, 0);
    const parsed = seasonRunSchema.safeParse(JSON.parse(readFileSync(SEASON_RUN, 'utf8')));
    expect(parsed.success).toBe(true);
    return seasonCandidateCheckpointSchema.parse(checkpoint);
}
