import {
  HAVOC_SCHEMA_VERSION,
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  havocClaimKeySchema,
  havocDraftCardSchema,
  havocDraftPickSchema,
  havocDraftStateSchema,
  havocEffectiveProfileSchema,
  havocGameInputSchema,
  havocGameResultSchema,
  havocGameSummarySchema,
  havocLockedInputsSchema,
  havocParticipantLineSchema,
  havocParticipantSchema,
  havocRunStateSchema,
  havocSourcePlayerSchema,
  havocTeamInputSchema,
  havocVersionSetSchema,
  playerIdSchema,
  seedFromString,
} from '@hoop-rush/data-contracts';
import type {
  HavocDraftCard,
  HavocDraftPick,
  HavocDraftState,
  HavocEffectiveProfile,
  HavocGameInput,
  HavocGameResult,
  HavocGameSummary,
  HavocLockedInputs,
  HavocParticipant,
  HavocParticipantLine,
  HavocRunState,
  HavocSourcePlayer,
  HavocStatLine,
  HavocTeamInput,
  HavocVersionSet,
  Position,
  SimulationAnchors,
} from '@hoop-rush/data-contracts';

export const HAVOC_FIXTURE_SEED = seedFromString('havoc-fixture-seed');

function hexDigest(fill: string): string {
  return fill.repeat(32).slice(0, 32);
}

function instanceId(index: number): string {
  return `hvi-${index.toString(16).padStart(32, '0')}`;
}

export function buildHavocVersionSet(overrides: Partial<HavocVersionSet> = {}): HavocVersionSet {
  return havocVersionSetSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: 'havoc-rules-v2',
    mutationCatalogVersion: 'havoc-mutations-v2',
    seedDerivationVersion: 'havoc-seeds-v1',
    engineVersion: 'm3-engine-v24',
    profileVersion: 'm2-1990s-fixture-v1',
    dataVersion: 'data-v1',
    catalogVersion: 'season-draft-catalog-v4',
    catalogHash: hexDigest('a') + hexDigest('b'),
    bracketHash: hexDigest('c') + hexDigest('d'),
    profileHash: hexDigest('e') + hexDigest('f'),
    ...overrides,
  });
}

const FIXTURE_ANCHORS: SimulationAnchors = {
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
};

export function buildHavocSourcePlayer(
  overrides: Partial<HavocSourcePlayer> = {},
): HavocSourcePlayer {
  return havocSourcePlayerSchema.parse({
    playerId: 'p-havoc-1',
    playerVersionId: `pv-${hexDigest('1')}`,
    displayName: 'Fixture Source',
    franchiseId: 'lakers',
    eraId: '1990s',
    seasonKey: '1996-97',
    positions: ['PG'],
    originalOverall: 80,
    overallSource: 'catalog',
    profile: {
      ratings: { ...SIMULATION_RATINGS },
      tendencies: { ...SIMULATION_TENDENCIES },
      anchors: { ...FIXTURE_ANCHORS },
    },
    physical: { heightInches: 76, weightLbs: 200 },
    ...overrides,
  });
}

export function buildHavocEffectiveProfile(
  source: HavocSourcePlayer,
  overrides: Partial<HavocEffectiveProfile> = {},
): HavocEffectiveProfile {
  const baselineHeight = source.physical.heightInches ?? 77;
  return havocEffectiveProfileSchema.parse({
    ratings: { ...source.profile.ratings },
    tendencies: { ...source.profile.tendencies },
    physical: {
      baselineHeightInches: baselineHeight,
      baselineHeightSource: source.physical.heightInches === null ? 'estimated' : 'source',
      heightInches: source.physical.heightInches ?? baselineHeight,
      weightLbs: source.physical.weightLbs,
      wingspanDeltaInches: 0,
      reachUnits: 0,
    },
    authoritativeChannels: [],
    ...overrides,
  });
}

export function buildHavocCard(overrides: Partial<HavocDraftCard> = {}): HavocDraftCard {
  const source = overrides.source ?? buildHavocSourcePlayer();
  const slot: Position = overrides.slot ?? 'PG';
  return havocDraftCardSchema.parse({
    cardId: `hvc-${hexDigest('2')}`,
    offerId: `hvo-${hexDigest('3')}`,
    cardIndex: 0,
    slot,
    tier: 1,
    source: { ...source, positions: [slot] },
    mutations: [{ mutationId: 'growth-spurt', sampledHeightDelta: 8 }],
    effective: buildHavocEffectiveProfile(source),
    nickname: 'Fixture Freak',
    ...overrides,
  });
}

export function buildHavocDraftPick(
  pickOrdinal: number,
  overrides: Partial<HavocDraftPick> = {},
): HavocDraftPick {
  const slot: Position = (['PG', 'SG', 'SF', 'PF', 'C'] as const)[pickOrdinal] ?? 'PG';
  const card =
    overrides.card ??
    buildHavocCard({
      slot,
      cardId: `hvc-${hexDigest(String(pickOrdinal + 4))}`,
      source: buildHavocSourcePlayer({
        playerId: playerIdSchema.parse(`p-havoc-${String(pickOrdinal + 1)}`),
        positions: [slot],
      }),
    });
  return havocDraftPickSchema.parse({
    pickOrdinal,
    slot,
    claimKey: havocClaimKeySchema.parse({
      playerId: card.source.playerId,
      seasonKey: card.source.seasonKey ?? '1996-97',
    }),
    card,
    ...overrides,
  });
}

export function buildHavocDraftState(overrides: Partial<HavocDraftState> = {}): HavocDraftState {
  const offerId = overrides.offerId ?? `hvo-${hexDigest('3')}`;
  const cards = overrides.cards ?? [
    buildHavocCard({ offerId, cardId: `hvc-${hexDigest('2')}` }),
    buildHavocCard({
      offerId,
      cardId: `hvc-${hexDigest('4')}`,
      source: buildHavocSourcePlayer({ playerId: playerIdSchema.parse('p-havoc-2') }),
    }),
    buildHavocCard({
      offerId,
      cardId: `hvc-${hexDigest('5')}`,
      source: buildHavocSourcePlayer({ playerId: playerIdSchema.parse('p-havoc-3') }),
    }),
  ];
  return havocDraftStateSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    runId: 'havoc-run-1',
    revision: 0,
    runSeed: HAVOC_FIXTURE_SEED,
    versionSet: buildHavocVersionSet(),
    catalog: {
      catalogVersion: 'season-draft-catalog-v4',
      catalogHash: hexDigest('a') + hexDigest('b'),
      dataVersion: 'data-v1',
      ratingsVersion: 'ratings-v5.3',
      playerVersionIdVersion: 'player-version-id-v1',
      positionNormalizationVersion: 'position-v4',
    },
    round: 1,
    slot: 'PG',
    offerId,
    offerIndex: 0,
    cards,
    rerollUsed: false,
    picks: [],
    status: 'drafting',
    ...overrides,
  });
}

export function buildHavocParticipant(overrides: Partial<HavocParticipant> = {}): HavocParticipant {
  const source = overrides.source ?? buildHavocSourcePlayer();
  return havocParticipantSchema.parse({
    instanceId: overrides.instanceId ?? instanceId(1),
    kind: overrides.kind ?? 'starter',
    slot: overrides.slot ?? 'PG',
    ownerInstanceId: overrides.ownerInstanceId ?? null,
    mutationPackage: overrides.mutationPackage ?? [],
    source,
    effective: overrides.effective ?? buildHavocEffectiveProfile(source),
  });
}

export function buildHavocTeamInput(
  side: 'human' | 'opponent',
  overrides: Partial<HavocTeamInput> = {},
): HavocTeamInput {
  const slots: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
  const baseIndex = side === 'human' ? 1 : 21;
  const starters =
    overrides.starters ??
    slots.map((slot, index) =>
      buildHavocParticipant({
        instanceId: instanceId(baseIndex + index),
        kind: 'starter',
        slot,
        source: buildHavocSourcePlayer({
          playerId: playerIdSchema.parse(`p-${side}-${String(index + 1)}`),
          positions: [slot],
        }),
      }),
    );
  const replacements =
    overrides.replacements ??
    slots.map((slot, index) => {
      const starter = starters[index];
      const source =
        starter?.source ??
        buildHavocSourcePlayer({
          playerId: playerIdSchema.parse(`p-${side}-rep-${String(index + 1)}`),
        });
      return buildHavocParticipant({
        instanceId: instanceId(baseIndex + 10 + index),
        kind: 'replacement',
        slot,
        ownerInstanceId: starter?.instanceId ?? null,
        source,
      });
    });
  return havocTeamInputSchema.parse({
    side,
    teamId: `${side}-team`,
    displayName: `${side} team`,
    starters,
    replacements,
    clones: [],
    ...overrides,
  });
}

export function buildHavocLockedInputs(
  overrides: Partial<HavocLockedInputs> = {},
): HavocLockedInputs {
  const human = overrides.human ?? buildHavocTeamInput('human');
  const picks = overrides.picks ?? [0, 1, 2, 3, 4].map((ordinal) => buildHavocDraftPick(ordinal));
  return havocLockedInputsSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    runId: 'havoc-run-1',
    runSeed: HAVOC_FIXTURE_SEED,
    versionSet: buildHavocVersionSet(),
    profile: buildHavocProfileFixture(),
    human,
    schedule: Array.from({ length: 82 }, (_value, index) => ({
      gameNumber: index + 1,
      opponentId: 'opponent-a',
      humanHome: index % 2 === 0,
    })),
    opponents: [{ opponentId: 'opponent-a', team: buildHavocTeamInput('opponent') }],
    picks,
    ...overrides,
  });
}

function buildHavocProfileFixture() {
  return buildHavocEraProfile();
}

export function buildHavocEraProfile() {
  const target = (value: number, tolerance: number) => ({ value, tolerance, minimumSample: 0 });
  return {
    schemaVersion: 1 as const,
    eraId: '2010s',
    profileVersion: 'm2-2010s-fixture-v1',
    dataVersion: 'data-v1',
    seasons: ['2010-11'],
    baselineReport: 'fixture',
    parameters: {
      pace: 96,
      league3PARate: 0.22,
      leagueTsPct: 0.53,
      leagueFtaPerFga: 0.26,
      leagueFtPct: 0.76,
      turnoverPerPossession: 0.14,
      stealShareOfTurnovers: 0.3,
      offensiveReboundRate: 0.28,
      assistRate: 0.62,
      foulsPerPossession: 0.2,
      shootingFoulShare: 0.42,
      freeThrowAnchorRating: 76,
      assistAnchorRating: 72,
      zoneMix: {
        rim: 0.29,
        shortMid: 0.24,
        longMid: 0.17,
        cornerThree: 0.07,
        aboveBreakThree: 0.23,
      },
      source: 'fixture',
    },
    targets: {
      possessionsPerGame: target(95, 4),
      pointsPerGame: target(101, 6),
      offensiveRating: target(106, 6),
      fieldGoalPct: target(0.47, 0.02),
      efgPct: target(0.5, 0.02),
      tsPct: target(0.53, 0.02),
      threePointRate: target(0.22, 0.02),
      threePointPct: target(0.35, 0.02),
      freeThrowsAttemptedPerGame: target(24, 3),
      freeThrowPct: target(0.76, 0.02),
      turnoversPerGame: target(14, 1.5),
      turnoversPerPossession: target(0.14, 0.01),
      offensiveReboundsPerGame: target(11, 1.5),
      offensiveReboundRate: target(0.28, 0.02),
      assistsPerGame: target(24, 2.5),
      assistRate: target(0.62, 0.03),
      personalFoulsPerGame: target(21, 2.5),
      zoneMix: {
        rim: target(0.29, 0.02),
        shortMid: target(0.24, 0.02),
        longMid: target(0.17, 0.02),
        cornerThree: target(0.07, 0.015),
        aboveBreakThree: target(0.23, 0.02),
      },
      closeGameRate: target(0.18, 0.04),
      blowoutRate: target(0.12, 0.04),
      overtimeRate: target(0.06, 0.02),
      strongVsWeakWinRate: target(0.85, 0.08),
      equalLineupHomeWinRate: target(0.5, 0.05),
      playerRoles: [],
    },
  };
}

export function buildHavocRunState(overrides: Partial<HavocRunState> = {}): HavocRunState {
  return havocRunStateSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    runId: 'havoc-run-1',
    revision: 0,
    runSeed: HAVOC_FIXTURE_SEED,
    versionSet: buildHavocVersionSet(),
    phase: 'draft',
    draft: buildHavocDraftState(),
    locked: null,
    havocCursor: 0,
    normalCursor: 0,
    havocAggregate: {
      games: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      adjustments: 0,
    },
    normalAggregate: {
      games: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      adjustments: 0,
    },
    perfectSeason: false,
    comparisonStatus: 'not-started',
    completionState: 'draft',
    ...overrides,
  });
}

export function buildHavocRunStateLocked(overrides: Partial<HavocRunState> = {}): HavocRunState {
  return buildHavocRunState({
    phase: 'run',
    draft: null,
    locked: buildHavocLockedInputs(),
    completionState: 'season',
    ...overrides,
  });
}

export function buildHavocGameInput(overrides: Partial<HavocGameInput> = {}): HavocGameInput {
  return havocGameInputSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: 'havoc-rules-v2',
    mutationCatalogVersion: 'havoc-mutations-v2',
    gameNumber: 1,
    variant: 'havoc',
    seed: seedFromString('havoc-game-1'),
    profile: buildHavocEraProfile(),
    humanSide: 'home',
    home: buildHavocTeamInput('human'),
    away: buildHavocTeamInput('opponent'),
    versionSet: buildHavocVersionSet(),
    ...overrides,
  });
}

const ZERO_STAT_LINE: HavocStatLine = {
  secondsPlayed: 2400,
  minutes: 40,
  points: 18,
  fieldGoals: { made: 7, attempted: 15 },
  threes: { made: 2, attempted: 5 },
  freeThrows: { made: 2, attempted: 2 },
  rebounds: { total: 5, offensive: 1, defensive: 4 },
  assists: 4,
  steals: 1,
  blocks: 0,
  turnovers: 2,
  fouls: 2,
  chargedFouls: 2,
  adjustments: 0,
};

export function buildHavocStatLine(overrides: Partial<HavocStatLine> = {}): HavocStatLine {
  return { ...ZERO_STAT_LINE, ...overrides };
}

export function buildHavocParticipantLine(
  overrides: Partial<HavocParticipantLine> = {},
): HavocParticipantLine {
  return havocParticipantLineSchema.parse({
    instanceId: instanceId(1),
    kind: 'starter',
    slot: 'PG',
    ownerInstanceId: null,
    sourcePlayerId: 'p-havoc-1',
    sourcePlayerVersionId: `pv-${hexDigest('1')}`,
    displayName: 'Fixture Source',
    ...buildHavocStatLine(),
    ...overrides,
  });
}

export function buildHavocGameResult(overrides: Partial<HavocGameResult> = {}): HavocGameResult {
  const homeTeam = buildHavocTeamInput('human');
  const awayTeam = buildHavocTeamInput('opponent');
  const homeLines = homeTeam.starters.map((participant) =>
    buildHavocParticipantLine({
      instanceId: participant.instanceId,
      sourcePlayerId: participant.source.playerId,
      sourcePlayerVersionId: participant.source.playerVersionId,
      displayName: participant.source.displayName,
      slot: participant.slot,
    }),
  );
  const awayLines = awayTeam.starters.map((participant) =>
    buildHavocParticipantLine({
      instanceId: participant.instanceId,
      sourcePlayerId: participant.source.playerId,
      sourcePlayerVersionId: participant.source.playerVersionId,
      displayName: participant.source.displayName,
      slot: participant.slot,
    }),
  );
  const periods = [25, 24, 26, 25];
  const awayPeriods = [22, 23, 22, 23];
  return havocGameResultSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    gameNumber: 1,
    variant: 'havoc',
    seed: seedFromString('havoc-game-1'),
    engineVersion: 'm3-engine-v24',
    rulesVersion: 'havoc-rules-v2',
    mutationCatalogVersion: 'havoc-mutations-v2',
    profileVersion: 'm2-2010s-fixture-v1',
    dataVersion: 'data-v1',
    humanSide: 'home',
    home: {
      side: 'home',
      teamId: 'human-team',
      displayName: 'human team',
      points: 100,
      fieldGoals: { made: 38, attempted: 82 },
      threes: { made: 10, attempted: 28 },
      freeThrows: { made: 14, attempted: 18 },
      rebounds: { total: 42, offensive: 9, defensive: 33, team: 3 },
      assists: 24,
      steals: 8,
      blocks: 4,
      turnovers: 12,
      fouls: 18,
      adjustments: 0,
      periods,
      courtSeconds: 5 * 48 * 60,
      participants: homeLines,
    },
    away: {
      side: 'away',
      teamId: 'opponent-team',
      displayName: 'opponent team',
      points: 90,
      fieldGoals: { made: 34, attempted: 80 },
      threes: { made: 8, attempted: 24 },
      freeThrows: { made: 14, attempted: 18 },
      rebounds: { total: 40, offensive: 10, defensive: 30, team: 2 },
      assists: 20,
      steals: 6,
      blocks: 3,
      turnovers: 14,
      fouls: 20,
      adjustments: 0,
      periods: awayPeriods,
      courtSeconds: 5 * 48 * 60,
      participants: awayLines,
    },
    winner: 'home',
    overtimePeriods: 0,
    inputDigest: hexDigest('7'),
    rollups: [],
    highlights: [],
    ...overrides,
  });
}

export function buildHavocGameSummary(overrides: Partial<HavocGameSummary> = {}): HavocGameSummary {
  return havocGameSummarySchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    gameNumber: 1,
    variant: 'havoc',
    seed: seedFromString('havoc-game-1'),
    humanSide: 'home',
    humanScore: 100,
    opponentScore: 90,
    outcome: 'win',
    periods: { human: [25, 24, 26, 25], opponent: [22, 23, 22, 23] },
    overtimePeriods: 0,
    adjustments: 0,
    resultDigest: hexDigest('8'),
    inputDigest: hexDigest('7'),
    ...overrides,
  });
}
