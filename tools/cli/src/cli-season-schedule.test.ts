import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seasonRunSchema } from '@hoop-rush/data-contracts';
import {
  seasonScheduleAuditReportSchema,
  seasonScheduleGenerateReportSchema,
} from './report-schemas.js';
import { jsonPayload, REPO_ROOT, runCli, TMP } from './cli-test-helpers.js';

/**
 * CLI integration tests for `season schedule generate` and `season schedule
 * audit` (spec/2.0 M2.0): preview/hash reports, explicit writes, packaged
 * artifact audit, regeneration identity, manifest hash cross-checks, invalid
 * inputs, and exit codes.
 */

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
    const versionIds = parsed.rosters.flatMap((roster) =>
      roster.players.map((p) => p.playerVersionId),
    );
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

  it('writes the artifact only with an explicit --out path', async () => {
    const outPath = join(TMP, 'generated-schedule.json');
    const { code, stdout } = await runCli([
      'season',
      'schedule',
      'generate',
      '--out',
      outPath,
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = seasonScheduleGenerateReportSchema.parse(jsonPayload(stdout));
    expect(payload.wrote).toBe(true);
    expect(payload.outPath).toBe(outPath);
    const written = readFileSync(outPath, 'utf8');
    expect(createHash('sha256').update(written).digest('hex')).toBe(payload.sha256);
    const parsed = JSON.parse(written) as { games: unknown[]; rounds: number };
    expect(parsed.games).toHaveLength(1230);
    expect(parsed.rounds).toBe(82);
  });

  it('regenerates byte-identically across runs', async () => {
    const first = join(TMP, 'schedule-a.json');
    const second = join(TMP, 'schedule-b.json');
    const run = (out: string) =>
      runCli(['season', 'schedule', 'generate', '--out', out, '--format', 'json']);
    expect((await run(first)).code).toBe(0);
    expect((await run(second)).code).toBe(0);
    expect(readFileSync(first, 'utf8')).toBe(readFileSync(second, 'utf8'));
  });

  it('produces a different artifact under a different seed', async () => {
    const { code, stdout } = await runCli([
      'season',
      'schedule',
      'generate',
      '--seed',
      'feedfacefeedfacefeedfacefeedface',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = seasonScheduleGenerateReportSchema.parse(jsonPayload(stdout));
    const committed = seasonScheduleGenerateReportSchema.parse(
      jsonPayload((await runCli(['season', 'schedule', 'generate', '--format', 'json'])).stdout),
    );
    expect(payload.sha256).not.toBe(committed.sha256);
  });

  it('rejects a malformed seed with exit 2', async () => {
    const { code, stderr } = await runCli([
      'season',
      'schedule',
      'generate',
      '--seed',
      'not-a-seed',
      '--format',
      'json',
    ]);
    expect(code).toBe(2);
    expect(stderr).not.toMatch(/^\s+at /m);
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
    const packaged = JSON.parse(readFileSync(join(REPO_ROOT, PACKAGED_SCHEDULE), 'utf8')) as {
      games: Array<{ gameId: string; homeFranchiseId: string; awayFranchiseId: string }>;
    };
    const swapped = packaged.games.map((game, index) =>
      index === 0
        ? { ...game, homeFranchiseId: game.awayFranchiseId, awayFranchiseId: game.homeFranchiseId }
        : game,
    );
    const badPath = join(TMP, 'bad-schedule.json');
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

  it('exits 2 with a clean report when an artifact is missing', async () => {
    const missing = join(TMP, 'missing-schedule.json');
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

  it('reports a manifest content hash mismatch', async () => {
    const leagueContent = readFileSync(join(REPO_ROOT, PACKAGED_LEAGUE), 'utf8');
    const scheduleContent = readFileSync(join(REPO_ROOT, PACKAGED_SCHEDULE), 'utf8');
    const manifestDir = join(TMP, 'manifest-season');
    const leagueUrl = join(manifestDir, 'season', 'league.json');
    const scheduleUrl = join(manifestDir, 'season', 'schedule.json');
    mkdirSync(dirname(leagueUrl), { recursive: true });
    writeFileSync(leagueUrl, leagueContent);
    writeFileSync(scheduleUrl, scheduleContent);
    const manifestPath = join(manifestDir, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        dataVersion: 'm2.0',
        season: {
          league: {
            url: leagueUrl,
            contentHash: createHash('sha256').update(leagueContent).digest('hex'),
          },
          schedule: { url: scheduleUrl, contentHash: '0'.repeat(64) },
        },
      }),
    );
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
