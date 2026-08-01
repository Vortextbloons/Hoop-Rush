import { describe, expect, it } from 'vitest';
import {
  challengeRunSchema,
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  lineupSchema,
  peakPlayerSeasonSchema,
} from './index.js';
import type { Lineup, LineupAssignment, PeakPlayerSeason } from './index.js';

const validPlayer: PeakPlayerSeason = {
  schemaVersion: 1,
  playerId: 'p-1',
  franchiseId: 'lakers',
  eraId: '1990s',
  seasonKey: '1996-97',
  firstName: 'Magic',
  lastName: 'Johnson',
  displayName: 'Magic Johnson',
  playerExternalId: '77142',
  positions: {
    sourceLabels: ['PG', 'SG'],
    canonical: ['G'],
    normalizationVersion: 'position-v1',
  },
  heightInches: 81,
  weightLbs: 220,
  eligibility: { minimumTeamGames: 40, teamGames: 78, teamMinutes: 2800 },
  selectionScore: 95.5,
  selectionScoreVersion: 'score-v1',
  stats: {
    gamesPlayed: 78,
    minutes: 2800,
    points: 1500,
    rebounds: 500,
    assists: 900,
    steals: 120,
    blocks: 40,
    turnovers: 300,
    fieldGoalsMade: 600,
    fieldGoalsAttempted: 1100,
    threesMade: 90,
    threesAttempted: 250,
    freeThrowsMade: 220,
    freeThrowsAttempted: 260,
    per: 25.1,
    boxPlusMinus: 8.5,
    usageRate: 29,
    tsPct: 0.61,
    efgPct: 0.586,
  },
  summaryRatings: { overallRating: 96, offenseRating: 98, defenseRating: 86 },
  detailedRatings: { passing: 98 },
  tendencies: { usageRate: 29 },
  dataConfidence: 'observed',
  source: {
    dataVersion: 'data-v1',
    ratingsVersion: 'ratings-v1',
    selectionScoreVersion: 'score-v1',
  },
};

describe('player-season contracts', () => {
  it('accepts a valid peak player season', () => {
    expect(peakPlayerSeasonSchema.safeParse(validPlayer).success).toBe(true);
  });

  it('rejects a season with fewer than 40 team games', () => {
    const invalid = {
      ...validPlayer,
      eligibility: { ...validPlayer.eligibility, teamGames: 39 },
    };
    expect(peakPlayerSeasonSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects an ineligible position canonical value', () => {
    const invalid = {
      ...validPlayer,
      positions: { ...validPlayer.positions, canonical: ['G', 'PG'] },
    };
    expect(peakPlayerSeasonSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects a rating outside the 0-100 range', () => {
    const invalid = {
      ...validPlayer,
      summaryRatings: { ...validPlayer.summaryRatings, overallRating: 101 },
    };
    expect(peakPlayerSeasonSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects a duplicate player id inside a pool', () => {
    const duplicate = [validPlayer, { ...validPlayer, seasonKey: '1997-98', selectionScore: 96 }];
    const parsed = franchiseEraPoolSchema.safeParse({
      schemaVersion: 1,
      dataVersion: 'data-v1',
      franchiseId: 'lakers',
      eraId: '1990s',
      eligibility: { minimumTeamGames: 40 },
      players: duplicate,
    });
    expect(parsed.success).toBe(true);
    expect(new Set(parsed.data!.players.map((p) => p.playerId)).size).toBe(1);
  });
});

describe('lineup contracts', () => {
  const assignment = (slotIndex: number, playerId: string): LineupAssignment => ({
    slotIndex: slotIndex as LineupAssignment['slotIndex'],
    playerId,
    positions: ['G'],
  });

  it('accepts a five-assignment legal lineup', () => {
    const lineup: Lineup = {
      structure: ['G', 'G', 'F', 'F', 'C'],
      assignments: [
        assignment(0, 'p-1'),
        assignment(1, 'p-2'),
        assignment(2, 'p-3'),
        assignment(3, 'p-4'),
        assignment(4, 'p-5'),
      ],
    };
    expect(lineupSchema.safeParse(lineup).success).toBe(true);
  });

  it('rejects a four-assignment lineup', () => {
    const lineup: Lineup = {
      structure: ['G', 'G', 'F', 'F', 'C'],
      assignments: [
        assignment(0, 'p-1'),
        assignment(1, 'p-2'),
        assignment(2, 'p-3'),
        assignment(3, 'p-4'),
      ],
    };
    expect(lineupSchema.safeParse(lineup).success).toBe(false);
  });

  it('rejects a wrong structure', () => {
    const lineup: Lineup = {
      structure: ['G', 'G', 'F', 'F', 'C'],
      assignments: [
        { ...assignment(0, 'p-1'), positions: ['C'] },
        assignment(1, 'p-2'),
        assignment(2, 'p-3'),
        assignment(3, 'p-4'),
        assignment(4, 'p-5'),
      ],
    };
    expect(lineupSchema.safeParse(lineup).success).toBe(true);
  });
});

describe('run contracts', () => {
  it('accepts an active sandbox run with a legal seed', () => {
    const run = {
      runId: 'run-1',
      mode: 'sandbox',
      franchiseId: 'lakers',
      eraId: '1990s',
      playerIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
      runSeed: 'abcd1234abcd1234abcd1234abcd1234',
      versions: {
        saveSchemaVersion: 1,
        dataVersion: 'data-v1',
        ratingVersion: 'ratings-v1',
        positionNormalizationVersion: 'position-v1',
        engineVersion: 'engine-v1',
        bracketVersion: 'bracket-v1',
        scheduleVersion: 'schedule-v1',
      },
      difficulty: {
        profileVersion: 'medium-v1',
        name: 'medium',
        leagueMedianPercentileBand: [0.45, 0.6],
        teamPercentileBand: [0.3, 0.7],
      },
      status: 'active',
      schedule: { opponents: new Array(30).fill('lakers') },
      games: [],
    };
    expect(challengeRunSchema.safeParse(run).success).toBe(true);
  });

  it('rejects a malformed seed', () => {
    const run = {
      runId: 'run-1',
      mode: 'sandbox',
      franchiseId: 'lakers',
      eraId: '1990s',
      playerIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
      runSeed: 'not-hex!',
      versions: {
        saveSchemaVersion: 1,
        dataVersion: 'data-v1',
        ratingVersion: 'ratings-v1',
        positionNormalizationVersion: 'position-v1',
        engineVersion: 'engine-v1',
        bracketVersion: 'bracket-v1',
        scheduleVersion: 'schedule-v1',
      },
      difficulty: {
        profileVersion: 'medium-v1',
        name: 'medium',
        leagueMedianPercentileBand: [0.45, 0.6],
        teamPercentileBand: [0.3, 0.7],
      },
      status: 'active',
      schedule: { opponents: new Array(30).fill('lakers') },
      games: [],
    };
    expect(challengeRunSchema.safeParse(run).success).toBe(false);
  });
});

describe('manifest contracts', () => {
  it('accepts the shipped manifest shape', () => {
    const manifest = {
      schemaVersion: 1,
      dataVersion: 'm0.1',
      franchiseLineage: [
        {
          franchiseId: 'lakers',
          displayName: 'Los Angeles Lakers',
          teamExternalId: '1610612747',
          names: [
            { name: 'Minneapolis Lakers', fromSeasonKey: '1948-49', toSeasonKey: '1959-60' },
            { name: 'Los Angeles Lakers', fromSeasonKey: '1960-61', toSeasonKey: null },
          ],
        },
      ],
      eras: [{ eraId: '1990s', label: '1990s', fromSeasonKey: '1990-91', toSeasonKey: '1999-00' }],
      pools: [],
      assets: {
        headshotUrlTemplate: 'https://cdn.example.com/{playerExternalId}.png',
        logoUrlTemplate: 'https://cdn.example.com/{teamExternalId}.svg',
        source: 'example',
        cacheVersion: 'v1',
      },
    };
    expect(hoopRushManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('rejects a bad content hash', () => {
    const manifest = {
      schemaVersion: 1,
      dataVersion: 'm0.1',
      franchiseLineage: [],
      eras: [],
      pools: [{ franchiseId: 'lakers', eraId: '1990s', url: 'pools/l.json', contentHash: 'short' }],
      assets: {
        headshotUrlTemplate: null,
        logoUrlTemplate: null,
        source: 'example',
        cacheVersion: 'v1',
      },
    };
    expect(hoopRushManifestSchema.safeParse(manifest).success).toBe(false);
  });
});
