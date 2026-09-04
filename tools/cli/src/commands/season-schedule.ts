import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  SEASON_COMMITTED_SCHEDULE_SEED,
  seasonLeagueSchema,
  seasonScheduleSchema,
  seedSchema,
  type SeasonLeague,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import { auditSeasonSchedule, generateSeasonSchedule } from '@hoop-rush/engine';
import {
  EXIT_CHECKS_FAILED,
  EXIT_USAGE_OR_DATA_ERROR,
  makeReport,
  type CliReport,
} from '../report.ts';
import {
  seasonScheduleAuditReportSchema,
  seasonScheduleGenerateReportSchema,
} from '../report-schemas.ts';
import { DEFAULT_MANIFEST, REPO_ROOT } from './data-loader.ts';
import { readJson, sha256Hex } from '../io.ts';
export const SEASON_SCHEDULE_GENERATE_OPTIONS: Record<string, boolean> = {
  out: true,
  league: true,
  seed: true,
  format: true,
};
export const SEASON_SCHEDULE_AUDIT_OPTIONS: Record<string, boolean> = {
  schedule: true,
  league: true,
  manifest: true,
  verbose: false,
  format: true,
};
export const DEFAULT_SEASON_LEAGUE = resolve(REPO_ROOT, 'apps/web/static/data/season/league.json');
export const DEFAULT_SEASON_SCHEDULE = resolve(
  REPO_ROOT,
  'apps/web/static/data/season/schedule.json',
);
function serializeSchedule(schedule: SeasonSchedule): string {
  return `${JSON.stringify(schedule)}\n`;
}
function loadLeague(leaguePath: string): SeasonLeague {
  const parsed = seasonLeagueSchema.safeParse(readJson(leaguePath));
  if (!parsed.success) {
    throw new Error(
      `league artifact fails the schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    );
  }
  return parsed.data;
}
export function seasonScheduleGenerate(args: {
  out: string | null;
  league: string | null;
  seed: string | null;
}): CliReport {
  const leaguePath = args.league ?? DEFAULT_SEASON_LEAGUE;
  const rawSeed = args.seed ?? SEASON_COMMITTED_SCHEDULE_SEED;
  const parsedSeed = seedSchema.safeParse(rawSeed);
  if (!parsedSeed.success) {
    return makeReport(
      'season schedule generate',
      { out: args.out, league: leaguePath, seed: rawSeed },
      {
        failures: [`--seed must be a hex seed (got "${rawSeed}")`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const seed = parsedSeed.data;
  let league: SeasonLeague;
  try {
    league = loadLeague(leaguePath);
  } catch (error) {
    return makeReport(
      'season schedule generate',
      { out: args.out, league: leaguePath, seed },
      { failures: [(error as Error).message], exitCode: EXIT_USAGE_OR_DATA_ERROR },
    );
  }
  let schedule: SeasonSchedule;
  try {
    schedule = generateSeasonSchedule({ league, seed });
  } catch (error) {
    return makeReport(
      'season schedule generate',
      { out: args.out, league: leaguePath, seed },
      {
        failures: [`schedule generation failed: ${(error as Error).message}`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const auditFailures = auditSeasonSchedule(schedule, league);
  if (auditFailures.length > 0) {
    return makeReport(
      'season schedule generate',
      { out: args.out, league: leaguePath, seed },
      { failures: auditFailures.map((f) => `audit: ${f}`), exitCode: EXIT_CHECKS_FAILED },
    );
  }
  const content = serializeSchedule(schedule);
  const contentHash = sha256Hex(content);
  const failures: string[] = [];
  const details: string[] = [];
  let wrote = false;
  let outPath: string | null = null;
  if (args.out !== null) {
    const target = resolve(args.out);
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      wrote = true;
      outPath = target;
      details.push(`wrote ${target} (${String(content.length)} bytes)`);
    } catch (error) {
      failures.push(`cannot write ${target}: ${(error as Error).message}`);
    }
  } else {
    details.push('preview only; pass --out <path> to write the artifact');
  }
  const payload = seasonScheduleGenerateReportSchema.parse({
    schemaVersion: 1,
    command: 'season schedule generate',
    seed,
    scheduleVersion: schedule.scheduleVersion,
    formulaVersion: schedule.formulaVersion,
    leagueVersion: schedule.leagueVersion,
    rounds: schedule.rounds,
    games: schedule.games.length,
    sha256: contentHash,
    wrote,
    outPath,
    pass: failures.length === 0,
  });
  details.push(
    `schedule ${schedule.scheduleVersion} · formula ${schedule.formulaVersion} · league ${schedule.leagueVersion}`,
    `rounds ${String(schedule.rounds)} · games ${String(schedule.games.length)} · seed ${seed}`,
    `sha256 ${contentHash}`,
  );
  return makeReport(
    'season schedule generate',
    { out: args.out, league: leaguePath, seed },
    { details, failures, payload },
  );
}
export function seasonScheduleAudit(args: {
  schedule: string | null;
  league: string | null;
  manifest: string | null;
  verbose: boolean;
}): CliReport {
  const leaguePath = args.league ?? DEFAULT_SEASON_LEAGUE;
  const schedulePath = args.schedule ?? DEFAULT_SEASON_SCHEDULE;
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  const input = { schedule: schedulePath, league: leaguePath, manifest: manifestPath };
  let league: SeasonLeague;
  let schedule: SeasonSchedule;
  try {
    league = loadLeague(leaguePath);
    const parsedSchedule = seasonScheduleSchema.safeParse(readJson(schedulePath));
    if (!parsedSchedule.success) {
      throw new Error(
        `schedule artifact fails the schema: ${parsedSchedule.error.issues[0]?.message ?? 'invalid'}`,
      );
    }
    schedule = parsedSchedule.data;
  } catch (error) {
    return makeReport('season schedule audit', input, {
      failures: [(error as Error).message],
      exitCode: EXIT_USAGE_OR_DATA_ERROR,
    });
  }
  const failures: string[] = [];
  const details: string[] = [];
  const scheduleAuditFailures = auditSeasonSchedule(schedule, league);
  failures.push(...scheduleAuditFailures.map((f) => `audit: ${f}`));
  let regenerationIdentical = false;
  try {
    const regenerated = generateSeasonSchedule({ league, seed: schedule.generationSeed });
    regenerationIdentical = JSON.stringify(regenerated) === JSON.stringify(schedule);
    if (!regenerationIdentical) {
      failures.push('regeneration with the committed seed differs from the artifact');
    } else if (args.verbose) {
      details.push('regeneration byte-identical');
    }
  } catch (error) {
    failures.push(`regeneration failed: ${(error as Error).message}`);
  }
  let manifestVerified: boolean | null = null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      season?: {
        league?: {
          url?: string;
          contentHash?: string;
        };
        schedule?: {
          url?: string;
          contentHash?: string;
        };
      };
    };
    const seasonRefs = manifest.season;
    if (seasonRefs?.league === undefined || seasonRefs.schedule === undefined) {
      details.push(`manifest has no season artifact references (${manifestPath})`);
    } else {
      manifestVerified = true;
      const refs: Array<
        [
          string,
          {
            url?: string;
            contentHash?: string;
          },
        ]
      > = [
        ['league', seasonRefs.league],
        ['schedule', seasonRefs.schedule],
      ];
      for (const [name, ref] of refs) {
        const url = ref.url ?? '';
        const expectedHash = ref.contentHash ?? '';
        const artifactPath = isAbsolute(url) ? url : resolve(dirname(manifestPath), url);
        let actualHash: string;
        try {
          actualHash = sha256Hex(readFileSync(artifactPath));
        } catch (error) {
          manifestVerified = false;
          failures.push(`manifest ${name} artifact missing: ${(error as Error).message}`);
          continue;
        }
        if (actualHash !== expectedHash) {
          manifestVerified = false;
          failures.push(`manifest ${name} content hash mismatch (${artifactPath})`);
        } else if (args.verbose) {
          details.push(`manifest ${name} hash verified (${artifactPath})`);
        }
      }
    }
  } catch (error) {
    failures.push(`manifest check failed: ${(error as Error).message}`);
  }
  const payload = seasonScheduleAuditReportSchema.parse({
    schemaVersion: 1,
    command: 'season schedule audit',
    scheduleVersion: schedule.scheduleVersion,
    formulaVersion: schedule.formulaVersion,
    leagueVersion: schedule.leagueVersion,
    seed: schedule.generationSeed,
    rounds: schedule.rounds,
    games: schedule.games.length,
    auditFailures: scheduleAuditFailures.length,
    regenerationIdentical,
    manifestVerified,
    pass: failures.length === 0,
  });
  details.push(
    `schedule ${schedule.scheduleVersion} · formula ${schedule.formulaVersion} · league ${schedule.leagueVersion}`,
    `rounds ${String(schedule.rounds)} · games ${String(schedule.games.length)} · seed ${schedule.generationSeed}`,
    `regeneration ${regenerationIdentical ? 'identical' : 'DIFFERS'} · manifest ${manifestVerified === null ? 'n/a' : manifestVerified ? 'verified' : 'mismatch'}`,
  );
  return makeReport('season schedule audit', input, { details, failures, payload });
}
