import type {
  HavocAuthoritativeChannel,
  HavocEffectiveProfile,
  HavocMutationPackage,
  HavocRatingField,
  HavocSourcePlayer,
  HavocTendencyField,
  Position,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_SPECIALIST_CATEGORY_RATINGS,
  HAVOC_SPECIALIST_CATEGORY_TENDENCIES,
  HAVOC_TENDENCY_FIELDS,
  REQUIRED_RATING_KEYS,
  havocEffectiveProfileSchema,
} from '@hoop-rush/data-contracts';
import { havocMutationDefinitionOf } from './mutations.ts';
import {
  clampHavocEffectiveHeight,
  clampHavocWingspanDelta,
  havocBaselineHeightInches,
  havocReachUnits,
} from './physical.ts';

export interface ApplyHavocMutationOptions {
  readonly baselineHeightInches?: number;
  readonly slot?: Position;
}

const RATING_CHANNELS: Partial<Record<HavocRatingField, HavocAuthoritativeChannel>> = {
  insideScoring: 'two-point-accuracy',
  closeShot: 'two-point-accuracy',
  midrange: 'two-point-accuracy',
  threePoint: 'three-point-accuracy',
  freeThrow: 'free-throw-accuracy',
  passing: 'assist-anchor',
  block: 'block-anchor',
  offensiveRebound: 'rebound-weights',
  defensiveRebound: 'rebound-weights',
};

const TENDENCY_CHANNELS: Partial<Record<HavocTendencyField, HavocAuthoritativeChannel>> = {
  usageRate: 'offensive-allocation',
  shotRate: 'offensive-allocation',
  threePointRate: 'three-point-volume',
  cornerThreeFrequency: 'three-point-volume',
  aboveBreakThreeFrequency: 'three-point-volume',
  passRate: 'assist-anchor',
  blockAttemptRate: 'block-anchor',
  crashOffensiveGlassRate: 'rebound-weights',
  turnoverRate: 'turnover-blend',
};

const AUTHORITATIVE_CHANNEL_ORDER: readonly HavocAuthoritativeChannel[] = [
  'two-point-accuracy',
  'three-point-accuracy',
  'three-point-volume',
  'free-throw-accuracy',
  'block-anchor',
  'assist-anchor',
  'rebound-weights',
  'turnover-blend',
  'offensive-allocation',
];

const RATING_KEY_ORDER: ReadonlyMap<HavocRatingField, number> = new Map(
  REQUIRED_RATING_KEYS.map((field, index) => [field, index]),
);

function extremeRatingShifts(
  ratings: HavocSourcePlayer['profile']['ratings'],
  count: number,
  bestDelta: number,
  worstDelta: number,
): Map<HavocRatingField, number> {
  const byKeyOrder = (a: HavocRatingField, b: HavocRatingField): number =>
    (RATING_KEY_ORDER.get(a) ?? 0) - (RATING_KEY_ORDER.get(b) ?? 0);
  const strongestFirst = [...REQUIRED_RATING_KEYS].sort(
    (a, b) => ratings[b] - ratings[a] || byKeyOrder(a, b),
  );
  const weakestFirst = [...REQUIRED_RATING_KEYS].sort(
    (a, b) => ratings[a] - ratings[b] || byKeyOrder(a, b),
  );
  const shifts = new Map<HavocRatingField, number>();
  for (let index = 0; index < count; index += 1) {
    const strong = strongestFirst[index];
    const weak = weakestFirst[index];
    if (strong === undefined || weak === undefined || strong === weak) break;
    shifts.set(strong, bestDelta);
    shifts.set(weak, worstDelta);
  }
  return shifts;
}

export function applyHavocMutationPackage(
  source: HavocSourcePlayer,
  mutationPackage: HavocMutationPackage,
  options: ApplyHavocMutationOptions = {},
): HavocEffectiveProfile {
  const ratingAdds = new Map<HavocRatingField, number>();
  const ratingSets = new Map<HavocRatingField, number>();
  const ratingFloors = new Map<HavocRatingField, number>();
  const ratingCaps = new Map<HavocRatingField, number>();
  const tendencyAdds = new Map<HavocTendencyField, number>();
  const tendencyFloors = new Map<HavocTendencyField, number>();
  const tendencyCaps = new Map<HavocTendencyField, number>();
  const channels = new Set<HavocAuthoritativeChannel>();

  let extremeShift: { count: number; bestDelta: number; worstDelta: number } | null = null;
  let heightAddInches = 0;
  let heightSetInches: number | null = null;
  let heightSubtractInches = 0;
  let wingspanDeltaInches = 0;

  for (const entry of mutationPackage) {
    const definition = havocMutationDefinitionOf(entry.mutationId);
    for (const operation of definition.operations) {
      switch (operation.op) {
        case 'raise-rating': {
          ratingFloors.set(
            operation.field,
            Math.max(ratingFloors.get(operation.field) ?? 0, operation.value),
          );
          const channel = RATING_CHANNELS[operation.field];
          if (channel !== undefined) channels.add(channel);
          break;
        }
        case 'cap-rating': {
          ratingCaps.set(
            operation.field,
            Math.min(ratingCaps.get(operation.field) ?? 100, operation.value),
          );
          const channel = RATING_CHANNELS[operation.field];
          if (channel !== undefined) channels.add(channel);
          break;
        }
        case 'add-rating': {
          ratingAdds.set(operation.field, (ratingAdds.get(operation.field) ?? 0) + operation.value);
          const channel = RATING_CHANNELS[operation.field];
          if (channel !== undefined) channels.add(channel);
          break;
        }
        case 'raise-tendency': {
          tendencyFloors.set(
            operation.field,
            Math.max(tendencyFloors.get(operation.field) ?? 0, operation.value),
          );
          const channel = TENDENCY_CHANNELS[operation.field];
          if (channel !== undefined) channels.add(channel);
          break;
        }
        case 'cap-tendency': {
          tendencyCaps.set(
            operation.field,
            Math.min(tendencyCaps.get(operation.field) ?? 100, operation.value),
          );
          const channel = TENDENCY_CHANNELS[operation.field];
          if (channel !== undefined) channels.add(channel);
          break;
        }
        case 'add-tendency': {
          tendencyAdds.set(
            operation.field,
            (tendencyAdds.get(operation.field) ?? 0) + operation.value,
          );
          const channel = TENDENCY_CHANNELS[operation.field];
          if (channel !== undefined) channels.add(channel);
          break;
        }
        case 'height-add': {
          heightAddInches += entry.sampledHeightDelta ?? operation.minInches;
          break;
        }
        case 'height-set': {
          heightSetInches = operation.inches;
          break;
        }
        case 'height-subtract': {
          heightSubtractInches += operation.inches;
          break;
        }
        case 'reach-add': {
          wingspanDeltaInches += operation.inches;
          break;
        }
        case 'set-rating': {
          ratingSets.set(operation.field, operation.value);
          const channel = RATING_CHANNELS[operation.field];
          if (channel !== undefined) channels.add(channel);
          break;
        }
        case 'shift-extreme-ratings': {
          extremeShift = {
            count: operation.count,
            bestDelta: operation.bestDelta,
            worstDelta: operation.worstDelta,
          };
          break;
        }
        case 'set-category-ratings': {
          const category = entry.specialistCategory;
          if (category === undefined) {
            throw new Error(`mutation ${entry.mutationId} requires a sampled specialist category`);
          }
          for (const field of HAVOC_SPECIALIST_CATEGORY_RATINGS[category]) {
            ratingSets.set(field, operation.value);
            const channel = RATING_CHANNELS[field];
            if (channel !== undefined) channels.add(channel);
          }
          break;
        }
        case 'add-outside-category-ratings': {
          const category = entry.specialistCategory;
          if (category === undefined) {
            throw new Error(`mutation ${entry.mutationId} requires a sampled specialist category`);
          }
          const specialistFields = new Set(HAVOC_SPECIALIST_CATEGORY_RATINGS[category]);
          for (const field of REQUIRED_RATING_KEYS) {
            if (specialistFields.has(field)) continue;
            ratingAdds.set(field, (ratingAdds.get(field) ?? 0) + operation.value);
            const channel = RATING_CHANNELS[field];
            if (channel !== undefined) channels.add(channel);
          }
          break;
        }
        case 'add-category-tendencies': {
          const category = entry.specialistCategory;
          if (category === undefined) {
            throw new Error(`mutation ${entry.mutationId} requires a sampled specialist category`);
          }
          for (const field of HAVOC_SPECIALIST_CATEGORY_TENDENCIES[category]) {
            tendencyAdds.set(field, (tendencyAdds.get(field) ?? 0) + operation.value);
            const channel = TENDENCY_CHANNELS[field];
            if (channel !== undefined) channels.add(channel);
          }
          break;
        }
      }
    }
  }

  const ratingExtremeShifts =
    extremeShift === null
      ? new Map<HavocRatingField, number>()
      : extremeRatingShifts(
          source.profile.ratings,
          extremeShift.count,
          extremeShift.bestDelta,
          extremeShift.worstDelta,
        );
  for (const field of ratingExtremeShifts.keys()) {
    const channel = RATING_CHANNELS[field];
    if (channel !== undefined) channels.add(channel);
  }

  const baseline =
    source.physical.heightInches !== null
      ? {
          baselineHeightInches: source.physical.heightInches,
          baselineHeightSource: 'source' as const,
        }
      : options.baselineHeightInches !== undefined
        ? {
            baselineHeightInches: options.baselineHeightInches,
            baselineHeightSource: 'estimated' as const,
          }
        : options.slot !== undefined
          ? havocBaselineHeightInches(source.physical, options.slot)
          : null;
  if (baseline === null) {
    throw new Error(
      'havoc transform requires a source height, a baseline height, or a draft slot for the height estimate',
    );
  }

  const heightInches = clampHavocEffectiveHeight(
    heightSetInches ?? baseline.baselineHeightInches + heightAddInches - heightSubtractInches,
  );
  const effectiveWingspanDelta = clampHavocWingspanDelta(wingspanDeltaInches);
  const reachUnits = havocReachUnits(
    heightInches - baseline.baselineHeightInches,
    effectiveWingspanDelta,
  );

  const ratings = { ...source.profile.ratings };
  for (const field of REQUIRED_RATING_KEYS) {
    const set = ratingSets.get(field);
    let value = set !== undefined ? set : ratings[field];
    value += (ratingAdds.get(field) ?? 0) + (ratingExtremeShifts.get(field) ?? 0);
    const floor = ratingFloors.get(field);
    if (floor !== undefined) value = Math.max(value, floor);
    const cap = ratingCaps.get(field);
    if (cap !== undefined) value = Math.min(value, cap);
    ratings[field] = Math.max(0, Math.min(100, Math.trunc(value)));
  }

  const tendencies = { ...source.profile.tendencies };
  for (const field of HAVOC_TENDENCY_FIELDS) {
    let value = tendencies[field] + (tendencyAdds.get(field) ?? 0);
    const floor = tendencyFloors.get(field);
    if (floor !== undefined) value = Math.max(value, floor);
    const cap = tendencyCaps.get(field);
    if (cap !== undefined) value = Math.min(value, cap);
    tendencies[field] = Math.max(0, Math.min(100, value));
  }

  return havocEffectiveProfileSchema.parse({
    ratings,
    tendencies,
    physical: {
      baselineHeightInches: baseline.baselineHeightInches,
      baselineHeightSource: baseline.baselineHeightSource,
      heightInches,
      weightLbs: source.physical.weightLbs,
      wingspanDeltaInches: effectiveWingspanDelta,
      reachUnits,
    },
    authoritativeChannels: AUTHORITATIVE_CHANNEL_ORDER.filter((channel) => channels.has(channel)),
  });
}
