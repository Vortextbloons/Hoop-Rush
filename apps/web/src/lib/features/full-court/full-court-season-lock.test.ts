/* eslint-disable @typescript-eslint/await-thenable, @typescript-eslint/no-confusing-void-expression -- bun-types declares .resolves/.rejects matchers as void; Bun docs require awaiting them */
import { describe, expect, it } from 'bun:test';
import {
  FULL_COURT_HEALTH_PROFILE_VERSION,
  fullCourtHealthProfileSetSchema,
  type FullCourtHealthProfileSet,
} from '@hoop-rush/data-contracts';
import {
  createFullCourtSeasonCheckpoint,
  lockFullCourtRegularSeason,
  type FullCourtRegularSeason,
} from '@hoop-rush/engine';
import { fullCourtTestSeasonLock } from './full-court-test-support';
import { resolveFullCourtSeasonLock } from './full-court-season-lock';

const CATALOG_HASH = 'a'.repeat(64);

function profilesOf(
  season: FullCourtRegularSeason,
  episodesPer10kAppearances = 100,
): FullCourtHealthProfileSet {
  const players: Record<string, unknown> = {};
  for (const team of season.teams) {
    for (const player of team.roster) {
      if (player.playerVersionId === undefined) throw new Error('Missing test player version');
      players[player.playerVersionId] = {
        cohortId: 'test-cohort',
        episodesPer10kAppearances,
        playerEvidence: { source: 'population' },
      };
    }
  }
  return fullCourtHealthProfileSetSchema.parse({
    version: FULL_COURT_HEALTH_PROFILE_VERSION,
    catalogHash: CATALOG_HASH,
    evidenceHash: 'b'.repeat(64),
    cohorts: { 'test-cohort': { observedAppearances: 1_000, durationCounts: [1, 0, 0, 0] } },
    players,
  });
}

const SEASON = fullCourtTestSeasonLock().season;
const PROFILES = profilesOf(SEASON);

describe('resolveFullCourtSeasonLock', () => {
  it('locks a new run with the packaged profiles', async () => {
    const lock = await resolveFullCourtSeasonLock({
      season: SEASON,
      checkpoint: null,
      catalogAssetHash: CATALOG_HASH,
      loadProfiles: () => Promise.resolve(PROFILES),
    });
    expect(lock.injuryProfiles).toBeDefined();
    expect(lock.digest).toBe(
      lockFullCourtRegularSeason(SEASON, {
        profiles: PROFILES,
        catalogAssetHash: CATALOG_HASH,
      }).digest,
    );
  });

  it('keeps a new run on legacy inputs when no profiles are packaged', async () => {
    const lock = await resolveFullCourtSeasonLock({
      season: SEASON,
      checkpoint: null,
      catalogAssetHash: CATALOG_HASH,
      loadProfiles: () => Promise.resolve(null),
    });
    expect(lock.injuryProfiles).toBeUndefined();
    expect(lock.digest).toBe(lockFullCourtRegularSeason(SEASON).digest);
  });

  it('resumes a legacy run without loading profiles', async () => {
    const legacy = lockFullCourtRegularSeason(SEASON);
    const checkpoint = createFullCourtSeasonCheckpoint(legacy);
    const lock = await resolveFullCourtSeasonLock({
      season: SEASON,
      checkpoint,
      catalogAssetHash: CATALOG_HASH,
      loadProfiles: () => {
        throw new Error('profiles should not load for a legacy run');
      },
    });
    expect(lock).toEqual(legacy);
  });

  it('resumes a profile-pinned run with the same inputs', async () => {
    const pinned = lockFullCourtRegularSeason(SEASON, {
      profiles: PROFILES,
      catalogAssetHash: CATALOG_HASH,
    });
    let loaded = 0;
    const lock = await resolveFullCourtSeasonLock({
      season: SEASON,
      checkpoint: createFullCourtSeasonCheckpoint(pinned),
      catalogAssetHash: CATALOG_HASH,
      loadProfiles: () => {
        loaded += 1;
        return Promise.resolve(PROFILES);
      },
    });
    expect(loaded).toBe(1);
    expect(lock.digest).toBe(pinned.digest);
    expect(lock.injuryProfiles).toEqual(pinned.injuryProfiles);
  });

  it('refuses to switch a profiled run to different profiles', async () => {
    const pinned = lockFullCourtRegularSeason(SEASON, {
      profiles: PROFILES,
      catalogAssetHash: CATALOG_HASH,
    });
    await expect(
      resolveFullCourtSeasonLock({
        season: SEASON,
        checkpoint: createFullCourtSeasonCheckpoint(pinned),
        catalogAssetHash: CATALOG_HASH,
        loadProfiles: () => Promise.resolve(profilesOf(SEASON, 150)),
      }),
    ).rejects.toThrow('locked with different inputs');
  });

  it('fails clearly when a profiled run loses its packaged profiles', async () => {
    const pinned = lockFullCourtRegularSeason(SEASON, {
      profiles: PROFILES,
      catalogAssetHash: CATALOG_HASH,
    });
    await expect(
      resolveFullCourtSeasonLock({
        season: SEASON,
        checkpoint: createFullCourtSeasonCheckpoint(pinned),
        catalogAssetHash: CATALOG_HASH,
        loadProfiles: () => Promise.resolve(null),
      }),
    ).rejects.toThrow('historical injury profiles that are no longer packaged');
  });
});
