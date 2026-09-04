import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
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
  franchiseEraPoolSchema,
  coverageSummarySchema,
  playerSeasonStatsSchema,
  provenanceMapSchema,
  ratingProfileSchema,
  reconstructedThreePointProfileSchema,
  simulationAnchorsSchema,
  simulationRatingsSchema,
  simulationTendenciesSchema,
  summaryRatingsSchema,
  unavailabilityReasonSchema,
  type Confidence,
  type CoverageSummary,
  type FranchiseEraPool,
  type HistoricalValueProvenance,
  type PeakPlayerSeason,
  type PlayerSeasonStats,
  type Position,
  type ProvenanceMap,
  type RatingProfile,
  type SimulationAnchors,
  type SimulationRatings,
  type SimulationTendencies,
  type SummaryRatings,
  type UnavailabilityReason,
} from '@hoop-rush/data-contracts';
import { playableSlotGroups } from '@hoop-rush/data-contracts';
import { NBA_ROOT, PUBLIC_DATA, RAW_CACHE } from '../config.ts';
import { refreshPlayersIndexInManifest } from '../manifest/index.ts';
import {
  clamp,
  clampUnitInterval,
  fileExists,
  readJsonLoose,
  safeFloat,
  safeInt,
  sha256FileWithRetry,
  writeJson,
  writeJsonRetry,
} from '../json.ts';
import { defaultWorkerCount, runWorker } from '../shared/worker-pool.ts';
import { sortedJsonFiles } from '../shared/manifest.ts';
import { buildPlayerPositions } from './positions.ts';
import { positionOverrideFor } from '../positions/overrides.ts';
import { canonicalPlayerName } from '../identity.ts';
import { derivePlayerRecord } from '../ratings/v2.ts';
import { getEra } from '../ratings/era.ts';
import { loadRatingsModelArtifact } from '../ratings/artifact.ts';
export { POSITION_LABEL_MAP, buildPlayerPositions, normalizePositionLabels } from './positions.ts';
import {
  LINEAGE_SEGMENTS,
  MODERN_SLOTS,
  firstSupportedSeason,
  resolveHistoricalIdentity,
} from '../lineage.ts';
function str(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}
const seasonStatsInputSchema = z.looseObject({
  playerExternalId: z.unknown().optional(),
  gamesPlayed: z.unknown().optional(),
  minutes: z.unknown().optional(),
  points: z.unknown().optional(),
  rebounds: z.unknown().optional(),
  offensiveRebounds: z.unknown().optional(),
  defensiveRebounds: z.unknown().optional(),
  assists: z.unknown().optional(),
  steals: z.unknown().optional(),
  blocks: z.unknown().optional(),
  turnovers: z.unknown().optional(),
  fgm: z.unknown().optional(),
  fga: z.unknown().optional(),
  tpm: z.unknown().optional(),
  tpa: z.unknown().optional(),
  ftm: z.unknown().optional(),
  fta: z.unknown().optional(),
  per: z.unknown().optional(),
  boxPlusMinus: z.unknown().optional(),
  usageRate: z.unknown().optional(),
  tsPct: z.unknown().optional(),
  efgPct: z.unknown().optional(),
});
type SeasonStatsInput = z.infer<typeof seasonStatsInputSchema>;
const stintInputSchema = z.looseObject({
  playerExternalId: z.unknown().optional(),
  teamExternalId: z.unknown().optional(),
  gamesPlayed: z.unknown().optional(),
  minutes: z.unknown().optional(),
});
type StintInput = z.infer<typeof stintInputSchema>;
const rosterInputSchema = z.looseObject({
  externalId: z.unknown().optional(),
  playerExternalId: z.unknown().optional(),
  firstName: z.unknown().optional(),
  lastName: z.unknown().optional(),
  position: z.unknown().optional(),
  secondaryPositions: z.unknown().optional(),
  heightInches: z.unknown().optional(),
  weightLbs: z.unknown().optional(),
  teamExternalId: z.unknown().optional(),
  summaryRatings: z.unknown().optional(),
  ratings: z.unknown().optional(),
  tendencies: z.unknown().optional(),
  anchors: z.unknown().optional(),
  provenance: z.unknown().optional(),
  ratingProfile: z.unknown().optional(),
  selectionScore: z.unknown().optional(),
});
type RosterInput = z.infer<typeof rosterInputSchema>;
const rawAnchorsSchema = z.looseObject({
  fieldGoalPct: z.unknown().optional(),
  threePointPct: z.unknown().optional(),
  freeThrowPct: z.unknown().optional(),
  threePointAttemptRate: z.unknown().optional(),
  freeThrowAttemptRate: z.unknown().optional(),
});
type RawAnchors = z.infer<typeof rawAnchorsSchema>;
const poolManifestEraSchema = z.looseObject({
  eraId: z.string(),
  label: z.string(),
  fromSeasonKey: z.string(),
  toSeasonKey: z.string(),
});
const poolManifestEntrySchema = z.looseObject({
  franchiseId: z.string(),
  eraId: z.string(),
  url: z.string(),
  contentHash: z.string(),
});
const poolManifestSchema = z.looseObject({
  schemaVersion: z.number(),
  dataVersion: z.string(),
  eras: z.array(poolManifestEraSchema),
  pools: z.array(poolManifestEntrySchema),
});
export function poolDir(): string {
  return join(PUBLIC_DATA, 'pools');
}
export function manifestPath(): string {
  return join(PUBLIC_DATA, 'manifest.json');
}
export const SCHEMA_VERSION = POOL_SCHEMA_VERSION;
export const MIN_TEAM_GAMES = 40;
export const DATA_VERSION = 'm10-ratings-v3.8';
export const CONFIDENCE_POLICY_VERSION = 'policy-v1';
export const MAX_LOW_CONFIDENCE_SHARE = 0.4;
export {
  POSITION_NORMALIZATION_VERSION,
  RATINGS_VERSION,
  SELECTION_SCORE_VERSION,
} from '@hoop-rush/data-contracts';
export function loadCareerPositionLabels(): Map<string, Set<string>> {
  const cachePath = join(RAW_CACHE, 'career-position-labels-v5.json');
  if (fileExists(cachePath)) {
    const raw = readJsonLoose(cachePath) as unknown;
    const parsed = careerLabelsSchema.safeParse(raw);
    if (parsed.success) {
      return new Map(Object.entries(parsed.data).map(([pid, labels]) => [pid, new Set(labels)]));
    }
    return new Map();
  }
  const labelsByPlayer = new Map<string, Set<string>>();
  for (const seasonDir of listSeasonKeys()) {
    const rosterPath = join(NBA_ROOT, seasonDir, 'roster.json');
    if (!fileExists(rosterPath)) {
      continue;
    }
    const rosterRaw = readJsonLoose(rosterPath) as unknown;
    const rosterParsed = z.array(careerRosterRowSchema).safeParse(rosterRaw);
    for (const player of rosterParsed.success ? rosterParsed.data : []) {
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
export type EraEntry = z.infer<typeof poolManifestEraSchema>;
export type PoolIndexEntry = z.infer<typeof poolManifestEntrySchema>;
export type Manifest = z.infer<typeof poolManifestSchema>;
const careerLabelsSchema = z.record(z.string(), z.array(z.string()));
const bbrefIdsSchema = z.record(z.string(), z.string());
export function loadManifest(): Manifest {
  const raw = readJsonLoose(manifestPath()) as unknown;
  const parsed = poolManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid manifest: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return parsed.data;
}
export type SeasonData = {
  rosterByExtId: Record<string, RosterInput>;
  stintsByTeam: Record<string, StintInput[]>;
  statsByPlayer: Record<string, SeasonStatsInput>;
};
const seasonDataCache = new Map<string, SeasonData>();
let fallbackRosterCache: Map<string, RosterInput> | null = null;
let ratingsModelArtifactCache: ReturnType<typeof loadRatingsModelArtifact> | null = null;
function currentRatingsModelArtifact(): ReturnType<typeof loadRatingsModelArtifact> {
  ratingsModelArtifactCache ??= loadRatingsModelArtifact();
  return ratingsModelArtifactCache;
}
const fallbackPoolPlayerSchema = z.looseObject({
  playerExternalId: z.unknown().optional(),
  firstName: z.unknown().optional(),
  lastName: z.unknown().optional(),
  positions: z.unknown().optional(),
  heightInches: z.unknown().optional(),
  weightLbs: z.unknown().optional(),
  detailedRatings: z.unknown().optional(),
  tendencies: z.unknown().optional(),
  summaryRatings: z.unknown().optional(),
  anchors: z.unknown().optional(),
  provenance: z.unknown().optional(),
  selectionScore: z.unknown().optional(),
});
const fallbackPoolFileSchema = z.looseObject({
  players: z.array(fallbackPoolPlayerSchema).optional(),
});
const careerRosterRowSchema = z.looseObject({
  externalId: z.unknown().optional(),
  position: z.unknown().optional(),
  secondaryPositions: z.unknown().optional(),
});
function refreshedFallbackPlayer(
  player: RosterInput,
  season: string,
  stats: SeasonStatsInput,
  playerExternalId: string,
): RosterInput {
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
export function loadSeasonData(season: string): SeasonData {
  const cached = seasonDataCache.get(season);
  if (cached !== undefined) return cached;
  const seasonDir = join(NBA_ROOT, season);
  const rosterByExtId: Record<string, RosterInput> = {};
  const rosterPath = join(seasonDir, 'roster.json');
  if (fileExists(rosterPath)) {
    const rosterRaw = readJsonLoose(rosterPath) as unknown;
    const rosterParsed = z.array(rosterInputSchema).safeParse(rosterRaw);
    for (const player of rosterParsed.success ? rosterParsed.data : []) {
      rosterByExtId[str(player.externalId)] = player;
    }
  }
  const stintsByTeam: Record<string, StintInput[]> = {};
  const stintsPath = join(seasonDir, 'stints.json');
  if (fileExists(stintsPath)) {
    const stintsRaw = readJsonLoose(stintsPath) as unknown;
    const stintsParsed = z.array(stintInputSchema).safeParse(stintsRaw);
    for (const stint of stintsParsed.success ? stintsParsed.data : []) {
      const teamId = str(stint.teamExternalId);
      let stints = stintsByTeam[teamId];
      if (!stints) {
        stints = [];
        stintsByTeam[teamId] = stints;
      }
      stints.push(stint);
    }
  }
  const statsByPlayer: Record<string, SeasonStatsInput> = {};
  const statsPath = join(seasonDir, 'season-stats.json');
  if (fileExists(statsPath)) {
    const statsRaw = readJsonLoose(statsPath) as unknown;
    const statsParsed = z.array(seasonStatsInputSchema).safeParse(statsRaw);
    for (const row of statsParsed.success ? statsParsed.data : []) {
      statsByPlayer[str(row.playerExternalId)] = row;
    }
  }
  const data: SeasonData = { rosterByExtId, stintsByTeam, statsByPlayer };
  seasonDataCache.set(season, data);
  return data;
}
function loadFallbackRosterPlayers(): Map<string, RosterInput> {
  if (fallbackRosterCache !== null) return fallbackRosterCache;
  const byPlayer = new Map<string, RosterInput>();
  for (const file of sortedJsonFiles(poolDir())) {
    try {
      const raw = readJsonLoose(join(poolDir(), file)) as unknown;
      const parsed = fallbackPoolFileSchema.safeParse(raw);
      if (!parsed.success || !Array.isArray(parsed.data.players)) continue;
      for (const value of parsed.data.players) {
        const playerExternalId = str(value.playerExternalId);
        if (!playerExternalId) continue;
        const positionsParsed = z
          .looseObject({
            primary: z.unknown().optional(),
            secondary: z.unknown().optional(),
          })
          .safeParse(value.positions);
        const positionsRaw = positionsParsed.success ? positionsParsed.data : undefined;
        const primary = typeof positionsRaw?.primary === 'string' ? positionsRaw.primary : 'F';
        const secondaryPositions = Array.isArray(positionsRaw?.secondary)
          ? positionsRaw.secondary.filter(
              (secondary): secondary is string => typeof secondary === 'string' && secondary !== '',
            )
          : [];
        const candidate: RosterInput = {
          externalId: playerExternalId,
          firstName: value.firstName,
          lastName: value.lastName,
          position: primary,
          secondaryPositions,
          heightInches: value.heightInches,
          weightLbs: value.weightLbs,
          ratings: value.detailedRatings,
          tendencies: value.tendencies,
          summaryRatings: value.summaryRatings,
          anchors: value.anchors,
          provenance: value.provenance,
          selectionScore: value.selectionScore,
        };
        const previous = byPlayer.get(playerExternalId);
        if (
          previous === undefined ||
          Number(value.selectionScore ?? 0) > Number(previous.selectionScore ?? 0)
        ) {
          byPlayer.set(playerExternalId, candidate);
        }
      }
    } catch {}
  }
  fallbackRosterCache = byPlayer;
  return byPlayer;
}
export function defaultPoolWorkers(): number {
  return defaultWorkerCount(7);
}
export interface PoolWorkerResult {
  results: TargetBuildResult[];
}
export interface PoolWorkerData {
  targets: Array<[string, string]>;
  manifest: Manifest;
  bbrefIds: Record<string, string>;
  careerLabels: Array<[string, string[]]> | null;
  withAssets: boolean;
}
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
function runPoolChunk(
  chunk: Array<[string, string]>,
  manifest: Manifest,
  bbrefIds: Record<string, string>,
  careerLabels: Map<string, Set<string>>,
  withAssets: boolean,
): Promise<PoolWorkerResult> {
  return runWorker<PoolWorkerResult>(new URL('./pool-worker.ts', import.meta.url), {
    targets: chunk,
    manifest,
    bbrefIds,
    careerLabels: [...careerLabels.entries()].map(
      ([pid, labels]) => [pid, [...labels]] as [string, string[]],
    ),
    withAssets,
  } satisfies PoolWorkerData);
}
function numFrom(value: unknown, fallback = 0): number {
  return safeFloat(value, fallback);
}
function nullableFrom(value: unknown): number | null {
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
export type PoolStats = PlayerSeasonStats;
export function buildStats(seasonStats: unknown): PoolStats {
  const parsed = seasonStatsInputSchema.safeParse(seasonStats);
  const input: SeasonStatsInput = parsed.success ? parsed.data : {};
  const truncNullable = (value: unknown): number | null => {
    const n = nullableFrom(value);
    return n === null ? null : Math.trunc(n);
  };
  const fieldGoalsAttempted = Math.trunc(numFrom(input.fga));
  const fieldGoalsMade = Math.min(Math.trunc(numFrom(input.fgm)), fieldGoalsAttempted);
  const freeThrowsAttempted = Math.trunc(numFrom(input.fta));
  const freeThrowsMade = Math.min(Math.trunc(numFrom(input.ftm)), freeThrowsAttempted);
  const threesAttempted = truncNullable(input.tpa);
  const threesMadeRaw = truncNullable(input.tpm);
  const threesMade =
    threesAttempted !== null && threesMadeRaw !== null
      ? Math.min(threesMadeRaw, threesAttempted)
      : threesMadeRaw;
  const output = {
    gamesPlayed: Math.trunc(numFrom(input.gamesPlayed)),
    minutes: Math.trunc(numFrom(input.minutes)),
    points: Math.trunc(numFrom(input.points)),
    rebounds: Math.trunc(numFrom(input.rebounds)),
    offensiveRebounds: truncNullable(input.offensiveRebounds),
    defensiveRebounds: truncNullable(input.defensiveRebounds),
    assists: Math.trunc(numFrom(input.assists)),
    steals: truncNullable(input.steals),
    blocks: truncNullable(input.blocks),
    turnovers: truncNullable(input.turnovers),
    fieldGoalsMade,
    fieldGoalsAttempted,
    threesMade,
    threesAttempted,
    freeThrowsMade,
    freeThrowsAttempted,
    per: nullableFrom(input.per),
    boxPlusMinus: nullableFrom(input.boxPlusMinus),
    usageRate: nullableFrom(input.usageRate),
    tsPct: clampUnitInterval(nullableFrom(input.tsPct)),
    efgPct: clampUnitInterval(nullableFrom(input.efgPct)),
  };
  return playerSeasonStatsSchema.parse(output);
}
const ANCHOR_UNIT_FIELDS = [
  'fieldGoalPct',
  'threePointPct',
  'freeThrowPct',
  'threePointAttemptRate',
  'freeThrowAttemptRate',
] as const;
export function sanitizeAnchors<T extends RawAnchors>(anchors: T): T {
  const out = { ...anchors };
  for (const field of ANCHOR_UNIT_FIELDS) {
    const value = out[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[field] = clamp(value, 0, 1) as T[typeof field];
    }
  }
  simulationAnchorsSchema.partial().safeParse(out);
  return out;
}
export type SummaryRatingsRaw = Partial<
  Pick<SummaryRatings, 'overallRating' | 'offenseRating' | 'defenseRating'>
>;
const overallScoreProfileSchema = z.looseObject({
  rawOverallScore: z.unknown().optional(),
  canonicalOverall: z.unknown().optional(),
});
type OverallScoreInput = {
  ratingProfile?: unknown;
};
export function rawOverallScoreFor(
  player: OverallScoreInput,
  summary: SummaryRatingsRaw | undefined,
): number {
  const profileParsed = overallScoreProfileSchema.safeParse(player.ratingProfile);
  const profile = profileParsed.success ? profileParsed.data : undefined;
  const raw = profile?.rawOverallScore;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  const canonical = profile?.canonicalOverall;
  if (typeof canonical === 'number' && Number.isFinite(canonical)) {
    return canonical;
  }
  return safeFloat(summary?.overallRating);
}
export function selectionScore(
  rawOverallScore: number,
  offenseRating: number,
  defenseRating: number,
  _usageRate: number | null,
  teamMinutes: number,
  teamGames: number,
): number {
  const mpg = Math.min(teamMinutes / Math.max(1, teamGames), 48.0);
  const availability = 0.96 + 0.04 * Math.min(Math.max(teamGames, 0) / 82, 1);
  const raw = 0.6 * rawOverallScore + 0.25 * offenseRating + 0.15 * defenseRating + 0.02 * mpg;
  return Math.round(raw * availability * 1000) / 1000;
}
export type Candidate = {
  season: string;
  player: RosterInput;
  stint: StintInput;
  stats: SeasonStatsInput;
};
export function candidateKey(candidate: Candidate): readonly number[] {
  const stint = candidate.stint;
  const summaryParsed = summaryRatingsSchema.safeParse(candidate.player.summaryRatings);
  const summary: SummaryRatingsRaw | undefined = summaryParsed.success
    ? summaryParsed.data
    : undefined;
  const seasonStart = parseInt(candidate.season.split('-')[0] ?? '', 10);
  const minutes = Math.trunc(numFrom(stint.minutes));
  const games = Math.trunc(numFrom(stint.gamesPlayed));
  return [
    selectionScore(
      rawOverallScoreFor(candidate.player, summary),
      safeFloat(summary?.offenseRating),
      safeFloat(summary?.defenseRating),
      nullableFrom(candidate.stats.usageRate),
      minutes,
      games,
    ),
    minutes,
    games,
    -seasonStart,
  ];
}
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
export type PoolOverallRow = {
  playerId: string;
  franchiseId: string;
  seasonKey: string;
  summaryRatings: SummaryRatings;
  ratingProfile?: {
    rawOverallScore?: number | null;
    canonicalOverall?: number;
    overallPercentile?: number;
    overallCohortVersion?: string;
    schemaVersion?: number;
    modelVersion?: string;
  } | null;
  eraId?: string;
};
export interface PoolOverallDiagnostics {
  totalRowCount: number;
  rowsWithoutRawOverall: number;
}
export function overallBandForPercentile(p: number): number {
  let value: number;
  if (p < 0.005) {
    value = 99 - (p / 0.005) * 4;
  } else if (p < 0.05) {
    value = 94 - ((p - 0.005) / 0.045) * 4;
  } else if (p < 0.19) {
    value = 89 - ((p - 0.05) / 0.14) * 4;
  } else if (p < 0.8) {
    value = 84 - ((p - 0.19) / 0.61) * 12;
  } else {
    value = 71 - ((p - 0.8) / 0.2) * 31;
  }
  return clamp(Math.round(value), 40, 99);
}
function hasRawOverallScore(row: PoolOverallRow): boolean {
  const raw = row.ratingProfile?.rawOverallScore;
  return typeof raw === 'number' && Number.isFinite(raw);
}
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
  const eraCounts = new Map<string, number>();
  for (const row of rows) {
    const eraId = row.eraId ?? 'unknown';
    eraCounts.set(eraId, (eraCounts.get(eraId) ?? 0) + 1);
  }
  const eraGroups = new Map<string, PoolOverallRow[]>();
  for (const row of ranked) {
    const eraId = row.eraId ?? 'unknown';
    let group = eraGroups.get(eraId);
    if (!group) {
      group = [];
      eraGroups.set(eraId, group);
    }
    group.push(row);
  }
  const eraIndexMap = new Map<PoolOverallRow, number>();
  for (const [, group] of eraGroups) {
    group.forEach((row, idx) => eraIndexMap.set(row, idx));
  }
  ranked.forEach((row, globalIndex) => {
    const pGlobal = globalIndex / totalRowCount;
    const eraId = row.eraId ?? 'unknown';
    const eraTotal = eraCounts.get(eraId) ?? totalRowCount;
    const eraIdx = eraIndexMap.get(row) ?? globalIndex;
    const pEra = eraTotal > 0 ? eraIdx / eraTotal : pGlobal;
    const pBlended = 0.65 * pGlobal + 0.35 * pEra;
    row.summaryRatings.overallRating = overallBandForPercentile(pBlended);
    if (hasRawOverallScore(row) && row.ratingProfile != null) {
      row.ratingProfile.overallPercentile =
        Math.round(((globalIndex + 1) / totalRowCount) * 10000) / 10000;
      row.ratingProfile.overallCohortVersion = COHORT_NORMALIZATION_VERSION;
    }
  });
  return { totalRowCount, rowsWithoutRawOverall };
}
export function loadBbrefIds(): Record<string, string> {
  const path = join(RAW_CACHE, 'bbref_ids.json');
  if (!fileExists(path)) {
    console.log('  [WARN] bbref_ids.json missing; run fetch_bbref_ids or run_all (no altIds)');
    return {};
  }
  const raw = readJsonLoose(path) as unknown;
  const parsed = bbrefIdsSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}
export function loadExistingAssetAltIds(
  franchiseId: string,
  eraId: string,
): Map<string, NonNullable<PeakPlayerSeason['altIds']>> {
  const path = join(poolDir(), `${franchiseId}-${eraId}.json`);
  if (!fileExists(path)) {
    return new Map();
  }
  try {
    const raw = readJsonLoose(path) as unknown;
    const previousPoolPlayerSchema = z.looseObject({
      playerExternalId: z.string(),
      altIds: z.unknown().optional(),
    });
    const previousPoolFileSchema = z.looseObject({
      players: z.array(previousPoolPlayerSchema).optional(),
    });
    const previousAltIdsSchema = z.looseObject({
      nbaHeadshotAvailable: z.boolean().optional(),
      photoUrl: z.union([z.string(), z.null()]).optional(),
    });
    const parsed = previousPoolFileSchema.safeParse(raw);
    if (!parsed.success || !Array.isArray(parsed.data.players)) return new Map();
    const byExternalId = new Map<string, NonNullable<PeakPlayerSeason['altIds']>>();
    for (const player of parsed.data.players) {
      const altIdsParsed = previousAltIdsSchema.safeParse(player.altIds);
      if (!altIdsParsed.success) continue;
      const data = altIdsParsed.data;
      if (data.nbaHeadshotAvailable === undefined && data.photoUrl === undefined) continue;
      const out: NonNullable<PeakPlayerSeason['altIds']> = {};
      if (data.nbaHeadshotAvailable !== undefined) {
        out.nbaHeadshotAvailable = data.nbaHeadshotAvailable;
      }
      if (data.photoUrl !== undefined) {
        out.photoUrl = data.photoUrl;
      }
      byExternalId.set(player.playerExternalId, out);
    }
    return byExternalId;
  } catch (error) {
    console.log(
      `  [WARN] cannot read previous pool ${basename(path)}: ${(error as Error).message}`,
    );
    return new Map();
  }
}
export type PoolPlayer = {
  schemaVersion: number;
  playerId: string;
  franchiseId: string;
  eraId: string;
  seasonKey: string;
  firstName: string;
  lastName: string;
  displayName: string;
  playerExternalId: string;
  altIds: Pick<
    NonNullable<PeakPlayerSeason['altIds']>,
    'bbref' | 'nbaHeadshotAvailable' | 'photoUrl'
  > | null;
  positions: Pick<
    PeakPlayerSeason['positions'],
    'primary' | 'secondary' | 'playable' | 'sourceLabels' | 'normalizationVersion'
  >;
  heightInches: PeakPlayerSeason['heightInches'];
  weightLbs: PeakPlayerSeason['weightLbs'];
  eligibility: Pick<
    PeakPlayerSeason['eligibility'],
    'minimumTeamGames' | 'teamGames' | 'teamMinutes'
  >;
  selectionScore: number;
  selectionScoreVersion: string;
  stats: PlayerSeasonStats;
  historicalTeamIdentity: {
    teamId: string;
    displayName: string;
    city: string;
    abbreviation: string | null;
    seasonKey: string;
    lineageRuleVersion: string;
  };
  summaryRatings: SummaryRatings;
  ratingProfile?: RatingProfile;
  detailedRatings: SimulationRatings;
  tendencies: SimulationTendencies;
  anchors: SimulationAnchors;
  provenance: ProvenanceMap;
  source: Pick<
    PeakPlayerSeason['source'],
    | 'dataVersion'
    | 'ratingsVersion'
    | 'selectionScoreVersion'
    | 'sourceVersion'
    | 'derivationMethodVersion'
    | 'lineageRuleVersion'
  >;
  reconstructedThreePoint?: PeakPlayerSeason['reconstructedThreePoint'];
};
export type Pool = {
  schemaVersion: number;
  dataVersion: string;
  franchiseId: string;
  eraId: string;
  eligibility: {
    minimumTeamGames: number;
  };
  coverageSummary: CoverageSummary;
  players: PoolPlayer[];
};
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
export function coverageBandForSeasons(
  seasons: readonly string[],
): CoverageSummary['coverageBand'] {
  const earliest = seasons.reduce((a, b) => (a < b ? a : b));
  if (earliest >= '1996-97') return 'advanced-supported';
  if (earliest >= '1979-80') return 'complete-box-derived';
  if (earliest >= '1973-74') return 'late-historical';
  return 'reconstructed';
}
export function legalLineupCovered(players: readonly PoolPlayer[]): boolean {
  const slotGroupsOf = (player: PoolPlayer): readonly string[] =>
    playableSlotGroups(player.positions.playable as Position[]);
  const guards = players.filter((p) => slotGroupsOf(p).includes('G'));
  const forwards = players.filter((p) => slotGroupsOf(p).includes('F'));
  const centers = players.filter((p) => slotGroupsOf(p).includes('C'));
  if (guards.length < 2 || forwards.length < 2 || centers.length < 1) return false;
  return true;
}
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
      const games = Math.trunc(numFrom(stint.gamesPlayed));
      if (games < MIN_TEAM_GAMES) {
        continue;
      }
      const pid = str(stint.playerExternalId);
      const sourcePlayer = rosterByExtId[pid] ?? loadFallbackRosterPlayers().get(pid);
      if (sourcePlayer === undefined) {
        continue;
      }
      const stats = statsByPlayer[pid];
      if (stats === undefined || Math.trunc(numFrom(stats.gamesPlayed)) === 0) {
        continue;
      }
      const player =
        rosterByExtId[pid] !== undefined
          ? sourcePlayer
          : refreshedFallbackPlayer(sourcePlayer, season, stats, pid);
      const summaryParsed = summaryRatingsSchema.safeParse(player.summaryRatings);
      const summary = summaryParsed.success ? summaryParsed.data : undefined;
      if (summary === null || summary === undefined) {
        console.log(`  ! ${pid} missing summaryRatings in ${season}; re-run compute_ratings`);
        continue;
      }
      const ratingsRaw = player.ratings;
      const tendenciesRaw = player.tendencies;
      const anchorsRaw = player.anchors;
      if (ratingsRaw === undefined || tendenciesRaw === undefined || anchorsRaw === undefined) {
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
  if (!keepSeasonCache) {
    seasonDataCache.clear();
  }
  if (missingStints.length > 0) {
    console.log(`  [WARN] no stints for ${franchiseId} in: ${missingStints.join(', ')}`);
  }
  const playersOut: PoolPlayer[] = [];
  const identityFailures: string[] = [];
  for (const pid of [...eligible.keys()].sort()) {
    const failureStart = identityFailures.length;
    const candidates = eligible.get(pid);
    if (!candidates) {
      continue;
    }
    const best = maxBy(candidates, candidateKey);
    const player = best.player;
    const stint = best.stint;
    const stats = best.stats;
    const summaryParsed = summaryRatingsSchema.safeParse(player.summaryRatings);
    const summary: SummaryRatingsRaw | undefined = summaryParsed.success
      ? summaryParsed.data
      : undefined;
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
    const teamGames = Math.trunc(numFrom(stint.gamesPlayed));
    const teamMinutes = Math.trunc(numFrom(stint.minutes));
    const ratingsPartial = simulationRatingsSchema.partial().safeParse(player.ratings ?? {});
    const ratingsRaw = ratingsPartial.success ? ratingsPartial.data : {};
    const tendenciesPartial = simulationTendenciesSchema
      .partial()
      .safeParse(player.tendencies ?? {});
    const tendenciesRaw = tendenciesPartial.success ? tendenciesPartial.data : {};
    const detailedRatingsPartial: Partial<SimulationRatings> = {};
    for (const key of REQUIRED_RATING_KEYS) {
      const value = ratingsRaw[key];
      if (typeof value === 'number') {
        detailedRatingsPartial[key] = Math.trunc(value);
      }
    }
    const requiredTendencyKeys: Array<keyof SimulationTendencies> = [
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
      if (!(key in detailedRatingsPartial)) {
        identityFailures.push(`${pid} missing rating ${key} in ${best.season}`);
      }
    }
    const tendenciesOutPartial: Partial<SimulationTendencies> = {};
    for (const key of requiredTendencyKeys) {
      const value = tendenciesRaw[key];
      const n = Number(value);
      if (typeof value === 'undefined' || Number.isNaN(n)) {
        identityFailures.push(`${pid} missing tendency ${key} in ${best.season}`);
      } else {
        tendenciesOutPartial[key] = n;
      }
    }
    const anchorsParsed = rawAnchorsSchema.safeParse(player.anchors);
    const anchorsSanitized = sanitizeAnchors(anchorsParsed.success ? anchorsParsed.data : {});
    const anchorsOut = simulationAnchorsSchema.parse(anchorsSanitized);
    const provenanceParsed = provenanceMapSchema.safeParse(player.provenance ?? {});
    const provenanceOut: ProvenanceMap = provenanceParsed.success ? provenanceParsed.data : {};
    if (identityFailures.length > failureStart) {
      continue;
    }
    const detailedRatings = simulationRatingsSchema.parse(detailedRatingsPartial);
    const tendenciesOut = simulationTendenciesSchema.parse(tendenciesOutPartial);
    const [firstName, lastName] = canonicalPlayerName(
      pid,
      str(player.firstName),
      str(player.lastName),
    );
    const altIds: NonNullable<PoolPlayer['altIds']> = {};
    if (Object.hasOwn(bbrefIds, pid)) {
      altIds.bbref = bbrefIds[pid];
    }
    const previous = existingAssetAltIds.get(pid);
    if (previous !== undefined) {
      if (typeof previous.nbaHeadshotAvailable === 'boolean') {
        altIds.nbaHeadshotAvailable = previous.nbaHeadshotAvailable;
      }
      if (previous.photoUrl !== undefined) {
        altIds.photoUrl = previous.photoUrl;
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
        nullableFrom(stats.usageRate),
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
      ...(player.ratingProfile != null &&
      ratingProfileSchema.safeParse(player.ratingProfile).success
        ? {
            ratingProfile: ratingProfileSchema.parse(player.ratingProfile),
          }
        : {}),
      detailedRatings,
      tendencies: tendenciesOut,
      anchors: anchorsOut,
      ...(player.reconstructedThreePoint != null &&
      reconstructedThreePointProfileSchema.safeParse(player.reconstructedThreePoint).success
        ? {
            reconstructedThreePoint: reconstructedThreePointProfileSchema.parse(
              player.reconstructedThreePoint,
            ),
          }
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
  writeJsonRetry(path, pool);
  const digest = sha256FileWithRetry(path);
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
export interface TargetBuildResult {
  entry: {
    franchiseId: string;
    eraId: string;
    url: string;
    contentHash: string;
  } | null;
  coverage: CoverageReportEntry;
}
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
      const raw = readJsonLoose(join(poolDir(), name)) as unknown;
      const parsed = franchiseEraPoolSchema.safeParse(raw);
      if (!parsed.success) continue;
      const pool = parsed.data;
      if (!Array.isArray(pool.players) || pool.players.length === 0) continue;
      pools.push({
        ...pool,
        players: pool.players.map((player) => ({
          ...player,
          altIds: player.altIds ?? null,
        })),
      });
    } catch {}
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
      (
        entry,
      ): entry is {
        franchiseId: string;
        eraId: string;
        url: string;
        contentHash: string;
      } => entry !== null,
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
export function coverageReportPath(): string {
  return join(PUBLIC_DATA, 'coverage-report.json');
}
const coverageReportEntrySchema = z.object({
  franchiseId: z.string(),
  eraId: z.string(),
  status: z.enum(['available', 'unavailable']),
  reason: unavailabilityReasonSchema.optional(),
  detail: z.string().optional(),
  firstSupportedSeason: z.string().optional(),
  playerCount: z.number().optional(),
  coverageSummary: coverageSummarySchema.optional(),
});
export type CoverageReportEntry = z.infer<typeof coverageReportEntrySchema>;
export function loadCoverageReport(): CoverageReportEntry[] {
  if (!fileExists(coverageReportPath())) return [];
  const raw = readJsonLoose(coverageReportPath()) as unknown;
  const parsed = z.array(coverageReportEntrySchema).safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data;
}
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
  entries: Array<{
    franchiseId: string;
    eraId: string;
    url: string;
    contentHash: string;
  }>,
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
function formatList(values: readonly string[]): string {
  return `[${values.map((value) => `'${value}'`).join(', ')}]`;
}
export type { Confidence };
