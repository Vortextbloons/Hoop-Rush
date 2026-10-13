import { z } from 'zod';
import { clamp } from '../json.ts';
import type { StatsRow } from './stats.ts';

const countFields = [
  'points',
  'rebounds',
  'offensiveRebounds',
  'defensiveRebounds',
  'assists',
  'steals',
  'blocks',
  'turnovers',
  'fouls',
  'fgm',
  'fga',
  'tpm',
  'tpa',
  'ftm',
  'fta',
  'insideFgm',
  'insideFga',
  'closeFgm',
  'closeFga',
  'midFgm',
  'midFga',
  'offRebChances',
  'defRebChances',
  'defRimFga',
  'passes',
  'secondaryAssists',
  'potentialAssists',
  'drives',
  'contestedShots',
  'contestedShots2pt',
  'contestedShots3pt',
  'deflections',
  'screenAssists',
  'boxOuts',
  'distanceMiles',
] as const;

export const seasonStatsEvidenceSchema = z.looseObject({
  gamesPlayed: z.number().int().nonnegative().optional(),
  minutes: z.number().nonnegative().nullable().optional(),
  ...Object.fromEntries(
    countFields.map((key) => [key, z.number().nonnegative().nullable().optional()]),
  ),
  tsPct: z.number().min(0).max(1.5).nullable().optional(),
  efgPct: z.number().min(0).max(1.5).nullable().optional(),
  defFgPct: z.number().min(0).max(1).nullable().optional(),
  usageRate: z.number().min(0).max(100).nullable().optional(),
  possessionPace: z.number().min(70).max(150).nullable().optional(),
  leagueTrueShooting: z.number().min(0).max(1).nullable().optional(),
  leagueRimFgPct: z.number().min(0).max(1).nullable().optional(),
  avgSpeed: z.number().nonnegative().nullable().optional(),
  maxVerticalInches: z.number().nonnegative().nullable().optional(),
  wingspanInches: z.number().nonnegative().nullable().optional(),
});

export function observed(stats: StatsRow, key: string): number | null {
  const value = stats[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function possessionExposure(stats: StatsRow, eraPace = 100): number {
  return (
    (Math.max(0, observed(stats, 'minutes') ?? 0) *
      (observed(stats, 'possessionPace') ?? eraPace)) /
    48
  );
}

export function ratePer100(stats: StatsRow, key: string, eraPace = 100): number | null {
  const value = observed(stats, key);
  const exposure = possessionExposure(stats, eraPace);
  return value !== null && exposure > 0 ? (value * 100) / exposure : null;
}

export function stabilizedRate(
  stats: StatsRow,
  key: string,
  prior: number,
  eraPace = 100,
  priorPossessions = 150,
): number {
  const value = observed(stats, key);
  const exposure = possessionExposure(stats, eraPace);
  return value !== null && exposure > 0
    ? (value * 100 + prior * priorPossessions) / (exposure + priorPossessions)
    : prior;
}

export function shootingRate(
  stats: StatsRow,
  made: string,
  attempted: string,
  prior: number,
  priorAttempts: number,
): number | null {
  const makes = observed(stats, made);
  const attempts = observed(stats, attempted);
  if (makes === null || attempts === null || attempts <= 0) return null;
  return (Math.min(makes, attempts) + prior * priorAttempts) / (attempts + priorAttempts);
}

export function trueShooting(stats: StatsRow): number | null {
  const published = observed(stats, 'tsPct');
  if (published !== null && published >= 0 && published <= 1.5) return published;
  const points = observed(stats, 'points');
  const fga = observed(stats, 'fga');
  const fta = observed(stats, 'fta');
  if (points === null || fga === null || fta === null || fga + 0.44 * fta <= 0) return null;
  return clamp(points / (2 * (fga + 0.44 * fta)), 0, 1.5);
}

export function effectiveTrueShooting(stats: StatsRow, eraThreeRate = 0.39): number | null {
  const ts = trueShooting(stats);
  const league = observed(stats, 'leagueTrueShooting') ?? 0.52 + eraThreeRate * 0.15;
  return ts === null ? null : ts + clamp(0.565 - league, -0.07, 0.07);
}

export function usageFor(stats: StatsRow, eraPace = 100): number {
  const reported = observed(stats, 'usageRate');
  const shots = ratePer100(stats, 'fga', eraPace);
  const implied =
    shots === null
      ? null
      : shots +
        0.44 * (ratePer100(stats, 'fta', eraPace) ?? 0) +
        (ratePer100(stats, 'turnovers', eraPace) ?? 0);
  return clamp(
    implied !== null && (reported === null || implied - reported > 8) ? implied : (reported ?? 18),
    0,
    45,
  );
}
