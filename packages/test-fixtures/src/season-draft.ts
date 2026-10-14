import {
  SEASON_DRAFT_CATALOG_VERSION,
  SEASON_DURABILITY_VERSION,
  PLAYER_VERSION_ID_VERSION,
  POSITION_NORMALIZATION_VERSION,
  RATINGS_VERSION,
  SEASON_STAMINA_VERSION,
  eraIdSchema,
  franchiseIdSchema,
  playerIdSchema,
  playerVersionId,
  seasonDraftCatalogSchema,
  seasonKeySchema,
  type SeasonDraftCatalog,
  type SeasonDraftCatalogPool,
  type SeasonDraftCandidate,
} from '@hoop-rush/data-contracts';
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
    playerId: playerIdSchema.parse(playerId),
    franchiseId: franchiseIdSchema.parse(franchiseId),
    eraId: eraIdSchema.parse(eraId),
    seasonKey: seasonKeySchema.parse(seasonKey),
    displayName: `Fixture ${franchiseId} ${String(index)}`,
    playerExternalId: '101',
    positions: {
      primary: archetype.primary,
      secondary: [],
      playable: [...archetype.playable].sort(),
      normalizationVersion: POSITION_NORMALIZATION_VERSION,
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
    stamina: {
      rating: 45 + ((index * 7) % 51),
      historicalMpg: 20 + ((index * 5) % 41),
      derivationVersion: SEASON_STAMINA_VERSION,
    },
    durability: {
      rating: 45 + ((index * 7) % 51),
      derivationVersion: SEASON_DURABILITY_VERSION,
    },
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
      pools.push({
        franchiseId: franchiseIdSchema.parse(franchiseId),
        eraId: eraIdSchema.parse(eraId),
        playerVersionIds: members,
      });
    }
  }
  return seasonDraftCatalogSchema.parse({
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
    dataVersion: `m10-${RATINGS_VERSION}`,
    ratingsVersion: RATINGS_VERSION,
    positionNormalizationVersion: POSITION_NORMALIZATION_VERSION,
    playerVersionIdVersion: PLAYER_VERSION_ID_VERSION,
    staminaVersion: SEASON_STAMINA_VERSION,
    durabilityVersion: SEASON_DURABILITY_VERSION,
    pools,
    candidates,
  });
}
