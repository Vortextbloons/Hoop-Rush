import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { validateBracketContent, scheduleInvariants } from '@hoop-rush/engine';
import { pools } from '@hoop-rush/importer';
import {
  eraSimulationProfileSchema,
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  opponentBracketSchema,
  playersIndexSchema,
  rosterDetailsSchema,
  REQUIRED_RATING_KEYS,
  SEASON_DRAFT_CATALOG_VERSION,
  SELECTION_SCORE_VERSION,
  seasonFreeAgencyIndexSchema,
  unavailabilityReasonSchema,
  POSITIONS,
  POSITION_NORMALIZATION_VERSION,
  playableSlotGroups,
  type HoopRushManifest,
} from '@hoop-rush/data-contracts';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.ts';
import { sha256Hex } from '../io.ts';
import { DEFAULT_MANIFEST } from './data-loader.ts';

export const DATA_VALIDATE_OPTIONS: Record<string, boolean> = {
  input: true,
  format: true,
  verbose: false,
};

interface AuditResult {
  ok: boolean;
  details: string[];
  failures: string[];
}

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
    for (const [i, current] of sorted.entries()) {
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
      const actualHash = sha256Hex(content);
      if (actualHash !== pool.contentHash) {
        failures.push(`pools: ${key} content hash mismatch (${assetPath})`);
      } else if (verbose) {
        details.push(`pools: ${key} hash verified (${assetPath})`);
      }
      auditPoolContent(content, pool, manifest, failures, details, playerSeasons);
    } catch {
      failures.push(`pools: ${key} asset missing (${assetPath})`);
    }
  }

  details.push(`pools: ${String(manifest.pools.length)} franchise-era pools`);
  return { ok: failures.length === 0, details, failures };
}

function auditPoolContent(
  content: Buffer,
  index: HoopRushManifest['pools'][number],
  manifest: HoopRushManifest,
  failures: string[],
  details: string[],
  playerSeasons: Map<string, string>,
): void {
  const key = `${index.franchiseId}/${index.eraId}`;
  const era = manifest.eras.find((e) => e.eraId === index.eraId);
  let raw: unknown = null;
  try {
    raw = JSON.parse(content.toString('utf8')) as unknown;
  } catch {
    // Fall through to the schema failure below, matching the pre-hash audit.
  }
  const parsed = franchiseEraPoolSchema.safeParse(raw);
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

    for (const ratingKey of REQUIRED_RATING_KEYS) {
      if (!(ratingKey in player.detailedRatings)) {
        failures.push(`pools: ${key} ${player.displayName} missing rating ${ratingKey}`);
      }
    }

    if (
      player.historicalTeamIdentity.seasonKey !== player.seasonKey ||
      !player.historicalTeamIdentity.lineageRuleVersion
    ) {
      failures.push(`pools: ${key} ${player.displayName} missing historical team identity`);
    }

    const engineFields = [
      ...Object.keys(player.detailedRatings),
      ...Object.keys(player.tendencies),
    ];
    for (const field of engineFields) {
      if (!(field in player.provenance)) {
        failures.push(`pools: ${key} ${player.displayName} missing provenance for ${field}`);
      }
    }

    if (player.seasonKey < '1979-80') {
      if (player.stats.threesAttempted !== null || player.stats.threesMade !== null) {
        failures.push(
          `pools: ${key} ${player.displayName} pre-1979 season with three-point observations`,
        );
      }
    }

    const psKey = `${player.franchiseId}/${player.playerExternalId}/${player.seasonKey}`;
    const owner = playerSeasons.get(psKey);
    if (owner !== undefined && owner !== key) {
      failures.push(`pools: ${key} player-season ${psKey} also packaged in ${owner}`);
    }
    playerSeasons.set(psKey, key);
  }

  const guards = pool.players.filter((p) => playableSlotGroups(p.positions.playable).includes('G'));
  const forwards = pool.players.filter((p) =>
    playableSlotGroups(p.positions.playable).includes('F'),
  );
  const centers = pool.players.filter((p) =>
    playableSlotGroups(p.positions.playable).includes('C'),
  );
  if (guards.length < 2 || forwards.length < 2 || centers.length < 1) {
    failures.push(
      `pools: ${key} cannot form G,G,F,F,C (G ${String(guards.length)}, F ${String(forwards.length)}, C ${String(centers.length)})`,
    );
  }

  for (const player of pool.players) {
    const { primary, secondary, playable, sourceLabels, normalizationVersion } = player.positions;
    if (!POSITIONS.includes(primary)) {
      failures.push(`pools: ${key} ${player.displayName} invalid primary position ${primary}`);
    }
    if (!playable.includes(primary)) {
      failures.push(`pools: ${key} ${player.displayName} primary ${primary} missing from playable`);
    }
    for (const position of secondary) {
      if (!playable.includes(position)) {
        failures.push(
          `pools: ${key} ${player.displayName} secondary ${position} missing from playable`,
        );
      }
      if (position === primary) {
        failures.push(
          `pools: ${key} ${player.displayName} secondary ${position} equals primary ${primary}`,
        );
      }
    }
    if (playable.length === 0) {
      failures.push(`pools: ${key} ${player.displayName} empty playable positions`);
    }
    if (sourceLabels.length === 0) {
      failures.push(`pools: ${key} ${player.displayName} empty sourceLabels`);
    }
    if (normalizationVersion !== POSITION_NORMALIZATION_VERSION) {
      failures.push(
        `pools: ${key} ${player.displayName} position normalization ${normalizationVersion} != ${POSITION_NORMALIZATION_VERSION}`,
      );
    }
    if (playableSlotGroups(playable).length < 1) {
      failures.push(`pools: ${key} ${player.displayName} playable positions map to no slot groups`);
    }
  }

  for (const player of pool.players) {
    const rawOverall = pools.rawOverallScoreFor(player, player.summaryRatings);
    const recomputed = pools.selectionScore(
      rawOverall,
      player.summaryRatings.offenseRating,
      player.summaryRatings.defenseRating,
      player.stats.usageRate,
      player.eligibility.teamMinutes,
      player.eligibility.teamGames,
    );
    if (Math.abs(recomputed - player.selectionScore) > 1e-9) {
      failures.push(
        `pools: ${key} ${player.displayName} selectionScore not reproducible (packaged ${String(player.selectionScore)}, recomputed ${String(recomputed)})`,
      );
    }
    if (player.selectionScoreVersion !== SELECTION_SCORE_VERSION) {
      failures.push(
        `pools: ${key} ${player.displayName} selectionScoreVersion ${player.selectionScoreVersion} != ${SELECTION_SCORE_VERSION}`,
      );
    }
  }

  const withFallback = pool.players.filter(
    (p) => p.altIds?.bbref != null || p.altIds?.photoUrl != null,
  ).length;
  details.push(
    `pools: ${key} fallback coverage ${String(withFallback)}/${String(pool.players.length)} · band ${pool.coverageSummary.coverageBand} · lowConfidence ${String(pool.coverageSummary.lowConfidenceShare)}`,
  );

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
      const actualHash = sha256Hex(content);
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
    const actualHash = sha256Hex(content);
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

async function auditGlobalAssets(
  manifest: HoopRushManifest,
  manifestDir: string,
  verbose: boolean,
): Promise<AuditResult> {
  const failures: string[] = [];
  const details: string[] = [];

  if (manifest.playersIndex === undefined && manifest.rosterDetails === undefined) {
    return { ok: true, details, failures };
  }

  const loadAsset = async (
    entry: { url: string; contentHash: string } | undefined,
    label: string,
  ): Promise<{ keys: Set<string>; parsed: unknown } | null> => {
    if (entry === undefined) {
      failures.push(`${label}: manifest has no entry`);
      return null;
    }
    const assetPath = isAbsolute(entry.url) ? entry.url : resolve(manifestDir, entry.url);
    let content: Buffer;
    try {
      content = await readFile(assetPath);
    } catch {
      failures.push(`${label}: asset missing (${assetPath})`);
      return null;
    }
    const actualHash = sha256Hex(content);
    if (actualHash !== entry.contentHash) {
      failures.push(`${label}: content hash mismatch (${assetPath})`);
      return null;
    }
    if (verbose) details.push(`${label}: hash verified (${assetPath})`);
    let raw: unknown;
    try {
      raw = JSON.parse(content.toString('utf8')) as unknown;
    } catch {
      failures.push(`${label}: asset is not valid JSON (${assetPath})`);
      return null;
    }
    return { keys: new Set<string>(), parsed: raw };
  };

  const keyOf = (player: {
    playerId: string;
    franchiseId: string;
    eraId: string;
    seasonKey: string;
  }) => `${player.playerId}/${player.franchiseId}/${player.eraId}/${player.seasonKey}`;

  const indexAsset = await loadAsset(manifest.playersIndex, 'playersIndex');
  if (indexAsset !== null) {
    const parsed = playersIndexSchema.safeParse(indexAsset.parsed);
    if (!parsed.success) {
      failures.push(
        `playersIndex: asset fails the schema: ${parsed.error.issues[0]?.path.join('.') ?? '(root)'} ${parsed.error.issues[0]?.message ?? ''}`,
      );
    } else {
      for (const player of parsed.data.players) {
        const key = keyOf(player);
        if (indexAsset.keys.has(key)) {
          failures.push(`playersIndex: duplicate row ${key}`);
        }
        indexAsset.keys.add(key);
      }
      details.push(`playersIndex: ${String(parsed.data.players.length)} draft rows`);
    }
  }

  const detailsAsset = await loadAsset(manifest.rosterDetails, 'rosterDetails');
  if (detailsAsset !== null) {
    const parsed = rosterDetailsSchema.safeParse(detailsAsset.parsed);
    if (!parsed.success) {
      failures.push(
        `rosterDetails: asset fails the schema: ${parsed.error.issues[0]?.path.join('.') ?? '(root)'} ${parsed.error.issues[0]?.message ?? ''}`,
      );
    } else {
      for (const player of parsed.data.players) {
        const key = keyOf(player);
        if (detailsAsset.keys.has(key)) {
          failures.push(`rosterDetails: duplicate entry ${key}`);
        }
        detailsAsset.keys.add(key);
      }
      details.push(`rosterDetails: ${String(parsed.data.players.length)} detail entries`);
    }
  }

  if (indexAsset !== null && detailsAsset !== null) {
    for (const key of indexAsset.keys) {
      if (!detailsAsset.keys.has(key)) {
        failures.push(`rosterDetails: missing detail for draft row ${key}`);
      }
    }
    for (const key of detailsAsset.keys) {
      if (!indexAsset.keys.has(key)) {
        failures.push(`rosterDetails: orphan detail ${key} with no draft row`);
      }
    }
  }

  return { ok: failures.length === 0, details, failures };
}

async function auditSeasonFreeAgencyIndex(
  manifest: HoopRushManifest,
  manifestDir: string,
  verbose: boolean,
): Promise<AuditResult> {
  const failures: string[] = [];
  const details: string[] = [];
  const entry = manifest.season?.freeAgencyIndex;
  if (entry === undefined) {
    details.push('free-agency-index: none packaged');
    return { ok: true, details, failures };
  }
  const assetPath = isAbsolute(entry.url) ? entry.url : resolve(manifestDir, entry.url);
  let content: Buffer;
  try {
    const info = await stat(assetPath);
    if (!info.isFile()) {
      failures.push(`free-agency-index: asset is not a file (${assetPath})`);
      return { ok: false, details, failures };
    }
    content = await readFile(assetPath);
  } catch {
    failures.push(`free-agency-index: asset missing (${assetPath})`);
    return { ok: false, details, failures };
  }
  const actualHash = sha256Hex(content);
  if (actualHash !== entry.contentHash) {
    failures.push(`free-agency-index: content hash mismatch (${assetPath})`);
  } else if (verbose) {
    details.push(`free-agency-index: hash verified (${assetPath})`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content.toString('utf8')) as unknown;
  } catch {
    failures.push('free-agency-index: artifact is not valid JSON');
    return { ok: false, details, failures };
  }
  const parsed = seasonFreeAgencyIndexSchema.safeParse(raw);
  if (!parsed.success) {
    failures.push(
      `free-agency-index: artifact fails the index schema: ${parsed.error.issues[0]?.path.join('.') ?? '(root)'} ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
    return { ok: failures.length === 0, details, failures };
  }
  const index = parsed.data;
  const draftEntry = manifest.season?.draftCatalog;
  if (draftEntry === undefined) {
    failures.push('free-agency-index: manifest has no season.draftCatalog entry to pin against');
  } else if (index.catalogRef.contentHash !== draftEntry.contentHash) {
    failures.push(
      `free-agency-index: catalogRef content hash ${index.catalogRef.contentHash} does not match the packaged draft catalog ${draftEntry.contentHash}`,
    );
  } else if (index.catalogRef.catalogVersion !== SEASON_DRAFT_CATALOG_VERSION) {
    failures.push(
      `free-agency-index: unexpected catalogVersion ${index.catalogRef.catalogVersion}`,
    );
  }
  const bandCounts = { featured: 0, role: 0, development: 0, emergency: 0 } as Record<
    'featured' | 'role' | 'development' | 'emergency',
    number
  >;
  for (const candidate of index.candidates) {
    bandCounts[candidate.band] += 1;
  }
  details.push(
    `free-agency-index: ${String(index.candidates.length)} candidates · ${String(Object.keys(index.groupedVersions).length)} identities · featured ${String(bandCounts.featured)} / role ${String(bandCounts.role)} / development ${String(bandCounts.development)} / emergency ${String(bandCounts.emergency)} · ${String(content.length)} bytes`,
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
    await auditGlobalAssets(manifest, manifestDir, verbose),
    await auditSeasonFreeAgencyIndex(manifest, manifestDir, verbose),
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
