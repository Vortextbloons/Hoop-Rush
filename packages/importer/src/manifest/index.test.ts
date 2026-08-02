import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from './index.js';
import { sha256File, writeJson } from '../json.js';

const tempRoots: string[] = [];
function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hoop-rush-manifest-'));
  tempRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

interface ManifestEntry {
  franchiseId?: string;
  eraId?: string;
  opponentId?: string;
  url: string;
  contentHash: string;
}

describe('manifest run', () => {
  it('recomputes content hashes for pools, era-sim, opponents and the bracket entry', () => {
    const root = makeTempRoot();

    // Pre-existing manifest with fields that must be preserved untouched.
    writeJson(join(root, 'manifest.json'), {
      schemaVersion: 1,
      dataVersion: 'm1.7',
      franchiseLineage: [{ franchiseId: 'lakers' }],
      eras: [{ eraId: '1990s', label: '1990s', fromSeasonKey: '1990-91', toSeasonKey: '1999-00' }],
      assets: { source: 'NBA.com', cacheVersion: 'v1' },
      pools: [
        {
          franchiseId: 'stale',
          eraId: 'stale',
          url: 'pools/stale.json',
          contentHash: 'x'.repeat(64),
        },
      ],
      eraSimulationProfiles: [],
      opponents: [],
    });

    writeJson(join(root, 'pools', 'lakers-1990s.json'), {
      schemaVersion: 1,
      franchiseId: 'lakers',
      players: [],
    });
    writeJson(join(root, 'pools', 'blazers-2000s.json'), {
      schemaVersion: 1,
      franchiseId: 'blazers',
      players: [],
    });
    writeJson(join(root, 'era-sim', '1990s.json'), { schemaVersion: 1, eraId: '1990s' });
    writeJson(join(root, 'opponents', 'bracket.json'), { bracket: true });
    writeJson(join(root, 'opponents', 'lakers-1990s-opening.json'), {
      opponentId: 'lakers-1990s-opening',
    });

    run(root);

    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
      schemaVersion: number;
      dataVersion: string;
      franchiseLineage: { franchiseId: string }[];
      assets: { source: string };
      pools: ManifestEntry[];
      eraSimulationProfiles: ManifestEntry[];
      bracket: ManifestEntry;
      opponents: ManifestEntry[];
    };

    // Other fields survive the rewrite.
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.dataVersion).toBe('m1.7');
    expect(manifest.franchiseLineage[0]?.franchiseId).toBe('lakers');
    expect(manifest.assets.source).toBe('NBA.com');

    // Pools sorted by filename, ids split on the first hyphen, hashes recomputed.
    expect(manifest.pools).toHaveLength(2);
    expect(manifest.pools[0]).toEqual({
      franchiseId: 'blazers',
      eraId: '2000s',
      url: 'pools/blazers-2000s.json',
      contentHash: sha256File(join(root, 'pools', 'blazers-2000s.json')),
    });
    expect(manifest.pools[1]?.contentHash).toBe(
      sha256File(join(root, 'pools', 'lakers-1990s.json')),
    );

    expect(manifest.eraSimulationProfiles).toEqual([
      {
        eraId: '1990s',
        url: 'era-sim/1990s.json',
        contentHash: sha256File(join(root, 'era-sim', '1990s.json')),
      },
    ]);

    // bracket.json becomes the manifest bracket entry, not an opponents entry.
    expect(manifest.bracket).toEqual({
      url: 'opponents/bracket.json',
      contentHash: sha256File(join(root, 'opponents', 'bracket.json')),
    });
    expect(manifest.opponents).toEqual([
      {
        opponentId: 'lakers-1990s-opening',
        url: 'opponents/lakers-1990s-opening.json',
        contentHash: sha256File(join(root, 'opponents', 'lakers-1990s-opening.json')),
      },
    ]);

    // The rewritten manifest ends with a trailing newline like the Python output.
    expect(readFileSync(join(root, 'manifest.json'), 'utf8').endsWith('\n')).toBe(true);
  });
});
