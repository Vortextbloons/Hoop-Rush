import type {
  ProjectionMatchupArchetype,
  ProjectionModelArtifact,
  ProjectionReferenceFive,
} from '@hoop-rush/data-contracts';

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
