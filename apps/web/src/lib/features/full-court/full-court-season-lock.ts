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
}

/**
 * New runs use the packaged historical injury profiles when present. A resumed
 * run is matched to its saved checkpoint digest, so a run initialized without
 * profiles keeps its legacy inputs and a run initialized with profiles never
 * switches to another profile set on refresh.
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
  const withoutProfiles = lockFullCourtRegularSeason(input.season);
  if (withoutProfiles.digest === input.checkpoint.lockDigest) return withoutProfiles;
  const profiles = await input.loadProfiles();
  if (profiles === null) {
    throw new Error(
      'This Full Court run was locked with historical injury profiles that are no longer packaged. Restore the matching data version to resume it.',
    );
  }
  const withProfiles = lockFullCourtRegularSeason(input.season, {
    profiles,
    catalogAssetHash: input.catalogAssetHash,
  });
  if (withProfiles.digest === input.checkpoint.lockDigest) return withProfiles;
  throw new Error(
    'This Full Court run was locked with different inputs. Restore its original data version to resume it.',
  );
}
