import type {
  CollectionCatalog,
  CollectionCatalogCard,
  CollectionPullRecord,
  CollectionTargetOdds,
} from '@hoop-rush/data-contracts';

export function formatTargetProbability(probability: number): string {
  if (!Number.isFinite(probability) || probability <= 0) return '0%';
  const percent = probability * 100;
  if (percent >= 1) return `${trimTrailingZeros(percent.toFixed(2))}%`;
  if (percent >= 0.01) return `${trimTrailingZeros(percent.toFixed(3))}%`;
  if (percent >= 1e-6) return `${trimTrailingZeros(percent.toFixed(6))}%`;
  return `${percent.toExponential(3)}%`;
}

function trimTrailingZeros(value: string): string {
  return value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export interface TargetPlayerSummary {
  playerId: string;
  displayName: string;
  versionCount: number;
  versionsByRarity: Record<CollectionCatalogCard['rarity'], number>;
  packsWithEligibleVersions: number;
}

export function targetPlayerSummary(
  catalog: CollectionCatalog,
  playerId: string,
): TargetPlayerSummary | null {
  const versions = catalog.cards.filter((card) => card.playerId === playerId);
  if (versions.length === 0) return null;
  const versionsByRarity: TargetPlayerSummary['versionsByRarity'] = {
    Ember: 0,
    Eruption: 0,
    Apex: 0,
    Titan: 0,
    Eclipse: 0,
    Immortal: 0,
  };
  for (const card of versions) versionsByRarity[card.rarity] += 1;
  const packsWithEligibleVersions = catalog.packs.filter((pack) =>
    pack.slots.some((slot) => {
      const floorRank = rarityRankOf(slot.kind === 'guaranteed' ? slot.floorRarity : undefined);
      return versions.some((card) => {
        if (pack.eligibleScope === 'specials-only' && card.family === 'Base') return false;
        return rarityRankOf(card.rarity) >= floorRank;
      });
    }),
  ).length;
  return {
    playerId,
    displayName: versions[0]?.displayName ?? playerId,
    versionCount: versions.length,
    versionsByRarity,
    packsWithEligibleVersions,
  };
}

const RARITY_RANKS: Record<string, number> = {
  Ember: 0,
  Eruption: 1,
  Apex: 2,
  Titan: 3,
  Eclipse: 4,
  Immortal: 5,
};

function rarityRankOf(rarity: string | undefined): number {
  return RARITY_RANKS[rarity ?? 'Ember'] ?? 0;
}

export interface PackTargetOddsView {
  packId: string;
  hasTarget: boolean;
  eligible: boolean;
  eligibleVersionCount: number;
  atLeastOneLabel: string;
  perSlotLabels: string[];
  summary: string;
}

export function packTargetOddsView(input: {
  odds: CollectionTargetOdds;
  playerName: string;
  eligibleVersionCount: number;
}): PackTargetOddsView {
  const { odds, playerName, eligibleVersionCount } = input;
  const perSlotLabels = odds.perSlot.map((slot) => formatTargetProbability(slot.targetProbability));
  if (odds.targetPlayerId === null) {
    return {
      packId: odds.packId,
      hasTarget: false,
      eligible: false,
      eligibleVersionCount: 0,
      atLeastOneLabel: '0%',
      perSlotLabels,
      summary: 'No active target. Every eligible card has equal weight.',
    };
  }
  const atLeastOneLabel = formatTargetProbability(odds.atLeastOneTarget);
  if (odds.eligibleCardIds.length === 0) {
    return {
      packId: odds.packId,
      hasTarget: true,
      eligible: false,
      eligibleVersionCount,
      atLeastOneLabel,
      perSlotLabels,
      summary: `No eligible version of ${playerName} in this pack — target chance 0%.`,
    };
  }
  return {
    packId: odds.packId,
    hasTarget: true,
    eligible: true,
    eligibleVersionCount,
    atLeastOneLabel,
    perSlotLabels,
    summary: `P(at least one ${playerName}) ${atLeastOneLabel} · ${String(odds.eligibleCardIds.length)} eligible ${
      odds.eligibleCardIds.length === 1 ? 'version' : 'versions'
    } in this pack`,
  };
}

export function pullTargetPlayerId(pull: CollectionPullRecord): string | null {
  if (!('targeting' in pull)) return null;
  return pull.targeting?.targetPlayerId ?? null;
}

export function isTargetedPullSlot(
  pull: CollectionPullRecord,
  cardId: string,
  playerIdOf: (cardId: string) => string | null,
): boolean {
  const targetPlayerId = pullTargetPlayerId(pull);
  if (targetPlayerId === null) return false;
  return playerIdOf(cardId) === targetPlayerId;
}

export interface TargetedReceiptFacts {
  targetPlayerId: string;
  hitCount: number;
  slotCount: number;
  hitSlotIndices: number[];
  summary: string;
}

export function targetedReceiptFacts(input: {
  pull: CollectionPullRecord;
  playerName: string;
  playerIdOf: (cardId: string) => string | null;
}): TargetedReceiptFacts | null {
  const targetPlayerId = pullTargetPlayerId(input.pull);
  if (targetPlayerId === null) return null;
  const hitSlotIndices: number[] = [];
  for (const slot of input.pull.slots) {
    if (input.playerIdOf(slot.cardId) === targetPlayerId) hitSlotIndices.push(slot.slotIndex);
  }
  const hitCount = hitSlotIndices.length;
  const summary =
    hitCount === 0
      ? `No ${input.playerName} in this pull. The target stays active.`
      : `${input.playerName} pulled in ${String(hitCount)} of ${String(input.pull.slots.length)} slots. The target stays active.`;
  return {
    targetPlayerId,
    hitCount,
    slotCount: input.pull.slots.length,
    hitSlotIndices,
    summary,
  };
}

export function targetedSummaryForPlayer(
  summary: TargetPlayerSummary | null,
  playerId: string,
): string {
  if (summary === null) return `Target player ${playerId} is not in the pinned catalog.`;
  const packs =
    summary.packsWithEligibleVersions === 1
      ? '1 pack'
      : `${String(summary.packsWithEligibleVersions)} packs`;
  const versions =
    summary.versionCount === 1
      ? '1 catalog version'
      : `${String(summary.versionCount)} catalog versions`;
  return `${summary.displayName} · ${versions} · eligible in ${packs}`;
}
