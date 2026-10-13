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

// Documented field -> authoritative channel map. Written fields disable the
// historical blend for that channel only; unmapped fields keep ordinary evidence.
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

export function applyHavocMutationPackage(
  source: HavocSourcePlayer,
  mutationPackage: HavocMutationPackage,
  options: ApplyHavocMutationOptions = {},
): HavocEffectiveProfile {
  const ratingAdds = new Map<HavocRatingField, number>();
  const ratingFloors = new Map<HavocRatingField, number>();
  const ratingCaps = new Map<HavocRatingField, number>();
  const tendencyAdds = new Map<HavocTendencyField, number>();
  const tendencyFloors = new Map<HavocTendencyField, number>();
  const tendencyCaps = new Map<HavocTendencyField, number>();
  const channels = new Set<HavocAuthoritativeChannel>();

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
      }
    }
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
    let value = ratings[field] + (ratingAdds.get(field) ?? 0);
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
