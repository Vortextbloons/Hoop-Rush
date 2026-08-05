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
    // A schema-valid bracket with an immediate schedule repeat fails the
    // schedule audit (checked failure, exit 1) rather than a data-load
    // error (exit 2). The manifest hash matches the edited artifact so the
    // schedule repeat — not the hash check — is what triggers the failure,
    // and the opening-opponent preview is present so the report is clean.
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
      // The failure must be a clean report — the schedule repeat — not a
      // stack trace from a missing preview artifact. Failed reports are
      // written to stderr (index.ts), so assert on the report there.
      expect(stderr).not.toMatch(/^\s+at /m);
      expect(stderr).toContain('schedule');
    });
  });

  it('exits 2 with a clean report when the opening preview is missing', async () => {
    // Regression guard: a missing opponents preview next to a valid manifest
    // is a data-load error (exit 2 per spec/09), not an uncaught crash.
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
