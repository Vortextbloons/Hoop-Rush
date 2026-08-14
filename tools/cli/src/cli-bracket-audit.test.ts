import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bracketAuditReportSchema } from './report-schemas.ts';
import {
  jsonPayload,
  REPO_ROOT,
  runCli,
  withTmpDir,
  writeManifestWithBracket,
} from './cli-test-helpers.ts';

describe('cli: bracket audit', () => {
  it('validates the frozen bracket and emits a stable report', async () => {
    const { code, stdout } = await runCli(['bracket', 'audit', '--format', 'json']);
    expect(code).toBe(0);
    const payload = bracketAuditReportSchema.parse(jsonPayload(stdout));
    expect(payload.pass).toBe(true);
    expect(payload.opponents).toHaveLength(30);
    expect(payload.openingOpponentUnchanged).toBe(true);
    expect(payload.generationSeed).toHaveLength(32);
    expect(payload.schedulePreview).toHaveLength(82);
    expect(payload.leagueMedianPercentile).toBeGreaterThanOrEqual(0.4);
    expect(payload.leagueMedianPercentile).toBeLessThanOrEqual(0.52);
  });

  it('exits 1 when the bracket fails validation', async () => {
    await withTmpDir(async (tmp) => {
      const packaged = JSON.parse(
        readFileSync(join(REPO_ROOT, 'apps/web/static/data/opponents/bracket.json'), 'utf8'),
      ) as { schedule: Array<{ gameNumber: number; opponentId: string }> };
      const repeated = packaged.schedule.map((entry, index) =>
        index === 1 ? { ...entry, opponentId: packaged.schedule[0]?.opponentId ?? '' } : entry,
      );
      const badBracketPath = join(tmp, 'bad-bracket.json');
      const badBracket = JSON.stringify({ ...packaged, schedule: repeated });
      writeFileSync(badBracketPath, badBracket);
      const opponentsDir = join(tmp, 'opponents');
      mkdirSync(opponentsDir, { recursive: true });
      copyFileSync(
        join(REPO_ROOT, 'apps/web/static/data/opponents/lakers-1990s-opening.json'),
        join(opponentsDir, 'lakers-1990s-opening.json'),
      );
      const badManifestPath = writeManifestWithBracket(tmp, badBracketPath, badBracket);
      const { code, stderr } = await runCli(['bracket', 'audit', '--input', badManifestPath]);
      expect(code).toBe(1);

      expect(stderr).not.toMatch(/^\s+at /m);
      expect(stderr).toContain('schedule');
    });
  });

  it('exits 2 with a clean report when the opening preview is missing', async () => {
    await withTmpDir(async (tmp) => {
      const packaged = JSON.parse(
        readFileSync(join(REPO_ROOT, 'apps/web/static/data/opponents/bracket.json'), 'utf8'),
      ) as { schedule: Array<{ gameNumber: number; opponentId: string }> };
      const missingDir = join(tmp, 'missing-preview');
      mkdirSync(missingDir, { recursive: true });
      const bracketPath = join(missingDir, 'bracket.json');
      const content = JSON.stringify(packaged);
      writeFileSync(bracketPath, content);
      const manifestPath = writeManifestWithBracket(missingDir, bracketPath, content);
      const { code, stderr } = await runCli(['bracket', 'audit', '--input', manifestPath]);
      expect(code).toBe(2);
      expect(stderr).not.toMatch(/^\s+at /m);
    });
  });
});
