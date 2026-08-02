import { describe, expect, it } from 'vitest';
import {
  challengeRunSchema,
  franchiseAbbreviation,
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  lineupSchema,
  opponentBracketSchema,
  opponentTeamSchema,
  peakPlayerSeasonSchema,
  simulationPlayerSchema,
  simulationTeamSchema,
  workerMessageSchema,
  workerRequestSchema,
} from './index.js';
import type { Lineup, LineupAssignment, PeakPlayerSeason } from './index.js';

const validPlayer: PeakPlayerSeason = {
  schemaVersion: 2,
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
    normalizationVersion: 'position-v2',
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
    offensiveRebounds: 100,
    defensiveRebounds: 400,
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
  historicalTeamIdentity: {
    teamId: '1610612747',
    displayName: 'Los Angeles Lakers',
    city: 'Los Angeles',
    abbreviation: 'LAL',
    seasonKey: '1996-97',
    lineageRuleVersion: 'lineage-v1',
  },
  summaryRatings: { overallRating: 96, offenseRating: 98, defenseRating: 86 },
  detailedRatings: {
    insideScoring: 90,
    closeShot: 82,
    midrange: 84,
    threePoint: 62,
    freeThrow: 86,
    ballHandling: 95,
    passing: 98,
    offensiveIq: 96,
    offensiveRebound: 55,
    defensiveRebound: 70,
    perimeterDefense: 74,
    interiorDefense: 68,
    steal: 82,
    block: 60,
    defensiveIq: 80,
    speed: 85,
    strength: 84,
    vertical: 75,
  },
  tendencies: {
    usageRate: 29,
    passRate: 44,
    shotRate: 26,
    driveRate: 22,
    postUpRate: 6,
    rimFrequency: 32,
    shortMidFrequency: 20,
    longMidFrequency: 18,
    cornerThreeFrequency: 8,
    aboveBreakThreeFrequency: 14,
    threePointRate: 20,
    freeThrowRate: 24,
    turnoverRate: 13,
    isolationRate: 18,
    pickAndRollBallHandlerRate: 36,
    pickAndRollRollManRate: 6,
    spotUpRate: 18,
    transitionRate: 16,
    cutRate: 8,
    foulRate: 2,
    stealAttemptRate: 10,
    blockAttemptRate: 9,
    crashOffensiveGlassRate: 12,
  },
  anchors: {
    gamesPlayed: 78,
    minutesPerGame: 35.9,
    pointsPerGame: 19.2,
    reboundsPerGame: 6.4,
    offensiveReboundsPerGame: 1.3,
    defensiveReboundsPerGame: 5.1,
    assistsPerGame: 11.5,
    stealsPerGame: 1.5,
    blocksPerGame: 0.5,
    turnoversPerGame: 3.8,
    fieldGoalPct: 0.545,
    threePointPct: 0.36,
    freeThrowPct: 0.846,
    threePointAttemptRate: 0.227,
    freeThrowAttemptRate: 0.236,
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

  it('accepts a player with a Basketball-Reference alt id', () => {
    const withAltIds = {
      ...validPlayer,
      altIds: { bbref: 'jordami01' },
    };
    expect(peakPlayerSeasonSchema.safeParse(withAltIds).success).toBe(true);
  });

  it('accepts a player without alt ids', () => {
    expect(peakPlayerSeasonSchema.safeParse({ ...validPlayer, altIds: null }).success).toBe(true);
    expect(
      peakPlayerSeasonSchema.safeParse({ ...validPlayer, altIds: { bbref: null } }).success,
    ).toBe(true);
  });

  it('rejects a malformed Basketball-Reference alt id', () => {
    const invalid = {
      ...validPlayer,
      altIds: { bbref: 'Jordan-01!' },
    };
    expect(peakPlayerSeasonSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts a player with a direct photo url', () => {
    const withPhoto = {
      ...validPlayer,
      altIds: { bbref: null, photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/x.png' },
    };
    expect(peakPlayerSeasonSchema.safeParse(withPhoto).success).toBe(true);
  });

  it('rejects a malformed direct photo url', () => {
    const invalid = {
      ...validPlayer,
      altIds: { photoUrl: 'not-a-url' },
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
      schemaVersion: 2,
      dataVersion: 'data-v1',
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
  const simPlayer = (id: string, position: string) => ({
    playerId: id,
    displayName: `Player ${id}`,
    positions: [position],
    heightInches: 76,
    weightLbs: 200,
    ratings: {
      insideScoring: 80,
      closeShot: 70,
      midrange: 70,
      threePoint: 70,
      freeThrow: 75,
      ballHandling: 75,
      passing: 75,
      offensiveIq: 75,
      offensiveRebound: 60,
      defensiveRebound: 60,
      perimeterDefense: 65,
      interiorDefense: 65,
      steal: 60,
      block: 60,
      defensiveIq: 65,
      speed: 75,
      strength: 65,
      vertical: 70,
    },
    tendencies: {
      usageRate: 20,
      passRate: 30,
      shotRate: 25,
      driveRate: 20,
      postUpRate: 5,
      rimFrequency: 30,
      shortMidFrequency: 20,
      longMidFrequency: 15,
      cornerThreeFrequency: 8,
      aboveBreakThreeFrequency: 12,
      threePointRate: 25,
      freeThrowRate: 20,
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
  });

  const fivePlayers = [
    simPlayer('p-1', 'G'),
    simPlayer('p-2', 'G'),
    simPlayer('p-3', 'F'),
    simPlayer('p-4', 'F'),
    simPlayer('p-5', 'C'),
  ];

  const opponents = Array.from({ length: 30 }, (_, index) => ({
    schemaVersion: 1,
    opponentId: index === 0 ? 'lakers-1990s-opening' : `bracket-team-${index}`,
    bracketVersion: 'bracket-v1',
    difficultyBand: 'medium',
    teamId: `team-${index}`,
    displayName: `Opponent ${index}`,
    seasonKey: '1995-96',
    lineup: {
      structure: ['G', 'G', 'F', 'F', 'C'],
      assignments: fivePlayers.map((player, slotIndex) => ({
        slotIndex,
        playerId: player.playerId,
        positions: player.positions,
      })),
    },
    players: fivePlayers.map((player) => ({
      ...player,
      playerId: `p-opp-${index}-${player.playerId}`,
    })),
    strength: {
      evaluationVersion: 'gen-v1',
      benchmarkVersion: 'benchmark-v1',
      sampleCount: 1,
      winRate: 0.5,
      percentile: 0.5,
    },
  }));

  const schedule = (opponentIds: string[]) =>
    Array.from({ length: 82 }, (_, index) => ({
      gameNumber: index + 1,
      opponentId: opponentIds[index % 30]!,
    }));

  const zeroAggregates = {
    team: {
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      points: 0,
      fieldGoals: { made: 0, attempted: 0 },
      threes: { made: 0, attempted: 0 },
      freeThrows: { made: 0, attempted: 0 },
      rebounds: { total: 0, offensive: 0, defensive: 0, team: 0 },
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
      possessions: 0,
    },
    players: fivePlayers.map((player) => ({
      playerId: player.playerId,
      gamesPlayed: 0,
      minutes: 0,
      points: 0,
      fieldGoals: { made: 0, attempted: 0 },
      threes: { made: 0, attempted: 0 },
      freeThrows: { made: 0, attempted: 0 },
      rebounds: { total: 0, offensive: 0, defensive: 0 },
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
    })),
  };

  const baseRun = {
    schemaVersion: 1,
    runId: 'run-1',
    mode: 'sandbox',
    franchiseId: 'lakers',
    eraId: '1990s',
    homeDisplayName: 'Los Angeles Lakers',
    playerIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
    lineup: {
      structure: ['G', 'G', 'F', 'F', 'C'],
      assignments: fivePlayers.map((player, slotIndex) => ({
        slotIndex,
        playerId: player.playerId,
        positions: player.positions,
      })),
    },
    players: fivePlayers,
    runSeed: 'abcd1234abcd1234abcd1234abcd1234',
    versions: {
      saveSchemaVersion: 3,
      dataVersion: 'data-v1',
      ratingVersion: 'ratings-v1',
      positionNormalizationVersion: 'position-v2',
      engineVersion: 'engine-v1',
      bracketVersion: 'bracket-v1',
      scheduleVersion: 'schedule-v1',
      seedDerivationVersion: 'seed-v1',
    },
    eraProfileVersion: 'profile-v1',
    difficulty: {
      profileVersion: 'medium-v1',
      name: 'medium',
      leagueMedianPercentileBand: [0.4, 0.55],
      teamPercentileBand: [0.25, 0.65],
    },
    bracket: {
      bracketVersion: 'bracket-v1',
      scheduleVersion: 'schedule-v1',
      opponents,
      schedule: schedule(opponents.map((o) => o.opponentId)),
    },
    status: 'active',
    firstLossGameNumber: null,
    games: [],
    aggregates: zeroAggregates,
  };

  it('accepts an active sandbox run with a legal seed', () => {
    expect(challengeRunSchema.safeParse(baseRun).success).toBe(true);
  });

  it('rejects a malformed seed', () => {
    const run = { ...baseRun, runSeed: 'not-hex!' };
    expect(challengeRunSchema.safeParse(run).success).toBe(false);
  });

  it('rejects a run with fewer than 82 schedule entries', () => {
    const run = {
      ...baseRun,
      bracket: { ...baseRun.bracket, schedule: baseRun.bracket.schedule.slice(0, 81) },
    };
    expect(challengeRunSchema.safeParse(run).success).toBe(false);
  });
});

describe('manifest contracts', () => {
  const thirtySlots = Array.from({ length: 30 }, (_, index) => ({
    franchiseId: `franchise-${index}`,
    displayName: `Franchise ${index}`,
    teamExternalId: String(1610612700 + index),
  }));

  it('accepts the shipped manifest shape', () => {
    const manifest = {
      schemaVersion: 2,
      dataVersion: 'm0.1',
      modernFranchiseSlots: thirtySlots,
      franchiseLineage: [
        {
          modernFranchiseId: 'lakers',
          historicalTeamId: '1610612747',
          validFromSeasonKey: '1948-49',
          validThroughSeasonKey: '1959-60',
          displayName: 'Minneapolis Lakers',
          city: 'Minneapolis',
          abbreviation: 'MNL',
          sourceIdentityIds: ['1610612747'],
          lineageRuleVersion: 'lineage-v1',
        },
        {
          modernFranchiseId: 'lakers',
          historicalTeamId: '1610612747',
          validFromSeasonKey: '1960-61',
          displayName: 'Los Angeles Lakers',
          city: 'Los Angeles',
          abbreviation: 'LAL',
          sourceIdentityIds: ['1610612747'],
          lineageRuleVersion: 'lineage-v1',
        },
      ],
      eras: [{ eraId: '1990s', label: '1990s', fromSeasonKey: '1990-91', toSeasonKey: '1999-00' }],
      pools: [],
      availability: [
        {
          franchiseId: 'lakers',
          eraId: '1990s',
          status: 'available',
          url: 'pools/lakers-1990s.json',
          contentHash: 'a'.repeat(64),
          playerCount: 20,
          coverageSummary: {
            coverageBand: 'complete-box-derived',
            observedFamilies: ['base'],
            derivedFamilies: ['advanced'],
            estimatedFamilies: [],
            missingCategories: [],
            lowConfidenceShare: 0,
            policyVersion: 'policy-v1',
          },
        },
      ],
      eraSimulationProfiles: [],
      assets: {
        headshotUrlTemplate: 'https://cdn.example.com/{playerExternalId}.png',
        headshotUrlTemplateSecondary:
          'https://www.basketball-reference.com/req/20200617/images/headshots/{altIds.bbref}.jpg',
        logoUrlTemplate: 'https://cdn.example.com/{teamExternalId}.svg',
        logoUrlTemplateSecondary:
          'https://a.espncdn.com/i/teamlogos/nba/500/{teamAbbreviation}.png',
        source: 'example',
        cacheVersion: 'v1',
      },
    };
    expect(hoopRushManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('rejects a bad content hash', () => {
    const manifest = {
      schemaVersion: 2,
      dataVersion: 'm0.1',
      modernFranchiseSlots: thirtySlots,
      franchiseLineage: [],
      eras: [],
      pools: [{ franchiseId: 'lakers', eraId: '1990s', url: 'pools/l.json', contentHash: 'short' }],
      availability: [],
      eraSimulationProfiles: [],
      assets: {
        headshotUrlTemplate: null,
        headshotUrlTemplateSecondary: null,
        logoUrlTemplate: null,
        logoUrlTemplateSecondary: null,
        source: 'example',
        cacheVersion: 'v1',
      },
    };
    expect(hoopRushManifestSchema.safeParse(manifest).success).toBe(false);
  });
});

describe('simulation contracts', () => {
  const player = {
    playerId: 'p-1',
    displayName: 'Test Player',
    positions: ['G'],
    heightInches: 76,
    weightLbs: 200,
    ratings: {
      insideScoring: 80,
      closeShot: 70,
      midrange: 70,
      threePoint: 70,
      freeThrow: 75,
      ballHandling: 75,
      passing: 75,
      offensiveIq: 75,
      offensiveRebound: 60,
      defensiveRebound: 60,
      perimeterDefense: 65,
      interiorDefense: 65,
      steal: 60,
      block: 60,
      defensiveIq: 65,
      speed: 75,
      strength: 65,
      vertical: 70,
    },
    tendencies: {
      usageRate: 20,
      passRate: 30,
      shotRate: 25,
      driveRate: 20,
      postUpRate: 5,
      rimFrequency: 30,
      shortMidFrequency: 20,
      longMidFrequency: 15,
      cornerThreeFrequency: 8,
      aboveBreakThreeFrequency: 12,
      threePointRate: 25,
      freeThrowRate: 20,
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
  } as const;

  it('accepts a valid simulation player', () => {
    expect(simulationPlayerSchema.safeParse(player).success).toBe(true);
  });

  it('rejects a player carrying a summary overall rating', () => {
    const invalid = { ...player, ratings: { ...player.ratings, overall: 90 } };
    expect(simulationPlayerSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects a rating outside 0-100', () => {
    const invalid = { ...player, ratings: { ...player.ratings, passing: 101 } };
    expect(simulationPlayerSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects a team without exactly five players', () => {
    const team = { teamId: 'lakers', displayName: 'Lakers', players: [player] };
    expect(simulationTeamSchema.safeParse(team).success).toBe(false);
  });
});

describe('opponent contracts', () => {
  it('rejects an opponent whose lineup and players disagree', () => {
    const opponent = {
      schemaVersion: 1,
      opponentId: 'lakers-1990s-opening',
      bracketVersion: 'bracket-v1',
      difficultyBand: 'medium',
      teamId: 'lakers',
      displayName: 'Los Angeles Lakers',
      seasonKey: '1995-96',
      lineup: {
        structure: ['G', 'G', 'F', 'F', 'C'],
        assignments: [
          { slotIndex: 0, playerId: 'p-89', positions: ['G'] },
          { slotIndex: 1, playerId: 'p-9', positions: ['G'] },
          { slotIndex: 2, playerId: 'p-920', positions: ['F'] },
          { slotIndex: 3, playerId: 'p-109', positions: ['F'] },
          { slotIndex: 4, playerId: 'p-124', positions: ['C'] },
        ],
      },
      players: [],
    };
    expect(opponentTeamSchema.safeParse(opponent).success).toBe(false);
  });
});

describe('worker message contracts (M3)', () => {
  it('accepts a simulate request with a valid run snapshot', () => {
    const run = buildMinimalRun();
    const request = {
      schemaVersion: 1,
      type: 'simulate',
      requestId: 'req-1',
      run,
      startGameNumber: 1,
      profile: eraProfileFixture(),
      engineVersion: 'engine-v1',
    };
    expect(workerRequestSchema.safeParse(request).success).toBe(true);
  });

  it('accepts a cancel request and rejects a stale schema version', () => {
    expect(
      workerRequestSchema.safeParse({
        schemaVersion: 1,
        type: 'cancel',
        requestId: 'req-1',
      }).success,
    ).toBe(true);
    expect(
      workerRequestSchema.safeParse({
        schemaVersion: 2,
        type: 'cancel',
        requestId: 'req-1',
      }).success,
    ).toBe(false);
  });

  it('rejects a simulate request with an out-of-range start game', () => {
    const request = {
      schemaVersion: 1,
      type: 'simulate',
      requestId: 'req-1',
      run: buildMinimalRun(),
      startGameNumber: 83,
      profile: eraProfileFixture(),
      engineVersion: 'engine-v1',
    };
    expect(workerRequestSchema.safeParse(request).success).toBe(false);
  });

  it('accepts results, complete, and error worker messages', () => {
    expect(
      workerMessageSchema.safeParse({
        schemaVersion: 1,
        type: 'results',
        requestId: 'req-1',
        fromGameNumber: 5,
        results: [gameResultFixture(5), gameResultFixture(6)],
      }).success,
    ).toBe(true);
    expect(
      workerMessageSchema.safeParse({
        schemaVersion: 1,
        type: 'complete',
        requestId: 'req-1',
        gamesDelivered: 82,
        cancelled: false,
      }).success,
    ).toBe(true);
    expect(
      workerMessageSchema.safeParse({
        schemaVersion: 1,
        type: 'error',
        requestId: 'req-1',
        message: 'worker crashed',
      }).success,
    ).toBe(true);
  });

  it('rejects a results message with a missing request id', () => {
    expect(
      workerMessageSchema.safeParse({
        schemaVersion: 1,
        type: 'results',
        fromGameNumber: 5,
        results: [gameResultFixture(5)],
      }).success,
    ).toBe(false);
  });

  it('rejects a results message with an empty or oversized batch', () => {
    expect(
      workerMessageSchema.safeParse({
        schemaVersion: 1,
        type: 'results',
        requestId: 'req-1',
        fromGameNumber: 5,
        results: [],
      }).success,
    ).toBe(false);
    expect(
      workerMessageSchema.safeParse({
        schemaVersion: 1,
        type: 'results',
        requestId: 'req-1',
        fromGameNumber: 5,
        results: Array.from({ length: 9 }, (_, i) => gameResultFixture(5 + i)),
      }).success,
    ).toBe(false);
  });
});

/** Minimal valid era profile used by worker request fixtures. */
function eraProfileFixture() {
  return {
    schemaVersion: 1,
    eraId: '1990s',
    profileVersion: 'profile-v1',
    dataVersion: 'data-v1',
    seasons: ['1990-91'],
    baselineReport: 'fixture',
    parameters: {
      pace: 95,
      league3PARate: 0.14,
      leagueTsPct: 0.51,
      leagueFtaPerFga: 0.28,
      leagueFtPct: 0.74,
      turnoverPerPossession: 0.15,
      stealShareOfTurnovers: 0.3,
      offensiveReboundRate: 0.315,
      assistRate: 0.62,
      foulsPerPossession: 0.21,
      shootingFoulShare: 0.42,
      freeThrowAnchorRating: 74,
      assistAnchorRating: 70,
      zoneMix: {
        rim: 0.3,
        shortMid: 0.25,
        longMid: 0.19,
        cornerThree: 0.06,
        aboveBreakThree: 0.2,
      },
      source: 'fixture',
    },
    targets: {
      possessionsPerGame: { value: 95, tolerance: 4, minimumSample: 0 },
      pointsPerGame: { value: 101, tolerance: 6, minimumSample: 0 },
      offensiveRating: { value: 106, tolerance: 6, minimumSample: 0 },
      fieldGoalPct: { value: 0.47, tolerance: 0.02, minimumSample: 0 },
      efgPct: { value: 0.5, tolerance: 0.02, minimumSample: 0 },
      tsPct: { value: 0.53, tolerance: 0.02, minimumSample: 0 },
      threePointRate: { value: 0.14, tolerance: 0.02, minimumSample: 0 },
      threePointPct: { value: 0.34, tolerance: 0.02, minimumSample: 0 },
      freeThrowsAttemptedPerGame: { value: 27, tolerance: 3, minimumSample: 0 },
      freeThrowPct: { value: 0.74, tolerance: 0.02, minimumSample: 0 },
      turnoversPerGame: { value: 14.5, tolerance: 1.5, minimumSample: 0 },
      turnoversPerPossession: { value: 0.15, tolerance: 0.01, minimumSample: 0 },
      offensiveReboundsPerGame: { value: 12, tolerance: 1.5, minimumSample: 0 },
      offensiveReboundRate: { value: 0.315, tolerance: 0.02, minimumSample: 0 },
      assistsPerGame: { value: 24, tolerance: 2.5, minimumSample: 0 },
      assistRate: { value: 0.62, tolerance: 0.03, minimumSample: 0 },
      personalFoulsPerGame: { value: 21, tolerance: 2.5, minimumSample: 0 },
      zoneMix: {
        rim: { value: 0.3, tolerance: 0.02, minimumSample: 0 },
        shortMid: { value: 0.25, tolerance: 0.02, minimumSample: 0 },
        longMid: { value: 0.19, tolerance: 0.02, minimumSample: 0 },
        cornerThree: { value: 0.06, tolerance: 0.015, minimumSample: 0 },
        aboveBreakThree: { value: 0.2, tolerance: 0.02, minimumSample: 0 },
      },
      closeGameRate: { value: 0.18, tolerance: 0.04, minimumSample: 0 },
      blowoutRate: { value: 0.12, tolerance: 0.04, minimumSample: 0 },
      overtimeRate: { value: 0.06, tolerance: 0.02, minimumSample: 0 },
      strongVsWeakWinRate: { value: 0.85, tolerance: 0.08, minimumSample: 0 },
      equalLineupHomeWinRate: { value: 0.5, tolerance: 0.05, minimumSample: 0 },
    },
  };
}

/** Minimal valid game result used by worker message fixtures. */
function gameResultFixture(gameNumber: number) {
  const side = (teamId: string, displayName: string) => ({
    teamId,
    displayName,
    box: {
      teamId,
      points: 100,
      fieldGoals: { made: 40, attempted: 84 },
      threes: { made: 10, attempted: 24 },
      freeThrows: { made: 20, attempted: 26 },
      rebounds: { total: 42, offensive: 10, defensive: 28, team: 4 },
      assists: 24,
      steals: 8,
      blocks: 5,
      turnovers: 13,
      fouls: 19,
      possessions: 96,
    },
    players: Array.from({ length: 5 }, (_, i) => ({
      playerId: `p-${i}`,
      minutes: 48,
      points: 20,
      fieldGoals: { made: 8, attempted: 17 },
      threes: { made: 2, attempted: 5 },
      freeThrows: { made: 4, attempted: 5 },
      rebounds: { total: 8, offensive: 2, defensive: 6 },
      assists: 5,
      steals: 2,
      blocks: 1,
      turnovers: 3,
      fouls: 4,
    })),
    shotZones: ['rim', 'shortMid', 'longMid', 'cornerThree', 'aboveBreakThree'].map((zone) => ({
      zone,
      attempts: 17,
      makes: 8,
    })),
  });
  return {
    schemaVersion: 1,
    gameNumber,
    seed: 'a'.repeat(32),
    engineVersion: 'engine-v1',
    dataVersion: 'data-v1',
    profileVersion: 'profile-v1',
    home: side('user', 'Your five'),
    away: side('lakers', 'Los Angeles Lakers'),
    periodScores: { home: [25, 25, 25, 25], away: [24, 24, 26, 26] },
    winner: 'home' as const,
    overtimePeriods: 0,
    facts: [],
  };
}

/** Minimal valid challenge run for worker request fixtures. */
function buildMinimalRun() {
  const five = ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'];
  const zero = () => ({ made: 0, attempted: 0 });
  return {
    schemaVersion: 1,
    runId: 'run-1',
    mode: 'sandbox',
    franchiseId: 'lakers',
    eraId: '1990s',
    homeDisplayName: 'Los Angeles Lakers',
    playerIds: five,
    lineup: {
      structure: ['G', 'G', 'F', 'F', 'C'],
      assignments: five.map((playerId, slotIndex) => ({
        slotIndex,
        playerId,
        positions:
          ['G', 'G', 'F', 'F', 'C'][slotIndex]! === 'G'
            ? ['G']
            : ['F', 'F', 'C'][slotIndex - 2] === 'F'
              ? ['F']
              : ['C'],
      })),
    },
    players: five.map((playerId, slotIndex) => ({
      playerId,
      displayName: `Player ${playerId}`,
      positions:
        ['G', 'G', 'F', 'F', 'C'][slotIndex] === 'G'
          ? ['G']
          : ['F', 'F', 'C'][slotIndex - 2] === 'F'
            ? ['F']
            : ['C'],
      heightInches: 76,
      weightLbs: 200,
      ratings: {
        insideScoring: 80,
        closeShot: 70,
        midrange: 70,
        threePoint: 70,
        freeThrow: 75,
        ballHandling: 75,
        passing: 75,
        offensiveIq: 75,
        offensiveRebound: 60,
        defensiveRebound: 60,
        perimeterDefense: 65,
        interiorDefense: 65,
        steal: 60,
        block: 60,
        defensiveIq: 65,
        speed: 75,
        strength: 65,
        vertical: 70,
      },
      tendencies: {
        usageRate: 20,
        passRate: 30,
        shotRate: 25,
        driveRate: 20,
        postUpRate: 5,
        rimFrequency: 30,
        shortMidFrequency: 20,
        longMidFrequency: 15,
        cornerThreeFrequency: 8,
        aboveBreakThreeFrequency: 12,
        threePointRate: 25,
        freeThrowRate: 20,
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
    })),
    runSeed: 'abcd1234abcd1234abcd1234abcd1234',
    versions: {
      saveSchemaVersion: 3,
      dataVersion: 'data-v1',
      ratingVersion: 'ratings-v1',
      positionNormalizationVersion: 'position-v2',
      engineVersion: 'engine-v1',
      bracketVersion: 'bracket-v1',
      scheduleVersion: 'schedule-v1',
      seedDerivationVersion: 'seed-v1',
    },
    eraProfileVersion: 'profile-v1',
    difficulty: {
      profileVersion: 'medium-v1',
      name: 'medium',
      leagueMedianPercentileBand: [0.4, 0.55],
      teamPercentileBand: [0.25, 0.65],
    },
    bracket: {
      bracketVersion: 'bracket-v1',
      scheduleVersion: 'schedule-v1',
      opponents: Array.from({ length: 30 }, (_, index) => ({
        schemaVersion: 1,
        opponentId: index === 0 ? 'lakers-1990s-opening' : `bracket-team-${index}`,
        bracketVersion: 'bracket-v1',
        difficultyBand: 'medium' as const,
        teamId: `team-${index}`,
        displayName: `Opponent ${index}`,
        seasonKey: '1995-96',
        lineup: {
          structure: ['G', 'G', 'F', 'F', 'C'],
          assignments: five.map((playerId, slotIndex) => ({
            slotIndex,
            playerId: `p-opp-${index}-${playerId}`,
            positions:
              ['G', 'G', 'F', 'F', 'C'][slotIndex] === 'G'
                ? ['G']
                : ['F', 'F', 'C'][slotIndex - 2] === 'F'
                  ? ['F']
                  : ['C'],
          })),
        },
        players: five.map((playerId, slotIndex) => ({
          playerId: `p-opp-${index}-${playerId}`,
          displayName: `Opp ${index} ${slotIndex}`,
          positions:
            ['G', 'G', 'F', 'F', 'C'][slotIndex] === 'G'
              ? ['G']
              : ['F', 'F', 'C'][slotIndex - 2] === 'F'
                ? ['F']
                : ['C'],
          heightInches: 76,
          weightLbs: 200,
          ratings: {
            insideScoring: 80,
            closeShot: 70,
            midrange: 70,
            threePoint: 70,
            freeThrow: 75,
            ballHandling: 75,
            passing: 75,
            offensiveIq: 75,
            offensiveRebound: 60,
            defensiveRebound: 60,
            perimeterDefense: 65,
            interiorDefense: 65,
            steal: 60,
            block: 60,
            defensiveIq: 65,
            speed: 75,
            strength: 65,
            vertical: 70,
          },
          tendencies: {
            usageRate: 20,
            passRate: 30,
            shotRate: 25,
            driveRate: 20,
            postUpRate: 5,
            rimFrequency: 30,
            shortMidFrequency: 20,
            longMidFrequency: 15,
            cornerThreeFrequency: 8,
            aboveBreakThreeFrequency: 12,
            threePointRate: 25,
            freeThrowRate: 20,
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
        })),
        strength: {
          evaluationVersion: 'gen-v1',
          benchmarkVersion: 'benchmark-v1',
          sampleCount: 1,
          winRate: 0.5,
          percentile: 0.5,
        },
      })),
      schedule: Array.from({ length: 82 }, (_, index) => ({
        gameNumber: index + 1,
        opponentId: index === 0 ? 'lakers-1990s-opening' : `bracket-team-${(index % 29) + 1}`,
      })),
    },
    status: 'active',
    firstLossGameNumber: null,
    games: [],
    aggregates: {
      team: {
        wins: 0,
        losses: 0,
        gamesPlayed: 0,
        points: 0,
        fieldGoals: zero(),
        threes: zero(),
        freeThrows: zero(),
        rebounds: { total: 0, offensive: 0, defensive: 0, team: 0 },
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        possessions: 0,
      },
      players: five.map((playerId) => ({
        playerId,
        gamesPlayed: 0,
        minutes: 0,
        points: 0,
        fieldGoals: zero(),
        threes: zero(),
        freeThrows: zero(),
        rebounds: { total: 0, offensive: 0, defensive: 0 },
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
      })),
    },
  };
}

describe('franchise abbreviations', () => {
  it('uses standard three-letter codes for every current NBA franchise', () => {
    const abbreviations = [
      ['hawks', 'ATL'],
      ['celtics', 'BOS'],
      ['nets', 'BKN'],
      ['hornets', 'CHA'],
      ['bulls', 'CHI'],
      ['cavaliers', 'CLE'],
      ['mavericks', 'DAL'],
      ['nuggets', 'DEN'],
      ['pistons', 'DET'],
      ['warriors', 'GSW'],
      ['rockets', 'HOU'],
      ['pacers', 'IND'],
      ['clippers', 'LAC'],
      ['lakers', 'LAL'],
      ['grizzlies', 'MEM'],
      ['heat', 'MIA'],
      ['bucks', 'MIL'],
      ['timberwolves', 'MIN'],
      ['pelicans', 'NOP'],
      ['knicks', 'NYK'],
      ['thunder', 'OKC'],
      ['magic', 'ORL'],
      ['sixers', 'PHI'],
      ['suns', 'PHX'],
      ['blazers', 'POR'],
      ['kings', 'SAC'],
      ['spurs', 'SAS'],
      ['raptors', 'TOR'],
      ['jazz', 'UTA'],
      ['wizards', 'WAS'],
    ] as const;

    for (const [franchiseId, abbreviation] of abbreviations) {
      expect(franchiseAbbreviation(franchiseId)).toBe(abbreviation);
      expect(abbreviation).toHaveLength(3);
    }
  });
});
