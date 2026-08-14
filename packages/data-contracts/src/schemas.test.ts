import { describe, expect, it } from 'vitest';
import {
  challengeRunSchema,
  classicCompletedDraftSchema,
  classicDraftStateSchema,
  coverageSummarySchema,
  franchiseAbbreviation,
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  lineupSchema,
  opponentTeamSchema,
  peakPlayerSeasonSchema,
  provenanceMapSchema,
  reconstructedThreePointProfileSchema,
  simulationAnchorsSchema,
  simulationPlayerSchema,
  simulationTeamSchema,
  threePointReconstructionArtifactSchema,
  workerMessageSchema,
  workerRequestSchema,
} from './index.ts';
import type { Lineup, LineupAssignment, PeakPlayerSeason } from './index.ts';

function makeSimulationPlayer(playerId: string, positions: string[]) {
  return {
    playerId,
    displayName: `Player ${playerId}`,
    positions,
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
  };
}

const SLOT_POSITIONS: string[][] = [['PG', 'SG'], ['PG', 'SG'], ['SF', 'PF'], ['SF', 'PF'], ['C']];

function makeRun() {
  const five = ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'];
  const fivePlayers = five.map((playerId, slotIndex) =>
    makeSimulationPlayer(playerId, SLOT_POSITIONS[slotIndex] ?? ['PG', 'SG']),
  );
  const opponents = Array.from({ length: 30 }, (_, index) => ({
    schemaVersion: 2,
    opponentId: index === 0 ? 'lakers-1990s-opening' : `bracket-team-${String(index)}`,
    bracketVersion: 'bracket-v1',
    difficultyBand: 'medium',
    teamId: `team-${String(index)}`,
    displayName: `Opponent ${String(index)}`,
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
      playerId: `p-opp-${String(index)}-${player.playerId}`,
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
    Array.from({ length: 82 }, (_, index) => {
      const opponentId = opponentIds[index % 30];
      if (opponentId === undefined) {
        throw new Error('schedule requires at least 30 opponent ids');
      }
      return { gameNumber: index + 1, opponentId };
    });
  const zero = () => ({ made: 0, attempted: 0 });
  const zeroAggregates = {
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
    players: fivePlayers.map((player) => ({
      playerId: player.playerId,
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
  };
  return {
    schemaVersion: 2,
    runId: 'run-1',
    mode: 'sandbox',
    franchiseId: 'lakers',
    eraId: '1990s',
    homeDisplayName: 'Los Angeles Lakers',
    playerIds: five,
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
      saveSchemaVersion: 2,
      dataVersion: 'data-v1',
      ratingVersion: 'ratings-v1',
      positionNormalizationVersion: 'position-v3',
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
}

const validPlayer: PeakPlayerSeason = {
  schemaVersion: 3,
  playerId: 'p-1',
  franchiseId: 'lakers',
  eraId: '1990s',
  seasonKey: '1996-97',
  firstName: 'Magic',
  lastName: 'Johnson',
  displayName: 'Magic Johnson',
  playerExternalId: '77142',
  positions: {
    primary: 'PG',
    secondary: ['SG'],
    playable: ['PG', 'SG'],
    sourceLabels: ['PG', 'SG'],
    normalizationVersion: 'position-v3',
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

  it('rejects an ineligible position value', () => {
    const invalid = {
      ...validPlayer,
      positions: { ...validPlayer.positions, primary: 'G' },
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

  it('accepts duplicate player ids inside a pool (uniqueness is a command concern)', () => {
    const duplicate = [validPlayer, { ...validPlayer, seasonKey: '1997-98', selectionScore: 96 }];
    const parsed = franchiseEraPoolSchema.safeParse({
      schemaVersion: 3,
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
    if (!parsed.success) return;

    expect(new Set(parsed.data.players.map((p) => p.playerId)).size).toBe(1);
    expect(new Set(parsed.data.players.map((p) => p.seasonKey)).size).toBe(2);
  });
});

describe('lineup contracts', () => {
  const assignment = (slotIndex: number, playerId: string): LineupAssignment => ({
    slotIndex: slotIndex,
    playerId,
    positions: ['PG', 'SG'],
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

  it('allows a center-positioned player in a guard slot (positions are advisory)', () => {
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
  const baseRun = makeRun();

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
    franchiseId: `franchise-${String(index)}`,
    displayName: `Franchise ${String(index)}`,
    teamExternalId: String(1610612700 + index),
  }));

  it('accepts the shipped manifest shape', () => {
    const manifest = {
      schemaVersion: 3,
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

  it('accepts a season section without M2.6.5 free-agency artifacts', () => {
    const hash = 'a'.repeat(64);
    const entry = { url: 'season/league.json', contentHash: hash };
    const parsed = hoopRushManifestSchema.safeParse({
      schemaVersion: 4,
      dataVersion: 'm0.1',
      modernFranchiseSlots: thirtySlots,
      franchiseLineage: [],
      eras: [],
      pools: [],
      availability: [],
      eraSimulationProfiles: [],
      season: {
        league: entry,
        schedule: { url: 'season/schedule.json', contentHash: hash },
        draftCatalog: { url: 'season/draft-catalog.json', contentHash: hash },
        rosterTargets: { url: 'season/roster-targets.json', contentHash: hash },
      },
      assets: {
        headshotUrlTemplate: null,
        headshotUrlTemplateSecondary: null,
        logoUrlTemplate: null,
        logoUrlTemplateSecondary: null,
        source: 'example',
        cacheVersion: 'v1',
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a bad content hash', () => {
    const manifest = {
      schemaVersion: 3,
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
  const player = makeSimulationPlayer('p-1', ['PG', 'SG']);

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
      schemaVersion: 2,
      opponentId: 'lakers-1990s-opening',
      bracketVersion: 'bracket-v1',
      difficultyBand: 'medium',
      teamId: 'lakers',
      displayName: 'Los Angeles Lakers',
      seasonKey: '1995-96',
      lineup: {
        structure: ['G', 'G', 'F', 'F', 'C'],
        assignments: [
          { slotIndex: 0, playerId: 'p-89', positions: ['PG', 'SG'] },
          { slotIndex: 1, playerId: 'p-9', positions: ['PG', 'SG'] },
          { slotIndex: 2, playerId: 'p-920', positions: ['SF', 'PF'] },
          { slotIndex: 3, playerId: 'p-109', positions: ['SF', 'PF'] },
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
      playerId: `p-${String(i)}`,
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

function buildMinimalRun() {
  return makeRun();
}

describe('classic draft contracts (M4)', () => {
  const baseDraft = {
    schemaVersion: 1,
    draftId: 'draft-1',
    variant: 'ratings',
    seed: 'abcd1234abcd1234abcd1234abcd1234',
    dataVersion: 'data-v1',
    round: 2,
    status: 'drafting',
    roll: { franchiseId: 'lakers', eraId: '1990s' },
    rerolls: { franchiseSpent: false, eraSpent: false },
    picks: [],
  };

  const pick = (round: number, playerId: string, slotIndex: number) => ({
    round,
    playerId,
    franchiseId: 'lakers',
    eraId: '1990s',
    slotIndex,
  });

  it('accepts a valid minimal drafting state', () => {
    expect(classicDraftStateSchema.safeParse(baseDraft).success).toBe(true);
  });

  it('rejects more than five picks', () => {
    const picks = Array.from({ length: 6 }, (_, i) =>
      pick((i % 5) + 1, `p-${String(i + 1)}`, i % 5),
    );
    expect(classicDraftStateSchema.safeParse({ ...baseDraft, picks }).success).toBe(false);
  });

  it('rejects an invalid variant', () => {
    expect(
      classicDraftStateSchema.safeParse({ ...baseDraft, variant: 'draft-order' }).success,
    ).toBe(false);
  });

  it('rejects a non-hex seed', () => {
    expect(classicDraftStateSchema.safeParse({ ...baseDraft, seed: 'not-a-seed' }).success).toBe(
      false,
    );
  });

  it('rejects a null roll while drafting and accepts one once complete', () => {
    expect(classicDraftStateSchema.safeParse({ ...baseDraft, roll: null }).success).toBe(false);
    expect(
      classicDraftStateSchema.safeParse({ ...baseDraft, status: 'complete', roll: null }).success,
    ).toBe(true);
  });

  it('duplicate slot indexes stay structural (uniqueness is a command concern)', () => {
    const picks = [pick(1, 'p-1', 0), pick(2, 'p-2', 0)];
    expect(classicDraftStateSchema.safeParse({ ...baseDraft, picks }).success).toBe(true);
  });

  it('accepts a completed draft snapshot and rejects short pick lists', () => {
    const picks = [0, 1, 2, 3, 4].map((slotIndex) =>
      pick(slotIndex + 1, `p-${String(slotIndex + 1)}`, slotIndex),
    );
    const snapshot = {
      draftId: 'draft-1',
      variant: 'ratings',
      seed: 'abcd1234abcd1234abcd1234abcd1234',
      picks,
    };
    expect(classicCompletedDraftSchema.safeParse(snapshot).success).toBe(true);
    expect(
      classicCompletedDraftSchema.safeParse({ ...snapshot, picks: picks.slice(0, 4) }).success,
    ).toBe(false);
  });
});

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

describe('worker start best-of contracts (M5)', () => {
  it('accepts a start request with the simulate fields minus the start game', () => {
    const request = {
      schemaVersion: 1,
      type: 'start',
      requestId: 'req-start-1',
      run: buildMinimalRun(),
      profile: eraProfileFixture(),
      engineVersion: 'engine-v1',
    };
    expect(workerRequestSchema.safeParse(request).success).toBe(true);
  });

  it('rejects a start request missing the run snapshot', () => {
    const request = {
      schemaVersion: 1,
      type: 'start',
      requestId: 'req-start-1',
      profile: eraProfileFixture(),
      engineVersion: 'engine-v1',
    };
    expect(workerRequestSchema.safeParse(request).success).toBe(false);
  });

  it('accepts a start-result message and rejects malformed scores', () => {
    expect(
      workerMessageSchema.safeParse({
        schemaVersion: 1,
        type: 'start-result',
        requestId: 'req-start-1',
        chosenRunSeed: 'abcd1234abcd1234abcd1234abcd1234',
        chosenWins: 41,
        chosenLosses: 41,
        chosenDifferential: 120,
      }).success,
    ).toBe(true);
    expect(
      workerMessageSchema.safeParse({
        schemaVersion: 1,
        type: 'start-result',
        requestId: 'req-start-1',
        chosenRunSeed: 'abcd1234abcd1234abcd1234abcd1234',
        chosenWins: -1,
        chosenLosses: 41,
        chosenDifferential: 120,
      }).success,
    ).toBe(false);
  });

  it('rejects a start-result in the request union and a start in the message union', () => {
    expect(
      workerRequestSchema.safeParse({
        schemaVersion: 1,
        type: 'start-result',
        requestId: 'req-start-1',
        chosenRunSeed: 'abcd1234abcd1234abcd1234abcd1234',
        chosenWins: 41,
        chosenLosses: 41,
        chosenDifferential: 120,
      }).success,
    ).toBe(false);
    expect(
      workerMessageSchema.safeParse({
        schemaVersion: 1,
        type: 'start',
        requestId: 'req-start-1',
        run: buildMinimalRun(),
        profile: eraProfileFixture(),
        engineVersion: 'engine-v1',
      }).success,
    ).toBe(false);
  });
});

describe('three-point reconstruction contracts (spec/12)', () => {
  const validProfile = {
    modelVersion: 'three-point-reconstruction-v1',
    accuracyConservative: 0.281,
    accuracyMean: 0.312,
    accuracyStdDev: 0.042,
    attemptRateConservative: 0.034,
    attemptRateMean: 0.058,
    attemptRateStdDev: 0.031,
    confidence: 'medium',
    floor: 0.247,
    zoneFloors: { cornerThree: 0.267, aboveBreakThree: 0.247 },
    evidence: { missingFeatures: 0, sourceFields: ['ftm', 'fta', 'fga', 'assists'] },
  };

  it('accepts a valid reconstructed three-point profile', () => {
    expect(reconstructedThreePointProfileSchema.safeParse(validProfile).success).toBe(true);
  });

  it('rejects out-of-range accuracy and attempt values', () => {
    expect(
      reconstructedThreePointProfileSchema.safeParse({ ...validProfile, accuracyConservative: 1.2 })
        .success,
    ).toBe(false);
    expect(
      reconstructedThreePointProfileSchema.safeParse({
        ...validProfile,
        attemptRateConservative: -0.1,
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown model version', () => {
    expect(
      reconstructedThreePointProfileSchema.safeParse({ ...validProfile, modelVersion: 'other-v1' })
        .success,
    ).toBe(false);
  });

  it('accepts the profile on a simulation player and a peak player season', () => {
    expect(
      simulationPlayerSchema.safeParse({
        playerId: 'p-1',
        displayName: 'Bill Russell',
        positions: ['C'],
        heightInches: 82,
        weightLbs: 220,
        ratings: validPlayer.detailedRatings,
        tendencies: validPlayer.tendencies,
        anchors: { ...validPlayer.anchors, threePointAttemptRate: null, threePointPct: null },
        reconstructedThreePoint: validProfile,
      }).success,
    ).toBe(true);
    expect(
      peakPlayerSeasonSchema.safeParse({
        ...validPlayer,
        schemaVersion: 5,
        reconstructedThreePoint: validProfile,
      }).success,
    ).toBe(true);
  });

  it('accepts schema-version 5 pools', () => {
    expect(
      franchiseEraPoolSchema.safeParse({
        schemaVersion: 5,
        dataVersion: 'm10-ratings-v3.6',
        franchiseId: 'lakers',
        eraId: '1960s',
        eligibility: { minimumTeamGames: 40 },
        coverageSummary: {
          coverageBand: 'reconstructed',
          observedFamilies: ['scoring'],
          derivedFamilies: ['shooting'],
          estimatedFamilies: [],
          reconstructedFamilies: ['three-point'],
          missingCategories: ['three-point'],
          lowConfidenceShare: 0.2,
          policyVersion: 'confidence-v1',
        },
        players: [{ ...validPlayer, schemaVersion: 5 }],
      }).success,
    ).toBe(true);
  });

  it('accepts reconstructed provenance and the coverage family', () => {
    expect(
      provenanceMapSchema.safeParse({
        threePoint: {
          kind: 'reconstructed',
          confidence: 'medium',
          methodVersion: 'derive-v8',
          sourceVersion: 'source-v1',
          sourceFields: ['ftm', 'fta', 'fga'],
          sourceStatus: 'not-applicable',
          notesCode: 'three-point-reconstruction-v1',
        },
      }).success,
    ).toBe(true);
    expect(
      coverageSummarySchema.safeParse({
        coverageBand: 'reconstructed',
        observedFamilies: [],
        derivedFamilies: [],
        estimatedFamilies: [],
        reconstructedFamilies: ['three-point'],
        missingCategories: ['three-point'],
        lowConfidenceShare: 0.1,
        policyVersion: 'confidence-v1',
      }).success,
    ).toBe(true);
  });

  it('accepts threePointAttemptRate null and retains numeric zero for observed zeros', () => {
    expect(
      simulationAnchorsSchema.safeParse({ ...validPlayer.anchors, threePointAttemptRate: null })
        .success,
    ).toBe(true);
    expect(
      simulationAnchorsSchema.safeParse({ ...validPlayer.anchors, threePointAttemptRate: 0 })
        .success,
    ).toBe(true);
    expect(
      simulationAnchorsSchema.safeParse({ ...validPlayer.anchors, threePointAttemptRate: 1.5 })
        .success,
    ).toBe(false);
  });

  it('parses the versioned reconstruction artifact', () => {
    const artifact = {
      artifactVersion: 'three-point-reconstruction-v1',
      schemaVersion: 1,
      fitCohort: {
        seasons: ['1979-80', '1980-81', '1981-82', '1982-83', '1983-84'],
        description: 'early three-point prior cohort',
      },
      featureNames: ['ftRatio', 'ftPctShrunk'],
      normalization: {
        ftRatio: { mean: 0.8, std: 0.11 },
        ftPctShrunk: { mean: 0.77, std: 0.05 },
      },
      missingDefaults: {
        G: { heightInches: 77, weightLbs: 195, age: 26 },
        F: { heightInches: 79, weightLbs: 215, age: 26 },
        C: { heightInches: 83, weightLbs: 245, age: 26 },
      },
      position2pMeans: { G: 0.45, F: 0.45, C: 0.47 },
      priors: {
        accuracyPrior: 0.33,
        accuracyPriorAttempts: 80,
        attemptRatePrior: 0.05,
        attemptRatePriorTrials: 80,
        ftPriors: { G: 0.8, F: 0.77, C: 0.71 },
      },
      regularization: { lambda: 1, maxIterations: 25, convergenceTolerance: 1e-6 },
      models: {
        accuracy: {
          intercept: -1.2,
          coefficients: { ftRatio: 0.4 },
          covariance: [
            [0.05, 0],
            [0, 0.01],
          ],
        },
        attemptRate: {
          intercept: -3.1,
          coefficients: { ftRatio: 0.2 },
          covariance: [
            [0.1, 0],
            [0, 0.02],
          ],
        },
      },
      posteriorQuantiles: { accuracy: 0.25, attemptRate: 0.3 },
      attemptRateTranslation: {
        factor: 2.5,
        caps: { G: 0.15, F: 0.08, C: 0.02 },
        description: 'conservative modern translation: 2.5x volume, capped per position',
      },
      confidenceThresholds: { highStdDev: 0.025, mediumStdDev: 0.045 },
      floors: { floor: 0.247, zoneFloors: { cornerThree: 0.267, aboveBreakThree: 0.247 } },
      ratingMapping: {
        points: [
          { accuracy: 0.2, rating: 25 },
          { accuracy: 0.32, rating: 55 },
        ],
        clampMin: 10,
        clampMax: 95,
      },
      holdout: {
        accuracy: {
          mae: 0.04,
          bias: -0.002,
          overpredictionShare: 0.45,
          samplePlayers: 900,
          positionBands: {
            G: { mae: 0.04, bias: -0.001, count: 400 },
            F: { mae: 0.04, bias: -0.002, count: 300 },
            C: { mae: 0.05, bias: -0.003, count: 200 },
          },
          evidenceBands: [{ band: 'under-500-min', mae: 0.06, bias: -0.01, count: 200 }],
          falsePositives: { count: 10, threshold: 0.33, lowerBound: 0.29 },
          falseNegatives: { count: 5, threshold: 0.33, upperBound: 0.37 },
        },
        attemptRate: {
          mae: 0.02,
          bias: 0.001,
          overpredictionShare: 0.4,
          samplePlayers: 1500,
          positionBands: {
            G: { mae: 0.02, bias: 0, count: 600 },
            F: { mae: 0.02, bias: -0.001, count: 500 },
            C: { mae: 0.03, bias: -0.002, count: 400 },
          },
          evidenceBands: [{ band: 'under-500-min', mae: 0.03, bias: -0.01, count: 300 }],
          falsePositives: { count: 15, threshold: 0.1, lowerBound: 0.05 },
          falseNegatives: { count: 8, threshold: 0.1, upperBound: 0.15 },
        },
        translatedAttemptRateModern: {
          mae: 0.1,
          bias: -0.005,
          overpredictionShare: 0.42,
          samplePlayers: 4000,
          positionBands: {
            G: { mae: 0.1, bias: -0.006, count: 1800 },
            F: { mae: 0.09, bias: -0.004, count: 1400 },
            C: { mae: 0.08, bias: -0.002, count: 800 },
          },
          evidenceBands: [{ band: '1500-plus-min', mae: 0.09, bias: -0.005, count: 3500 }],
          falsePositives: { count: 40, threshold: 0.1, lowerBound: 0.05 },
          falseNegatives: { count: 60, threshold: 0.1, upperBound: 0.15 },
        },
        foldCount: 5,
      },
      gates: {
        meanBiasNonPositiveAccuracy: true,
        meanBiasNonPositiveTranslatedAttemptRate: true,
        floorBelowEstablished: true,
      },
      generatedBy: 'hoop-rush calibrate three-point --write (derive-v8, ratings-v3.6)',
    };
    expect(threePointReconstructionArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(
      threePointReconstructionArtifactSchema.safeParse({ ...artifact, artifactVersion: 'other-v1' })
        .success,
    ).toBe(false);
  });
});
