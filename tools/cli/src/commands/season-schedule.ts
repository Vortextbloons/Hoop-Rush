import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
import { sha256Hex } from '../io.ts';
import {
  DEFAULT_MANIFEST,
  manifestSeasonEntry,
  readSeasonArtifact,
  resolveArtifact,
  resolveSeasonArtifact,
} from './season-data.ts';
export const SEASON_SCHEDULE_GENERATE_OPTIONS: Record<string, boolean> = {
  out: true,
  league: true,
  seed: true,
  manifest: true,
  format: true,
};
export const SEASON_SCHEDULE_AUDIT_OPTIONS: Record<string, boolean> = {
  schedule: true,
  league: true,
  manifest: true,
  verbose: false,
  format: true,
};
function serializeSchedule(schedule: SeasonSchedule): string {
  return `${JSON.stringify(schedule)}\n`;
}
function parseJson(label: string, text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${(error as Error).message}`);
  }
}
function loadLeague(leaguePath: string): SeasonLeague {
  const parsed = seasonLeagueSchema.safeParse(
    parseJson('league artifact', readFileSync(leaguePath, 'utf8')),
  );
  if (!parsed.success) {
    throw new Error(
      `league artifact fails the schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    );
  }
  return parsed.data;
}
function loadSchedule(text: string): SeasonSchedule {
  const parsed = seasonScheduleSchema.safeParse(parseJson('schedule artifact', text));
  if (!parsed.success) {
    throw new Error(
      `schedule artifact fails the schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    );
  }
  return parsed.data;
}
function publishScheduleDeclaration(manifestPath: string, url: string, contentHash: string): void {
  const manifest = parseJson('manifest', readFileSync(manifestPath, 'utf8')) as {
    season?: Record<string, unknown>;
  };
  manifest.season = manifest.season ?? {};
  manifest.season.schedule = { url, contentHash };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
export function seasonScheduleGenerate(args: {
  out: string | null;
  league: string | null;
  seed: string | null;
  manifest: string | null;
}): CliReport {
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  const rawSeed = args.seed ?? SEASON_COMMITTED_SCHEDULE_SEED;
  const parsedSeed = seedSchema.safeParse(rawSeed);
  if (!parsedSeed.success) {
    return makeReport(
      'season schedule generate',
      { out: args.out, league: args.league, seed: rawSeed },
      {
        failures: [`--seed must be a hex seed (got "${rawSeed}")`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const seed = parsedSeed.data;
  let leaguePath: string;
  if (args.league !== null) {
    leaguePath = args.league;
  } else {
    try {
      leaguePath = resolveSeasonArtifact(manifestPath, 'league').path;
    } catch (error) {
      return makeReport(
        'season schedule generate',
        { out: args.out, league: null, seed },
        { failures: [(error as Error).message], exitCode: EXIT_USAGE_OR_DATA_ERROR },
      );
    }
  }
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
  let published = false;
  if (args.out !== null) {
    const target = resolve(args.out);
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      wrote = true;
      outPath = target;
      details.push(`wrote ${target} (${String(content.length)} bytes)`);
      const declaredEntry = manifestSeasonEntry(manifestPath, 'schedule');
      if (declaredEntry?.url === undefined || declaredEntry.url === '') {
        details.push(
          `manifest ${manifestPath} declares no season.schedule url; declaration not published`,
        );
      } else {
        const declaredPath = resolveArtifact(dirname(manifestPath), declaredEntry.url);
        if (resolve(declaredPath) === target) {
          publishScheduleDeclaration(manifestPath, declaredEntry.url, contentHash);
          published = true;
          details.push(`published season.schedule contentHash to ${manifestPath}`);
        } else {
          details.push(
            `manifest declaration unchanged (declared ${declaredPath}); write to the declared path to publish`,
          );
        }
      }
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
    manifestPath,
    published,
    pass: failures.length === 0,
  });
  details.push(
    `schedule ${schedule.scheduleVersion} · formula ${schedule.formulaVersion} · league ${schedule.leagueVersion}`,
    `rounds ${String(schedule.rounds)} · games ${String(schedule.games.length)} · seed ${seed}`,
    `sha256 ${contentHash}${published ? ' · published to manifest' : ''}`,
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
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  let scheduleRef: ReturnType<typeof resolveSeasonArtifact>;
  let leagueRef: ReturnType<typeof resolveSeasonArtifact>;
  try {
    scheduleRef = resolveSeasonArtifact(manifestPath, 'schedule');
    leagueRef = resolveSeasonArtifact(manifestPath, 'league');
  } catch (error) {
    return makeReport(
      'season schedule audit',
      { schedule: args.schedule, league: args.league, manifest: manifestPath },
      { failures: [(error as Error).message], exitCode: EXIT_USAGE_OR_DATA_ERROR },
    );
  }
  const failures: string[] = [];
  const details: string[] = [];
  const scheduleRead = readSeasonArtifact(scheduleRef, args.schedule ?? undefined);
  const leagueRead = readSeasonArtifact(leagueRef, args.league ?? undefined);
  if (!scheduleRead.matches) {
    failures.push(
      `schedule content hash mismatch: expected ${scheduleRef.contentHash}, got ${scheduleRead.actualHash} (${scheduleRead.path})`,
    );
  } else if (args.verbose) {
    details.push(`manifest schedule hash verified (${scheduleRead.path})`);
  }
  if (!leagueRead.matches) {
    failures.push(
      `league content hash mismatch: expected ${leagueRef.contentHash}, got ${leagueRead.actualHash} (${leagueRead.path})`,
    );
  } else if (args.verbose) {
    details.push(`manifest league hash verified (${leagueRead.path})`);
  }
  const manifestVerified = scheduleRead.matches && leagueRead.matches;
  const input = {
    schedule: scheduleRead.path,
    league: leagueRead.path,
    manifest: manifestPath,
  };
  let league: SeasonLeague;
  let schedule: SeasonSchedule;
  try {
    league = loadLeague(leagueRead.path);
    schedule = loadSchedule(scheduleRead.bytes.toString('utf8'));
  } catch (error) {
    failures.push((error as Error).message);
    return makeReport('season schedule audit', input, {
      failures,
      exitCode: EXIT_USAGE_OR_DATA_ERROR,
    });
  }
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
    `regeneration ${regenerationIdentical ? 'identical' : 'DIFFERS'} · manifest ${manifestVerified ? 'verified' : 'mismatch'}`,
  );
  return makeReport('season schedule audit', input, { details, failures, payload });
}
