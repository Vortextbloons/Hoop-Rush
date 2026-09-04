import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  provenanceMapSchema,
  ratingProfileSchema,
  simulationAnchorsSchema,
  simulationRatingsSchema,
  simulationTendenciesSchema,
  summaryRatingsSchema,
} from '@hoop-rush/data-contracts';
import { DEFAULT_SEASONS, RAW_CACHE, ensureOutputDir } from '../config.ts';
import { clamp, fileExists, parseJsonLoose, readJson, safeFloat, writeJsonRetry } from '../json.ts';
import { chunkList, defaultWorkerCount, runWorker } from '../shared/worker-pool.ts';
import { join } from 'node:path';
import { deriveTraits } from './traits.ts';
import { deriveContract } from './contracts.ts';
import { derivePlayerRecord, fieldPublished, positionGroup, type SeasonContext } from './v2.ts';
import { getEra } from './era.ts';
import { canonicalPlayerName } from '../identity.ts';
import { positionOverrideFor } from '../positions/overrides.ts';
import { loadRatingsModelArtifact } from './artifact.ts';
import { loadThreePointReconstructionArtifact } from '../reconstruction/artifact.ts';
const rosterPlayerSchema = z.looseObject({
  externalId: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  id: z.string().nullable().optional(),
  teamInternalId: z.string().nullable().optional(),
  teamExternalId: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  height: z.unknown().optional(),
  heightInches: z.unknown().optional(),
  weight: z.unknown().optional(),
  weightLbs: z.unknown().optional(),
  secondaryPositions: z.unknown().optional(),
  age: z.unknown().optional(),
  ratings: simulationRatingsSchema.optional(),
  tendencies: simulationTendenciesSchema.optional(),
  summaryRatings: summaryRatingsSchema.optional(),
  ratingProfile: ratingProfileSchema.optional(),
  anchors: simulationAnchorsSchema.optional(),
  provenance: provenanceMapSchema.optional(),
  unclamped: z.record(z.string(), z.number()).optional(),
  traits: z.record(z.string(), z.number()).optional(),
  contract: z.unknown().optional(),
  methods: z.record(z.string(), z.string()).optional(),
  reconstructedThreePoint: z.unknown().optional(),
  importMeta: z
    .object({
      snapshotSeason: z.string(),
      statsSource: z.string(),
      lastUpdated: z.string(),
    })
    .optional(),
});
export type RosterPlayer = z.infer<typeof rosterPlayerSchema>;
const ratingsStatsRowSchema = z.looseObject({
  playerExternalId: z.unknown().optional(),
  teamExternalId: z.unknown().optional(),
  minutes: z.unknown().optional(),
  gamesPlayed: z.unknown().optional(),
  points: z.unknown().optional(),
  rebounds: z.unknown().optional(),
  offensiveRebounds: z.unknown().optional(),
  defensiveRebounds: z.unknown().optional(),
  assists: z.unknown().optional(),
  steals: z.unknown().optional(),
  blocks: z.unknown().optional(),
  turnovers: z.unknown().optional(),
  fouls: z.unknown().optional(),
  fgm: z.unknown().optional(),
  fga: z.unknown().optional(),
  tpm: z.unknown().optional(),
  tpa: z.unknown().optional(),
  ftm: z.unknown().optional(),
  fta: z.unknown().optional(),
  boxPlusMinus: z.unknown().optional(),
  per: z.unknown().optional(),
  usageRate: z.unknown().optional(),
  tsPct: z.unknown().optional(),
  efgPct: z.unknown().optional(),
  age: z.unknown().optional(),
  statsSource: z.unknown().optional(),
});
type RatingsStatsRow = z.infer<typeof ratingsStatsRowSchema>;
const winPctRowSchema = z.looseObject({
  PLAYER_ID: z.unknown().optional(),
  playerExternalId: z.unknown().optional(),
  W_PCT: z.unknown().optional(),
  wPct: z.unknown().optional(),
  winPct: z.unknown().optional(),
});
const winPctFileSchema = z.looseObject({
  rows: z.array(winPctRowSchema).optional(),
});
export { parseJsonLoose };
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
function loadPlayerWinPctMap(season: string): Map<string, number> {
  const map = new Map<string, number>();
  const candidates = [
    join(RAW_CACHE, `league_dash_player_stats_measure__measure=Advanced_season=${season}.json`),
    join(RAW_CACHE, `league_dash_player_stats__season=${season}.json`),
  ];
  for (const path of candidates) {
    if (!fileExists(path)) continue;
    try {
      const data = readJson(path);
      const fileParsed = winPctFileSchema.safeParse(data);
      let rows: z.infer<typeof winPctRowSchema>[] = [];
      if (fileParsed.success && Array.isArray(fileParsed.data.rows)) {
        rows = fileParsed.data.rows;
      } else if (Array.isArray(data)) {
        const arrayParsed = z.array(winPctRowSchema).safeParse(data);
        if (arrayParsed.success) rows = arrayParsed.data;
      }
      for (const row of rows) {
        const rawId = row.PLAYER_ID ?? row.playerExternalId ?? '';
        const pid =
          typeof rawId === 'string' ||
          typeof rawId === 'number' ||
          typeof rawId === 'boolean'
            ? String(rawId)
            : '';
        if (!pid) continue;
        const wPctRaw = row.W_PCT ?? row.wPct ?? row.winPct;
        const wPct = typeof wPctRaw === 'number' && Number.isFinite(wPctRaw) ? wPctRaw : null;
        if (wPct != null) {
          map.set(pid, clamp(wPct, 0, 1));
        }
      }
      if (map.size > 0) break;
    } catch {}
  }
  return map;
}
export function estimateTeamWinPctMap(statsList: readonly RatingsStatsRow[]): Map<string, number> {
  const teamBuckets = new Map<
    string,
    {
      weightedBpm: number;
      totalMinutes: number;
      perSum: number;
      perCount: number;
    }
  >();
  for (const s of statsList) {
    const teamId = typeof s.teamExternalId === 'string' ? s.teamExternalId : '';
    if (!teamId) continue;
    let bucket = teamBuckets.get(teamId);
    if (!bucket) {
      bucket = { weightedBpm: 0, totalMinutes: 0, perSum: 0, perCount: 0 };
      teamBuckets.set(teamId, bucket);
    }
    const minutes = safeFloat(s.minutes, 0);
    const bpm = s.boxPlusMinus;
    if (bpm != null && typeof bpm === 'number' && Number.isFinite(bpm)) {
      bucket.weightedBpm += bpm * Math.max(1, minutes);
      bucket.totalMinutes += Math.max(1, minutes);
    }
    const per = s.per;
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
  stats: RatingsStatsRow,
  rosterTeamId: string | null,
  winMap: Map<string, number>,
): number | null {
  const statTeam = typeof stats.teamExternalId === 'string' ? stats.teamExternalId : null;
  const key = statTeam ?? rosterTeamId;
  if (!key) return null;
  return winMap.get(key) ?? null;
}
export function pooledRatePriors(
  roster: readonly RosterPlayer[],
  statsList: readonly RatingsStatsRow[],
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
    const extId = s.playerExternalId;
    const group = typeof extId === 'string' ? groupByExtId.get(extId) : undefined;
    if (group === undefined) continue;
    const tpm = safeFloat(s.tpm);
    const tpa = safeFloat(s.tpa);
    const ftm = safeFloat(s.ftm);
    const fta = safeFloat(s.fta);
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
  const rosterRaw = parseJsonLoose(rosterText) as unknown;
  const rosterParsed = z.array(rosterPlayerSchema).safeParse(rosterRaw);
  const statsRaw = readJson(statsPath) as unknown;
  const statsParsed = z.array(ratingsStatsRowSchema).safeParse(statsRaw);
  const roster = rosterParsed.success ? rosterParsed.data : [];
  const statsList = statsParsed.success ? statsParsed.data : [];
  if (roster.length === 0) {
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
  const statsById = new Map<string, RatingsStatsRow>();
  for (const s of statsList) {
    const pid = s.playerExternalId;
    if (typeof pid === 'string' && pid !== '') {
      statsById.set(pid, s);
    }
  }
  const context = seasonContext(season);
  const artifact = loadRatingsModelArtifact();
  const threePointReconstruction = loadThreePointReconstructionArtifact();
  const ratePriorsByGroup = pooledRatePriors(roster, statsList);
  const teamWinPctMap = estimateTeamWinPctMap(statsList);
  const playerWinPctMap = loadPlayerWinPctMap(season);
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
    const stats: RatingsStatsRow = statsById.get(extId) ?? {};
    const rosterTeamId = typeof player.teamExternalId === 'string' ? player.teamExternalId : null;
    const playerWinPct = extId ? (playerWinPctMap.get(extId) ?? null) : null;
    const fallbackTeamWinPct = teamWinPctForPlayer(stats, rosterTeamId, teamWinPctMap);
    const teamWinPct = playerWinPct ?? fallbackTeamWinPct;
    const derived = derivePlayerRecord({
      season,
      playerId: extId !== '' ? `p-${extId}` : (player.id ?? undefined),
      position: pos,
      heightInches: safeHeight(player.heightInches),
      weightLbs: safeFloat(player.weightLbs),
      age: safeFloat(stats.age ?? player.age, 25) || 25,
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
    player.reconstructedThreePoint =
      derived.reconstructedThreePoint as RosterPlayer['reconstructedThreePoint'];
    player.provenance = derived.provenance;
    player.unclamped = derived.unclamped;
    player.methods = derived.methods as RosterPlayer['methods'];
    player.ratingProfile = derived.ratingProfile;
    player.traits = deriveTraits(player.ratings, stats, pos) as RosterPlayer['traits'];
    const age = safeFloat(stats.age ?? player.age, 25) || 25;
    player.contract = deriveContract(player.summaryRatings.overallRating, Math.trunc(age));
    player.importMeta = {
      snapshotSeason: season,
      statsSource: stats.statsSource === 'stints-derived' ? 'stints-derived' : 'nba_api',
      lastUpdated: '2026-08-02T00:00:00Z',
    };
    computed += 1;
  }
  writeJsonRetry(rosterPath, roster);
  console.log(`  [OK] computed ratings for ${String(computed)} players in ${season}`);
}
export function defaultRatingsWorkers(): number {
  return defaultWorkerCount(8);
}
function runRatingsChunk(seasons: readonly string[], force: boolean): Promise<void> {
  return runWorker<void>(new URL('./ratings-worker.ts', import.meta.url), {
    seasons: [...seasons],
    force,
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
