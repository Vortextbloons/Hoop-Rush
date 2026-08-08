import {
  SEASON_AI_VERSION,
  SEASON_DRAFT_CATALOG_VERSION,
  SEASON_DRAFT_VERSION,
  SEASON_DURABILITY_VERSION,
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_STAMINA_VERSION,
  playerVersionId,
  seasonDigestHex,
  type SeasonAiAssignment,
  type SeasonAiPool,
  type SeasonDraftCatalog,
  type SeasonDraftCatalogPool,
  type SeasonDraftCandidate,
  type SeasonDraftState,
  type SeasonLeague,
  type SeasonRoster,
  type SeasonRosterTargets,
  type SeasonRotation,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import { buildSeasonLeague } from './season.ts';

/**
 * Deterministic Season Run M2.1 fixture builders (spec/2.0 M2.1): a compact
 * draft catalog with position variety (so legality and feasibility are
 * exercisable), rotation builders, AI assignments, and synthetic
 * generation results. Engine tests, persistence tests, and CLI tests share
 * these so the contracts stay in sync.
 */

/** Position archetypes cycled across candidates so every pool covers G/F/C. */
const POSITION_ARCHETYPES: Array<{
  playable: Array<'PG' | 'SG' | 'SF' | 'PF' | 'C'>;
  primary: 'PG' | 'SG' | 'SF' | 'PF' | 'C';
}> = [
  { playable: ['PG'], primary: 'PG' },
  { playable: ['SG'], primary: 'SG' },
  { playable: ['PG', 'SG'], primary: 'PG' },
  { playable: ['SF'], primary: 'SF' },
  { playable: ['PF'], primary: 'PF' },
  { playable: ['SF', 'PF'], primary: 'SF' },
  { playable: ['SG', 'SF'], primary: 'SG' },
  { playable: ['C'], primary: 'C' },
  { playable: ['PF', 'C'], primary: 'PF' },
  { playable: ['SG', 'SF', 'PF'], primary: 'SG' },
];

function candidateRating(
  key:
    | 'insideScoring'
    | 'threePoint'
    | 'perimeterDefense'
    | 'interiorDefense'
    | 'offensiveRebound'
    | 'defensiveRebound'
    | 'ballHandling'
    | 'passing',
  archetypeIndex: number,
  n: number,
): number {
  const base = 40 + ((n * 7 + archetypeIndex * 3) % 45);
  const boosts: Record<string, number[]> = {
    insideScoring: [4, 2, 2, 6, 10, 10, 2, 14, 12, 8],
    threePoint: [8, 14, 10, 8, 2, 2, 12, 0, 2, 6],
    perimeterDefense: [6, 8, 8, 8, 4, 4, 6, 0, 2, 6],
    interiorDefense: [0, 0, 0, 4, 8, 8, 2, 14, 14, 6],
    offensiveRebound: [0, 0, 0, 4, 10, 10, 2, 12, 14, 4],
    defensiveRebound: [0, 0, 2, 6, 10, 10, 4, 14, 14, 6],
    ballHandling: [14, 4, 10, 2, 2, 0, 6, 0, 0, 4],
    passing: [12, 4, 8, 2, 2, 2, 6, 0, 2, 4],
  };
  const boost = boosts[key]?.[archetypeIndex] ?? 0;
  return Math.min(96, Math.max(25, base + boost));
}

/**
 * One deterministic draft candidate. The archetype index shapes the ratings so
 * scoring functions and feasibility searches see real variation.
 */
export function buildSeasonDraftCandidate(input: {
  franchiseId: string;
  eraId: string;
  index: number;
  poolIndex?: number;
}): SeasonDraftCandidate {
  const { franchiseId, eraId, index } = input;
  const archetype = POSITION_ARCHETYPES[index % POSITION_ARCHETYPES.length];
  if (!archetype) throw new Error('missing position archetype');
  const playerId = `p-d-${franchiseId}-${eraId}-${String(index)}`;
  const versionId = playerVersionId(playerId, franchiseId, eraId, '1995-96');
  const seasonKey = '1995-96';
  return {
    playerVersionId: versionId,
    playerId,
    franchiseId,
    eraId,
    seasonKey,
    displayName: `Fixture ${franchiseId} ${String(index)}`,
    playerExternalId: '101',
    positions: {
      primary: archetype.primary,
      secondary: [],
      playable: [...archetype.playable].sort(),
      normalizationVersion: 'position-v3',
    },
    heightInches: 78,
    weightLbs: 215,
    summaryRatings: {
      overallRating: 40 + ((index * 5) % 55),
      offenseRating: 40 + ((index * 6) % 55),
      defenseRating: 40 + ((index * 4) % 55),
    },
    detailedRatings: {
      insideScoring: candidateRating('insideScoring', index % POSITION_ARCHETYPES.length, index),
      closeShot: candidateRating('insideScoring', index % POSITION_ARCHETYPES.length, index) - 4,
      midrange: 45 + ((index * 3) % 40),
      threePoint: candidateRating('threePoint', index % POSITION_ARCHETYPES.length, index),
      freeThrow: 60 + ((index * 2) % 35),
      ballHandling: candidateRating('ballHandling', index % POSITION_ARCHETYPES.length, index),
      passing: candidateRating('passing', index % POSITION_ARCHETYPES.length, index),
      offensiveIq: 45 + ((index * 4) % 45),
      offensiveRebound: candidateRating(
        'offensiveRebound',
        index % POSITION_ARCHETYPES.length,
        index,
      ),
      defensiveRebound: candidateRating(
        'defensiveRebound',
        index % POSITION_ARCHETYPES.length,
        index,
      ),
      perimeterDefense: candidateRating(
        'perimeterDefense',
        index % POSITION_ARCHETYPES.length,
        index,
      ),
      interiorDefense: candidateRating(
        'interiorDefense',
        index % POSITION_ARCHETYPES.length,
        index,
      ),
      steal: 40 + ((index * 3) % 45),
      block: 40 + ((index * 3) % 45),
      defensiveIq: 40 + ((index * 3) % 45),
      speed: 50 + ((index * 3) % 45),
      strength: 45 + ((index * 3) % 45),
      vertical: 50 + ((index * 2) % 40),
    },
    tendencies: {
      usageRate: 15 + ((index * 2) % 25),
      passRate: 20 + ((index * 2) % 25),
      shotRate: 20 + ((index * 2) % 25),
      driveRate: 15 + ((index * 2) % 20),
      postUpRate: 5 + ((index * 2) % 25),
      rimFrequency: 20 + ((index * 2) % 30),
      shortMidFrequency: 15 + ((index * 2) % 20),
      longMidFrequency: 10 + ((index * 2) % 15),
      cornerThreeFrequency: 5 + ((index * 2) % 15),
      aboveBreakThreeFrequency: 8 + ((index * 2) % 18),
      threePointRate: 12 + ((index * 2) % 25),
      freeThrowRate: 18 + ((index * 2) % 15),
      turnoverRate: 10 + ((index * 2) % 10),
      isolationRate: 8 + ((index * 2) % 15),
      pickAndRollBallHandlerRate: 15 + ((index * 2) % 25),
      pickAndRollRollManRate: 5 + ((index * 2) % 20),
      spotUpRate: 12 + ((index * 2) % 22),
      transitionRate: 12 + ((index * 2) % 15),
      cutRate: 8 + ((index * 2) % 14),
      foulRate: 2 + (index % 4),
      stealAttemptRate: 6 + ((index * 2) % 12),
      blockAttemptRate: 6 + ((index * 2) % 14),
      crashOffensiveGlassRate: 8 + ((index * 2) % 18),
    },
    // M2.4: build-time stamina profile (season-stamina-v1); 45..95 rating.
    stamina: {
      rating: 45 + ((index * 7) % 51),
      historicalMpg: 20 + ((index * 5) % 41),
      derivationVersion: SEASON_STAMINA_VERSION,
    },
    // M2.5: build-time durability profile (durability-v1); fixed synthetic
    // ratings in the 45..95 contract range (the persistence/trade engines
    // consume the rating, never the derivation facts).
    durability: {
      rating: 45 + ((index * 7) % 51),
      derivationVersion: SEASON_DURABILITY_VERSION,
    },
    // Projection milestone (season-draft-catalog-v4): validated observed
    // anchors. Fixed synthetic values in the contract ranges so projection
    // fixtures exercise the observed-anchor paths.
    anchors: {
      gamesPlayed: 60 + ((index * 3) % 21),
      minutesPerGame: 24 + ((index * 2) % 20),
      pointsPerGame: 8 + ((index * 4) % 14),
      reboundsPerGame: 3 + ((index * 2) % 8),
      offensiveReboundsPerGame: 0.8 + (index % 4) / 10,
      defensiveReboundsPerGame: 2 + ((index * 2) % 7),
      assistsPerGame: 1.5 + (index % 5) / 2,
      stealsPerGame: 0.5 + (index % 3) / 4,
      blocksPerGame: 0.2 + (index % 3) / 5,
      turnoversPerGame: 1 + (index % 4) / 2,
      fieldGoalPct: 0.4 + ((index * 3) % 120) / 1000,
      threePointPct: index % 2 === 0 ? 0.3 + ((index * 4) % 250) / 1000 : null,
      freeThrowPct: 0.7 + ((index * 5) % 200) / 1000,
      threePointAttemptRate: index % 2 === 0 ? 0.05 + ((index * 2) % 200) / 1000 : null,
      freeThrowAttemptRate: 0.15 + ((index * 3) % 100) / 1000,
    },
  };
}

/**
 * Compact deterministic draft catalog. `playersPerPool` candidates per pool
 * cycle through the position archetypes, so every pool contains G/F/C variety
 * and completion targets stay feasible.
 */
export function buildSeasonDraftCatalog(
  input: {
    franchiseIds?: string[];
    eras?: string[];
    playersPerPool?: number;
  } = {},
): SeasonDraftCatalog {
  const franchiseIds = input.franchiseIds ?? ['lakers', 'celtics', 'bulls', 'warriors'];
  const eras = input.eras ?? ['1980s', '1990s', '2000s', '2010s'];
  const playersPerPool = input.playersPerPool ?? 12;
  const candidates: SeasonDraftCandidate[] = [];
  const pools: SeasonDraftCatalogPool[] = [];
  for (const franchiseId of franchiseIds) {
    for (const eraId of eras) {
      const members: string[] = [];
      for (let index = 0; index < playersPerPool; index += 1) {
        const candidate = buildSeasonDraftCandidate({ franchiseId, eraId, index });
        candidates.push(candidate);
        members.push(candidate.playerVersionId);
      }
      pools.push({ franchiseId, eraId, playerVersionIds: members });
    }
  }
  return {
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
    dataVersion: 'm10-ratings-v3.4',
    ratingsVersion: 'ratings-v3.4',
    positionNormalizationVersion: 'position-v3',
    playerVersionIdVersion: 'player-version-id-v1',
    staminaVersion: SEASON_STAMINA_VERSION,
    durabilityVersion: SEASON_DURABILITY_VERSION,
    pools,
    candidates,
  };
}

export function buildSeasonRotation(
  franchiseId: string,
  playerVersionIds: string[],
): SeasonRotation {
  if (playerVersionIds.length !== 10) throw new Error('rotation needs ten players');
  const starters = playerVersionIds.slice(0, 5);
  const bench = playerVersionIds.slice(5);
  return {
    franchiseId,
    starters,
    benchOrder: bench,
    targetMinutes: [
      ...starters.map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
      ...bench.map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
    ],
    closingFive: starters,
    minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy: 'balanced' },
    rotationVersion: SEASON_ROTATION_VERSION,
  };
}

const BAND_CYCLE: Array<SeasonAiAssignment['band']> = [
  'contender',
  'contender',
  'contender',
  'contender',
  'playoff',
  'playoff',
  'playoff',
  'playoff',
  'playoff',
  'playoff',
  'playoff',
  'playoff',
  'average',
  'average',
  'average',
  'average',
  'average',
  'average',
  'average',
  'average',
  'average',
  'average',
  'weaker',
  'weaker',
  'weaker',
  'weaker',
  'weaker',
  'weaker',
  'weaker',
];

const IDENTITY_CYCLE: Array<SeasonAiAssignment['identity']> = [
  'star-chaser',
  'depth-builder',
  'defense-first',
  'shooting-first',
  'continuity',
  'active-trader',
  'star-chaser',
  'depth-builder',
  'defense-first',
  'shooting-first',
  'continuity',
  'active-trader',
  'star-chaser',
  'depth-builder',
  'defense-first',
  'shooting-first',
  'continuity',
  'active-trader',
  'star-chaser',
  'depth-builder',
  'defense-first',
  'shooting-first',
  'continuity',
  'active-trader',
  'star-chaser',
  'depth-builder',
  'defense-first',
  'shooting-first',
  'continuity',
];

export function buildSeasonAiAssignments(league: SeasonLeague): SeasonAiAssignment[] {
  return league.teams.map((team, index) => ({
    franchiseId: team.franchiseId,
    band: BAND_CYCLE[index] ?? 'average',
    identity: IDENTITY_CYCLE[index] ?? 'star-chaser',
  }));
}

export function fixtureGenerationDigest(material: string): string {
  return seasonDigestHex(material).slice(0, 32);
}

/** Synthetic M2.3.5 global-eight draft facts for fixture runs. */
export function buildFixtureSeasonDraftFacts(): SeasonRun['draft'] {
  return {
    draftVersion: SEASON_DRAFT_VERSION,
    participants: [
      {
        participantId: 'fixture-human',
        franchiseId: 'lakers',
        offers: [
          {
            round: 1,
            pickOrdinal: 1,
            seedPath: ['draft', 'offer', 'fixture-human', '1', '1', 'safe-order', 'sample-order'],
            cards: [
              {
                playerVersionId: `pv-${'1'.repeat(32)}`,
                selectable: true,
                coverageReason: null,
              },
              {
                playerVersionId: `pv-${'2'.repeat(32)}`,
                selectable: true,
                coverageReason: null,
              },
              {
                playerVersionId: `pv-${'3'.repeat(32)}`,
                selectable: true,
                coverageReason: null,
              },
              {
                playerVersionId: `pv-${'4'.repeat(32)}`,
                selectable: true,
                coverageReason: null,
              },
              {
                playerVersionId: `pv-${'5'.repeat(32)}`,
                selectable: false,
                coverageReason:
                  'Selecting this version would leave the 4G/4F/3C completion targets unreachable with the remaining picks',
              },
              {
                playerVersionId: `pv-${'6'.repeat(32)}`,
                selectable: true,
                coverageReason: null,
              },
              {
                playerVersionId: `pv-${'7'.repeat(32)}`,
                selectable: true,
                coverageReason: null,
              },
              {
                playerVersionId: `pv-${'8'.repeat(32)}`,
                selectable: true,
                coverageReason: null,
              },
            ],
          },
        ],
        picks: [
          {
            round: 1,
            playerVersionId: `pv-${'1'.repeat(32)}`,
            franchiseId: 'lakers',
            eraId: '1990s',
            seedPath: ['draft', 'offer', 'fixture-human', '1', '1', 'safe-order', 'sample-order'],
          },
        ],
      },
    ],
  };
}

/**
 * Synthetic roster-generation-v2 pools for fixture runs: one 20-player pool
 * per AI franchise (29 pools for a 30-team league; the human franchise gets
 * none), each with ten selections and one allocation seed path per
 * selection. Pool versions are synthetic (never on a roster); the block
 * pipeline consumes final rosters only, so the pools are recorded facts.
 */
export function buildSeasonAiPools(
  assignments: SeasonAiAssignment[],
  humanFranchiseId: string,
): SeasonAiPool[] {
  return assignments
    .filter((assignment) => assignment.franchiseId !== humanFranchiseId)
    .map((assignment, poolIndex) => {
      const playerVersionIds = Array.from({ length: 20 }, (_, slot) => {
        const hex = `${String(poolIndex).padStart(2, '0')}${String(slot).padStart(2, '0')}`.padEnd(
          32,
          '0',
        );
        return `pv-${hex}`;
      });
      const selections = playerVersionIds.slice(0, 10);
      return {
        franchiseId: assignment.franchiseId,
        band: assignment.band,
        identity: assignment.identity,
        playerVersionIds,
        anchors: [],
        selections,
        allocationSeedPaths: selections.map((_version, slot) => [
          'ai',
          'selection',
          assignment.franchiseId,
          String(slot),
        ]),
        repairCount: 0,
      };
    });
}

const ALL_ROSTER_ROLES = [
  'primary-creation',
  'secondary-creation',
  'perimeter-shooting',
  'rim-finishing-interior-scoring',
  'perimeter-defense',
  'interior-defense',
  'offensive-rebounding',
  'defensive-rebounding',
] as const;

/**
 * The frozen `roster-targets-v2` artifact values for fixture runs (M2.4).
 * Matches the committed seasonRosterTargetsSchema policy exactly; the
 * `measured` facts are synthetic calibration-style values (fixtures never
 * run real calibration).
 */
export function buildFixtureRosterTargets(): SeasonRosterTargets {
  return {
    schemaVersion: 2,
    targetsVersion: SEASON_ROSTER_TARGETS_VERSION,
    policy: {
      bandQuotas: {
        solo: { contender: 4, playoff: 8, average: 10, weaker: 7 },
        duo: { contender: 4, playoff: 8, average: 9, weaker: 7 },
      },
      guaranteedAnchors: { contender: 2, playoff: 1, average: 0, weaker: 0 },
      extraEliteRollProbability: { contender: 0.65, playoff: 0.35, average: 0.2, weaker: 0.08 },
      tierRanges: {
        contender: { elite: [2, 4], strong: [5, 8], useful: [6, 10] },
        playoff: { elite: [1, 2], strong: [4, 7], useful: [7, 10] },
        average: { elite: [0, 1], strong: [3, 6], useful: [8, 11] },
        weaker: { elite: [0, 1], strong: [1, 4], useful: [7, 10] },
      },
      identityPriorityRoles: {
        'star-chaser': ['primary-creation', 'secondary-creation', 'rim-finishing-interior-scoring'],
        'shooting-first': ['perimeter-shooting'],
        'defense-first': ['perimeter-defense', 'interior-defense'],
        'depth-builder': [...ALL_ROSTER_ROLES],
        continuity: [...ALL_ROSTER_ROLES],
        'active-trader': [...ALL_ROSTER_ROLES],
      },
      roleCoverageThreshold: 35,
      completionTargets: { guards: 4, forwards: 4, centers: 3 },
      poolSize: 20,
      rosterSize: 10,
      percentileTiers: { elite: 0.9, strong: 0.75, useful: 0.5 },
      bandPoolScoreCaps: { contender: 100, playoff: 92, average: 84, weaker: 74 },
      maxPoolStrengthOutliers: 4,
      maxRosterStrengthOutliers: 2,
      nodeBudgets: { anchorMatching: 20000, poolRepair: 40000, rosterSelection: 600000 },
    },
    calibration: {
      calibrationSeedCount: 256,
      validationSeedCount: 64,
      generatedAtIso: '2026-08-04T00:00:00.000Z',
      aiVersion: SEASON_AI_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      gates: {
        failureRateMax: 0,
        minBandSeparation: 3,
        anchorFulfillmentMin: 1,
        extraEliteRateTolerance: 0.05,
        heldOutPassShare: 0.95,
        orderInvarianceFailuresMax: 0,
        superTeamIncidenceMax: 0.08,
      },
    },
    measured: {
      bands: {
        contender: {
          range: [52, 92],
          median: 74,
          eliteShare: 0.7,
          strongShare: 0.3,
          usefulShare: 0,
        },
        playoff: {
          range: [46, 82],
          median: 65,
          eliteShare: 0.4,
          strongShare: 0.6,
          usefulShare: 0.1,
        },
        average: {
          range: [40, 72],
          median: 57,
          eliteShare: 0.1,
          strongShare: 0.5,
          usefulShare: 0.6,
        },
        weaker: {
          range: [32, 64],
          median: 49,
          eliteShare: 0.05,
          strongShare: 0.3,
          usefulShare: 0.8,
        },
      },
      identities: {
        'star-chaser': { range: [40, 88], median: 64 },
        'depth-builder': { range: [40, 85], median: 62 },
        'defense-first': { range: [40, 85], median: 62 },
        'shooting-first': { range: [40, 85], median: 62 },
        continuity: { range: [40, 85], median: 62 },
        'active-trader': { range: [40, 85], median: 62 },
      },
      anchorFulfillment: 1,
      extraEliteRate: 0.4,
      superTeamIncidence: 0.02,
      poolLegalityFailures: 0,
      selectionFailures: 0,
      generationFailures: 0,
    },
  };
}

export function buildFixtureGenerationAudit(seed: string): SeasonRun['generationAudit'] {
  return {
    seed,
    aiVersion: SEASON_AI_VERSION,
    rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
    rotationVersion: SEASON_ROTATION_VERSION,
    minutePolicyVersion: SEASON_MINUTE_POLICY_VERSION,
    rosterTargetsVersion: SEASON_ROSTER_TARGETS_VERSION,
    digest: fixtureGenerationDigest(`fixture-${seed}`),
    diagnostics: {
      seed,
      aiVersion: SEASON_AI_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      teamsGenerated: 29,
      teamsRepaired: 0,
      backtracks: 0,
      nodesVisited: 29,
      nodeBudget: 100000,
      failedTeams: [],
      unmetConstraints: [],
    },
  };
}

export function buildFixtureEvaluations(
  rosters: SeasonRoster[],
  assignments: SeasonAiAssignment[],
): SeasonRun['evaluations'] {
  return rosters.map((roster) => {
    const assignment = assignments.find((a) => a.franchiseId === roster.franchiseId);
    return {
      franchiseId: roster.franchiseId,
      band: assignment?.band ?? 'average',
      identity: assignment?.identity ?? 'star-chaser',
      strengthScore: 55,
      roleScores: {
        'primary-creation': 55,
        'secondary-creation': 55,
        'perimeter-shooting': 55,
        'rim-finishing-interior-scoring': 55,
        'perimeter-defense': 55,
        'interior-defense': 55,
        'offensive-rebounding': 55,
        'defensive-rebounding': 55,
      },
      rolesCovered: [
        'primary-creation',
        'secondary-creation',
        'perimeter-shooting',
        'rim-finishing-interior-scoring',
        'perimeter-defense',
        'interior-defense',
        'offensive-rebounding',
        'defensive-rebounding',
      ],
      overallReport: 70,
    };
  });
}

/**
 * Valid draft-state fixture for persistence and CLI tests (season-draft-v2).
 * The state is schema-valid (mid-drafting with one drawn eight-card offer and
 * one pick); tests that need specific shapes pass shallow overrides.
 */
export function buildSeasonDraftState(
  overrides: Partial<SeasonDraftState> & { rootSeed?: string; revision?: number } = {},
): SeasonDraftState {
  const seedPath = ['draft', 'offer', 'human-1', '1', '1', 'safe-order', 'sample-order'];
  const cards = [
    { playerVersionId: `pv-${'1'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'2'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'3'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'4'.repeat(32)}`, selectable: true, coverageReason: null },
    {
      playerVersionId: `pv-${'5'.repeat(32)}`,
      selectable: false,
      coverageReason: 'fixture disabled card',
    },
    { playerVersionId: `pv-${'6'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'7'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'8'.repeat(32)}`, selectable: true, coverageReason: null },
  ];
  const rootSeed = overrides.rootSeed ?? 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
  const league = buildSeasonLeague();
  return {
    schemaVersion: 2,
    draftVersion: SEASON_DRAFT_VERSION,
    runId: 'fixture-draft-1',
    rootSeed,
    league,
    catalogVersion: SEASON_DRAFT_VERSION,
    participants: [
      { participantId: 'human-1', franchiseId: 'lakers' },
      { participantId: 'human-2', franchiseId: 'celtics' },
    ],
    firstPickParticipantId: 'human-1',
    round: 2,
    currentTurnParticipantId: 'human-2',
    status: 'drafting',
    revision: overrides.revision ?? 3,
    currentOffer: {
      participantId: 'human-2',
      round: 2,
      pickOrdinal: 2,
      seedPath: ['draft', 'offer', 'human-2', '2', '2', 'safe-order', 'sample-order'],
      cards,
    },
    offers: [
      {
        participantId: 'human-1',
        round: 1,
        pickOrdinal: 1,
        seedPath,
        cards,
      },
    ],
    picks: [
      {
        participantId: 'human-1',
        round: 1,
        pickOrdinal: 1,
        playerVersionId: `pv-${'1'.repeat(32)}`,
        franchiseId: 'lakers',
        eraId: '1990s',
        seedPath,
      },
    ],
    commandLog: [
      {
        status: 'accepted',
        commandId: 'c-create',
        revisionBefore: 0,
        revisionAfter: 1,
        stateDigest: '0'.repeat(32),
        command: {
          commandId: 'c-create',
          expectedRevision: 0,
          payload: {
            kind: 'create-season-draft',
            runId: 'fixture-draft-1',
            rootSeed,
            league,
            humanParticipantIds: ['human-1', 'human-2'],
            catalogVersion: SEASON_DRAFT_VERSION,
          },
        },
      },
      {
        status: 'accepted',
        commandId: 'c-draw-1',
        revisionBefore: 1,
        revisionAfter: 2,
        stateDigest: '0'.repeat(32),
        command: {
          commandId: 'c-draw-1',
          expectedRevision: 1,
          payload: { kind: 'draw-season-offer', participantId: 'human-1' },
        },
      },
      {
        status: 'accepted',
        commandId: 'c-pick-1',
        revisionBefore: 2,
        revisionAfter: 3,
        stateDigest: '0'.repeat(32),
        command: {
          commandId: 'c-pick-1',
          expectedRevision: 2,
          payload: {
            kind: 'select-draft-player',
            participantId: 'human-1',
            playerVersionId: `pv-${'1'.repeat(32)}`,
          },
        },
      },
    ],
    ...overrides,
  };
}
