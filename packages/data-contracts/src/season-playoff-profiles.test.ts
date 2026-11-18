import { describe, expect, it } from 'bun:test';
import { playerVersionId } from './season-identity.ts';
import {
  applySeasonPlayoffProfiles,
  seasonPlayoffProfilesSchema,
  type SeasonPlayoffProfiles,
} from './season-playoff-profiles.ts';
import type { SeasonDraftCatalog } from './season-draft-catalog.ts';
import { seasonDraftCatalogIdentityHash } from './manifest.ts';
import { SEASON_DRAFT_CATALOG_VERSION } from './season-versions.ts';
import { playoffPerformanceSchema } from './postseason-evidence.ts';

const SEASON = '1995-96';
const SEASON_VERSION = playerVersionId('p-1', 'lakers', '1990s', SEASON);
const OTHER_VERSION = playerVersionId('p-2', 'lakers', '1990s', SEASON);

const PERFORMANCE = playoffPerformanceSchema.parse({
  season: SEASON,
  regularSeason: {
    gamesPlayed: 82,
    minutes: 2800,
    points: 2000,
    assists: 400,
    rebounds: 500,
    turnovers: 200,
    fga: 1500,
    fta: 500,
    tsPct: 0.58,
  },
  playoffs: {
    playerExternalId: '101',
    gamesPlayed: 10,
    minutes: 350,
    points: 250,
    assists: 50,
    rebounds: 60,
    offensiveRebounds: null,
    defensiveRebounds: null,
    steals: null,
    blocks: null,
    turnovers: null,
    fga: 190,
    fta: 70,
    tsPct: 0.6,
  },
  differences: {
    tsPct: 0.02,
    pointsPer36: 0.5,
    assistsPer36: 0.1,
    reboundsPer36: 0.2,
    turnoversPer36: 0,
  },
});

function catalog(): SeasonDraftCatalog {
  return {
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
    dataVersion: 'test-data',
    ratingsVersion: 'test-ratings',
    positionNormalizationVersion: 'position-v4',
    playerVersionIdVersion: 'player-version-id-v1',
    staminaVersion: 'season-stamina-v2',
    durabilityVersion: 'durability-v1',
    pools: [],
    candidates: [{ playerVersionId: SEASON_VERSION }, { playerVersionId: OTHER_VERSION }],
  } as unknown as SeasonDraftCatalog;
}

function profiles(): SeasonPlayoffProfiles {
  return seasonPlayoffProfilesSchema.parse({
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
    dataVersion: 'test-data',
    profiles: [{ playerVersionId: SEASON_VERSION, playoffPerformance: PERFORMANCE }],
  });
}

describe('season playoff profiles', () => {
  it('hydrates only matching candidates and leaves the source catalog untouched', () => {
    const source = catalog();
    const merged = applySeasonPlayoffProfiles(source, profiles());
    expect(merged).not.toBe(source);
    expect(merged.candidates[0]).toMatchObject({
      playerVersionId: SEASON_VERSION,
      playoffPerformance: PERFORMANCE,
    });
    expect(merged.candidates[1]).toBe(source.candidates[1]);
    expect(source.candidates[0]).not.toHaveProperty('playoffPerformance');
  });

  it('rejects duplicate profiles', () => {
    expect(() =>
      seasonPlayoffProfilesSchema.parse({
        schemaVersion: 1,
        catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
        dataVersion: 'test-data',
        profiles: [
          { playerVersionId: SEASON_VERSION, playoffPerformance: PERFORMANCE },
          { playerVersionId: SEASON_VERSION, playoffPerformance: PERFORMANCE },
        ],
      }),
    ).toThrow();
  });

  it('rejects catalogs from another data version', () => {
    const artifact = profiles();
    expect(() =>
      applySeasonPlayoffProfiles({ ...catalog(), dataVersion: 'other-data' }, artifact),
    ).toThrow('do not match catalog');
  });

  it('uses the logical identity hash and falls back to legacy byte hashes', () => {
    expect(
      seasonDraftCatalogIdentityHash({ contentHash: 'a'.repeat(64), identityHash: 'b'.repeat(64) }),
    ).toBe('b'.repeat(64));
    expect(seasonDraftCatalogIdentityHash({ contentHash: 'a'.repeat(64) })).toBe('a'.repeat(64));
  });
});
