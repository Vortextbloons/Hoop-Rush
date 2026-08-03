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

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as Error).message}`);
  }
}

function verifyHash(path: string, expected: string): void {
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
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
  const parsed = hoopRushManifestSchema.safeParse(readJson(manifestPath));
  if (!parsed.success) {
    throw new Error(
      `manifest ${manifestPath} fails validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return { manifest: parsed.data, dir: dirname(manifestPath) };
}

export class PackagedData {
  private readonly poolCache = new Map<string, FranchiseEraPool>();

  constructor(
    readonly manifest: HoopRushManifest,
    readonly dir: string,
  ) {}

  private artifact(url: string): { path: string; read: () => unknown } {
    const path = resolveArtifact(this.dir, url);
    return {
      path,
      read: () => readJson(path),
    };
  }

  eraProfile(eraId = '1990s'): EraSimulationProfile {
    const entry = this.manifest.eraSimulationProfiles.find((e) => e.eraId === eraId);
    if (!entry) throw new Error(`no era simulation profile for ${eraId} in the manifest`);
    const { path, read } = this.artifact(entry.url);
    verifyHash(path, entry.contentHash);
    const parsed = eraSimulationProfileSchema.safeParse(read());
    if (!parsed.success) throw new Error(`profile ${path} fails validation`);
    return parsed.data;
  }

  pool(franchiseId: string, eraId: string): FranchiseEraPool {
    const cacheKey = `${franchiseId}/${eraId}`;
    const cached = this.poolCache.get(cacheKey);
    if (cached) return cached;
    const entry = this.manifest.pools.find(
      (p) => p.franchiseId === franchiseId && p.eraId === eraId,
    );
    if (!entry) throw new Error(`no pool for ${franchiseId}/${eraId} in the manifest`);
    const { path, read } = this.artifact(entry.url);
    verifyHash(path, entry.contentHash);
    const parsed = franchiseEraPoolSchema.safeParse(read());
    if (!parsed.success) throw new Error(`pool ${path} fails validation`);
    this.poolCache.set(cacheKey, parsed.data);
    return parsed.data;
  }

  /** The single frozen opponent bracket (spec/02), hash-verified. */
  bracket(): OpponentBracket {
    const entry = this.manifest.bracket;
    if (!entry) throw new Error('no bracket packaged in the manifest');
    const { path, read } = this.artifact(entry.url);
    verifyHash(path, entry.contentHash);
    const parsed = opponentBracketSchema.safeParse(read());
    if (!parsed.success) throw new Error(`bracket ${path} fails validation`);
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
