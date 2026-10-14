import type {
  HavocAdaptedCandidate,
  HavocCatalog,
  HavocDraftCard,
  HavocDraftOffer,
  HavocMutationDefinition,
  HavocMutationEntry,
  HavocMutationId,
  HavocTier,
  Position,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_OFFER_SIZE,
  HAVOC_OFFER_TARGET_RADIUS,
  HAVOC_REROLL_LIMIT,
  HAVOC_TIER_PROBABILITIES,
  POSITIONS,
  canonicalJson,
  havocClaimKeyOf,
  havocDraftCardSchema,
  havocDraftOfferSchema,
  havocDraftCardSeed,
  havocDraftPlayersSeed,
  havocDraftWindowSeed,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import { swapAt, type Rng } from '../../sim/rng.ts';
import { compareStrings } from '../../domain/math.ts';
import { HavocCatalogCoverageError } from './api.ts';
import type {
  GenerateHavocOffer as GenerateHavocOfferSignature,
  GenerateHavocOfferInput,
} from './api.ts';
import type { HavocCompatibleBundle } from './compatibility.ts';
import { enumerateHavocBundles, havocBundleSpecialistCategories } from './compatibility.ts';
import { generateHavocNickname } from './nicknames.ts';
import { applyHavocMutationPackage } from './transform.ts';

const GROWTH_SPURT_MIN_INCHES = 6;
const GROWTH_SPURT_MAX_INCHES = 12;

export interface HavocOverallWindow {
  readonly target: number;
  readonly minOverall: number;
  readonly maxOverall: number;
}

export function havocOverallInWindow(
  originalOverall: number,
  window: Pick<HavocOverallWindow, 'minOverall' | 'maxOverall'>,
): boolean {
  return originalOverall >= window.minOverall && originalOverall <= window.maxOverall;
}

/**
 * Enumerates integer target Overall values whose inclusive ±radius window holds
 * at least HAVOC_OFFER_SIZE eligible items. Each item contributes the Overall
 * values that can be offered for it; the caller filters by position eligibility
 * (and rating tier in Curated) before calling.
 */
export function enumerateHavocOverallWindows(
  eligibleOveralls: readonly (readonly number[])[],
): readonly HavocOverallWindow[] {
  const windows: HavocOverallWindow[] = [];
  for (let target = 0; target <= 100; target += 1) {
    const minOverall = Math.max(0, target - HAVOC_OFFER_TARGET_RADIUS);
    const maxOverall = Math.min(100, target + HAVOC_OFFER_TARGET_RADIUS);
    let count = 0;
    for (const overalls of eligibleOveralls) {
      if (overalls.some((overall) => overall >= minOverall && overall <= maxOverall)) {
        count += 1;
        if (count >= HAVOC_OFFER_SIZE) break;
      }
    }
    if (count >= HAVOC_OFFER_SIZE) windows.push({ target, minOverall, maxOverall });
  }
  return windows;
}

export function drawHavocCardTier(rng: Rng): HavocTier {
  const roll = rng.next();
  if (roll < HAVOC_TIER_PROBABILITIES[1]) return 1;
  if (roll < HAVOC_TIER_PROBABILITIES[1] + HAVOC_TIER_PROBABILITIES[2]) return 2;
  return 3;
}

export function materializeHavocBundle(
  bundle: HavocCompatibleBundle,
  physicalRng: Rng,
  specialistRng: Rng,
  definitions: readonly HavocMutationDefinition[],
): HavocMutationEntry[] {
  return bundle.mutationIds.map((mutationId: HavocMutationId) => {
    if (mutationId === 'growth-spurt') {
      return {
        mutationId,
        sampledHeightDelta: physicalRng.nextInt(GROWTH_SPURT_MIN_INCHES, GROWTH_SPURT_MAX_INCHES),
      };
    }
    if (mutationId === 'the-specialist') {
      const categories = havocBundleSpecialistCategories(bundle, definitions);
      const category = specialistRng.pick([...categories]);
      return { mutationId, specialistCategory: category };
    }
    return { mutationId };
  });
}

interface HavocClaimGroup {
  readonly claimKey: string;
  readonly playerId: string;
  readonly seasonKey: string;
  readonly versions: readonly HavocAdaptedCandidate[];
  readonly playableSlots: readonly Position[];
}

function buildClaimGroups(
  catalog: HavocCatalog,
  draftedClaimKeys: ReadonlySet<string>,
): readonly HavocClaimGroup[] {
  const byClaim = new Map<string, HavocAdaptedCandidate[]>();
  for (const candidate of catalog.candidates) {
    if (candidate.seasonKey === null) {
      throw new Error(`havoc catalog candidate ${candidate.playerId} has no season key`);
    }
    const claimKey = havocClaimKeyOf(candidate.playerId, candidate.seasonKey);
    if (draftedClaimKeys.has(claimKey)) continue;
    const existing = byClaim.get(claimKey);
    if (existing === undefined) byClaim.set(claimKey, [candidate]);
    else existing.push(candidate);
  }
  const groups: HavocClaimGroup[] = [];
  for (const [claimKey, versions] of byClaim) {
    const sorted = [...versions].sort((left, right) =>
      compareStrings(left.playerVersionId ?? '', right.playerVersionId ?? ''),
    );
    const first = sorted[0];
    if (first === undefined || first.seasonKey === null) continue;
    groups.push({
      claimKey,
      playerId: first.playerId,
      seasonKey: first.seasonKey,
      versions: sorted,
      playableSlots: POSITIONS.filter((position) =>
        sorted.some((version) => version.positions.includes(position)),
      ),
    });
  }
  groups.sort((left, right) => compareStrings(left.claimKey, right.claimKey));
  return groups;
}

function assignSlotToGroups(
  slots: readonly Position[],
  groups: readonly HavocClaimGroup[],
  assignment: Map<number, number>,
  slotIndex: number,
  excludedClaimKey: string | undefined,
): boolean {
  const slot = slots[slotIndex];
  if (slot === undefined) return false;
  const visited = new Set<number>();
  const search = (current: number): boolean => {
    const currentSlot = slots[current];
    if (currentSlot === undefined) return false;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      if (group === undefined) continue;
      if (visited.has(groupIndex)) continue;
      if (group.claimKey === excludedClaimKey) continue;
      if (!group.playableSlots.includes(currentSlot)) continue;
      visited.add(groupIndex);
      const matchedSlot = assignment.get(groupIndex);
      if (matchedSlot === undefined || search(matchedSlot)) {
        assignment.set(groupIndex, current);
        return true;
      }
    }
    return false;
  };
  return search(slotIndex);
}

function matchGroups(
  slots: readonly Position[],
  groups: readonly HavocClaimGroup[],
  excludedClaimKey?: string,
): Map<number, number> | null {
  const assignment = new Map<number, number>();
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    if (!assignSlotToGroups(slots, groups, assignment, slotIndex, excludedClaimKey)) return null;
  }
  return assignment;
}

export const GenerateHavocOffer: GenerateHavocOfferSignature = (
  input: GenerateHavocOfferInput,
  environment,
): HavocDraftOffer => {
  const { catalog, runSeed, round, slot, offerIndex, draftedClaimKeys, rerollUsed } = input;
  if (!Number.isInteger(round) || round < 1 || round > POSITIONS.length) {
    throw new Error(`havoc draft round must be an integer in 1..5 (got ${String(round)})`);
  }
  const expectedSlot = POSITIONS[round - 1];
  if (slot !== expectedSlot) {
    throw new Error(`havoc draft round ${String(round)} must fill ${String(expectedSlot)}`);
  }
  if (!Number.isInteger(offerIndex) || offerIndex < 0) {
    throw new Error(`havoc offer index must be a nonnegative integer (got ${String(offerIndex)})`);
  }
  if (offerIndex > HAVOC_REROLL_LIMIT) {
    throw new Error(
      `havoc offer index exceeds the single reroll budget (got ${String(offerIndex)})`,
    );
  }
  if (offerIndex > 0 && !rerollUsed) {
    throw new Error('havoc offer index advanced without the draft-wide reroll being used');
  }

  const groups = buildClaimGroups(catalog, new Set(draftedClaimKeys));
  const remainingSlots = POSITIONS.slice(round);
  const baseMatch = matchGroups(remainingSlots, groups);
  if (baseMatch === null) {
    throw new HavocCatalogCoverageError(
      slot,
      'the remaining draft positions cannot be completed from eligible claims',
    );
  }
  const matchedGroupIndices = new Set(baseMatch.keys());
  const completable: HavocClaimGroup[] = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    if (group === undefined || !group.playableSlots.includes(slot)) continue;
    if (
      !matchedGroupIndices.has(groupIndex) ||
      matchGroups(remainingSlots, groups, group.claimKey) !== null
    ) {
      completable.push(group);
    }
  }

  const windows = enumerateHavocOverallWindows(
    completable.map((group) =>
      group.versions
        .filter((version) => version.positions.includes(slot))
        .map((version) => version.originalOverall),
    ),
  );
  if (windows.length === 0) {
    throw new HavocCatalogCoverageError(
      slot,
      `no ±${String(HAVOC_OFFER_TARGET_RADIUS)} target window holds ${String(HAVOC_OFFER_SIZE)} eligible claims`,
    );
  }

  const windowRng = environment.rngFactory(havocDraftWindowSeed(runSeed, round, offerIndex));
  const selectedWindow = windowRng.pick(windows);
  const playersRng = environment.rngFactory(havocDraftPlayersSeed(runSeed, round, offerIndex));
  const pool = completable.filter((group) =>
    group.versions.some(
      (version) =>
        version.positions.includes(slot) &&
        version.originalOverall >= selectedWindow.minOverall &&
        version.originalOverall <= selectedWindow.maxOverall,
    ),
  );
  if (pool.length < HAVOC_OFFER_SIZE) {
    throw new Error('havoc offer claim pool underflow');
  }
  const chosenClaims: HavocClaimGroup[] = [];
  for (let index = 0; index < HAVOC_OFFER_SIZE; index += 1) {
    const swapIndex = playersRng.nextInt(index, pool.length - 1);
    swapAt(pool, index, swapIndex);
    const chosen = pool[index];
    if (chosen === undefined) throw new Error('havoc offer claim pool underflow');
    chosenClaims.push(chosen);
  }

  const chosenVersions = chosenClaims.map((group) => {
    const eligible = group.versions.filter(
      (version) =>
        version.positions.includes(slot) &&
        version.originalOverall >= selectedWindow.minOverall &&
        version.originalOverall <= selectedWindow.maxOverall,
    );
    if (eligible.length === 0) {
      throw new Error(`havoc offer version pool underflow for claim ${group.claimKey}`);
    }
    return playersRng.pick(eligible);
  });

  const ownedExclusive = new Set(input.ownedTeamExclusiveMutationIds ?? []);
  const bundlesByTier = new Map<HavocTier, readonly HavocCompatibleBundle[]>([
    [1, enumerateHavocBundles(environment.definitions, 1)],
    [2, enumerateHavocBundles(environment.definitions, 2)],
    [
      3,
      enumerateHavocBundles(environment.definitions, 3).filter(
        (bundle) =>
          ownedExclusive.size === 0 ||
          bundle.mutationIds.every((mutationId) => !ownedExclusive.has(mutationId)),
      ),
    ],
  ]);

  const cardIds: string[] = [];
  const prepared: {
    readonly cardIndex: number;
    readonly tier: HavocTier;
    readonly mutations: HavocMutationEntry[];
    readonly nickname: string;
    readonly effective: HavocDraftCard['effective'];
  }[] = [];
  for (let cardIndex = 0; cardIndex < HAVOC_OFFER_SIZE; cardIndex += 1) {
    const tierRng = environment.rngFactory(
      havocDraftCardSeed(runSeed, round, offerIndex, cardIndex, 'tier'),
    );
    const tier = drawHavocCardTier(tierRng);
    const bundles = bundlesByTier.get(tier) ?? [];
    if (bundles.length === 0) {
      throw new Error(`no compatible havoc mutation bundles are defined for tier ${String(tier)}`);
    }
    const mutationsRng = environment.rngFactory(
      havocDraftCardSeed(runSeed, round, offerIndex, cardIndex, 'mutations'),
    );
    const bundle = mutationsRng.pick(bundles);
    const physicalRng = environment.rngFactory(
      havocDraftCardSeed(runSeed, round, offerIndex, cardIndex, 'physical'),
    );
    const specialistRng = environment.rngFactory(
      havocDraftCardSeed(runSeed, round, offerIndex, cardIndex, 'specialist'),
    );
    const mutations = materializeHavocBundle(
      bundle,
      physicalRng,
      specialistRng,
      environment.definitions,
    );
    const nicknameRng = environment.rngFactory(
      havocDraftCardSeed(runSeed, round, offerIndex, cardIndex, 'nickname'),
    );
    const nickname = generateHavocNickname({ slot, tier, mutations }, nicknameRng);
    const version = chosenVersions[cardIndex];
    const group = chosenClaims[cardIndex];
    if (version === undefined || group === undefined) {
      throw new Error('havoc offer card preparation underflow');
    }
    const effective = applyHavocMutationPackage(version, mutations, { slot });
    const cardId = `hvc-${seasonDigestHex(
      canonicalJson({
        runSeed,
        round,
        offerIndex,
        cardIndex,
        slot,
        playerId: group.playerId,
        seasonKey: group.seasonKey,
        playerVersionId: version.playerVersionId,
        tier,
        mutations,
      }),
    )}`;
    cardIds.push(cardId);
    prepared.push({ cardIndex, tier, mutations, nickname, effective });
  }

  const offerId = `hvo-${seasonDigestHex(
    canonicalJson({ runSeed, round, offerIndex, slot, cardIds }),
  )}`;
  const cards = prepared.map((card, cardIndex) => {
    const version = chosenVersions[cardIndex];
    const cardId = cardIds[cardIndex];
    if (version === undefined || cardId === undefined) {
      throw new Error('havoc offer card assembly underflow');
    }
    return havocDraftCardSchema.parse({
      cardId,
      offerId,
      cardIndex: card.cardIndex,
      slot,
      tier: card.tier,
      source: version,
      mutations: card.mutations,
      effective: card.effective,
      nickname: card.nickname,
    });
  });
  return havocDraftOfferSchema.parse({ offerId, offerIndex, round, slot, cards });
};
