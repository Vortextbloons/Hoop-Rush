import { describe, expect, it } from 'vitest';
import {
  SEASON_AI_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  seasonDigestHex,
  type SeasonDraftCatalog,
  type SeasonDraftCandidate,
  type SeasonLeagueGenerationResult,
  type SeasonRosterTargets,
} from '@hoop-rush/data-contracts';
import {
  buildSeasonDraftCatalog,
  buildSeasonLeague,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import {
  SeasonAiGenerationError,
  SeasonAiTargetsError,
  fiveReachableFromCounts,
  generateAiLeague,
  validateSeasonRosterTargets,
} from './ai.ts';
import {
  nearestRankThreshold,
  percentileTierOf,
  playerPercentileTier,
  rolePercentileThresholds,
  ROSTER_ROLES,
} from './ai-scoring.ts';
import {
  completionTargetsMet,
  legalFiveAfterAnyRemoval,
  rosterFeasibleFromCounts,
  rosterGroupCounts,
  validateSeasonRoster,
  type SeasonRosterMemberInput,
} from './roster-rules.ts';
import { buildMinimalRotation, validateSeasonRotation } from './rotation.ts';

/**
 * Season Run M2.4 roster-generation-v2 tests: percentile tiering (never
 * Overall), league-wide private pools (exclusivity, anchors, tier mixtures),
 * canonical order invariance, rerun equality, seeded variation, statistical
 * extra-elite frequency, and typed failure under scarcity with phase and
 * allocation-state diagnostics. Rules are never relaxed.
 */

const ALL_ROLES = [...ROSTER_ROLES];

function buildTestTargets(): SeasonRosterTargets {
  return {
    schemaVersion: 2,
    targetsVersion: SEASON_ROSTER_TARGETS_VERSION,
    policy: {
      bandQuotas: {
        solo: { contender: 4, playoff: 8, average: 10, weaker: 7 },
        duo: { contender: 4, playoff: 8, average: 9, weaker: 7 },
      },
      guaranteedAnchors: { contender: 2, playoff: 1, average: 0, weaker: 0 },
      extraEliteRollProbability: { contender: 0.65, playoff: 0.35, average: 0.2, weaker: 0.08 },
      tierRanges: {
        contender: { elite: [2, 4], strong: [5, 8], useful: [6, 10] },
        playoff: { elite: [1, 2], strong: [4, 7], useful: [7, 10] },
        average: { elite: [0, 1], strong: [3, 6], useful: [8, 11] },
        weaker: { elite: [0, 1], strong: [1, 4], useful: [7, 10] },
      },
      identityPriorityRoles: {
        'star-chaser': ['primary-creation', 'secondary-creation', 'rim-finishing-interior-scoring'],
        'shooting-first': ['perimeter-shooting'],
        'defense-first': ['perimeter-defense', 'interior-defense'],
        'depth-builder': ALL_ROLES,
        continuity: ALL_ROLES,
        'active-trader': ALL_ROLES,
      },
      roleCoverageThreshold: 35,
      completionTargets: { guards: 4, forwards: 4, centers: 3 },
      poolSize: 20,
      rosterSize: 10,
      percentileTiers: { elite: 0.9, strong: 0.75, useful: 0.5 },
      bandPoolScoreCaps: { contender: 100, playoff: 92, average: 84, weaker: 74 },
      maxPoolStrengthOutliers: 4,
      maxRosterStrengthOutliers: 2,
      nodeBudgets: { anchorMatching: 20000, poolRepair: 40000, rosterSelection: 600000 },
    },
    calibration: {
      calibrationSeedCount: 64,
      validationSeedCount: 32,
      generatedAtIso: '2026-01-01T00:00:00.000Z',
      aiVersion: SEASON_AI_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      gates: {
        failureRateMax: 0,
        minBandSeparation: 3,
        anchorFulfillmentMin: 1,
        extraEliteRateTolerance: 0.05,
        heldOutPassShare: 0.95,
        orderInvarianceFailuresMax: 0,
        superTeamIncidenceMax: 0.08,
      },
    },
    measured: {
      bands: {
        contender: {
          range: [55, 90],
          median: 70,
          eliteShare: 0.2,
          strongShare: 0.4,
          usefulShare: 0.6,
        },
        playoff: {
          range: [50, 85],
          median: 64,
          eliteShare: 0.15,
          strongShare: 0.35,
          usefulShare: 0.55,
        },
        average: {
          range: [45, 80],
          median: 58,
          eliteShare: 0.1,
          strongShare: 0.3,
          usefulShare: 0.5,
        },
        weaker: {
          range: [40, 74],
          median: 52,
          eliteShare: 0.05,
          strongShare: 0.2,
          usefulShare: 0.45,
        },
      },
      identities: {
        'star-chaser': { range: [40, 90], median: 60 },
        'depth-builder': { range: [40, 90], median: 60 },
        'defense-first': { range: [40, 90], median: 60 },
        'shooting-first': { range: [40, 90], median: 60 },
        continuity: { range: [40, 90], median: 60 },
        'active-trader': { range: [40, 90], median: 60 },
      },
      anchorFulfillment: 1,
      extraEliteRate: 0,
      superTeamIncidence: 0,
      poolLegalityFailures: 0,
      selectionFailures: 0,
      generationFailures: 0,
    },
  };
}

const CATALOG = buildSeasonDraftCatalog({
  franchiseIds: ['lakers', 'celtics', 'bulls', 'warriors', 'heat', 'knicks', 'spurs', 'jazz'],
  eras: ['1980s', '1990s', '2000s', '2010s'],
  playersPerPool: 20,
});
const LEAGUE = buildSeasonLeague();

function humanRoster(catalog: SeasonDraftCatalog, franchiseId: string, eraId: string): string[] {
  const pool = catalog.candidates.filter((c) => c.franchiseId === franchiseId && c.eraId === eraId);
  if (pool.length < 10) throw new Error('pool too small for a human roster');
  // Ten versions from one pool covering G4 F4 C3 with a legal five when the
  // pool is full-sized; any ten distinct versions otherwise (scarcity
  // fixtures only need distinct, known versions).
  const indices =
    pool.length >= 20 ? [0, 1, 2, 3, 4, 5, 7, 8, 10, 17] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const picks = indices
    .map((i) => pool[i])
    .filter((c): c is SeasonDraftCandidate => c !== undefined);
  if (picks.length !== 10) throw new Error('human roster incomplete');
  return picks.map((c) => c.playerVersionId);
}

function soloInput(seed: string, catalog: SeasonDraftCatalog = CATALOG, league = LEAGUE) {
  return {
    seed,
    catalog,
    league,
    humanFranchiseIds: ['lakers'] as string[],
    humanRosters: [
      {
        franchiseId: 'lakers',
        playerVersionIds: humanRoster(catalog, 'lakers', '1990s'),
      },
    ],
    targets: buildTestTargets(),
  };
}

function membersOf(
  result: SeasonLeagueGenerationResult,
  franchiseId: string,
  catalog: SeasonDraftCatalog,
): SeasonRosterMemberInput[] {
  const roster = result.rosters.find((r) => r.franchiseId === franchiseId);
  if (!roster) throw new Error(`no roster for ${franchiseId}`);
  return roster.players.map((player) => {
    const candidate = catalog.candidates.find((c) => c.playerVersionId === player.playerVersionId);
    if (!candidate) throw new Error('roster references an unknown candidate');
    return { playerVersionId: player.playerVersionId, playable: candidate.positions.playable };
  });
}

/** Canonical facts of a generation: everything sorted, digest included. */
function canonicalFacts(result: SeasonLeagueGenerationResult): string {
  const rosters = [...result.rosters]
    .sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1))
    .map((roster) => ({
      franchiseId: roster.franchiseId,
      players: roster.players.map((p) => p.playerVersionId).sort(),
    }));
  const ownership = [...result.ownership].sort((a, b) =>
    a.playerVersionId < b.playerVersionId ? -1 : 1,
  );
  const evaluations = [...result.evaluations]
    .sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1))
    .map((evaluation) => ({
      franchiseId: evaluation.franchiseId,
      band: evaluation.band,
      identity: evaluation.identity,
      strengthScore: evaluation.strengthScore,
    }));
  return JSON.stringify({
    digest: result.digest,
    rosters,
    ownership,
    evaluations,
    aiPools: result.aiPools,
  });
}

describe('v2 percentile tiering', () => {
  it('computes nearest-rank thresholds with ties inside the tier', () => {
    const sorted = [1, 2, 2, 2, 10];
    // p = 0.8, n = 5: Math.ceil(4) - 1 = 3 -> sorted[3] = 2.
    expect(nearestRankThreshold(sorted, 0.8)).toBe(2);
    expect(nearestRankThreshold(sorted, 0.2)).toBe(1);
    expect(nearestRankThreshold(sorted, 1)).toBe(10);
    expect(nearestRankThreshold([], 0.9)).toBe(0);
  });

  it('classifies per-role tiers and takes the highest tier as the pool tier', () => {
    const thresholds = rolePercentileThresholds([
      { ...zeroScores(), 'primary-creation': 10 },
      { ...zeroScores(), 'primary-creation': 40 },
      { ...zeroScores(), 'primary-creation': 70 },
      { ...zeroScores(), 'primary-creation': 90 },
    ]);
    // n = 4: elite = sorted[3] = 90, strong = sorted[2] = 70, useful = sorted[1] = 40.
    expect(thresholds['primary-creation']).toEqual({ elite: 90, strong: 70, useful: 40 });
    const elite = percentileTierOf({ ...zeroScores(), 'primary-creation': 90 }, thresholds);
    expect(elite['primary-creation']).toBe('elite');
    expect(playerPercentileTier(elite)).toBe('elite');
    const strong = percentileTierOf({ ...zeroScores(), 'primary-creation': 70 }, thresholds);
    expect(strong['primary-creation']).toBe('strong');
    const weak = percentileTierOf({ ...zeroScores(), 'primary-creation': 5 }, thresholds);
    expect(weak['primary-creation']).toBe('depth');
  });

  it('mutating Overall alone leaves tiers and the generation byte-identical', () => {
    const clone = buildSeasonDraftCatalog({
      franchiseIds: ['lakers', 'celtics', 'bulls', 'warriors', 'heat', 'knicks', 'spurs', 'jazz'],
      eras: ['1980s', '1990s', '2000s', '2010s'],
      playersPerPool: 20,
    });
    for (const candidate of clone.candidates) {
      candidate.summaryRatings.overallRating =
        (candidate.summaryRatings.overallRating * 7 + 13) % 100;
    }
    const a = generateAiLeague(soloInput(seedFromString('overall-a')));
    const b = generateAiLeague(soloInput(seedFromString('overall-a'), clone));
    expect(a.digest).toBe(b.digest);
    expect(canonicalFacts(a)).toBe(canonicalFacts(b));
  });
});

describe('v2 league-wide private pools', () => {
  it('produces 29 exclusive pools solo and 28 in a duo league', () => {
    const solo = generateAiLeague(soloInput(seedFromString('pools-solo')));
    expect(solo.aiPools).toHaveLength(29);
    const duo = generateAiLeague({
      ...soloInput(seedFromString('pools-duo')),
      humanFranchiseIds: ['lakers', 'celtics'],
      humanRosters: [
        { franchiseId: 'lakers', playerVersionIds: humanRoster(CATALOG, 'lakers', '1990s') },
        { franchiseId: 'celtics', playerVersionIds: humanRoster(CATALOG, 'celtics', '1990s') },
      ],
    });
    expect(duo.aiPools).toHaveLength(28);
  });

  it('keeps every pool at 20 distinct ids containing its ten selections', () => {
    const result = generateAiLeague(soloInput(seedFromString('pools-shape')));
    const allPoolIds = new Set<string>();
    for (const pool of result.aiPools) {
      expect(pool.playerVersionIds).toHaveLength(20);
      expect(new Set(pool.playerVersionIds).size).toBe(20);
      for (const selection of pool.selections) {
        expect(pool.playerVersionIds).toContain(selection);
      }
      expect(new Set(pool.selections).size).toBe(10);
      for (const id of pool.playerVersionIds) {
        expect(allPoolIds.has(id)).toBe(false);
        allPoolIds.add(id);
      }
    }
    expect(allPoolIds.size).toBe(29 * 20);
    // No exact version in two rosters either.
    const rosterIds = result.ownership.map((o) => o.playerVersionId);
    expect(new Set(rosterIds).size).toBe(300);
    expect(result.aiPools.length).toBe(29);
  });

  it('never places a human-owned version in an AI pool', () => {
    const human = humanRoster(CATALOG, 'lakers', '1990s');
    const result = generateAiLeague(soloInput(seedFromString('pools-human')));
    for (const pool of result.aiPools) {
      for (const id of pool.playerVersionIds) expect(human).not.toContain(id);
    }
  });

  it('gives contenders two qualifying anchors and playoffs one', () => {
    const result = generateAiLeague(soloInput(seedFromString('pools-anchors')));
    const byBand = new Map(result.aiPools.map((pool) => [pool.franchiseId, pool]));
    for (const assignment of result.aiAssignments) {
      if (assignment.franchiseId === 'lakers') continue;
      const pool = byBand.get(assignment.franchiseId);
      expect(pool).toBeDefined();
      if (pool === undefined) continue;
      const expected = assignment.band === 'contender' ? 2 : assignment.band === 'playoff' ? 1 : 0;
      expect(pool.anchors.length).toBeGreaterThanOrEqual(expected);
      for (const anchor of pool.anchors) {
        expect(anchor.percentileTier).toBe('elite');
        expect(anchor.roleScore).toBeGreaterThanOrEqual(anchor.percentileThreshold);
        expect(anchor.seedPath.length).toBeGreaterThan(0);
      }
    }
  });

  it('extra-elite frequency across a seeded cohort follows the packaged probabilities', () => {
    const expectedPerLeague = 4 * 0.65 + 8 * 0.35 + 10 * 0.2 + 7 * 0.08;
    const seeds = 24;
    let extraCount = 0;
    for (let i = 0; i < seeds; i += 1) {
      const result = generateAiLeague(soloInput(seasonDigestHex(`extra-${String(i)}`)));
      for (const pool of result.aiPools) {
        if (pool.anchors.some((anchor) => anchor.seedPath.includes('extra-elite'))) {
          extraCount += 1;
        }
      }
    }
    const expectedTotal = expectedPerLeague * seeds;
    // Generous bounds: between 40% and 160% of the expected count.
    expect(extraCount).toBeGreaterThan(expectedTotal * 0.4);
    expect(extraCount).toBeLessThan(expectedTotal * 1.6);
  });
});

describe('v2 roster legality', () => {
  it('every selected roster passes every legality contract', () => {
    const result = generateAiLeague(soloInput(seedFromString('legality')));
    for (const roster of result.rosters) {
      const members = membersOf(result, roster.franchiseId, CATALOG);
      expect(validateSeasonRoster(members)).toEqual([]);
      expect(completionTargetsMet(members)).toBe(true);
      expect(legalFiveAfterAnyRemoval(members)).toBe(true);
      const rotation = buildMinimalRotation({ franchiseId: roster.franchiseId, members });
      const playable = new Map(
        members.map((member) => [
          member.playerVersionId,
          CATALOG.candidates.find((c) => c.playerVersionId === member.playerVersionId)?.positions
            .playable ?? [],
        ]),
      );
      expect(validateSeasonRotation(rotation, playable)).toEqual([]);
      const minutes = rotation.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0);
      expect(minutes).toBe(240);
    }
    const rotation = result.rotations[0];
    if (rotation === undefined) throw new Error('no rotations');
    expect(rotation.targetMinutes.length).toBe(10);
  });

  it('every pool admits a legal ten (4/4/3 completion and a legal five)', () => {
    const result = generateAiLeague(soloInput(seedFromString('legality-pools')));
    for (const pool of result.aiPools) {
      const members = pool.playerVersionIds.map((id) => {
        const candidate = CATALOG.candidates.find((c) => c.playerVersionId === id);
        if (!candidate) throw new Error('unknown pool member');
        return { playerVersionId: id, playable: candidate.positions.playable };
      });
      const masks = new Array<number>(8).fill(0);
      for (const member of members) {
        let mask = 0;
        for (const position of member.playable) {
          if (position === 'PG' || position === 'SG') mask |= 1;
          else if (position === 'SF' || position === 'PF') mask |= 2;
          else mask |= 4;
        }
        if (mask !== 0) masks[mask] = (masks[mask] ?? 0) + 1;
      }
      const counts = rosterGroupCounts(members);
      expect(rosterFeasibleFromCounts({ guards: 0, forwards: 0, centers: 0 }, masks, 10)).toBe(
        true,
      );
      expect(fiveReachableFromCounts({ guards: 0, forwards: 0, centers: 0 }, masks, 10)).toBe(true);
      expect(counts.guards + counts.forwards + counts.centers).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('v2 determinism', () => {
  it('is rerun-identical for pools, selections, repairs, and diagnostics', () => {
    const a = generateAiLeague(soloInput(seedFromString('rerun')));
    const b = generateAiLeague(soloInput(seedFromString('rerun')));
    expect(JSON.stringify(a.aiPools)).toBe(JSON.stringify(b.aiPools));
    expect(JSON.stringify(a.diagnostics)).toBe(JSON.stringify(b.diagnostics));
    expect(a.digest).toBe(b.digest);
  });

  it('is invariant to league and candidate input-array order', () => {
    const reversedCatalog: SeasonDraftCatalog = {
      ...CATALOG,
      candidates: [...CATALOG.candidates].reverse(),
      pools: [...CATALOG.pools].reverse(),
    };
    const reversedLeague = {
      ...LEAGUE,
      teams: [...LEAGUE.teams].reverse(),
    };
    // The human roster is fixed across both inputs: it is derived from the
    // original catalog so the two generations only differ in array order.
    const human = humanRoster(CATALOG, 'lakers', '1990s');
    const a = generateAiLeague(soloInput(seedFromString('order-invariance')));
    const b = generateAiLeague({
      ...soloInput(seedFromString('order-invariance'), reversedCatalog, reversedLeague),
      humanRosters: [{ franchiseId: 'lakers', playerVersionIds: human }],
    });
    expect(a.digest).toBe(b.digest);
    expect(canonicalFacts(a)).toBe(canonicalFacts(b));
  });

  it('produces meaningful variation across seeds', () => {
    const first = generateAiLeague(soloInput(seedFromString('variation-1')));
    const second = generateAiLeague(soloInput(seedFromString('variation-2')));
    const byTeam = (result: SeasonLeagueGenerationResult) =>
      new Map(result.aiPools.map((pool) => [pool.franchiseId, new Set(pool.playerVersionIds)]));
    const mapA = byTeam(first);
    const mapB = byTeam(second);
    let differs = 0;
    for (const [teamId, setA] of mapA) {
      const setB = mapB.get(teamId);
      if (setB === undefined) continue;
      let shared = 0;
      for (const id of setA) if (setB.has(id)) shared += 1;
      if (shared < 20) differs += 1;
    }
    // Meaningful variation: most teams receive different pool assignments.
    expect(differs).toBeGreaterThan(20);
  });
});

describe('v2 scarcity and failure', () => {
  it('fails typed with phase and allocation state when anchors are scarce', () => {
    // Only eight candidates are elite in any role; 16 guaranteed anchors
    // cannot be satisfied, so the anchor matching must fail without relaxing.
    const catalog = buildSeasonDraftCatalog({
      franchiseIds: ['lakers', 'celtics', 'bulls', 'warriors', 'heat', 'knicks', 'spurs', 'jazz'],
      eras: ['1980s', '1990s', '2000s', '2010s'],
      playersPerPool: 12,
    });
    const flat = (value: number) => ({
      insideScoring: value,
      closeShot: value,
      midrange: value,
      threePoint: value,
      freeThrow: value,
      ballHandling: value,
      passing: value,
      offensiveIq: value,
      offensiveRebound: value,
      defensiveRebound: value,
      perimeterDefense: value,
      interiorDefense: value,
      steal: value,
      block: value,
      defensiveIq: value,
      speed: value,
      strength: value,
      vertical: value,
    });
    catalog.candidates.forEach((candidate, index) => {
      const elite = index < 8;
      candidate.detailedRatings = flat(elite ? 98 : 25 + (index % 4) * 4);
    });
    let error: unknown = null;
    try {
      generateAiLeague(soloInput(seedFromString('anchors-scarce'), catalog));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SeasonAiGenerationError);
    if (!(error instanceof SeasonAiGenerationError)) throw error;
    expect(error.phase).toBe('anchors');
    expect(error.diagnostics.failedTeams.length).toBeGreaterThan(0);
    expect(error.diagnostics.unmetConstraints.length).toBeGreaterThan(0);
    expect(error.diagnostics.nodesVisited).toBeGreaterThan(0);
    expect(error.allocationState).toContain('"phase":"anchors"');
  });

  it('fails typed at pool fill when the catalog is too small (repair ladder, then exhaustion)', () => {
    const catalog = buildSeasonDraftCatalog({
      franchiseIds: ['lakers', 'celtics', 'bulls', 'warriors', 'heat', 'knicks', 'spurs', 'jazz'],
      eras: ['1980s', '1990s', '2000s', '2010s'],
      playersPerPool: 20,
    });
    // Only two center-capable candidates per pool: anchors can still match
    // (the ten-feasibility gate is satisfied team by team), but the
    // position-scarcity gate can never be satisfied league-wide, so the pool
    // filling must exhaust after the repair ladder.
    const keepC = new Set<string>();
    catalog.pools.forEach((pool) => {
      pool.playerVersionIds.forEach((versionId, i) => {
        if (i === 7 || i === 8) keepC.add(versionId);
      });
    });
    for (const candidate of catalog.candidates) {
      if (keepC.has(candidate.playerVersionId)) continue;
      candidate.positions.playable = [
        'PG',
        'SG',
        'SF',
        'PF',
      ] as SeasonDraftCandidate['positions']['playable'];
      candidate.positions.primary = 'PG';
      candidate.positions.secondary = [];
    }
    let error: unknown = null;
    try {
      generateAiLeague(soloInput(seedFromString('pool-scarce'), catalog));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SeasonAiGenerationError);
    if (!(error instanceof SeasonAiGenerationError)) throw error;
    expect(error.phase).toBe('pool-fill');
    expect(error.diagnostics.failedTeams.length).toBeGreaterThan(0);
    expect(error.diagnostics.backtracks).toBeGreaterThan(0);
    expect(error.allocationState).toContain('unassignedCount');
  });

  it('enforces the anchor node budget without relaxing rules', () => {
    const targets = buildTestTargets();
    const tight = {
      ...targets,
      policy: {
        ...targets.policy,
        nodeBudgets: { anchorMatching: 1, poolRepair: 40000, rosterSelection: 600000 },
      },
    } as unknown as SeasonRosterTargets;
    expect(() =>
      generateAiLeague({ ...soloInput(seedFromString('budget-anchors')), targets: tight }),
    ).toThrow(SeasonAiGenerationError);
    try {
      generateAiLeague({ ...soloInput(seedFromString('budget-anchors')), targets: tight });
      throw new Error('expected budget exhaustion');
    } catch (error) {
      if (!(error instanceof SeasonAiGenerationError)) throw error;
      expect(error.phase).toBe('anchors');
      expect(error.diagnostics.nodeBudget).toBe(1 + 40000 + 600000);
    }
  });

  it('enforces the pool-repair node budget without relaxing rules', () => {
    const targets = buildTestTargets();
    const tight = {
      ...targets,
      policy: {
        ...targets.policy,
        nodeBudgets: { anchorMatching: 20000, poolRepair: 1, rosterSelection: 600000 },
      },
    } as unknown as SeasonRosterTargets;
    expect(() =>
      generateAiLeague({ ...soloInput(seedFromString('budget-pool')), targets: tight }),
    ).toThrow(SeasonAiGenerationError);
  });

  it('rejects null or mismatched targets before any allocation', () => {
    expect(() =>
      generateAiLeague({
        ...soloInput(seedFromString('null-targets')),
        targets: undefined as unknown as SeasonRosterTargets,
      }),
    ).toThrow(SeasonAiTargetsError);
    expect(() => {
      validateSeasonRosterTargets(undefined as unknown as SeasonRosterTargets);
    }).toThrow(SeasonAiTargetsError);
  });
});

/** All-zero role scores helper. */
function zeroScores(): Record<(typeof ROSTER_ROLES)[number], number> {
  const scores = {} as Record<(typeof ROSTER_ROLES)[number], number>;
  for (const role of ROSTER_ROLES) scores[role] = 0;
  return scores;
}
