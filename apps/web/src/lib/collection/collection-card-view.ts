import { resolveCollectionCard } from '@hoop-rush/engine';
import type {
  CollectionCatalogCard,
  CollectionIndexEntry,
  SimulationRatings,
} from '@hoop-rush/data-contracts';

export interface CollectionCardView {
  cardId: string;
  playerId: CollectionIndexEntry['playerId'];
  playerExternalId: string;
  name: string;
  season: string;
  franchiseId: string;
  rarity: CollectionIndexEntry['rarity'];
  family: CollectionIndexEntry['family'];
  availability: CollectionIndexEntry['availability'];
  positions: readonly string[];
  overall: number;
  offense: number | null;
  defense: number | null;
  ratings: SimulationRatings | null;
  owned: boolean;
}

export function collectionCardViewOf(input: {
  entry: CollectionIndexEntry;
  catalogCard: CollectionCatalogCard | null;
  owned: boolean;
}): CollectionCardView {
  const { entry, catalogCard } = input;
  const resolved = catalogCard ? resolveCollectionCard(catalogCard, catalogCard) : null;
  return {
    cardId: entry.cardId,
    playerId: entry.playerId,
    playerExternalId: entry.playerExternalId,
    name: entry.displayName,
    season: entry.seasonKey,
    franchiseId: entry.franchiseId,
    rarity: entry.rarity,
    family: entry.family,
    availability: entry.availability,
    positions: entry.positions,
    overall: entry.overall,
    offense: catalogCard?.summarySource?.offenseRating ?? null,
    defense: catalogCard?.summarySource?.defenseRating ?? null,
    ratings: resolved?.ratings ?? null,
    owned: input.owned,
  };
}
