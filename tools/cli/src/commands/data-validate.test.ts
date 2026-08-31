import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PeakPlayerSeason } from '@hoop-rush/data-contracts';
import { POSITION_NORMALIZATION_VERSION } from '@hoop-rush/data-contracts';
import { buildManifest, buildPlayerSeason, buildPool } from '@hoop-rush/test-fixtures';
import { dataValidate } from './data-validate.ts';
import { EXIT_CHECKS_FAILED, EXIT_OK, EXIT_USAGE_OR_DATA_ERROR } from '../report.ts';
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hoop-rush-cli-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
async function writeManifest(manifest: unknown): Promise<string> {
  const path = join(dir, 'manifest.json');
  await writeFile(path, JSON.stringify(manifest));
  return path;
}
function legalPool(altIds: PeakPlayerSeason['altIds'] = null): ReturnType<typeof buildPool> {
  const playable: PeakPlayerSeason['positions']['playable'][] = [
    ['PG'],
    ['SG'],
    ['SF'],
    ['PF'],
    ['C'],
  ];
  return buildPool(
    playable.map((positions, index) => {
      const primary = positions[0];
      if (primary === undefined) throw new Error('fixture position label missing');
      return buildPlayerSeason({
        playerId: `p-fixture-${String(index + 1)}`,
        displayName: `Fixture ${String(index + 1)}`,
        positions: {
          primary,
          secondary: [],
          playable: positions,
          sourceLabels: [primary],
          normalizationVersion: POSITION_NORMALIZATION_VERSION,
        },
        altIds,
      });
    }),
  );
}
describe('dataValidate', () => {
  it('passes a valid manifest with no pools', async () => {
    const path = await writeManifest(buildManifest());
    const report = await dataValidate(path, false);
    expect(report.ok).toBe(true);
    expect(report.exitCode).toBe(EXIT_OK);
    expect(report.failures).toEqual([]);
  });
  it('reports missing manifest as a usage/data error', async () => {
    const report = await dataValidate(join(dir, 'missing.json'), false);
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
  });
  it('reports invalid JSON as a usage/data error', async () => {
    const path = join(dir, 'manifest.json');
    await writeFile(path, 'not json');
    const report = await dataValidate(path, false);
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
    expect(report.failures[0]).toMatch(/not valid JSON/);
  });
  it('lists schema issues with exact paths', async () => {
    const manifest = buildManifest({ dataVersion: '' });
    const path = await writeManifest(manifest);
    const report = await dataValidate(path, false);
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.includes('dataVersion'))).toBe(true);
  });
  it('flags overlapping lineage segments and overlapping eras', async () => {
    const manifest = buildManifest({
      franchiseLineage: [
        {
          modernFranchiseId: 'lakers',
          historicalTeamId: '1610612747',
          validFromSeasonKey: '1960-61',
          validThroughSeasonKey: '1974-75',
          displayName: 'Los Angeles Lakers',
          city: 'Los Angeles',
          abbreviation: 'LAL',
          sourceIdentityIds: ['1610612747'],
          lineageRuleVersion: 'lineage-v1',
        },
        {
          modernFranchiseId: 'lakers',
          historicalTeamId: '1610612747',
          validFromSeasonKey: '1970-71',
          displayName: 'Los Angeles Lakers',
          city: 'Los Angeles',
          abbreviation: 'LAL',
          sourceIdentityIds: ['1610612747'],
          lineageRuleVersion: 'lineage-v1',
        },
      ],
      eras: [
        { eraId: '1960s', label: '1960s', fromSeasonKey: '1960-61', toSeasonKey: '1969-70' },
        { eraId: '1970s', label: '1970s', fromSeasonKey: '1970-71', toSeasonKey: '1979-80' },
        { eraId: '1970s-dup', label: 'dup', fromSeasonKey: '1975-76', toSeasonKey: '1984-85' },
      ],
    });
    const path = await writeManifest(manifest);
    const report = await dataValidate(path, false);
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.includes('overlapping ranges'))).toBe(true);
    expect(report.failures.some((f) => f.includes('ranges overlap'))).toBe(true);
  });
  it('verifies pool content hashes against the referenced assets', async () => {
    const poolDir = join(dir, 'pools');
    await mkdir(poolDir);
    const assetPath = join(poolDir, 'lakers-1990s.json');
    const asset = JSON.stringify({ hello: 'world' });
    await writeFile(assetPath, asset);
    const contentHash = createHash('sha256').update(asset).digest('hex');
    const manifest = buildManifest({
      pools: [
        { franchiseId: 'lakers', eraId: '1990s', url: 'pools/lakers-1990s.json', contentHash },
        {
          franchiseId: 'lakers',
          eraId: '2000s',
          url: 'pools/missing.json',
          contentHash: 'a'.repeat(64),
        },
      ],
    });
    const path = await writeManifest(manifest);
    const report = await dataValidate(path, true);
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.includes('asset missing'))).toBe(true);
    expect(report.exitCode).toBe(EXIT_CHECKS_FAILED);
  });
  it('requires nbaHeadshotAvailable on every player when a primary template exists', async () => {
    const poolDir = join(dir, 'pools');
    await mkdir(poolDir);
    const assetPath = join(poolDir, 'lakers-1990s.json');
    const pool = legalPool({ bbref: 'player01' });
    const asset = JSON.stringify(pool);
    await writeFile(assetPath, asset);
    const contentHash = createHash('sha256').update(asset).digest('hex');
    const manifest = buildManifest({
      pools: [
        { franchiseId: 'lakers', eraId: '1990s', url: 'pools/lakers-1990s.json', contentHash },
      ],
    });
    const path = await writeManifest(manifest);
    const report = await dataValidate(path, false);
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.includes('lack nbaHeadshotAvailable'))).toBe(true);
  });
  it('accepts pools whose players carry the CDN availability marker', async () => {
    const poolDir = join(dir, 'pools');
    await mkdir(poolDir);
    const assetPath = join(poolDir, 'lakers-1990s.json');
    const pool = legalPool({ bbref: 'player01', nbaHeadshotAvailable: false });
    const asset = JSON.stringify(pool);
    await writeFile(assetPath, asset);
    const contentHash = createHash('sha256').update(asset).digest('hex');
    const manifest = buildManifest({
      pools: [
        { franchiseId: 'lakers', eraId: '1990s', url: 'pools/lakers-1990s.json', contentHash },
      ],
    });
    const path = await writeManifest(manifest);
    const report = await dataValidate(path, false);
    expect(report.failures.some((f) => f.includes('nbaHeadshotAvailable'))).toBe(false);
  });
});
describe('dataValidate season free-agency index audit', () => {
  const versionId = `pv-${'a'.repeat(32)}`;
  const playerId = 'p-fixture-1';
  function minimalIndex(catalogHash: string): unknown {
    return {
      schemaVersion: 1,
      indexVersion: 'free-agency-index-v1',
      dataVersion: 'data-v1',
      catalogRef: {
        catalogVersion: 'season-draft-catalog-v4',
        contentHash: catalogHash,
        candidateCount: 1,
      },
      candidates: [
        {
          playerVersionId: versionId,
          playerId,
          displayName: 'Fixture One',
          positions: {
            primary: 'PG',
            secondary: [],
            playable: ['PG'],
            normalizationVersion: 'position-v3',
          },
          band: 'emergency',
          minimumInfluence: 1,
          supportedRoles: ['depth', 'emergency'],
          strengths: [],
          limitations: [],
          durabilityRating: 45,
          minutesPerGame: 4.2,
          availability: { healthy: true, notes: '' },
          catalogRef: {
            catalogVersion: 'season-draft-catalog-v4',
            dataVersion: 'data-v1',
            candidateIndex: 0,
          },
          derivationEvidence: 'tier depth; stamina 50/95; dur 95',
          exclusionEvidence: '',
        },
      ],
      groupedVersions: { [playerId]: [versionId] },
    };
  }
  async function writeSeasonManifest(indexHash: string, catalogHash: string): Promise<string> {
    const seasonDir = join(dir, 'season');
    await mkdir(seasonDir);
    const catalogBytes = JSON.stringify({ catalogVersion: 'season-draft-catalog-v4' });
    const catalogPath = join(seasonDir, 'draft-catalog.json');
    await writeFile(catalogPath, catalogBytes);
    const indexPath = join(seasonDir, 'free-agency-index.json');
    await writeFile(indexPath, JSON.stringify(minimalIndex(catalogHash)));
    return writeManifest(
      buildManifest({
        season: {
          league: { url: 'season/league.json', contentHash: 'a'.repeat(64) },
          schedule: { url: 'season/schedule.json', contentHash: 'b'.repeat(64) },
          draftCatalog: {
            url: 'season/draft-catalog.json',
            contentHash: catalogHash,
          },
          rosterTargets: { url: 'season/roster-targets.json', contentHash: 'c'.repeat(64) },
          freeAgencyIndex: {
            url: 'season/free-agency-index.json',
            contentHash: indexHash,
          },
        },
      }),
    );
  }
  it('accepts a hash-verified free-agency index pinned to the draft catalog', async () => {
    const catalogHash = createHash('sha256')
      .update('{"catalogVersion":"season-draft-catalog-v4"}')
      .digest('hex');
    const indexBytes = JSON.stringify(minimalIndex(catalogHash));
    const indexHash = createHash('sha256').update(indexBytes).digest('hex');
    const path = await writeSeasonManifest(indexHash, catalogHash);
    const report = await dataValidate(path, true);
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.details.some((d) => d.includes('free-agency-index: 1 candidates'))).toBe(true);
  });
  it('flags a free-agency index content-hash mismatch', async () => {
    const catalogHash = createHash('sha256')
      .update('{"catalogVersion":"season-draft-catalog-v4"}')
      .digest('hex');
    const wrongHash = 'f'.repeat(64);
    const path = await writeSeasonManifest(wrongHash, catalogHash);
    const report = await dataValidate(path, false);
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.includes('content hash mismatch'))).toBe(true);
  });
  it('flags a free-agency index whose catalogRef pins a different catalog hash', async () => {
    const catalogHash = createHash('sha256')
      .update('{"catalogVersion":"season-draft-catalog-v4"}')
      .digest('hex');
    const staleCatalogHash = 'e'.repeat(64);
    const seasonDir = join(dir, 'season');
    await mkdir(seasonDir);
    await writeFile(
      join(seasonDir, 'draft-catalog.json'),
      JSON.stringify({ catalogVersion: 'season-draft-catalog-v4' }),
    );
    const staleIndexBytes = JSON.stringify(minimalIndex(staleCatalogHash));
    await writeFile(join(seasonDir, 'free-agency-index.json'), staleIndexBytes);
    const indexHash = createHash('sha256').update(staleIndexBytes).digest('hex');
    const path = await writeManifest(
      buildManifest({
        season: {
          league: { url: 'season/league.json', contentHash: 'a'.repeat(64) },
          schedule: { url: 'season/schedule.json', contentHash: 'b'.repeat(64) },
          draftCatalog: { url: 'season/draft-catalog.json', contentHash: catalogHash },
          rosterTargets: { url: 'season/roster-targets.json', contentHash: 'c'.repeat(64) },
          freeAgencyIndex: { url: 'season/free-agency-index.json', contentHash: indexHash },
        },
      }),
    );
    const report = await dataValidate(path, false);
    expect(report.ok).toBe(false);
    expect(
      report.failures.some((f) => f.includes('does not match the packaged draft catalog')),
    ).toBe(true);
  });
  it('passes when no free-agency index is packaged', async () => {
    const path = await writeManifest(buildManifest());
    const report = await dataValidate(path, false);
    expect(report.ok).toBe(true);
  });
});
