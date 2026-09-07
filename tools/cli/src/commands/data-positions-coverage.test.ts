import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, buildPlayerSeason, buildPool } from '@hoop-rush/test-fixtures';
import {
  contentHashSchema,
  playerIdSchema,
  type PeakPlayerSeason,
} from '@hoop-rush/data-contracts';
import { dataPositionsCoverage } from './data-positions-coverage.ts';
import { EXIT_USAGE_OR_DATA_ERROR } from '../report.ts';
import { positionsCoverageReportSchema } from '../report-schemas.ts';

async function writeManifest(dir: string, players: PeakPlayerSeason[]): Promise<string> {
  const poolPath = join(dir, 'pool.json');
  const pool = buildPool(players);
  await writeFile(poolPath, JSON.stringify(pool));
  const manifestPath = join(dir, 'manifest.json');
  await writeFile(
    manifestPath,
    JSON.stringify(
      buildManifest({
        pools: [
          {
            franchiseId: pool.franchiseId,
            eraId: pool.eraId,
            url: 'pool.json',
            contentHash: contentHashSchema.parse('a'.repeat(64)),
          },
        ],
      }),
    ),
  );
  return manifestPath;
}

describe('dataPositionsCoverage', () => {
  it('passes when PG and PF primaries are present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hoop-rush-positions-ok-'));
    try {
      const pointGuard = buildPlayerSeason({
        playerId: playerIdSchema.parse('p-pg'),
        displayName: 'Test Point',
        positions: {
          primary: 'PG',
          secondary: [],
          playable: ['PG', 'SG'],
          sourceLabels: ['PG'],
          normalizationVersion: 'position-v3',
        },
      });
      const powerForward = buildPlayerSeason({
        playerId: playerIdSchema.parse('p-pf'),
        displayName: 'Test Forward',
        positions: {
          primary: 'PF',
          secondary: ['C'],
          playable: ['PF', 'C'],
          sourceLabels: ['PF'],
          normalizationVersion: 'position-v3',
        },
      });
      const manifestPath = await writeManifest(dir, [pointGuard, powerForward]);
      const report = dataPositionsCoverage({ input: manifestPath });
      expect(report.ok).toBe(true);
      const payload = positionsCoverageReportSchema.parse(report.payload);
      expect(payload.total).toBe(2);
      expect(payload.primary['PG']).toBe(1);
      expect(payload.primary['PF']).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails when source labels collapse to SG/SF/C with zero PG primaries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hoop-rush-positions-bad-'));
    try {
      const guard = buildPlayerSeason({
        playerId: playerIdSchema.parse('p-sg'),
        displayName: 'Test Guard',
        positions: {
          primary: 'SG',
          secondary: [],
          playable: ['SG'],
          sourceLabels: ['SG'],
          normalizationVersion: 'position-v3',
        },
      });
      const forward = buildPlayerSeason({
        playerId: playerIdSchema.parse('p-sf'),
        displayName: 'Test Wing',
        positions: {
          primary: 'SF',
          secondary: [],
          playable: ['SF'],
          sourceLabels: ['SF'],
          normalizationVersion: 'position-v3',
        },
      });
      const manifestPath = await writeManifest(dir, [guard, forward]);
      const report = dataPositionsCoverage({ input: manifestPath });
      expect(report.ok).toBe(false);
      expect(report.exitCode).toBe(1);
      const payload = positionsCoverageReportSchema.parse(report.payload);
      expect(payload.primary['PG'] ?? 0).toBe(0);
      expect(report.failures.some((failure) => failure.includes('zero PG primaries'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 on a missing manifest', () => {
    const report = dataPositionsCoverage({ input: join(tmpdir(), 'missing-manifest.json') });
    expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
  });
});
