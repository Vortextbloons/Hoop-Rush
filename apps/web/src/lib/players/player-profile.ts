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

/** Placeholders for identity-only renders, so no rating section is fabricated. */
export const ZERO_RATINGS: Readonly<SimulationRatings> = Object.fromEntries(
  PROFILE_RATING_KEYS.map((key) => [key, 0]),
) as unknown as Readonly<SimulationRatings>;

export const ZERO_TENDENCIES: Readonly<SimulationTendencies> = {
  usageRate: 0,
  passRate: 0,
  shotRate: 0,
  driveRate: 0,
  postUpRate: 0,
  rimFrequency: 0,
  shortMidFrequency: 0,
  longMidFrequency: 0,
  cornerThreeFrequency: 0,
  aboveBreakThreeFrequency: 0,
  threePointRate: 0,
  freeThrowRate: 0,
  turnoverRate: 0,
  isolationRate: 0,
  pickAndRollBallHandlerRate: 0,
  pickAndRollRollManRate: 0,
  spotUpRate: 0,
  transitionRate: 0,
  cutRate: 0,
  foulRate: 0,
  stealAttemptRate: 0,
  blockAttemptRate: 0,
  crashOffensiveGlassRate: 0,
};

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
  /** Season stat line for the Production tab. Omitted by modes without stats. */
  readonly stats?: PlayerProfileStats | null;
  /** Playoff sample, rendered as its own section when present. */
  readonly postseason?: readonly PlayerProfileStatGroup[] | null;
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
  /** Season production grouped for the Production tab. Null without stats. */
  readonly production: readonly PlayerProfileStatGroup[] | null;
  /** Playoff-vs-regular-season evidence, when a recorded sample exists. */
  readonly postseason: readonly PlayerProfileStatGroup[] | null;
  readonly cohort: { readonly label: string; readonly size: number } | null;
}

export interface PlayerProfileStatRow {
  readonly label: string;
  readonly value: string;
}

export interface PlayerProfileStatGroup {
  readonly title: string;
  readonly rows: readonly PlayerProfileStatRow[];
}

/** Per-game production, mirroring the season-table column names. */
export interface PlayerProfileStats {
  readonly gamesPlayed: number;
  readonly minutes: number | null;
  readonly points: number | null;
  readonly rebounds: number | null;
  readonly assists: number | null;
  readonly steals: number | null;
  readonly blocks: number | null;
  readonly turnovers: number | null;
  readonly fgPct: number | null;
  readonly threePct: number | null;
  readonly ftPct: number | null;
  readonly tsPct: number | null;
  readonly efgPct: number | null;
  readonly usageRate: number | null;
  readonly per: number | null;
  readonly boxPlusMinus: number | null;
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
    test: (c) => c.tendency('usageRate') >= 0.8 && c.rating('offensiveIq') >= 0.6,
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
  {
    label: 'Midrange maestro',
    phrase: 'midrange pull-ups',
    signal: { ratings: ['midrange'], tendencies: ['shortMidFrequency', 'longMidFrequency'] },
    test: (c) =>
      c.rating('midrange') >= 0.85 &&
      (c.tendency('shortMidFrequency') >= 0.5 || c.tendency('longMidFrequency') >= 0.5),
  },
  {
    label: 'Paint enforcer',
    phrase: 'interior deterrence',
    signal: { ratings: ['interiorDefense', 'strength'] },
    test: (c) => c.rating('interiorDefense') >= 0.85 && c.rating('strength') >= 0.8,
  },
  {
    label: 'Pick-and-roll maestro',
    phrase: 'pick-and-roll creation',
    signal: { tendencies: ['pickAndRollBallHandlerRate'] },
    test: (c) =>
      c.tendency('pickAndRollBallHandlerRate') >= 0.85 &&
      (c.rating('passing') >= 0.75 || c.rating('offensiveIq') >= 0.75),
  },
  {
    label: 'Off-ball cutter',
    phrase: 'off-ball cutting',
    signal: { tendencies: ['cutRate'], ratings: ['insideScoring'] },
    test: (c) => c.tendency('cutRate') >= 0.85 && c.rating('insideScoring') >= 0.75,
  },
  {
    label: 'Roll-man threat',
    phrase: 'roll-man finishing',
    signal: { tendencies: ['pickAndRollRollManRate'], ratings: ['insideScoring'] },
    test: (c) => c.tendency('pickAndRollRollManRate') >= 0.85 && c.rating('insideScoring') >= 0.75,
  },
  {
    label: 'Explosive athlete',
    phrase: 'vertical athleticism',
    signal: { ratings: ['vertical', 'speed'] },
    test: (c) => c.rating('vertical') >= 0.9 && c.rating('speed') >= 0.75,
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
  {
    label: 'Tunnel vision',
    phrase: 'playmaking vision',
    signal: { ratings: ['passing'], tendencies: ['passRate'] },
    test: (c) =>
      c.rating('passing') <= 0.2 &&
      c.tendency('passRate') <= 0.25 &&
      c.tendency('usageRate') >= 0.5,
  },
  {
    label: 'Interior liability',
    phrase: 'interior defense',
    signal: { ratings: ['interiorDefense'] },
    test: (c) => c.rating('interiorDefense') <= 0.15,
  },
  {
    label: 'Lacks burst',
    phrase: 'foot speed',
    signal: { ratings: ['speed'] },
    test: (c) => c.rating('speed') <= 0.12,
  },
  {
    label: 'Loose handle',
    phrase: 'ball handling',
    signal: { ratings: ['ballHandling'], tendencies: ['turnoverRate'] },
    test: (c) => c.rating('ballHandling') <= 0.12 && c.tendency('turnoverRate') >= 0.6,
  },
  {
    label: 'Struggles inside',
    phrase: 'finishing at the rim',
    signal: { ratings: ['insideScoring'] },
    test: (c) => c.rating('insideScoring') <= 0.15 && c.tendency('rimFrequency') >= 0.4,
  },
  {
    label: 'Misses rotations',
    phrase: 'defensive awareness',
    signal: { ratings: ['defensiveIq'] },
    test: (c) => c.rating('defensiveIq') <= 0.12,
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

export function defaultSlotForPositions(positions: readonly string[]): string {
  if (positions.length === 0) return 'PG';
  if (positions.length === 1) return positions[0] ?? 'PG';
  if (
    positions.includes('PG') &&
    !positions.includes('SF') &&
    !positions.includes('PF') &&
    !positions.includes('C')
  ) {
    return 'PG';
  }
  if (
    positions.includes('SG') &&
    !positions.includes('SF') &&
    !positions.includes('PF') &&
    !positions.includes('C')
  ) {
    return 'SG';
  }
  if (
    positions.includes('C') &&
    !positions.includes('SF') &&
    !positions.includes('SG') &&
    !positions.includes('PG')
  ) {
    return 'C';
  }
  if (
    positions.includes('PF') &&
    !positions.includes('SF') &&
    !positions.includes('SG') &&
    !positions.includes('PG')
  ) {
    return 'PF';
  }
  if (positions.includes('SF')) {
    return 'SF';
  }
  return positions[0] ?? 'PG';
}

/**
 * Picks the archetype backed by the strongest evidence rather than the first
 * fixed rule that matches. A guard with elite steals and passing should not be
 * labelled a scorer just because one usage marker also fired.
 */
function archetypeOf(
  allStrengths: readonly PlayerProfileTrait[],
  allWeaknesses: readonly PlayerProfileTrait[],
  positions: readonly string[],
  tendencies: Readonly<SimulationTendencies>,
  slot?: string | null,
): string {
  const labels = new Set([...allStrengths, ...allWeaknesses].map((trait) => trait.label));
  const has = (label: string) => labels.has(label);
  const strengthOf = (label: string): number =>
    allStrengths.find((trait) => trait.label === label)?.percentile ?? 0;
  /** Mean percentile across the traits that define the archetype. */
  const evidence = (...required: readonly string[]): number => {
    if (!required.every(has)) return 0;
    return required.reduce((sum, label) => sum + strengthOf(label), 0) / required.length;
  };

  const effectiveSlot = slot && slot.length > 0 ? slot : defaultSlotForPositions(positions);
  const isGuard = effectiveSlot === 'PG' || effectiveSlot === 'SG';
  const isBig = effectiveSlot === 'C' || effectiveSlot === 'PF';
  const isCenter = effectiveSlot === 'C';
  const hasWing = effectiveSlot === 'SF';
  const shootsIt = has('Unlimited range') || has('High-volume shooter');

  const candidates: { label: string; score: number }[] = [];

  if (has('Unlimited range')) {
    candidates.push({
      label: isGuard ? 'Gravity shooter' : 'Shooting big',
      score: evidence('Unlimited range'),
    });
  }
  if (isGuard) {
    if (has('Perimeter stopper') && has('High-usage engine')) {
      candidates.push({
        label: 'Two-way guard',
        score: evidence('Perimeter stopper', 'High-usage engine'),
      });
    } else if (has('Perimeter stopper') && (has('Floor spacer') || has('High-volume shooter'))) {
      candidates.push({
        label: '3-and-D guard',
        score: evidence(
          'Perimeter stopper',
          has('High-volume shooter') ? 'High-volume shooter' : 'Floor spacer',
        ),
      });
    } else if (has('Perimeter stopper') && has('Perimeter pickpocket')) {
      candidates.push({
        label: 'Defensive guard',
        score: evidence('Perimeter pickpocket', 'Perimeter stopper'),
      });
    }
    candidates.push({ label: 'Creator', score: evidence('Table-setting passer') });
    if (has('Pick-and-roll maestro')) {
      if (has('Table-setting passer')) {
        candidates.push({
          label: 'Pick-and-roll maestro',
          score: evidence('Pick-and-roll maestro', 'Table-setting passer'),
        });
      } else {
        candidates.push({
          label: 'Pick-and-roll maestro',
          score: strengthOf('Pick-and-roll maestro') * 0.88,
        });
      }
    }
    if (has('Midrange maestro') && (has('Isolation scorer') || has('High-usage engine'))) {
      candidates.push({
        label: 'Shot creator',
        score: evidence(
          'Midrange maestro',
          has('Isolation scorer') ? 'Isolation scorer' : 'High-usage engine',
        ),
      });
    }
    if (has('High-usage engine') && has('High-volume shooter') && !has('Perimeter stopper')) {
      candidates.push({
        label: 'Microwave scorer',
        score: evidence('High-usage engine', 'High-volume shooter'),
      });
    }
    if (has('High-usage engine') && (has('Isolation scorer') || has('Downhill driver'))) {
      candidates.push({
        label: 'Scoring guard',
        score: evidence(
          'High-usage engine',
          has('Isolation scorer') ? 'Isolation scorer' : 'Downhill driver',
        ),
      });
    } else {
      candidates.push({
        label: 'Scoring guard',
        score: evidence('High-usage engine', 'Isolation scorer'),
      });
    }
    candidates.push({ label: 'Slashing guard', score: evidence('Downhill driver') });
    if (has('Transition weapon') && (has('Downhill driver') || has('Rim finisher'))) {
      candidates.push({
        label: 'Transition spark',
        score: evidence(
          'Transition weapon',
          has('Downhill driver') ? 'Downhill driver' : 'Rim finisher',
        ),
      });
    }
    if (shootsIt)
      candidates.push({ label: 'Floor spacer', score: evidence('High-volume shooter') });
  } else if (isBig) {
    if (has('Table-setting passer')) {
      if (has('High-usage engine')) {
        candidates.push({
          label: hasWing && !isCenter ? 'Point forward' : 'Playmaking big',
          score: evidence('Table-setting passer', 'High-usage engine'),
        });
      } else {
        candidates.push({ label: 'Connector', score: evidence('Table-setting passer') });
      }
    }
    if (has('Rim protector')) {
      if (has('Post scorer') || has('High-usage engine')) {
        candidates.push({
          label: 'Two-way anchor',
          score: evidence(
            'Rim protector',
            has('Post scorer') ? 'Post scorer' : 'High-usage engine',
          ),
        });
      } else if (has('Owns the glass')) {
        candidates.push({
          label: 'Anchor big',
          score: evidence('Rim protector', 'Owns the glass'),
        });
      } else if (has('High-volume shooter') || has('Floor spacer')) {
        candidates.push({
          label: '3-and-D big',
          score: evidence(
            'Rim protector',
            has('High-volume shooter') ? 'High-volume shooter' : 'Floor spacer',
          ),
        });
      }
    }
    if (has('Paint enforcer') && (has('Owns the glass') || has('Strong upper body'))) {
      candidates.push({
        label: 'Paint enforcer',
        score: evidence(
          'Paint enforcer',
          has('Owns the glass') ? 'Owns the glass' : 'Strong upper body',
        ),
      });
    }
    candidates.push({ label: 'Interior force', score: evidence('Post scorer', 'Owns the glass') });
    if (has('Post scorer') && !has('Owns the glass') && !has('Rim protector')) {
      candidates.push({ label: 'Post hub', score: evidence('Post scorer') });
    }
    candidates.push({ label: 'Glass specialist', score: evidence('Owns the glass') });
    if (has('Roll-man threat') && has('Rim finisher')) {
      candidates.push({
        label: 'Roll-and-finish big',
        score: evidence('Roll-man threat', 'Rim finisher'),
      });
    }
    if (has('Rim finisher') && !has('Post scorer')) {
      candidates.push({ label: 'Rim runner', score: evidence('Rim finisher') });
    }
    if (shootsIt) candidates.push({ label: 'Stretch big', score: evidence('High-volume shooter') });
  } else {
    if (has('Table-setting passer')) {
      if (has('High-usage engine')) {
        candidates.push({
          label: 'Point forward',
          score: evidence('Table-setting passer', 'High-usage engine'),
        });
      } else {
        candidates.push({ label: 'Connector', score: evidence('Table-setting passer') });
      }
    }
    if (has('Perimeter stopper')) {
      if (has('High-volume shooter')) {
        candidates.push({
          label: 'Two-way wing',
          score: evidence('Perimeter stopper', 'High-volume shooter'),
        });
      } else if (has('Floor spacer')) {
        candidates.push({
          label: '3-and-D wing',
          score: evidence('Perimeter stopper', 'Floor spacer'),
        });
      } else if (has('Downhill driver')) {
        candidates.push({
          label: 'Two-way slasher',
          score: evidence('Perimeter stopper', 'Downhill driver'),
        });
      } else {
        candidates.push({ label: 'Wing stopper', score: evidence('Perimeter stopper') });
      }
    }
    if (has('Midrange maestro') && (has('Isolation scorer') || has('High-usage engine'))) {
      candidates.push({
        label: 'Shot-creating wing',
        score: evidence(
          'Midrange maestro',
          has('Isolation scorer') ? 'Isolation scorer' : 'High-usage engine',
        ),
      });
    }
    if (has('Off-ball cutter') && (has('Floor spacer') || has('High-volume shooter'))) {
      candidates.push({
        label: 'Off-ball mover',
        score: evidence(
          'Off-ball cutter',
          has('High-volume shooter') ? 'High-volume shooter' : 'Floor spacer',
        ),
      });
    }
    candidates.push({
      label: 'Scoring wing',
      score: evidence('High-usage engine', 'Isolation scorer'),
    });
    candidates.push({ label: 'Floor spacer', score: evidence('High-volume shooter') });
    candidates.push({ label: 'Slashing wing', score: evidence('Downhill driver') });
    if (has('Transition weapon') && (has('Downhill driver') || has('Rim finisher'))) {
      candidates.push({
        label: 'Transition wing',
        score: evidence(
          'Transition weapon',
          has('Downhill driver') ? 'Downhill driver' : 'Rim finisher',
        ),
      });
    }
  }

  // Ties are common at the ceiling (many traits reach the 100th percentile), so
  // usage decides: a scorer with elite volume is described by his scoring first.
  const best = candidates.reduce<{ label: string; score: number } | null>(
    (winner, entry) => (winner === null || entry.score > winner.score ? entry : winner),
    null,
  );
  const tied = candidates.filter((entry) => best !== null && entry.score === best.score);
  const floor = isGuard ? 'Rotation guard' : isBig ? 'Rotation big' : 'Rotation wing';
  if (best === null || best.score <= 0) return floor;
  if (tied.length > 1) {
    const scoring = tied.find(
      (entry) =>
        entry.label === 'Scoring guard' ||
        entry.label === 'Scoring wing' ||
        entry.label === 'Two-way anchor' ||
        entry.label === 'Two-way guard' ||
        entry.label === 'Point forward' ||
        entry.label === 'Playmaking big',
    );
    if (scoring !== undefined && tendencies.usageRate >= 30) return scoring.label;
    const gravity = tied.find((entry) => entry.label === 'Gravity shooter');
    if (gravity !== undefined) return gravity.label;
  }
  return best.label;
}

function formatStat(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? '\u2014' : value.toFixed(digits);
}

function formatStatPct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '\u2014' : `${(value * 100).toFixed(1)}%`;
}

/**
 * Season production, grouped the way a box score reads: volume first, then
 * efficiency, then the rate stats. Rows with no recorded value stay visible as
 * an em dash, because an absent stat is information for older seasons.
 */
function productionGroupsOf(
  stats: PlayerProfileStats | null | undefined,
): PlayerProfileStatGroup[] | null {
  if (stats === null || stats === undefined) return null;
  return [
    {
      title: 'Per game',
      rows: [
        { label: 'Minutes', value: formatStat(stats.minutes) },
        { label: 'Points', value: formatStat(stats.points) },
        { label: 'Rebounds', value: formatStat(stats.rebounds) },
        { label: 'Assists', value: formatStat(stats.assists) },
        { label: 'Steals', value: formatStat(stats.steals) },
        { label: 'Blocks', value: formatStat(stats.blocks) },
        { label: 'Turnovers', value: formatStat(stats.turnovers) },
      ],
    },
    {
      title: 'Shooting',
      rows: [
        { label: 'FG%', value: formatStatPct(stats.fgPct) },
        { label: '3P%', value: formatStatPct(stats.threePct) },
        { label: 'FT%', value: formatStatPct(stats.ftPct) },
        { label: 'eFG%', value: formatStatPct(stats.efgPct) },
        { label: 'TS%', value: formatStatPct(stats.tsPct) },
      ],
    },
    {
      title: 'Advanced',
      rows: [
        {
          label: 'USG%',
          value: stats.usageRate === null ? '\u2014' : `${formatStat(stats.usageRate)}%`,
        },
        { label: 'PER', value: formatStat(stats.per) },
        { label: 'BPM', value: formatStat(stats.boxPlusMinus) },
        { label: 'Games', value: String(stats.gamesPlayed) },
      ],
    },
  ];
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
    archetype: archetypeOf(
      allStrengths,
      allWeaknesses,
      input.positions,
      input.tendencies,
      input.slot,
    ),
    summary: summaryOf(strengths, weaknesses),
    strengths,
    weaknesses,
    workload,
    shotDiet: shotDiet.length > 0 ? shotDiet : null,
    actions: actions.length > 0 ? actions : null,
    habits,
    ratingGroups,
    production: productionGroupsOf(input.stats),
    postseason: input.postseason ?? null,
    cohort:
      reference === null ? null : { label: reference.cohortLabel, size: reference.sampleSize },
  };
}
