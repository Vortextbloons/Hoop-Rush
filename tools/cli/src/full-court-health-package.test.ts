import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FULL_COURT_HEALTH_PROFILE_VERSION,
  fullCourtHealthProfileSetSchema,
  type FullCourtHealthProfileSet,
  type SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import { fullCourtHealth } from '@hoop-rush/importer';
import { buildCapRushTestCatalog } from '@hoop-rush/test-fixtures';
import { sha256Hex } from './io.ts';

function profileSet(
  catalog: SeasonDraftCatalog,
  catalogHash: string,
  omitVersion = false,
): FullCourtHealthProfileSet {
  const versionIds = catalog.candidates.map((candidate) => candidate.playerVersionId);
  return fullCourtHealthProfileSetSchema.parse({
    version: FULL_COURT_HEALTH_PROFILE_VERSION,
    catalogHash,
    evidenceHash: 'b'.repeat(64),
    cohorts: { 'test-cohort': { observedAppearances: 1_000, durationCounts: [1, 0, 0, 0] } },
    players: Object.fromEntries(
      versionIds.slice(omitVersion ? 1 : 0).map((playerVersionId) => [
        playerVersionId,
        {
          cohortId: 'test-cohort',
          episodesPer10kAppearances: 100,
          playerEvidence: { source: 'population' },
        },
      ]),
    ),
  });
}

function withDataDir(run: (dataDir: string, catalog: SeasonDraftCatalog) => void): void {
  const dataDir = mkdtempSync(join(tmpdir(), 'hoop-health-'));
  try {
    const catalog = buildCapRushTestCatalog();
    writeFileSync(join(dataDir, 'draft-catalog.json'), `${JSON.stringify(catalog)}\n`);
    run(dataDir, catalog);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

describe('packageFullCourtHealthProfiles', () => {
  it('writes deterministic profile bytes and reports their hash', () => {
    withDataDir((dataDir, catalog) => {
      const catalogHash = sha256Hex(readFileSync(join(dataDir, 'draft-catalog.json')));
      const profilesPath = join(dataDir, 'cached-profiles.json');
      writeFileSync(profilesPath, `${JSON.stringify(profileSet(catalog, catalogHash), null, 2)}\n`);
      const first = fullCourtHealth.packageFullCourtHealthProfiles({
        dataDir,
        profilesPath,
        evidencePath: join(dataDir, 'missing-evidence.json'),
      });
      const path = join(dataDir, fullCourtHealth.FULL_COURT_HEALTH_PROFILES_ASSET);
      const bytes = readFileSync(path, 'utf8');
      expect(first.status).toBe('written');
      expect(first.asset.contentHash).toBe(sha256Hex(bytes));
      expect(bytes).toBe(`${JSON.stringify(first.profiles)}\n`);
      expect(
        fullCourtHealth.packageFullCourtHealthProfiles({
          dataDir,
          profilesPath,
          evidencePath: join(dataDir, 'missing-evidence.json'),
        }).status,
      ).toBe('unchanged');
    });
  });

  it('rejects profiles fitted from another catalog without touching a pinned asset', () => {
    withDataDir((dataDir, catalog) => {
      const path = join(dataDir, fullCourtHealth.FULL_COURT_HEALTH_PROFILES_ASSET);
      writeFileSync(path, 'pinned asset that must survive\n');
      const profilesPath = join(dataDir, 'cached-profiles.json');
      writeFileSync(profilesPath, `${JSON.stringify(profileSet(catalog, 'c'.repeat(64)))}\n`);
      expect(() =>
        fullCourtHealth.packageFullCourtHealthProfiles({
          dataDir,
          profilesPath,
          evidencePath: join(dataDir, 'missing-evidence.json'),
        }),
      ).toThrow('regenerate the profiles');
      expect(readFileSync(path, 'utf8')).toBe('pinned asset that must survive\n');
    });
  });

  it('preserves a matching pinned asset when local evidence is absent', () => {
    withDataDir((dataDir, catalog) => {
      const catalogHash = sha256Hex(readFileSync(join(dataDir, 'draft-catalog.json')));
      const path = join(dataDir, fullCourtHealth.FULL_COURT_HEALTH_PROFILES_ASSET);
      const bytes = `${JSON.stringify(profileSet(catalog, catalogHash), null, 2)}\n`;
      writeFileSync(path, bytes);
      const result = fullCourtHealth.packageFullCourtHealthProfiles({
        dataDir,
        profilesPath: join(dataDir, 'missing-profiles.json'),
        evidencePath: join(dataDir, 'missing-evidence.json'),
      });
      expect(result.status).toBe('preserved');
      expect(readFileSync(path, 'utf8')).toBe(bytes);
      expect(result.asset.contentHash).toBe(sha256Hex(bytes));
    });
  });

  it('fails clearly when profiles cannot cover the packaged catalog', () => {
    withDataDir((dataDir, catalog) => {
      const catalogHash = sha256Hex(readFileSync(join(dataDir, 'draft-catalog.json')));
      const profilesPath = join(dataDir, 'cached-profiles.json');
      writeFileSync(profilesPath, `${JSON.stringify(profileSet(catalog, catalogHash, true))}\n`);
      expect(() =>
        fullCourtHealth.packageFullCourtHealthProfiles({
          dataDir,
          profilesPath,
          evidencePath: join(dataDir, 'missing-evidence.json'),
        }),
      ).toThrow('do not cover the packaged catalog');
    });
  });
});
