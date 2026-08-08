import { describe, expect, it } from 'vitest';
import type { ProjectionModelArtifact } from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE } from '@hoop-rush/test-fixtures';
import {
  buildHumanSeasonRoster,
  projectSeasonRoster,
  rankCandidates,
  searchRosterRotationCandidates,
} from '../projection/index.ts';
import { buildInput } from './season.test-helpers.ts';
import { validateSeasonRotation } from '../season/rotation.ts';

function smallModel(): ProjectionModelArtifact {
  return {
    schemaVersion: 1,
    modelVersion: 'projection-model-v1',
    dataVersion: 'm10-ratings-v3.4',
    ratingsVersion: 'ratings-v3.4',
    eraProfileVersions: { '1990s': DEFAULT_ERA_SIM_PROFILE.profileVersion },
    references: {
      '1990s': {
        neutral: {
          referenceId: 'ref-1990s-neutral',
          archetype: 'neutral',
          eraId: '1990s',
          referenceHash: 'f'.repeat(64),
          players: [1, 2, 3, 4, 5].map((n) => ({
            playerId: `p-r-${String(n)}`,
            displayName: `R ${String(n)}`,
            positions: [n === 5 ? 'C' : n >= 3 ? 'SF' : 'PG'] as string[],
            heightInches: 78,
            weightLbs: 210,
            ratings: {
              insideScoring: 68,
              closeShot: 66,
              midrange: 64,
              threePoint: 60,
              freeThrow: 72,
              ballHandling: 68,
              passing: 68,
              offensiveIq: 68,
              offensiveRebound: 58,
              defensiveRebound: 62,
              perimeterDefense: 60,
              interiorDefense: 60,
              steal: 58,
              block: 58,
              defensiveIq: 60,
              speed: 68,
              strength: 64,
              vertical: 64,
            },
            tendencies: {
              usageRate: 20,
              passRate: 30,
              shotRate: 25,
              driveRate: 18,
              postUpRate: 5,
              rimFrequency: 30,
              shortMidFrequency: 20,
              longMidFrequency: 14,
              cornerThreeFrequency: 8,
              aboveBreakThreeFrequency: 12,
              threePointRate: 20,
              freeThrowRate: 22,
              turnoverRate: 12,
              isolationRate: 10,
              pickAndRollBallHandlerRate: 25,
              pickAndRollRollManRate: 10,
              spotUpRate: 20,
              transitionRate: 15,
              cutRate: 10,
              foulRate: 2,
              stealAttemptRate: 8,
              blockAttemptRate: 10,
              crashOffensiveGlassRate: 12,
            },
          })) as unknown as ProjectionModelArtifact['references']['1990s']['neutral']['players'],
        },
        archetypes: [],
      },
    },
    scales: {
      creation: { baseline: 0.5, perPoint: 0.01, min: 0, max: 100, higherIsBetter: true },
      spacing: { baseline: 0.5, perPoint: 0.01, min: 0, max: 100, higherIsBetter: true },
      defense: { baseline: 55, perPoint: 1, min: 0, max: 100, higherIsBetter: true },
    },
    componentWeights: { creation: 1, spacing: 1, defense: 1 },
    weights: { basketballMean: 0.4, rotationMean: 0.35, robustnessMean: 0.25 },
    weaknesses: [],
    search: {
      seedNamespace: 'season-projection-search',
      partialBeamsPerLens: 8,
      completeCandidates: 4,
      startingFives: 4,
      closingFives: 2,
      benchHierarchies: 2,
      minuteTemplates: 1,
      singleRemovals: 'all',
      pairRemovals: 2,
      nodeBudgets: { partial: 10_000, complete: 10_000, rotation: 40 },
      closeScenarioWeight: 0.2,
    },
    cohorts: {
      calibrationGames: 2048,
      validationGames: 1024,
      heldOutGames: 2048,
      calibrationSeedFrom: '00000000000000000000000000000000',
      calibrationSeedTo: '000000000000000000000000000007ff',
      validationSeedFrom: '00000000000000000000000000000800',
      validationSeedTo: '00000000000000000000000000000bff',
      heldOutSeedFrom: '00000000000000000000000000000c00',
      heldOutSeedTo: '000000000000000000000000000013ff',
    },
    monotonicGates: [
      {
        code: 'shooting-monotonic',
        driver: 'threePoint',
        output: 'effectiveFieldGoalPct',
        description: 'better shooting must not lower projected eFG%',
      },
    ],
  };
}

function projectionOf(): ReturnType<typeof projectSeasonRoster> {
  const { players, rotation } = buildInput();
  return projectSeasonRoster({
    roster: players.map((player) => ({ player })),
    rotation,
    eraProfile: DEFAULT_ERA_SIM_PROFILE,
    model: smallModel(),
  });
}

describe('rankCandidates', () => {
  it('ranks legal candidates and rejects hard-gate failures', () => {
    const projection = projectionOf();
    const model = smallModel();
    const result = rankCandidates({
      candidates: [
        {
          candidateId: 'good',
          projection,
          gates: {
            legal: true,
            legalStartersAndClosers: true,
            coverageOk: true,
            bandOk: true,
            anchorsOk: true,
            ownershipOk: true,
            rolesOk: true,
            feasibilityOk: true,
          },
        },
        {
          candidateId: 'illegal',
          projection,
          gates: {
            legal: false,
            legalStartersAndClosers: true,
            coverageOk: true,
            bandOk: true,
            anchorsOk: true,
            ownershipOk: true,
            rolesOk: true,
            feasibilityOk: true,
          },
        },
        {
          candidateId: 'band',
          projection,
          gates: {
            legal: true,
            legalStartersAndClosers: true,
            coverageOk: true,
            bandOk: false,
            anchorsOk: true,
            ownershipOk: true,
            rolesOk: true,
            feasibilityOk: true,
          },
        },
      ],
      model,
    });
    expect(result.ranked.map((candidate) => candidate.candidateId)).toContain('good');
    expect(result.rejected.map((candidate) => candidate.candidateId).sort()).toEqual([
      'band',
      'illegal',
    ]);
    const top = result.ranked[0];
    expect(top?.finalScore).toBeGreaterThan(0);
    expect(top?.basketballMean).toBeGreaterThan(0);
    expect(top?.rotationMean).toBeGreaterThan(0);
    expect(top?.robustnessMean).toBeGreaterThan(0);
  });

  it('filters dominated candidates through Pareto', () => {
    const projection = projectionOf();
    const model = smallModel();
    const better = {
      ...projection,
      metrics: { ...projection.metrics, netRating: projection.metrics.netRating + 1 },
    };
    const result = rankCandidates({
      candidates: [
        {
          candidateId: 'dominated',
          projection,
          gates: {
            legal: true,
            legalStartersAndClosers: true,
            coverageOk: true,
            bandOk: true,
            anchorsOk: true,
            ownershipOk: true,
            rolesOk: true,
            feasibilityOk: true,
          },
        },
        {
          candidateId: 'dominant',
          projection: better,
          gates: {
            legal: true,
            legalStartersAndClosers: true,
            coverageOk: true,
            bandOk: true,
            anchorsOk: true,
            ownershipOk: true,
            rolesOk: true,
            feasibilityOk: true,
          },
        },
      ],
      model,
    });
    // The dominated candidate must not appear among Pareto survivors.
    expect(result.ranked.map((candidate) => candidate.candidateId)).not.toContain('dominated');
    expect(result.ranked.map((candidate) => candidate.candidateId)).toContain('dominant');
  });

  it('rejects candidates with critical weaknesses', () => {
    const projection = projectionOf();
    const model = smallModel();
    const withWeakness: typeof projection = {
      ...projection,
      weaknesses: [
        { code: 'creation', severity: 'critical', threshold: 35, value: 30, evidence: ['low'] },
      ],
    };
    const result = rankCandidates({
      candidates: [
        {
          candidateId: 'critical',
          projection: withWeakness,
          gates: {
            legal: true,
            legalStartersAndClosers: true,
            coverageOk: true,
            bandOk: true,
            anchorsOk: true,
            ownershipOk: true,
            rolesOk: true,
            feasibilityOk: true,
          },
        },
      ],
      model,
    });
    expect(result.ranked).toHaveLength(0);
    expect(result.rejected[0]?.reasons.join(' ')).toContain('critical weakness creation');
  });
});

describe('searchRosterRotationCandidates', () => {
  it('finds complete legal candidates and is deterministic', () => {
    const catalog = buildInput().catalog;
    const model = smallModel();
    const versions = catalog.candidates.map((candidate) => candidate.playerVersionId);
    const input = {
      catalog,
      locked: [] as string[],
      available: versions,
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
      eraProfile: DEFAULT_ERA_SIM_PROFILE,
      model,
      lens: 'balance' as const,
    };
    const first = searchRosterRotationCandidates(input);
    const second = searchRosterRotationCandidates(input);
    expect(second.audit).toEqual(first.audit);
    expect(second.ranked.map((candidate) => candidate.candidateId)).toEqual(
      first.ranked.map((candidate) => candidate.candidateId),
    );
    expect(first.feasibilityFailure).toBeNull();
    expect(first.ranked.length).toBeGreaterThan(0);
    for (const candidate of first.ranked) {
      expect(candidate.rotation.starters).toHaveLength(5);
      const rosterVersions = candidate.projection.minutes.map((row) => row.playerVersionId);
      const memberPlayable = new Map(
        rosterVersions.map((id) => {
          const member = catalog.candidates.find((entry) => entry.playerVersionId === id);
          return [id, member?.positions.playable ?? []];
        }),
      );
      expect(validateSeasonRotation(candidate.rotation, memberPlayable)).toEqual([]);
      expect(candidate.projection.metrics.positionalCoverage).toBe(100);
    }
    // Rotations must be legal against the candidate roster.
    const top = first.ranked[0];
    const rosterSet = new Set(top === undefined ? [] : candidateVersionIdsOf(top));
    expect(rosterSet.size).toBe(10);
  });

  it('returns the typed feasibility failure when no completion exists', () => {
    const catalog = buildInput().catalog;
    const model = smallModel();
    const versions = catalog.candidates.map((candidate) => candidate.playerVersionId);
    // Lock nine guards: no legal completion under 4/4/3.
    const guards = versions.filter((id) => {
      const member = catalog.candidates.find((candidate) => candidate.playerVersionId === id);
      return member?.positions.playable.includes('PG') || member?.positions.playable.includes('SG');
    });
    const result = searchRosterRotationCandidates({
      catalog,
      locked: guards.slice(0, 9),
      available: versions,
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
      eraProfile: DEFAULT_ERA_SIM_PROFILE,
      model,
    });
    expect(result.feasibilityFailure?.code).toBe('NO_FEASIBLE_COMPLETION');
  });
});

function candidateVersionIdsOf(candidate: {
  projection: { minutes: Array<{ playerVersionId: string }> };
}): string[] {
  return candidate.projection.minutes.map((row) => row.playerVersionId);
}

describe('buildHumanSeasonRoster', () => {
  it('preserves locked picks and returns a legal selected roster', () => {
    const catalog = buildInput().catalog;
    const model = smallModel();
    const versions = catalog.candidates.map((candidate) => candidate.playerVersionId);
    const locked = versions.slice(0, 2);
    const result = buildHumanSeasonRoster({
      catalog,
      locked,
      available: versions,
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
      eraProfile: DEFAULT_ERA_SIM_PROFILE,
      model,
    });
    expect(result.ok).toBe(true);
    expect(result.roster).not.toBeNull();
    const selected = result.roster as string[];
    expect(selected).toHaveLength(10);
    for (const pick of locked) expect(selected).toContain(pick);
    expect(new Set(selected).size).toBe(10);
    expect(result.rotation).not.toBeNull();
    expect(result.projection).not.toBeNull();
    expect(result.audit.selectedCandidateId).not.toBeNull();
  });

  it('fails with the typed feasibility error on impossible locks', () => {
    const { players } = buildInput();
    const catalog = buildInput().catalog;
    const model = smallModel();
    const versions = players.map((player) => player.playerVersionId ?? '');
    const guards = versions.filter((id) => {
      const member = catalog.candidates.find((candidate) => candidate.playerVersionId === id);
      return member?.positions.playable.includes('PG') || member?.positions.playable.includes('SG');
    });
    const result = buildHumanSeasonRoster({
      catalog,
      locked: guards.slice(0, 9),
      available: versions,
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
      eraProfile: DEFAULT_ERA_SIM_PROFILE,
      model,
    });
    expect(result.ok).toBe(false);
    expect(result.feasibilityFailure?.code).toBe('NO_FEASIBLE_COMPLETION');
    expect(result.roster).toBeNull();
  });
});





