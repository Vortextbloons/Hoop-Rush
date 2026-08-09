import {
  DEFAULT_SEASONS,
  eraProfile,
  freeze,
  manifest,
  opponent,
  pools,
  ratings,
  runPythonFetch,
} from '@hoop-rush/importer';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.ts';

/**
 * `hoop-rush import <step>` commands: build-time data derivation. Python
 * remains the fetch layer (`scripts/import-nba/fetch_all.py`); every compute
 * step runs natively here against the raw-data JSON snapshots.
 */

function splitList(value: string | null): string[] | null {
  if (value === null || value === '') return null;
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function usageFailure(command: string, input: Record<string, unknown>, message: string): CliReport {
  return makeReport(command, input, {
    failures: [message],
    exitCode: EXIT_USAGE_OR_DATA_ERROR,
  });
}

export const IMPORT_RATINGS_OPTIONS: Record<string, boolean> = {
  seasons: true,
  'force-ratings': false,
  workers: true,
  format: true,
  verbose: false,
};

/** Parses --workers; undefined when absent, usage error when malformed. */
function parseWorkerCount(raw: string | null | undefined): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`--workers must be a positive integer (got "${raw}")`);
  }
  return Math.trunc(n);
}

export async function importRatings(args: {
  seasons?: string | null;
  forceRatings?: boolean;
  workers?: string | null;
}): Promise<CliReport> {
  const seasons = splitList(args.seasons ?? null) ?? DEFAULT_SEASONS;
  try {
    await ratings.run(seasons, args.forceRatings ?? false, parseWorkerCount(args.workers));
  } catch (error) {
    return usageFailure(
      'import ratings',
      { seasons },
      `ratings failed: ${(error as Error).message}`,
    );
  }
  return makeReport(
    'import ratings',
    { seasons, force: args.forceRatings ?? false },
    {
      details: [`rated ${String(seasons.length)} season(s)`],
    },
  );
}

export const IMPORT_POOLS_OPTIONS: Record<string, boolean> = {
  pools: true,
  all: false,
  'no-assets': false,
  workers: true,
  format: true,
  verbose: false,
};

export async function importPools(args: {
  pools?: string | null;
  all?: boolean;
  noAssets?: boolean;
  workers?: string | null;
}): Promise<CliReport> {
  let targets: Array<[string, string]> | null = null;
  if (args.all) {
    try {
      targets = pools.allPoolTargets();
    } catch (error) {
      return usageFailure(
        'import pools',
        {},
        `computing --all targets failed: ${(error as Error).message}`,
      );
    }
  } else {
    const raw = splitList(args.pools ?? null);
    if (raw !== null) {
      try {
        targets = pools.parsePoolTargets(raw);
      } catch (error) {
        return usageFailure('import pools', { pools: raw }, (error as Error).message);
      }
    }
  }
  try {
    await pools.run(targets, !(args.noAssets ?? false), parseWorkerCount(args.workers));
  } catch (error) {
    return usageFailure('import pools', { targets }, `pools failed: ${(error as Error).message}`);
  }
  return makeReport(
    'import pools',
    { targets: targets ?? [['lakers', '1990s']], all: args.all ?? false },
    { details: ['pool build complete'] },
  );
}

export const IMPORT_ERA_PROFILE_OPTIONS: Record<string, boolean> = {
  era: true,
  format: true,
  verbose: false,
};

export function importEraProfile(args: { era?: string | null }): CliReport {
  const eras = splitList(args.era ?? null) ?? undefined;
  try {
    eraProfile.run(eras);
  } catch (error) {
    return usageFailure('import era-profile', { era: eras }, (error as Error).message);
  }
  return makeReport(
    'import era-profile',
    { era: eras ?? 'all' },
    {
      details: ['era simulation profiles written'],
    },
  );
}

export const IMPORT_MANIFEST_OPTIONS: Record<string, boolean> = {
  format: true,
  verbose: false,
};

export function importManifest(): CliReport {
  try {
    manifest.run();
  } catch (error) {
    return usageFailure('import manifest', {}, (error as Error).message);
  }
  return makeReport('import manifest', {}, { details: ['manifest content hashes refreshed'] });
}

export const IMPORT_OPPONENT_OPTIONS: Record<string, boolean> = {
  format: true,
  verbose: false,
};

export function importOpponent(): CliReport {
  try {
    opponent.run();
  } catch (error) {
    return usageFailure('import opponent', {}, (error as Error).message);
  }
  return makeReport(
    'import opponent',
    {},
    {
      details: ['lakers-1990s-opening.json authored'],
    },
  );
}

export const IMPORT_FREEZE_OPTIONS: Record<string, boolean> = {
  report: true,
  era: true,
  format: true,
  verbose: false,
};

export function importFreeze(args: { report?: string | null; era?: string | null }): CliReport {
  const reportPath = args.report ?? null;
  if (reportPath === null || reportPath === '') {
    return usageFailure('import freeze', {}, '--report <calibrate-report.json> is required');
  }
  try {
    freeze.run(reportPath, args.era ?? '1990s');
  } catch (error) {
    return usageFailure('import freeze', { report: reportPath }, (error as Error).message);
  }
  return makeReport(
    'import freeze',
    { report: reportPath },
    {
      details: ['era profile targets frozen'],
    },
  );
}

export const IMPORT_RUN_ALL_OPTIONS: Record<string, boolean> = {
  seasons: true,
  'include-schedule': false,
  'force-stints': false,
  'force-ratings': false,
  workers: true,
  'skip-bbref': false,
  pools: true,
  format: true,
  verbose: false,
};

/**
 * Full pipeline: Python fetch layer (rosters, stints, season stats, schedule,
 * bbref ids) then native ratings, pools, and manifest updates.
 */
export async function importRunAll(args: {
  seasons?: string | null;
  includeSchedule?: boolean;
  forceStints?: boolean;
  forceRatings?: boolean;
  workers?: string | null;
  skipBbref?: boolean;
  pools?: string | null;
}): Promise<CliReport> {
  const seasons = splitList(args.seasons ?? null) ?? DEFAULT_SEASONS;
  const workers = Math.max(1, Math.min(Number(args.workers ?? 6) || 6, seasons.length));
  const rawTargets = splitList(args.pools ?? null);
  let targets: Array<[string, string]> | null = null;
  if (rawTargets !== null) {
    try {
      targets = pools.parsePoolTargets(rawTargets);
    } catch (error) {
      return usageFailure('import run-all', { pools: rawTargets }, (error as Error).message);
    }
  }

  const fetchArgs: string[] = ['--seasons', ...seasons, '--workers', String(workers)];
  if (args.includeSchedule) fetchArgs.push('--include-schedule');
  if (args.forceStints) fetchArgs.push('--force-stints');
  if (args.skipBbref) fetchArgs.push('--skip-bbref');
  const details: string[] = [];
  const failures: string[] = [];

  try {
    await runPythonFetch(fetchArgs);
    details.push(`python fetch layer: ${String(seasons.length)} season(s)`);
  } catch (error) {
    failures.push((error as Error).message);
  }

  if (failures.length === 0) {
    try {
      await ratings.run(seasons, args.forceRatings ?? false, workers);
      details.push(`ratings: ${String(seasons.length)} season(s)`);
    } catch (error) {
      failures.push(`ratings failed: ${(error as Error).message}`);
    }
  }

  if (failures.length === 0) {
    try {
      await pools.run(targets, true, workers);
      details.push('pools: built');
    } catch (error) {
      failures.push(`pools failed: ${(error as Error).message}`);
    }
  }

  return makeReport(
    'import run-all',
    { seasons, workers, includeSchedule: args.includeSchedule ?? false },
    { details, failures },
  );
}
