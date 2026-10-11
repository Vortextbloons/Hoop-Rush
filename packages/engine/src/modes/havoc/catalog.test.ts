import { describe, expect, it } from 'vitest';
import type { SeasonDraftCatalog } from '@hoop-rush/data-contracts';
import { havocClaimKeyOf } from '@hoop-rush/data-contracts';
import { buildSeasonDraftCatalog } from '@hoop-rush/test-fixtures';
import {
  AdaptHavocCatalog,
  assertHavocCatalogSourceMatches,
  havocCatalogSourcesEqual,
} from './catalog.ts';
import { buildHavocCatalogSource } from './havoc-test-support.ts';

describe('havoc catalog adaptation', () => {
  it('adapts every fully modeled candidate with catalog Overall and profile copies', () => {
    const catalog = buildSeasonDraftCatalog();
    const source = buildHavocCatalogSource(catalog);
    const adapted = AdaptHavocCatalog(catalog, source);
    expect(adapted.source).toEqual(source);
    expect(adapted.candidates).toHaveLength(catalog.candidates.length);
    const first = adapted.candidates[0];
    const original = catalog.candidates[0];
    if (first === undefined || original === undefined) throw new Error('missing candidate');
    expect(first.playerId).toBe(original.playerId);
    expect(first.playerVersionId).toBe(original.playerVersionId);
    expect(first.displayName).toBe(original.displayName);
    expect(first.franchiseId).toBe(original.franchiseId);
    expect(first.eraId).toBe(original.eraId);
    expect(first.seasonKey).toBe(original.seasonKey);
    expect(first.positions).toEqual([...original.positions.playable]);
    expect(first.originalOverall).toBe(original.summaryRatings.overallRating);
    expect(first.overallSource).toBe('catalog');
    expect(first.claimKey).toEqual({
      playerId: original.playerId,
      seasonKey: original.seasonKey,
    });
    expect(havocClaimKeyOf(first.claimKey.playerId, first.claimKey.seasonKey)).toBe(
      `${original.playerId}::${original.seasonKey}`,
    );
    expect(first.profile.ratings).toEqual(original.detailedRatings);
    expect(first.profile.tendencies).toEqual(original.tendencies);
    expect(first.profile.anchors).toEqual(original.anchors);
    expect(first.physical).toEqual({
      heightInches: original.heightInches,
      weightLbs: original.weightLbs,
    });
  });

  it('is deterministic and leaves the packaged catalog untouched', () => {
    const catalog = buildSeasonDraftCatalog();
    const source = buildHavocCatalogSource(catalog);
    const first = AdaptHavocCatalog(catalog, source);
    const second = AdaptHavocCatalog(catalog, source);
    expect(first).toEqual(second);
    first.candidates[0]!.profile.ratings.insideScoring = 1;
    expect(catalog.candidates[0]!.detailedRatings.insideScoring).not.toBe(1);
  });

  it('rejects catalog version and data version mismatches', () => {
    const catalog = buildSeasonDraftCatalog();
    const source = buildHavocCatalogSource(catalog);
    expect(() =>
      AdaptHavocCatalog(catalog, { ...source, catalogVersion: 'season-draft-catalog-v3' }),
    ).toThrow(/mismatch/);
    expect(() => AdaptHavocCatalog(catalog, { ...source, dataVersion: 'other' })).toThrow(
      /mismatch/,
    );
    expect(() => AdaptHavocCatalog(catalog, { ...source, ratingsVersion: 'other' })).toThrow(
      /mismatch/,
    );
  });

  it('rejects candidates that are not fully modeled', () => {
    const catalog = buildSeasonDraftCatalog();
    const source = buildHavocCatalogSource(catalog);
    const first = catalog.candidates[0];
    if (first === undefined) throw new Error('missing candidate');
    const broken: SeasonDraftCatalog = {
      ...catalog,
      candidates: [{ ...first, anchors: undefined }, ...catalog.candidates.slice(1)],
    };
    expect(() => AdaptHavocCatalog(broken, source)).toThrow(/fully modeled/);
  });

  it('compares catalog sources structurally', () => {
    const catalog = buildSeasonDraftCatalog();
    const source = buildHavocCatalogSource(catalog);
    expect(havocCatalogSourcesEqual(source, { ...source })).toBe(true);
    expect(havocCatalogSourcesEqual(source, { ...source, catalogHash: 'f'.repeat(64) })).toBe(
      false,
    );
    expect(() =>
      assertHavocCatalogSourceMatches(source, { ...source, positionNormalizationVersion: 'x' }),
    ).toThrow(/mismatch/);
    expect(() => assertHavocCatalogSourceMatches(source, { ...source })).not.toThrow();
  });
});
