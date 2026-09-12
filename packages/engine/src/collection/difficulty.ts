import {
  REQUIRED_RATING_KEYS,
  type CollectionActiveTeam,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionDifficultyProfile,
  type CollectionPreparedGameV2,
  type CollectionRatingAdjustmentEntry,
  type CollectionRatingAdjustmentFact,
  type CollectionRatingAdjustments,
  type CollectionRatingKey,
  type SimulationRatings,
} from '@hoop-rush/data-contracts';
import { resolveCollectionCard } from './cards.ts';
import { CollectionCommandError } from './packs.ts';

export const DIFFICULTY_RATING_SHIFT_MECHANISM = 'difficulty-rating-shift' as const;

function catalogIndex(catalog: CollectionCatalog): Map<string, CollectionCatalogCard> {
  return new Map(catalog.cards.map((card) => [card.cardId, card]));
}

function baseRatingsOf(card: CollectionCatalogCard): SimulationRatings {
  return resolveCollectionCard(card, card).ratings;
}

function clampRating(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export function resolveDifficultyRatingAdjustmentForCard(
  card: CollectionCatalogCard,
  profile: CollectionDifficultyProfile,
): CollectionRatingAdjustmentFact {
  const base = baseRatingsOf(card);
  const ratings: CollectionRatingAdjustmentEntry[] = [];
  const boundedRatings: CollectionRatingKey[] = [];
  for (const rating of REQUIRED_RATING_KEYS) {
    const before = base[rating];
    const raw = before + profile.ratingShift;
    const after = clampRating(raw);
    ratings.push({ rating, before, after });
    if (raw < 0 || raw > 100) boundedRatings.push(rating);
  }
  return {
    difficultyVersion: profile.difficultyVersion,
    mechanism: DIFFICULTY_RATING_SHIFT_MECHANISM,
    side: 'away',
    cardId: card.cardId,
    requestedDelta: profile.ratingShift,
    ratings,
    boundedRatings,
  };
}

export function resolveDifficultyRatingAdjustments(
  catalog: CollectionCatalog,
  cpuTeam: CollectionActiveTeam,
  profile: CollectionDifficultyProfile,
): CollectionRatingAdjustments {
  const byId = catalogIndex(catalog);
  const roster = [...cpuTeam.starters, ...cpuTeam.bench];
  const facts: CollectionRatingAdjustmentFact[] = [];
  if (profile.ratingShift !== 0) {
    for (const cardId of roster) {
      const card = byId.get(cardId);
      if (card === undefined) {
        throw new CollectionCommandError('missing-content', `adjustments: unknown card ${cardId}`);
      }
      facts.push(resolveDifficultyRatingAdjustmentForCard(card, profile));
    }
  }
  return {
    difficultyVersion: profile.difficultyVersion,
    mechanism: DIFFICULTY_RATING_SHIFT_MECHANISM,
    requestedDelta: profile.ratingShift,
    facts,
  };
}

export function materializeAdjustedCpuRatings(
  prepared: CollectionPreparedGameV2,
  catalog: CollectionCatalog,
): Map<string, SimulationRatings> {
  const byId = catalogIndex(catalog);
  const roster = [...prepared.cpuTeam.starters, ...prepared.cpuTeam.bench];
  const adjustmentById = new Map(prepared.adjustments.facts.map((fact) => [fact.cardId, fact]));
  if (prepared.adjustments.requestedDelta === 0 && adjustmentById.size > 0) {
    throw new CollectionCommandError(
      'invalid-adjustment-facts',
      'zero shift carries per-card adjustment facts',
    );
  }
  if (prepared.adjustments.requestedDelta !== 0 && adjustmentById.size !== roster.length) {
    throw new CollectionCommandError(
      'invalid-adjustment-facts',
      `shift ${String(prepared.adjustments.requestedDelta)} needs facts for all ${String(roster.length)} cpu cards`,
    );
  }
  const adjusted = new Map<string, SimulationRatings>();
  for (const cardId of roster) {
    const card = byId.get(cardId);
    if (card === undefined) {
      throw new CollectionCommandError(
        'invalid-adjustment-facts',
        `adjustments reference unknown card ${cardId}`,
      );
    }
    const base = baseRatingsOf(card);
    const fact = adjustmentById.get(cardId);
    if (fact === undefined) {
      adjusted.set(cardId, base);
      continue;
    }
    if (fact.requestedDelta !== prepared.adjustments.requestedDelta) {
      throw new CollectionCommandError(
        'invalid-adjustment-facts',
        `adjustment delta for ${cardId} disagrees with the profile shift`,
      );
    }
    const next: SimulationRatings = { ...base };
    for (const entry of fact.ratings) {
      if (base[entry.rating] !== entry.before) {
        throw new CollectionCommandError(
          'invalid-adjustment-facts',
          `adjustment before value for ${cardId}.${entry.rating} does not match content`,
        );
      }
      next[entry.rating] = entry.after;
    }
    adjusted.set(cardId, next);
  }
  for (const cardId of adjustmentById.keys()) {
    if (!roster.includes(cardId)) {
      throw new CollectionCommandError(
        'invalid-adjustment-facts',
        `adjustment fact for unrostered cpu card ${cardId}`,
      );
    }
  }
  return adjusted;
}

export function verifyDifficultyRatingAdjustments(
  prepared: CollectionPreparedGameV2,
  catalog: CollectionCatalog,
): string[] {
  const failures: string[] = [];
  if (prepared.adjustments.requestedDelta !== prepared.difficulty.ratingShift) {
    failures.push('adjustment requested delta does not match the difficulty profile');
  }
  const roster = [...prepared.cpuTeam.starters, ...prepared.cpuTeam.bench];
  const byId = catalogIndex(catalog);
  const expectedCount = prepared.adjustments.requestedDelta === 0 ? 0 : roster.length;
  if (prepared.adjustments.facts.length !== expectedCount) {
    failures.push(
      `adjustment facts count ${String(prepared.adjustments.facts.length)} != ${String(expectedCount)}`,
    );
  }
  for (const fact of prepared.adjustments.facts) {
    if (!roster.includes(fact.cardId)) {
      failures.push(`adjustment fact for unrostered ${fact.cardId}`);
      continue;
    }
    const card = byId.get(fact.cardId);
    if (card === undefined) {
      failures.push(`adjustment fact for unknown card ${fact.cardId}`);
      continue;
    }
    const expected = resolveDifficultyRatingAdjustmentForCard(card, prepared.difficulty);
    if (JSON.stringify(expected.ratings) !== JSON.stringify(fact.ratings)) {
      failures.push(`adjustment ratings for ${fact.cardId} do not reproduce`);
    }
    if (JSON.stringify(expected.boundedRatings) !== JSON.stringify(fact.boundedRatings)) {
      failures.push(`adjustment bounds for ${fact.cardId} do not reproduce`);
    }
  }
  return failures;
}

export function verifyMaterializedAdjustments(
  prepared: CollectionPreparedGameV2,
  catalog: CollectionCatalog,
): string[] {
  try {
    materializeAdjustedCpuRatings(prepared, catalog);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : 'adjustment materialization failed'];
  }
}
