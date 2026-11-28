import type {
  FullCourtHealthProfileSet,
  FullCourtSeasonCheckpoint,
} from '@hoop-rush/data-contracts';
import {
  lockFullCourtRegularSeason,
  type FullCourtRegularSeason,
  type FullCourtSeasonLock,
} from '@hoop-rush/engine';

export interface FullCourtSeasonLockInput {
  readonly season: FullCourtRegularSeason;
  /** The existing checkpoint, when this run has already started. */
  readonly checkpoint: FullCourtSeasonCheckpoint | null;
  readonly catalogAssetHash: string;
  readonly loadProfiles: () => Promise<FullCourtHealthProfileSet | null>;
  /** Optional fallback season built from the legacy era profile for older saves. */
  readonly loadLegacySeason?: () => Promise<FullCourtRegularSeason | null>;
}

async function matchSeasonLock(
  season: FullCourtRegularSeason,
  expectedDigest: string,
  catalogAssetHash: string,
  loadProfiles: () => Promise<FullCourtHealthProfileSet | null>,
  cachedProfiles?: FullCourtHealthProfileSet | null,
): Promise<{
  readonly lock: FullCourtSeasonLock | null;
  readonly profiles: FullCourtHealthProfileSet | null | undefined;
}> {
  const withoutProfiles = lockFullCourtRegularSeason(season);
  if (withoutProfiles.digest === expectedDigest) {
    return { lock: withoutProfiles, profiles: cachedProfiles };
  }
  const profiles = cachedProfiles !== undefined ? cachedProfiles : await loadProfiles();
  if (profiles === null) {
    return { lock: null, profiles };
  }
  const withProfiles = lockFullCourtRegularSeason(season, {
    profiles,
    catalogAssetHash,
  });
  return { lock: withProfiles.digest === expectedDigest ? withProfiles : null, profiles };
}

/**
 * New runs use the packaged historical injury profiles when present. A resumed
 * run is matched to its saved checkpoint digest, so a run initialized without
 * profiles keeps its legacy inputs and a run initialized with profiles never
 * switches to another profile set on refresh. When the primary era profile does
 * not match an older save, `loadLegacySeason` allows resuming legacy-era runs.
 */
export async function resolveFullCourtSeasonLock(
  input: FullCourtSeasonLockInput,
): Promise<FullCourtSeasonLock> {
  if (input.checkpoint === null) {
    const profiles = await input.loadProfiles();
    return profiles === null
      ? lockFullCourtRegularSeason(input.season)
      : lockFullCourtRegularSeason(input.season, {
          profiles,
          catalogAssetHash: input.catalogAssetHash,
        });
  }
  const primary = await matchSeasonLock(
    input.season,
    input.checkpoint.lockDigest,
    input.catalogAssetHash,
    input.loadProfiles,
  );
  if (primary.lock !== null) return primary.lock;

  if (input.loadLegacySeason !== undefined) {
    const legacySeason = await input.loadLegacySeason();
    if (legacySeason !== null) {
      const legacy = await matchSeasonLock(
        legacySeason,
        input.checkpoint.lockDigest,
        input.catalogAssetHash,
        input.loadProfiles,
        primary.profiles,
      );
      if (legacy.lock !== null) return legacy.lock;
    }
  }

  if (primary.profiles === null) {
    throw new Error(
      'This Full Court run was locked with historical injury profiles that are no longer packaged. Restore the matching data version to resume it.',
    );
  }
  throw new Error(
    'This Full Court run was locked with different inputs. Restore its original data version to resume it.',
  );
}
