import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MANIFEST_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
import { run, DATA_VERSION, ASSET_CACHE_VERSION } from './index.ts';
import { sha256File, writeJson } from '../json.ts';

// The availability-matrix classification scans packaged season dirs; allow
// headroom for parallel-suite CPU contention.
const TEST_TIMEOUT = 30_000;

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
  url: string;
  contentHash: string;
}

describe('manifest run', () => {
  it(
    'rebuilds the v2 manifest: slots, lineage, pools, availability, profiles, bracket',
    { timeout: TEST_TIMEOUT },
    () => {
      const root = makeTempRoot();

      // Pre-existing manifest with eras and assets that must be preserved.
      writeJson(join(root, 'manifest.json'), {
        schemaVersion: 1,
        dataVersion: 'm1.7',
        eras: [
          { eraId: '1990s', label: '1990s', fromSeasonKey: '1990-91', toSeasonKey: '1999-00' },
        ],
        assets: { source: 'NBA.com', cacheVersion: 'v1' },
      });

      writeJson(join(root, 'pools', 'lakers-1990s.json'), {
        schemaVersion: 2,
        dataVersion: 'm3.5',
        franchiseId: 'lakers',
        eraId: '1990s',
        eligibility: { minimumTeamGames: 40 },
        coverageSummary: {
          coverageBand: 'complete-box-derived',
          observedFamilies: ['base'],
          derivedFamilies: [],
          estimatedFamilies: [],
          missingCategories: [],
          lowConfidenceShare: 0,
          policyVersion: 'policy-v1',
        },
        players: [
          {
            playerId: 'p-1',
            displayName: 'Test',
          },
        ],
      });
      writeJson(join(root, 'era-sim', '1990s.json'), { schemaVersion: 1, eraId: '1990s' });
      writeJson(join(root, 'opponents', 'bracket.json'), { bracket: true });

      // Coverage report: lakers/1990s available, pelicans/1990s unattempted.
      writeJson(join(root, 'coverage-report.json'), [
        {
          franchiseId: 'lakers',
          eraId: '1990s',
          status: 'available',
          playerCount: 1,
          coverageSummary: {
            coverageBand: 'complete-box-derived',
            observedFamilies: ['base'],
            derivedFamilies: [],
            estimatedFamilies: [],
            missingCategories: [],
            lowConfidenceShare: 0,
            policyVersion: 'policy-v1',
          },
        },
      ]);

      run(root);

      const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
        schemaVersion: number;
        dataVersion: string;
        modernFranchiseSlots: { franchiseId: string }[];
        franchiseLineage: {
          modernFranchiseId: string;
          lineageRuleVersion: string;
          logoCandidates?: { url: string; source: string }[];
        }[];
        eras: { eraId: string }[];
        assets: { source: string; cacheVersion: string };
        pools: ManifestEntry[];
        availability: Array<Record<string, unknown>>;
        eraSimulationProfiles: ManifestEntry[];
        bracket: ManifestEntry;
      };

      // The manifest contract: 30 slots, lineage segments with historical
      // logo candidates, preserved eras/assets, and the new cache version.
      expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
      expect(manifest.dataVersion).toBe(DATA_VERSION);
      expect(manifest.modernFranchiseSlots).toHaveLength(30);
      expect(manifest.franchiseLineage.length).toBeGreaterThan(30);
      expect(manifest.franchiseLineage[0]?.lineageRuleVersion).toBe('lineage-v1');
      expect(
        manifest.franchiseLineage.every((segment) => (segment.logoCandidates?.length ?? 0) > 0),
      ).toBe(true);
      expect(manifest.eras[0]?.eraId).toBe('1990s');
      expect(manifest.assets.source).toBe('NBA.com');
      expect(manifest.assets.cacheVersion).toBe(ASSET_CACHE_VERSION);

      // Pools index recomputed with content hashes.
      expect(manifest.pools).toHaveLength(1);
      expect(manifest.pools[0]).toEqual({
        franchiseId: 'lakers',
        eraId: '1990s',
        url: 'pools/lakers-1990s.json',
        contentHash: sha256File(join(root, 'pools', 'lakers-1990s.json')),
      });

      // Availability matrix covers every slot x era (30 x 1) with truthful reasons.
      expect(manifest.availability).toHaveLength(30);
      const lakers = manifest.availability.find(
        (entry) => entry['franchiseId'] === 'lakers' && entry['status'] === 'available',
      );
      expect(lakers?.['playerCount'] ?? null).toBe(1);
      const pelicans = manifest.availability.find(
        (entry) => entry['franchiseId'] === 'pelicans',
      ) as Record<string, unknown>;
      expect(pelicans['status'] ?? null).toBe('unavailable');
      expect(pelicans['reason'] ?? null).toBe('no-franchise-history');
      expect(pelicans['firstSupportedSeason'] ?? null).toBe('2002-03');
      // Era profile and frozen bracket entries.
      expect(manifest.eraSimulationProfiles).toEqual([
        {
          eraId: '1990s',
          url: 'era-sim/1990s.json',
          contentHash: sha256File(join(root, 'era-sim', '1990s.json')),
        },
      ]);
      expect(manifest.bracket).toEqual({
        url: 'opponents/bracket.json',
        contentHash: sha256File(join(root, 'opponents', 'bracket.json')),
      });

      // The rewritten manifest ends with a trailing newline like the Python output.
      expect(readFileSync(join(root, 'manifest.json'), 'utf8').endsWith('\n')).toBe(true);
    },
  );
});
