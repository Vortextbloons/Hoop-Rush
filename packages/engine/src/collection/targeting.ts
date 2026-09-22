import {
  COLLECTION_PACK_RULES_VERSION,
  COLLECTION_RARITY_ORDER,
  COLLECTION_TARGET_BASE_WEIGHT_BP,
  COLLECTION_TARGETING_VERSION,
  canonicalJson,
  collectionTargetOddsSchema,
  collectionTargetSnapshotSchema,
  type CollectionCatalog,
  type CollectionPackDefinition,
  type CollectionPullRecordV2,
  type CollectionRarity,
  type CollectionTargetOdds,
  type CollectionTargetSnapshot,
  type CollectionTargetEligibility,
} from '@hoop-rush/data-contracts';
import { createRng } from '../sim/rng.ts';
import { CollectionCommandError, eligiblePackCards, slotRarityDistribution } from './packs.ts';
import { collectionNamespaceSeed } from './seeds.ts';

export function collectionTargetingSeedPath(
  packId: string,
  packRulesVersion: string,
  pullSequence: number,
): string[] {
  return ['collection', 'targeting', packId, packRulesVersion, String(pullSequence)];
}

export function collectionTargetingSlotSeed(
  rootSeed: string,
  packId: string,
  packRulesVersion: string,
  pullSequence: number,
  slotIndex: number,
  rarity: CollectionRarity,
  playerId: string,
): string {
  return collectionNamespaceSeed(
    rootSeed,
    'targeting',
    packId,
    packRulesVersion,
    String(pullSequence),
    String(slotIndex),
    rarity,
    playerId,
  );
}

export function collectionTargetingSlotSeedFromPath(
  rootSeed: string,
  seedPath: readonly string[],
  slotIndex: number,
  rarity: CollectionRarity,
  playerId: string,
): string {
  return collectionNamespaceSeed(
    rootSeed,
    'targeting',
    ...seedPath.slice(2),
    String(slotIndex),
    rarity,
    playerId,
  );
}

export function compileTargetEligibility(
  catalog: CollectionCatalog,
  pack: CollectionPackDefinition,
  targetPlayerId: string,
): CollectionTargetEligibility[] {
  const eligible = eligiblePackCards(catalog, pack);
  return COLLECTION_RARITY_ORDER.map((rarity) => ({
    rarity,
    cardIds: eligible
      .filter((card) => card.rarity === rarity && card.playerId === targetPlayerId)
      .map((card) => card.cardId)
      .sort(),
  }));
}

export function targetEligibleCardIds(
  eligibility: readonly CollectionTargetEligibility[],
): string[] {
  return eligibility.flatMap((entry) => entry.cardIds).sort();
}

export function compileTargetSnapshot(input: {
  catalog: CollectionCatalog;
  pack: CollectionPackDefinition;
  targetPlayerId: string;
  multiplierBp: number;
  pullSequence: number;
}): CollectionTargetSnapshot {
  const eligibility = compileTargetEligibility(input.catalog, input.pack, input.targetPlayerId);
  return collectionTargetSnapshotSchema.parse({
    targetingVersion: COLLECTION_TARGETING_VERSION,
    targetPlayerId: input.targetPlayerId,
    multiplierBp: input.multiplierBp,
    packId: input.pack.packId,
    packRulesVersion: COLLECTION_PACK_RULES_VERSION,
    eligibleByRarity: eligibility,
    eligibleCardCount: targetEligibleCardIds(eligibility).length,
    seedPath: collectionTargetingSeedPath(
      input.pack.packId,
      COLLECTION_PACK_RULES_VERSION,
      input.pullSequence,
    ),
  });
}

function sortedRarityIds(
  catalog: CollectionCatalog,
  pack: CollectionPackDefinition,
  rarity: CollectionRarity,
): string[] {
  return eligiblePackCards(catalog, pack)
    .filter((card) => card.rarity === rarity)
    .map((card) => card.cardId)
    .sort();
}

export function selectTargetedCard(input: {
  catalog: CollectionCatalog;
  pack: CollectionPackDefinition;
  rarity: CollectionRarity;
  targetPlayerId: string;
  multiplierBp: number;
  seed: string;
}): string {
  const ids = sortedRarityIds(input.catalog, input.pack, input.rarity);
  if (ids.length === 0) {
    throw new CollectionCommandError(
      'invalid-definition',
      `pack ${input.pack.packId} has no ${input.rarity} cards`,
    );
  }
  const weights = ids.map((cardId) => {
    const card = input.catalog.cards.find((entry) => entry.cardId === cardId);
    if (card === undefined) {
      throw new CollectionCommandError('missing-content', `unknown card ${cardId}`);
    }
    return card.playerId === input.targetPlayerId
      ? input.multiplierBp
      : COLLECTION_TARGET_BASE_WEIGHT_BP;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new CollectionCommandError('arithmetic-overflow', 'target weights are not positive');
  }
  const rng = createRng(input.seed as Parameters<typeof createRng>[0]);
  let cursor = rng.next() * total;
  for (let index = 0; index < ids.length; index += 1) {
    cursor -= weights[index] ?? 0;
    if (cursor < 0) return ids[index] ?? ids[0]!;
  }
  return ids[ids.length - 1]!;
}

function targetProbabilityForRarity(
  eligibleIds: readonly string[],
  targetIds: readonly string[],
  multiplierBp: number,
): number {
  if (eligibleIds.length === 0) return 0;
  const target = targetIds.length;
  if (target === 0) return 0;
  const others = eligibleIds.length - target;
  const targetWeight = target * multiplierBp;
  const otherWeight = others * COLLECTION_TARGET_BASE_WEIGHT_BP;
  return targetWeight / (targetWeight + otherWeight);
}

export function describeCollectionTargetOdds(input: {
  catalog: CollectionCatalog;
  pack: CollectionPackDefinition;
  targetPlayerId: string | null;
  multiplierBp: number;
}): CollectionTargetOdds {
  const { catalog, pack, targetPlayerId } = input;
  if (targetPlayerId === null) {
    return collectionTargetOddsSchema.parse({
      targetingVersion: COLLECTION_TARGETING_VERSION,
      packId: pack.packId,
      targetPlayerId: null,
      multiplierBp: input.multiplierBp,
      eligibleCardIds: [],
      perSlot: pack.slots.map((_slot, slotIndex) => ({ slotIndex, targetProbability: 0 })),
      atLeastOneTarget: 0,
    });
  }
  const eligibility = compileTargetEligibility(catalog, pack, targetPlayerId);
  const eligibleIds = targetEligibleCardIds(eligibility);
  const eligibleByRarity = new Map(eligibility.map((entry) => [entry.rarity, entry.cardIds]));
  const perSlot = pack.slots.map((_slot, slotIndex) => {
    const distribution = slotRarityDistribution(pack, slotIndex, catalog);
    let probability = 0;
    for (const rarity of COLLECTION_RARITY_ORDER) {
      const slotShare = distribution[rarity];
      if (slotShare <= 0) continue;
      const rarityIds = sortedRarityIds(catalog, pack, rarity);
      const targetIds = eligibleByRarity.get(rarity) ?? [];
      probability +=
        slotShare * targetProbabilityForRarity(rarityIds, targetIds, input.multiplierBp);
    }
    return { slotIndex, targetProbability: probability };
  });
  let none = 1;
  for (const slot of perSlot) none *= 1 - slot.targetProbability;
  return collectionTargetOddsSchema.parse({
    targetingVersion: COLLECTION_TARGETING_VERSION,
    packId: pack.packId,
    targetPlayerId,
    multiplierBp: input.multiplierBp,
    eligibleCardIds: eligibleIds,
    perSlot,
    atLeastOneTarget: 1 - none,
  });
}

export interface TargetedPackDraw {
  slotIndex: number;
  cardId: string;
  rarity: CollectionRarity;
}

export function drawCollectionPackSlotsTargeted(input: {
  catalog: CollectionCatalog;
  pack: CollectionPackDefinition;
  rootSeed: string;
  pullSequence: number;
  target: CollectionTargetSnapshot;
}): TargetedPackDraw[] {
  const { catalog, pack, rootSeed, pullSequence, target } = input;
  const pullSeed = collectionNamespaceSeed(
    rootSeed,
    'pulls',
    pack.packId,
    pack.packRulesVersion,
    String(pullSequence),
  );
  const rng = createRng(pullSeed);
  const draws: TargetedPackDraw[] = [];
  for (const [slotIndex] of pack.slots.entries()) {
    const distribution = slotRarityDistribution(pack, slotIndex, catalog);
    const rarity = drawRarityFrom(distribution, rng.next());
    // mirror the untargeted path's per-slot draw consumption so rarity rolls stay identical
    void rng.next();
    const seed = collectionTargetingSlotSeedFromPath(
      rootSeed,
      target.seedPath,
      slotIndex,
      rarity,
      target.targetPlayerId,
    );
    const cardId = selectTargetedCard({
      catalog,
      pack,
      rarity,
      targetPlayerId: target.targetPlayerId,
      multiplierBp: target.multiplierBp,
      seed,
    });
    draws.push({ slotIndex, cardId, rarity });
  }
  return draws;
}

function drawRarityFrom(
  distribution: Record<CollectionRarity, number>,
  roll: number,
): CollectionRarity {
  let cursor = roll;
  for (const rarity of COLLECTION_RARITY_ORDER) {
    cursor -= distribution[rarity];
    if (cursor < 0) return rarity;
  }
  for (let index = COLLECTION_RARITY_ORDER.length - 1; index >= 0; index -= 1) {
    const rarity = COLLECTION_RARITY_ORDER[index];
    if (rarity !== undefined && distribution[rarity] > 0) return rarity;
  }
  throw new CollectionCommandError('invalid-definition', 'empty rarity distribution');
}

export function targetedPullDigestMaterial(pull: CollectionPullRecordV2): string {
  return canonicalJson({
    pullSequence: pull.pullSequence,
    packId: pull.packId,
    targeting: pull.targeting,
    slots: pull.slots,
  });
}
