import {
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  collectionCatalogSchema,
  collectionChallengeDefinitionSchema,
  collectionDifficultyProfileSchema,
  collectionGameRulesV2Schema,
  collectionProgressionRulesDigest,
  collectionProgressionRulesSchema,
  seasonDigestHex,
  COLLECTION_CATALOG_VERSION,
  COLLECTION_CHALLENGE_REWARD_VERSION,
  COLLECTION_CHALLENGE_VERSION,
  COLLECTION_DIFFICULTY_VERSION,
  COLLECTION_GAME_REPLAY_VERSION,
  COLLECTION_GAME_RULES_VERSION,
  COLLECTION_GAME_V2_REPLAY_VERSION,
  COLLECTION_GAME_V2_VERSION,
  COLLECTION_GAME_VERSION,
  COLLECTION_OBJECTIVE_VERSION,
  COLLECTION_OVERLAY_VERSION,
  COLLECTION_PACK_RULES_VERSION,
  COLLECTION_PROGRESSION_VERSION,
  COLLECTION_REPLAY_V1_VERSION,
  COLLECTION_REWARD_V2_VERSION,
  COLLECTION_REWARD_VERSION,
  COLLECTION_SCHEMA_VERSION,
  COLLECTION_SET_REWARD_VERSION,
  COLLECTION_TARGETING_VERSION,
  COLLECTION_VERSION,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionChallengeDefinition,
  type CollectionDifficultyId,
  type CollectionDifficultyProfile,
  type CollectionGameRules,
  type CollectionProgressionRules,
  type CollectionRarity,
  type CollectionSetRewardDefinition,
} from '@hoop-rush/data-contracts';

const FIXTURE_POSITIONS: Record<string, Array<'PG' | 'SG' | 'SF' | 'PF' | 'C'>> = {
  'fixture-pg': ['PG'],
  'fixture-sg': ['SG'],
  'fixture-sf': ['SF'],
  'fixture-pf': ['PF'],
  'fixture-c': ['C'],
};

function fixtureCardId(playerId: string, family: string): `card-${string}` {
  return `card-${seasonDigestHex(`collection-fixture\u0000${playerId}\u0000${family}`)}`;
}

function fixtureSourceVersion(playerId: string): `pv-${string}` {
  return `pv-${seasonDigestHex(`collection-fixture-source\u0000${playerId}`)}`;
}

export function buildCollectionFixtureCard(
  playerId: string,
  overrides: Partial<CollectionCatalogCard> = {},
): CollectionCatalogCard {
  const positions = FIXTURE_POSITIONS[playerId] ?? ['PG'];
  const overall = overrides.summarySource?.overallRating ?? 60;
  const rarity: CollectionRarity =
    overrides.rarity ?? (overall < 72 ? 'Ember' : overall < 85 ? 'Eruption' : 'Apex');
  const pid = overrides.playerId ?? playerId;
  const cid = overrides.cardId ?? fixtureCardId(playerId, 'Base');
  return collectionCatalogSchema.shape.cards.element.parse({
    sourcePlayerVersionId: fixtureSourceVersion(pid),
    family: 'Base',
    rarity,
    seasonKey: '1996-97',
    franchiseId: 'lakers',
    eraId: '1990s',
    displayName: `Fixture ${playerId}`,
    positions,
    overlayVersion: COLLECTION_OVERLAY_VERSION,
    sourceProvenance: 'fixture',
    detailedRatings: { ...SIMULATION_RATINGS },
    tendencies: { ...SIMULATION_TENDENCIES },
    heightInches: 79,
    weightLbs: 215,
    playerExternalId: '101',
    summarySource: { overallRating: 60, offenseRating: 60, defenseRating: 60 },
    ...overrides,
    cardId: cid,
    playerId: pid,
  });
}

export function buildCollectionFixtureCatalog(
  overrides: Partial<CollectionCatalog> = {},
): CollectionCatalog {
  const cards = [
    buildCollectionFixtureCard('fixture-pg', {
      displayName: 'Fixture Guard One',
      summarySource: { overallRating: 60, offenseRating: 60, defenseRating: 60 },
    }),
    buildCollectionFixtureCard('fixture-sg', {
      displayName: 'Fixture Guard Two',
      summarySource: { overallRating: 61, offenseRating: 61, defenseRating: 60 },
    }),
    buildCollectionFixtureCard('fixture-sf', {
      displayName: 'Fixture Forward One',
      summarySource: { overallRating: 62, offenseRating: 62, defenseRating: 61 },
    }),
    buildCollectionFixtureCard('fixture-pf', {
      displayName: 'Fixture Forward Two',
      summarySource: { overallRating: 63, offenseRating: 62, defenseRating: 62 },
    }),
    buildCollectionFixtureCard('fixture-c', {
      displayName: 'Fixture Center',
      summarySource: { overallRating: 64, offenseRating: 62, defenseRating: 64 },
    }),
    buildCollectionFixtureCard('fixture-extra', {
      positions: ['PG', 'SG'],
      displayName: 'Fixture Extra',
      summarySource: { overallRating: 65, offenseRating: 65, defenseRating: 60 },
    }),
  ];
  return collectionCatalogSchema.parse({
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    catalogVersion: COLLECTION_CATALOG_VERSION,
    collectionVersion: COLLECTION_VERSION,
    overlayVersion: COLLECTION_OVERLAY_VERSION,
    dataVersion: 'fixture-data-v1',
    ratingsVersion: 'ratings-v3.9',
    positionNormalizationVersion: 'position-v3',
    playerVersionIdVersion: 'player-version-id-v1',
    sourceCatalogVersion: 'season-draft-catalog-v4',
    sourceCatalogHash: '0'.repeat(64),
    cards,
    sets: [
      {
        setId: 'sharpshooter-set',
        title: 'Fixture Sharpshooters',
        memberCardIds: [cards[0]?.cardId, cards[1]?.cardId],
      },
    ],
    packs: [
      {
        packId: 'tip-off',
        packRulesVersion: COLLECTION_PACK_RULES_VERSION,
        priceCurrency: 'Coins',
        priceAmount: 100,
        slots: [{ kind: 'ordinary' }],
        eligibleScope: 'full-catalog',
        rarityWeights: {
          Ember: 70,
          Eruption: 23,
          Apex: 5,
          Titan: 1.7,
          Eclipse: 0.29,
          Immortal: 0.01,
        },
        duplicateExchange: {
          Ember: 5,
          Eruption: 15,
          Apex: 50,
          Titan: 150,
          Eclipse: 500,
          Immortal: 1500,
        },
      },
    ],
    replayVersion: COLLECTION_REPLAY_V1_VERSION,
    ...overrides,
  });
}

const DIFFICULTY_FIXTURES: Record<CollectionDifficultyId, unknown> = {
  street: {
    rarityBand: { floor: 'Ember', ceiling: 'Apex' },
    rarityWeightsBp: [
      { rarity: 'Ember', weightBp: 7600 },
      { rarity: 'Eruption', weightBp: 2200 },
      { rarity: 'Apex', weightBp: 200 },
    ],
    specialWeightMultiplierBp: 5000,
    candidateTeams: 1,
    identityFitWeightBp: 0,
    useGeneratedStarters: true,
    ratingShift: -2,
    rewardMultiplierBp: 10_000,
    displayName: 'Street',
    rotation: {
      starterWeightBp: 20_000,
      benchWeightBp: 10_000,
      overallBonusFloor: 0,
      overallBonusPerPointBp: 0,
      maxMinutes: 48,
      closingFivePolicy: 'generated-starters',
    },
  },
  pro: {
    rarityBand: { floor: 'Eruption', ceiling: 'Titan' },
    rarityWeightsBp: [
      { rarity: 'Eruption', weightBp: 5200 },
      { rarity: 'Apex', weightBp: 3500 },
      { rarity: 'Titan', weightBp: 1300 },
    ],
    specialWeightMultiplierBp: 12_500,
    candidateTeams: 4,
    identityFitWeightBp: 1500,
    useGeneratedStarters: false,
    ratingShift: 0,
    rewardMultiplierBp: 13_500,
    displayName: 'Pro',
    rotation: {
      starterWeightBp: 20_000,
      benchWeightBp: 8000,
      overallBonusFloor: 75,
      overallBonusPerPointBp: 400,
      maxMinutes: 42,
      closingFivePolicy: 'best-legal-five',
    },
  },
  legend: {
    rarityBand: { floor: 'Apex', ceiling: 'Immortal' },
    rarityWeightsBp: [
      { rarity: 'Apex', weightBp: 4200 },
      { rarity: 'Titan', weightBp: 4000 },
      { rarity: 'Eclipse', weightBp: 1600 },
      { rarity: 'Immortal', weightBp: 200 },
    ],
    specialWeightMultiplierBp: 20_000,
    candidateTeams: 8,
    identityFitWeightBp: 3000,
    useGeneratedStarters: false,
    ratingShift: 2,
    rewardMultiplierBp: 17_500,
    displayName: 'Legend',
    rotation: {
      starterWeightBp: 30_000,
      benchWeightBp: 5000,
      overallBonusFloor: 80,
      overallBonusPerPointBp: 500,
      maxMinutes: 44,
      closingFivePolicy: 'best-legal-five',
    },
  },
};

export function buildCollectionDifficultyProfile(
  difficultyId: CollectionDifficultyId,
  overrides: Partial<CollectionDifficultyProfile> = {},
): CollectionDifficultyProfile {
  return collectionDifficultyProfileSchema.parse({
    difficultyVersion: COLLECTION_DIFFICULTY_VERSION,
    difficultyId,
    ...(DIFFICULTY_FIXTURES[difficultyId] as Record<string, unknown>),
    ...overrides,
  });
}

export function buildCollectionDifficultyProfiles(): CollectionDifficultyProfile[] {
  return [
    buildCollectionDifficultyProfile('street'),
    buildCollectionDifficultyProfile('pro'),
    buildCollectionDifficultyProfile('legend'),
  ];
}

export const COLLECTION_OBJECTIVE_LAUNCH_THRESHOLDS: Record<string, number> = {
  'obj-three-barrage-v1': 12,
  'obj-lock-score-v1': 105,
  'obj-bench-spark-v1': 25,
  'obj-ball-pressure-v1': 14,
  'obj-own-glass-v1': 10,
  'obj-box-score-star-v1': 10,
};

export function buildCollectionGameRulesFixture(
  overrides: Partial<CollectionGameRules> = {},
): CollectionGameRules {
  const difficulties = buildCollectionDifficultyProfiles();
  return collectionGameRulesV2Schema.parse({
    rulesVersion: COLLECTION_GAME_RULES_VERSION,
    gameVersion: COLLECTION_GAME_V2_VERSION,
    teamVersion: 'collection-team-v1',
    rewardVersion: COLLECTION_REWARD_V2_VERSION,
    replayVersion: COLLECTION_GAME_V2_REPLAY_VERSION,
    difficultyVersion: COLLECTION_DIFFICULTY_VERSION,
    objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
    cpuRosterSize: 12,
    eligibleScope: 'full-catalog',
    difficulties,
    objectives: Object.entries(COLLECTION_OBJECTIVE_LAUNCH_THRESHOLDS).map(
      ([objectiveId, threshold]) => ({
        objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
        objectiveId,
        title: objectiveId,
        threshold,
      }),
    ),
    rewardTable: {
      winCoins: 100,
      lossCoins: 10,
      objectiveCoins: 30,
      marginCoinPerPoint: 1,
      marginCapPoints: 20,
      firstClearCoins: { street: 200, pro: 350, legend: 500 },
    },
    environmentEraId: '2020s',
    homeCourtPolicy: 'neutral-home-court',
    engineVersion: 'engine-fixture',
    profileVersion: 'profile-fixture',
    ...overrides,
  });
}

export function buildCollectionProgressionFixture(input: {
  catalog: CollectionCatalog;
  targetMultiplierBp?: number;
  challenges?: CollectionChallengeDefinition[];
  setRewards?: CollectionSetRewardDefinition[];
}): CollectionProgressionRules {
  const { catalog } = input;
  const setRewards: CollectionSetRewardDefinition[] =
    input.setRewards ??
    catalog.sets.map((set) => ({
      setRewardVersion: COLLECTION_SET_REWARD_VERSION,
      setId: set.setId,
      title: set.title,
      memberCardIds: [...set.memberCardIds].sort(),
      currency: 'Exchange',
      amount: 2000,
      description: `${set.title} completion reward`,
    }));
  const firstCard = catalog.cards[0];
  const defaultChallenges: Array<CollectionChallengeDefinition | null> = [
    firstCard === undefined
      ? null
      : collectionChallengeDefinitionSchema.parse({
          challengeVersion: COLLECTION_CHALLENGE_VERSION,
          challengeId: 'challenge-fixture-era-v1',
          displayName: 'Fixture Era Core',
          description: 'Fixture era requirement',
          requirement: {
            kind: 'era-core',
            eraId: firstCard.eraId,
            minimumRosterCount: 2,
            minimumStarterCount: 1,
          },
          difficultyId: 'pro',
          firstClearCoins: 300,
          repeatWinCoins: 30,
        }),
    firstCard === undefined
      ? null
      : collectionChallengeDefinitionSchema.parse({
          challengeVersion: COLLECTION_CHALLENGE_VERSION,
          challengeId: 'challenge-fixture-franchise-v1',
          displayName: 'Fixture Franchise Core',
          description: 'Fixture franchise requirement',
          requirement: {
            kind: 'franchise-core',
            franchiseId: firstCard.franchiseId,
            minimumRosterCount: 2,
            minimumStarterCount: 1,
          },
          difficultyId: 'pro',
          firstClearCoins: 450,
          repeatWinCoins: 45,
        }),
    catalog.sets[0] === undefined
      ? null
      : collectionChallengeDefinitionSchema.parse({
          challengeVersion: COLLECTION_CHALLENGE_VERSION,
          challengeId: 'challenge-fixture-family-v1',
          displayName: 'Fixture Family Core',
          description: 'Fixture family requirement',
          requirement: {
            kind: 'set-family-core',
            setId: catalog.sets[0].setId,
            minimumRosterCount: 1,
            minimumStarterCount: 1,
          },
          difficultyId: 'pro',
          firstClearCoins: 700,
          repeatWinCoins: 70,
        }),
  ];
  const challenges: CollectionChallengeDefinition[] =
    input.challenges ??
    defaultChallenges.filter((entry): entry is CollectionChallengeDefinition => entry !== null);
  const base: Omit<CollectionProgressionRules, 'contentDigest'> = {
    schemaVersion: 1 as const,
    progressionVersion: COLLECTION_PROGRESSION_VERSION,
    targetingVersion: COLLECTION_TARGETING_VERSION,
    challengeVersion: COLLECTION_CHALLENGE_VERSION,
    challengeRewardVersion: COLLECTION_CHALLENGE_REWARD_VERSION,
    setRewardVersion: COLLECTION_SET_REWARD_VERSION,
    sourceCatalogVersion: COLLECTION_CATALOG_VERSION,
    sourceCatalogHash: 'a'.repeat(64) as CollectionProgressionRules['sourceCatalogHash'],
    targetMultiplierBp: input.targetMultiplierBp ?? 80_000,
    challenges,
    setRewards,
    display: {
      challengesTitle: 'Challenges',
      challengesBlurb: 'Fixed roster challenges over the single game flow.',
      targetingBlurb: 'Target a canonical player; rarity odds do not change.',
      setsTitle: 'Sets',
      setsBlurb: 'Complete a set once to claim its Exchange reward.',
    },
  };
  const contentDigest = collectionProgressionRulesDigest(base);
  return collectionProgressionRulesSchema.parse({ ...base, contentDigest });
}
