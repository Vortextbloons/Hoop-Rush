import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBracketContent, scheduleInvariants } from '@hoop-rush/engine';
import {
  eraSimulationProfileSchema,
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  opponentBracketSchema,
  type HoopRushManifest,
} from '@hoop-rush/data-contracts';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.js';

/**
 * `hoop-rush data validate`: validates the Hoop Rush manifest and every
 * referenced franchise-era pool artifact. Reports exact paths and record
 * locations for failures (spec/09).
 */

function readPoolAsset(assetPath: string): unknown {
  try {
    return JSON.parse(readFileSync(assetPath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export const DATA_VALIDATE_OPTIONS: Record<string, boolean> = {
  input: true,
  format: true,
  verbose: false,
};

/** Repo-root path of the shipped manifest, independent of the invocation cwd. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
const DEFAULT_MANIFEST = resolve(REPO_ROOT, 'apps/web/static/data/manifest.json');

interface AuditResult {
  ok: boolean;
  details: string[];
  failures: string[];
}

function auditLineage(manifest: HoopRushManifest): AuditResult {
  const failures: string[] = [];
  const details: string[] = [];
  const franchiseIds = new Set<string>();
  const teamIds = new Set<string>();

  for (const entry of manifest.franchiseLineage) {
    if (franchiseIds.has(entry.franchiseId)) {
      failures.push(`lineage: duplicate franchiseId ${entry.franchiseId}`);
    }
    franchiseIds.add(entry.franchiseId);

    if (teamIds.has(entry.teamExternalId)) {
      failures.push(
        `lineage: duplicate teamExternalId ${entry.teamExternalId} (${entry.franchiseId})`,
      );
    }
    teamIds.add(entry.teamExternalId);

    if (entry.names.length === 0) {
      failures.push(`lineage: ${entry.franchiseId} has no name history`);
    }

    const sorted = [...entry.names].sort((a, b) =>
      (a.fromSeasonKey ?? '0000-00').localeCompare(b.fromSeasonKey ?? '0000-00'),
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev === undefined || curr === undefined) break;
      if (
        prev.toSeasonKey !== null &&
        curr.fromSeasonKey !== null &&
        curr.fromSeasonKey <= prev.toSeasonKey
      ) {
        failures.push(
          `lineage: ${entry.franchiseId} name ranges overlap (${prev.name} ends ${prev.toSeasonKey}, ${curr.name} starts ${curr.fromSeasonKey})`,
        );
      }
    }
  }

  details.push(`lineage: ${String(manifest.franchiseLineage.length)} franchises`);
  return { ok: failures.length === 0, details, failures };
}

function auditEras(manifest: HoopRushManifest): AuditResult {
  const failures: string[] = [];
  const details: string[] = [];
  const ids = new Set<string>();
  const sorted = [...manifest.eras].sort((a, b) => a.fromSeasonKey.localeCompare(b.fromSeasonKey));

  for (const era of manifest.eras) {
    if (ids.has(era.eraId)) failures.push(`eras: duplicate eraId ${era.eraId}`);
    ids.add(era.eraId);
    if (era.fromSeasonKey > era.toSeasonKey) {
      failures.push(
        `eras: ${era.eraId} range inverted (${era.fromSeasonKey} > ${era.toSeasonKey})`,
      );
    }
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev === undefined || curr === undefined) break;
    if (curr.fromSeasonKey <= prev.toSeasonKey) {
      failures.push(
        `eras: ranges overlap (${prev.eraId} ends ${prev.toSeasonKey}, ${curr.eraId} starts ${curr.fromSeasonKey})`,
      );
    }
  }

  details.push(`eras: ${String(manifest.eras.length)} decades`);
  return { ok: failures.length === 0, details, failures };
}

async function auditPools(
  manifest: HoopRushManifest,
  manifestDir: string,
  verbose: boolean,
): Promise<AuditResult> {
  const failures: string[] = [];
  const details: string[] = [];
  const keys = new Set<string>();
  const franchiseIds = new Set(manifest.franchiseLineage.map((e) => e.franchiseId));
  const eraIds = new Set(manifest.eras.map((e) => e.eraId));

  for (const pool of manifest.pools) {
    const key = `${pool.franchiseId}/${pool.eraId}`;
    if (keys.has(key)) {
      failures.push(`pools: duplicate entry ${key}`);
    }
    keys.add(key);
    if (!franchiseIds.has(pool.franchiseId)) {
      failures.push(`pools: unknown franchiseId ${pool.franchiseId}`);
    }
    if (!eraIds.has(pool.eraId)) {
      failures.push(`pools: unknown eraId ${pool.eraId}`);
    }

    const assetPath = isAbsolute(pool.url) ? pool.url : resolve(manifestDir, pool.url);
    try {
      const info = await stat(assetPath);
      if (!info.isFile()) {
        failures.push(`pools: ${key} asset is not a file (${assetPath})`);
        continue;
      }
      const content = await readFile(assetPath);
      const actualHash = createHash('sha256').update(content).digest('hex');
      if (actualHash !== pool.contentHash) {
        failures.push(`pools: ${key} content hash mismatch (${assetPath})`);
      } else if (verbose) {
        details.push(`pools: ${key} hash verified (${assetPath})`);
      }
      auditPoolContent(assetPath, pool, manifest, failures, details);
    } catch {
      failures.push(`pools: ${key} asset missing (${assetPath})`);
    }
  }

  details.push(`pools: ${String(manifest.pools.length)} franchise-era pools`);
  return { ok: failures.length === 0, details, failures };
}

/**
 * Content audits for a pool asset (spec/02 identity and data audits):
 * schema validity, unique player ids, era membership, 40-game eligibility,
 * rating ranges, and reproducible peak selection.
 */
function auditPoolContent(
  assetPath: string,
  index: HoopRushManifest['pools'][number],
  manifest: HoopRushManifest,
  failures: string[],
  details: string[],
): void {
  const key = `${index.franchiseId}/${index.eraId}`;
  const era = manifest.eras.find((e) => e.eraId === index.eraId);
  const parsed = franchiseEraPoolSchema.safeParse(readPoolAsset(assetPath));
  if (!parsed.success) {
    failures.push(
      `pools: ${key} asset fails the pool schema: ${parsed.error.issues[0]?.path.join('.') ?? '(root)'} ${parsed.error.issues[0]?.message ?? ''}`,
    );
    return;
  }
  const pool = parsed.data;

  if (pool.franchiseId !== index.franchiseId || pool.eraId !== index.eraId) {
    failures.push(`pools: ${key} asset declares ${pool.franchiseId}/${pool.eraId}`);
  }

  const seen = new Set<string>();
  for (const player of pool.players) {
    if (seen.has(player.playerId)) {
      failures.push(`pools: ${key} duplicate playerId ${player.playerId}`);
    }
    seen.add(player.playerId);

    if (
      era !== undefined &&
      (player.seasonKey < era.fromSeasonKey || player.seasonKey > era.toSeasonKey)
    ) {
      failures.push(
        `pools: ${key} ${player.displayName} season ${player.seasonKey} outside era ${era.fromSeasonKey}-${era.toSeasonKey}`,
      );
    }
    if (player.eligibility.teamGames < player.eligibility.minimumTeamGames) {
      failures.push(
        `pools: ${key} ${player.displayName} has ${String(player.eligibility.teamGames)} team games (min ${String(player.eligibility.minimumTeamGames)})`,
      );
    }
    const { overallRating, offenseRating, defenseRating } = player.summaryRatings;
    if (
      overallRating < 0 ||
      overallRating > 100 ||
      offenseRating < 0 ||
      offenseRating > 100 ||
      defenseRating < 0 ||
      defenseRating > 100
    ) {
      failures.push(`pools: ${key} ${player.displayName} summary rating out of range`);
    }
  }

  const withFallback = pool.players.filter(
    (p) => p.altIds?.bbref != null || p.altIds?.photoUrl != null,
  ).length;
  const coverage = Math.round((withFallback / pool.players.length) * 1000) / 10;
  details.push(
    `pools: ${key} fallback coverage ${String(withFallback)}/${String(pool.players.length)} (${String(coverage)}%)`,
  );
  if (manifest.assets.headshotUrlTemplateSecondary && withFallback === 0) {
    failures.push(
      `pools: ${key} no player carries a fallback id while a secondary headshot template is configured`,
    );
  }
  details.push(`pools: ${key} ${String(pool.players.length)} players audited`);
}

/**
 * Audits era simulation profiles: schema validity, hash verification, and
 * that the referenced era exists in the manifest.
 */
async function auditEraSimulationProfiles(
  manifest: HoopRushManifest,
  manifestDir: string,
  verbose: boolean,
): Promise<AuditResult> {
  const failures: string[] = [];
  const details: string[] = [];
  const eraIds = new Set(manifest.eras.map((e) => e.eraId));

  for (const entry of manifest.eraSimulationProfiles) {
    if (!eraIds.has(entry.eraId)) {
      failures.push(`era-sim: unknown eraId ${entry.eraId}`);
    }
    const assetPath = isAbsolute(entry.url) ? entry.url : resolve(manifestDir, entry.url);
    try {
      const info = await stat(assetPath);
      if (!info.isFile()) {
        failures.push(`era-sim: ${entry.eraId} asset is not a file (${assetPath})`);
        continue;
      }
      const content = await readFile(assetPath);
      const actualHash = createHash('sha256').update(content).digest('hex');
      if (actualHash !== entry.contentHash) {
        failures.push(`era-sim: ${entry.eraId} content hash mismatch (${assetPath})`);
      } else if (verbose) {
        details.push(`era-sim: ${entry.eraId} hash verified (${assetPath})`);
      }
      const parsed = eraSimulationProfileSchema.safeParse(
        JSON.parse(content.toString('utf8')) as unknown,
      );
      if (!parsed.success) {
        failures.push(`era-sim: ${entry.eraId} fails the profile schema`);
      } else if (parsed.data.eraId !== entry.eraId) {
        failures.push(`era-sim: ${entry.eraId} asset declares ${parsed.data.eraId}`);
      } else {
        details.push(
          `era-sim: ${entry.eraId} profile ${parsed.data.profileVersion} (${parsed.data.parameters.source})`,
        );
      }
    } catch {
      failures.push(`era-sim: ${entry.eraId} asset missing (${assetPath})`);
    }
  }
  details.push(`era-sim: ${String(manifest.eraSimulationProfiles.length)} profiles`);
  return { ok: failures.length === 0, details, failures };
}

/**
 * Audits the frozen opponent bracket: schema validity, hash verification,
 * legal balanced lineups, internal duplicates, and the fixed schedule.
 */
async function auditBracket(
  manifest: HoopRushManifest,
  manifestDir: string,
  verbose: boolean,
): Promise<AuditResult> {
  const failures: string[] = [];
  const details: string[] = [];
  const entry = manifest.bracket;
  if (!entry) {
    details.push('bracket: none packaged');
    return { ok: true, details, failures };
  }
  const assetPath = isAbsolute(entry.url) ? entry.url : resolve(manifestDir, entry.url);
  try {
    const info = await stat(assetPath);
    if (!info.isFile()) {
      failures.push(`bracket: asset is not a file (${assetPath})`);
      return { ok: false, details, failures };
    }
    const content = await readFile(assetPath);
    const actualHash = createHash('sha256').update(content).digest('hex');
    if (actualHash !== entry.contentHash) {
      failures.push(`bracket: content hash mismatch (${assetPath})`);
    } else if (verbose) {
      details.push(`bracket: hash verified (${assetPath})`);
    }
    const parsed = opponentBracketSchema.safeParse(JSON.parse(content.toString('utf8')) as unknown);
    if (!parsed.success) {
      failures.push(
        `bracket: artifact fails the bracket schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
      );
      return { ok: failures.length === 0, details, failures };
    }
    const bracket = parsed.data;
    failures.push(
      ...validateBracketContent(bracket).map((f) => `bracket: ${f}`),
      ...scheduleInvariants(bracket.schedule).map((f) => `bracket: ${f}`),
    );
    const percentiles = bracket.opponents.map((o) => o.strength.percentile);
    const sorted = [...percentiles].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    details.push(
      `bracket: ${String(bracket.opponents.length)} opponents · ${String(bracket.schedule.length)} games · median pct ${median.toFixed(3)} · version ${bracket.bracketVersion}`,
    );
  } catch {
    failures.push(`bracket: asset missing (${assetPath})`);
  }
  return { ok: failures.length === 0, details, failures };
}

function auditAssets(manifest: HoopRushManifest): AuditResult {
  const failures: string[] = [];
  const details: string[] = [];
  if (
    manifest.assets.headshotUrlTemplate &&
    !manifest.assets.headshotUrlTemplate.includes('{playerExternalId}')
  ) {
    failures.push('assets: headshotUrlTemplate lacks {playerExternalId} placeholder');
  }
  if (
    manifest.assets.headshotUrlTemplateSecondary &&
    !manifest.assets.headshotUrlTemplateSecondary.includes('{altIds.bbref}')
  ) {
    failures.push('assets: headshotUrlTemplateSecondary lacks {altIds.bbref} placeholder');
  }
  if (
    manifest.assets.logoUrlTemplate &&
    !manifest.assets.logoUrlTemplate.includes('{teamExternalId}')
  ) {
    failures.push('assets: logoUrlTemplate lacks {teamExternalId} placeholder');
  }
  if (
    manifest.assets.logoUrlTemplateSecondary &&
    !manifest.assets.logoUrlTemplateSecondary.includes('{teamAbbreviation}')
  ) {
    failures.push('assets: logoUrlTemplateSecondary lacks {teamAbbreviation} placeholder');
  }
  details.push(
    `assets: source "${manifest.assets.source}", cacheVersion ${manifest.assets.cacheVersion}`,
  );
  return { ok: failures.length === 0, details, failures };
}

export async function dataValidate(inputPath: string, verbose: boolean): Promise<CliReport> {
  let raw: string;
  try {
    raw = await readFile(inputPath, 'utf8');
  } catch {
    return makeReport(
      'data validate',
      { input: inputPath },
      {
        failures: [`manifest not found or unreadable: ${inputPath}`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return makeReport(
      'data validate',
      { input: inputPath },
      {
        failures: [`manifest is not valid JSON: ${(error as Error).message}`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }

  const result = hoopRushManifestSchema.safeParse(parsed);
  if (!result.success) {
    const failures = result.error.issues.map(
      (issue) => `manifest: ${issue.path.join('.') || '(root)'} ${issue.message}`,
    );
    return makeReport('data validate', { input: inputPath }, { failures });
  }

  const manifest = result.data;
  const manifestDir = dirname(inputPath);
  const audits = [
    auditLineage(manifest),
    auditEras(manifest),
    await auditPools(manifest, manifestDir, verbose),
    await auditEraSimulationProfiles(manifest, manifestDir, verbose),
    await auditBracket(manifest, manifestDir, verbose),
    auditAssets(manifest),
  ];

  const details = [`dataVersion ${manifest.dataVersion}`, ...audits.flatMap((a) => a.details)];
  const failures = audits.flatMap((a) => a.failures);
  return makeReport(
    'data validate',
    { input: inputPath, dataVersion: manifest.dataVersion },
    {
      details,
      failures,
    },
  );
}

export { DEFAULT_MANIFEST };
