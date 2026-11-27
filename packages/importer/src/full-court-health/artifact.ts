import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fullCourtHealthProfileSetSchema,
  seasonDraftCatalogSchema,
  type FullCourtHealthProfileSet,
} from '@hoop-rush/data-contracts';
import { fileExists, readJson, sha256Hex, sha256File, writeJsonCompact } from '../json.ts';
import { RAW_CACHE } from '../config.ts';
import { deriveFullCourtHealthProfiles } from './index.ts';

export const FULL_COURT_HEALTH_PROFILES_ASSET = 'full-court-health-profiles.json';

export interface FullCourtHealthCatalogVersions {
  readonly candidates: readonly { readonly playerVersionId: string }[];
}

export interface FullCourtHealthProfileAsset {
  readonly url: typeof FULL_COURT_HEALTH_PROFILES_ASSET;
  readonly contentHash: string;
  readonly changed: boolean;
}

/**
 * The profile asset pins the draft catalog bytes it was fitted from. Reject a
 * stale asset instead of silently pairing old rates with a new catalog.
 */
export function validateFullCourtHealthProfiles(
  profiles: unknown,
  catalog: FullCourtHealthCatalogVersions,
  catalogHash: string,
): FullCourtHealthProfileSet {
  const parsed = fullCourtHealthProfileSetSchema.parse(profiles);
  if (parsed.catalogHash !== catalogHash) {
    throw new Error(
      `Full Court health profiles were fitted from catalog ${parsed.catalogHash.slice(0, 12)}… but the packaged catalog is ${catalogHash.slice(0, 12)}…; regenerate the profiles`,
    );
  }
  const expected = new Set(catalog.candidates.map((candidate) => candidate.playerVersionId));
  const missing = [...expected].filter((id) => !Object.hasOwn(parsed.players, id));
  const extra = Object.keys(parsed.players).filter((id) => !expected.has(id));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Full Court health profiles do not cover the packaged catalog (${String(missing.length)} missing, ${String(extra.length)} orphaned versions)`,
    );
  }
  return parsed;
}

export function writeFullCourtHealthProfiles(
  dataDir: string,
  profiles: FullCourtHealthProfileSet,
): FullCourtHealthProfileAsset {
  const path = join(dataDir, FULL_COURT_HEALTH_PROFILES_ASSET);
  const text = `${JSON.stringify(profiles)}\n`;
  const changed = !fileExists(path) || readFileSync(path, 'utf8') !== text;
  if (changed) writeJsonCompact(path, profiles);
  return {
    url: FULL_COURT_HEALTH_PROFILES_ASSET,
    contentHash: sha256Hex(text),
    changed,
  };
}

export interface PackageFullCourtHealthOptions {
  readonly dataDir: string;
  readonly profilesPath?: string;
  readonly evidencePath?: string;
}

export interface PackageFullCourtHealthResult {
  readonly status: 'written' | 'unchanged' | 'preserved';
  readonly asset: FullCourtHealthProfileAsset;
  readonly profiles: FullCourtHealthProfileSet;
}

/**
 * Package the offline profiles without shipping the source evidence. Local
 * evidence is ignored, so a cached profiles file or an existing pinned asset
 * keeps a clean checkout packagable; stale pinned bytes are never overwritten
 * without regenerating from inputs.
 */
export function packageFullCourtHealthProfiles(
  options: PackageFullCourtHealthOptions,
): PackageFullCourtHealthResult {
  const catalogPath = join(options.dataDir, 'draft-catalog.json');
  if (!fileExists(catalogPath)) {
    throw new Error(`Full Court health profiles need a packaged draft catalog at ${catalogPath}`);
  }
  const catalog = seasonDraftCatalogSchema.parse(readJson(catalogPath));
  const catalogHash = sha256File(catalogPath);
  const profilesPath = options.profilesPath ?? join(RAW_CACHE, 'full-court-health-profiles.json');
  const evidencePath = options.evidencePath ?? join(RAW_CACHE, 'full-court-health-evidence.json');
  const assetPath = join(options.dataDir, FULL_COURT_HEALTH_PROFILES_ASSET);

  let profiles: FullCourtHealthProfileSet;
  let status: PackageFullCourtHealthResult['status'];
  if (fileExists(profilesPath)) {
    profiles = validateFullCourtHealthProfiles(readJson(profilesPath), catalog, catalogHash);
    status = 'written';
  } else if (fileExists(evidencePath)) {
    profiles = validateFullCourtHealthProfiles(
      deriveFullCourtHealthProfiles(catalog, readJson(evidencePath), {
        catalogHash,
        evidenceHash: sha256File(evidencePath),
      }),
      catalog,
      catalogHash,
    );
    status = 'written';
  } else if (fileExists(assetPath)) {
    profiles = validateFullCourtHealthProfiles(readJson(assetPath), catalog, catalogHash);
    status = 'preserved';
  } else {
    throw new Error(
      'Full Court health profiles are unavailable: provide the cached profiles/evidence files or check in the packaged profile asset',
    );
  }

  if (status === 'preserved') {
    return {
      status,
      asset: {
        url: FULL_COURT_HEALTH_PROFILES_ASSET,
        contentHash: sha256File(assetPath),
        changed: false,
      },
      profiles,
    };
  }
  const asset = writeFullCourtHealthProfiles(options.dataDir, profiles);
  return { status: asset.changed ? 'written' : 'unchanged', asset, profiles };
}
