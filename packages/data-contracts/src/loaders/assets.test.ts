import { describe, expect, it } from 'vitest';
import type { HoopRushManifest, PeakPlayerSeason } from '../index.js';
import {
  isNbaCdnHeadshotUrl,
  resolveHeadshotUrl,
  resolveHeadshotUrls,
  resolveLogoUrl,
  resolveLogoUrls,
  resolveLogoUrlsWithHistorical,
  resolveSecondaryHeadshotUrl,
  resolveSecondaryLogoUrl,
  shouldStallTimeoutHeadshot,
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

const manifest = (assetOverrides: Partial<typeof assets> = {}): HoopRushManifest => ({
  schemaVersion: 3,
  dataVersion: 'data-v1',
  modernFranchiseSlots: [
    { franchiseId: 'lakers', displayName: 'Los Angeles Lakers', teamExternalId: '1610612747' },
  ],
  franchiseLineage: [],
  eras: [],
  pools: [],
  availability: [],
  eraSimulationProfiles: [],
  assets: { ...assets, ...assetOverrides },
});

const player = (overrides: Partial<PeakPlayerSeason> = {}): PeakPlayerSeason => ({
  schemaVersion: 3,
  playerId: 'p-1',
  franchiseId: 'lakers',
  eraId: '1990s',
  seasonKey: '1996-97',
  firstName: 'Test',
  lastName: 'Player',
  displayName: 'Test Player',
  playerExternalId: '101',
  positions: {
    primary: 'SF',
    secondary: ['SG'],
    playable: ['SF', 'SG'],
    sourceLabels: ['SF', 'SG'],
    normalizationVersion: 'position-v3',
  },
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
    offensiveRebounds: 110,
    defensiveRebounds: 370,
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
  historicalTeamIdentity: {
    teamId: '1610612747',
    displayName: 'Los Angeles Lakers',
    city: 'Los Angeles',
    abbreviation: 'LAL',
    seasonKey: '1996-97',
    lineageRuleVersion: 'lineage-v1',
  },
  summaryRatings: { overallRating: 90, offenseRating: 92, defenseRating: 84 },
  detailedRatings: {
    insideScoring: 82,
    closeShot: 70,
    midrange: 68,
    threePoint: 65,
    freeThrow: 74,
    ballHandling: 70,
    passing: 70,
    offensiveIq: 70,
    offensiveRebound: 60,
    defensiveRebound: 65,
    perimeterDefense: 62,
    interiorDefense: 62,
    steal: 60,
    block: 60,
    defensiveIq: 62,
    speed: 70,
    strength: 65,
    vertical: 66,
  },
  tendencies: {
    usageRate: 28,
    passRate: 30,
    shotRate: 25,
    driveRate: 18,
    postUpRate: 5,
    rimFrequency: 30,
    shortMidFrequency: 20,
    longMidFrequency: 14,
    cornerThreeFrequency: 8,
    aboveBreakThreeFrequency: 12,
    threePointRate: 24,
    freeThrowRate: 22,
    turnoverRate: 12,
    isolationRate: 10,
    pickAndRollBallHandlerRate: 25,
    pickAndRollRollManRate: 10,
    spotUpRate: 20,
    transitionRate: 15,
    cutRate: 10,
    foulRate: 2,
    stealAttemptRate: 8,
    blockAttemptRate: 10,
    crashOffensiveGlassRate: 12,
  },
  anchors: {
    gamesPlayed: 79,
    minutesPerGame: 36.2,
    pointsPerGame: 24.3,
    reboundsPerGame: 6.1,
    offensiveReboundsPerGame: 1.4,
    defensiveReboundsPerGame: 4.7,
    assistsPerGame: 5.2,
    stealsPerGame: 1.1,
    blocksPerGame: 0.5,
    turnoversPerGame: 2.8,
    fieldGoalPct: 0.51,
    threePointPct: 0.367,
    freeThrowPct: 0.786,
    threePointAttemptRate: 0.207,
    freeThrowAttemptRate: 0.29,
  },
  provenance: {},
  source: {
    dataVersion: 'data-v1',
    ratingsVersion: 'ratings-v1',
    selectionScoreVersion: 'score-v1',
    sourceVersion: 'source-v1',
    derivationMethodVersion: 'derive-v1',
    lineageRuleVersion: 'lineage-v1',
  },
  ...overrides,
});

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
    ).toEqual(['https://www.basketball-reference.com/req/20200617/images/headshots/jordami01.jpg']);
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

  it('keeps confirmed NBA headshots from timing out into wiki-only fallbacks', () => {
    const nba = 'https://cdn.nba.com/headshots/nba/latest/1040x760/2548.png';
    const wiki = 'https://upload.wikimedia.org/wikipedia/commons/wade.jpg';
    const bbref = 'https://www.basketball-reference.com/req/20200617/images/headshots/wadedw01.jpg';
    expect(
      shouldStallTimeoutHeadshot(nba, [nba, wiki], 0, {
        altIds: { nbaHeadshotAvailable: true },
      }),
    ).toBe(false);
    expect(
      shouldStallTimeoutHeadshot(nba, [nba, bbref, wiki], 0, {
        altIds: { nbaHeadshotAvailable: true },
      }),
    ).toBe(true);
    expect(
      shouldStallTimeoutHeadshot(nba, [nba, wiki], 0, {
        altIds: { nbaHeadshotAvailable: false },
      }),
    ).toBe(true);
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

  it('uses the legacy host slugs for the Pelicans and Jazz', () => {
    expect(resolveSecondaryLogoUrl(manifest(), 'pelicans')).toBe(
      'https://a.espncdn.com/i/teamlogos/nba/500/no.png',
    );
    expect(resolveSecondaryLogoUrl(manifest(), 'jazz')).toBe(
      'https://a.espncdn.com/i/teamlogos/nba/500/utah.png',
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

  it('orders verified historical candidates before the modern chain', () => {
    expect(
      resolveLogoUrlsWithHistorical(manifest(), 'thunder', '1610612760', [
        'https://example.com/sea-1.png',
        'https://example.com/sea-2.png',
      ]),
    ).toEqual([
      'https://example.com/sea-1.png',
      'https://example.com/sea-2.png',
      'https://cdn.nba.com/logos/nba/1610612760/global/L/logo.svg',
      'https://a.espncdn.com/i/teamlogos/nba/500/okc.png',
    ]);
  });

  it('deduplicates candidates shared between the historical list and the modern chain', () => {
    expect(
      resolveLogoUrlsWithHistorical(manifest(), 'thunder', '1610612760', [
        'https://cdn.nba.com/logos/nba/1610612760/global/L/logo.svg',
      ]),
    ).toEqual([
      'https://cdn.nba.com/logos/nba/1610612760/global/L/logo.svg',
      'https://a.espncdn.com/i/teamlogos/nba/500/okc.png',
    ]);
  });

  it('equals the modern chain when no historical candidates exist', () => {
    expect(resolveLogoUrlsWithHistorical(manifest(), 'lakers', '1610612747', [])).toEqual(
      resolveLogoUrls(manifest(), 'lakers', '1610612747'),
    );
  });
});
