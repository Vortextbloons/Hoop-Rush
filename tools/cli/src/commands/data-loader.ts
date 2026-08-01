import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  eraSimulationProfileSchema,
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  opponentTeamSchema,
  type EraSimulationProfile,
  type FranchiseEraPool,
  type HoopRushManifest,
  type OpponentTeam,
} from '@hoop-rush/data-contracts';

/**
 * Loads packaged static artifacts from the repo (spec/09: commands read
 * production artifacts but never mutate them). Every artifact is validated
 * and hash-verified against the manifest.
 */

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
export const DEFAULT_MANIFEST_PATH = resolve(REPO_ROOT, 'apps/web/static/data/manifest.json');

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
export function loadPackagedData(manifestPath: string = DEFAULT_MANIFEST_PATH): {
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
    const entry = this.manifest.pools.find(
      (p) => p.franchiseId === franchiseId && p.eraId === eraId,
    );
    if (!entry) throw new Error(`no pool for ${franchiseId}/${eraId} in the manifest`);
    const { path, read } = this.artifact(entry.url);
    verifyHash(path, entry.contentHash);
    const parsed = franchiseEraPoolSchema.safeParse(read());
    if (!parsed.success) throw new Error(`pool ${path} fails validation`);
    return parsed.data;
  }

  openingOpponent(): OpponentTeam {
    const entry = this.manifest.opponents[0];
    if (!entry) throw new Error('no opponents packaged in the manifest');
    const { path, read } = this.artifact(entry.url);
    verifyHash(path, entry.contentHash);
    const parsed = opponentTeamSchema.safeParse(read());
    if (!parsed.success) throw new Error(`opponent ${path} fails validation`);
    return parsed.data;
  }
}
