import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_CHALLENGE_VERSION,
  COLLECTION_PROGRESSION_VERSION,
  COLLECTION_SET_REWARD_VERSION,
  COLLECTION_TARGETING_VERSION,
  collectionProgressionRulesDigest,
  type CollectionCatalog,
  type CollectionChallengeDefinition,
  type CollectionProgressionRules,
} from '@hoop-rush/data-contracts';
import { checkCollectionChallengeFeasibility } from './challenges.ts';
import { CollectionCommandError } from './packs.ts';

export function validateCollectionProgressionRules(input: {
  progression: CollectionProgressionRules;
  progressionHash: string;
  catalog: CollectionCatalog;
  verifyFeasibility?: boolean;
}): void {
  const { progression, catalog } = input;
  const failures: string[] = [];
  const versionChecks: Array<[string, string, string]> = [
    ['progressionVersion', progression.progressionVersion, COLLECTION_PROGRESSION_VERSION],
    ['targetingVersion', progression.targetingVersion, COLLECTION_TARGETING_VERSION],
    ['challengeVersion', progression.challengeVersion, COLLECTION_CHALLENGE_VERSION],
    ['setRewardVersion', progression.setRewardVersion, COLLECTION_SET_REWARD_VERSION],
    ['sourceCatalogVersion', progression.sourceCatalogVersion, COLLECTION_CATALOG_VERSION],
  ];
  for (const [label, value, expected] of versionChecks) {
    if (value !== expected) {
      failures.push(`unexpected ${label} ${value}`);
    }
  }
  if ((progression.sourceCatalogVersion as string) !== catalog.catalogVersion) {
    failures.push('progression rules do not belong to the pinned catalog version');
  }
  if (
    !Number.isSafeInteger(progression.targetMultiplierBp) ||
    progression.targetMultiplierBp < 10_000
  ) {
    failures.push('target multiplier must be an integer at least 10000 basis points');
  }
  const expectedDigest = collectionProgressionRulesDigest(progression);
  if (progression.contentDigest !== expectedDigest) {
    failures.push('progression content digest does not match the artifact');
  }
  if (input.progressionHash.length === 0) {
    failures.push('progression hash is required');
  }
  const catalogSets = new Map(catalog.sets.map((set) => [set.setId, set]));
  const rewarded = new Set<string>();
  for (const reward of progression.setRewards) {
    if (rewarded.has(reward.setId)) {
      failures.push(`duplicate set reward ${reward.setId}`);
    }
    rewarded.add(reward.setId);
    const set = catalogSets.get(reward.setId);
    if (set === undefined) {
      failures.push(`set reward ${reward.setId} references an unknown catalog set`);
      continue;
    }
    const required = [...set.memberCardIds].sort();
    if (
      required.length !== reward.memberCardIds.length ||
      required.some((cardId, index) => cardId !== reward.memberCardIds[index])
    ) {
      failures.push(`set reward ${reward.setId} members do not match the pinned catalog`);
    }
    if (!Number.isSafeInteger(reward.amount) || reward.amount <= 0) {
      failures.push(`set reward ${reward.setId} amount must be a positive safe integer`);
    }
    if (reward.title !== set.title) {
      failures.push(`set reward ${reward.setId} title does not match the pinned catalog`);
    }
  }
  for (const set of catalog.sets) {
    if (!rewarded.has(set.setId)) {
      failures.push(`missing set reward ${set.setId}`);
    }
  }
  const challengeIds = new Set<string>();
  for (const challenge of progression.challenges) {
    if (challengeIds.has(challenge.challengeId)) {
      failures.push(`duplicate challenge ${challenge.challengeId}`);
    }
    challengeIds.add(challenge.challengeId);
    if ((challenge.challengeVersion as string) !== COLLECTION_CHALLENGE_VERSION) {
      failures.push(`challenge ${challenge.challengeId} has an unexpected version`);
    }
    if (
      !Number.isSafeInteger(challenge.firstClearCoins) ||
      challenge.firstClearCoins <= 0 ||
      !Number.isSafeInteger(challenge.repeatWinCoins) ||
      challenge.repeatWinCoins <= 0
    ) {
      failures.push(`challenge ${challenge.challengeId} rewards must be positive safe integers`);
    }
    if (input.verifyFeasibility === true) {
      const feasibility = checkCollectionChallengeFeasibility(challenge, catalog);
      failures.push(...feasibility.failures);
    }
  }
  if (failures.length > 0) {
    throw new CollectionCommandError('invalid-progression-rules', failures.join('; '));
  }
}

export function resolveCollectionChallenge(
  progression: CollectionProgressionRules,
  challengeId: string,
): CollectionChallengeDefinition | undefined {
  return progression.challenges.find((entry) => entry.challengeId === challengeId);
}
