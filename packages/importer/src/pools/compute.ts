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
import { basename, join } from 'node:path';
import { parsePool } from '@hoop-rush/data-contracts';
import {
  ARTIFACT_SCHEMA_VERSION,
  DERIVATION_METHOD_VERSION,
  LINEAGE_RULE_VERSION,
  POSITION_NORMALIZATION_VERSION,
  RATINGS_VERSION,
  SELECTION_SCORE_VERSION,
  SOURCE_VERSION,
  type Confidence,
  type CoverageSummary,
  type HistoricalValueProvenance,
  type UnavailabilityReason,
} from '@hoop-rush/data-contracts';
import { NBA_ROOT, PUBLIC_DATA, RAW_CACHE } from '../config.js';
import {
  fileExists,
  safeFloat,
  safeInt,
  sha256File,
  writeJson,
  writeJsonRetry,
  clamp,
  clampUnitInterval,
} from '../json.js';
import { normalizePositionLabels } from './positions.js';
import { canonicalPlayerName } from '../identity.js';
import {
  LINEAGE_SEGMENTS,
  MODERN_SLOTS,
  firstSupportedSeason,
  resolveHistoricalIdentity,
  type LineageSegment,
} from '../lineage.js';

/**
 * Python's json.loads accepts the bare NaN token that the fetch layer's
 * json.dumps writes (e.g. "college": NaN); JSON.parse does not. Pools never
 * consume the NaN fields, so the token is read as null - the same value the
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

export const SCHEMA_VERSION = ARTIFACT_SCHEMA_VERSION;
export const MIN_TEAM_GAMES = 40;
export const DATA_VERSION = 'm3.5';
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
  // added in a later snapshot.
  const cachePath = join(RAW_CACHE, 'career-position-labels-v4.json');
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

/** Memoized per run so availability scans read each season's JSON once. */
const seasonDataCache = new Map<string, SeasonData>();

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

/** @internal Clears the per-run season cache (determinism tests). */
export function clearSeasonDataCache(): void {
  seasonDataCache.clear();
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

export function selectionScore(
  summary: SummaryRatingsRaw,
  usageRate: number | null,
  teamMinutes: number,
  teamGames: number,
): number {
  /* selection-v2: rating blend plus modest season-availability adjustment. */
  const usage = Math.min(Math.max(usageRate || 0, 0), 40.0);
  const mpg = Math.min(teamMinutes / Math.max(1, teamGames), 48.0);
  const availability = 0.96 + 0.04 * Math.min(Math.max(teamGames, 0) / 82, 1);
  // Overall is the production-aware total-contribution estimate. Give it
  // more weight than either component so pass-first and pre-three-point
  // creators are not buried, while retaining offense/defense as balance
  // signals for season selection.
  const raw =
    0.6 * Number(summary.overallRating) +
    0.25 * Number(summary.offenseRating) +
    0.15 * Number(summary.defenseRating) +
    0.05 * usage +
    0.02 * mpg;
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
  historicalTeamIdentity: {
    teamId: string;
    displayName: string;
    city: string;
    abbreviation: string | null;
    seasonKey: string;
    lineageRuleVersion: string;
  };
  summaryRatings: { overallRating: number; offenseRating: number; defenseRating: number };
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
  const guards = players.filter((p) => p.positions.canonical.includes('G'));
  const forwards = players.filter((p) => p.positions.canonical.includes('F'));
  const centers = players.filter((p) => p.positions.canonical.includes('C'));
  if (guards.length < 2 || forwards.length < 2 || centers.length < 1) return false;
  // Any guard can take a G slot, any forward an F slot; C must be a center.
  return true;
}

/**
 * Builds the coverage summary: observed/derived/estimated families, missing
 * categories, and the low-confidence share under the versioned policy.
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
  const missingCategories = new Set<string>();

  for (const player of players) {
    for (const [field, provenance] of Object.entries(player.provenance)) {
      if (provenance.kind === 'observed') observedFamilies.add(fieldFamily(field));
      else if (provenance.kind === 'derived') derivedFamilies.add(fieldFamily(field));
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
  const careerLabels = loadCareerPositionLabels();

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
    const ownLabels = new Set([str(player.position)]);
    const career = careerLabels.get(pid);
    const labels = career !== undefined && career.size > 0 ? career : ownLabels;
    const { canonical, sourceLabels, unknownLabels } = normalizePositionLabels(labels);
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
    for (const key of requiredRatingKeys) {
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
      detailedRatings,
      tendencies: tendenciesOut,
      anchors: anchorsOut,
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

export function run(targets: Array<[string, string]> | null = null, withAssets = true): void {
  if (targets === null) {
    targets = [['lakers', '1990s']];
  }
  const manifest = loadManifest();
  const bbrefIds = loadBbrefIds();
  const entries: Array<{ franchiseId: string; eraId: string; url: string; contentHash: string }> =
    [];
  const coverage: CoverageReportEntry[] = [];
  for (const [franchiseId, eraId] of targets) {
    const pool = computePool(franchiseId, eraId, manifest, bbrefIds, withAssets);
    if ('reason' in pool) {
      console.log(`  [UNAVAILABLE] ${franchiseId} ${eraId}: ${pool.reason} (${pool.detail})`);
      coverage.push({
        franchiseId,
        eraId,
        status: 'unavailable',
        reason: pool.reason,
        ...(pool.detail !== undefined ? { detail: pool.detail } : {}),
        ...(pool.firstSupportedSeason !== undefined
          ? { firstSupportedSeason: pool.firstSupportedSeason }
          : {}),
      });
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
    coverage.push({
      franchiseId,
      eraId,
      status: 'available',
      playerCount: pool.players.length,
      coverageSummary: pool.coverageSummary,
    });
  }
  updateManifest(entries);
  recordCoverageReport(coverage);
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
  return (readJsonLoose(coverageReportPath()) as CoverageReportEntry[]) ?? [];
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

/** Written into the manifest availability matrix (runtime-validated by CLI). */
export function availabilityEntryFor(
  franchiseId: string,
  eraId: string,
  manifest: Manifest,
  poolFile: Pool | null,
): Record<string, unknown> {
  if (poolFile !== null) {
    return {
      franchiseId,
      eraId,
      status: 'available',
      url: `pools/${franchiseId}-${eraId}.json`,
      contentHash: sha256File(join(poolDir(), `${franchiseId}-${eraId}.json`)),
      playerCount: poolFile.players.length,
      coverageSummary: poolFile.coverageSummary,
    };
  }
  const computed = computePool(franchiseId, eraId, manifest, undefined, false);
  if ('reason' in computed) {
    return {
      franchiseId,
      eraId,
      status: 'unavailable',
      reason: computed.reason,
      ...(computed.detail !== undefined ? { detail: computed.detail } : {}),
      ...(computed.firstSupportedSeason !== undefined
        ? { firstSupportedSeason: computed.firstSupportedSeason }
        : {}),
    };
  }
  return {
    franchiseId,
    eraId,
    status: 'unavailable',
    reason: 'source-incomplete',
    detail: 'no packaged pool asset',
  };
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
