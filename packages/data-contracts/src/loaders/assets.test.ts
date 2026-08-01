import { describe, expect, it } from 'vitest';
import type { HoopRushManifest, PeakPlayerSeason } from '../index.js';
import {
  isNbaCdnHeadshotUrl,
  resolveHeadshotUrl,
  resolveHeadshotUrls,
  resolveLogoUrl,
  resolveLogoUrls,
  resolveSecondaryHeadshotUrl,
  resolveSecondaryLogoUrl,
} from './assets.js';

const assets: HoopRushManifest['assets'] = {
  headshotUrlTemplate: 'https://cdn.nba.com/headshots/nba/latest/1040x760/{playerExternalId}.png',
  headshotUrlTemplateSecondary:
    'https://www.basketball-reference.com/req/20200617/images/headshots/{altIds.bbref}.jpg',
  logoUrlTemplate: 'https://cdn.nba.com/logos/nba/{teamExternalId}/global/L/logo.svg',
  logoUrlTemplateSecondary: 'https://a.espncdn.com/i/teamlogos/nba/500/{teamAbbreviation}.png',
  source: 'NBA.com',
  cacheVersion: '2026-07-01',
};

const manifest = (assetOverrides: Partial<typeof assets> = {}): HoopRushManifest =>
  ({
    schemaVersion: 1,
    dataVersion: 'data-v1',
    franchiseLineage: [],
    eras: [],
    pools: [],
    assets: { ...assets, ...assetOverrides },
  }) as HoopRushManifest;

const player = (overrides: Partial<PeakPlayerSeason> = {}): PeakPlayerSeason =>
  ({
    schemaVersion: 1,
    playerId: 'p-1',
    franchiseId: 'lakers',
    eraId: '1990s',
    seasonKey: '1996-97',
    firstName: 'Test',
    lastName: 'Player',
    displayName: 'Test Player',
    playerExternalId: '101',
    positions: { sourceLabels: ['G'], canonical: ['G'], normalizationVersion: 'position-v1' },
    heightInches: 79,
    weightLbs: 215,
    eligibility: { minimumTeamGames: 40, teamGames: 78, teamMinutes: 2700 },
    selectionScore: 60,
    selectionScoreVersion: 'score-v1',
    stats: {
      gamesPlayed: 79,
      minutes: 2860,
      points: 1920,
      rebounds: 480,
      assists: 410,
      steals: 90,
      blocks: 40,
      turnovers: 220,
      fieldGoalsMade: 740,
      fieldGoalsAttempted: 1450,
      threesMade: 110,
      threesAttempted: 300,
      freeThrowsMade: 330,
      freeThrowsAttempted: 420,
      per: 22.5,
      boxPlusMinus: 4.2,
      usageRate: 28.5,
      tsPct: 0.598,
      efgPct: 0.548,
    },
    summaryRatings: { overallRating: 90, offenseRating: 92, defenseRating: 84 },
    detailedRatings: { insideScoring: 82 },
    tendencies: { usageRate: 28 },
    dataConfidence: 'observed',
    source: {
      dataVersion: 'data-v1',
      ratingsVersion: 'ratings-v1',
      selectionScoreVersion: 'score-v1',
    },
    ...overrides,
  }) as PeakPlayerSeason;

describe('headshot URL resolution', () => {
  it('resolves the primary NBA CDN template', () => {
    expect(resolveHeadshotUrl(manifest(), '77142')).toBe(
      'https://cdn.nba.com/headshots/nba/latest/1040x760/77142.png',
    );
  });

  it('returns null when the primary template is absent', () => {
    expect(resolveHeadshotUrl(manifest({ headshotUrlTemplate: null }), '77142')).toBeNull();
  });

  it('resolves the secondary template from the player alt id', () => {
    expect(
      resolveSecondaryHeadshotUrl(manifest(), player({ altIds: { bbref: 'jordami01' } })),
    ).toBe('https://www.basketball-reference.com/req/20200617/images/headshots/jordami01.jpg');
  });

  it('returns null for the secondary URL without an alt id', () => {
    expect(resolveSecondaryHeadshotUrl(manifest(), player({ altIds: null }))).toBeNull();
    expect(resolveSecondaryHeadshotUrl(manifest(), player({ altIds: { bbref: null } }))).toBeNull();
  });

  it('returns null for the secondary URL without a template', () => {
    expect(
      resolveSecondaryHeadshotUrl(
        manifest({ headshotUrlTemplateSecondary: null }),
        player({ altIds: { bbref: 'jordami01' } }),
      ),
    ).toBeNull();
  });

  it('orders candidates primary before secondary', () => {
    expect(resolveHeadshotUrls(manifest(), player({ altIds: { bbref: 'jordami01' } }))).toEqual([
      'https://cdn.nba.com/headshots/nba/latest/1040x760/101.png',
      'https://www.basketball-reference.com/req/20200617/images/headshots/jordami01.jpg',
    ]);
  });

  it('skips the primary NBA CDN url when the packaged record marks it unavailable', () => {
    expect(
      resolveHeadshotUrls(
        manifest(),
        player({ altIds: { bbref: 'jordami01', nbaHeadshotAvailable: false } }),
      ),
    ).toEqual([
      'https://www.basketball-reference.com/req/20200617/images/headshots/jordami01.jpg',
    ]);
  });

  it('detects NBA CDN headshot urls', () => {
    expect(isNbaCdnHeadshotUrl('https://cdn.nba.com/headshots/nba/latest/1040x760/101.png')).toBe(
      true,
    );
    expect(
      isNbaCdnHeadshotUrl(
        'https://www.basketball-reference.com/req/20200617/images/headshots/jordami01.jpg',
      ),
    ).toBe(false);
  });

  it('appends the direct photo url after the secondary candidate', () => {
    expect(
      resolveHeadshotUrls(
        manifest(),
        player({
          altIds: {
            bbref: 'jordami01',
            photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/jordani.jpg',
          },
        }),
      ),
    ).toEqual([
      'https://cdn.nba.com/headshots/nba/latest/1040x760/101.png',
      'https://www.basketball-reference.com/req/20200617/images/headshots/jordami01.jpg',
      'https://upload.wikimedia.org/wikipedia/commons/jordani.jpg',
    ]);
  });

  it('uses the direct photo url as the only fallback when bbref is absent', () => {
    expect(
      resolveHeadshotUrls(
        manifest(),
        player({
          altIds: { photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/photo.png' },
        }),
      ),
    ).toEqual([
      'https://cdn.nba.com/headshots/nba/latest/1040x760/101.png',
      'https://upload.wikimedia.org/wikipedia/commons/photo.png',
    ]);
  });

  it('returns an empty list when nothing can resolve', () => {
    expect(
      resolveHeadshotUrls(
        manifest({ headshotUrlTemplate: null, headshotUrlTemplateSecondary: null }),
        player(),
      ),
    ).toEqual([]);
  });
});

describe('logo URL resolution', () => {
  it('resolves the primary NBA CDN template', () => {
    expect(resolveLogoUrl(manifest(), '1610612747')).toBe(
      'https://cdn.nba.com/logos/nba/1610612747/global/L/logo.svg',
    );
  });

  it('resolves the secondary template from the franchise abbreviation', () => {
    expect(resolveSecondaryLogoUrl(manifest(), 'lakers')).toBe(
      'https://a.espncdn.com/i/teamlogos/nba/500/lal.png',
    );
  });

  it('returns null for the secondary URL without a template', () => {
    expect(
      resolveSecondaryLogoUrl(manifest({ logoUrlTemplateSecondary: null }), 'lakers'),
    ).toBeNull();
  });

  it('orders candidates primary before secondary', () => {
    expect(resolveLogoUrls(manifest(), 'lakers', '1610612747')).toEqual([
      'https://cdn.nba.com/logos/nba/1610612747/global/L/logo.svg',
      'https://a.espncdn.com/i/teamlogos/nba/500/lal.png',
    ]);
  });

  it('returns an empty list when nothing can resolve', () => {
    expect(
      resolveLogoUrls(
        manifest({ logoUrlTemplate: null, logoUrlTemplateSecondary: null }),
        'lakers',
        '1610612747',
      ),
    ).toEqual([]);
  });
});
