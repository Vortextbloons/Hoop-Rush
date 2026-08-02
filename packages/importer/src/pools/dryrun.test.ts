/**
 * Read-only dry run against the packaged real data: computes lakers/1990s in
 * memory and compares the result with the Python-built committed pool
 * (apps/web/static/data/pools/lakers-1990s.json). Nothing is written to
 * apps/web/static/data or raw-data; the career-position-labels cache may be
 * regenerated in the gitignored .raw_nba_cache like the Python pipeline does.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parsePool } from '@hoop-rush/data-contracts';
import { PUBLIC_DATA } from '../config.js';
import { readJson } from '../json.js';
import { join } from 'node:path';
import { computePool, loadBbrefIds, loadManifest, type Pool, type PoolPlayer } from './compute.js';

describe('real-data dry run (lakers/1990s vs Python-built pool)', () => {
  beforeAll(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('matches the committed pool eligibility count and top-5 selection scores', () => {
    const manifest = loadManifest();
    const bbrefIds = loadBbrefIds();
    const pool = computePool('lakers', '1990s', manifest, bbrefIds, false);
    expect(pool).not.toBeNull();
    const computed = pool as Pool;

    // The TS port must produce a schema-valid pool.
    expect(() => parsePool(computed)).not.toThrow();

    const committed = readJson(join(PUBLIC_DATA, 'pools', 'lakers-1990s.json')) as Pool;

    const summary = (players: PoolPlayer[]) =>
      [...players]
        .sort(
          (a, b) =>
            b.selectionScore - a.selectionScore ||
            a.playerExternalId.localeCompare(b.playerExternalId),
        )
        .slice(0, 5)
        .map((p) => [p.playerExternalId, p.seasonKey, p.selectionScore]);

    expect(computed.players.length).toBe(committed.players.length);
    expect(computed.players.length).toBe(44);
    expect(summary(computed.players)).toEqual(summary(committed.players));
  });
});
