import type { SimulationPlayer } from '@hoop-rush/data-contracts';

/**
 * Role/archetype derivation for possession resolution (spec/03 player and
 * lineup effects). Archetypes are deterministic functions of the frozen
 * SimulationPlayer fields — no RNG, no build-time noise, no summary Overall.
 * They modulate usage weights, spot-up targets, assist share, and roll-man
 * finishing so role hierarchies emerge from creation, shot profile, and
 * offensive skill instead of a single usage tendency.
 *
 * The classification is deliberately coarse: it exists to shape *weights*,
 * never to gate outcomes, and every modulation is bounded so no archetype is
 * dispositive.
 */

export type Archetype =
  'primaryCreator' | 'secondaryCreator' | 'floorSpacer' | 'rimRunner' | 'postAnchor' | 'glue';

export const ARCHETYPE_NAMES: readonly Archetype[] = [
  'primaryCreator',
  'secondaryCreator',
  'floorSpacer',
  'rimRunner',
  'postAnchor',
  'glue',
];

/** Creation ability (0..1): handling, passing, and offensive IQ. */
export function creationScore(player: SimulationPlayer): number {
  const r = player.ratings;
  return (r.ballHandling * 0.4 + r.passing * 0.35 + r.offensiveIq * 0.25) / 100;
}

/** Spacing ability (0..1): three-point skill blended with three-point volume. */
export function spacingScore(player: SimulationPlayer): number {
  const skill = player.ratings.threePoint / 100;
  const volume = player.tendencies.threePointRate / 100;
  return skill * 0.6 + volume * 0.4;
}

/** Interior finishing presence (0..1): inside scoring, close shot, vertical. */
export function interiorScoringScore(player: SimulationPlayer): number {
  const r = player.ratings;
  return (r.insideScoring * 0.5 + r.closeShot * 0.3 + r.vertical * 0.2) / 100;
}

/** Coarse role label from usage, creation, and shot-profile tendencies. */
export function classifyArchetype(player: SimulationPlayer): Archetype {
  const t = player.tendencies;
  if (t.usageRate >= 28 && creationScore(player) >= 0.6) return 'primaryCreator';
  if (t.usageRate >= 21) return 'secondaryCreator';
  if (t.threePointRate >= 25 && spacingScore(player) >= 0.55) return 'floorSpacer';
  if (t.rimFrequency >= 40 && interiorScoringScore(player) >= 0.55) return 'rimRunner';
  if (t.postUpRate >= 15) return 'postAnchor';
  return 'glue';
}
