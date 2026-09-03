import { join } from 'node:path';
import { z } from 'zod';
import { NBA_ROOT } from '../config.ts';
import { readJson } from '../json.ts';
export const RECONSTRUCTION_SEASONS = [
  '1979-80',
  '1980-81',
  '1981-82',
  '1982-83',
  '1983-84',
] as const;
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
export function seasonIndexFor(season: string): number {
  const index = RECONSTRUCTION_SEASONS.indexOf(season as (typeof RECONSTRUCTION_SEASONS)[number]);
  if (index === -1)
    return season < RECONSTRUCTION_SEASONS[0] ? 0 : RECONSTRUCTION_SEASONS.length - 1;
  return index;
}
export type PositionGroup = 'G' | 'F' | 'C';
export const positionGroupSchema = z.enum(['G', 'F', 'C']);
const cohortRosterRowSchema = z.object({
  externalId: z.unknown().optional(),
  position: z.unknown().optional(),
  heightInches: z.unknown().optional(),
  weightLbs: z.unknown().optional(),
  age: z.unknown().optional(),
});
type CohortRosterRow = z.infer<typeof cohortRosterRowSchema>;
const cohortStatsRowSchema = z.object({
  playerExternalId: z.unknown().optional(),
  statsSource: z.unknown().optional(),
  minutes: z.unknown().optional(),
  fgm: z.unknown().optional(),
  fga: z.unknown().optional(),
  tpm: z.unknown().optional(),
  tpa: z.unknown().optional(),
  ftm: z.unknown().optional(),
  fta: z.unknown().optional(),
  assists: z.unknown().optional(),
  heightInches: z.unknown().optional(),
  weightLbs: z.unknown().optional(),
  age: z.unknown().optional(),
});
type CohortStatsRow = z.infer<typeof cohortStatsRowSchema>;
export const reconstructionRowSchema = z.object({
  playerExternalId: z.string(),
  season: z.string(),
  seasonIndex: z.number().int(),
  positionGroup: positionGroupSchema,
  heightInches: z.number().int().nullable(),
  weightLbs: z.number().int().nullable(),
  age: z.number().int().nullable(),
  minutes: z.number(),
  fgm: z.number().nullable(),
  fga: z.number().nullable(),
  tpm: z.number().nullable(),
  tpa: z.number().nullable(),
  ftm: z.number().nullable(),
  fta: z.number().nullable(),
  assists: z.number().nullable(),
  statsSource: z.string(),
});
export type ReconstructionRow = z.infer<typeof reconstructionRowSchema>;
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
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function intOrNull(value: unknown): number | null {
  const n = numberOrNull(value);
  return n === null ? null : Math.trunc(n);
}
export function positionGroupOf(position: string | null | undefined): PositionGroup {
  const pos = (position ?? '').toUpperCase();
  if (pos === 'PG' || pos === 'SG' || pos === 'G') return 'G';
  if (pos === 'PF' || pos === 'SF' || pos === 'F') return 'F';
  return 'C';
}
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
  ftPriors: Record<PositionGroup, number>;
  twoPctMeans: Record<PositionGroup, number>;
  missingDefaults: Record<
    PositionGroup,
    {
      heightInches: number;
      weightLbs: number;
      age: number;
    }
  >;
}
function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}
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
export function featureVector(raw: RawFeatures): number[] {
  return RECONSTRUCTION_FEATURE_NAMES.map((name) => raw[name]);
}
export function missingFeatureCount(raw: RawFeatures): number {
  return raw.missHeight + raw.missWeight;
}
export function loadCohortRows(
  seasons: readonly string[] = [...RECONSTRUCTION_SEASONS],
): ReconstructionRow[] {
  const rows: ReconstructionRow[] = [];
  for (let s = 0; s < seasons.length; s += 1) {
    const season = seasons[s] as string;
    const dir = join(NBA_ROOT, season);
    const rosterRaw = readJson(join(dir, 'roster.json')) as unknown;
    const statsListRaw = readJson(join(dir, 'season-stats.json')) as unknown;
    const rosterParsed = z.array(cohortRosterRowSchema).safeParse(rosterRaw);
    const statsParsed = z.array(cohortStatsRowSchema).safeParse(statsListRaw);
    const roster = rosterParsed.success ? rosterParsed.data : [];
    const statsList = statsParsed.success ? statsParsed.data : [];
    const rosterById = new Map<string, CohortRosterRow>();
    for (const player of roster) {
      const extId = player.externalId;
      if (typeof extId === 'string' && extId !== '') rosterById.set(extId, player);
    }
    for (const stats of statsList) {
      const extId = stats.playerExternalId;
      if (typeof extId !== 'string' || extId === '') continue;
      const rosterPlayer = rosterById.get(extId);
      const position = typeof rosterPlayer?.position === 'string' ? rosterPlayer.position : null;
      const row: ReconstructionRow = {
        playerExternalId: extId,
        season,
        seasonIndex: s,
        positionGroup: positionGroupOf(position),
        heightInches:
          intOrNull(stats.heightInches) ??
          (rosterPlayer ? intOrNull(rosterPlayer.heightInches) : null),
        weightLbs:
          intOrNull(stats.weightLbs) ?? (rosterPlayer ? intOrNull(rosterPlayer.weightLbs) : null),
        age: intOrNull(stats.age) ?? (rosterPlayer ? intOrNull(rosterPlayer.age) : null),
        minutes: numberOrNull(stats.minutes) ?? 0,
        fgm: numberOrNull(stats.fgm),
        fga: numberOrNull(stats.fga),
        tpm: numberOrNull(stats.tpm),
        tpa: numberOrNull(stats.tpa),
        ftm: numberOrNull(stats.ftm),
        fta: numberOrNull(stats.fta),
        assists: numberOrNull(stats.assists),
        statsSource: typeof stats.statsSource === 'string' ? stats.statsSource : 'unknown',
      };
      const validated = reconstructionRowSchema.safeParse(row);
      if (validated.success) rows.push(validated.data);
    }
  }
  return rows;
}
export function buildFeatureContext(rows: readonly ReconstructionRow[]): FeatureContext {
  const ftPriors = {} as Record<PositionGroup, number>;
  const twoPctMeans = {} as Record<PositionGroup, number>;
  const missingDefaults = {} as Record<
    PositionGroup,
    {
      heightInches: number;
      weightLbs: number;
      age: number;
    }
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
export const PRIOR_EQUIVALENT_ATTEMPTS = 80;
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
