/**
 * Main ratings entry (port of compute_ratings.py compute_for_season / run).
 *
 * Reads roster.json + season-stats.json, derives the strict engine ratings,
 * tendencies, packaged anchors, summary ratings, provenance, and unclamped
 * diagnostics through the versioned field-method registry (spec/12), and
 * writes the complete roster.json back. No random jitter: every value is a
 * pure function of versioned inputs.
 */
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { DEFAULT_SEASONS, ensureOutputDir } from '../config.js';
import { fileExists, readJson, safeFloat, writeJsonRetry } from '../json.js';
import { deriveTraits } from './traits.js';
import { deriveContract } from './contracts.js';
import { derivePlayerRecord, fieldPublished, type SeasonContext } from './v2.js';
import { getEra } from './era.js';
import { canonicalPlayerName } from '../identity.js';
import { positionOverrideFor } from '../positions/overrides.js';
import type { StatsRow } from './stats.js';

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
  summaryRatings?: { offenseRating: number; defenseRating: number; overallRating: number };
  anchors?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  unclamped?: Record<string, number>;
  traits?: Record<string, number>;
  contract?: unknown;
  importMeta?: { snapshotSeason: string; statsSource: string; lastUpdated: string };
}

/**
 * Python's json.loads accepts bare `NaN` tokens produced by json.dumps of
 * pandas NaN values; JSON.parse rejects them. Replace the token with null
 * (equivalent behavior for the fields we consume).
 */
export function parseJsonLoose(text: string): unknown {
  return JSON.parse(text.replace(/\bNaN\b/g, 'null')) as unknown;
}

export function readJsonLoose(path: string): unknown {
  return parseJsonLoose(readFileSync(path, 'utf8'));
}

/** Source position-label normalization used when no override table entry exists. */
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

/** League context for era-relative translation (versioned era table). */
function seasonContext(season: string): SeasonContext {
  const era = getEra(season);
  return { leaguePpg: era.leaguePpg, league3PARate: era.league3PARate, pace: era.pace };
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

  const roster = readJsonLoose(rosterPath) as RosterPlayer[];
  const statsList = readJson(statsPath) as StatsRow[];

  if (!Array.isArray(roster) || roster.length === 0) {
    console.log(`  ! ${season}: empty roster, skipping`);
    return;
  }

  // Check if already computed (unless force)
  if (!force) {
    const meta = roster[0]?.importMeta;
    if (meta?.statsSource === 'nba_api' || meta?.statsSource === 'stints-derived') {
      console.log(`  [SKIP] ${season}: ratings already computed (use --force to recompute)`);
      return;
    }
  }

  // Build stats lookup by externalId
  const statsById = new Map<string, StatsRow>();
  for (const s of statsList) {
    const pid = s['playerExternalId'];
    if (typeof pid === 'string' && pid !== '') {
      statsById.set(pid, s);
    }
  }

  const context = seasonContext(season);

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
    // Apply the reviewed override before derivation so ratings use the
    // corrected primary; the corrected position and secondary positions are
    // persisted back into roster.json, so the v5 career-labels cache and
    // pool builds inherit the corrections.
    const override = positionOverrideFor(extId);
    const pos = override !== null ? override.primary : mapPosition(player.position ?? 'SF');
    player.position = pos;
    if (override !== null) {
      player.secondaryPositions = [...override.secondary];
    } else if (player.secondaryPositions === undefined || player.secondaryPositions === null) {
      player.secondaryPositions = [];
    }

    // Set internal ID if missing
    if (player.id === undefined || player.id === null || player.id === '') {
      const teamAbbr = (player.teamInternalId ?? 'unk').replace('team-', '');
      const first = player.firstName ?? '?';
      const last = player.lastName ?? '?';
      player.id = `p-${teamAbbr}-${first[0] ?? '?'}${last[0] ?? '?'}-${extId}`;
    }

    // Convert height/weight
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

    // Set secondaryPositions (overrides set it above; clear missing values).
    if (player.secondaryPositions === undefined || player.secondaryPositions === null) {
      player.secondaryPositions = [];
    }

    // Get stats
    const stats: StatsRow = statsById.get(extId) ?? {};

    // Derive all fields through the versioned registry (no jitter).
    const derived = derivePlayerRecord({
      season,
      position: pos,
      heightInches: safeHeight(player.heightInches),
      stats,
      era: context,
    });
    player.ratings = derived.ratings;
    player.tendencies = derived.tendencies;
    player.summaryRatings = derived.summaryRatings;
    player.anchors = derived.anchors;
    player.provenance = derived.provenance;
    player.unclamped = derived.unclamped;
    player.methods = derived.methods;
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

/** Default ratings worker count, capped by the machine's cores. */
export function defaultRatingsWorkers(): number {
  // Unit tests mock config paths; real worker threads would read the real
  // raw-data dirs, so the parallel default stays off under vitest.
  if (process.env.NODE_ENV === 'test') return 1;
  return Math.min(8, availableParallelism());
}

/** Splits a list into at most `workers` deterministic contiguous chunks. */
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

/** Runs one season chunk in a worker thread; resolves when it finishes. */
function runRatingsChunk(seasons: readonly string[], force: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ratings-worker.js', import.meta.url), {
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
