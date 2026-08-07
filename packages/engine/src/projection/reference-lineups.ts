import type {
  ProjectionMatchupArchetype,
  ProjectionModelArtifact,
  ProjectionReferenceFive,
} from '@hoop-rush/data-contracts';

/**
 * Reference-lineup resolution (projection milestone). The base projector
 * always plays against a versioned synthetic reference from the frozen
 * model artifact: the neutral reference for the era by default, or a named
 * matchup archetype reference for robustness evaluation. References are
 * population aggregates with no player-specific bonuses, identity
 * modifiers, or exceptions.
 */

/** The neutral reference for an era (the default base-projector opponent). */
export function neutralReference(
  model: ProjectionModelArtifact,
  eraId: string,
): ProjectionReferenceFive {
  const set = model.references[eraId];
  if (set === undefined) {
    throw new Error(`projection: no reference set for era ${eraId}`);
  }
  return set.neutral;
}

/** A named matchup archetype reference for an era (all except neutral). */
export function archetypeReference(
  model: ProjectionModelArtifact,
  eraId: string,
  archetype: Exclude<ProjectionMatchupArchetype, 'neutral'>,
): ProjectionReferenceFive {
  const set = model.references[eraId];
  if (set === undefined) {
    throw new Error(`projection: no reference set for era ${eraId}`);
  }
  const found = set.archetypes.find((reference) => reference.archetype === archetype);
  if (found === undefined) {
    throw new Error(`projection: no ${archetype} archetype reference for era ${eraId}`);
  }
  return found;
}

/** All matchup references for an era (perimeter, interior, pressure, size-switch). */
export function archetypeReferences(
  model: ProjectionModelArtifact,
  eraId: string,
): ProjectionReferenceFive[] {
  const set = model.references[eraId];
  if (set === undefined) {
    throw new Error(`projection: no reference set for era ${eraId}`);
  }
  return set.archetypes;
}

/** Resolves a reference by id when given, else the era's neutral reference. */
export function resolveReference(
  model: ProjectionModelArtifact,
  eraId: string,
  referenceId?: string,
): ProjectionReferenceFive {
  if (referenceId === undefined) return neutralReference(model, eraId);
  const set = model.references[eraId];
  if (set !== undefined && set.neutral.referenceId === referenceId) return set.neutral;
  const found = set?.archetypes.find((reference) => reference.referenceId === referenceId);
  if (found === undefined) {
    throw new Error(`projection: unknown reference ${referenceId} for era ${eraId}`);
  }
  return found;
}
