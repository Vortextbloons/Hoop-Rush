/**
 * Fit-cohort rows and feature extraction for the conservative three-point
 * reconstruction (spec/12).
 *
 * The early three-point prior cohort is 1979-80 through 1983-84: the first
 * five seasons with a three-point line, where the shot was nascent and
 * closest to the world pre-1979 players would face. Predictors use only
 * historically available traits: FTM/FTA, stabilized FT%, relative
 * position-and-era 2P%, FGA per 36, FTA/FGA, assists per 36, position,
 * height, weight, age, and cohort. Never 3P fields, overall, offensive
 * rating, or raw FG%.
 */
import { join } from 'node:path';
import { NBA_ROOT } from '../config.ts';
import { readJson } from '../json.ts';

/** The early three-point prior cohort (spec/12). */
export const RECONSTRUCTION_SEASONS = [
  '1979-80',
  '1980-81',
  '1981-82',
  '1982-83',
  '1983-84',
] as const;

/**
 * Modern validation cohort for the attempt translation (spec/12): the
 * "stuck in a modern game" claim is validated against modern observed
 * volume. Era-disjoint from the fit cohort, so no player leaks between
 * fitting and validation.
 */
export const MODERN_VALIDATION_SEASONS = [
  '2014-15',
  '2015-16',
  '2016-17',
  '2017-18',
  '2018-19',
  '2019-20',
  '2020-21',
  '2021-22',
  '2022-23',
  '2023-24',
] as const;

/**
 * Cohort index for a season, clamped into the fit cohort. Pre-1979 seasons
 * (which predate the whole cohort) use the earliest cohort index; the
 * season-trend feature then treats them as the start of the early era.
 */
export function seasonIndexFor(season: string): number {
  const index = RECONSTRUCTION_SEASONS.indexOf(season as (typeof RECONSTRUCTION_SEASONS)[number]);
  if (index === -1)
    return season < RECONSTRUCTION_SEASONS[0] ? 0 : RECONSTRUCTION_SEASONS.length - 1;
  return index;
}

export type PositionGroup = 'G' | 'F' | 'C';

/** Feature names in coefficient/covariance order (intercept excluded). */
export const RECONSTRUCTION_FEATURE_NAMES = [
  'ftRatio',
  'ftPctShrunk',
  'rel2pPct',
  'fgaPer36',
  'ftaPerFga',
  'astPer36',
  'isGuard',
  'isCenter',
  'heightInches',
  'weightLbs',
  'age',
  'seasonIndex',
] as const;

export type ReconstructionFeatureName = (typeof RECONSTRUCTION_FEATURE_NAMES)[number];

/** One player-season row with raw evidence for fitting or prediction. */
export interface ReconstructionRow {
  playerExternalId: string;
  season: string;
  seasonIndex: number;
  positionGroup: PositionGroup;
  heightInches: number | null;
  weightLbs: number | null;
  age: number | null;
  minutes: number;
  fgm: number | null;
  fga: number | null;
  tpm: number | null;
  tpa: number | null;
  ftm: number | null;
  fta: number | null;
  assists: number | null;
  statsSource: string;
}

export function positionGroupOf(position: string | null | undefined): PositionGroup {
  const pos = (position ?? '').toUpperCase();
  if (pos === 'PG' || pos === 'SG' || pos === 'G') return 'G';
  if (pos === 'PF' || pos === 'SF' || pos === 'F') return 'F';
  return 'C';
}

/** Median of numbers, ignoring nulls (deterministic; ascending middle value). */
export function median(values: readonly (number | null)[]): number {
  const present = values
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (present.length === 0) return 0;
  const mid = Math.floor(present.length / 2);
  return present.length % 2 === 1
    ? (present[mid] as number)
    : ((present[mid - 1] as number) + (present[mid] as number)) / 2;
}

/** Attempt-weighted mean of a rate column (deterministic). */
export function attemptWeightedMean(
  numerator: readonly (number | null)[],
  denominator: readonly (number | null)[],
): number | null {
  let total = 0;
  let weight = 0;
  for (let i = 0; i < numerator.length; i += 1) {
    const num = numerator[i] ?? null;
    const den = denominator[i] ?? null;
    if (num === null || den === null || den <= 0) continue;
    total += num;
    weight += den;
  }
  return weight > 0 ? total / weight : null;
}

/** Raw (unstandardized) feature values per row. Physicals are imputed to
 * position-and-cohort medians (missing flags preserved separately), so every
 * feature is a concrete number. */
export interface RawFeatures {
  ftRatio: number;
  ftPctShrunk: number;
  rel2pPct: number;
  fgaPer36: number;
  ftaPerFga: number;
  astPer36: number;
  isGuard: number;
  isCenter: number;
  heightInches: number;
  weightLbs: number;
  age: number;
  seasonIndex: number;
  missHeight: number;
  missWeight: number;
}

export interface FeatureContext {
  /** Position-group free-throw priors (stabilized FT% shrinkage). */
  ftPriors: Record<PositionGroup, number>;
  /** Position-group two-point percentage means (relative 2P%). */
  twoPctMeans: Record<PositionGroup, number>;
  /** Position-group medians used to impute missing height/weight/age. */
  missingDefaults: Record<PositionGroup, { heightInches: number; weightLbs: number; age: number }>;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}

/**
 * Deterministic feature extraction. Shrinkage and means come from the
 * versioned `context` (pooled over the fit cohort), so prediction for any
 * season uses the same reference values the models were fit against.
 */
export function extractRawFeatures(row: ReconstructionRow, context: FeatureContext): RawFeatures {
  const { positionGroup: group } = row;
  const ftPrior = context.ftPriors[group];
  const twoPctMean = context.twoPctMeans[group];
  const defaults = context.missingDefaults[group];

  const ftRatio = ratio(row.ftm, row.fta) ?? 0;
  const ftPctShrunk =
    row.ftm !== null && row.fta !== null ? (row.ftm + ftPrior * 80) / (row.fta + 80) : ftPrior;
  const twoPct = ratio(
    row.fgm !== null && row.tpm !== null ? row.fgm - row.tpm : null,
    row.fga !== null && row.tpa !== null ? row.fga - row.tpa : null,
  );
  const rel2pPct = twoPct !== null ? twoPct - twoPctMean : 0;
  const fgaPer36 = row.minutes > 0 && row.fga !== null ? (row.fga / row.minutes) * 36 : 0;
  const ftaPerFga = ratio(row.fta, row.fga) ?? 0;
  const astPer36 = row.minutes > 0 && row.assists !== null ? (row.assists / row.minutes) * 36 : 0;
  const isGuard = group === 'G' ? 1 : 0;
  const isCenter = group === 'C' ? 1 : 0;
  const heightInches = row.heightInches ?? defaults.heightInches;
  const weightLbs = row.weightLbs ?? defaults.weightLbs;
  const age = row.age ?? defaults.age;
  const seasonIndex = row.seasonIndex / Math.max(1, RECONSTRUCTION_SEASONS.length - 1);
  const missHeight = row.heightInches === null ? 1 : 0;
  const missWeight = row.weightLbs === null ? 1 : 0;
  return {
    ftRatio,
    ftPctShrunk,
    rel2pPct,
    fgaPer36,
    ftaPerFga,
    astPer36,
    isGuard,
    isCenter,
    heightInches,
    weightLbs,
    age,
    seasonIndex,
    missHeight,
    missWeight,
  };
}

/** Feature vector in RECONSTRUCTION_FEATURE_NAMES order. */
export function featureVector(raw: RawFeatures): number[] {
  return RECONSTRUCTION_FEATURE_NAMES.map((name) => raw[name]);
}

/** Number of missing features behind a raw feature set (evidence weakness). */
export function missingFeatureCount(raw: RawFeatures): number {
  return raw.missHeight + raw.missWeight;
}

/**
 * Loads the raw cohort rows (season-stats joined to roster physicals).
 * Rows without a stats record or with zero trials are included when the
 * evidence exists; model-specific eligibility is applied by the fitter.
 */
export function loadCohortRows(
  seasons: readonly string[] = [...RECONSTRUCTION_SEASONS],
): ReconstructionRow[] {
  const rows: ReconstructionRow[] = [];
  for (let s = 0; s < seasons.length; s += 1) {
    const season = seasons[s] as string;
    const dir = join(NBA_ROOT, season);
    const roster = readJson(join(dir, 'roster.json')) as unknown[] | null;
    const statsList = readJson(join(dir, 'season-stats.json')) as Record<string, unknown>[] | null;
    const rosterById = new Map<string, Record<string, unknown>>();
    for (const player of roster ?? []) {
      const record = player as Record<string, unknown>;
      const extId = record['externalId'];
      if (typeof extId === 'string' && extId !== '') rosterById.set(extId, record);
    }
    for (const stats of statsList ?? []) {
      const extId = stats['playerExternalId'];
      if (typeof extId !== 'string' || extId === '') continue;
      const rosterPlayer = rosterById.get(extId);
      const num = (key: string): number | null => {
        const value = stats[key];
        if (value === null || value === undefined) return null;
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      };
      const int = (key: string): number | null => {
        const n = num(key);
        return n === null ? null : Math.trunc(n);
      };
      const position =
        typeof rosterPlayer?.['position'] === 'string' ? rosterPlayer['position'] : null;
      rows.push({
        playerExternalId: extId,
        season,
        seasonIndex: s,
        positionGroup: positionGroupOf(position),
        heightInches:
          int('heightInches') ?? (rosterPlayer ? intOf(rosterPlayer, 'heightInches') : null),
        weightLbs: int('weightLbs') ?? (rosterPlayer ? intOf(rosterPlayer, 'weightLbs') : null),
        age: int('age') ?? (rosterPlayer ? intOf(rosterPlayer, 'age') : null),
        minutes: num('minutes') ?? 0,
        fgm: num('fgm'),
        fga: num('fga'),
        tpm: num('tpm'),
        tpa: num('tpa'),
        ftm: num('ftm'),
        fta: num('fta'),
        assists: num('assists'),
        statsSource: typeof stats['statsSource'] === 'string' ? stats['statsSource'] : 'unknown',
      });
    }
  }
  return rows;
}

function intOf(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Builds the feature context pooled over the fit cohort: position-group FT
 * priors, two-point percentage means, and position-group medians for
 * height/weight/age. Deterministic given the same cohort rows.
 */
export function buildFeatureContext(rows: readonly ReconstructionRow[]): FeatureContext {
  const ftPriors = {} as Record<PositionGroup, number>;
  const twoPctMeans = {} as Record<PositionGroup, number>;
  const missingDefaults = {} as Record<
    PositionGroup,
    { heightInches: number; weightLbs: number; age: number }
  >;
  for (const group of ['G', 'F', 'C'] as const) {
    const groupRows = rows.filter((row) => row.positionGroup === group);
    ftPriors[group] =
      attemptWeightedMean(
        groupRows.map((row) => row.ftm),
        groupRows.map((row) => row.fta),
      ) ?? 0.75;
    twoPctMeans[group] =
      attemptWeightedMean(
        groupRows.map((row) => (row.fgm !== null && row.tpm !== null ? row.fgm - row.tpm : null)),
        groupRows.map((row) => (row.fga !== null && row.tpa !== null ? row.fga - row.tpa : null)),
      ) ?? 0.45;
    missingDefaults[group] = {
      heightInches: median(groupRows.map((row) => row.heightInches)) || 78,
      weightLbs: median(groupRows.map((row) => row.weightLbs)) || 205,
      age: median(groupRows.map((row) => row.age)) || 26,
    };
  }
  return { ftPriors, twoPctMeans, missingDefaults };
}

/**
 * Equivalent attempts behind the early-era priors. Mirrors the shrink-80
 * convention used across ratings derivation: the prior is a stabilizing
 * early-era anchor, never a dominant pseudo-sample.
 */
export const PRIOR_EQUIVALENT_ATTEMPTS = 80;

/** Attempt-weighted early-era priors (accuracy and attempt rate). */
export function cohortPriors(rows: readonly ReconstructionRow[]): {
  accuracyPrior: number;
  accuracyPriorAttempts: number;
  attemptRatePrior: number;
  attemptRatePriorTrials: number;
} {
  const accuracyPrior = attemptWeightedMean(
    rows.map((row) => row.tpm),
    rows.map((row) => row.tpa),
  );
  const attemptRatePrior = attemptWeightedMean(
    rows.map((row) => row.tpa),
    rows.map((row) => row.fga),
  );
  return {
    accuracyPrior: accuracyPrior ?? 0.33,
    accuracyPriorAttempts: PRIOR_EQUIVALENT_ATTEMPTS,
    attemptRatePrior: attemptRatePrior ?? 0.04,
    attemptRatePriorTrials: PRIOR_EQUIVALENT_ATTEMPTS,
  };
}
