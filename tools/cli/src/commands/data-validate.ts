import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  validateBracketContent,
  scheduleInvariants,
  validateCollectionProgressionRules,
} from '@hoop-rush/engine';
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
  COLLECTION_CATALOG_VERSION,
  COLLECTION_DIFFICULTY_ORDER,
  COLLECTION_DIFFICULTY_VERSION,
  COLLECTION_ECONOMY_VERSION,
  COLLECTION_GAME_FIRST_CLEAR_COINS,
  COLLECTION_GAME_REWARD_LOSS_COINS,
  COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS,
  COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT,
  COLLECTION_GAME_REWARD_OBJECTIVE_COINS,
  COLLECTION_GAME_REWARD_WIN_COINS,
  COLLECTION_GAME_RULES_VERSION,
  COLLECTION_GAME_V2_REPLAY_VERSION,
  COLLECTION_GAME_V2_VERSION,
  COLLECTION_OBJECTIVE_VERSION,
  COLLECTION_OVERLAY_VERSION,
  COLLECTION_PACK_RULES_VERSION,
  COLLECTION_RARITY_ORDER,
  COLLECTION_REWARD_V2_VERSION,
  COLLECTION_TEAM_VERSION,
  canonicalJson,
  collectionCatalogSchema,
  collectionGameRulesSchema,
  collectionIndexSchema,
  collectionProgressionRulesSchema,
  collectionProgressionTargetsSchema,
  collectionScaleRewardCoins,
  seasonFreeAgencyIndexSchema,
  seasonGameTargetsSchema,
  seasonSponsorsIndexSchema,
  SEASON_SPONSOR_GEAR_CATALOG,
  unavailabilityReasonSchema,
  POSITIONS,
  POSITION_NORMALIZATION_VERSION,
  playableSlotGroups,
  type CollectionCatalog,
  type CollectionProgressionRules,
  type HoopRushManifest,
  type OpponentIndexEntry,
} from '@hoop-rush/data-contracts';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.ts';
import { sha256Hex } from '../io.ts';
import {
  COLLECTION_LAUNCH_CHALLENGES,
  COLLECTION_TARGET_MULTIPLIER_BP,
  collectionLaunchSetRewardDefinitions,
} from '../collection-progression-constants.ts';
import { DEFAULT_MANIFEST } from './data-loader.ts';
import { collectionGameTargetsSchema } from './collection-game-calibrate.ts';
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
async function loadUnavailablePools(manifestDir: string): Promise<Map<string, string>> {
  const unavailable = new Map<string, string>();
  try {
    const raw = JSON.parse(
      (await readFile(resolve(manifestDir, 'coverage-report.json'))).toString('utf8'),
    ) as unknown;
    if (!Array.isArray(raw)) return unavailable;
    for (const entry of raw) {
      const record = entry as Record<string, unknown>;
      if (record['status'] !== 'unavailable') continue;
      if (typeof record['franchiseId'] !== 'string' || typeof record['eraId'] !== 'string')
        continue;
      const poolKey = `${record['franchiseId']}/${record['eraId']}`;
      const reason = record['reason'];
      unavailable.set(poolKey, typeof reason === 'string' ? reason : 'unavailable');
    }
  } catch {
    return unavailable;
  }
  return unavailable;
}
async function auditPools(
  manifest: HoopRushManifest,
  manifestDir: string,
  verbose: boolean,
): Promise<AuditResult> {
  const failures: string[] = [];
  const details: string[] = [];
  const unavailable = await loadUnavailablePools(manifestDir);
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
      auditPoolContent(
        content,
        pool,
        manifest,
        failures,
        details,
        playerSeasons,
        unavailable.get(key) ?? null,
      );
    } catch {
      failures.push(`pools: ${key} asset missing (${assetPath})`);
    }
  }
  details.push(`pools: ${String(manifest.pools.length)} franchise-era pools`);
  return { ok: failures.length === 0, details, failures };
}
export interface CountedSeasonStats {
  gamesPlayed?: unknown;
  minutes?: unknown;
  points?: unknown;
  rebounds?: unknown;
  assists?: unknown;
  fouls?: unknown;
  fieldGoalsMade?: unknown;
  fieldGoalsAttempted?: unknown;
  freeThrowsMade?: unknown;
  freeThrowsAttempted?: unknown;
  threesMade?: unknown;
  threesAttempted?: unknown;
}
export function auditPlayerStatSanity(
  counted: CountedSeasonStats,
  key: string,
  displayName: string,
): string[] {
  // Impossible box-score shapes mean a partial family leaked through as a
  // total. Low minutes alone are NOT corruption — end-of-bench players really
  // do play 40+ games at 4 mpg — and a zero-minutes row means unobserved (the
  // pool schema has no null for minutes), so this fires only on
  // contradictions: makes above attempts, and scoring volume no logged
  // minutes could physically produce.
  const failures: string[] = [];
  const finite = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
  if (
    (finite(counted.fieldGoalsMade) &&
      finite(counted.fieldGoalsAttempted) &&
      counted.fieldGoalsMade > counted.fieldGoalsAttempted) ||
    (finite(counted.freeThrowsMade) &&
      finite(counted.freeThrowsAttempted) &&
      counted.freeThrowsMade > counted.freeThrowsAttempted) ||
    (finite(counted.threesMade) &&
      finite(counted.threesAttempted) &&
      counted.threesMade > counted.threesAttempted)
  ) {
    failures.push(`pools: ${key} ${displayName} makes exceed attempts`);
  }
  if (
    finite(counted.gamesPlayed) &&
    finite(counted.minutes) &&
    counted.gamesPlayed >= 20 &&
    counted.minutes > 0 &&
    finite(counted.points) &&
    counted.points / counted.minutes > 1.5
  ) {
    failures.push(
      `pools: ${key} ${displayName} impossible scoring rate (${String(counted.points)} pts / ${String(counted.minutes)} min)`,
    );
  }
  return failures;
}
function auditPoolContent(
  content: Buffer,
  index: HoopRushManifest['pools'][number],
  manifest: HoopRushManifest,
  failures: string[],
  details: string[],
  playerSeasons: Map<string, string>,
  unavailableReason: string | null = null,
): void {
  const key = `${index.franchiseId}/${index.eraId}`;
  const era = manifest.eras.find((e) => e.eraId === index.eraId);
  let raw: unknown = null;
  try {
    raw = JSON.parse(content.toString('utf8')) as unknown;
  } catch {}
  const parsed = franchiseEraPoolSchema.safeParse(raw);
  if (!parsed.success) {
    failures.push(
      `pools: ${key} asset fails the pool schema: ${parsed.error.issues[0]?.path.join('.') ?? '(root)'} ${parsed.error.issues[0]?.message ?? ''}`,
    );
    return;
  }
  const pool = parsed.data;
  if (pool.dataVersion !== manifest.dataVersion) {
    failures.push(
      `pools: ${key} dataVersion ${pool.dataVersion} does not match the manifest ${manifest.dataVersion}`,
    );
  }
  if (pool.franchiseId !== index.franchiseId || pool.eraId !== index.eraId) {
    failures.push(`pools: ${key} asset declares ${pool.franchiseId}/${pool.eraId}`);
  }
  const seen = new Set<string>();
  let poolSanitySkipped = 0;
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
    const counted = player.stats;
    const sanity = auditPlayerStatSanity(counted, key, player.displayName);
    if (unavailableReason !== null) {
      if (sanity.length > 0) {
        poolSanitySkipped += sanity.length;
      }
    } else {
      failures.push(...sanity);
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
  let poolVersionNoted = false;
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
      if (unavailableReason !== null) {
        if (!poolVersionNoted) {
          details.push(
            `pools: ${key} skips version-currency checks (coverage: ${unavailableReason})`,
          );
          poolVersionNoted = true;
        }
      } else {
        failures.push(
          `pools: ${key} ${player.displayName} selectionScoreVersion ${player.selectionScoreVersion} != ${SELECTION_SCORE_VERSION}`,
        );
      }
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
  if (poolSanitySkipped > 0 && unavailableReason !== null) {
    details.push(
      `pools: ${key} skips ${String(poolSanitySkipped)} stat-sanity findings on stale rows (coverage: ${unavailableReason})`,
    );
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
  const entries: Array<{ label: string; entry: OpponentIndexEntry }> = [];
  if (manifest.bracket) entries.push({ label: 'bracket', entry: manifest.bracket });
  if (entries.length === 0) {
    details.push('bracket: none packaged');
    return { ok: true, details, failures };
  }
  for (const { label, entry } of entries) {
    const assetPath = isAbsolute(entry.url) ? entry.url : resolve(manifestDir, entry.url);
    try {
      const info = await stat(assetPath);
      if (!info.isFile()) {
        failures.push(`${label}: asset is not a file (${assetPath})`);
        return { ok: false, details, failures };
      }
      const content = await readFile(assetPath);
      const actualHash = sha256Hex(content);
      if (actualHash !== entry.contentHash) {
        failures.push(`${label}: content hash mismatch (${assetPath})`);
      } else if (verbose) {
        details.push(`${label}: hash verified (${assetPath})`);
      }
      const parsed = opponentBracketSchema.safeParse(
        JSON.parse(content.toString('utf8')) as unknown,
      );
      if (!parsed.success) {
        failures.push(
          `${label}: artifact fails the bracket schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        );
        return { ok: failures.length === 0, details, failures };
      }
      const bracket = parsed.data;
      failures.push(
        ...validateBracketContent(bracket).map((f) => `${label}: ${f}`),
        ...scheduleInvariants(bracket.schedule).map((f) => `${label}: ${f}`),
      );
      const percentiles = bracket.opponents.map((o) => o.strength.percentile);
      const sorted = [...percentiles].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      details.push(
        `${label}: ${String(bracket.opponents.length)} opponents · ${String(bracket.schedule.length)} games · median pct ${median.toFixed(3)} · version ${bracket.bracketVersion}`,
      );
    } catch {
      failures.push(`${label}: asset missing (${assetPath})`);
    }
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
    entry:
      | {
          url: string;
          contentHash: string;
        }
      | undefined,
    label: string,
  ): Promise<{
    keys: Set<string>;
    parsed: unknown;
  } | null> => {
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
      if (parsed.data.dataVersion !== manifest.dataVersion) {
        failures.push(
          `playersIndex: dataVersion ${parsed.data.dataVersion} does not match the manifest ${manifest.dataVersion}`,
        );
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
      if (parsed.data.dataVersion !== manifest.dataVersion) {
        failures.push(
          `rosterDetails: dataVersion ${parsed.data.dataVersion} does not match the manifest ${manifest.dataVersion}`,
        );
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
function compareLaunchCollectionProgression(
  rules: CollectionProgressionRules,
  catalog: CollectionCatalog,
): string[] {
  const failures: string[] = [];
  if (rules.targetMultiplierBp !== COLLECTION_TARGET_MULTIPLIER_BP) {
    failures.push(
      `collection-progression: targetMultiplierBp ${String(rules.targetMultiplierBp)} != ${String(COLLECTION_TARGET_MULTIPLIER_BP)}`,
    );
  }
  if (rules.challenges.length !== COLLECTION_LAUNCH_CHALLENGES.length) {
    failures.push(
      `collection-progression: ${String(rules.challenges.length)} challenges, want ${String(COLLECTION_LAUNCH_CHALLENGES.length)}`,
    );
  }
  for (let index = 0; index < COLLECTION_LAUNCH_CHALLENGES.length; index += 1) {
    const expected = COLLECTION_LAUNCH_CHALLENGES[index];
    if (expected === undefined) continue;
    const actual = rules.challenges[index];
    if (actual === undefined || actual.challengeId !== expected.challengeId) {
      failures.push(
        `collection-progression: challenge ${String(index)} is ${actual?.challengeId ?? 'missing'}, want ${expected.challengeId}`,
      );
      continue;
    }
    if (actual.displayName !== expected.displayName) {
      failures.push(
        `collection-progression: challenge ${expected.challengeId} display name ${actual.displayName} unexpected`,
      );
    }
    if (actual.difficultyId !== expected.difficultyId) {
      failures.push(
        `collection-progression: challenge ${expected.challengeId} difficulty ${actual.difficultyId} != ${expected.difficultyId}`,
      );
    }
    if (
      actual.firstClearCoins !== expected.firstClearCoins ||
      actual.repeatWinCoins !== expected.repeatWinCoins
    ) {
      failures.push(
        `collection-progression: challenge ${expected.challengeId} coins ${String(actual.firstClearCoins)}/${String(actual.repeatWinCoins)} != ${String(expected.firstClearCoins)}/${String(expected.repeatWinCoins)}`,
      );
    }
    if (canonicalJson(actual.requirement) !== canonicalJson(expected.requirement)) {
      failures.push(
        `collection-progression: challenge ${expected.challengeId} requirement does not match the launch definition`,
      );
    }
  }
  const launchChallengeIds = new Set(
    COLLECTION_LAUNCH_CHALLENGES.map((entry) => entry.challengeId),
  );
  for (const actual of rules.challenges) {
    if (!launchChallengeIds.has(actual.challengeId)) {
      failures.push(`collection-progression: unexpected challenge ${actual.challengeId}`);
    }
  }
  const expectedRewards = collectionLaunchSetRewardDefinitions(catalog);
  if (rules.setRewards.length !== expectedRewards.length) {
    failures.push(
      `collection-progression: ${String(rules.setRewards.length)} set rewards, want ${String(expectedRewards.length)}`,
    );
  }
  for (let index = 0; index < expectedRewards.length; index += 1) {
    const expected = expectedRewards[index];
    if (expected === undefined) continue;
    const actual = rules.setRewards[index];
    if (actual === undefined || actual.setId !== expected.setId) {
      failures.push(
        `collection-progression: set reward ${String(index)} is ${actual?.setId ?? 'missing'}, want ${expected.setId}`,
      );
      continue;
    }
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      failures.push(
        `collection-progression: set reward ${expected.setId} does not match the launch definition`,
      );
    }
  }
  const launchSetIds = new Set(expectedRewards.map((entry) => entry.setId));
  for (const actual of rules.setRewards) {
    if (!launchSetIds.has(actual.setId)) {
      failures.push(`collection-progression: unexpected set reward ${actual.setId}`);
    }
  }
  return failures;
}

async function auditCollectionProgression(
  entry: NonNullable<HoopRushManifest['collection']>,
  catalog: CollectionCatalog,
  catalogHash: string,
  manifestDir: string,
  verbose: boolean,
): Promise<AuditResult> {
  const failures: string[] = [];
  const details: string[] = [];
  const ref = entry.progressionRules;
  if (ref === undefined) {
    details.push('collection-progression: none packaged (run gen-collection-progression-rules)');
    return { ok: true, details, failures };
  }
  const assetPath = isAbsolute(ref.url) ? ref.url : resolve(manifestDir, ref.url);
  let content: Buffer;
  try {
    const info = await stat(assetPath);
    if (!info.isFile()) {
      failures.push(`collection-progression: asset is not a file (${assetPath})`);
      return { ok: false, details, failures };
    }
    content = await readFile(assetPath);
  } catch {
    failures.push(`collection-progression: asset missing (${assetPath})`);
    return { ok: false, details, failures };
  }
  const rulesHash = sha256Hex(content);
  if (rulesHash !== ref.contentHash) {
    failures.push(`collection-progression: content hash mismatch (${assetPath})`);
  } else if (verbose) {
    details.push(`collection-progression: hash verified (${assetPath})`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content.toString('utf8')) as unknown;
  } catch {
    failures.push('collection-progression: artifact is not valid JSON');
    return { ok: false, details, failures };
  }
  const parsed = collectionProgressionRulesSchema.safeParse(raw);
  if (!parsed.success) {
    failures.push(
      `collection-progression: schema failure: ${parsed.error.issues[0]?.path.join('.') ?? '(root)'} ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
    return { ok: false, details, failures };
  }
  const rules = parsed.data;
  try {
    validateCollectionProgressionRules({
      progression: rules,
      progressionHash: rulesHash,
      catalog,
      verifyFeasibility: true,
    });
  } catch (error) {
    failures.push(`collection-progression: ${(error as Error).message}`);
  }
  if (rules.sourceCatalogHash !== catalogHash) {
    failures.push('collection-progression: sourceCatalogHash does not match the pinned catalog');
  }
  const sourceCatalogVersion: string = rules.sourceCatalogVersion;
  if (sourceCatalogVersion !== COLLECTION_CATALOG_VERSION) {
    failures.push(
      `collection-progression: sourceCatalogVersion ${sourceCatalogVersion} unexpected`,
    );
  }
  failures.push(...compareLaunchCollectionProgression(rules, catalog));
  details.push(
    `collection-progression: ${rules.progressionVersion} · ${String(rules.challenges.length)} challenges · ${String(rules.setRewards.length)} set rewards · multiplier ${String(rules.targetMultiplierBp)} bp · ${String(content.length)} bytes`,
  );

  const targetsRef = entry.progressionTargets;
  if (targetsRef === undefined) {
    details.push('collection-progression-targets: none packaged (calibration not frozen)');
    return { ok: failures.length === 0, details, failures };
  }
  const targetsPath = isAbsolute(targetsRef.url)
    ? targetsRef.url
    : resolve(manifestDir, targetsRef.url);
  let targetsContent: Buffer;
  try {
    const info = await stat(targetsPath);
    if (!info.isFile()) {
      failures.push(`collection-progression-targets: asset is not a file (${targetsPath})`);
      return { ok: false, details, failures };
    }
    targetsContent = await readFile(targetsPath);
  } catch {
    failures.push(`collection-progression-targets: asset missing (${targetsPath})`);
    return { ok: false, details, failures };
  }
  if (sha256Hex(targetsContent) !== targetsRef.contentHash) {
    failures.push(`collection-progression-targets: content hash mismatch (${targetsPath})`);
  } else if (verbose) {
    details.push(`collection-progression-targets: hash verified (${targetsPath})`);
  }
  let targetsRaw: unknown;
  try {
    targetsRaw = JSON.parse(targetsContent.toString('utf8')) as unknown;
  } catch {
    failures.push('collection-progression-targets: artifact is not valid JSON');
    return { ok: false, details, failures };
  }
  const targetsParsed = collectionProgressionTargetsSchema.safeParse(targetsRaw);
  if (!targetsParsed.success) {
    failures.push(
      `collection-progression-targets: schema failure: ${targetsParsed.error.issues[0]?.path.join('.') ?? '(root)'} ${targetsParsed.error.issues[0]?.message ?? 'unknown'}`,
    );
    return { ok: false, details, failures };
  }
  const targets = targetsParsed.data;
  if (targets.progressionRulesHash !== ref.contentHash) {
    failures.push(
      'collection-progression-targets: progressionRulesHash does not match the packaged progression rules',
    );
  }
  if (targets.catalogHash !== catalogHash) {
    failures.push(
      'collection-progression-targets: catalogHash does not match the packaged catalog',
    );
  }
  const failedGates = Object.entries(targets.gates)
    .filter(([, pass]) => !pass)
    .map(([name]) => name);
  if (failedGates.length > 0) {
    failures.push(`collection-progression-targets: failed gates ${failedGates.join(', ')}`);
  } else if (verbose) {
    details.push('collection-progression-targets: all recorded gates pass');
  }
  details.push(
    `collection-progression-targets: ${targets.targetsVersion} · ${String(targets.fixtures.length)} fixtures · ${String(Object.keys(targets.gates).length)} gates`,
  );
  return { ok: failures.length === 0, details, failures };
}

async function auditCollectionCatalog(
  manifest: HoopRushManifest,
  manifestDir: string,
  verbose: boolean,
): Promise<AuditResult> {
  const failures: string[] = [];
  const details: string[] = [];
  const entry = manifest.collection;
  if (entry === undefined) {
    details.push('collection: none packaged');
    return { ok: true, details, failures };
  }
  async function readPinned(
    label: string,
    ref: { url: string; contentHash: string },
  ): Promise<Buffer | null> {
    const assetPath = isAbsolute(ref.url) ? ref.url : resolve(manifestDir, ref.url);
    let content: Buffer;
    try {
      const info = await stat(assetPath);
      if (!info.isFile()) {
        failures.push(`${label}: asset is not a file (${assetPath})`);
        return null;
      }
      content = await readFile(assetPath);
    } catch {
      failures.push(`${label}: asset missing (${assetPath})`);
      return null;
    }
    if (sha256Hex(content) !== ref.contentHash) {
      failures.push(`${label}: content hash mismatch (${assetPath})`);
    } else if (verbose) {
      details.push(`${label}: hash verified (${assetPath})`);
    }
    return content;
  }
  const catalogContent = await readPinned('collection-catalog', entry.catalog);
  const indexContent = await readPinned('collection-index', entry.index);
  if (catalogContent === null || indexContent === null) {
    return { ok: false, details, failures };
  }
  let catalogRaw: unknown;
  let indexRaw: unknown;
  try {
    catalogRaw = JSON.parse(catalogContent.toString('utf8')) as unknown;
    indexRaw = JSON.parse(indexContent.toString('utf8')) as unknown;
  } catch {
    failures.push('collection: artifact is not valid JSON');
    return { ok: false, details, failures };
  }
  const catalogParsed = collectionCatalogSchema.safeParse(catalogRaw);
  if (!catalogParsed.success) {
    failures.push(
      `collection-catalog: schema failure: ${catalogParsed.error.issues[0]?.path.join('.') ?? '(root)'} ${catalogParsed.error.issues[0]?.message ?? 'unknown'}`,
    );
    return { ok: false, details, failures };
  }
  const indexParsed = collectionIndexSchema.safeParse(indexRaw);
  if (!indexParsed.success) {
    failures.push(
      `collection-index: schema failure: ${indexParsed.error.issues[0]?.path.join('.') ?? '(root)'} ${indexParsed.error.issues[0]?.message ?? 'unknown'}`,
    );
    return { ok: false, details, failures };
  }
  const catalog = catalogParsed.data;
  const index = indexParsed.data;
  const catalogVersion: string = catalog.catalogVersion;
  if (catalogVersion !== COLLECTION_CATALOG_VERSION) {
    failures.push(`collection-catalog: catalogVersion ${catalogVersion} unexpected`);
  }
  const overlayVersion: string = catalog.overlayVersion;
  if (overlayVersion !== COLLECTION_OVERLAY_VERSION) {
    failures.push(`collection-catalog: overlayVersion ${overlayVersion} unexpected`);
  }
  for (const pack of catalog.packs) {
    const packRulesVersion: string = pack.packRulesVersion;
    if (packRulesVersion !== COLLECTION_PACK_RULES_VERSION) {
      failures.push(`collection-catalog: pack ${pack.packId} rules version unexpected`);
    }
  }
  const indexCatalogVersion: string = index.catalogVersion;
  if (indexCatalogVersion !== COLLECTION_CATALOG_VERSION) {
    failures.push('collection-index: catalogVersion unexpected');
  }
  if (index.catalogHash !== entry.catalog.contentHash) {
    failures.push('collection-index: catalogHash does not match the packaged catalog');
  }
  const draftEntry = manifest.season?.draftCatalog;
  if (draftEntry === undefined) {
    failures.push('collection-catalog: manifest has no season.draftCatalog entry to pin against');
  } else if (catalog.sourceCatalogHash !== draftEntry.contentHash) {
    failures.push(
      'collection-catalog: sourceCatalogHash does not match the packaged draft catalog',
    );
  }
  const baseCount = catalog.cards.filter((card) => card.family === 'Base').length;
  const specialCount = catalog.cards.length - baseCount;
  if (specialCount !== 12) {
    failures.push(`collection-catalog: want 12 specials, have ${String(specialCount)}`);
  }
  if (catalog.sets.length !== 3) {
    failures.push(`collection-catalog: want 3 sets, have ${String(catalog.sets.length)}`);
  }
  for (const set of catalog.sets) {
    if (set.memberCardIds.length !== 4) {
      failures.push(
        `collection-catalog: set ${set.setId} has ${String(set.memberCardIds.length)} members, want 4`,
      );
    }
  }
  if (catalog.packs.length !== 5) {
    failures.push(`collection-catalog: want 5 packs, have ${String(catalog.packs.length)}`);
  }
  if (index.cards.length !== catalog.cards.length) {
    failures.push(
      `collection-index: ${String(index.cards.length)} entries != ${String(catalog.cards.length)} cards`,
    );
  }
  void COLLECTION_ECONOMY_VERSION;
  details.push(
    `collection: ${String(catalog.cards.length)} cards (${String(baseCount)} base + ${String(specialCount)} specials) · ${String(catalog.sets.length)} sets · ${String(catalog.packs.length)} packs · ${String(catalogContent.length)} bytes`,
  );
  const progression = await auditCollectionProgression(
    entry,
    catalog,
    entry.catalog.contentHash,
    manifestDir,
    verbose,
  );
  failures.push(...progression.failures);
  details.push(...progression.details);
  return { ok: failures.length === 0, details, failures };
}
const COLLECTION_EXPECTED_OBJECTIVE_THRESHOLDS: Record<string, number> = {
  'obj-three-barrage-v1': 12,
  'obj-lock-score-v1': 105,
  'obj-bench-spark-v1': 25,
  'obj-ball-pressure-v1': 14,
  'obj-own-glass-v1': 10,
  'obj-box-score-star-v1': 10,
};
const COLLECTION_EXPECTED_REPEAT_MAX: Record<string, number> = {
  street: 150,
  pro: 203,
  legend: 263,
};
function collectionMaxRepeatReward(multiplierBp: number): number {
  const outcome = collectionScaleRewardCoins(COLLECTION_GAME_REWARD_WIN_COINS, multiplierBp);
  const objective = collectionScaleRewardCoins(
    COLLECTION_GAME_REWARD_OBJECTIVE_COINS,
    multiplierBp,
  );
  const margin = collectionScaleRewardCoins(
    COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT * COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS,
    multiplierBp,
  );
  return outcome + objective + margin;
}
export async function auditCollectionGameRules(
  manifest: HoopRushManifest,
  manifestDir: string,
  verbose: boolean,
  rawManifest: unknown,
): Promise<AuditResult> {
  const failures: string[] = [];
  const details: string[] = [];
  const entry = manifest.collection;
  if (entry === undefined) {
    details.push('collection-game-rules: none packaged');
    return { ok: true, details, failures };
  }
  const ref = entry.gameRules;
  if (ref === undefined) {
    failures.push('collection-game-rules: manifest collection is missing the gameRules entry');
    return { ok: false, details, failures };
  }
  const assetPath = isAbsolute(ref.url) ? ref.url : resolve(manifestDir, ref.url);
  let content: Buffer;
  try {
    const info = await stat(assetPath);
    if (!info.isFile()) {
      failures.push(`collection-game-rules: asset is not a file (${assetPath})`);
      return { ok: false, details, failures };
    }
    content = await readFile(assetPath);
  } catch {
    failures.push(`collection-game-rules: asset missing (${assetPath})`);
    return { ok: false, details, failures };
  }
  const actualHash = sha256Hex(content);
  if (actualHash !== ref.contentHash) {
    failures.push(`collection-game-rules: content hash mismatch (${assetPath})`);
  } else if (verbose) {
    details.push(`collection-game-rules: hash verified (${assetPath})`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content.toString('utf8')) as unknown;
  } catch {
    failures.push('collection-game-rules: artifact is not valid JSON');
    return { ok: false, details, failures };
  }
  const parsed = collectionGameRulesSchema.safeParse(raw);
  if (!parsed.success) {
    failures.push(
      `collection-game-rules: schema failure: ${parsed.error.issues[0]?.path.join('.') ?? '(root)'} ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
    return { ok: false, details, failures };
  }
  const rules = parsed.data;
  const versions: Array<[string, string, string]> = [
    ['rulesVersion', rules.rulesVersion, COLLECTION_GAME_RULES_VERSION],
    ['gameVersion', rules.gameVersion, COLLECTION_GAME_V2_VERSION],
    ['teamVersion', rules.teamVersion, COLLECTION_TEAM_VERSION],
    ['rewardVersion', rules.rewardVersion, COLLECTION_REWARD_V2_VERSION],
    ['replayVersion', rules.replayVersion, COLLECTION_GAME_V2_REPLAY_VERSION],
    ['difficultyVersion', rules.difficultyVersion, COLLECTION_DIFFICULTY_VERSION],
    ['objectiveVersion', rules.objectiveVersion, COLLECTION_OBJECTIVE_VERSION],
  ];
  for (const [label, value, expected] of versions) {
    if (value !== expected) {
      failures.push(`collection-game-rules: ${label} ${value} unexpected (want ${expected})`);
    }
  }
  const cpuRosterSize: number = rules.cpuRosterSize;
  if (cpuRosterSize !== 12) {
    failures.push(`collection-game-rules: cpuRosterSize ${String(cpuRosterSize)} != 12`);
  }
  const eligibleScope: string = rules.eligibleScope;
  if (eligibleScope !== 'full-catalog') {
    failures.push('collection-game-rules: eligibleScope must be full-catalog');
  }
  const environmentEraId: string = rules.environmentEraId;
  if (environmentEraId !== '2020s') {
    failures.push(`collection-game-rules: environmentEraId ${environmentEraId} != 2020s`);
  }
  const homeCourtPolicy: string = rules.homeCourtPolicy;
  if (homeCourtPolicy !== 'neutral-home-court') {
    failures.push('collection-game-rules: homeCourtPolicy must be neutral-home-court');
  }
  for (let index = 0; index < COLLECTION_DIFFICULTY_ORDER.length; index += 1) {
    const expectedId = COLLECTION_DIFFICULTY_ORDER[index];
    if (rules.difficulties[index]?.difficultyId !== expectedId) {
      failures.push('collection-game-rules: difficulties must be ordered street, pro, legend');
      break;
    }
  }
  const rarityIndex = new Map<string, number>(
    COLLECTION_RARITY_ORDER.map((rarity, index) => [rarity, index]),
  );
  for (const profile of rules.difficulties) {
    const profileVersion: string = profile.difficultyVersion;
    const rulesDifficultyVersion: string = rules.difficultyVersion;
    if (profileVersion !== rulesDifficultyVersion) {
      failures.push(
        `collection-game-rules: ${profile.difficultyId} difficultyVersion does not match the rules`,
      );
    }
    let total = 0;
    const seen = new Set<string>();
    for (const entry of profile.rarityWeightsBp) {
      total += entry.weightBp;
      seen.add(entry.rarity);
      const low = rarityIndex.get(profile.rarityBand.floor) ?? 0;
      const high = rarityIndex.get(profile.rarityBand.ceiling) ?? 0;
      const index = rarityIndex.get(entry.rarity) ?? -1;
      if (index < low || index > high) {
        failures.push(
          `collection-game-rules: ${profile.difficultyId} weight ${entry.rarity} is outside the band`,
        );
      }
    }
    if (total !== 10_000) {
      failures.push(
        `collection-game-rules: ${profile.difficultyId} rarity weights sum to ${String(total)} bp`,
      );
    }
    for (const rarity of COLLECTION_RARITY_ORDER) {
      const low = rarityIndex.get(profile.rarityBand.floor) ?? 0;
      const high = rarityIndex.get(profile.rarityBand.ceiling) ?? 0;
      const index = rarityIndex.get(rarity) ?? -1;
      if (index >= low && index <= high && !seen.has(rarity)) {
        failures.push(
          `collection-game-rules: ${profile.difficultyId} is missing band weight ${rarity}`,
        );
      }
    }
  }
  for (let index = 1; index < rules.difficulties.length; index += 1) {
    const previous = rules.difficulties[index - 1];
    const current = rules.difficulties[index];
    if (previous === undefined || current === undefined) continue;
    if (current.ratingShift <= previous.ratingShift) {
      failures.push('collection-game-rules: rating shifts must strictly increase with difficulty');
    }
    if (current.rewardMultiplierBp <= previous.rewardMultiplierBp) {
      failures.push(
        'collection-game-rules: reward multipliers must strictly increase with difficulty',
      );
    }
  }
  const objectiveIds = new Set<string>();
  for (const objective of rules.objectives) {
    if (objectiveIds.has(objective.objectiveId)) {
      failures.push(`collection-game-rules: duplicate objective ${objective.objectiveId}`);
    }
    objectiveIds.add(objective.objectiveId);
    const objectiveVersion: string = objective.objectiveVersion;
    const rulesObjectiveVersion: string = rules.objectiveVersion;
    if (objectiveVersion !== rulesObjectiveVersion) {
      failures.push(
        `collection-game-rules: objective ${objective.objectiveId} version does not match the rules`,
      );
    }
    const expected = COLLECTION_EXPECTED_OBJECTIVE_THRESHOLDS[objective.objectiveId];
    if (expected === undefined) {
      failures.push(`collection-game-rules: unexpected objective ${objective.objectiveId}`);
    } else if (objective.threshold !== expected) {
      failures.push(
        `collection-game-rules: threshold for ${objective.objectiveId} is ${String(objective.threshold)}, want ${String(expected)}`,
      );
    }
  }
  for (const objectiveId of Object.keys(COLLECTION_EXPECTED_OBJECTIVE_THRESHOLDS)) {
    if (!objectiveIds.has(objectiveId)) {
      failures.push(`collection-game-rules: missing objective definition ${objectiveId}`);
    }
  }
  if (rules.objectives.length !== Object.keys(COLLECTION_EXPECTED_OBJECTIVE_THRESHOLDS).length) {
    failures.push(
      `collection-game-rules: ${String(rules.objectives.length)} objectives, want ${String(Object.keys(COLLECTION_EXPECTED_OBJECTIVE_THRESHOLDS).length)}`,
    );
  }
  const reward = rules.rewardTable;
  const winCoins: number = reward.winCoins;
  const lossCoins: number = reward.lossCoins;
  const objectiveCoins: number = reward.objectiveCoins;
  const marginCoinPerPoint: number = reward.marginCoinPerPoint;
  const marginCapPoints: number = reward.marginCapPoints;
  if (
    winCoins !== COLLECTION_GAME_REWARD_WIN_COINS ||
    lossCoins !== COLLECTION_GAME_REWARD_LOSS_COINS
  ) {
    failures.push(
      `collection-game-rules: reward table outcome must be win ${String(COLLECTION_GAME_REWARD_WIN_COINS)} / loss ${String(COLLECTION_GAME_REWARD_LOSS_COINS)}`,
    );
  }
  if (
    objectiveCoins !== COLLECTION_GAME_REWARD_OBJECTIVE_COINS ||
    marginCoinPerPoint !== COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT ||
    marginCapPoints !== COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS
  ) {
    failures.push('collection-game-rules: reward table objective/margin values unexpected');
  }
  for (const difficultyId of COLLECTION_DIFFICULTY_ORDER) {
    if (reward.firstClearCoins[difficultyId] !== COLLECTION_GAME_FIRST_CLEAR_COINS[difficultyId]) {
      failures.push(
        `collection-game-rules: first clear for ${difficultyId} must be ${String(COLLECTION_GAME_FIRST_CLEAR_COINS[difficultyId])}`,
      );
    }
  }
  for (const profile of rules.difficulties) {
    const maximum = collectionMaxRepeatReward(profile.rewardMultiplierBp);
    const expected = COLLECTION_EXPECTED_REPEAT_MAX[profile.difficultyId];
    if (expected === undefined || maximum !== expected) {
      failures.push(
        `collection-game-rules: ${profile.difficultyId} repeat maximum ${String(maximum)} != ${String(expected ?? -1)}`,
      );
    }
  }
  details.push(
    `collection-game-rules: ${rules.rulesVersion} · ${String(rules.difficulties.length)} difficulties · ${String(rules.objectives.length)} objectives · repeat maxima ${rules.difficulties.map((profile) => `${profile.difficultyId} ${String(collectionMaxRepeatReward(profile.rewardMultiplierBp))}`).join(' / ')} · ${String(content.length)} bytes`,
  );

  const targetsRef = (
    rawManifest as {
      collection?: { gameTargets?: { url?: string; contentHash?: string } };
    }
  ).collection?.gameTargets;
  if (targetsRef?.url === undefined || targetsRef.contentHash === undefined) {
    details.push('collection-game-targets: none packaged (calibration not frozen)');
  } else {
    const targetsPath = isAbsolute(targetsRef.url)
      ? targetsRef.url
      : resolve(manifestDir, targetsRef.url);
    let targetsContent: Buffer;
    try {
      const info = await stat(targetsPath);
      if (!info.isFile()) {
        failures.push(`collection-game-targets: asset is not a file (${targetsPath})`);
        return { ok: false, details, failures };
      }
      targetsContent = await readFile(targetsPath);
    } catch {
      failures.push(`collection-game-targets: asset missing (${targetsPath})`);
      return { ok: false, details, failures };
    }
    if (sha256Hex(targetsContent) !== targetsRef.contentHash) {
      failures.push(`collection-game-targets: content hash mismatch (${targetsPath})`);
    } else if (verbose) {
      details.push(`collection-game-targets: hash verified (${targetsPath})`);
    }
    let targetsRaw: unknown;
    try {
      targetsRaw = JSON.parse(targetsContent.toString('utf8')) as unknown;
    } catch {
      failures.push('collection-game-targets: artifact is not valid JSON');
      return { ok: false, details, failures };
    }
    const targetsParsed = collectionGameTargetsSchema.safeParse(targetsRaw);
    if (!targetsParsed.success) {
      failures.push(
        `collection-game-targets: schema failure: ${targetsParsed.error.issues[0]?.path.join('.') ?? '(root)'} ${targetsParsed.error.issues[0]?.message ?? 'unknown'}`,
      );
      return { ok: false, details, failures };
    }
    const targets = targetsParsed.data;
    if (targets.rulesHash !== actualHash) {
      failures.push('collection-game-targets: rulesHash does not match the packaged game rules');
    }
    if (targets.catalogHash !== entry.catalog.contentHash) {
      failures.push('collection-game-targets: catalogHash does not match the packaged catalog');
    }
    if (targets.fixtures.length < 4) {
      failures.push('collection-game-targets: fewer than four collection-strength fixtures');
    }
    const failedGates = Object.entries(targets.gates)
      .filter(([, pass]) => !pass)
      .map(([name]) => name);
    if (failedGates.length > 0) {
      failures.push(`collection-game-targets: failed gates ${failedGates.join(', ')}`);
    } else if (verbose) {
      details.push('collection-game-targets: all recorded gates pass');
    }
    details.push(
      `collection-game-targets: ${targets.targetsVersion} · ${String(targets.fixtures.length)} fixtures · ${String(Object.keys(targets.gates).length)} gates`,
    );
  }
  return { ok: failures.length === 0, details, failures };
}
async function auditSeasonGameTargets(manifestDir: string, verbose: boolean): Promise<AuditResult> {
  const failures: string[] = [];
  const details: string[] = [];
  const assetPath = resolve(manifestDir, 'season/game-targets.json');
  let content: Buffer;
  try {
    const info = await stat(assetPath);
    if (!info.isFile()) {
      details.push('game-targets: none packaged');
      return { ok: true, details, failures };
    }
    content = await readFile(assetPath);
  } catch {
    details.push('game-targets: none packaged');
    return { ok: true, details, failures };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content.toString('utf8')) as unknown;
  } catch {
    failures.push('game-targets: artifact is not valid JSON');
    return { ok: false, details, failures };
  }
  const parsed = seasonGameTargetsSchema.safeParse(raw);
  if (!parsed.success) {
    failures.push(
      `game-targets: artifact fails the game targets schema: ${parsed.error.issues[0]?.path.join('.') ?? '(root)'} ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
    return { ok: failures.length === 0, details, failures };
  }
  const targets = parsed.data;
  if (verbose) {
    details.push(
      `game-targets: rotationVersion ${targets.rotationVersion} verified (${assetPath})`,
    );
  }
  details.push(
    `game-targets: ${String(targets.fixtures.length)} fixtures · rotationVersion ${targets.rotationVersion}`,
  );
  return { ok: failures.length === 0, details, failures };
}
async function auditSponsorGear(
  manifest: HoopRushManifest,
  manifestDir: string,
  verbose: boolean,
): Promise<AuditResult> {
  const failures: string[] = [];
  const details: string[] = [];
  const entry = manifest.season?.sponsorsIndex;
  if (entry === undefined) {
    details.push('sponsor-gear: no packaged sponsors index');
    return { ok: true, details, failures };
  }
  const assetPath = isAbsolute(entry.url) ? entry.url : resolve(manifestDir, entry.url);
  let content: Buffer;
  try {
    const info = await stat(assetPath);
    if (!info.isFile()) {
      failures.push(`sponsor-gear: asset is not a file (${assetPath})`);
      return { ok: false, details, failures };
    }
    content = await readFile(assetPath);
  } catch {
    failures.push(`sponsor-gear: asset missing (${assetPath})`);
    return { ok: false, details, failures };
  }
  if (sha256Hex(content) !== entry.contentHash) {
    failures.push(`sponsor-gear: content hash mismatch (${assetPath})`);
  } else if (verbose) {
    details.push(`sponsor-gear: hash verified (${assetPath})`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content.toString('utf8')) as unknown;
  } catch {
    failures.push('sponsor-gear: artifact is not valid JSON');
    return { ok: false, details, failures };
  }
  const parsed = seasonSponsorsIndexSchema.safeParse(raw);
  if (!parsed.success) {
    failures.push(
      `sponsor-gear: artifact fails the sponsors index schema: ${parsed.error.issues[0]?.path.join('.') ?? '(root)'} ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
    return { ok: failures.length === 0, details, failures };
  }
  const index = parsed.data;
  const catalogFamilies = new Set(SEASON_SPONSOR_GEAR_CATALOG.map((item) => item.brandFamily));
  const indexFamilies = new Set(index.logos.map((logo) => logo.family));
  for (const family of catalogFamilies) {
    if (!indexFamilies.has(family)) {
      failures.push(`sponsor-gear: catalog family ${family} has no packaged logo`);
    }
  }
  for (const family of indexFamilies) {
    if (!catalogFamilies.has(family)) {
      failures.push(`sponsor-gear: packaged logo ${family} matches no catalog family`);
    }
  }
  for (const logo of index.logos) {
    const logoPath = isAbsolute(logo.file) ? logo.file : resolve(manifestDir, logo.file);
    let logoBytes: Buffer;
    try {
      const info = await stat(logoPath);
      if (!info.isFile()) {
        failures.push(`sponsor-gear: logo is not a file (${logoPath})`);
        continue;
      }
      logoBytes = await readFile(logoPath);
    } catch {
      failures.push(`sponsor-gear: logo missing (${logoPath})`);
      continue;
    }
    if (sha256Hex(logoBytes) !== logo.contentHash) {
      failures.push(`sponsor-gear: logo hash mismatch (${logoPath})`);
    }
  }
  details.push(
    `sponsor-gear: ${String(index.logos.length)} logos · gearVersion ${index.gearVersion}`,
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
    await auditSponsorGear(manifest, manifestDir, verbose),
    await auditSeasonGameTargets(manifestDir, verbose),
    await auditCollectionCatalog(manifest, manifestDir, verbose),
    await auditCollectionGameRules(manifest, manifestDir, verbose, parsed),
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
