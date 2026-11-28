/* eslint-disable @typescript-eslint/await-thenable, @typescript-eslint/no-confusing-void-expression -- bun-types declares .resolves/.rejects matchers as void; Bun docs require awaiting them */
import { describe, expect, it } from 'bun:test';
import {
  contentHashSchema,
  eraIdSchema,
  seasonDraftCatalogIdentityHash,
  type HoopRushManifest,
  type OpponentIndexEntry,
  type SeasonDraftCatalogAsset,
} from '@hoop-rush/data-contracts';
import {
  buildCapRushTestCatalog,
  buildEraSimulationProfile,
  buildFixtureBracket,
  buildManifest,
} from '@hoop-rush/test-fixtures';
import { loadFullCourtAssets, type FullCourtAssetLoaders } from './full-court-assets';

const DRAFT_CATALOG: SeasonDraftCatalogAsset = {
  url: 'draft-catalog.json',
  contentHash: contentHashSchema.parse('a'.repeat(64)),
  identityHash: contentHashSchema.parse('b'.repeat(64)),
};
const CAP_RUSH_BRACKET: OpponentIndexEntry = {
  url: 'opponents/cap-rush-field.json',
  contentHash: contentHashSchema.parse('c'.repeat(64)),
};

function loaders(manifest: HoopRushManifest, eraId = '2020s'): FullCourtAssetLoaders {
  const catalog = buildCapRushTestCatalog();
  return {
    loadCatalog: () => Promise.resolve(catalog),
    loadPreamble: () =>
      Promise.resolve({
        manifest,
        profile: buildEraSimulationProfile({ eraId: eraIdSchema.parse(eraId) }),
        bracket: buildFixtureBracket(),
        legacyProfile: buildEraSimulationProfile({ eraId: eraIdSchema.parse('1990s') }),
      }),
  };
}

describe('loadFullCourtAssets', () => {
  it('derives the catalog source and 30-franchise field from packaged entries', async () => {
    const manifest = buildManifest({
      draftCatalog: DRAFT_CATALOG,
      capRushBracket: CAP_RUSH_BRACKET,
    });
    const assets = await loadFullCourtAssets(loaders(manifest));
    const catalog = buildCapRushTestCatalog();
    expect(assets.catalog.catalogVersion).toBe(catalog.catalogVersion);
    expect(assets.catalogSource).toEqual({
      catalogVersion: catalog.catalogVersion,
      catalogHash: seasonDraftCatalogIdentityHash(DRAFT_CATALOG),
      dataVersion: catalog.dataVersion,
      ratingsVersion: catalog.ratingsVersion,
      playerVersionIdVersion: catalog.playerVersionIdVersion,
      positionNormalizationVersion: catalog.positionNormalizationVersion,
    });
    expect(assets.field).toHaveLength(30);
    expect(assets.field.map((team) => team.teamId)).toContain('lakers');
    expect(assets.profile.eraId).toBe(eraIdSchema.parse('2020s'));
    expect((await assets.loadLegacyProfile?.())?.eraId).toBe(eraIdSchema.parse('1990s'));
  });

  it('falls back to the asset hash for a legacy draft catalog entry', async () => {
    const legacy: SeasonDraftCatalogAsset = {
      url: DRAFT_CATALOG.url,
      contentHash: DRAFT_CATALOG.contentHash,
    };
    const assets = await loadFullCourtAssets(
      loaders(buildManifest({ draftCatalog: legacy, capRushBracket: CAP_RUSH_BRACKET })),
    );
    expect(assets.catalogSource.catalogHash).toBe(seasonDraftCatalogIdentityHash(legacy));
  });

  it('rejects when the packaged field or catalog entry is missing', async () => {
    await expect(
      loadFullCourtAssets(loaders(buildManifest({ capRushBracket: CAP_RUSH_BRACKET }))),
    ).rejects.toThrow('data assets are unavailable');
    await expect(
      loadFullCourtAssets(loaders(buildManifest({ draftCatalog: DRAFT_CATALOG }))),
    ).rejects.toThrow('data assets are unavailable');
  });
});
