import {
  SEASON_SEED_NAMESPACES,
  SEASON_SPONSOR_SLOTS,
  buildEmptyPlayerSponsors,
  buildEmptySponsorBoards,
  buildEmptySponsorVault,
  commandIdSchema,
  seasonNamespaceSeed,
  sponsorGearEntriesFor,
  sponsorGearPriceOf,
  sponsorGearTierConfigOf,
  type SeasonPlayerSponsorSlots,
  type SeasonSponsorAppliedSnapshot,
  type SeasonSponsorBoost,
  type SeasonSponsorGearCatalogEntry,
  type SeasonSponsorGearState,
  type SeasonSponsorOffer,
  type SeasonSponsorSlot,
  type SeasonSponsorTier,
  type SeasonRotation,
  type SimulationRatings,
} from '@hoop-rush/data-contracts';
import { createRng, shuffle, type Rng } from '../sim/rng.ts';

const OFFER_COUNT = 5;
const SPONSOR_TIERS: readonly SeasonSponsorTier[] = ['BUZZ', 'PRIME', 'ICON'];

function tierWeights(): readonly number[] {
  return SPONSOR_TIERS.map((tier) => sponsorGearTierConfigOf(tier).weight);
}

export function rollSponsorBoosts(
  rng: Rng,
  entry: SeasonSponsorGearCatalogEntry,
): SeasonSponsorBoost[] {
  const tier = sponsorGearTierConfigOf(entry.tier);
  const pool = rng.nextInt(tier.poolMin, tier.poolMax);
  const maxStats = Math.min(tier.statMax, entry.eligible.length);
  let statCount = Math.min(rng.nextInt(tier.statMin, tier.statMax), maxStats);
  while (statCount < maxStats && pool - (statCount - 1) > statCount * tier.singleKeyCap) {
    statCount += 1;
  }
  const remaining = [...entry.eligible];
  const chosen: { key: SeasonSponsorBoost['key']; weight: number }[] = [];
  for (let i = 0; i < statCount; i += 1) {
    const pick = rng.weightedPick(
      remaining,
      remaining.map((candidate) => candidate.weight),
    );
    chosen.push({ key: pick.key, weight: pick.weight });
    remaining.splice(remaining.indexOf(pick), 1);
  }
  const effective = pool - (chosen.length - 1);
  const amounts = chosen.map(() => 1);
  let leftover = effective - chosen.length;
  for (let i = 0; i < amounts.length - 1; i += 1) {
    if (leftover <= 0) break;
    const take = rng.nextInt(0, leftover);
    amounts[i] = (amounts[i] ?? 0) + take;
    leftover -= take;
  }
  amounts[amounts.length - 1] = (amounts[amounts.length - 1] ?? 0) + leftover;
  for (let pass = 0; pass <= chosen.length + 1; pass += 1) {
    let moved = false;
    for (let i = 0; i < chosen.length; i += 1) {
      const current = amounts[i] ?? 0;
      if (current > tier.singleKeyCap) {
        amounts[i] = tier.singleKeyCap;
        const next = (i + 1) % chosen.length;
        amounts[next] = (amounts[next] ?? 0) + (current - tier.singleKeyCap);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return chosen
    .map((candidate, index) => ({ key: candidate.key, points: amounts[index] ?? 0 }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

function rollOffer(
  rng: Rng,
  blockIndex: number,
  offerIndex: number,
  slot: SeasonSponsorSlot,
): SeasonSponsorOffer {
  const tier = rng.weightedPick(SPONSOR_TIERS, tierWeights());
  const entries = sponsorGearEntriesFor(slot, tier);
  const entry = rng.pick(entries);
  return {
    instanceId: `sponsor-${String(blockIndex)}-${String(offerIndex)}`,
    entryId: entry.entryId,
    brandFamily: entry.brandFamily,
    slot,
    tier,
    boosts: rollSponsorBoosts(rng, entry),
    price: sponsorGearPriceOf(tier),
    blockIndex,
    expiresAtBlock: blockIndex,
  };
}

export function seasonSponsorOffersForBlock(
  rootSeed: string,
  blockIndex: number,
): SeasonSponsorOffer[] {
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex > 8) {
    throw new Error(`sponsor offers blockIndex out of range: ${String(blockIndex)}`);
  }
  if (blockIndex === 8) return [];
  const seed = seasonNamespaceSeed(
    rootSeed,
    SEASON_SEED_NAMESPACES.sponsors,
    'deal',
    String(blockIndex),
  );
  const rng = createRng(seed);
  const slotOrder = shuffle([...SEASON_SPONSOR_SLOTS], rng);
  const offers: SeasonSponsorOffer[] = [];
  for (let i = 0; i < OFFER_COUNT; i += 1) {
    const slot =
      i < slotOrder.length ? (slotOrder[i] ?? 'shoe') : rng.pick([...SEASON_SPONSOR_SLOTS]);
    offers.push(rollOffer(rng, blockIndex, i, slot));
  }
  return offers;
}

export function applySponsorBoosts(
  ratings: SimulationRatings,
  applied: SeasonPlayerSponsorSlots | null | undefined,
): SimulationRatings {
  if (applied === null || applied === undefined) return { ...ratings };
  const boosted = { ...ratings };
  for (const slot of SEASON_SPONSOR_SLOTS) {
    const snapshot = applied[slot];
    if (snapshot === null) continue;
    for (const boost of snapshot.boosts) {
      boosted[boost.key] = Math.min(100, Math.max(0, boosted[boost.key] + boost.points));
    }
  }
  return boosted;
}

function slotKeyUniverse(slot: SeasonSponsorSlot): SeasonSponsorBoost['key'][] {
  const keys = new Set<SeasonSponsorBoost['key']>();
  for (const tier of SPONSOR_TIERS) {
    for (const entry of sponsorGearEntriesFor(slot, tier)) {
      for (const weight of entry.eligible) keys.add(weight.key);
    }
  }
  return [...keys].sort();
}

function starterNeed(
  ratings: SimulationRatings,
  slot: SeasonSponsorSlot,
  minutesShare: number,
): number {
  let headroom = 0;
  for (const key of slotKeyUniverse(slot)) {
    headroom += Math.max(0, 85 - ratings[key]);
  }
  return minutesShare * headroom;
}

export interface AiSponsorKitInput {
  rootSeed: string;
  blockIndex: number;
  franchiseId: string;
  rotation: SeasonRotation | undefined;
  ratings: ReadonlyMap<string, SimulationRatings>;
  applied: ReadonlyMap<string, SeasonPlayerSponsorSlots>;
}

export function resolveAiSponsorKit(
  input: AiSponsorKitInput,
): { playerVersionId: string; snapshot: SeasonSponsorAppliedSnapshot } | null {
  const { rotation } = input;
  if (rotation === undefined) return null;
  const minutes = new Map<string, number>();
  let total = 0;
  for (const entry of rotation.targetMinutes) {
    const share = Math.max(0, entry.minutes);
    minutes.set(entry.playerVersionId, share);
    total += share;
  }
  if (total <= 0) return null;
  let best: { playerVersionId: string; slot: SeasonSponsorSlot; need: number } | null = null;
  for (const playerVersionId of rotation.starters) {
    const ratings = input.ratings.get(playerVersionId);
    if (ratings === undefined) continue;
    const slots = input.applied.get(playerVersionId);
    for (const slot of SEASON_SPONSOR_SLOTS) {
      if (slots?.[slot] != null) continue;
      const need = starterNeed(ratings, slot, (minutes.get(playerVersionId) ?? 0) / total);
      if (
        best === null ||
        need > best.need ||
        (need === best.need &&
          (playerVersionId < best.playerVersionId ||
            (playerVersionId === best.playerVersionId && slot < best.slot)))
      ) {
        best = { playerVersionId, slot, need };
      }
    }
  }
  if (best === null || best.need <= 0) return null;
  const ratings = input.ratings.get(best.playerVersionId);
  if (ratings === undefined) return null;
  const rng = createRng(
    seasonNamespaceSeed(
      input.rootSeed,
      SEASON_SEED_NAMESPACES.sponsors,
      'ai',
      input.franchiseId,
      String(input.blockIndex),
    ),
  );
  const tier = rng.weightedPick(SPONSOR_TIERS, tierWeights());
  const entries = sponsorGearEntriesFor(best.slot, tier);
  let fitted: SeasonSponsorGearCatalogEntry | null = null;
  let fittedScore = -1;
  for (const entry of entries) {
    let fit = 0;
    for (const weight of entry.eligible) {
      fit += weight.weight * Math.max(0, 85 - ratings[weight.key]);
    }
    if (fitted === null || fit > fittedScore) {
      fitted = entry;
      fittedScore = fit;
    }
  }
  if (fitted === null) return null;
  return {
    playerVersionId: best.playerVersionId,
    snapshot: {
      instanceId: `sponsor-ai-${input.franchiseId}-${String(input.blockIndex)}`,
      entryId: fitted.entryId,
      brandFamily: fitted.brandFamily,
      slot: best.slot,
      tier,
      boosts: rollSponsorBoosts(rng, fitted),
      appliedBlock: input.blockIndex,
      appliedByCommandId: commandIdSchema.parse(
        `ai-sponsor-${input.franchiseId}-${String(input.blockIndex)}`,
      ),
    },
  };
}

export function createInitialSponsorGearState(rootSeed: string): SeasonSponsorGearState {
  return {
    vault: buildEmptySponsorVault(),
    boards: {
      ...buildEmptySponsorBoards(),
      boards: [
        {
          blockIndex: 0,
          offers: seasonSponsorOffersForBlock(rootSeed, 0),
          purchasedInstanceIds: [],
        },
      ],
    },
    players: buildEmptyPlayerSponsors(),
  };
}

export interface SponsorBlockCommitInput {
  rootSeed: string;
  acceptedBlockIndex: number;
  sponsors: SeasonSponsorGearState;
  rotations: readonly SeasonRotation[];
  ratings: ReadonlyMap<string, SimulationRatings>;
  humanFranchiseId: string | null;
  aiFranchiseIds?: readonly string[];
}

export function sponsorsWithBlockCommit(input: SponsorBlockCommitInput): SeasonSponsorGearState {
  const nextBlockIndex = input.acceptedBlockIndex + 1;
  let boards = input.sponsors.boards;
  if (
    nextBlockIndex >= 0 &&
    nextBlockIndex <= 7 &&
    !boards.boards.some((board) => board.blockIndex === nextBlockIndex)
  ) {
    boards = {
      ...boards,
      boards: [
        ...boards.boards,
        {
          blockIndex: nextBlockIndex,
          offers: seasonSponsorOffersForBlock(input.rootSeed, nextBlockIndex),
          purchasedInstanceIds: [],
        },
      ].sort((a, b) => a.blockIndex - b.blockIndex),
    };
  }
  const applied = new Map<string, SeasonPlayerSponsorSlots>(
    Object.entries(input.sponsors.players.slots),
  );
  for (const franchiseId of input.aiFranchiseIds ?? []) {
    if (franchiseId === input.humanFranchiseId) continue;
    const kit = resolveAiSponsorKit({
      rootSeed: input.rootSeed,
      blockIndex: input.acceptedBlockIndex,
      franchiseId,
      rotation: input.rotations.find((rotation) => rotation.franchiseId === franchiseId),
      ratings: input.ratings,
      applied,
    });
    if (kit === null) continue;
    const slots = applied.get(kit.playerVersionId) ?? {
      shoe: null,
      apparel: null,
      fuel: null,
    };
    applied.set(kit.playerVersionId, { ...slots, [kit.snapshot.slot]: kit.snapshot });
  }
  return {
    vault: input.sponsors.vault,
    boards,
    players: { ...input.sponsors.players, slots: Object.fromEntries(applied) },
  };
}
