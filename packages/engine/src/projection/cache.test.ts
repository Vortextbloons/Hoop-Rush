import { describe, expect, it } from 'vitest';
import { DEFAULT_ERA_SIM_PROFILE } from '@hoop-rush/test-fixtures';
import type {
  EraSimulationProfile,
  ProjectionModelArtifact,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { ProjectionCache, projectSeasonRoster } from './index.ts';
import { buildInput } from './season.test-helpers.ts';
import { buildProjectionModel } from './projection.test-helpers.ts';

describe('ProjectionCache input fingerprints', () => {
  it('misses when a player ratings and anchors change for the same playerVersionId', () => {
    const { players, rotation } = buildInput();
    const model = buildProjectionModel();
    const cache = new ProjectionCache();
    const first = projectSeasonRoster(
      {
        roster: players.map((player) => ({ player })),
        rotation,
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model,
      },
      { cache },
    );
    const changedPlayers: SimulationPlayer[] = players.map((player, index) => {
      if (index !== 0) return player;
      const changed: SimulationPlayer = {
        ...player,
        ratings: { ...player.ratings, threePoint: 99, ballHandling: 99, passing: 99 },
      };
      if (player.anchors !== undefined) {
        changed.anchors = { ...player.anchors, pointsPerGame: 41.5 };
      }
      return changed;
    });
    const second = projectSeasonRoster(
      {
        roster: changedPlayers.map((player) => ({ player })),
        rotation,
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model,
      },
      { cache },
    );
    expect(second.digest).not.toBe(first.digest);
  });
  it('misses when the model artifact inputs change', () => {
    const { players, rotation } = buildInput();
    const model = buildProjectionModel();
    const eraId = DEFAULT_ERA_SIM_PROFILE.eraId;
    const referenceSet = model.references[eraId];
    if (referenceSet === undefined)
      throw new Error('fixture model is missing the era reference set');
    const [p1, p2, p3, p4, p5] = referenceSet.neutral.players;
    const changedModel: ProjectionModelArtifact = {
      ...model,
      references: {
        ...model.references,
        [eraId]: {
          ...referenceSet,
          neutral: {
            ...referenceSet.neutral,
            players: [
              {
                ...p1,
                ratings: { ...p1.ratings, threePoint: 5, insideScoring: 5, midrange: 5 },
              },
              p2,
              p3,
              p4,
              p5,
            ],
          },
        },
      },
    };
    const cache = new ProjectionCache();
    const first = projectSeasonRoster(
      {
        roster: players.map((player) => ({ player })),
        rotation,
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model,
      },
      { cache },
    );
    const second = projectSeasonRoster(
      {
        roster: players.map((player) => ({ player })),
        rotation,
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model: changedModel,
      },
      { cache },
    );
    expect(second.digest).not.toBe(first.digest);
  });
  it('misses when the era profile changes', () => {
    const { players, rotation } = buildInput();
    const model = buildProjectionModel();
    const changedProfile: EraSimulationProfile = {
      ...DEFAULT_ERA_SIM_PROFILE,
      profileVersion: `${DEFAULT_ERA_SIM_PROFILE.profileVersion}-changed`,
    };
    const cache = new ProjectionCache();
    projectSeasonRoster(
      {
        roster: players.map((player) => ({ player })),
        rotation,
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model,
      },
      { cache },
    );
    const missesAfterFirst = cache.stats().misses;
    expect(missesAfterFirst).toBeGreaterThan(0);
    projectSeasonRoster(
      {
        roster: players.map((player) => ({ player })),
        rotation,
        eraProfile: changedProfile,
        model,
      },
      { cache },
    );
    expect(cache.stats().misses).toBeGreaterThan(missesAfterFirst);
  });
});
