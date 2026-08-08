/**
 * Franchise-era pool computation (spec/02, spec/12) - port of
 * scripts/import-nba/compute_pools.py.
 *
 * Pipeline:
 *   roster.json (strict ratings/tendencies/anchors/provenance) + stints.json
 *   (team-stint accounting) + season-stats.json (league totals) + lineage
 *   + eras -> eligible peak player-seasons per (franchise, era)
 *   -> compact v2 FranchiseEraPool JSON + availability matrix + manifest
 *
 * Ownership rules (spec/12): every source team-season resolves through the
 * authoritative lineage table to exactly one modern slot; the team-stint row
 * (40 games minimum) establishes eligibility; league-total rows inform
 * ratings but never eligibility. Incomplete players fail packaging instead
 * of silently receiving neutral values.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { parsePool } from '@hoop-rush/data-contracts';
import {
  COHORT_NORMALIZATION_VERSION,
  DERIVATION_METHOD_VERSION,
  LINEAGE_RULE_VERSION,
  POSITION_NORMALIZATION_VERSION,
  RATINGS_VERSION,
  POOL_SCHEMA_VERSION,
  REQUIRED_RATING_KEYS,
  SELECTION_SCORE_VERSION,
  SOURCE_VERSION,
  type Confidence,
  type CoverageSummary,
  type HistoricalValueProvenance,
  type Position,
  type RatingProfile,
  type UnavailabilityReason,
} from '@hoop-rush/data-contracts';
import { playableSlotGroups } from '@hoop-rush/data-contracts';
import { NBA_ROOT, PUBLIC_DATA, RAW_CACHE } from '../config.ts';
import { refreshPlayersIndexInManifest } from '../manifest/index.ts';
import {
  fileExists,
  safeFloat,
  safeInt,
  sha256File,
  writeJson,
  writeJsonRetry,
  clamp,
  clampUnitInterval,
} from '../json.ts';
import { buildPlayerPositions } from './positions.ts';
import { positionOverrideFor } from '../positions/overrides.ts';
import { canonicalPlayerName } from '../identity.ts';
import { derivePlayerRecord } from '../ratings/v2.ts';
import { getEra } from '../ratings/era.ts';
import { loadRatingsModelArtifact } from '../ratings/artifact.ts';

/** Re-exported so CLI consumers (e.g. bracket generation) share the one normalization. */
export { POSITION_LABEL_MAP, buildPlayerPositions, normalizePositionLabels } from './positions.ts';
import {
  LINEAGE_SEGMENTS,
  MODERN_SLOTS,
  firstSupportedSeason,
  resolveHistoricalIdentity,
} from '../lineage.ts';

/**
 * Python's json.loads accepts the bare NaN token that the fetch layer's
 * json.dumps writes (e.g. "college": NaN); JSON.parse does not. Pools never
 * consume the NaN fields, so the token is read as null - the same value the
 * Python num()/nullable() helpers would produce for it.
 */
function readJsonLoose(path: string): unknown {
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return JSON.parse(text.replace(/\bNaN\b(?=\s*[,}\]])/g, 'null')) as unknown;
    }
    throw error;
  }
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

export const SCHEMA_VERSION = POOL_SCHEMA_VERSION;
export const MIN_TEAM_GAMES = 40;
export const DATA_VERSION = 'm10-ratings-v3.6';
/** Confidence policy v1: maximum allowed low-confidence share of required fields. */
export const CONFIDENCE_POLICY_VERSION = 'policy-v1';
export const MAX_LOW_CONFIDENCE_SHARE = 0.4;
export {
  POSITION_NORMALIZATION_VERSION,
  RATINGS_VERSION,
  SELECTION_SCORE_VERSION,
} from '@hoop-rush/data-contracts';

// ---------------------------------------------------------------------------
// Career position unions (cached; scans every packaged roster once)
// ---------------------------------------------------------------------------
export function loadCareerPositionLabels(): Map<string, Set<string>> {
  // The cache is derived from the packaged roster snapshot. Version the
  // filename so older imports cannot silently erase positions for players
  // added in a later snapshot. v5 also collects each season's
  // secondaryPositions entries alongside the primary label.
  const cachePath = join(RAW_CACHE, 'career-position-labels-v5.json');
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
      if (Array.isArray(player.secondaryPositions)) {
        for (const secondary of player.secondaryPositions) {
          if (typeof secondary === 'string' && secondary !== '') {
            labels.add(secondary);
          }
        }
      }
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

export interface PoolIndexEntry {
  franchiseId: string;
  eraId: string;
  url: string;
  contentHash: string;
}

export interface Manifest {
  schemaVersion: number;
  dataVersion: string;
  eras: EraEntry[];
  pools: PoolIndexEntry[];
  [key: string]: unknown;
}

export function loadManifest(): Manifest {
  return readJsonLoose(manifestPath()) as Manifest;
}

// ---------------------------------------------------------------------------
// Per-season loading
// ---------------------------------------------------------------------------
export interface SeasonData {
  rosterByExtId: Record<string, Record<string, unknown>>;
  stintsByTeam: Record<string, Array<Record<string, unknown>>>;
  statsByPlayer: Record<string, Record<string, unknown>>;
}

/** Memoized per run so availability scans read each season's JSON once. */
const seasonDataCache = new Map<string, SeasonData>();
let fallbackRosterCache: Map<string, Record<string, unknown>> | null = null;
let ratingsModelArtifactCache: ReturnType<typeof loadRatingsModelArtifact> | null = null;

function currentRatingsModelArtifact(): ReturnType<typeof loadRatingsModelArtifact> {
  ratingsModelArtifactCache ??= loadRatingsModelArtifact();
  return ratingsModelArtifactCache;
}

function refreshedFallbackPlayer(
  player: Record<string, unknown>,
  season: string,
  stats: Record<string, unknown>,
  playerExternalId: string,
): Record<string, unknown> {
  const position = str(player.position) || 'SF';
  const height = player.heightInches;
  const heightInches =
    typeof height === 'number' && Number.isFinite(height) ? Math.trunc(height) : 78;
  const derived = derivePlayerRecord({
    season,
    position,
    heightInches,
    stats,
    playerId: `p-${playerExternalId}`,
    era: getEra(season),
    artifact: currentRatingsModelArtifact(),
  });
  return {
    ...player,
    ratings: derived.ratings,
    tendencies: derived.tendencies,
    summaryRatings: derived.summaryRatings,
    anchors: derived.anchors,
    provenance: derived.provenance,
    ratingProfile: derived.ratingProfile,
  };
}

/** Return { rosterByExtId, stintsByTeam, statsByPlayer } for a season. */
export function loadSeasonData(season: string): SeasonData {
  const cached = seasonDataCache.get(season);
  if (cached !== undefined) return cached;
  const seasonDir = join(NBA_ROOT, season);
  const rosterByExtId: Record<string, Record<string, unknown>> = {};
  const rosterPath = join(seasonDir, 'roster.json');
  if (fileExists(rosterPath)) {
    for (const player of readJsonLoose(rosterPath) as Array<Record<string, unknown>>) {
      rosterByExtId[str(player.externalId)] = player;
    }
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

  const data: SeasonData = { rosterByExtId, stintsByTeam, statsByPlayer };
  seasonDataCache.set(season, data);
  return data;
}

/**
 * Recover historical roster metadata when a source roster snapshot is empty
 * for a team but its player-team stints are present. Some NBA API historical
 * roster endpoints omit the original Charlotte franchise while still
 * returning the game-log stints. Packaged pools already contain validated
 * names, positions, ratings, tendencies, anchors, and provenance for most of
 * those players, so use the best existing record as metadata only and keep
 * the candidate season's stint and stats as the source of truth.
 */
function loadFallbackRosterPlayers(): Map<string, Record<string, unknown>> {
  if (fallbackRosterCache !== null) return fallbackRosterCache;

  const byPlayer = new Map<string, Record<string, unknown>>();
  for (const file of sortedJsonFiles(poolDir())) {
    try {
      const raw = readJsonLoose(join(poolDir(), file)) as { players?: unknown };
      if (!Array.isArray(raw.players)) continue;
      for (const value of raw.players) {
        if (value === null || typeof value !== 'object') continue;
        const player = value as Record<string, unknown>;
        const playerExternalId = str(player.playerExternalId);
        if (!playerExternalId) continue;
        const positions = player.positions as
          { primary?: unknown; secondary?: unknown } | undefined;
        const primary = typeof positions?.primary === 'string' ? positions.primary : 'F';
        const secondaryPositions = Array.isArray(positions?.secondary)
          ? positions.secondary.filter(
              (secondary): secondary is string => typeof secondary === 'string' && secondary !== '',
            )
          : [];
        const candidate: Record<string, unknown> = {
          ...player,
          externalId: playerExternalId,
          firstName: player.firstName,
          lastName: player.lastName,
          position: primary,
          secondaryPositions,
          heightInches: player.heightInches,
          weightLbs: player.weightLbs,
          ratings: player.detailedRatings,
          tendencies: player.tendencies,
          summaryRatings: player.summaryRatings,
          anchors: player.anchors,
          provenance: player.provenance,
        };
        const previous = byPlayer.get(playerExternalId);
        if (
          previous === undefined ||
          Number(player.selectionScore ?? 0) > Number(previous.selectionScore ?? 0)
        ) {
          byPlayer.set(playerExternalId, candidate);
        }
      }
    } catch {
      // One malformed or partial pool must not prevent other fallback records
      // from being used; the referenced pool will still fail its own audit.
    }
  }
  fallbackRosterCache = byPlayer;
  return byPlayer;
}

function sortedJsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

/** Default pool worker count: one per era, capped by the machine's cores. */
export function defaultPoolWorkers(): number {
  // Unit tests mock config paths; real worker threads would read the real
  // raw-data dirs, so the parallel default stays off under vitest.
  if (process.env.NODE_ENV === 'test') return 1;
  return Math.min(7, availableParallelism());
}

// ---------------------------------------------------------------------------
// Worker-thread pool orchestration
// ---------------------------------------------------------------------------
export interface PoolWorkerResult {
  results: TargetBuildResult[];
}

export interface PoolWorkerData {
  targets: Array<[string, string]>;
  manifest: Manifest;
  bbrefIds: Record<string, string>;
  /** Structured-clone-safe form of Map<string, Set<string>>. */
  careerLabels: Array<[string, string[]]> | null;
  withAssets: boolean;
}

/**
 * Splits targets into at most `workers` chunks so each chunk's season data is
 * disjoint: targets are grouped by era (one era = one season set), and the
 * largest groups are split deterministically in half until the chunk count is
 * reached. Output order is deterministic regardless of worker scheduling.
 */
export function partitionPoolTargets(
  targets: ReadonlyArray<[string, string]>,
  workers: number,
): Array<Array<[string, string]>> {
  const count = Math.max(1, Math.trunc(workers));
  if (count <= 1 || targets.length <= 1) {
    return [[...targets]];
  }
  const byEra = new Map<string, Array<[string, string]>>();
  for (const target of targets) {
    let group = byEra.get(target[1]);
    if (group === undefined) {
      group = [];
      byEra.set(target[1], group);
    }
    group.push(target);
  }
  const chunks = [...byEra.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, group]) => group.slice());
  while (chunks.length < count) {
    let largest = -1;
    let largestSize = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const size = chunks[i]?.length ?? 0;
      if (size > largestSize) {
        largest = i;
        largestSize = size;
      }
    }
    if (largestSize < 2) break;
    const chunk = chunks[largest];
    if (chunk === undefined) break;
    const mid = Math.ceil(chunk.length / 2);
    chunks.splice(largest, 1, chunk.slice(0, mid), chunk.slice(mid));
  }
  return chunks;
}

/** Runs one target chunk in a worker thread and resolves with its results. */
function runPoolChunk(
  chunk: Array<[string, string]>,
  manifest: Manifest,
  bbrefIds: Record<string, string>,
  careerLabels: Map<string, Set<string>>,
  withAssets: boolean,
): Promise<PoolWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pool-worker.ts', import.meta.url), {
      workerData: {
        targets: chunk,
        manifest,
        bbrefIds,
        careerLabels: [...careerLabels.entries()].map(
          ([pid, labels]) => [pid, [...labels]] as [string, string[]],
        ),
        withAssets,
      } satisfies PoolWorkerData,
    });
    let settled = false;
    worker.once('message', (result: PoolWorkerResult) => {
      settled = true;
      void worker.terminate();
      resolve(result);
    });
    worker.once('error', (error) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    worker.once('exit', (code) => {
      if (settled || code === 0) return;
      settled = true;
      reject(new Error(`pool worker exited with code ${String(code)}`));
    });
  });
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
  offensiveRebounds: number | null;
  defensiveRebounds: number | null;
  assists: number;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threesMade: number | null;
  threesAttempted: number | null;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  per: number | null;
  boxPlusMinus: number | null;
  usageRate: number | null;
  tsPct: number | null;
  efgPct: number | null;
}

/** Null-preserving stats: genuinely absent historical fields stay null. */
export function buildStats(seasonStats: Record<string, unknown>): PoolStats {
  const truncNullable = (key: string): number | null => {
    const value = nullableValue(seasonStats, key);
    return value === null ? null : Math.trunc(value);
  };
  const fieldGoalsAttempted = Math.trunc(num(seasonStats, 'fga'));
  const fieldGoalsMade = Math.min(Math.trunc(num(seasonStats, 'fgm')), fieldGoalsAttempted);
  const freeThrowsAttempted = Math.trunc(num(seasonStats, 'fta'));
  const freeThrowsMade = Math.min(Math.trunc(num(seasonStats, 'ftm')), freeThrowsAttempted);
  const threesAttempted = truncNullable('tpa');
  const threesMadeRaw = truncNullable('tpm');
  const threesMade =
    threesAttempted !== null && threesMadeRaw !== null
      ? Math.min(threesMadeRaw, threesAttempted)
      : threesMadeRaw;
  return {
    gamesPlayed: Math.trunc(num(seasonStats, 'gamesPlayed')),
    minutes: Math.trunc(num(seasonStats, 'minutes')),
    points: Math.trunc(num(seasonStats, 'points')),
    rebounds: Math.trunc(num(seasonStats, 'rebounds')),
    offensiveRebounds: truncNullable('offensiveRebounds'),
    defensiveRebounds: truncNullable('defensiveRebounds'),
    assists: Math.trunc(num(seasonStats, 'assists')),
    steals: truncNullable('steals'),
    blocks: truncNullable('blocks'),
    turnovers: truncNullable('turnovers'),
    fieldGoalsMade,
    fieldGoalsAttempted,
    threesMade,
    threesAttempted,
    freeThrowsMade,
    freeThrowsAttempted,
    per: nullableValue(seasonStats, 'per'),
    boxPlusMinus: nullableValue(seasonStats, 'boxPlusMinus'),
    usageRate: nullableValue(seasonStats, 'usageRate'),
    tsPct: clampUnitInterval(nullableValue(seasonStats, 'tsPct')),
    efgPct: clampUnitInterval(nullableValue(seasonStats, 'efgPct')),
  };
}

const ANCHOR_UNIT_FIELDS = [
  'fieldGoalPct',
  'threePointPct',
  'freeThrowPct',
  'threePointAttemptRate',
  'freeThrowAttemptRate',
] as const;

/** Clamp packaged anchor rates to the 0..1 contract when stint totals are inconsistent. */
export function sanitizeAnchors(anchors: Record<string, unknown>): Record<string, unknown> {
  const out = { ...anchors };
  for (const field of ANCHOR_UNIT_FIELDS) {
    const value = out[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[field] = clamp(value, 0, 1);
    }
  }
  return out;
}

export interface SummaryRatingsRaw {
  overallRating?: unknown;
  offenseRating?: unknown;
  defenseRating?: unknown;
}

/**
 * Pre-percentile raw overall score for selection scoring: the rating
 * profile's rawOverallScore when present, else the canonical curve overall
 * (should not happen once ratings v3.5+ packaged every candidate).
 */
export function rawOverallScoreFor(
  player: Record<string, unknown>,
  summary: SummaryRatingsRaw | undefined,
): number {
  const profile = player.ratingProfile as
    { rawOverallScore?: unknown; canonicalOverall?: unknown } | undefined;
  const raw = profile?.rawOverallScore;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  const canonical = profile?.canonicalOverall;
  if (typeof canonical === 'number' && Number.isFinite(canonical)) {
    return canonical;
  }
  // Fallback: the canonical curve value, never a percentile-shifted overall.
  return safeFloat(summary?.overallRating);
}

/**
 * Versioned selection-score blend plus modest season-availability adjustment.
 * The raw overall is the pre-percentile rawOverallScore from the rating
 * profile so peak selection never depends on cohort-normalized values.
 */
export function selectionScore(
  rawOverallScore: number,
  offenseRating: number,
  defenseRating: number,
  usageRate: number | null,
  teamMinutes: number,
  teamGames: number,
): number {
  const usage = Math.min(Math.max(usageRate || 0, 0), 40.0);
  const mpg = Math.min(teamMinutes / Math.max(1, teamGames), 48.0);
  const availability = 0.96 + 0.04 * Math.min(Math.max(teamGames, 0) / 82, 1);
  // Overall is the production-aware total-contribution estimate. Give it
  // more weight than either component so pass-first and pre-three-point
  // creators are not buried, while retaining offense/defense as balance
  // signals for season selection.
  const raw =
    0.6 * rawOverallScore + 0.25 * offenseRating + 0.15 * defenseRating + 0.05 * usage + 0.02 * mpg;
  return Math.round(raw * availability * 1000) / 1000;
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
    selectionScore(
      rawOverallScoreFor(candidate.player, summary),
      safeFloat(summary?.offenseRating),
      safeFloat(summary?.defenseRating),
      nullableValue(candidate.stats, 'usageRate'),
      minutes,
      games,
    ),
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
    if (compareSelectionKeys(itemKey, bestKey) > 0) {
      best = item;
      bestKey = itemKey;
    }
  }
  return best;
}

export function compareSelectionKeys(a: readonly number[], b: readonly number[]): number {
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

// ---------------------------------------------------------------------------
// Global cohort Overall normalization (COHORT_NORMALIZATION_VERSION)
// ---------------------------------------------------------------------------
/**
 * Minimal row shape the cohort pass needs; every PoolPlayer satisfies it.
 * Only overallRating (summary) and the optional ratingProfile percentile
 * fields are written — offense/defense/detailedRatings/tendencies/anchors/
 * provenance never change.
 */
export interface PoolOverallRow {
  playerId: string;
  franchiseId: string;
  seasonKey: string;
  summaryRatings: { overallRating: number; offenseRating: number; defenseRating: number };
  ratingProfile?: {
    rawOverallScore?: number | null;
    canonicalOverall?: number;
    overallPercentile?: number;
    overallCohortVersion?: string;
  } | null;
}

export interface PoolOverallDiagnostics {
  /** Total rows ranked and normalized. */
  totalRowCount: number;
  /** Rows without rawOverallScore; ranked by canonical overall, profile fields untouched. */
  rowsWithoutRawOverall: number;
}

/**
 * Packaged Overall for a cumulative rank fraction p (0 = best, 1 = worst).
 * Band boundaries match the target shares 0.5/4.5/14/61/20 percent.
 */
export function overallBandForPercentile(p: number): number {
  let value: number;
  if (p < 0.005) {
    value = 99 - (p / 0.005) * 4; // band 95-99
  } else if (p < 0.05) {
    value = 94 - ((p - 0.005) / 0.045) * 4; // band 90-94
  } else if (p < 0.19) {
    value = 89 - ((p - 0.05) / 0.14) * 4; // band 85-89
  } else if (p < 0.8) {
    value = 84 - ((p - 0.19) / 0.61) * 12; // band 72-84
  } else {
    value = 71 - ((p - 0.8) / 0.2) * 31; // band 40-71
  }
  return clamp(Math.round(value), 40, 99);
}

/** True when the row carries a usable pre-percentile raw overall score. */
function hasRawOverallScore(row: PoolOverallRow): boolean {
  const raw = row.ratingProfile?.rawOverallScore;
  return typeof raw === 'number' && Number.isFinite(raw);
}

/** Ranking proxy: rawOverallScore, else canonicalOverall, else the summary overall. */
function rankingProxy(row: PoolOverallRow): number {
  if (hasRawOverallScore(row)) {
    return row.ratingProfile?.rawOverallScore as number;
  }
  const canonical = row.ratingProfile?.canonicalOverall;
  if (typeof canonical === 'number' && Number.isFinite(canonical)) {
    return canonical;
  }
  return row.summaryRatings.overallRating;
}

/**
 * Post-pass over the complete set of packaged rows: ranks every row globally
 * by raw overall score (descending; ties break ascending by playerId, then
 * seasonKey, then franchiseId), replaces summaryRatings.overallRating with
 * the percentile band value, and stamps the profile percentile fields with
 * COHORT_NORMALIZATION_VERSION. Rows without rawOverallScore are ranked by
 * canonicalOverall and their profile fields are left untouched.
 */
export function normalizePoolOveralls(rows: PoolOverallRow[]): PoolOverallDiagnostics {
  const totalRowCount = rows.length;
  let rowsWithoutRawOverall = 0;
  for (const row of rows) {
    if (!hasRawOverallScore(row)) rowsWithoutRawOverall += 1;
  }
  const ranked = [...rows].sort((a, b) => {
    const score = rankingProxy(b) - rankingProxy(a);
    if (score !== 0) return score;
    return (
      a.playerId.localeCompare(b.playerId) ||
      a.seasonKey.localeCompare(b.seasonKey) ||
      a.franchiseId.localeCompare(b.franchiseId)
    );
  });
  ranked.forEach((row, index) => {
    const p = index / totalRowCount;
    row.summaryRatings.overallRating = overallBandForPercentile(p);
    if (hasRawOverallScore(row) && row.ratingProfile != null) {
      row.ratingProfile.overallPercentile =
        Math.round(((index + 1) / totalRowCount) * 10000) / 10000;
      row.ratingProfile.overallCohortVersion = COHORT_NORMALIZATION_VERSION;
    }
  });
  return { totalRowCount, rowsWithoutRawOverall };
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

/**
 * Asset altIds from the previously packaged pool (playerExternalId -> altIds).
 * Only the annotate-markers.mjs markers (nbaHeadshotAvailable, photoUrl) are
 * backfilled; a missing or unreadable pool file yields an empty map.
 */
export function loadExistingAssetAltIds(
  franchiseId: string,
  eraId: string,
): Map<string, Record<string, unknown>> {
  const path = join(poolDir(), `${franchiseId}-${eraId}.json`);
  if (!fileExists(path)) {
    return new Map();
  }
  try {
    const pool = readJsonLoose(path) as Pool;
    const byExternalId = new Map<string, Record<string, unknown>>();
    for (const player of pool.players) {
      if (player.altIds !== null && typeof player.altIds === 'object') {
        byExternalId.set(player.playerExternalId, player.altIds);
      }
    }
    return byExternalId;
  } catch (error) {
    console.log(
      `  [WARN] cannot read previous pool ${basename(path)}: ${(error as Error).message}`,
    );
    return new Map();
  }
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
  altIds: {
    bbref?: string | null;
    nbaHeadshotAvailable?: boolean;
    photoUrl?: string | null;
  } | null;
  positions: {
    primary: string;
    secondary: string[];
    playable: string[];
    sourceLabels: string[];
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
  historicalTeamIdentity: {
    teamId: string;
    displayName: string;
    city: string;
    abbreviation: string | null;
    seasonKey: string;
    lineageRuleVersion: string;
  };
  summaryRatings: { overallRating: number; offenseRating: number; defenseRating: number };
  /** Ratings v3 explanation and calibration profile (raw pre-percentile overall). */
  ratingProfile?: RatingProfile;
  detailedRatings: Record<string, number>;
  tendencies: Record<string, number>;
  anchors: Record<string, unknown>;
  provenance: Record<string, HistoricalValueProvenance>;
  source: {
    dataVersion: string;
    ratingsVersion: string;
    selectionScoreVersion: string;
    sourceVersion: string;
    derivationMethodVersion: string;
    lineageRuleVersion: string;
  };
}

export interface Pool {
  schemaVersion: number;
  dataVersion: string;
  franchiseId: string;
  eraId: string;
  eligibility: { minimumTeamGames: number };
  coverageSummary: CoverageSummary;
  players: PoolPlayer[];
}

export type PoolBuildFailure = {
  reason: UnavailabilityReason;
  detail: string;
  firstSupportedSeason?: string;
};

function failure(
  reason: UnavailabilityReason,
  detail: string,
  firstSupportedSeason?: string,
): PoolBuildFailure {
  return {
    reason,
    detail,
    ...(firstSupportedSeason !== undefined ? { firstSupportedSeason } : {}),
  };
}

/** Coverage band from the pool's packaged season range (spec/12). */
export function coverageBandForSeasons(
  seasons: readonly string[],
): CoverageSummary['coverageBand'] {
  const earliest = seasons.reduce((a, b) => (a < b ? a : b));
  if (earliest >= '1996-97') return 'advanced-supported';
  if (earliest >= '1979-80') return 'complete-box-derived';
  if (earliest >= '1973-74') return 'late-historical';
  return 'reconstructed';
}

/** True when at least one legal G,G,F,F,C assignment exists over the pool. */
export function legalLineupCovered(players: readonly PoolPlayer[]): boolean {
  const slotGroupsOf = (player: PoolPlayer): readonly string[] =>
    playableSlotGroups(player.positions.playable as Position[]);
  const guards = players.filter((p) => slotGroupsOf(p).includes('G'));
  const forwards = players.filter((p) => slotGroupsOf(p).includes('F'));
  const centers = players.filter((p) => slotGroupsOf(p).includes('C'));
  if (guards.length < 2 || forwards.length < 2 || centers.length < 1) return false;
  // Any guard can take a G slot, any forward an F slot; C must be a center.
  return true;
}

/**
 * Builds the coverage summary: observed/derived/estimated/reconstructed
 * families, missing categories, and the low-confidence share under the
 * versioned policy (spec/12). Reconstructed families (three-point on
 * pre-1979 / missing-record seasons) are accounted separately from derived
 * and estimated values.
 */
export function buildCoverageSummary(
  players: readonly PoolPlayer[],
  seasons: readonly string[],
): CoverageSummary {
  const requiredFields = players.flatMap((player) => [
    ...Object.keys(player.detailedRatings),
    ...Object.keys(player.tendencies),
    ...Object.keys(player.anchors),
  ]);
  let lowConfidence = 0;
  const observedFamilies = new Set<string>();
  const derivedFamilies = new Set<string>();
  const estimatedFamilies = new Set<string>();
  const reconstructedFamilies = new Set<string>();
  const missingCategories = new Set<string>();

  for (const player of players) {
    for (const [field, provenance] of Object.entries(player.provenance)) {
      if (provenance.kind === 'observed') observedFamilies.add(fieldFamily(field));
      else if (provenance.kind === 'derived') derivedFamilies.add(fieldFamily(field));
      else if (provenance.kind === 'reconstructed') reconstructedFamilies.add(fieldFamily(field));
      else estimatedFamilies.add(fieldFamily(field));
      if (provenance.sourceStatus === 'not-applicable') {
        missingCategories.add(fieldFamily(field));
      }
    }
    if (player.provenance['threePoint']?.sourceStatus === 'not-applicable') {
      missingCategories.add('three-point');
    }
  }
  // Count confidence on required engine fields only.
  for (const field of requiredFields) {
    const provenance = players[0]?.provenance[field];
    if (provenance !== undefined && provenance.confidence === 'low') lowConfidence += 1;
  }
  const lowConfidenceShare = requiredFields.length > 0 ? lowConfidence / requiredFields.length : 0;
  return {
    coverageBand: coverageBandForSeasons(seasons),
    observedFamilies: [...observedFamilies].sort(),
    derivedFamilies: [...derivedFamilies].sort(),
    estimatedFamilies: [...estimatedFamilies].sort(),
    ...(reconstructedFamilies.size > 0
      ? { reconstructedFamilies: [...reconstructedFamilies].sort() }
      : {}),
    missingCategories: [...missingCategories].sort(),
    lowConfidenceShare: Math.round(lowConfidenceShare * 1000) / 1000,
    policyVersion: CONFIDENCE_POLICY_VERSION,
  };
}

function fieldFamily(field: string): string {
  const tendency = field.startsWith('tendency:') ? field.slice('tendency:'.length) : field;
  if (tendency === 'usageRate' || tendency === 'passRate' || tendency === 'shotRate')
    return 'usage';
  if (tendency.includes('Frequency') || tendency === 'threePointRate') return 'shot-mix';
  if (tendency === 'freeThrowRate') return 'fouls';
  if (tendency === 'turnoverRate') return 'turnovers';
  if (tendency.includes('Rebound')) return 'rebounding';
  if (tendency.includes('AttemptRate')) return 'defensive-events';
  if (tendency.includes('Rate')) return 'usage';
  if (field === 'threePoint' || field === 'midrange' || field === 'closeShot') return 'shooting';
  if (field === 'insideScoring') return 'shooting';
  if (field === 'freeThrow') return 'fouls';
  if (field === 'passing' || field === 'ballHandling' || field === 'offensiveIq') return 'creation';
  if (field.includes('Rebound')) return 'rebounding';
  if (
    field.includes('Defense') ||
    field === 'defensiveIq' ||
    field === 'steal' ||
    field === 'block'
  ) {
    return 'defense';
  }
  if (field === 'speed' || field === 'strength' || field === 'vertical') return 'athleticism';
  if (field === 'pointsPerGame') return 'scoring';
  if (field === 'assistsPerGame') return 'playmaking';
  if (field === 'stealsPerGame' || field === 'blocksPerGame') return 'defensive-events';
  if (field === 'turnoversPerGame') return 'turnovers';
  if (field.includes('Rebound')) return 'rebounding';
  if (field === 'fieldGoalPct' || field === 'threePointPct' || field === 'freeThrowPct')
    return 'shooting';
  if (field.includes('AttemptRate')) return 'shot-mix';
  return tendency;
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    return value;
  }
  return null;
}

/** Confidence of a player's provenance over required engine fields. */
function playerLowConfidenceShare(player: PoolPlayer): number {
  const fields = [
    ...Object.keys(player.detailedRatings),
    ...Object.keys(player.tendencies),
    ...Object.keys(player.anchors),
  ];
  let low = 0;
  for (const field of fields) {
    if (player.provenance[field]?.confidence === 'low') low += 1;
  }
  return fields.length > 0 ? low / fields.length : 0;
}

export function computePool(
  franchiseId: string,
  eraId: string,
  manifest: Manifest,
  bbrefIds?: Record<string, string>,
  withAssets = true,
  careerLabels?: Map<string, Set<string>> | null,
  keepSeasonCache = false,
): Pool | PoolBuildFailure {
  if (bbrefIds === undefined) {
    bbrefIds = loadBbrefIds();
  }
  const slot = MODERN_SLOTS.find((s) => s.franchiseId === franchiseId);
  if (slot === undefined) {
    return failure('identity-failed', `unknown franchiseId ${franchiseId}`);
  }
  const era = manifest.eras.find((e) => e.eraId === eraId);
  if (era === undefined) {
    return failure('identity-failed', `unknown eraId ${eraId}`);
  }

  // No-franchise-history: the slot has no NBA lineage inside the era range.
  const eraHasLineage = LINEAGE_SEGMENTS.some(
    (segment) =>
      segment.modernFranchiseId === franchiseId &&
      segment.validFromSeasonKey <= era.toSeasonKey &&
      (segment.validThroughSeasonKey === undefined ||
        segment.validThroughSeasonKey >= era.fromSeasonKey),
  );
  if (!eraHasLineage) {
    const first = firstSupportedSeason(franchiseId);
    return failure(
      'no-franchise-history',
      `no NBA history for ${franchiseId} between ${era.fromSeasonKey} and ${era.toSeasonKey}`,
      first ?? undefined,
    );
  }

  const teamExternalId = slot.teamExternalId;
  const seasons = listSeasonKeys().filter(
    (season) => era.fromSeasonKey <= season && season <= era.toSeasonKey,
  );
  if (seasons.length === 0) {
    return failure('source-incomplete', `no packaged seasons for era ${eraId}`);
  }

  console.log(`[${franchiseId} ${eraId}] scanning ${String(seasons.length)} seasons`);
  const careerLabelsMap = careerLabels ?? loadCareerPositionLabels();
  const existingAssetAltIds = loadExistingAssetAltIds(franchiseId, eraId);

  const eligible = new Map<string, Candidate[]>();
  const missingStints: string[] = [];

  for (const season of seasons) {
    const { rosterByExtId, stintsByTeam, statsByPlayer } = loadSeasonData(season);
    const identity = resolveHistoricalIdentity(franchiseId, season);
    const stints = identity === null ? [] : (stintsByTeam[teamExternalId] ?? []);
    if (
      identity !== null &&
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
      // The fallback roster map (all packaged pools, memoized) is only
      // loaded on a source miss — targets with complete rosters never pay
      // the ~135 MB pooled scan.
      const sourcePlayer = rosterByExtId[pid] ?? loadFallbackRosterPlayers().get(pid);
      if (sourcePlayer === undefined) {
        continue;
      }
      const stats = statsByPlayer[pid];
      if (stats === undefined || Math.trunc(num(stats, 'gamesPlayed')) === 0) {
        continue;
      }
      const player =
        rosterByExtId[pid] !== undefined
          ? sourcePlayer
          : refreshedFallbackPlayer(sourcePlayer, season, stats, pid);
      const summary = player.summaryRatings;
      if (summary === null || summary === undefined) {
        console.log(`  ! ${pid} missing summaryRatings in ${season}; re-run compute_ratings`);
        continue;
      }
      const ratings = player.ratings;
      const tendencies = player.tendencies;
      const anchors = player.anchors;
      if (ratings === undefined || tendencies === undefined || anchors === undefined) {
        console.log(`  ! ${pid} incomplete engine inputs in ${season}; re-run compute_ratings`);
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

  // The cache exists to memoize season JSON within one pool scan; every
  // season is reloadable from disk, so drop it before the next target unless
  // the caller (a worker owning a single era's targets) asks to keep it.
  if (!keepSeasonCache) {
    seasonDataCache.clear();
  }

  if (missingStints.length > 0) {
    console.log(`  [WARN] no stints for ${franchiseId} in: ${missingStints.join(', ')}`);
  }

  const playersOut: PoolPlayer[] = [];
  const identityFailures: string[] = [];
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
    const peakPrimary = str(player.position);
    const peakSecondary = Array.isArray(player.secondaryPositions)
      ? player.secondaryPositions.filter(
          (secondary): secondary is string => typeof secondary === 'string' && secondary !== '',
        )
      : [];
    const override = positionOverrideFor(pid);
    const career = careerLabelsMap.get(pid);
    const labels =
      career !== undefined && career.size > 0 ? career : new Set([peakPrimary, ...peakSecondary]);
    const { record, unknownLabels } = buildPlayerPositions({
      careerLabels: labels,
      peakPrimary,
      peakSecondary,
      override,
    });
    if (unknownLabels.length > 0) {
      console.log(
        `  [WARN] ${str(player.firstName)} ${str(player.lastName)} (${pid}) unknown position labels: ${formatList(unknownLabels)}`,
      );
    }

    const identity = resolveHistoricalIdentity(franchiseId, best.season);
    if (identity === null) {
      identityFailures.push(`${pid} ${best.season}`);
      continue;
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
    // Strict engine contracts: incomplete players fail packaging.
    const requiredTendencyKeys = [
      'usageRate',
      'passRate',
      'shotRate',
      'driveRate',
      'postUpRate',
      'rimFrequency',
      'shortMidFrequency',
      'longMidFrequency',
      'cornerThreeFrequency',
      'aboveBreakThreeFrequency',
      'threePointRate',
      'freeThrowRate',
      'turnoverRate',
      'isolationRate',
      'pickAndRollBallHandlerRate',
      'pickAndRollRollManRate',
      'spotUpRate',
      'transitionRate',
      'cutRate',
      'foulRate',
      'stealAttemptRate',
      'blockAttemptRate',
      'crashOffensiveGlassRate',
    ];
    for (const key of REQUIRED_RATING_KEYS) {
      if (!(key in detailedRatings)) {
        identityFailures.push(`${pid} missing rating ${key} in ${best.season}`);
      }
    }
    const tendenciesOut: Record<string, number> = {};
    for (const key of requiredTendencyKeys) {
      const value = tendencies[key];
      const n = Number(value);
      if (Number.isNaN(n)) {
        identityFailures.push(`${pid} missing tendency ${key} in ${best.season}`);
      } else {
        tendenciesOut[key] = n;
      }
    }
    const anchorsOut = sanitizeAnchors(player.anchors as Record<string, unknown>);
    const provenanceOut = (player.provenance ?? {}) as Record<string, HistoricalValueProvenance>;
    if (identityFailures.length > 0) {
      continue;
    }

    const [firstName, lastName] = canonicalPlayerName(
      pid,
      str(player.firstName),
      str(player.lastName),
    );
    const altIds: NonNullable<PoolPlayer['altIds']> = {};
    if (Object.hasOwn(bbrefIds, pid)) {
      altIds.bbref = bbrefIds[pid];
    }
    // Preserve the asset markers scripts/annotate-markers.mjs wrote into the
    // previous build; regenerating a pool must never wipe
    // nbaHeadshotAvailable/photoUrl (the UI then regresses to CDN
    // silhouettes). bbref stays cache-authoritative.
    const previous = existingAssetAltIds.get(pid);
    if (previous !== undefined) {
      if (typeof previous.nbaHeadshotAvailable === 'boolean') {
        altIds.nbaHeadshotAvailable = previous.nbaHeadshotAvailable;
      }
      if (Object.hasOwn(previous, 'photoUrl')) {
        altIds.photoUrl = previous.photoUrl as string | null;
      }
    }
    playersOut.push({
      schemaVersion: SCHEMA_VERSION,
      playerId: `p-${pid}`,
      franchiseId,
      eraId,
      seasonKey: best.season,
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`.trim(),
      playerExternalId: pid,
      altIds: Object.keys(altIds).length > 0 ? altIds : null,
      positions: {
        primary: record.primary,
        secondary: record.secondary,
        playable: record.playable,
        sourceLabels: record.sourceLabels,
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
        rawOverallScoreFor(player, summary),
        safeFloat(summary?.offenseRating),
        safeFloat(summary?.defenseRating),
        nullableValue(stats, 'usageRate'),
        teamMinutes,
        teamGames,
      ),
      selectionScoreVersion: SELECTION_SCORE_VERSION,
      stats: buildStats(stats),
      historicalTeamIdentity: {
        teamId: identity.historicalTeamId,
        displayName: identity.displayName,
        city: identity.city,
        abbreviation: identity.abbreviation ?? null,
        seasonKey: best.season,
        lineageRuleVersion: LINEAGE_RULE_VERSION,
      },
      summaryRatings: {
        overallRating: safeInt(summary?.overallRating),
        offenseRating: safeInt(summary?.offenseRating),
        defenseRating: safeInt(summary?.defenseRating),
      },
      ...(player.ratingProfile != null
        ? { ratingProfile: player.ratingProfile as RatingProfile }
        : {}),
      detailedRatings,
      tendencies: tendenciesOut,
      anchors: anchorsOut,
      ...(player.reconstructedThreePoint != null
        ? { reconstructedThreePoint: player.reconstructedThreePoint }
        : {}),
      provenance: provenanceOut,
      source: {
        dataVersion: DATA_VERSION,
        ratingsVersion: RATINGS_VERSION,
        selectionScoreVersion: SELECTION_SCORE_VERSION,
        sourceVersion: SOURCE_VERSION,
        derivationMethodVersion: DERIVATION_METHOD_VERSION,
        lineageRuleVersion: LINEAGE_RULE_VERSION,
      },
    });
  }

  if (playersOut.length === 0) {
    const detail =
      identityFailures.length > 0
        ? `all candidates incomplete: ${identityFailures.slice(0, 5).join(', ')}`
        : `no eligible players (no packaged stints for team ${teamExternalId} in era seasons)`;
    return failure('insufficient-players', detail);
  }

  if (!legalLineupCovered(playersOut)) {
    return failure(
      'position-coverage-failed',
      `cannot form G,G,F,F,C from ${String(playersOut.length)} players`,
    );
  }

  const coverageSummary = buildCoverageSummary(playersOut, seasons);
  const policyFailures = playersOut.filter(
    (p) => playerLowConfidenceShare(p) > MAX_LOW_CONFIDENCE_SHARE,
  );
  if (policyFailures.length > 0) {
    return failure(
      'confidence-failed',
      `${String(policyFailures.length)} players exceed the low-confidence share under ${CONFIDENCE_POLICY_VERSION}`,
    );
  }

  if (withAssets) {
    // Headshot/photo annotation is a separate script
    // (scripts/annotate-markers.mjs); network asset resolution is
    // intentionally not ported into the pool build.
    console.log(
      '  [WARN] headshot/photo asset annotation stays in scripts/annotate-markers.mjs; skipping',
    );
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    dataVersion: DATA_VERSION,
    franchiseId,
    eraId,
    eligibility: { minimumTeamGames: MIN_TEAM_GAMES },
    coverageSummary,
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
  // Synced/filtered filesystems intermittently fail writes; retry with
  // backoff, then hash the committed bytes.
  writeJsonRetry(path, pool);
  let digest = '';
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      digest = sha256File(path);
      break;
    } catch (error) {
      if (attempt === 11) throw error;
      const wait = 200 * (attempt + 1);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
  console.log(
    `  [OK] wrote ${basename(path)} (${String(pool.players.length)} players, ${digest.slice(0, 12)}...)`,
  );
  return digest;
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

/** The --all logic: modern slots x eras with lineage overlap and packaged seasons. */
export function allPoolTargets(manifest: Manifest = loadManifest()): Array<[string, string]> {
  const packagedSeasons = new Set(listSeasonKeys());
  const targets: Array<[string, string]> = [];
  for (const slot of MODERN_SLOTS) {
    for (const era of manifest.eras) {
      const hasLineage = LINEAGE_SEGMENTS.some(
        (segment) =>
          segment.modernFranchiseId === slot.franchiseId &&
          segment.validFromSeasonKey <= era.toSeasonKey &&
          (segment.validThroughSeasonKey === undefined ||
            segment.validThroughSeasonKey >= era.fromSeasonKey),
      );
      const overlaps =
        hasLineage &&
        [...packagedSeasons].some(
          (season) => era.fromSeasonKey <= season && season <= era.toSeasonKey,
        );
      if (overlaps) {
        targets.push([slot.franchiseId, era.eraId]);
      }
    }
  }
  return targets;
}

/** One target's build outcome: the manifest entry when available, plus the coverage row. */
export interface TargetBuildResult {
  entry: { franchiseId: string; eraId: string; url: string; contentHash: string } | null;
  coverage: CoverageReportEntry;
}

/** Shared by the sequential path and worker threads; never duplicates rules. */
export function buildPoolForTarget(
  franchiseId: string,
  eraId: string,
  manifest: Manifest,
  bbrefIds: Record<string, string>,
  withAssets: boolean,
  careerLabels: Map<string, Set<string>> | null,
  keepSeasonCache = false,
): TargetBuildResult {
  const pool = computePool(
    franchiseId,
    eraId,
    manifest,
    bbrefIds,
    withAssets,
    careerLabels,
    keepSeasonCache,
  );
  if ('reason' in pool) {
    console.log(`  [UNAVAILABLE] ${franchiseId} ${eraId}: ${pool.reason} (${pool.detail})`);
    return {
      entry: null,
      coverage: {
        franchiseId,
        eraId,
        status: 'unavailable',
        reason: pool.reason,
        detail: pool.detail,
        ...(pool.firstSupportedSeason !== undefined
          ? { firstSupportedSeason: pool.firstSupportedSeason }
          : {}),
      },
    };
  }
  logPoolValidation(pool);
  const digest = writePool(pool);
  return {
    entry: {
      franchiseId,
      eraId,
      url: `pools/${franchiseId}-${eraId}.json`,
      contentHash: digest,
    },
    coverage: {
      franchiseId,
      eraId,
      status: 'available',
      playerCount: pool.players.length,
      coverageSummary: pool.coverageSummary,
    },
  };
}

/**
 * Cohort percentile post-pass (COHORT_NORMALIZATION_VERSION): every packaged
 * franchise-era row is ranked globally by raw overall and its summary
 * overallRating replaced with the percentile band value. Pools are written
 * by workers during the build, so the pass re-reads every pool file and
 * rewrites it before the manifest refresh — content hashes therefore always
 * describe the normalized bytes.
 */
function applyOverallCohortNormalization(): Array<{
  franchiseId: string;
  eraId: string;
  url: string;
  contentHash: string;
}> {
  const pools: Pool[] = [];
  for (const name of sortedJsonFiles(poolDir())) {
    const [franchiseId, eraId] = name.slice(0, -5).split('-', 2);
    if (franchiseId === undefined || eraId === undefined) continue;
    try {
      const pool = readJsonLoose(join(poolDir(), name)) as Pool;
      if (!Array.isArray(pool.players) || pool.players.length === 0) continue;
      pools.push(pool);
    } catch {
      // Unreadable pool files surface in the manifest/audit layer instead.
    }
  }
  const diagnostics = normalizePoolOveralls(pools.flatMap((pool) => pool.players));
  const rewritten: Array<{
    franchiseId: string;
    eraId: string;
    url: string;
    contentHash: string;
  }> = [];
  for (const pool of pools) {
    const digest = writePool(pool);
    rewritten.push({
      franchiseId: pool.franchiseId,
      eraId: pool.eraId,
      url: `pools/${pool.franchiseId}-${pool.eraId}.json`,
      contentHash: digest,
    });
  }
  if (diagnostics.totalRowCount > 0) {
    console.log(
      `  [OK] overall cohort normalization (${COHORT_NORMALIZATION_VERSION}): ${String(diagnostics.totalRowCount)} rows across ${String(rewritten.length)} pools (${String(diagnostics.rowsWithoutRawOverall)} without rawOverallScore)`,
    );
  }
  return rewritten;
}

export async function run(
  targets: Array<[string, string]> | null = null,
  withAssets = true,
  workers?: number,
): Promise<void> {
  if (targets === null) {
    targets = [['lakers', '1990s']];
  }
  const manifest = loadManifest();
  const bbrefIds = loadBbrefIds();
  const careerLabels = loadCareerPositionLabels();
  const workerCount =
    workers === undefined ? defaultPoolWorkers() : Math.max(1, Math.trunc(workers));

  let results: TargetBuildResult[];
  if (workerCount <= 1 || targets.length <= 1) {
    results = [];
    for (const [franchiseId, eraId] of targets) {
      results.push(
        // Keep the season JSON cache warm across the whole sequential pass
        // (each season parses once, not once per target).
        buildPoolForTarget(franchiseId, eraId, manifest, bbrefIds, withAssets, careerLabels, true),
      );
    }
  } else {
    const chunks = partitionPoolTargets(targets, workerCount);
    const workerResults = await Promise.all(
      chunks.map((chunk) => runPoolChunk(chunk, manifest, bbrefIds, careerLabels, withAssets)),
    );
    results = workerResults.flatMap((chunkResult) => chunkResult.results);
  }

  const entries = results
    .map((result) => result.entry)
    .filter(
      (entry): entry is { franchiseId: string; eraId: string; url: string; contentHash: string } =>
        entry !== null,
    );
  const normalizedEntries = applyOverallCohortNormalization();
  const entriesByKey = new Map<string, (typeof entries)[number]>();
  for (const entry of [...entries, ...normalizedEntries]) {
    entriesByKey.set(`${entry.franchiseId}/${entry.eraId}`, entry);
  }
  updateManifest([...entriesByKey.values()]);
  recordCoverageReport(results.map((result) => result.coverage));
  refreshPlayersIndexInManifest();
}

/** One persisted coverage-audit row (spec/12 first full audit + CLI data coverage). */
export interface CoverageReportEntry {
  franchiseId: string;
  eraId: string;
  status: 'available' | 'unavailable';
  reason?: UnavailabilityReason;
  detail?: string;
  firstSupportedSeason?: string;
  playerCount?: number;
  coverageSummary?: CoverageSummary;
}

export function coverageReportPath(): string {
  return join(PUBLIC_DATA, 'coverage-report.json');
}

/** Loads the persisted coverage audit; empty when no build has written one. */
export function loadCoverageReport(): CoverageReportEntry[] {
  if (!fileExists(coverageReportPath())) return [];
  return readJsonLoose(coverageReportPath()) as CoverageReportEntry[];
}

/** Writes the coverage audit atomically alongside the manifest (merge, never replace). */
export function recordCoverageReport(entries: CoverageReportEntry[]): void {
  const existing = new Map(
    loadCoverageReport().map((entry) => [`${entry.franchiseId}/${entry.eraId}`, entry]),
  );
  for (const entry of entries) {
    existing.set(`${entry.franchiseId}/${entry.eraId}`, entry);
  }
  const merged = [...existing.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => entry);
  writeJsonRetry(coverageReportPath(), merged);
  console.log(
    `  [OK] coverage report updated: ${String(merged.filter((e) => e.status === 'available').length)} available, ${String(merged.filter((e) => e.status === 'unavailable').length)} unavailable`,
  );
}

/** Cheap truthful classification for combos the last build did not attempt. */
export function classifyUnattempted(
  franchiseId: string,
  eraId: string,
  manifest: Manifest,
): PoolBuildFailure {
  const era = manifest.eras.find((e) => e.eraId === eraId);
  const eraHasLineage =
    era === undefined
      ? false
      : LINEAGE_SEGMENTS.some(
          (segment) =>
            segment.modernFranchiseId === franchiseId &&
            segment.validFromSeasonKey <= era.toSeasonKey &&
            (segment.validThroughSeasonKey === undefined ||
              segment.validThroughSeasonKey >= era.fromSeasonKey),
        );
  if (!eraHasLineage) {
    const first = firstSupportedSeason(franchiseId);
    return failure(
      'no-franchise-history',
      `no NBA history for ${franchiseId} between ${era?.fromSeasonKey ?? '?'} and ${era?.toSeasonKey ?? '?'}`,
      first ?? undefined,
    );
  }
  const hasSeasons = listSeasonKeys().some(
    (season) => era !== undefined && era.fromSeasonKey <= season && season <= era.toSeasonKey,
  );
  if (!hasSeasons) {
    return failure('source-incomplete', `no packaged seasons for era ${eraId}`);
  }
  return failure('insufficient-players', 'not attempted in the last coverage build');
}

export function updateManifest(
  entries: Array<{ franchiseId: string; eraId: string; url: string; contentHash: string }>,
): void {
  const manifest = loadManifest();
  manifest.dataVersion = DATA_VERSION;
  const existing = new Map(
    manifest.pools.map((entry) => [`${entry.franchiseId}/${entry.eraId}`, entry]),
  );
  for (const entry of entries) {
    existing.set(`${entry.franchiseId}/${entry.eraId}`, entry);
  }
  manifest.pools = [...existing.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => entry);
  writeJsonRetry(manifestPath(), manifest);
  console.log(
    `  [OK] manifest updated: ${String(manifest.pools.length)} pools, dataVersion ${DATA_VERSION}`,
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
/** Season dirs with actual packaged data (roster or stints present). */
function listSeasonKeys(): string[] {
  return readdirSync(NBA_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(
      (name) =>
        fileExists(join(NBA_ROOT, name, 'roster.json')) ||
        fileExists(join(NBA_ROOT, name, 'stints.json')),
    )
    .sort();
}

/** Python list repr for the unknown-label warning (['XYZ', ...]). */
function formatList(values: readonly string[]): string {
  return `[${values.map((value) => `'${value}'`).join(', ')}]`;
}

export type { Confidence };
