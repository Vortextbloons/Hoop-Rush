/**
 * Franchise-era pool computation (spec/02 fast-load artifact) — port of
 * scripts/import-nba/compute_pools.py.
 *
 * Pipeline:
 *   roster.json (ratings/positions) + stints.json (team-stint accounting)
 *   + season-stats.json (league totals) + manifest lineage/eras
 *   -> eligible peak player-seasons per (franchise, era)
 *   -> compact FranchiseEraPool JSON + manifest pool index with content hashes
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parsePool } from '@hoop-rush/data-contracts';
import { NBA_ROOT, PUBLIC_DATA, RAW_CACHE, TEAM_FOUNDING_SEASON } from '../config.js';
import { fileExists, safeFloat, safeInt, sha256File, writeJson } from '../json.js';
import { normalizePositionLabels } from './positions.js';

/**
 * Python's json.loads accepts the bare NaN token that the fetch layer's
 * json.dumps writes (e.g. "college": NaN); JSON.parse does not. Pools never
 * consume the NaN fields, so the token is read as null — the same value the
 * Python num()/nullable() helpers would produce for it.
 */
function readJsonLoose(path: string): unknown {
  const text = readFileSync(path, 'utf8').replace(/\bNaN\b(?=\s*[,}\]])/g, 'null');
  return JSON.parse(text) as unknown;
}

/** Python str(value): string/number/boolean as-is; anything else as ''. */
function str(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

/** Resolved per call so tests can point PUBLIC_DATA at a fixture dir. */
export function poolDir(): string {
  return join(PUBLIC_DATA, 'pools');
}

/** Resolved per call so tests can point PUBLIC_DATA at a fixture dir. */
export function manifestPath(): string {
  return join(PUBLIC_DATA, 'manifest.json');
}

export const SCHEMA_VERSION = 1;
export const POSITION_NORMALIZATION_VERSION = 'position-v1';
export const RATINGS_VERSION = 'ratings-v8-production-overall';
export const SELECTION_SCORE_VERSION = 'selection-v1';
export const MIN_TEAM_GAMES = 40;
export const DATA_VERSION = 'm1.7';

// ---------------------------------------------------------------------------
// Career position unions (cached; scans every packaged roster once)
// ---------------------------------------------------------------------------
export function loadCareerPositionLabels(): Map<string, Set<string>> {
  // The cache is derived from the packaged roster snapshot. Version the
  // filename so older imports cannot silently erase positions for players
  // added in a later snapshot.
  const cachePath = join(RAW_CACHE, 'career-position-labels-v3.json');
  if (fileExists(cachePath)) {
    const data = readJsonLoose(cachePath) as Record<string, unknown>;
    return new Map(Object.entries(data).map(([pid, labels]) => [pid, new Set(labels as string[])]));
  }

  const labelsByPlayer = new Map<string, Set<string>>();
  for (const seasonDir of listSeasonKeys()) {
    const rosterPath = join(NBA_ROOT, seasonDir, 'roster.json');
    if (!fileExists(rosterPath)) {
      continue;
    }
    const roster = readJsonLoose(rosterPath) as Array<Record<string, unknown>>;
    for (const player of roster) {
      const pid = str(player.externalId);
      if (!pid) {
        continue;
      }
      let labels = labelsByPlayer.get(pid);
      if (!labels) {
        labels = new Set();
        labelsByPlayer.set(pid, labels);
      }
      labels.add(str(player.position));
    }
  }

  const cacheObject = Object.fromEntries(
    [...labelsByPlayer.entries()].map(([pid, labels]) => [pid, [...labels].sort()]),
  );
  writeJson(cachePath, cacheObject);
  console.log(`  [OK] career position labels for ${String(labelsByPlayer.size)} players (cached)`);
  return labelsByPlayer;
}

// ---------------------------------------------------------------------------
// Manifest helpers
// ---------------------------------------------------------------------------
export interface EraEntry {
  eraId: string;
  label: string;
  fromSeasonKey: string;
  toSeasonKey: string;
}

export interface FranchiseLineageEntry {
  franchiseId: string;
  displayName: string;
  teamExternalId: string;
  firstNbaSeasonKey?: string | null;
  names: unknown[];
}

export interface PoolIndexEntry {
  franchiseId: string;
  eraId: string;
  url: string;
  contentHash: string;
}

export interface Manifest {
  schemaVersion: number;
  dataVersion: string;
  franchiseLineage: FranchiseLineageEntry[];
  eras: EraEntry[];
  pools: PoolIndexEntry[];
  [key: string]: unknown;
}

export function loadManifest(): Manifest {
  return readJsonLoose(manifestPath()) as Manifest;
}

export function seasonToEra(eras: readonly EraEntry[], season: string): string | null {
  for (const era of eras) {
    if (era.fromSeasonKey <= season && season <= era.toSeasonKey) {
      return era.eraId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-season loading
// ---------------------------------------------------------------------------
export interface SeasonData {
  rosterByExtId: Record<string, Record<string, unknown>>;
  stintsByTeam: Record<string, Array<Record<string, unknown>>>;
  statsByPlayer: Record<string, Record<string, unknown>>;
}

/** Return { rosterByExtId, stintsByTeam, statsByPlayer } for a season. */
export function loadSeasonData(season: string): SeasonData {
  const seasonDir = join(NBA_ROOT, season);
  const rosterByExtId: Record<string, Record<string, unknown>> = {};
  for (const player of readJsonLoose(join(seasonDir, 'roster.json')) as Array<
    Record<string, unknown>
  >) {
    rosterByExtId[str(player.externalId)] = player;
  }

  const stintsByTeam: Record<string, Array<Record<string, unknown>>> = {};
  const stintsPath = join(seasonDir, 'stints.json');
  if (fileExists(stintsPath)) {
    for (const stint of readJsonLoose(stintsPath) as Array<Record<string, unknown>>) {
      const teamId = str(stint.teamExternalId);
      let stints = stintsByTeam[teamId];
      if (!stints) {
        stints = [];
        stintsByTeam[teamId] = stints;
      }
      stints.push(stint);
    }
  }

  const statsByPlayer: Record<string, Record<string, unknown>> = {};
  const statsPath = join(seasonDir, 'season-stats.json');
  if (fileExists(statsPath)) {
    for (const row of readJsonLoose(statsPath) as Array<Record<string, unknown>>) {
      statsByPlayer[str(row.playerExternalId)] = row;
    }
  }

  return { rosterByExtId, stintsByTeam, statsByPlayer };
}

// ---------------------------------------------------------------------------
// Record building
// ---------------------------------------------------------------------------
/** Python num(): float(value) with NaN/TypeError/ValueError -> default. */
function num(row: Record<string, unknown>, key: string, fallback = 0): number {
  return safeFloat(row[key], fallback);
}

/** Python nullable(): value is None -> None; NaN/bad value -> None. */
function nullableValue(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) {
    return null;
  }
  let n: number;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    n = Number(trimmed);
  } else {
    n = Number(value);
  }
  if (Number.isNaN(n)) {
    return null;
  }
  return n;
}

export interface PoolStats {
  gamesPlayed: number;
  minutes: number;
  points: number;
  rebounds: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threesMade: number;
  threesAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  per: number | null;
  boxPlusMinus: number | null;
  usageRate: number | null;
  tsPct: number | null;
  efgPct: number | null;
}

export function buildStats(seasonStats: Record<string, unknown>): PoolStats {
  return {
    gamesPlayed: Math.trunc(num(seasonStats, 'gamesPlayed')),
    minutes: Math.trunc(num(seasonStats, 'minutes')),
    points: Math.trunc(num(seasonStats, 'points')),
    rebounds: Math.trunc(num(seasonStats, 'rebounds')),
    offensiveRebounds: Math.trunc(num(seasonStats, 'offensiveRebounds')),
    defensiveRebounds: Math.trunc(num(seasonStats, 'defensiveRebounds')),
    assists: Math.trunc(num(seasonStats, 'assists')),
    steals: Math.trunc(num(seasonStats, 'steals')),
    blocks: Math.trunc(num(seasonStats, 'blocks')),
    turnovers: Math.trunc(num(seasonStats, 'turnovers')),
    fieldGoalsMade: Math.trunc(num(seasonStats, 'fgm')),
    fieldGoalsAttempted: Math.trunc(num(seasonStats, 'fga')),
    threesMade: Math.trunc(num(seasonStats, 'tpm')),
    threesAttempted: Math.trunc(num(seasonStats, 'tpa')),
    freeThrowsMade: Math.trunc(num(seasonStats, 'ftm')),
    freeThrowsAttempted: Math.trunc(num(seasonStats, 'fta')),
    per: nullableValue(seasonStats, 'per'),
    boxPlusMinus: nullableValue(seasonStats, 'boxPlusMinus'),
    usageRate: nullableValue(seasonStats, 'usageRate'),
    tsPct: nullableValue(seasonStats, 'tsPct'),
    efgPct: nullableValue(seasonStats, 'efgPct'),
  };
}

export interface SummaryRatingsRaw {
  overallRating?: unknown;
  offenseRating?: unknown;
  defenseRating?: unknown;
}

export function selectionScore(
  summary: SummaryRatingsRaw,
  usageRate: number | null,
  teamMinutes: number,
  teamGames: number,
): number {
  /* selection-v1: rating blend plus availability-weighted production context. */
  const usage = Math.min(Math.max(usageRate || 0, 0), 40.0);
  const mpg = Math.min(teamMinutes / Math.max(1, teamGames), 48.0);
  return (
    Math.round(
      (0.5 * Number(summary.overallRating) +
        0.3 * Number(summary.offenseRating) +
        0.2 * Number(summary.defenseRating) +
        0.05 * usage +
        0.02 * mpg) *
        1000,
    ) / 1000
  );
}

export interface Candidate {
  season: string;
  player: Record<string, unknown>;
  stint: Record<string, unknown>;
  stats: Record<string, unknown>;
}

/** Peak tie-break order: selectionScore, team minutes, team games, earlier season. */
export function candidateKey(candidate: Candidate): readonly number[] {
  const stint = candidate.stint;
  const summary = candidate.player.summaryRatings as SummaryRatingsRaw | undefined;
  const seasonStart = parseInt(candidate.season.split('-')[0] ?? '', 10);
  const minutes = Math.trunc(num(stint, 'minutes'));
  const games = Math.trunc(num(stint, 'gamesPlayed'));
  return [
    selectionScore(summary ?? {}, nullableValue(candidate.stats, 'usageRate'), minutes, games),
    minutes,
    games,
    -seasonStart,
  ];
}

/** Python max(..., key=): first maximal element wins on ties. */
function maxBy<T>(items: readonly T[], key: (item: T) => readonly number[]): T {
  const first = items[0];
  if (first === undefined) {
    throw new Error('maxBy: empty list');
  }
  let best: T = first;
  let bestKey = key(first);
  for (const item of items.slice(1)) {
    const itemKey = key(item);
    if (compareKeys(itemKey, bestKey) > 0) {
      best = item;
      bestKey = itemKey;
    }
  }
  return best;
}

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined || bv === undefined) {
      return 0;
    }
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

export function loadBbrefIds(): Record<string, string> {
  /* External NBA id -> Basketball-Reference id (fetch_bbref_ids.py output). */
  const path = join(RAW_CACHE, 'bbref_ids.json');
  if (!fileExists(path)) {
    console.log('  [WARN] bbref_ids.json missing; run fetch_bbref_ids or run_all (no altIds)');
    return {};
  }
  return readJsonLoose(path) as Record<string, string>;
}

export interface PoolPlayer {
  schemaVersion: number;
  playerId: string;
  franchiseId: string;
  eraId: string;
  seasonKey: string;
  firstName: string;
  lastName: string;
  displayName: string;
  playerExternalId: string;
  altIds: { bbref: string | null } | null;
  positions: {
    sourceLabels: string[];
    canonical: string[];
    normalizationVersion: string;
  };
  heightInches: number | null;
  weightLbs: number | null;
  eligibility: {
    minimumTeamGames: number;
    teamGames: number;
    teamMinutes: number;
  };
  selectionScore: number;
  selectionScoreVersion: string;
  stats: PoolStats;
  summaryRatings: { overallRating: number; offenseRating: number; defenseRating: number };
  detailedRatings: Record<string, number>;
  tendencies: Record<string, number>;
  dataConfidence: string;
  source: {
    dataVersion: string;
    ratingsVersion: string;
    selectionScoreVersion: string;
  };
}

export interface Pool {
  schemaVersion: number;
  dataVersion: string;
  franchiseId: string;
  eraId: string;
  eligibility: { minimumTeamGames: number };
  players: PoolPlayer[];
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    return value;
  }
  return null;
}

export function computePool(
  franchiseId: string,
  eraId: string,
  manifest: Manifest,
  bbrefIds?: Record<string, string>,
  withAssets = true,
): Pool | null {
  if (bbrefIds === undefined) {
    bbrefIds = loadBbrefIds();
  }
  const lineage = manifest.franchiseLineage.find((e) => e.franchiseId === franchiseId);
  if (lineage === undefined) {
    throw new Error(`unknown franchiseId ${franchiseId}`);
  }
  const era = manifest.eras.find((e) => e.eraId === eraId);
  if (era === undefined) {
    throw new Error(`unknown eraId ${eraId}`);
  }

  const teamExternalId = lineage.teamExternalId;
  const seasons = listSeasonKeys().filter(
    (season) => era.fromSeasonKey <= season && season <= era.toSeasonKey,
  );
  if (seasons.length === 0) {
    throw new Error(`no seasons available for ${franchiseId} ${eraId}`);
  }

  console.log(`[${franchiseId} ${eraId}] scanning ${String(seasons.length)} seasons`);
  const careerLabels = loadCareerPositionLabels();

  const eligible = new Map<string, Candidate[]>();
  const missingStints: string[] = [];

  for (const season of seasons) {
    const { rosterByExtId, stintsByTeam, statsByPlayer } = loadSeasonData(season);
    const stints = stintsByTeam[teamExternalId] ?? [];
    if (
      stints.length === 0 &&
      Object.values(rosterByExtId).some((p) => p.teamExternalId === teamExternalId)
    ) {
      missingStints.push(season);
    }

    for (const stint of stints) {
      const games = Math.trunc(num(stint, 'gamesPlayed'));
      if (games < MIN_TEAM_GAMES) {
        continue;
      }
      const pid = str(stint.playerExternalId);
      const player = rosterByExtId[pid];
      if (player === undefined) {
        continue;
      }
      const stats = statsByPlayer[pid];
      if (stats === undefined || Math.trunc(num(stats, 'gamesPlayed')) === 0) {
        continue;
      }
      const summary = player.summaryRatings;
      if (summary === null || summary === undefined) {
        console.log(`  ! ${pid} missing summaryRatings in ${season}; re-run compute_ratings`);
        continue;
      }
      let candidates = eligible.get(pid);
      if (!candidates) {
        candidates = [];
        eligible.set(pid, candidates);
      }
      candidates.push({ season, player, stint, stats });
    }
  }

  if (missingStints.length > 0) {
    console.log(`  [WARN] no stints for ${franchiseId} in: ${missingStints.join(', ')}`);
  }

  const playersOut: PoolPlayer[] = [];
  for (const pid of [...eligible.keys()].sort()) {
    const candidates = eligible.get(pid);
    if (!candidates) {
      continue;
    }
    const best = maxBy(candidates, candidateKey);

    const player = best.player;
    const stint = best.stint;
    const stats = best.stats;
    const summary = player.summaryRatings as SummaryRatingsRaw | undefined;
    const ownLabels = new Set([str(player.position)]);
    const career = careerLabels.get(pid);
    const labels = career !== undefined && career.size > 0 ? career : ownLabels;
    const { canonical, sourceLabels, unknownLabels } = normalizePositionLabels(labels);
    if (unknownLabels.length > 0) {
      console.log(
        `  [WARN] ${str(player.firstName)} ${str(player.lastName)} (${pid}) unknown position labels: ${formatList(unknownLabels)}`,
      );
    }

    const teamGames = Math.trunc(num(stint, 'gamesPlayed'));
    const teamMinutes = Math.trunc(num(stint, 'minutes'));
    const ratings = (player.ratings ?? {}) as Record<string, unknown>;
    const tendencies = (player.tendencies ?? {}) as Record<string, unknown>;
    const detailedRatings: Record<string, number> = {};
    for (const [key, value] of Object.entries(ratings)) {
      if (typeof value === 'number') {
        detailedRatings[key] = Math.trunc(value);
      }
    }
    const tendenciesOut: Record<string, number> = {};
    for (const [key, value] of Object.entries(tendencies)) {
      const n = Number(value);
      if (Number.isNaN(n)) {
        throw new Error(
          `non-numeric tendency ${key} for ${pid} (${str(player.firstName)} ${str(player.lastName)})`,
        );
      }
      tendenciesOut[key] = n;
    }

    playersOut.push({
      schemaVersion: SCHEMA_VERSION,
      playerId: `p-${pid}`,
      franchiseId,
      eraId,
      seasonKey: best.season,
      firstName: str(player.firstName),
      lastName: str(player.lastName),
      displayName: `${str(player.firstName)} ${str(player.lastName)}`.trim(),
      playerExternalId: pid,
      altIds: Object.hasOwn(bbrefIds, pid) ? { bbref: bbrefIds[pid] as string } : null,
      positions: {
        sourceLabels,
        canonical,
        normalizationVersion: POSITION_NORMALIZATION_VERSION,
      },
      heightInches: asNumberOrNull(player.heightInches),
      weightLbs: asNumberOrNull(player.weightLbs),
      eligibility: {
        minimumTeamGames: MIN_TEAM_GAMES,
        teamGames,
        teamMinutes,
      },
      selectionScore: selectionScore(
        summary ?? {},
        nullableValue(stats, 'usageRate'),
        teamMinutes,
        teamGames,
      ),
      selectionScoreVersion: SELECTION_SCORE_VERSION,
      stats: buildStats(stats),
      summaryRatings: {
        overallRating: safeInt(summary?.overallRating),
        offenseRating: safeInt(summary?.offenseRating),
        defenseRating: safeInt(summary?.defenseRating),
      },
      detailedRatings,
      tendencies: tendenciesOut,
      dataConfidence:
        stats.statsSource === 'stints-derived'
          ? 'derived-medium'
          : stats.boxPlusMinus !== null && stats.boxPlusMinus !== undefined
            ? 'observed'
            : 'derived-medium',
      source: {
        dataVersion: DATA_VERSION,
        ratingsVersion: RATINGS_VERSION,
        selectionScoreVersion: SELECTION_SCORE_VERSION,
      },
    });
  }

  if (playersOut.length === 0) {
    console.log(
      `  [SKIP] no eligible players for ${franchiseId} ${eraId} ` +
        `(no packaged stints for team ${lineage.teamExternalId} in era seasons)`,
    );
    return null;
  }

  if (withAssets) {
    // Headshot/photo annotation stays in the Python layer (reannotate_assets.py);
    // network asset resolution is intentionally not ported.
    console.log(
      '  [WARN] headshot/photo asset annotation stays in the Python layer (reannotate_assets.py); skipping',
    );
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    dataVersion: DATA_VERSION,
    franchiseId,
    eraId,
    eligibility: { minimumTeamGames: MIN_TEAM_GAMES },
    players: playersOut,
  };
}

/** Log parsePool acceptance; never drop players the schema would reject. */
export function logPoolValidation(pool: Pool): void {
  try {
    parsePool(pool);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    console.error(
      `  [VALIDATION] parsePool rejected ${pool.franchiseId}-${pool.eraId} ` +
        `(pool still written; report to the integration wave): ${message}`,
    );
  }
}

export function writePool(pool: Pool): string {
  const path = join(poolDir(), `${pool.franchiseId}-${pool.eraId}.json`);
  writeJson(path, pool);
  const digest = sha256File(path);
  console.log(
    `  [OK] wrote ${basename(path)} (${String(pool.players.length)} players, ${digest.slice(0, 12)}…)`,
  );
  return digest;
}

export function updateManifest(
  entries: Array<{ franchiseId: string; eraId: string; url: string; contentHash: string }>,
): void {
  const manifest = loadManifest();
  manifest.dataVersion = DATA_VERSION;
  for (const lineage of manifest.franchiseLineage) {
    if (lineage.firstNbaSeasonKey === undefined) {
      lineage.firstNbaSeasonKey = TEAM_FOUNDING_SEASON[lineage.teamExternalId] ?? null;
    }
  }
  const existing = new Map(
    manifest.pools.map((entry) => [`${entry.franchiseId}/${entry.eraId}`, entry]),
  );
  for (const entry of entries) {
    existing.set(`${entry.franchiseId}/${entry.eraId}`, entry);
  }
  manifest.pools = [...existing.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => entry);
  writeJson(manifestPath(), manifest);
  console.log(
    `  [OK] manifest updated: ${String(manifest.pools.length)} pools, dataVersion ${DATA_VERSION}`,
  );
}

export function parsePoolTargets(raw: readonly string[]): Array<[string, string]> {
  const targets: Array<[string, string]> = [];
  for (const item of raw) {
    const parts = item.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`invalid pool target '${item}' (expected franchiseId/eraId)`);
    }
    targets.push([parts[0], parts[1]]);
  }
  return targets;
}

/** The --all logic from Python main(): lineage x eras with season overlap and founding check. */
export function allPoolTargets(manifest: Manifest = loadManifest()): Array<[string, string]> {
  const packagedSeasons = new Set(listSeasonKeys());
  const targets: Array<[string, string]> = [];
  for (const entry of manifest.franchiseLineage) {
    for (const era of manifest.eras) {
      const overlaps =
        [...packagedSeasons].some(
          (season) => era.fromSeasonKey <= season && season <= era.toSeasonKey,
        ) &&
        (!entry.firstNbaSeasonKey || entry.firstNbaSeasonKey <= era.toSeasonKey);
      if (overlaps) {
        targets.push([entry.franchiseId, era.eraId]);
      }
    }
  }
  return targets;
}

export function run(targets: Array<[string, string]> | null = null, withAssets = true): void {
  if (targets === null) {
    targets = [['lakers', '1990s']];
  }
  const manifest = loadManifest();
  const bbrefIds = loadBbrefIds();
  const entries: Array<{ franchiseId: string; eraId: string; url: string; contentHash: string }> =
    [];
  for (const [franchiseId, eraId] of targets) {
    const pool = computePool(franchiseId, eraId, manifest, bbrefIds, withAssets);
    if (pool === null) {
      continue;
    }
    logPoolValidation(pool);
    const digest = writePool(pool);
    entries.push({
      franchiseId,
      eraId,
      url: `pools/${franchiseId}-${eraId}.json`,
      contentHash: digest,
    });
  }
  updateManifest(entries);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function listSeasonKeys(): string[] {
  return readdirSync(NBA_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Python list repr for the unknown-label warning (['XYZ', ...]). */
function formatList(values: readonly string[]): string {
  return `[${values.map((value) => `'${value}'`).join(', ')}]`;
}
