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
  unavailabilityReasonSchema,
  type HoopRushManifest,
} from '@hoop-rush/data-contracts';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.js';

/**
 * `hoop-rush data validate`: validates the v2 manifest and every referenced
 * artifact: schema/hash/version consistency, the 30-slot lineage model, the
 * complete availability matrix, strict engine fields, lineage ownership,
 * cross-slot duplicates, legal lineup coverage, and peak reproducibility
 * (spec/09, spec/12).
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

/** Exactly 30 modern slots; lineage segments owned by one slot, non-overlapping. */
function auditLineage(manifest: HoopRushManifest): AuditResult {
  const failures: string[] = [];
  const details: string[] = [];

  const slotIds = new Set(manifest.modernFranchiseSlots.map((s) => s.franchiseId));
  if (manifest.modernFranchiseSlots.length !== 30) {
    failures.push(
      `lineage: exactly 30 modern slots required (got ${String(manifest.modernFranchiseSlots.length)})`,
    );
  }
  if (slotIds.size !== manifest.modernFranchiseSlots.length) {
    failures.push('lineage: duplicate modern slot ids');
  }

  const bySlot = new Map<string, typeof manifest.franchiseLineage>();
  for (const segment of manifest.franchiseLineage) {
    if (!slotIds.has(segment.modernFranchiseId)) {
      failures.push(
        `lineage: segment ${segment.historicalTeamId} references unknown slot ${segment.modernFranchiseId}`,
      );
    }
    if (!segment.sourceIdentityIds.includes(segment.historicalTeamId)) {
      failures.push(`lineage: ${segment.historicalTeamId} missing from sourceIdentityIds`);
    }
    const list = bySlot.get(segment.modernFranchiseId) ?? [];
    list.push(segment);
    bySlot.set(segment.modernFranchiseId, list);
  }
  for (const [franchiseId, segments] of bySlot) {
    const sorted = [...segments].sort((a, b) =>
      a.validFromSeasonKey.localeCompare(b.validFromSeasonKey),
    );
    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i]!;
      if (
        current.validThroughSeasonKey !== undefined &&
        current.validThroughSeasonKey < current.validFromSeasonKey
      ) {
        failures.push(`lineage: ${franchiseId} inverted range ${current.validFromSeasonKey}`);
      }
      const next = sorted[i + 1];
      if (
        next &&
        current.validThroughSeasonKey !== undefined &&
        next.validFromSeasonKey <= current.validThroughSeasonKey
      ) {
        failures.push(
          `lineage: ${franchiseId} overlapping ranges ${current.validThroughSeasonKey} vs ${next.validFromSeasonKey}`,
        );
      }
    }
  }

  details.push(
    `lineage: ${String(manifest.modernFranchiseSlots.length)} slots · ${String(manifest.franchiseLineage.length)} segments`,
  );
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

/** The availability matrix must be complete: exactly one entry per slot x era. */
function auditAvailability(manifest: HoopRushManifest): AuditResult {
  const failures: string[] = [];
  const details: string[] = [];
  const seen = new Set<string>();
  const poolByKey = new Map(manifest.pools.map((p) => [`${p.franchiseId}/${p.eraId}`, p]));

  for (const entry of manifest.availability) {
    const key = `${entry.franchiseId}/${entry.eraId}`;
    if (seen.has(key)) {
      failures.push(`availability: duplicate entry ${key}`);
    }
    seen.add(key);
    if (entry.status === 'available') {
      const pool = poolByKey.get(key);
      if (!pool) {
        failures.push(`availability: ${key} available without a pools index entry`);
      } else if (pool.url !== entry.url || pool.contentHash !== entry.contentHash) {
        failures.push(`availability: ${key} index/hash mismatch`);
      }
      if (entry.playerCount <= 0) {
        failures.push(`availability: ${key} playerCount must be positive`);
      }
    } else {
      if (!unavailabilityReasonSchema.safeParse(entry.reason).success) {
        failures.push(`availability: ${key} invalid reason`);
      }
      if (entry.reason === 'no-franchise-history' && !entry.firstSupportedSeason) {
        failures.push(`availability: ${key} no-franchise-history without firstSupportedSeason`);
      }
    }
  }

  const expected = manifest.modernFranchiseSlots.length * manifest.eras.length;
  const found = new Set(
    [...seen].map((key) => {
      const slash = key.indexOf('/');
      return `${key.slice(0, slash)}/${key.slice(slash + 1)}`;
    }),
  );
  for (const slot of manifest.modernFranchiseSlots) {
    for (const era of manifest.eras) {
      if (!found.has(`${slot.franchiseId}/${era.eraId}`)) {
        failures.push(`availability: missing entry ${slot.franchiseId}/${era.eraId}`);
      }
    }
  }
  details.push(
    `availability: ${String(manifest.availability.length)}/${String(expected)} matrix entries`,
  );
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
  const slotIds = new Set(manifest.modernFranchiseSlots.map((s) => s.franchiseId));
  const eraIds = new Set(manifest.eras.map((e) => e.eraId));
  // Cross-slot duplication: one (playerExternalId, seasonKey) at most once.
  const playerSeasons = new Map<string, string>();

  for (const pool of manifest.pools) {
    const key = `${pool.franchiseId}/${pool.eraId}`;
    if (keys.has(key)) {
      failures.push(`pools: duplicate entry ${key}`);
    }
    keys.add(key);
    if (!slotIds.has(pool.franchiseId)) {
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
      auditPoolContent(assetPath, pool, manifest, failures, details, playerSeasons);
    } catch {
      failures.push(`pools: ${key} asset missing (${assetPath})`);
    }
  }

  details.push(`pools: ${String(manifest.pools.length)} franchise-era pools`);
  return { ok: failures.length === 0, details, failures };
}

/**
 * Content audits for a pool asset (spec/12 identity, provenance, lineup, and
 * reproducibility gates): schema validity, unique player ids, era membership,
 * 40-game eligibility, strict engine fields, complete provenance, historical
 * identity, legal G,G,F,F,C coverage, cross-slot duplication, and reproducible
 * peak selection.
 */
function auditPoolContent(
  assetPath: string,
  index: HoopRushManifest['pools'][number],
  manifest: HoopRushManifest,
  failures: string[],
  details: string[],
  playerSeasons: Map<string, string>,
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
  const requiredRatingKeys = [
    'insideScoring',
    'closeShot',
    'midrange',
    'threePoint',
    'freeThrow',
    'ballHandling',
    'passing',
    'offensiveIq',
    'offensiveRebound',
    'defensiveRebound',
    'perimeterDefense',
    'interiorDefense',
    'steal',
    'block',
    'defensiveIq',
    'speed',
    'strength',
    'vertical',
  ];
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

    // Strict engine contracts: every required rating/tendency key present.
    for (const ratingKey of requiredRatingKeys) {
      if (!(ratingKey in player.detailedRatings)) {
        failures.push(`pools: ${key} ${player.displayName} missing rating ${ratingKey}`);
      }
    }
    if (player.anchors === undefined || player.anchors === null) {
      failures.push(`pools: ${key} ${player.displayName} missing packaged anchors`);
    }

    // Historical identity: the team that owned the season, with lineage version.
    if (
      !player.historicalTeamIdentity ||
      player.historicalTeamIdentity.seasonKey !== player.seasonKey ||
      !player.historicalTeamIdentity.lineageRuleVersion
    ) {
      failures.push(`pools: ${key} ${player.displayName} missing historical team identity`);
    }

    // Field-level provenance on required engine fields.
    const engineFields = [
      ...Object.keys(player.detailedRatings),
      ...Object.keys(player.tendencies),
    ];
    for (const field of engineFields) {
      const provenance = player.provenance[field];
      if (!provenance || !provenance.kind || !provenance.methodVersion) {
        failures.push(`pools: ${key} ${player.displayName} missing provenance for ${field}`);
      }
    }

    // Pre-1979 seasons never carry three-point observations.
    if (player.seasonKey < '1979-80') {
      if (player.stats.threesAttempted !== null || player.stats.threesMade !== null) {
        failures.push(
          `pools: ${key} ${player.displayName} pre-1979 season with three-point observations`,
        );
      }
    }

    // Cross-slot duplication: (playerExternalId, seasonKey) at most once.
    const psKey = `${player.playerExternalId}/${player.seasonKey}`;
    const owner = playerSeasons.get(psKey);
    if (owner !== undefined && owner !== key) {
      failures.push(`pools: ${key} player-season ${psKey} also packaged in ${owner}`);
    }
    playerSeasons.set(psKey, key);
  }

  // Legal G,G,F,F,C lineup coverage from packaged canonical positions.
  const guards = pool.players.filter((p) => p.positions.canonical.includes('G'));
  const forwards = pool.players.filter((p) => p.positions.canonical.includes('F'));
  const centers = pool.players.filter((p) => p.positions.canonical.includes('C'));
  if (guards.length < 2 || forwards.length < 2 || centers.length < 1) {
    failures.push(
      `pools: ${key} cannot form G,G,F,F,C (G ${String(guards.length)}, F ${String(forwards.length)}, C ${String(centers.length)})`,
    );
  }

  // Peak reproducibility: selectionScore recomputed from packaged fields.
  const structure = ['G', 'G', 'F', 'F', 'C'];
  void structure;
  for (const player of pool.players) {
    const usage = Math.min(Math.max(player.stats.usageRate ?? 0, 0), 40);
    const mpg = Math.min(
      player.eligibility.teamMinutes / Math.max(1, player.eligibility.teamGames),
      48,
    );
    const recomputed =
      Math.round(
        (0.5 * player.summaryRatings.overallRating +
          0.3 * player.summaryRatings.offenseRating +
          0.2 * player.summaryRatings.defenseRating +
          0.05 * usage +
          0.02 * mpg) *
          1000,
      ) / 1000;
    if (Math.abs(recomputed - player.selectionScore) > 1e-9) {
      failures.push(
        `pools: ${key} ${player.displayName} selectionScore not reproducible (packaged ${String(player.selectionScore)}, recomputed ${String(recomputed)})`,
      );
    }
  }

  const withFallback = pool.players.filter(
    (p) => p.altIds?.bbref != null || p.altIds?.photoUrl != null,
  ).length;
  details.push(
    `pools: ${key} fallback coverage ${String(withFallback)}/${String(pool.players.length)} · band ${pool.coverageSummary.coverageBand} · lowConfidence ${String(pool.coverageSummary.lowConfidenceShare)}`,
  );
  // Every player must carry an explicit CDN availability marker whenever a
  // primary headshot template exists: without it, the UI requests the CDN URL
  // first and gets stuck on the generic silhouette, never reaching the
  // secondary/photo backups (regression: pools built with --no-assets).
  if (manifest.assets.headshotUrlTemplate) {
    const missingMarker = pool.players.filter((p) => p.altIds?.nbaHeadshotAvailable == null);
    if (missingMarker.length > 0) {
      failures.push(
        `pools: ${key} ${String(missingMarker.length)} players lack nbaHeadshotAvailable while a primary headshot template is configured`,
      );
    }
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
    auditAvailability(manifest),
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
