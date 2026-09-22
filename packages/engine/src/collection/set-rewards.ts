import {
  collectionSetClaimReceiptSchema,
  collectionSetProgressFactsSchema,
  seasonDigestHex,
  type CollectionSetClaimReceipt,
  type CollectionSetId,
  type CollectionSetProgressFacts,
  type CollectionSetRewardDefinition,
} from '@hoop-rush/data-contracts';

export function collectionSetProgress(input: {
  setId: CollectionSetId;
  title: string;
  memberCardIds: readonly string[];
  ownedCardIds: ReadonlySet<string>;
}): CollectionSetProgressFacts {
  const required = [...input.memberCardIds].sort();
  const owned = required.filter((cardId) => input.ownedCardIds.has(cardId));
  const missing = required.filter((cardId) => !input.ownedCardIds.has(cardId));
  return collectionSetProgressFactsSchema.parse({
    setId: input.setId,
    title: input.title,
    memberCardIds: required,
    ownedMemberCardIds: owned,
    missingCardIds: missing,
    ownedCount: owned.length,
    requiredCount: required.length,
    complete: missing.length === 0,
  });
}

export function collectionSetRewardTransactionId(input: {
  collectionId: string;
  setId: string;
  setRewardVersion: string;
  commandId: string;
}): string {
  return `txn-${seasonDigestHex(
    [
      'collection-set-reward',
      input.collectionId,
      input.setId,
      input.setRewardVersion,
      input.commandId,
    ].join('\u0000'),
  )}`;
}

export function setClaimReceiptFor(input: {
  reward: CollectionSetRewardDefinition;
  memberCardIds: readonly string[];
  ownedAtClaimCardIds: readonly string[];
  transactionId: string;
  commandId: string;
  claimedAtIso: string;
}): CollectionSetClaimReceipt {
  return collectionSetClaimReceiptSchema.parse({
    setRewardVersion: input.reward.setRewardVersion,
    setId: input.reward.setId,
    title: input.reward.title,
    memberCardIds: [...input.memberCardIds].sort(),
    ownedAtClaimCardIds: [...input.ownedAtClaimCardIds].sort(),
    currency: input.reward.currency,
    amount: input.reward.amount,
    transactionId: input.transactionId,
    commandId: input.commandId,
    claimedAtIso: input.claimedAtIso,
  });
}
