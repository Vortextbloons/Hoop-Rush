import {
  SEASON_DRAFT_SCRIPT_FLOOR_COUNT,
  SEASON_DRAFT_SCRIPT_FLOOR_MAX_OVERALL,
  SEASON_DRAFT_SCRIPT_STAR_COUNT,
  SEASON_DRAFT_SCRIPT_STAR_MIN_OVERALL,
  seasonNamespaceSeed,
  type SeasonDraftCandidate,
} from '@hoop-rush/data-contracts';
import { createRng, shuffle } from '../sim/rng.ts';

export const DRAFT_SCRIPT_ROUND_COUNT = 10;
export const DRAFT_SCRIPT_STAR_TIER_WEIGHTS: ReadonlyArray<{
  min: number;
  max: number;
  weight: number;
}> = [
  { min: 85, max: 87, weight: 55 },
  { min: 88, max: 90, weight: 25 },
  { min: 91, max: 93, weight: 12 },
  { min: 94, max: 96, weight: 6 },
  { min: 97, max: 99, weight: 2 },
];

export type DraftScriptKind = 'star' | 'floor';

export function overallOf(candidate: SeasonDraftCandidate): number {
  return candidate.summaryRatings.overallRating;
}

export function isStarCandidate(candidate: SeasonDraftCandidate): boolean {
  return overallOf(candidate) >= SEASON_DRAFT_SCRIPT_STAR_MIN_OVERALL;
}

export function isFloorCandidate(candidate: SeasonDraftCandidate): boolean {
  return overallOf(candidate) <= SEASON_DRAFT_SCRIPT_FLOOR_MAX_OVERALL;
}

export function starTierWeight(overall: number): number {
  for (const tier of DRAFT_SCRIPT_STAR_TIER_WEIGHTS) {
    if (overall >= tier.min && overall <= tier.max) return tier.weight;
  }
  return 0;
}

export function scriptedSlotsFor(
  rootSeed: string,
  participantId: string,
): { stars: Set<number>; floors: Set<number> } {
  const rng = createRng(seasonNamespaceSeed(rootSeed, 'draft', 'script', participantId));
  const ordinals = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], rng);
  const stars = new Set(ordinals.slice(0, SEASON_DRAFT_SCRIPT_STAR_COUNT).sort((a, b) => a - b));
  const floors = new Set(
    ordinals
      .slice(
        SEASON_DRAFT_SCRIPT_STAR_COUNT,
        SEASON_DRAFT_SCRIPT_STAR_COUNT + SEASON_DRAFT_SCRIPT_FLOOR_COUNT,
      )
      .sort((a, b) => a - b),
  );
  return { stars, floors };
}

export function scriptKindFor(
  rootSeed: string,
  participantId: string,
  pickOrdinal: number,
): DraftScriptKind | null {
  const slots = scriptedSlotsFor(rootSeed, participantId);
  if (slots.stars.has(pickOrdinal)) return 'star';
  if (slots.floors.has(pickOrdinal)) return 'floor';
  return null;
}

export function chooseStarCandidate(
  eligible: readonly SeasonDraftCandidate[],
  seed: string,
): SeasonDraftCandidate {
  const rng = createRng(seed);
  const weights = eligible.map((candidate) => starTierWeight(overallOf(candidate)));
  return rng.weightedPick(eligible, weights);
}

export function chooseFloorCandidate(
  eligible: readonly SeasonDraftCandidate[],
  seed: string,
): SeasonDraftCandidate {
  return createRng(seed).pick(eligible);
}
