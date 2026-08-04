import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildManifest, buildPlayerSeason, buildPool } from '@hoop-rush/test-fixtures';
import { overallsDistributionReportSchema } from './report-schemas.js';
import { jsonPayload, runCli, TMP } from './cli-test-helpers.js';

/**
 * CLI integration tests for `data overalls-distribution` (spec: cohort
 * percentile check): band counts/percentages/medians over every packaged
 * row, per-era breakdowns, and a clean exit-2 report on an invalid manifest.
 */

interface FixturePlayer {
  overall: number;
  externalId: string;
  seasonKey: string;
}

interface FixturePool {
  franchiseId: string;
  eraId: string;
  players: FixturePlayer[];
}

/** Writes a manifest + pool files under the apps/web/static/data layout. */
function writeOverallsFixture(subdir: string, pools: FixturePool[]): string {
  const dataDir = join(TMP, subdir, 'apps/web/static/data');
  const poolsDir = join(dataDir, 'pools');
  mkdirSync(poolsDir, { recursive: true });
  const refs = pools.map(({ franchiseId, eraId, players }) => {
    const url = `pools/${franchiseId}-${eraId}.json`;
    writeFileSync(
      join(poolsDir, `${franchiseId}-${eraId}.json`),
      JSON.stringify(
        buildPool(
          players.map(({ overall, externalId, seasonKey }) =>
            buildPlayerSeason({
              playerId: `p-${externalId}`,
              playerExternalId: externalId,
              eraId,
              seasonKey,
              summaryRatings: { overallRating: overall, offenseRating: 60, defenseRating: 60 },
            }),
          ),
          { franchiseId, eraId },
        ),
      ),
    );
    return { franchiseId, eraId, url, contentHash: 'a'.repeat(64) };
  });
  const manifestPath = join(dataDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(buildManifest({ pools: refs })));
  return manifestPath;
}

function bandOf(bands: readonly { label: string }[], label: string) {
  const found = bands.find((band) => band.label === label);
  expect(found).toBeDefined();
  return found;
}

describe('cli: data overalls-distribution', () => {
  it('reports band counts, percentages, medians, and per-era breakdowns', async () => {
    const manifestPath = writeOverallsFixture('overalls-bands', [
      {
        franchiseId: 'lakers',
        eraId: '1990s',
        players: [
          { overall: 95, externalId: '1001', seasonKey: '1996-97' },
          { overall: 97, externalId: '1002', seasonKey: '1996-97' },
          { overall: 90, externalId: '1003', seasonKey: '1996-97' },
          { overall: 85, externalId: '1004', seasonKey: '1996-97' },
          { overall: 80, externalId: '1005', seasonKey: '1996-97' },
          { overall: 60, externalId: '1006', seasonKey: '1996-97' },
        ],
      },
      {
        franchiseId: 'celtics',
        eraId: '2000s',
        players: [
          { overall: 92, externalId: '2001', seasonKey: '2005-06' },
          { overall: 88, externalId: '2002', seasonKey: '2005-06' },
          { overall: 72, externalId: '2003', seasonKey: '2005-06' },
          { overall: 84, externalId: '2004', seasonKey: '2005-06' },
          { overall: 40, externalId: '2005', seasonKey: '2005-06' },
          { overall: 71, externalId: '2006', seasonKey: '2005-06' },
        ],
      },
    ]);
    const { code, stdout } = await runCli([
      'data',
      'overalls-distribution',
      '--input',
      manifestPath,
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = overallsDistributionReportSchema.parse(jsonPayload(stdout));
    expect(payload.dataVersion).toBe('data-v1');
    expect(payload.total).toBe(12);
    expect(payload.overall).toMatchObject({
      median: 85,
      range: [40, 97],
      min: 40,
      max: 97,
      sample: 12,
    });
    expect(payload.bands.map((band) => band.label)).toEqual([
      '95-99',
      '90-94',
      '85-89',
      '72-84',
      '40-71',
    ]);

    const overall = {
      '95-99': { count: 2, percentage: 16.7, median: 97 },
      '90-94': { count: 2, percentage: 16.7, median: 92 },
      '85-89': { count: 2, percentage: 16.7, median: 88 },
      '72-84': { count: 3, percentage: 25, median: 80 },
      '40-71': { count: 3, percentage: 25, median: 60 },
    };
    for (const [label, expected] of Object.entries(overall)) {
      expect(bandOf(payload.bands, label)).toMatchObject(expected);
    }

    expect(Object.keys(payload.perEra)).toEqual(['1990s', '2000s']);
    const nineties = payload.perEra['1990s'];
    expect(nineties?.count).toBe(6);
    expect(bandOf(nineties?.bands ?? [], '95-99')).toMatchObject({
      count: 2,
      percentage: 33.3,
      median: 97,
    });
    expect(bandOf(nineties?.bands ?? [], '40-71')).toMatchObject({
      count: 1,
      percentage: 16.7,
      median: 60,
    });
    const twoThousands = payload.perEra['2000s'];
    expect(twoThousands?.count).toBe(6);
    expect(bandOf(twoThousands?.bands ?? [], '95-99')).toMatchObject({
      count: 0,
      percentage: 0,
      median: null,
    });
    expect(bandOf(twoThousands?.bands ?? [], '72-84')).toMatchObject({
      count: 2,
      percentage: 33.3,
      median: 84,
    });
    expect(bandOf(twoThousands?.bands ?? [], '40-71')).toMatchObject({
      count: 2,
      percentage: 33.3,
      median: 71,
    });
  });

  it('exits 2 with a clean report on an invalid manifest', async () => {
    const dataDir = join(TMP, 'overalls-invalid', 'apps/web/static/data');
    mkdirSync(dataDir, { recursive: true });
    const manifestPath = join(dataDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 3, dataVersion: '' }));
    const { code, stderr } = await runCli([
      'data',
      'overalls-distribution',
      '--input',
      manifestPath,
      '--format',
      'json',
    ]);
    expect(code).toBe(2);
    expect(stderr).not.toMatch(/^\s+at /m);
    const report = JSON.parse(stderr.slice(stderr.indexOf('{'))) as {
      exitCode: number;
      failures: string[];
    };
    expect(report.exitCode).toBe(2);
    expect(report.failures[0]).toContain('manifest');
  });
});
