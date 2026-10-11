import { collectionCatalogSchema, type CollectionCatalog } from '../collection.ts';
import { DRAFT_DUEL_CATALOG_FAMILY } from '../draft-duel-versions.ts';
import {
  draftDuelCatalogSourceSchema,
  type DraftDuelCatalogEntry,
  type DraftDuelCatalogSource,
} from '../draft-duel.ts';
import { overallBandIndexOf } from '../overall-bands.ts';
import { loadAsset } from './index.ts';

const FALLBACK_OVERALL = 60;

export function buildDraftDuelCatalogSource(catalog: CollectionCatalog): DraftDuelCatalogSource {
  const entries: DraftDuelCatalogEntry[] = [];
  for (const card of catalog.cards) {
    if (card.family !== DRAFT_DUEL_CATALOG_FAMILY) continue;
    const overall = card.summarySource?.overallRating ?? FALLBACK_OVERALL;
    entries.push({
      card: {
        cardId: card.cardId,
        playerId: card.playerId,
        playerExternalId: card.playerExternalId,
        playerVersionId: card.sourcePlayerVersionId,
        displayName: card.displayName,
        seasonKey: card.seasonKey,
        franchiseId: card.franchiseId,
        eraId: card.eraId,
        positions: card.positions,
        overall,
        bandIndex: overallBandIndexOf(overall),
      },
      simulation: {
        playerId: card.playerId,
        playerVersionId: card.sourcePlayerVersionId,
        displayName: card.displayName,
        positions: card.positions,
        heightInches: card.heightInches,
        weightLbs: card.weightLbs,
        ratings: card.detailedRatings,
        tendencies: card.tendencies,
        ...(card.anchors ? { anchors: card.anchors } : {}),
        ...(card.reconstructedThreePoint
          ? { reconstructedThreePoint: card.reconstructedThreePoint }
          : {}),
        overall,
      },
    });
  }
  return {
    catalogVersion: catalog.catalogVersion,
    catalogHash: catalog.sourceCatalogHash,
    dataVersion: catalog.dataVersion,
    ratingsVersion: catalog.ratingsVersion,
    playerVersionIdVersion: catalog.playerVersionIdVersion,
    positionNormalizationVersion: catalog.positionNormalizationVersion,
    entries,
  };
}
export function parseDraftDuelCatalogSource(value: unknown): DraftDuelCatalogSource {
  return draftDuelCatalogSourceSchema.parse(value);
}
export function loadDraftDuelCatalogSource(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<DraftDuelCatalogSource> {
  return loadAsset(url, collectionCatalogSchema, 'collection catalog', expectedHash, init).then(
    buildDraftDuelCatalogSource,
  );
}
