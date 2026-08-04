import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  eraSimulationProfileSchema,
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  opponentBracketSchema,
  type EraSimulationProfile,
  type FranchiseEraPool,
  type HoopRushManifest,
  type OpponentBracket,
} from '@hoop-rush/data-contracts';
import { UsageError } from '../args.js';

/**
 * Loads packaged static artifacts from the repo (spec/09: commands read
 * production artifacts but never mutate them). Every artifact is validated
 * and hash-verified against the manifest.
 */

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
export const DEFAULT_MANIFEST = resolve(REPO_ROOT, 'apps/web/static/data/manifest.json');

function readJsonBytes(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as Error).message}`);
  }
}

function parseJson(path: string, bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as Error).message}`);
  }
}

function verifyHash(path: string, bytes: Buffer, expected: string): void {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new Error(`content hash mismatch for ${path}: expected ${expected}, got ${actual}`);
  }
}

function resolveArtifact(manifestDir: string, url: string): string {
  return isAbsolute(url) ? url : resolve(manifestDir, url);
}

/** Loads the manifest plus its directory for artifact resolution. */
export function loadPackagedData(manifestPath: string = DEFAULT_MANIFEST): {
  manifest: HoopRushManifest;
  dir: string;
} {
  const bytes = readJsonBytes(manifestPath);
  const parsed = hoopRushManifestSchema.safeParse(parseJson(manifestPath, bytes));
  if (!parsed.success) {
    throw new Error(
      `manifest ${manifestPath} fails validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return { manifest: parsed.data, dir: dirname(manifestPath) };
}

export class PackagedData {
  private readonly poolCache = new Map<string, FranchiseEraPool>();
  private readonly profileCache = new Map<string, EraSimulationProfile>();
  private bracketCache: OpponentBracket | null = null;
  private readonly poolEntries: Map<string, HoopRushManifest['pools'][number]>;

  constructor(
    readonly manifest: HoopRushManifest,
    readonly dir: string,
  ) {
    this.poolEntries = new Map(
      manifest.pools.map((entry) => [`${entry.franchiseId}/${entry.eraId}`, entry]),
    );
  }

  private artifact(url: string): { path: string; bytes: Buffer } {
    const path = resolveArtifact(this.dir, url);
    const bytes = readJsonBytes(path);
    return { path, bytes };
  }

  eraProfile(eraId = '1990s'): EraSimulationProfile {
    const cached = this.profileCache.get(eraId);
    if (cached) return cached;
    const entry = this.manifest.eraSimulationProfiles.find((e) => e.eraId === eraId);
    if (!entry) throw new Error(`no era simulation profile for ${eraId} in the manifest`);
    const { path, bytes } = this.artifact(entry.url);
    verifyHash(path, bytes, entry.contentHash);
    const parsed = eraSimulationProfileSchema.safeParse(parseJson(path, bytes));
    if (!parsed.success) throw new Error(`profile ${path} fails validation`);
    this.profileCache.set(eraId, parsed.data);
    return parsed.data;
  }

  pool(franchiseId: string, eraId: string): FranchiseEraPool {
    const cacheKey = `${franchiseId}/${eraId}`;
    const cached = this.poolCache.get(cacheKey);
    if (cached) return cached;
    const entry = this.poolEntries.get(cacheKey);
    if (!entry) throw new Error(`no pool for ${franchiseId}/${eraId} in the manifest`);
    const { path, bytes } = this.artifact(entry.url);
    verifyHash(path, bytes, entry.contentHash);
    const parsed = franchiseEraPoolSchema.safeParse(parseJson(path, bytes));
    if (!parsed.success) throw new Error(`pool ${path} fails validation`);
    this.poolCache.set(cacheKey, parsed.data);
    return parsed.data;
  }

  /** The single frozen opponent bracket (spec/02), hash-verified. */
  bracket(): OpponentBracket {
    if (this.bracketCache) return this.bracketCache;
    const entry = this.manifest.bracket;
    if (!entry) throw new Error('no bracket packaged in the manifest');
    const { path, bytes } = this.artifact(entry.url);
    verifyHash(path, bytes, entry.contentHash);
    const parsed = opponentBracketSchema.safeParse(parseJson(path, bytes));
    if (!parsed.success) throw new Error(`bracket ${path} fails validation`);
    this.bracketCache = parsed.data;
    return parsed.data;
  }
}

/** Validates a standalone era-profile file (used by sim/calibrate/challenge). */
export function loadProfileFile(path: string): EraSimulationProfile {
  const parsed = eraSimulationProfileSchema.safeParse(
    JSON.parse(readFileSync(path, 'utf8')) as unknown,
  );
  if (!parsed.success) {
    throw new UsageError(
      `profile ${path} fails validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}

/** Validates a standalone bracket file (used by sim challenge). */
export function loadBracketFile(path: string): OpponentBracket {
  const parsed = opponentBracketSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (!parsed.success) {
    throw new UsageError(
      `bracket ${path} fails validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}
