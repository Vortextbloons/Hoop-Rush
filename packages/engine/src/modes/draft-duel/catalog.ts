import type {
  DraftDuelCatalogEntry,
  DraftDuelCatalogSource,
  DraftDuelCard,
  SimulationPlayer,
  SlotGroup,
} from '@hoop-rush/data-contracts';
import { slotGroupOf } from '@hoop-rush/data-contracts';

export interface DraftDuelCatalog {
  catalogVersion: string;
  catalogHash: string;
  dataVersion: string;
  ratingsVersion: string;
  playerVersionIdVersion: string;
  positionNormalizationVersion: string;
  entries: readonly DraftDuelCatalogEntry[];
  byPlayerId: ReadonlyMap<string, readonly DraftDuelCatalogEntry[]>;
  byVersionId: ReadonlyMap<string, DraftDuelCatalogEntry>;
  playerIds: readonly string[];
}
export function buildDraftDuelCatalog(source: DraftDuelCatalogSource): DraftDuelCatalog {
  if (source.entries.length === 0) {
    throw new Error('draft duel catalog: source has no eligible card entries');
  }
  const entries = [...source.entries].sort((a, b) => {
    if (a.card.playerId !== b.card.playerId) {
      return a.card.playerId < b.card.playerId ? -1 : 1;
    }
    if (a.card.playerVersionId !== b.card.playerVersionId) {
      return a.card.playerVersionId < b.card.playerVersionId ? -1 : 1;
    }
    return a.card.cardId < b.card.cardId ? -1 : a.card.cardId > b.card.cardId ? 1 : 0;
  });
  const byPlayerId = new Map<string, DraftDuelCatalogEntry[]>();
  const byVersionId = new Map<string, DraftDuelCatalogEntry>();
  for (const entry of entries) {
    const list = byPlayerId.get(entry.card.playerId);
    if (list) list.push(entry);
    else byPlayerId.set(entry.card.playerId, [entry]);
    if (byVersionId.has(entry.card.playerVersionId)) {
      throw new Error(`draft duel catalog: duplicate player version ${entry.card.playerVersionId}`);
    }
    byVersionId.set(entry.card.playerVersionId, entry);
  }
  return {
    catalogVersion: source.catalogVersion,
    catalogHash: source.catalogHash,
    dataVersion: source.dataVersion,
    ratingsVersion: source.ratingsVersion,
    playerVersionIdVersion: source.playerVersionIdVersion,
    positionNormalizationVersion: source.positionNormalizationVersion,
    entries,
    byPlayerId,
    byVersionId,
    playerIds: [...byPlayerId.keys()],
  };
}
export function cardGroupSet(card: DraftDuelCard): SlotGroup[] {
  const groups = new Set<SlotGroup>();
  for (const position of card.positions) groups.add(slotGroupOf(position));
  return [...groups].sort();
}
export function cardPlayableAt(card: DraftDuelCard, group: SlotGroup): boolean {
  for (const position of card.positions) {
    if (slotGroupOf(position) === group) return true;
  }
  return false;
}
export function catalogEntryForVersion(
  catalog: DraftDuelCatalog,
  playerVersionId: string,
): DraftDuelCatalogEntry {
  const entry = catalog.byVersionId.get(playerVersionId);
  if (!entry) {
    throw new Error(`draft duel catalog: unknown player version ${playerVersionId}`);
  }
  return entry;
}
export function catalogSimulationForVersion(
  catalog: DraftDuelCatalog,
  playerVersionId: string,
): SimulationPlayer {
  return catalogEntryForVersion(catalog, playerVersionId).simulation;
}
