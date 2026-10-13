import {
  canonicalJson,
  seasonDigestHex,
  type CollectionBalances,
  type CollectionCatalogCard,
  type CollectionCardDefinition,
  type CollectionState,
  type SimulationPlayer,
  type SimulationRatings,
  type SimulationTendencies,
} from '@hoop-rush/data-contracts';
import { collectionCardIdSchema } from '@hoop-rush/data-contracts';
import { COLLECTION_OVERLAY_VERSION } from '@hoop-rush/data-contracts';
import { finishingDemand } from '../sim/offense.ts';
import { ENGINE_CONSTANTS } from '../sim/constants.ts';

export function collectionCardId(
  kind: 'base' | 'special',
  sourcePlayerVersionId: string,
  family: string,
): string {
  const material =
    kind === 'base'
      ? `${COLLECTION_OVERLAY_VERSION}\u0000base\u0000${sourcePlayerVersionId}`
      : `${COLLECTION_OVERLAY_VERSION}\u0000special\u0000${sourcePlayerVersionId}\u0000${family}`;
  return collectionCardIdSchema.parse(`card-${seasonDigestHex(material)}`);
}

function clampRating(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

export interface ResolvedCollectionCard {
  cardId: string;
  playerId: string;
  displayName: string;
  positions: string[];
  ratings: SimulationRatings;
  tendencies: SimulationTendencies;
}

export function resolveCollectionCard(
  card: CollectionCardDefinition,
  source: Pick<
    CollectionCatalogCard,
    'detailedRatings' | 'tendencies' | 'positions' | 'playerId' | 'displayName' | 'cardId'
  >,
): ResolvedCollectionCard {
  const ratings = { ...source.detailedRatings };
  if (card.ratingOverlay !== undefined) {
    for (const [key, delta] of Object.entries(card.ratingOverlay)) {
      const ratingKey = key as keyof SimulationRatings;
      if (typeof delta === 'number') {
        ratings[ratingKey] = clampRating(ratings[ratingKey] + delta);
      }
    }
  }
  const tendencies = { ...source.tendencies };
  if (card.tendencyOverlay !== undefined) {
    for (const [key, delta] of Object.entries(card.tendencyOverlay)) {
      const tendencyKey = key as keyof SimulationTendencies;
      const current = tendencies[tendencyKey];
      if (typeof current === 'number' && typeof delta === 'number') {
        const next = current + delta;
        tendencies[tendencyKey] = Math.min(100, Math.max(0, next));
      }
    }
  }
  const positions =
    card.eligibilityOverlay !== undefined && card.eligibilityOverlay.length > 0
      ? [...card.eligibilityOverlay].sort()
      : [...source.positions].sort();
  return {
    cardId: card.cardId,
    playerId: card.playerId,
    displayName: card.displayName,
    positions,
    ratings,
    tendencies,
  };
}

export function toCollectionSimulationPlayer(
  resolved: ResolvedCollectionCard,
  source: Pick<
    CollectionCatalogCard,
    'heightInches' | 'weightLbs' | 'anchors' | 'reconstructedThreePoint' | 'tendencies'
  >,
): SimulationPlayer {
  const player: SimulationPlayer = {
    playerId: resolved.playerId as SimulationPlayer['playerId'],
    displayName: resolved.displayName,
    positions: resolved.positions as SimulationPlayer['positions'],
    heightInches: source.heightInches,
    weightLbs: source.weightLbs,
    ratings: resolved.ratings,
    tendencies: resolved.tendencies,
    anchors: source.anchors,
    reconstructedThreePoint: source.reconstructedThreePoint,
  };
  const shotDelta = resolved.tendencies.shotRate - source.tendencies.shotRate;
  const usageDelta = resolved.tendencies.usageRate - source.tendencies.usageRate;
  if (shotDelta !== 0 || usageDelta !== 0) {
    const base = finishingDemand({ ...player, tendencies: source.tendencies });
    const minutes = source.anchors?.minutesPerGame || 48;
    player.offensiveLoad = {
      ...base,
      source: 'derived-attempts',
      attemptsPer36: Math.max(
        ENGINE_CONSTANTS.offensiveAllocation.minimumDemand,
        base.attemptsPer36 + (((shotDelta * 48) / 100) * 36) / minutes + usageDelta * 0.5,
      ),
    };
  }
  return player;
}

export function collectionStateDigest(facts: {
  collectionId: string;
  revision: number;
  claimedWelcome: boolean;
  ownedCardIds: readonly string[];
  balances: CollectionBalances;
  nextPullSequence: number;
  catalogVersion: string;
  economyVersion: string;
  progressionVersion: string;
  progressionHash: string | null;
  activeTargetPlayerId: string | null;
  claimedSetIds: readonly string[];
}): string {
  return seasonDigestHex(
    canonicalJson({
      activeTargetPlayerId: facts.activeTargetPlayerId,
      balances: facts.balances,
      catalogVersion: facts.catalogVersion,
      claimedSetIds: [...facts.claimedSetIds].sort(),
      claimedWelcome: facts.claimedWelcome,
      collectionId: facts.collectionId,
      economyVersion: facts.economyVersion,
      nextPullSequence: facts.nextPullSequence,
      ownedCardIds: [...facts.ownedCardIds].sort(),
      progressionHash: facts.progressionHash,
      progressionVersion: facts.progressionVersion,
      revision: facts.revision,
    }),
  );
}

export function collectionStateFactsOf(state: CollectionState): {
  collectionId: string;
  revision: number;
  claimedWelcome: boolean;
  ownedCardIds: string[];
  balances: CollectionBalances;
  nextPullSequence: number;
  catalogVersion: string;
  economyVersion: string;
  progressionVersion: string;
  progressionHash: string | null;
  activeTargetPlayerId: string | null;
  claimedSetIds: string[];
} {
  return {
    collectionId: state.collectionId,
    revision: state.revision,
    claimedWelcome: state.claimedWelcome,
    ownedCardIds: state.owned.map((entry) => entry.cardId),
    balances: state.balances,
    nextPullSequence: state.nextPullSequence,
    catalogVersion: state.catalogVersion,
    economyVersion: state.economyVersion,
    progressionVersion: state.progressionVersion,
    progressionHash: state.progressionHash ?? null,
    activeTargetPlayerId: state.activeTargetPlayerId,
    claimedSetIds: [...state.claimedSetIds].sort(),
  };
}
