import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { DEFAULT_SEASONS, ensureOutputDir } from '../config.ts';
import { clamp, fileExists, readJson, safeFloat, writeJsonRetry } from '../json.ts';
import { deriveTraits } from './traits.ts';
import { deriveContract } from './contracts.ts';
import { derivePlayerRecord, fieldPublished, positionGroup, type SeasonContext } from './v2.ts';
import { getEra } from './era.ts';
import { canonicalPlayerName } from '../identity.ts';
import { positionOverrideFor } from '../positions/overrides.ts';
import type { StatsRow } from './stats.ts';
import { loadRatingsModelArtifact } from './artifact.ts';
import { loadThreePointReconstructionArtifact } from '../reconstruction/artifact.ts';
export interface RosterPlayer extends Record<string, unknown> {
  externalId?: string | null;
  position?: string | null;
  id?: string | null;
  teamInternalId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  height?: unknown;
  heightInches?: unknown;
  weight?: unknown;
  weightLbs?: unknown;
  secondaryPositions?: unknown;
  age?: unknown;
  ratings?: Record<string, number>;
  tendencies?: Record<string, number>;
  summaryRatings?: {
    offenseRating: number;
    defenseRating: number;
    overallRating: number;
  };
  ratingProfile?: import('@hoop-rush/data-contracts').RatingProfile;
  anchors?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  unclamped?: Record<string, number>;
  traits?: Record<string, number>;
  contract?: unknown;
  importMeta?: {
    snapshotSeason: string;
    statsSource: string;
    lastUpdated: string;
  };
}
export function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return JSON.parse(text.replace(/\bNaN\b/g, 'null')) as unknown;
    }
    throw error;
  }
}
export function readJsonLoose(path: string): unknown {
  return parseJsonLoose(readFileSync(path, 'utf8'));
}
const POS_MAP: Record<string, string> = {
  G: 'SG',
  F: 'SF',
  C: 'C',
  PG: 'PG',
  SG: 'SG',
  SF: 'SF',
  PF: 'PF',
};
function mapPosition(raw: string): string {
  return POS_MAP[raw] ?? 'SF';
}
function safeHeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}
function seasonContext(season: string): SeasonContext {
  const era = getEra(season);
  return { leaguePpg: era.leaguePpg, league3PARate: era.league3PARate, pace: era.pace };
}
export function estimateTeamWinPctMap(statsList: readonly StatsRow[]): Map<string, number> {
  const teamBuckets = new Map<
    string,
    { weightedBpm: number; totalMinutes: number; perSum: number; perCount: number }
  >();
  for (const s of statsList) {
    const teamId = typeof s['teamExternalId'] === 'string' ? (s['teamExternalId'] as string) : '';
    if (!teamId) continue;
    let bucket = teamBuckets.get(teamId);
    if (!bucket) {
      bucket = { weightedBpm: 0, totalMinutes: 0, perSum: 0, perCount: 0 };
      teamBuckets.set(teamId, bucket);
    }
    const minutes = safeFloat(s['minutes'], 0);
    const bpm = s['boxPlusMinus'];
    if (bpm != null && typeof bpm === 'number' && Number.isFinite(bpm)) {
      bucket.weightedBpm += bpm * Math.max(1, minutes);
      bucket.totalMinutes += Math.max(1, minutes);
    }
    const per = s['per'];
    if (per != null && typeof per === 'number' && Number.isFinite(per)) {
      bucket.perSum += per;
      bucket.perCount += 1;
    }
  }
  const out = new Map<string, number>();
  for (const [teamId, bucket] of teamBuckets) {
    let winPct: number | null = null;
    if (bucket.totalMinutes > 0) {
      const avgBpm = bucket.weightedBpm / bucket.totalMinutes;
      winPct = clamp(0.5 + avgBpm * 0.075, 0.08, 0.92);
    }
    if (winPct == null && bucket.perCount > 0) {
      const avgPer = bucket.perSum / bucket.perCount;
      winPct = clamp(0.5 + (avgPer - 15) * 0.025, 0.08, 0.92);
    }
    if (winPct != null) {
      out.set(teamId, winPct);
    }
  }
  return out;
}
function teamWinPctForPlayer(
  stats: StatsRow,
  rosterTeamId: string | null,
  winMap: Map<string, number>,
): number | null {
  const statTeam =
    typeof stats['teamExternalId'] === 'string' ? (stats['teamExternalId'] as string) : null;
  const key = statTeam ?? rosterTeamId;
  if (!key) return null;
  return winMap.get(key) ?? null;
}
export function pooledRatePriors(
  roster: readonly RosterPlayer[],
  statsList: readonly StatsRow[],
): Map<
  string,
  {
    threePointPctPrior?: number;
    freeThrowPctPrior?: number;
  }
> {
  const groupByExtId = new Map<string, 'G' | 'F' | 'C'>();
  for (const player of roster) {
    const extId = player.externalId ?? '';
    if (extId === '') continue;
    const override = positionOverrideFor(extId);
    const pos = override !== null ? override.primary : mapPosition(player.position ?? 'SF');
    groupByExtId.set(extId, positionGroup(pos));
  }
  const sums = new Map<
    'G' | 'F' | 'C',
    {
      tpm: number;
      tpa: number;
      ftm: number;
      fta: number;
    }
  >();
  for (const s of statsList) {
    const extId = s['playerExternalId'];
    const group = typeof extId === 'string' ? groupByExtId.get(extId) : undefined;
    if (group === undefined) continue;
    const tpm = safeFloat(s['tpm']);
    const tpa = safeFloat(s['tpa']);
    const ftm = safeFloat(s['ftm']);
    const fta = safeFloat(s['fta']);
    const acc = sums.get(group) ?? { tpm: 0, tpa: 0, ftm: 0, fta: 0 };
    if (Number.isFinite(tpm) && Number.isFinite(tpa) && tpa > 0) {
      acc.tpm += tpm;
      acc.tpa += tpa;
    }
    if (Number.isFinite(ftm) && Number.isFinite(fta) && fta > 0) {
      acc.ftm += ftm;
      acc.fta += fta;
    }
    sums.set(group, acc);
  }
  const priors = new Map<
    string,
    {
      threePointPctPrior?: number;
      freeThrowPctPrior?: number;
    }
  >();
  for (const [group, acc] of sums) {
    const prior: {
      threePointPctPrior?: number;
      freeThrowPctPrior?: number;
    } = {};
    if (acc.tpa > 0) prior.threePointPctPrior = acc.tpm / acc.tpa;
    if (acc.fta > 0) prior.freeThrowPctPrior = acc.ftm / acc.fta;
    priors.set(group, prior);
  }
  return priors;
}
export function computeForSeason(season: string, force = false): void {
  const out = ensureOutputDir(season);
  const rosterPath = `${out}/roster.json`;
  const statsPath = `${out}/season-stats.json`;
  if (!fileExists(rosterPath)) {
    console.log(`  ! ${season}: no roster.json, skipping`);
    return;
  }
  if (!fileExists(statsPath)) {
    console.log(`  ! ${season}: no season-stats.json, skipping`);
    return;
  }
  const rosterText = readFileSync(rosterPath, 'utf8');
  if (
    !force &&
    (rosterText.includes('"statsSource": "nba_api"') ||
      rosterText.includes('"statsSource": "stints-derived"'))
  ) {
    console.log(`  [SKIP] ${season}: ratings already computed (use --force to recompute)`);
    return;
  }
  const roster = parseJsonLoose(rosterText) as RosterPlayer[];
  const statsList = readJson(statsPath) as StatsRow[];
  if (!Array.isArray(roster) || roster.length === 0) {
    console.log(`  ! ${season}: empty roster, skipping`);
    return;
  }
  if (!force) {
    const meta = roster[0]?.importMeta;
    if (meta?.statsSource === 'nba_api' || meta?.statsSource === 'stints-derived') {
      console.log(`  [SKIP] ${season}: ratings already computed (use --force to recompute)`);
      return;
    }
  }
  const statsById = new Map<string, StatsRow>();
  for (const s of statsList) {
    const pid = s['playerExternalId'];
    if (typeof pid === 'string' && pid !== '') {
      statsById.set(pid, s);
    }
  }
  const context = seasonContext(season);
  const artifact = loadRatingsModelArtifact();
  const threePointReconstruction = loadThreePointReconstructionArtifact();
  const ratePriorsByGroup = pooledRatePriors(roster, statsList);
  const teamWinPctMap = estimateTeamWinPctMap(statsList);
  let computed = 0;
  for (const player of roster) {
    const extId = player.externalId ?? '';
    const [canonicalFirstName, canonicalLastName] = canonicalPlayerName(
      extId,
      player.firstName ?? '',
      player.lastName ?? '',
    );
    player.firstName = canonicalFirstName;
    player.lastName = canonicalLastName;
    const override = positionOverrideFor(extId);
    const pos = override !== null ? override.primary : mapPosition(player.position ?? 'SF');
    player.position = pos;
    if (override !== null) {
      player.secondaryPositions = [...override.secondary];
    } else if (player.secondaryPositions === undefined || player.secondaryPositions === null) {
      player.secondaryPositions = [];
    }
    if (player.id === undefined || player.id === null || player.id === '') {
      const teamAbbr = (player.teamInternalId ?? 'unk').replace('team-', '');
      const first = player.firstName ?? '?';
      const last = player.lastName ?? '?';
      player.id = `p-${teamAbbr}-${first[0] ?? '?'}${last[0] ?? '?'}-${extId}`;
    }
    const heightStr = player.height;
    if (typeof heightStr === 'string' && heightStr.includes('-')) {
      const parts = heightStr.split('-');
      player.heightInches = Number(parts[0]) * 12 + Number(parts[1]);
    } else if (typeof heightStr === 'number') {
      player.heightInches = Math.trunc(heightStr);
    } else if (player.heightInches === undefined || player.heightInches === null) {
      player.heightInches = 78;
    }
    if (safeFloat(player.weightLbs) === 0) {
      const weightStr = player.weight;
      if (
        typeof weightStr === 'string' &&
        weightStr.trim() !== '' &&
        /^\d+$/.test(weightStr.trim())
      ) {
        player.weightLbs = Number(weightStr.trim());
      } else if (typeof weightStr === 'number' && weightStr > 0) {
        player.weightLbs = Math.trunc(weightStr);
      }
    }
    if (player.secondaryPositions === undefined || player.secondaryPositions === null) {
      player.secondaryPositions = [];
    }
    const stats: StatsRow = statsById.get(extId) ?? {};
    const rosterTeamId =
      typeof (player as Record<string, unknown>)['teamExternalId'] === 'string'
        ? ((player as Record<string, unknown>)['teamExternalId'] as string)
        : null;
    const teamWinPct = teamWinPctForPlayer(stats, rosterTeamId, teamWinPctMap);
    const derived = derivePlayerRecord({
      season,
      playerId: extId !== '' ? `p-${extId}` : (player.id ?? undefined),
      position: pos,
      heightInches: safeHeight(player.heightInches),
      weightLbs: safeFloat(player.weightLbs),
      age: safeFloat(stats['age'] ?? player.age, 25) || 25,
      stats,
      era: context,
      artifact,
      ratePriors: ratePriorsByGroup.get(positionGroup(pos)),
      threePointReconstruction,
      teamWinPct,
    });
    player.ratings = derived.ratings;
    player.tendencies = derived.tendencies;
    player.summaryRatings = derived.summaryRatings;
    player.anchors = derived.anchors;
    player.reconstructedThreePoint = derived.reconstructedThreePoint;
    player.provenance = derived.provenance;
    player.unclamped = derived.unclamped;
    player.methods = derived.methods;
    player.ratingProfile = derived.ratingProfile;
    player.traits = deriveTraits(player.ratings, stats, pos);
    const age = safeFloat(stats['age'] ?? player.age, 25) || 25;
    player.contract = deriveContract(player.summaryRatings.overallRating, Math.trunc(age));
    player.importMeta = {
      snapshotSeason: season,
      statsSource: stats['statsSource'] === 'stints-derived' ? 'stints-derived' : 'nba_api',
      lastUpdated: '2026-08-02T00:00:00Z',
    };
    computed += 1;
  }
  writeJsonRetry(rosterPath, roster);
  console.log(`  [OK] computed ratings for ${String(computed)} players in ${season}`);
}
export function defaultRatingsWorkers(): number {
  if (process.env.NODE_ENV === 'test') return 1;
  return Math.min(8, availableParallelism());
}
function chunkList<T>(items: readonly T[], workers: number): T[][] {
  const count = Math.max(1, Math.trunc(workers));
  if (count <= 1 || items.length <= 1) {
    return [[...items]];
  }
  const size = Math.ceil(items.length / count);
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}
function runRatingsChunk(seasons: readonly string[], force: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ratings-worker.ts', import.meta.url), {
      workerData: { seasons: [...seasons], force },
    });
    let settled = false;
    worker.once('message', () => {
      settled = true;
      void worker.terminate();
      resolve();
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
      reject(new Error(`ratings worker exited with code ${String(code)}`));
    });
  });
}
export async function run(seasons?: string[], force = false, workers?: number): Promise<void> {
  const target = seasons ?? DEFAULT_SEASONS;
  console.log('[ratings] deriving ratings from real stats');
  const workerCount =
    workers === undefined ? defaultRatingsWorkers() : Math.max(1, Math.trunc(workers));
  if (workerCount <= 1 || target.length <= 1) {
    for (const season of target) {
      computeForSeason(season, force);
    }
    return;
  }
  await Promise.all(chunkList(target, workerCount).map((chunk) => runRatingsChunk(chunk, force)));
}
export { fieldPublished };
