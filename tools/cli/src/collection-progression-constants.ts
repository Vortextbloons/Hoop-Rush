import {
  COLLECTION_CHALLENGE_VERSION,
  COLLECTION_SET_REWARD_VERSION,
  collectionChallengeDefinitionSchema,
  collectionProgressionDisplaySchema,
  collectionSetRewardDefinitionSchema,
  type CollectionCatalog,
  type CollectionChallengeDefinition,
  type CollectionProgressionDisplay,
  type CollectionSetRewardDefinition,
} from '@hoop-rush/data-contracts';

export const COLLECTION_TARGET_MULTIPLIER_BP = 80_000;

export const COLLECTION_PROGRESSION_DISPLAY: CollectionProgressionDisplay =
  collectionProgressionDisplaySchema.parse({
    challengesTitle: 'Challenges',
    challengesBlurb:
      'Fixed roster challenges over the single game flow. Requirement and difficulty are snapshotted before tip-off.',
    targetingBlurb:
      'Target one canonical player. Every eligible version shares the same within-rarity boost, and rarity odds never change.',
    setsTitle: 'Sets',
    setsBlurb:
      'Own all four exact members of a set to claim its one-time Exchange reward. Cards are never consumed.',
  });

export const COLLECTION_LAUNCH_CHALLENGES: readonly CollectionChallengeDefinition[] = [
  collectionChallengeDefinitionSchema.parse({
    challengeVersion: COLLECTION_CHALLENGE_VERSION,
    challengeId: 'challenge-era-1980s-v1',
    displayName: 'Eighties Rotation',
    description: 'Win with at least 8 active cards and all 5 starters from the 1980s.',
    requirement: {
      kind: 'era-core',
      eraId: '1980s',
      minimumRosterCount: 8,
      minimumStarterCount: 5,
    },
    difficultyId: 'pro',
    firstClearCoins: 300,
    repeatWinCoins: 30,
  }),
  collectionChallengeDefinitionSchema.parse({
    challengeVersion: COLLECTION_CHALLENGE_VERSION,
    challengeId: 'challenge-era-1990s-v1',
    displayName: 'Nineties Rotation',
    description: 'Win with at least 8 active cards and all 5 starters from the 1990s.',
    requirement: {
      kind: 'era-core',
      eraId: '1990s',
      minimumRosterCount: 8,
      minimumStarterCount: 5,
    },
    difficultyId: 'pro',
    firstClearCoins: 300,
    repeatWinCoins: 30,
  }),
  collectionChallengeDefinitionSchema.parse({
    challengeVersion: COLLECTION_CHALLENGE_VERSION,
    challengeId: 'challenge-era-2000s-v1',
    displayName: 'Millennium Rotation',
    description: 'Win with at least 8 active cards and all 5 starters from the 2000s.',
    requirement: {
      kind: 'era-core',
      eraId: '2000s',
      minimumRosterCount: 8,
      minimumStarterCount: 5,
    },
    difficultyId: 'pro',
    firstClearCoins: 300,
    repeatWinCoins: 30,
  }),
  collectionChallengeDefinitionSchema.parse({
    challengeVersion: COLLECTION_CHALLENGE_VERSION,
    challengeId: 'challenge-franchise-lakers-v1',
    displayName: 'Lakers Core',
    description: 'Win with at least 6 active cards and 3 starters from the Lakers.',
    requirement: {
      kind: 'franchise-core',
      franchiseId: 'lakers',
      minimumRosterCount: 6,
      minimumStarterCount: 3,
    },
    difficultyId: 'pro',
    firstClearCoins: 450,
    repeatWinCoins: 45,
  }),
  collectionChallengeDefinitionSchema.parse({
    challengeVersion: COLLECTION_CHALLENGE_VERSION,
    challengeId: 'challenge-franchise-celtics-v1',
    displayName: 'Celtics Core',
    description: 'Win with at least 6 active cards and 3 starters from the Celtics.',
    requirement: {
      kind: 'franchise-core',
      franchiseId: 'celtics',
      minimumRosterCount: 6,
      minimumStarterCount: 3,
    },
    difficultyId: 'pro',
    firstClearCoins: 450,
    repeatWinCoins: 45,
  }),
  collectionChallengeDefinitionSchema.parse({
    challengeVersion: COLLECTION_CHALLENGE_VERSION,
    challengeId: 'challenge-franchise-bulls-v1',
    displayName: 'Bulls Core',
    description: 'Win with at least 6 active cards and 3 starters from the Bulls.',
    requirement: {
      kind: 'franchise-core',
      franchiseId: 'bulls',
      minimumRosterCount: 6,
      minimumStarterCount: 3,
    },
    difficultyId: 'pro',
    firstClearCoins: 450,
    repeatWinCoins: 45,
  }),
  collectionChallengeDefinitionSchema.parse({
    challengeVersion: COLLECTION_CHALLENGE_VERSION,
    challengeId: 'challenge-family-sharpshooter-v1',
    displayName: 'Sharpshooter Unit',
    description: 'Win with at least 3 Sharpshooter set members, 2 of them starters.',
    requirement: {
      kind: 'set-family-core',
      setId: 'sharpshooter-set',
      minimumRosterCount: 3,
      minimumStarterCount: 2,
    },
    difficultyId: 'legend',
    firstClearCoins: 700,
    repeatWinCoins: 70,
  }),
  collectionChallengeDefinitionSchema.parse({
    challengeVersion: COLLECTION_CHALLENGE_VERSION,
    challengeId: 'challenge-family-lockdown-v1',
    displayName: 'Lockdown Unit',
    description: 'Win with at least 3 Lockdown set members, 2 of them starters.',
    requirement: {
      kind: 'set-family-core',
      setId: 'lockdown-set',
      minimumRosterCount: 3,
      minimumStarterCount: 2,
    },
    difficultyId: 'legend',
    firstClearCoins: 700,
    repeatWinCoins: 70,
  }),
  collectionChallengeDefinitionSchema.parse({
    challengeVersion: COLLECTION_CHALLENGE_VERSION,
    challengeId: 'challenge-family-floor-general-v1',
    displayName: 'Floor General Unit',
    description: 'Win with at least 3 Floor General set members, 2 of them starters.',
    requirement: {
      kind: 'set-family-core',
      setId: 'floor-general-set',
      minimumRosterCount: 3,
      minimumStarterCount: 2,
    },
    difficultyId: 'legend',
    firstClearCoins: 700,
    repeatWinCoins: 70,
  }),
];

export type CollectionLaunchSetRewardFixed = Omit<CollectionSetRewardDefinition, 'memberCardIds'>;

export const COLLECTION_LAUNCH_SET_REWARDS: readonly CollectionLaunchSetRewardFixed[] = [
  {
    setRewardVersion: COLLECTION_SET_REWARD_VERSION,
    setId: 'sharpshooter-set',
    title: 'Sharpshooters',
    currency: 'Exchange',
    amount: 2000,
    description: 'Own all four Sharpshooters cards to claim 2,000 Exchange once.',
  },
  {
    setRewardVersion: COLLECTION_SET_REWARD_VERSION,
    setId: 'lockdown-set',
    title: 'Lockdown',
    currency: 'Exchange',
    amount: 2000,
    description: 'Own all four Lockdown cards to claim 2,000 Exchange once.',
  },
  {
    setRewardVersion: COLLECTION_SET_REWARD_VERSION,
    setId: 'floor-general-set',
    title: 'Floor Generals',
    currency: 'Exchange',
    amount: 2000,
    description: 'Own all four Floor Generals cards to claim 2,000 Exchange once.',
  },
];

export function collectionLaunchSetRewardDefinitions(
  catalog: CollectionCatalog,
): CollectionSetRewardDefinition[] {
  return COLLECTION_LAUNCH_SET_REWARDS.map((fixed) => {
    const set = catalog.sets.find((entry) => entry.setId === fixed.setId);
    if (set === undefined) {
      throw new Error(`launch set reward ${fixed.setId} is missing from the pinned catalog`);
    }
    return collectionSetRewardDefinitionSchema.parse({
      ...fixed,
      memberCardIds: [...set.memberCardIds].sort(),
    });
  });
}
