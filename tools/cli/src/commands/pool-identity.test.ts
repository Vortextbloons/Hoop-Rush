import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { franchiseEraPoolSchema, type FranchiseEraPool } from '@hoop-rush/data-contracts';
import { dataValidate, DEFAULT_MANIFEST } from './data-validate.js';
import { EXIT_OK } from '../report.js';

/**
 * Curated identity fixtures (spec/02): known Lakers 1990s stars and role
 * players must appear with their expected representative peak seasons.
 */
const EXPECTED_PEAKS: Record<string, string> = {
  'Magic Johnson': '1990-91',
  "Shaquille O'Neal": '1999-00',
  'Kobe Bryant': '1999-00',
  'Vlade Divac': '1994-95',
  'Eddie Jones': '1996-97',
  'James Worthy': '1990-91',
  'Nick Van Exel': '1994-95',
  'A.C. Green': '1992-93',
  'Derek Fisher': '1997-98',
  'Robert Horry': '1997-98',
  'Elden Campbell': '1995-96',
};

function loadShippedPool(): FranchiseEraPool {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
  const raw = readFileSync(
    resolve(repoRoot, 'apps/web/static/data/pools/lakers-1990s.json'),
    'utf8',
  );
  return franchiseEraPoolSchema.parse(JSON.parse(raw) as unknown);
}

describe('shipped Lakers 1990s pool', () => {
  it('passes the full data validation gate', async () => {
    const report = await dataValidate(DEFAULT_MANIFEST, false);
    expect(report.failures).toEqual([]);
    expect(report.exitCode).toBe(EXIT_OK);
  });

  it('contains curated stars at their expected peak seasons', () => {
    const pool = loadShippedPool();
    const byName = new Map(pool.players.map((p) => [p.displayName, p]));
    for (const [name, season] of Object.entries(EXPECTED_PEAKS)) {
      const player = byName.get(name);
      expect(player, `expected ${name} in the pool`).toBeDefined();
      if (player === undefined) continue;
      expect(player.seasonKey, `${name} peak season`).toBe(season);
    }
  });

  it('keeps every eligibility record at or above 40 team games', () => {
    const pool = loadShippedPool();
    for (const player of pool.players) {
      expect(player.eligibility.teamGames, player.displayName).toBeGreaterThanOrEqual(40);
    }
  });

  it('contains only canonical positions inside the G/F/C union', () => {
    const pool = loadShippedPool();
    for (const player of pool.players) {
      for (const position of player.positions.canonical) {
        expect(['G', 'F', 'C']).toContain(position);
      }
      expect(player.positions.canonical.length).toBeGreaterThan(0);
    }
  });
});
