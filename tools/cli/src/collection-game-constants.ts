import {
  COLLECTION_DIFFICULTY_ORDER,
  COLLECTION_DIFFICULTY_VERSION,
  COLLECTION_GAME_FIRST_CLEAR_COINS,
  COLLECTION_GAME_REWARD_LOSS_COINS,
  COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS,
  COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT,
  COLLECTION_GAME_REWARD_OBJECTIVE_COINS,
  COLLECTION_GAME_REWARD_WIN_COINS,
  COLLECTION_OBJECTIVE_VERSION,
  collectionDifficultyProfileSchema,
  collectionObjectiveIdSchema,
  type CollectionDifficultyId,
  type CollectionDifficultyProfile,
  type CollectionGameRules,
  type CollectionRarity,
  type CollectionRewardTable,
} from '@hoop-rush/data-contracts';

export const COLLECTION_LAUNCH_DIFFICULTY_CANDIDATES: Record<CollectionDifficultyId, unknown> = {
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

export function buildCollectionLaunchDifficultyProfiles(): CollectionDifficultyProfile[] {
  return COLLECTION_DIFFICULTY_ORDER.map((difficultyId) =>
    collectionDifficultyProfileSchema.parse({
      difficultyVersion: COLLECTION_DIFFICULTY_VERSION,
      difficultyId,
      ...(COLLECTION_LAUNCH_DIFFICULTY_CANDIDATES[difficultyId] as Record<string, unknown>),
    }),
  );
}

export const COLLECTION_OBJECTIVE_LAUNCH_TITLES = {
  'obj-three-barrage-v1': 'Three barrage',
  'obj-lock-score-v1': 'Lock the score',
  'obj-bench-spark-v1': 'Bench spark',
  'obj-ball-pressure-v1': 'Ball pressure',
  'obj-own-glass-v1': 'Own the glass',
  'obj-box-score-star-v1': 'Box-score star',
} as const;

export const COLLECTION_OBJECTIVE_LAUNCH_THRESHOLDS: Record<string, number> = {
  'obj-three-barrage-v1': 12,
  'obj-lock-score-v1': 105,
  'obj-bench-spark-v1': 25,
  'obj-ball-pressure-v1': 14,
  'obj-own-glass-v1': 10,
  'obj-box-score-star-v1': 10,
};

export function buildCollectionLaunchObjectives(): CollectionGameRules['objectives'] {
  return collectionObjectiveIdSchema.options.map((objectiveId) => ({
    objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
    objectiveId,
    title: COLLECTION_OBJECTIVE_LAUNCH_TITLES[objectiveId],
    threshold: COLLECTION_OBJECTIVE_LAUNCH_THRESHOLDS[objectiveId] as number,
  }));
}

export const COLLECTION_GAME_REWARD_TABLE: CollectionRewardTable = {
  winCoins: COLLECTION_GAME_REWARD_WIN_COINS,
  lossCoins: COLLECTION_GAME_REWARD_LOSS_COINS,
  objectiveCoins: COLLECTION_GAME_REWARD_OBJECTIVE_COINS,
  marginCoinPerPoint: COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT,
  marginCapPoints: COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS,
  firstClearCoins: { ...COLLECTION_GAME_FIRST_CLEAR_COINS },
};

export const COLLECTION_GAME_CPU_LEGACY_WEIGHTS: Record<CollectionRarity, number> = {
  Ember: 70,
  Eruption: 23,
  Apex: 5,
  Titan: 1.7,
  Eclipse: 0.29,
  Immortal: 0.01,
};
