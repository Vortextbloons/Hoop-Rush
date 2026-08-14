import type { SimulationPlayer } from '@hoop-rush/data-contracts';

export type Archetype =
  'primaryCreator' | 'secondaryCreator' | 'floorSpacer' | 'rimRunner' | 'postAnchor' | 'glue';

export function creationScore(player: SimulationPlayer): number {
  const r = player.ratings;
  return (r.ballHandling * 0.4 + r.passing * 0.35 + r.offensiveIq * 0.25) / 100;
}

export function spacingScore(player: SimulationPlayer): number {
  const skill = player.ratings.threePoint / 100;
  const volume = player.tendencies.threePointRate / 100;
  return skill * 0.6 + volume * 0.4;
}

export function interiorScoringScore(player: SimulationPlayer): number {
  const r = player.ratings;
  return (r.insideScoring * 0.5 + r.closeShot * 0.3 + r.vertical * 0.2) / 100;
}

export function classifyArchetype(player: SimulationPlayer): Archetype {
  const t = player.tendencies;
  if (t.usageRate >= 28 && creationScore(player) >= 0.6) return 'primaryCreator';
  if (t.usageRate >= 21) return 'secondaryCreator';
  if (t.threePointRate >= 25 && spacingScore(player) >= 0.55) return 'floorSpacer';
  if (t.rimFrequency >= 40 && interiorScoringScore(player) >= 0.55) return 'rimRunner';
  if (t.postUpRate >= 15) return 'postAnchor';
  return 'glue';
}
