import type {
  SimulationAnchors,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';

export type RatingKey = keyof SimulationRatings;
export type TendencyKey = keyof SimulationTendencies;

/** Short row labels: the profile column is narrow, so these stay terse. */
export const PROFILE_RATING_LABELS: Readonly<Record<RatingKey, string>> = {
  insideScoring: 'Inside',
  closeShot: 'Close',
  midrange: 'Midrange',
  threePoint: 'Three',
  freeThrow: 'Free throw',
  ballHandling: 'Handle',
  passing: 'Passing',
  offensiveIq: 'Off. IQ',
  offensiveRebound: 'Off. reb',
  defensiveRebound: 'Def. reb',
  perimeterDefense: 'Perimeter',
  interiorDefense: 'Interior',
  steal: 'Steal',
  block: 'Block',
  defensiveIq: 'Def. IQ',
  speed: 'Speed',
  strength: 'Strength',
  vertical: 'Vertical',
};

export const PROFILE_RATING_KEYS = Object.keys(PROFILE_RATING_LABELS) as readonly RatingKey[];

export interface ProfileRatingGroup {
  readonly title: string;
  readonly keys: readonly RatingKey[];
}

export const PROFILE_RATING_GROUPS: readonly ProfileRatingGroup[] = [
  { title: 'Scoring', keys: ['insideScoring', 'closeShot', 'midrange', 'threePoint', 'freeThrow'] },
  { title: 'Playmaking', keys: ['ballHandling', 'passing', 'offensiveIq'] },
  {
    title: 'Defense',
    keys: ['perimeterDefense', 'steal', 'interiorDefense', 'block', 'defensiveIq'],
  },
  {
    title: 'Physical & glass',
    keys: ['speed', 'strength', 'vertical', 'offensiveRebound', 'defensiveRebound'],
  },
];

export const SHOT_ZONE_LABELS = [
  'Rim',
  'Short mid',
  'Long mid',
  'Corner 3',
  'Above break',
] as const;

const SHOT_ZONE_KEYS: readonly TendencyKey[] = [
  'rimFrequency',
  'shortMidFrequency',
  'longMidFrequency',
  'cornerThreeFrequency',
  'aboveBreakThreeFrequency',
];

export const ACTION_LABELS: readonly (readonly [TendencyKey, string])[] = [
  ['pickAndRollBallHandlerRate', 'PnR ball handler'],
  ['pickAndRollRollManRate', 'Roll man'],
  ['postUpRate', 'Post-up'],
  ['spotUpRate', 'Spot-up'],
  ['isolationRate', 'Isolation'],
  ['cutRate', 'Cut'],
  ['transitionRate', 'Transition'],
];

const COHORT_NOUNS: Readonly<Record<string, string>> = {
  PG: 'point guards',
  SG: 'shooting guards',
  SF: 'small forwards',
  PF: 'power forwards',
  C: 'centers',
};

export interface ProfileSample {
  readonly positions: readonly string[];
  readonly ratings: Readonly<SimulationRatings>;
  readonly tendencies: Readonly<SimulationTendencies>;
}

export interface PlayerProfileReference {
  readonly cohortLabel: string;
  readonly sampleSize: number;
  /** Share of the cohort below the value, in 0..1. */
  rating(key: RatingKey, value: number): number;
  tendency(key: TendencyKey, value: number): number;
}

export interface PlayerProfileReferences {
  /** Percentile lookup for one draft slot, or null when the pool is too small. */
  forSlot(slot: string): PlayerProfileReference | null;
}

const MINIMUM_COHORT_SIZE = 20;

function sortedRanks(values: readonly number[]): readonly number[] {
  return [...values].sort((left, right) => left - right);
}

function rankIn(sorted: readonly number[], value: number): number {
  if (sorted.length === 0) return 0;
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const entry = sorted[middle];
    if (entry !== undefined && entry < value) low = middle + 1;
    else high = middle;
  }
  let equal = 0;
  while (sorted[low + equal] === value) equal += 1;
  return (low + equal / 2) / sorted.length;
}

/**
 * Percentile lookups per draft slot, built once from any set of player samples.
 * Each mode supplies its own sample list, so the comparison group always
 * matches the pool the player came from.
 */
export function buildPlayerProfileReferences(
  samples: readonly ProfileSample[],
): PlayerProfileReferences {
  const cache = new Map<string, PlayerProfileReference | null>();
  return {
    forSlot(slot: string): PlayerProfileReference | null {
      const cached = cache.get(slot);
      if (cached !== undefined) return cached;
      const cohort = samples.filter((sample) => sample.positions.includes(slot));
      const built =
        cohort.length < MINIMUM_COHORT_SIZE
          ? null
          : buildReference(cohort, COHORT_NOUNS[slot] ?? slot.toLowerCase());
      cache.set(slot, built);
      return built;
    },
  };
}

function buildReference(
  cohort: readonly ProfileSample[],
  cohortLabel: string,
): PlayerProfileReference {
  const ratings = new Map<RatingKey, readonly number[]>();
  for (const key of PROFILE_RATING_KEYS) {
    ratings.set(key, sortedRanks(cohort.map((sample) => sample.ratings[key])));
  }
  const tendencies = new Map<TendencyKey, readonly number[]>();
  for (const key of Object.keys(cohort[0]?.tendencies ?? {}) as TendencyKey[]) {
    tendencies.set(key, sortedRanks(cohort.map((sample) => sample.tendencies[key])));
  }
  return {
    cohortLabel,
    sampleSize: cohort.length,
    rating(key, value) {
      const sorted = ratings.get(key);
      return sorted === undefined ? 0 : rankIn(sorted, value);
    },
    tendency(key, value) {
      const sorted = tendencies.get(key);
      return sorted === undefined ? 0 : rankIn(sorted, value);
    },
  };
}

export interface PlayerProfileTrait {
  /** Row label, e.g. "Perimeter pickpocket". */
  readonly label: string;
  /**
   * Lowercase noun phrase for prose, e.g. "steals". Each phrase is used in at
   * most one sentence, so no two traits should read the same way.
   */
  readonly phrase: string;
  /** 0..1 strength of the signal that fired the trait. */
  readonly percentile: number;
}

export interface PlayerProfileRatingRow {
  readonly label: string;
  readonly value: number;
  readonly percentile: number;
}

export interface PlayerProfileShare {
  readonly label: string;
  /** 0..1 of the group total. */
  readonly share: number;
}

export interface PlayerProfileInput {
  readonly displayName: string;
  readonly franchiseLabel: string | null;
  readonly seasonKey: string | null;
  readonly positions: readonly string[];
  readonly heightInches: number | null;
  readonly weightLbs: number | null;
  readonly overall: number;
  readonly offense: number | null;
  readonly defense: number | null;
  readonly ratings: Readonly<SimulationRatings>;
  readonly tendencies: Readonly<SimulationTendencies>;
  readonly anchors?: Readonly<SimulationAnchors> | null;
  /** Slot whose cohort the percentiles came from. */
  readonly slot: string | null;
}

export interface PlayerProfileWorkload {
  readonly minutes: number | null;
  readonly shotAttempts: number | null;
  readonly usage: number;
  readonly usagePercentile: number;
}

export interface PlayerProfileRatingGroup {
  readonly title: string;
  readonly rows: readonly PlayerProfileRatingRow[];
}

export interface PlayerProfileView {
  readonly displayName: string;
  readonly initials: string;
  readonly franchiseLabel: string | null;
  readonly seasonKey: string | null;
  readonly positionsLabel: string;
  readonly heightLabel: string | null;
  readonly weightLabel: string | null;
  readonly overall: number;
  readonly offense: number | null;
  readonly defense: number | null;
  readonly archetype: string;
  readonly summary: string;
  readonly strengths: readonly PlayerProfileTrait[];
  readonly weaknesses: readonly PlayerProfileTrait[];
  readonly workload: PlayerProfileWorkload | null;
  readonly shotDiet: readonly PlayerProfileShare[] | null;
  readonly actions: readonly PlayerProfileShare[] | null;
  readonly habits: readonly PlayerProfileTrait[];
  readonly ratingGroups: readonly PlayerProfileRatingGroup[];
  readonly cohort: { readonly label: string; readonly size: number } | null;
}

export function profileInitials(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  const first = parts[0];
  if (first === undefined) return '?';
  const last = parts[parts.length - 1];
  if (parts.length === 1 || last === undefined) return first.slice(0, 2).toUpperCase();
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

function heightLabel(heightInches: number | null): string | null {
  if (heightInches === null) return null;
  return `${String(Math.floor(heightInches / 12))}'${String(heightInches % 12)}"`;
}

function weightLabel(weightLbs: number | null): string | null {
  return weightLbs === null ? null : `${String(weightLbs)} lbs`;
}

function positionsLabel(positions: readonly string[]): string {
  return positions.length === 0 ? '\u2014' : positions.slice(0, 2).join('/');
}

interface TraitContext {
  readonly ratings: Readonly<SimulationRatings>;
  readonly tendencies: Readonly<SimulationTendencies>;
  rating(key: RatingKey): number;
  tendency(key: TendencyKey): number;
}

interface TraitRule {
  readonly label: string;
  readonly phrase: string;
  /** Keys whose strongest percentile sets the row's bar. */
  readonly signal: {
    readonly ratings?: readonly RatingKey[];
    readonly tendencies?: readonly TendencyKey[];
  };
  readonly test: (context: TraitContext) => boolean;
}

const STRENGTH_RULES: readonly TraitRule[] = [
  {
    label: 'Perimeter pickpocket',
    phrase: 'steals',
    signal: { ratings: ['steal'], tendencies: ['stealAttemptRate'] },
    test: (c) => c.rating('steal') >= 0.85 && c.tendency('stealAttemptRate') >= 0.65,
  },
  {
    label: 'Table-setting passer',
    phrase: 'passing',
    signal: { ratings: ['passing'] },
    test: (c) => c.rating('passing') >= 0.85 && c.tendency('passRate') >= 0.55,
  },
  {
    label: 'Perimeter stopper',
    phrase: 'perimeter defense',
    signal: { ratings: ['perimeterDefense'] },
    test: (c) => c.rating('perimeterDefense') >= 0.85 && c.rating('defensiveIq') >= 0.6,
  },
  {
    label: 'Rim protector',
    phrase: 'rim protection',
    signal: { ratings: ['block', 'interiorDefense'] },
    test: (c) => c.rating('block') >= 0.85 && c.rating('interiorDefense') >= 0.75,
  },
  {
    label: 'Owns the glass',
    phrase: 'rebounding',
    signal: { ratings: ['defensiveRebound', 'offensiveRebound'] },
    test: (c) => c.rating('defensiveRebound') >= 0.9 || c.rating('offensiveRebound') >= 0.9,
  },
  {
    label: 'Unlimited range',
    phrase: 'three-point range',
    signal: { ratings: ['threePoint'], tendencies: ['threePointRate'] },
    test: (c) =>
      c.rating('threePoint') >= 0.93 &&
      c.tendency('threePointRate') >= 0.75 &&
      c.ratings.threePoint >= 85,
  },
  {
    label: 'High-volume shooter',
    phrase: 'three-point volume',
    signal: { ratings: ['threePoint'], tendencies: ['threePointRate'] },
    test: (c) => c.rating('threePoint') >= 0.85 && c.tendency('threePointRate') >= 0.6,
  },
  {
    label: 'Floor spacer',
    phrase: 'off-ball shooting',
    signal: { ratings: ['threePoint'], tendencies: ['threePointRate'] },
    test: (c) => c.rating('threePoint') >= 0.7 && c.tendency('threePointRate') >= 0.45,
  },
  {
    label: 'Post scorer',
    phrase: 'post scoring',
    signal: { tendencies: ['postUpRate'], ratings: ['insideScoring'] },
    test: (c) => c.tendency('postUpRate') >= 0.85 && c.rating('insideScoring') >= 0.85,
  },
  {
    label: 'Rim finisher',
    phrase: 'finishing inside',
    signal: { ratings: ['insideScoring'], tendencies: ['rimFrequency'] },
    test: (c) => c.rating('insideScoring') >= 0.85 && c.tendency('rimFrequency') >= 0.5,
  },
  {
    label: 'Downhill driver',
    phrase: 'driving',
    signal: { tendencies: ['driveRate'] },
    test: (c) => c.tendency('driveRate') >= 0.85 && c.tendency('rimFrequency') >= 0.5,
  },
  {
    label: 'Lives at the line',
    phrase: 'drawing fouls',
    signal: { tendencies: ['freeThrowRate'] },
    test: (c) => c.tendency('freeThrowRate') >= 0.85 && c.ratings.freeThrow >= 70,
  },
  {
    label: 'High-usage engine',
    phrase: 'shot volume',
    signal: { tendencies: ['usageRate'] },
    test: (c) => c.tendency('usageRate') >= 0.9 && c.rating('offensiveIq') >= 0.6,
  },
  {
    label: 'Isolation scorer',
    phrase: 'isolation scoring',
    signal: { tendencies: ['isolationRate'] },
    test: (c) => c.tendency('isolationRate') >= 0.85 && c.tendency('shotRate') >= 0.6,
  },
  {
    label: 'Transition weapon',
    phrase: 'open-floor play',
    signal: { tendencies: ['transitionRate'] },
    test: (c) => c.tendency('transitionRate') >= 0.9,
  },
  {
    label: 'Strong upper body',
    phrase: 'strength',
    signal: { ratings: ['strength'] },
    test: (c) => c.rating('strength') >= 0.9,
  },
];

const WEAKNESS_RULES: readonly TraitRule[] = [
  {
    label: 'No shooting range',
    phrase: 'shooting range',
    signal: { tendencies: ['threePointRate'] },
    test: (c) => c.tendency('threePointRate') <= 0.08,
  },
  {
    label: 'Shaky at the line',
    phrase: 'free-throw shooting',
    signal: { ratings: ['freeThrow'] },
    test: (c) => c.ratings.freeThrow <= 66 && c.tendency('freeThrowRate') >= 0.3,
  },
  {
    label: 'Turnover-prone',
    phrase: 'ball security',
    signal: { tendencies: ['turnoverRate'] },
    test: (c) => c.tendency('turnoverRate') >= 0.85,
  },
  {
    label: 'Foul trouble',
    phrase: 'foul discipline',
    signal: { tendencies: ['foulRate'] },
    test: (c) => c.tendency('foulRate') >= 0.85,
  },
  {
    label: 'Cannot guard the perimeter',
    phrase: 'foot speed on the perimeter',
    signal: { ratings: ['perimeterDefense'] },
    test: (c) => c.rating('perimeterDefense') <= 0.12,
  },
  {
    label: 'Gets pushed off his spot',
    phrase: 'lower-body strength',
    signal: { ratings: ['strength'] },
    test: (c) => c.rating('strength') <= 0.15,
  },
  {
    label: 'Below-average jump shot',
    phrase: 'jump shooting',
    signal: { ratings: ['threePoint', 'midrange'] },
    test: (c) => c.rating('threePoint') <= 0.45 && c.rating('midrange') <= 0.45,
  },
  {
    label: 'Passive on offense',
    phrase: 'scoring aggression',
    signal: { tendencies: ['usageRate'] },
    test: (c) => c.tendency('usageRate') <= 0.15,
  },
  {
    label: 'Ignores the glass',
    phrase: 'the defensive glass',
    signal: { ratings: ['defensiveRebound'] },
    test: (c) => c.rating('defensiveRebound') <= 0.12,
  },
  {
    label: 'Rarely blocks shots',
    phrase: 'shot blocking',
    signal: { ratings: ['block'] },
    test: (c) => c.rating('block') <= 0.12,
  },
];

const HABIT_RULES: readonly TraitRule[] = [
  {
    label: 'Gambles for steals',
    phrase: 'steal attempts',
    signal: { tendencies: ['stealAttemptRate'] },
    test: (c) => c.tendency('stealAttemptRate') >= 0.8,
  },
  {
    label: 'Chases blocks',
    phrase: 'block attempts',
    signal: { tendencies: ['blockAttemptRate'] },
    test: (c) => c.tendency('blockAttemptRate') >= 0.8,
  },
  {
    label: 'Crashes the glass',
    phrase: 'offensive rebounding',
    signal: { tendencies: ['crashOffensiveGlassRate'] },
    test: (c) => c.tendency('crashOffensiveGlassRate') >= 0.8,
  },
  {
    label: 'Picks up fouls',
    phrase: 'fouls',
    signal: { tendencies: ['foulRate'] },
    test: (c) => c.tendency('foulRate') >= 0.8,
  },
  {
    label: 'Runs in transition',
    phrase: 'transition',
    signal: { tendencies: ['transitionRate'] },
    test: (c) => c.tendency('transitionRate') >= 0.8,
  },
  {
    label: 'Posts up',
    phrase: 'post-ups',
    signal: { tendencies: ['postUpRate'] },
    test: (c) => c.tendency('postUpRate') >= 0.8,
  },
  {
    label: 'Lives in isolation',
    phrase: 'isolation',
    signal: { tendencies: ['isolationRate'] },
    test: (c) => c.tendency('isolationRate') >= 0.8,
  },
  {
    label: 'Spots up from deep',
    phrase: 'spot-ups',
    signal: { tendencies: ['spotUpRate'] },
    test: (c) => c.tendency('spotUpRate') >= 0.8,
  },
  {
    label: 'Cuts hard',
    phrase: 'cuts',
    signal: { tendencies: ['cutRate'] },
    test: (c) => c.tendency('cutRate') >= 0.8,
  },
  {
    label: 'Runs the pick-and-roll',
    phrase: 'pick-and-roll reps',
    signal: { tendencies: ['pickAndRollBallHandlerRate'] },
    test: (c) => c.tendency('pickAndRollBallHandlerRate') >= 0.8,
  },
];

/**
 * Weakness bars read backwards: a low percentile is the point, so the bar shows
 * the value's own standing rather than how far below average it falls.
 */
function traitOf(rule: TraitRule, context: TraitContext): PlayerProfileTrait {
  let signal = 0;
  for (const key of rule.signal.ratings ?? []) signal = Math.max(signal, context.rating(key));
  for (const key of rule.signal.tendencies ?? []) signal = Math.max(signal, context.tendency(key));
  return { label: rule.label, phrase: rule.phrase, percentile: signal };
}

const MAX_STRENGTHS = 4;
const MAX_WEAKNESSES = 3;
const MAX_HABITS = 4;

function traitsOf(
  rules: readonly TraitRule[],
  context: TraitContext,
  limit: number,
  reverse: boolean,
): PlayerProfileTrait[] {
  const matched = rules.filter((rule) => rule.test(context)).map((rule) => traitOf(rule, context));
  matched.sort((left, right) =>
    reverse ? left.percentile - right.percentile : right.percentile - left.percentile,
  );
  return matched.slice(0, limit);
}

function allTraitsOf(rules: readonly TraitRule[], context: TraitContext): PlayerProfileTrait[] {
  return rules.filter((rule) => rule.test(context)).map((rule) => traitOf(rule, context));
}

function summaryOf(
  strengths: readonly PlayerProfileTrait[],
  weaknesses: readonly PlayerProfileTrait[],
): string {
  if (strengths.length === 0 && weaknesses.length === 0) {
    return 'No standout strengths or weaknesses at this position.';
  }
  const parts: string[] = [];
  const good = strengths.map((trait) => trait.phrase);
  if (good.length > 0) parts.push(`Leans on ${joinPhrases(good)}.`);
  const bad = weaknesses.map((trait) => trait.phrase);
  if (bad.length > 0) parts.push(`Limited by ${joinPhrases(bad)}.`);
  return parts.join(' ');
}

function joinPhrases(phrases: readonly string[]): string {
  const [first, second, ...rest] = phrases;
  if (first === undefined) return '';
  if (second === undefined) return first;
  if (rest.length === 0) return `${first} and ${second}`;
  const last = phrases[phrases.length - 1] ?? second;
  return `${first}, ${second}${rest.length > 1 ? `, ${rest.slice(0, -1).join(', ')}` : ''}, and ${last}`;
}

function archetypeOf(
  allStrengths: readonly PlayerProfileTrait[],
  allWeaknesses: readonly PlayerProfileTrait[],
  positions: readonly string[],
  tendencies: Readonly<SimulationTendencies>,
): string {
  const labels = new Set([...allStrengths, ...allWeaknesses].map((trait) => trait.label));
  const has = (label: string) => labels.has(label);
  const isGuard = positions.some((position) => position === 'PG' || position === 'SG');
  const isBig = positions.some((position) => position === 'C' || position === 'PF');

  // Signature skills outrank position defaults, so a center who can shoot is a
  // shooter first and a big second. "Gravity shooter" stays reserved for the
  // genuinely elite, so a rotation bench big never claims the label.
  const eliteRange = has('Unlimited range');
  const shootsIt = eliteRange || has('High-volume shooter');

  if (isGuard) {
    if (eliteRange) return 'Gravity shooter';
    if (has('Perimeter pickpocket') && has('Perimeter stopper')) return 'Defensive guard';
    if (has('Table-setting passer')) return 'Creator';
    if (shootsIt) return 'Floor spacer';
    if (has('Downhill driver') || has('Transition weapon')) return 'Slashing guard';
    return 'Rotation guard';
  }

  if (isBig) {
    if (eliteRange) return 'Shooting big';
    if (has('Post scorer') && has('Owns the glass')) return 'Interior force';
    if (has('Rim protector') && has('Owns the glass')) return 'Anchor big';
    if (has('Owns the glass')) return 'Glass specialist';
    if (has('Rim protector')) return 'Anchor big';
    if (shootsIt) return 'Stretch big';
    if (has('Table-setting passer')) return 'Connector';
    return 'Rotation big';
  }

  if (eliteRange) return 'Gravity shooter';
  if (has('Perimeter stopper') && shootsIt) return 'Two-way wing';
  if (has('Perimeter stopper')) return 'Wing stopper';
  if (shootsIt) return 'Floor spacer';
  if (has('Table-setting passer')) return 'Connector';
  if (has('Downhill driver') || has('Transition weapon')) return 'Slashing wing';
  if (tendencies.usageRate >= 24) return 'Scoring wing';
  return 'Rotation wing';
}

function normalizeShares(
  entries: readonly { readonly label: string; readonly weight: number }[],
): PlayerProfileShare[] {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (!(total > 0)) return [];
  return entries
    .map((entry) => ({ label: entry.label, share: Math.max(0, entry.weight) / total }))
    .filter((entry) => entry.share > 0)
    .sort((left, right) => right.share - left.share);
}

/**
 * Builds the mode-agnostic profile the panel renders. Everything here is derived
 * from ratings, tendencies, and anchors, so no mode-specific rule leaks in.
 */
export function buildPlayerProfile(
  input: PlayerProfileInput,
  reference: PlayerProfileReference | null,
): PlayerProfileView {
  const context: TraitContext = {
    ratings: input.ratings,
    tendencies: input.tendencies,
    rating: (key) => reference?.rating(key, input.ratings[key]) ?? 0,
    tendency: (key) => reference?.tendency(key, input.tendencies[key]) ?? 0,
  };

  const strengths = traitsOf(STRENGTH_RULES, context, MAX_STRENGTHS, false);
  const weaknesses = traitsOf(WEAKNESS_RULES, context, MAX_WEAKNESSES, true);
  const habits = traitsOf(HABIT_RULES, context, MAX_HABITS, false);
  const allStrengths = allTraitsOf(STRENGTH_RULES, context);
  const allWeaknesses = allTraitsOf(WEAKNESS_RULES, context);
  const shotDiet = normalizeShares(
    SHOT_ZONE_KEYS.map((key, index) => ({
      label: SHOT_ZONE_LABELS[index] ?? key,
      weight: input.tendencies[key],
    })),
  );
  const actions = normalizeShares(
    ACTION_LABELS.map(([key, label]) => ({ label, weight: input.tendencies[key] })),
  );

  const anchors = input.anchors ?? null;
  const workload =
    anchors === null
      ? null
      : {
          minutes: anchors.minutesPerGame,
          shotAttempts: anchors.fieldGoalAttemptsPerGame ?? null,
          usage: input.tendencies.usageRate,
          usagePercentile: context.tendency('usageRate'),
        };

  const ratingGroups = PROFILE_RATING_GROUPS.map((group) => ({
    title: group.title,
    rows: group.keys
      .map((key) => ({
        label: PROFILE_RATING_LABELS[key],
        value: input.ratings[key],
        percentile: context.rating(key),
      }))
      .sort((left, right) => right.percentile - left.percentile),
  }));

  return {
    displayName: input.displayName,
    initials: profileInitials(input.displayName),
    franchiseLabel: input.franchiseLabel,
    seasonKey: input.seasonKey,
    positionsLabel: positionsLabel(input.positions),
    heightLabel: heightLabel(input.heightInches),
    weightLabel: weightLabel(input.weightLbs),
    overall: input.overall,
    offense: input.offense,
    defense: input.defense,
    archetype: archetypeOf(allStrengths, allWeaknesses, input.positions, input.tendencies),
    summary: summaryOf(strengths, weaknesses),
    strengths,
    weaknesses,
    workload,
    shotDiet: shotDiet.length > 0 ? shotDiet : null,
    actions: actions.length > 0 ? actions : null,
    habits,
    ratingGroups,
    cohort:
      reference === null ? null : { label: reference.cohortLabel, size: reference.sampleSize },
  };
}
