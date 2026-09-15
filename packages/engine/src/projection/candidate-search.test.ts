import { describe, expect, it } from 'vitest';
import type { Position, SeasonDraftCatalog } from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE, buildSeasonDraftCatalog } from '@hoop-rush/test-fixtures';
import { minutePlanHorizonGames } from '../season/minute-plan.ts';
import { candidateToPlayer } from './season.test-helpers.ts';
import { projectSeasonRoster } from './season.ts';
import { searchRosterRotationCandidates } from './candidate-search.ts';
import { buildProjectionModel } from './projection.test-helpers.ts';

function positionedCatalog(): SeasonDraftCatalog {
  const source = buildSeasonDraftCatalog({
    franchiseIds: ['lakers'],
    eras: ['1990s'],
    playersPerPool: 10,
  });
  const versionIds = source.candidates.map((candidate) => candidate.playerVersionId).sort();
  const playableById = new Map<string, Position[]>();
  versionIds.forEach((versionId, index) => {
    playableById.set(
      versionId,
      index <= 1 ? ['PG'] : index <= 3 ? ['SF'] : index === 4 ? ['C'] : ['PG'],
    );
  });
  return {
    ...source,
    candidates: source.candidates.map((candidate) => ({
      ...candidate,
      positions: {
        ...candidate.positions,
        playable: [...(playableById.get(candidate.playerVersionId) ?? ['PG'])],
      },
    })),
  };
}

describe('searchRosterRotationCandidates rotation identity', () => {
  it('keeps each ranked projection paired with its own rotation', () => {
    const catalog = positionedCatalog();
    const model = buildProjectionModel({
      search: {
        closeScenarioWeight: 0,
        startingFives: 1,
        closingFives: 2,
        benchHierarchies: 1,
        minuteTemplates: 1,
        completeCandidates: 1,
        nodeBudgets: { partial: 100000, complete: 100000, rotation: 100000 },
      },
    });
    const result = searchRosterRotationCandidates({
      catalog,
      locked: [],
      available: catalog.candidates.map((candidate) => candidate.playerVersionId),
      seed: 'rotation-identity-seed',
      eraProfile: DEFAULT_ERA_SIM_PROFILE,
      model,
      caps: { completeCandidates: 1, rotationsPerRoster: 2 },
    });
    expect(result.feasibilityFailure).toBeNull();
    expect(result.audit.rotationsEvaluated).toBe(2);
    expect(result.ranked).toHaveLength(2);
    const ids = result.ranked.map((candidate) => candidate.candidateId);
    expect(new Set(ids).size).toBe(ids.length);
    const starters = new Set(
      result.ranked.map((candidate) => candidate.rotation.starters.join(',')),
    );
    expect(starters.size).toBe(1);
    const closers = new Set(
      result.ranked.map((candidate) => candidate.rotation.closingFive.join(',')),
    );
    expect(closers.size).toBe(2);
    const playerById = new Map(
      catalog.candidates.map((candidate) => [
        candidate.playerVersionId,
        candidateToPlayer(candidate),
      ]),
    );
    const catalogById = new Map(
      catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
    );
    for (const candidate of result.ranked) {
      const rosterIds = candidate.projection.minutes.map((row) => row.playerVersionId);
      const projection = projectSeasonRoster({
        roster: rosterIds.map((id) => {
          const player = playerById.get(id);
          if (player === undefined) throw new Error(`catalog is missing ${id}`);
          return { player };
        }),
        rotation: candidate.rotation,
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model,
        minutePlan: {
          players: rosterIds.map((id) => {
            const entry = catalogById.get(id);
            return {
              playerVersionId: id,
              staminaRating: entry?.stamina.rating ?? 70,
              durability: entry?.durability.rating ?? 70,
              fatigueBasisPoints: 0,
              recentLoadBasisPoints: 0,
            };
          }),
          horizonGames: minutePlanHorizonGames(82),
        },
      });
      expect(candidate.projection.digest).toBe(projection.digest);
    }
  });
});
