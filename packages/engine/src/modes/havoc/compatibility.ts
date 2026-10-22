import type {
  HavocMutationDefinition,
  HavocMutationId,
  HavocProfileOperation,
  HavocSpecialistCategory,
  HavocTier,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_SPECIALIST_CATEGORY_IDS,
  HAVOC_SPECIALIST_CATEGORY_RATINGS,
} from '@hoop-rush/data-contracts';

export interface HavocCompatibleBundle {
  readonly tier: HavocTier;
  readonly mutationIds: readonly HavocMutationId[];
  readonly specialistCategories?: readonly HavocSpecialistCategory[];
}

type FloorOperation = Extract<
  HavocProfileOperation,
  { op: 'raise-rating' } | { op: 'raise-tendency' }
>;
type CapOperation = Extract<HavocProfileOperation, { op: 'cap-rating' } | { op: 'cap-tendency' }>;
type SetOperation = Extract<HavocProfileOperation, { op: 'set-rating' }>;

function isFloorOperation(operation: HavocProfileOperation): operation is FloorOperation {
  return operation.op === 'raise-rating' || operation.op === 'raise-tendency';
}

function isCapOperation(operation: HavocProfileOperation): operation is CapOperation {
  return operation.op === 'cap-rating' || operation.op === 'cap-tendency';
}

function isSetOperation(operation: HavocProfileOperation): operation is SetOperation {
  return operation.op === 'set-rating';
}

function isHeightOperation(
  operation: HavocProfileOperation,
): operation is Extract<
  HavocProfileOperation,
  { op: 'height-add' } | { op: 'height-set' } | { op: 'height-subtract' }
> {
  return (
    operation.op === 'height-add' ||
    operation.op === 'height-set' ||
    operation.op === 'height-subtract'
  );
}

function operationField(operation: HavocProfileOperation): string | null {
  switch (operation.op) {
    case 'raise-rating':
    case 'cap-rating':
    case 'add-rating':
    case 'set-rating':
      return `rating:${operation.field}`;
    case 'raise-tendency':
    case 'cap-tendency':
    case 'add-tendency':
      return `tendency:${operation.field}`;
    default:
      return null;
  }
}

export function havocOperationsConflict(
  left: HavocProfileOperation,
  right: HavocProfileOperation,
): boolean {
  if (isHeightOperation(left) && isHeightOperation(right)) {
    if (left.op === 'height-set' || right.op === 'height-set') return true;
    return left.op !== right.op;
  }
  const leftField = operationField(left);
  const rightField = operationField(right);
  if (leftField === null || rightField === null || leftField !== rightField) return false;
  if (isFloorOperation(left) && isCapOperation(right) && right.value < left.value) return true;
  if (isCapOperation(left) && isFloorOperation(right) && left.value < right.value) return true;
  if (isFloorOperation(left) && isSetOperation(right) && right.value < left.value) return true;
  if (isSetOperation(left) && isFloorOperation(right) && left.value < right.value) return true;
  if (isCapOperation(left) && isSetOperation(right) && right.value > left.value) return true;
  if (isSetOperation(left) && isCapOperation(right) && left.value > right.value) return true;
  return false;
}

export function havocDefinitionsConflict(
  left: HavocMutationDefinition,
  right: HavocMutationDefinition,
): boolean {
  for (const leftOperation of left.operations) {
    for (const rightOperation of right.operations) {
      if (havocOperationsConflict(leftOperation, rightOperation)) return true;
    }
  }
  return false;
}

function compareMutationIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalDefinitionsByTier(
  definitions: readonly HavocMutationDefinition[],
  tier: HavocTier,
): readonly HavocMutationDefinition[] {
  const seen = new Set<string>();
  const canonical: HavocMutationDefinition[] = [];
  for (const definition of definitions) {
    if (definition.tier !== tier || seen.has(definition.mutationId)) continue;
    seen.add(definition.mutationId);
    canonical.push(definition);
  }
  canonical.sort((left, right) => compareMutationIds(left.mutationId, right.mutationId));
  return canonical;
}

function partnerOperationsAllowCategory(
  operations: readonly HavocProfileOperation[],
  category: HavocSpecialistCategory,
): boolean {
  const specialistFields = new Set<string>(HAVOC_SPECIALIST_CATEGORY_RATINGS[category]);
  for (const operation of operations) {
    switch (operation.op) {
      case 'cap-rating': {
        if (specialistFields.has(operation.field) && operation.value < 99) return false;
        break;
      }
      case 'set-rating': {
        if (specialistFields.has(operation.field) && operation.value !== 99) return false;
        break;
      }
      default:
        break;
    }
  }
  return true;
}

export function havocBundleSpecialistCategories(
  bundle: HavocCompatibleBundle,
  definitions: readonly HavocMutationDefinition[],
): readonly HavocSpecialistCategory[] {
  if (!bundle.mutationIds.includes('the-specialist')) return HAVOC_SPECIALIST_CATEGORY_IDS;
  const byId = new Map(definitions.map((definition) => [definition.mutationId, definition]));
  const partnerOperations = bundle.mutationIds
    .filter((mutationId) => mutationId !== 'the-specialist')
    .map((mutationId) => byId.get(mutationId))
    .filter((definition): definition is HavocMutationDefinition => definition !== undefined)
    .flatMap((definition) => definition.operations);
  return HAVOC_SPECIALIST_CATEGORY_IDS.filter((category) =>
    partnerOperationsAllowCategory(partnerOperations, category),
  );
}

export function enumerateHavocBundles(
  definitions: readonly HavocMutationDefinition[],
  tier: HavocTier,
): readonly HavocCompatibleBundle[] {
  const tierPool = canonicalDefinitionsByTier(definitions, tier);
  if (tier === 3) {
    return tierPool.map((definition) => ({ tier, mutationIds: [definition.mutationId] }));
  }
  if (tier === 2) {
    const tierOnePool = canonicalDefinitionsByTier(definitions, 1);
    const bundles: HavocCompatibleBundle[] = [];
    for (const tierTwo of tierPool) {
      for (const tierOne of tierOnePool) {
        if (havocDefinitionsConflict(tierTwo, tierOne)) continue;
        const bundle: HavocCompatibleBundle = {
          tier,
          mutationIds: [tierTwo.mutationId, tierOne.mutationId],
        };
        const categories = havocBundleSpecialistCategories(bundle, definitions);
        if (categories.length === 0) continue;
        bundles.push({ ...bundle, specialistCategories: categories });
      }
    }
    return bundles;
  }
  const bundles: HavocCompatibleBundle[] = [];
  for (let first = 0; first < tierPool.length; first += 1) {
    for (let second = first + 1; second < tierPool.length; second += 1) {
      for (let third = second + 1; third < tierPool.length; third += 1) {
        const left = tierPool[first];
        const middle = tierPool[second];
        const right = tierPool[third];
        if (left === undefined || middle === undefined || right === undefined) continue;
        if (havocDefinitionsConflict(left, middle)) continue;
        if (havocDefinitionsConflict(left, right)) continue;
        if (havocDefinitionsConflict(middle, right)) continue;
        const bundle: HavocCompatibleBundle = {
          tier,
          mutationIds: [left.mutationId, middle.mutationId, right.mutationId],
        };
        const categories = havocBundleSpecialistCategories(bundle, definitions);
        if (categories.length === 0) continue;
        bundles.push({ ...bundle, specialistCategories: categories });
      }
    }
  }
  return bundles;
}

export function havocBundleIsCompatible(
  bundle: HavocCompatibleBundle,
  definitions: readonly HavocMutationDefinition[],
): boolean {
  const byId = new Map(definitions.map((definition) => [definition.mutationId, definition]));
  const resolved: HavocMutationDefinition[] = [];
  for (const mutationId of bundle.mutationIds) {
    const definition = byId.get(mutationId);
    if (definition === undefined) return false;
    resolved.push(definition);
  }
  if (bundle.tier === 1) {
    if (resolved.length !== 3) return false;
    if (resolved.some((definition) => definition.tier !== 1)) return false;
  } else if (bundle.tier === 2) {
    if (resolved.length !== 2) return false;
    const tierTwoCount = resolved.filter((definition) => definition.tier === 2).length;
    if (tierTwoCount !== 1) return false;
  } else {
    if (resolved.length !== 1) return false;
    if (resolved[0]?.tier !== 3) return false;
  }
  for (let first = 0; first < resolved.length; first += 1) {
    for (let second = first + 1; second < resolved.length; second += 1) {
      const left = resolved[first];
      const right = resolved[second];
      if (left === undefined || right === undefined) return false;
      if (havocDefinitionsConflict(left, right)) return false;
    }
  }
  if (havocBundleSpecialistCategories(bundle, definitions).length === 0) return false;
  return true;
}
