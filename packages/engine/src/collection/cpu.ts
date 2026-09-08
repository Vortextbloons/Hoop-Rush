import {
  COLLECTION_GAME_CPU_ROSTER_SIZE,
  COLLECTION_TEAM_VERSION,
  collectionActiveTeamSchema,
  type CollectionActiveTeam,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionCpuRarityWeights,
  type CollectionRarity,
  type PositionUnion,
  type SlotIndex,
} from '@hoop-rush/data-contracts';
import { assignLineup, canFillSlot } from '../domain/lineup.ts';
import { createRng } from '../sim/rng.ts';
import { allocateDefaultMinutes, COMPLETION_PROBE_SCAN_CAP } from './active-team.ts';
import { CollectionCommandError } from './packs.ts';
import { collectionCpuTeamSeed, collectionGameSeedPaths } from './seeds.ts';

const STARTER_SLOTS: SlotIndex[] = [0, 1, 2, 3, 4];
const BENCH_COUNT = COLLECTION_GAME_CPU_ROSTER_SIZE - STARTER_SLOTS.length;

function overallOf(card: CollectionCatalogCard): number {
  return card.summarySource?.overallRating ?? 60;
}

export function cpuPerCardWeights(
  catalog: CollectionCatalog,
  weights: CollectionCpuRarityWeights,
): Map<string, number> {
  const counts = new Map<CollectionRarity, number>();
  for (const card of catalog.cards) {
    counts.set(card.rarity, (counts.get(card.rarity) ?? 0) + 1);
  }
  const perCard = new Map<string, number>();
  for (const card of catalog.cards) {
    const weight = weights[card.rarity];
    const count = counts.get(card.rarity) ?? 0;
    if (!(weight > 0) || count === 0) {
      throw new CollectionCommandError(
        'invalid-definition',
        `cpu weights miss a positive entry for ${card.rarity}`,
      );
    }
    perCard.set(card.cardId, weight / count);
  }
  return perCard;
}

function slotMaskOf(positions: PositionUnion): number {
  let mask = 0;
  for (const slot of STARTER_SLOTS) {
    if (canFillSlot(positions, slot)) mask |= 1 << slot;
  }
  return mask;
}

function maskedFeasible(
  remainingSlots: SlotIndex[],
  masks: ReadonlyArray<{ playerId: string; mask: number }>,
  usedPlayers: ReadonlySet<string>,
): boolean {
  function search(index: number, taken: Set<string>): boolean {
    if (index === remainingSlots.length) return true;
    const slot = remainingSlots[index];
    if (slot === undefined) return false;
    const bit = 1 << slot;
    let scanned = 0;
    for (const candidate of masks) {
      if (taken.has(candidate.playerId)) continue;
      if (scanned >= COMPLETION_PROBE_SCAN_CAP) break;
      scanned += 1;
      if ((candidate.mask & bit) === 0) continue;
      taken.add(candidate.playerId);
      if (search(index + 1, taken)) return true;
      taken.delete(candidate.playerId);
    }
    return false;
  }
  return search(0, new Set(usedPlayers));
}

export interface CpuTeamResult {
  team: CollectionActiveTeam;
  assignment: Array<{ slotIndex: SlotIndex; playerId: string }>;
  seedPath: string[];
}

export function generateCollectionCpuTeam(
  catalog: CollectionCatalog,
  rootSeed: string,
  gameSequence: number,
  weights: CollectionCpuRarityWeights,
): CpuTeamResult {
  const uniquePlayers = new Set(catalog.cards.map((card) => card.playerId));
  if (uniquePlayers.size < COLLECTION_GAME_CPU_ROSTER_SIZE) {
    throw new CollectionCommandError(
      'missing-content',
      `cpu needs ${String(COLLECTION_GAME_CPU_ROSTER_SIZE)} unique players, catalog has ${String(uniquePlayers.size)}`,
    );
  }
  const perCard = cpuPerCardWeights(catalog, weights);
  const rng = createRng(collectionCpuTeamSeed(rootSeed, gameSequence));
  const pool = catalog.cards.map((card) => ({
    playerId: card.playerId,
    positions: card.positions,
    mask: slotMaskOf(card.positions),
    overall: overallOf(card),
    card,
    weight: perCard.get(card.cardId) ?? 0,
  }));
  const masked = pool.map((candidate) => ({ playerId: candidate.playerId, mask: candidate.mask }));
  const chosen: CollectionCatalogCard[] = [];
  const usedPlayers = new Set<string>();
  for (const [slotPosition, slot] of STARTER_SLOTS.entries()) {
    const bit = 1 << slot;
    const candidates = pool.filter((candidate) => {
      if (usedPlayers.has(candidate.playerId)) return false;
      if ((candidate.mask & bit) === 0) return false;
      const probeUsed = new Set(usedPlayers);
      probeUsed.add(candidate.playerId);
      return maskedFeasible(STARTER_SLOTS.slice(slotPosition + 1), masked, probeUsed);
    });
    if (candidates.length === 0) {
      throw new CollectionCommandError(
        'no-legal-five',
        `no completion-safe cpu candidate fills slot ${String(slot)}`,
      );
    }
    const picked = rng.weightedPick(
      candidates,
      candidates.map((candidate) => candidate.weight),
    );
    chosen.push(picked.card);
    usedPlayers.add(picked.playerId);
  }
  for (let bench = 0; bench < BENCH_COUNT; bench += 1) {
    const candidates = pool.filter((candidate) => !usedPlayers.has(candidate.playerId));
    if (candidates.length === 0) {
      throw new CollectionCommandError('missing-content', 'cpu bench ran out of unique players');
    }
    const picked = rng.weightedPick(
      candidates,
      candidates.map((candidate) => candidate.weight),
    );
    chosen.push(picked.card);
    usedPlayers.add(picked.playerId);
  }
  const assignment = assignLineup(
    chosen
      .slice(0, STARTER_SLOTS.length)
      .map((card) => ({ playerId: card.playerId, positions: card.positions })),
  );
  if (assignment === null) {
    throw new CollectionCommandError('no-legal-five', 'cpu starters cannot fill G/G/F/F/C');
  }
  const starters = chosen.slice(0, STARTER_SLOTS.length);
  const bench = chosen.slice(STARTER_SLOTS.length);
  const starterIds = new Set(starters.map((card) => card.cardId));
  const team = collectionActiveTeamSchema.parse({
    teamVersion: COLLECTION_TEAM_VERSION,
    starters: starters.map((card) => card.cardId),
    bench: bench.map((card) => card.cardId),
    targetMinutes: allocateDefaultMinutes(
      chosen.map((card) => ({ cardId: card.cardId, starter: starterIds.has(card.cardId) })),
    ),
  });
  return {
    team,
    assignment: assignment.map((entry) => ({
      slotIndex: entry.slotIndex,
      playerId: entry.playerId,
    })),
    seedPath: collectionGameSeedPaths(gameSequence).cpuTeam,
  };
}
