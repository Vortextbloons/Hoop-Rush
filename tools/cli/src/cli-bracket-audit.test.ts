import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bracketAuditReportSchema } from './report-schemas.js';
import { jsonPayload, REPO_ROOT, runCli, TMP } from './cli-test-helpers.js';

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
    expect(payload.leagueMedianPercentile).toBeGreaterThanOrEqual(0.45);
    expect(payload.leagueMedianPercentile).toBeLessThanOrEqual(0.6);
  });

  it('exits 1 when the bracket fails validation', async () => {
    // A schema-valid bracket with an immediate schedule repeat fails the
    // schedule audit (checked failure, exit 1) rather than a data-load
    // error (exit 2).
    const packaged = JSON.parse(
      readFileSync(join(REPO_ROOT, 'apps/web/static/data/opponents/bracket.json'), 'utf8'),
    ) as { schedule: Array<{ gameNumber: number; opponentId: string }> };
    const repeated = packaged.schedule.map((entry, index) =>
      index === 1 ? { ...entry, opponentId: packaged.schedule[0]?.opponentId ?? '' } : entry,
    );
    const badBracketPath = join(TMP, 'bad-bracket.json');
    writeFileSync(badBracketPath, JSON.stringify({ ...packaged, schedule: repeated }));
    const badManifestPath = join(TMP, 'bad-manifest.json');
    writeFileSync(
      badManifestPath,
      JSON.stringify({
        schemaVersion: 1,
        dataVersion: 'm1.5',
        franchiseLineage: [],
        eras: [],
        pools: [],
        eraSimulationProfiles: [],
        bracket: {
          url: badBracketPath,
          contentHash: '0'.repeat(64),
        },
        assets: {
          headshotUrlTemplate: null,
          headshotUrlTemplateSecondary: null,
          logoUrlTemplate: null,
          logoUrlTemplateSecondary: null,
          source: 'example',
          cacheVersion: 'v1',
        },
      }),
    );
    const { code } = await runCli(['bracket', 'audit', '--input', badManifestPath]);
    expect(code).toBe(1);
  });
});
