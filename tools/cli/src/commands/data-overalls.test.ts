import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, buildPlayerSeason, buildPool } from '@hoop-rush/test-fixtures';
import { dataOveralls } from './data-overalls.js';
import { EXIT_OK, EXIT_USAGE_OR_DATA_ERROR } from '../report.js';

describe('dataOveralls', () => {
  it('reports detailed, summary, and selection values in sorted order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hoop-rush-overalls-'));
    try {
      const poolPath = join(dir, 'pool.json');
      const pool = buildPool([
        buildPlayerSeason(),
        {
          ...buildPlayerSeason(),
          playerId: 'p-shaq',
          displayName: "Shaquille O'Neal",
          detailedRatings: { ...buildPlayerSeason().detailedRatings, overall: 100 },
          summaryRatings: { overallRating: 77, offenseRating: 68, defenseRating: 89 },
          selectionScore: 79.056,
        },
      ]);
      const manifestPath = join(dir, 'manifest.json');
      await writeFile(poolPath, JSON.stringify(pool));
      await writeFile(
        manifestPath,
        JSON.stringify(
          buildManifest({
            pools: [
              {
                franchiseId: pool.franchiseId,
                eraId: pool.eraId,
                url: 'pool.json',
                contentHash: 'a'.repeat(64),
              },
            ],
          }),
        ),
      );

      const report = dataOveralls({ input: manifestPath, player: 'shaquille' });
      expect(report.ok).toBe(true);
      expect(report.exitCode).toBe(EXIT_OK);
      expect(report.payload).toMatchObject({ count: 1, displayed: 1 });
      expect(report.details.some((detail) => detail.includes("Shaquille O'Neal"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects an invalid limit', () => {
    const report = dataOveralls({ input: 'manifest.json', limit: '0' });
    expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
  });
});
