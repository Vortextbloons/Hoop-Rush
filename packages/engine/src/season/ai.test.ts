import { describe, expect, it } from 'vitest';
import {
  SEASON_AI_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  seasonLeagueGenerationResultSchema,
  seasonRosterCalibrationRunSchema,
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
  assignAiBandsAndIdentities,
  evaluateSeasonRoster,
  generateAiLeague,
  runSeasonRosterCalibrationSeeds,
  validateSeasonRosterTargets,
} from './ai.ts';
import { ROSTER_ROLES } from './ai-scoring.ts';
import {
  completionTargetsMet,
  validateSeasonRoster,
  type SeasonRosterMemberInput,
} from './roster-rules.ts';
import { rotationTargetMinutes } from './rotation.ts';
import { seasonDigestHex } from '@hoop-rush/data-contracts';

/**
 * Season Run M2.4 AI generation tests (season-ai-v2, roster-generation-v2):
 * identity and band quotas, anchor guarantees, exclusive 20-member private
 * pools, legal ten-player rosters and rotations, determinism, human-roster
 * preservation, band ordering, scoring identity differentiation (Overall has
 * no effect), calibration runs, and bounded failure with typed diagnostics.
 */

/** The eight roles in canonical order (ROSTER_ROLES export). */
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
void LEAGUE;

/** Ten versions from one pool covering G4 F4 C3 with a legal five. */
function humanRoster(catalog: SeasonDraftCatalog, franchiseId: string, eraId: string): string[] {
  const pool = catalog.candidates.filter((c) => c.franchiseId === franchiseId && c.eraId === eraId);
  if (pool.length < 20) throw new Error('pool too small for a human roster');
  const indices = [0, 1, 2, 3, 4, 5, 7, 8, 10, 17];
  const picks = indices
    .map((i) => pool[i])
    .filter((c): c is SeasonDraftCandidate => c !== undefined);
  if (picks.length !== 10) throw new Error('human roster incomplete');
  return picks.map((c) => c.playerVersionId);
}

function soloInput(seed: string, humanFranchiseId = 'lakers') {
  return {
    seed,
    catalog: CATALOG,
    league: LEAGUE,
    humanFranchiseIds: [humanFranchiseId],
    humanRosters: [
      {
        franchiseId: humanFranchiseId,
        playerVersionIds: humanRoster(CATALOG, humanFranchiseId, '1990s'),
      },
    ],
    targets: buildTestTargets(),
  };
}

function membersOf(
  result: SeasonLeagueGenerationResult,
  franchiseId: string,
): SeasonRosterMemberInput[] {
  const roster = result.rosters.find((r) => r.franchiseId === franchiseId);
  if (!roster) throw new Error(`no roster for ${franchiseId}`);
  return roster.players.map((player) => {
    const candidate = CATALOG.candidates.find((c) => c.playerVersionId === player.playerVersionId);
    if (!candidate) throw new Error('roster references an unknown candidate');
    return { playerVersionId: player.playerVersionId, playable: candidate.positions.playable };
  });
}

describe('season AI targets validation', () => {
  it('accepts a matching v2 targets artifact', () => {
    expect(() => {
      validateSeasonRosterTargets(buildTestTargets());
    }).not.toThrow();
  });

  it('rejects mismatched targets versions before any allocation', () => {
    expect(() => {
      validateSeasonRosterTargets({
        ...buildTestTargets(),
        targetsVersion: 'roster-targets-v1',
      } as unknown as SeasonRosterTargets);
    }).toThrow(/mismatch/);
    expect(() => {
      validateSeasonRosterTargets({
        ...buildTestTargets(),
        calibration: {
          ...buildTestTargets().calibration,
          aiVersion: 'season-ai-v1',
        } as unknown as SeasonRosterTargets['calibration'],
      });
    }).toThrow(/mismatch/);
    expect(() => {
      validateSeasonRosterTargets({
        ...buildTestTargets(),
        calibration: {
          ...buildTestTargets().calibration,
          rosterGenerationVersion: 'roster-generation-v1',
        } as unknown as SeasonRosterTargets['calibration'],
      });
    }).toThrow(/mismatch/);
    expect(() => {
      generateAiLeague({
        ...soloInput(seedFromString('bad-targets')),
        targets: {
          ...buildTestTargets(),
          targetsVersion: 'roster-targets-v1',
        } as unknown as SeasonRosterTargets,
      });
    }).toThrow(SeasonAiTargetsError);
  });
});

describe('season AI band and identity assignment', () => {
  it('assigns solo quotas 4/8/10/7 with balanced identities', () => {
    const assignments = assignAiBandsAndIdentities({
      seed: seedFromString('bands'),
      league: LEAGUE,
      humanFranchiseIds: ['lakers'],
      targets: buildTestTargets(),
    });
    expect(assignments).toHaveLength(30);
    const ai = assignments.filter((a) => a.franchiseId !== 'lakers');
    expect(ai).toHaveLength(29);
    const bandCounts = {
      contender: ai.filter((a) => a.band === 'contender').length,
      playoff: ai.filter((a) => a.band === 'playoff').length,
      average: ai.filter((a) => a.band === 'average').length,
      weaker: ai.filter((a) => a.band === 'weaker').length,
    };
    expect(bandCounts).toEqual({ contender: 4, playoff: 8, average: 10, weaker: 7 });
    const identityCounts = new Map<string, number>();
    for (const a of ai) {
      identityCounts.set(a.identity, (identityCounts.get(a.identity) ?? 0) + 1);
    }
    expect(identityCounts.size).toBe(6);
    const counts = [...identityCounts.values()].sort((a, b) => a - b);
    expect((counts[5] ?? 0) - (counts[0] ?? 0)).toBeLessThanOrEqual(1);
    const human = assignments.find((a) => a.franchiseId === 'lakers');
    expect(human?.band).toBe('average');
    expect(human?.identity).toBe('continuity');
  });

  it('assigns duo quotas 4/8/9/7 preserving every band', () => {
    const assignments = assignAiBandsAndIdentities({
      seed: seedFromString('bands-duo'),
      league: LEAGUE,
      humanFranchiseIds: ['lakers', 'celtics'],
      targets: buildTestTargets(),
    });
    const ai = assignments.filter((a) => !['lakers', 'celtics'].includes(a.franchiseId));
    expect(ai).toHaveLength(28);
    const bandCounts = {
      contender: ai.filter((a) => a.band === 'contender').length,
      playoff: ai.filter((a) => a.band === 'playoff').length,
      average: ai.filter((a) => a.band === 'average').length,
      weaker: ai.filter((a) => a.band === 'weaker').length,
    };
    expect(bandCounts).toEqual({ contender: 4, playoff: 8, average: 9, weaker: 7 });
    const identityCounts = new Map<string, number>();
    for (const a of ai) identityCounts.set(a.identity, (identityCounts.get(a.identity) ?? 0) + 1);
    const counts = [...identityCounts.values()].sort((a, b) => a - b);
    expect((counts[5] ?? 0) - (counts[0] ?? 0)).toBeLessThanOrEqual(1);
  });

  it('rotates the smaller identity count with the seed', () => {
    const countsOf = (seed: string) => {
      const rows = assignAiBandsAndIdentities({
        seed,
        league: LEAGUE,
        humanFranchiseIds: ['lakers'],
        targets: buildTestTargets(),
      }).filter((a) => a.franchiseId !== 'lakers');
      const map = new Map<string, number>();
      for (const a of rows) map.set(a.identity, (map.get(a.identity) ?? 0) + 1);
      return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    };
    let different: [string, string] | null = null;
    for (let i = 0; i < 40 && different === null; i += 1) {
      const a = seedFromString(`rot-a-${String(i)}`);
      const b = seedFromString(`rot-b-${String(i)}`);
      if (JSON.stringify(countsOf(a)) !== JSON.stringify(countsOf(b))) {
        different = [a, b];
      }
    }
    expect(different).not.toBeNull();
    if (different === null) throw new Error('no differing offsets found');
  });
});

describe('season AI league generation', () => {
  it('generates a legal league with unique ownership and valid rotations', () => {
    const result = generateAiLeague(soloInput(seedFromString('gen-1')));
    expect(seasonLeagueGenerationResultSchema.parse(result)).toBeTruthy();
    expect(result.rosters).toHaveLength(30);
    expect(result.ownership).toHaveLength(300);
    expect(result.rotations).toHaveLength(30);
    expect(result.aiPools).toHaveLength(29);
    expect(new Set(result.ownership.map((o) => o.playerVersionId)).size).toBe(300);
    for (const roster of result.rosters) {
      const members = membersOf(result, roster.franchiseId);
      expect(validateSeasonRoster(members)).toEqual([]);
      expect(completionTargetsMet(members)).toBe(true);
    }
    for (const rotation of result.rotations) {
      expect(rotationTargetMinutes(rotation)).toBe(240);
      expect(rotation.closingFive).toEqual(rotation.starters);
    }
    for (const pool of result.aiPools) {
      expect(pool.playerVersionIds).toHaveLength(20);
      expect(new Set(pool.playerVersionIds).size).toBe(20);
      expect(pool.selections).toHaveLength(10);
    }
    expect(result.diagnostics.failedTeams).toEqual([]);
    expect(result.diagnostics.unmetConstraints).toEqual([]);
    expect(result.digest).toMatch(/^[0-9a-f]{32}$/);
  });

  it('covers all eight basketball roles on every roster', () => {
    const result = generateAiLeague(soloInput(seedFromString('gen-roles')));
    for (const evaluation of result.evaluations) {
      expect(evaluation.rolesCovered).toHaveLength(8);
    }
  });

  it('preserves human rosters and never duplicates a human version', () => {
    const human = humanRoster(CATALOG, 'lakers', '1990s');
    const result = generateAiLeague({
      seed: seedFromString('gen-human'),
      catalog: CATALOG,
      league: LEAGUE,
      humanFranchiseIds: ['lakers'],
      humanRosters: [{ franchiseId: 'lakers', playerVersionIds: human }],
      targets: buildTestTargets(),
    });
    const humanRosterRow = result.rosters.find((r) => r.franchiseId === 'lakers');
    expect(humanRosterRow?.players.map((p) => p.playerVersionId).sort()).toEqual([...human].sort());
    for (const pool of result.aiPools) {
      for (const versionId of pool.playerVersionIds) {
        expect(human).not.toContain(versionId);
      }
    }
    for (const roster of result.rosters.filter((r) => r.franchiseId !== 'lakers')) {
      for (const player of roster.players) {
        expect(human).not.toContain(player.playerVersionId);
      }
    }
  });

  it('is deterministic for the same seed and different for another seed', () => {
    const a = generateAiLeague(soloInput(seedFromString('det-a')));
    const b = generateAiLeague(soloInput(seedFromString('det-a')));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = generateAiLeague(soloInput(seedFromString('det-b')));
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it('orders band medians (contender > weaker) across seeds', () => {
    const seeds = ['order-1', 'order-2', 'order-3', 'order-4', 'order-5'];
    const scores = { contender: [] as number[], weaker: [] as number[] };
    for (const s of seeds) {
      const result = generateAiLeague(soloInput(seedFromString(s)));
      for (const evaluation of result.evaluations) {
        if (evaluation.franchiseId === 'lakers') continue;
        if (evaluation.band === 'contender') scores.contender.push(evaluation.strengthScore);
        if (evaluation.band === 'weaker') scores.weaker.push(evaluation.strengthScore);
      }
    }
    const median = (values: number[]) => {
      const sorted = [...values].sort((x, y) => x - y);
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    };
    expect(median(scores.contender)).toBeGreaterThan(median(scores.weaker));
  });

  it('generates a duo league with two preserved human rosters', () => {
    const lakersHuman = humanRoster(CATALOG, 'lakers', '1990s');
    const celticsHuman = humanRoster(CATALOG, 'celtics', '1990s');
    const result = generateAiLeague({
      seed: seedFromString('duo-gen'),
      catalog: CATALOG,
      league: LEAGUE,
      humanFranchiseIds: ['lakers', 'celtics'],
      humanRosters: [
        { franchiseId: 'lakers', playerVersionIds: lakersHuman },
        { franchiseId: 'celtics', playerVersionIds: celticsHuman },
      ],
      targets: buildTestTargets(),
    });
    expect(result.rosters.find((r) => r.franchiseId === 'lakers')?.players).toHaveLength(10);
    expect(result.rosters.find((r) => r.franchiseId === 'celtics')?.players).toHaveLength(10);
    expect(result.aiPools).toHaveLength(28);
    const ai = result.aiAssignments.filter((a) => !['lakers', 'celtics'].includes(a.franchiseId));
    expect(ai.filter((a) => a.band === 'average')).toHaveLength(9);
  });

  it('handles scarce centers deterministically (exactly enough C coverage)', () => {
    const catalog = buildSeasonDraftCatalog({
      franchiseIds: ['lakers', 'celtics', 'bulls', 'warriors', 'heat', 'knicks', 'spurs', 'jazz'],
      eras: ['1980s', '1990s', '2000s', '2010s'],
      playersPerPool: 20,
    });
    const keepC = new Set<string>();
    catalog.pools.forEach((pool) => {
      pool.playerVersionIds.forEach((versionId, i) => {
        if (i === 7 || i === 8 || i === 13 || i === 17 || i === 18) keepC.add(versionId);
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
    expect(keepC.size).toBeGreaterThan(29 * 3);
    const result = generateAiLeague({
      ...soloInput(seedFromString('scarce'), 'lakers'),
      catalog,
    });
    const modifiedMembers = (res: SeasonLeagueGenerationResult, franchiseId: string) => {
      const roster = res.rosters.find((r) => r.franchiseId === franchiseId);
      if (!roster) throw new Error(`no roster for ${franchiseId}`);
      return roster.players.map((player) => {
        const candidate = catalog.candidates.find(
          (c) => c.playerVersionId === player.playerVersionId,
        );
        if (!candidate) throw new Error('roster references an unknown candidate');
        return { playerVersionId: player.playerVersionId, playable: candidate.positions.playable };
      });
    };
    for (const roster of result.rosters) {
      if (roster.franchiseId === 'lakers') continue;
      const members = modifiedMembers(result, roster.franchiseId);
      expect(completionTargetsMet(members)).toBe(true);
      expect(validateSeasonRoster(members)).toEqual([]);
    }
  });
});

describe('season AI evaluation', () => {
  it('differentiates identities on the same roster', () => {
    const defensive = [
      {
        detailedRatings: {
          insideScoring: 60,
          closeShot: 60,
          midrange: 60,
          threePoint: 60,
          freeThrow: 60,
          ballHandling: 55,
          passing: 55,
          offensiveIq: 55,
          offensiveRebound: 60,
          defensiveRebound: 70,
          perimeterDefense: 88,
          interiorDefense: 88,
          steal: 80,
          block: 80,
          defensiveIq: 85,
          speed: 70,
          strength: 70,
          vertical: 70,
        },
        tendencies: {
          usageRate: 15,
          passRate: 20,
          shotRate: 20,
          driveRate: 10,
          postUpRate: 10,
          rimFrequency: 30,
          shortMidFrequency: 20,
          longMidFrequency: 15,
          cornerThreeFrequency: 5,
          aboveBreakThreeFrequency: 10,
          threePointRate: 15,
          freeThrowRate: 15,
          turnoverRate: 12,
          isolationRate: 5,
          pickAndRollBallHandlerRate: 10,
          pickAndRollRollManRate: 20,
          spotUpRate: 15,
          transitionRate: 15,
          cutRate: 10,
          foulRate: 3,
          stealAttemptRate: 20,
          blockAttemptRate: 25,
          crashOffensiveGlassRate: 10,
        },
        overall: 70,
      },
    ];
    const defenseFirst = evaluateSeasonRoster({
      franchiseId: 'x',
      band: 'average',
      identity: 'defense-first',
      members: defensive,
    });
    const starChaser = evaluateSeasonRoster({
      franchiseId: 'x',
      band: 'average',
      identity: 'star-chaser',
      members: defensive,
    });
    expect(defenseFirst.strengthScore).toBeGreaterThan(starChaser.strengthScore);
    expect(defenseFirst.rolesCovered).toContain('interior-defense');
  });

  it('ignores Overall for scoring (report-only)', () => {
    const base = {
      detailedRatings: {
        insideScoring: 70,
        closeShot: 68,
        midrange: 66,
        threePoint: 62,
        freeThrow: 74,
        ballHandling: 70,
        passing: 70,
        offensiveIq: 70,
        offensiveRebound: 60,
        defensiveRebound: 65,
        perimeterDefense: 62,
        interiorDefense: 62,
        steal: 60,
        block: 60,
        defensiveIq: 62,
        speed: 70,
        strength: 65,
        vertical: 66,
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
    };
    const low = evaluateSeasonRoster({
      franchiseId: 'x',
      band: 'average',
      identity: 'continuity',
      members: [{ ...base, overall: 40 }],
    });
    const high = evaluateSeasonRoster({
      franchiseId: 'x',
      band: 'average',
      identity: 'continuity',
      members: [{ ...base, overall: 99 }],
    });
    expect(low.strengthScore).toBe(high.strengthScore);
    expect(high.overallReport).toBe(99);
  });
});

describe('season AI bounded failure and calibration', () => {
  it('returns GENERATION_EXHAUSTED with diagnostics instead of relaxing rules', () => {
    // No center-capable candidate anywhere: 30 rosters cannot meet the
    // completion target; the generator must fail typed with diagnostics.
    const catalog = buildSeasonDraftCatalog({
      franchiseIds: ['lakers', 'celtics', 'bulls', 'warriors', 'heat', 'knicks', 'spurs', 'jazz'],
      eras: ['1980s', '1990s', '2000s', '2010s'],
      playersPerPool: 20,
    });
    for (const candidate of catalog.candidates) {
      candidate.positions.playable = [
        'PG',
        'SG',
        'SF',
        'PF',
      ] as SeasonDraftCandidate['positions']['playable'];
      candidate.positions.primary = 'PG';
      candidate.positions.secondary = [];
    }
    const modifiedCatalog: SeasonDraftCatalog = {
      ...catalog,
      candidates: catalog.candidates.map((c) => ({
        ...c,
        positions: { ...c.positions, playable: [...c.positions.playable] },
      })),
    };
    for (const candidate of modifiedCatalog.candidates) {
      candidate.positions.playable = [
        'PG',
        'SG',
        'SF',
        'PF',
      ] as SeasonDraftCandidate['positions']['playable'];
      candidate.positions.primary = 'PG';
      candidate.positions.secondary = [];
    }
    expect(() =>
      generateAiLeague({
        ...soloInput(seedFromString('exhausted'), 'lakers'),
        catalog: modifiedCatalog,
      }),
    ).toThrow(SeasonAiGenerationError);
    try {
      generateAiLeague({
        ...soloInput(seedFromString('exhausted'), 'lakers'),
        catalog: modifiedCatalog,
      });
      throw new Error('expected exhaustion');
    } catch (error) {
      if (!(error instanceof SeasonAiGenerationError)) throw error;
      expect(error.code).toBe('GENERATION_EXHAUSTED');
      expect(error.diagnostics.failedTeams.length).toBeGreaterThan(0);
      expect(error.diagnostics.unmetConstraints.length).toBeGreaterThan(0);
      expect(error.diagnostics.nodeBudget).toBeGreaterThan(0);
      expect(error.diagnostics.seed).toBe(seedFromString('exhausted'));
    }
  });

  it('runs calibration seeds in order with valid rows', () => {
    const seeds = [seedFromString('cal-1'), seedFromString('cal-2'), seedFromString('cal-3')];
    const runs = runSeasonRosterCalibrationSeeds({
      seeds,
      catalog: CATALOG,
      league: LEAGUE,
      humanRosters: [
        { franchiseId: 'lakers', playerVersionIds: humanRoster(CATALOG, 'lakers', '1990s') },
      ],
      targets: buildTestTargets(),
    });
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.seed)).toEqual(seeds);
    for (const run of runs) {
      expect(seasonRosterCalibrationRunSchema.parse(run)).toBeTruthy();
      expect(run.failed).toBe(false);
      expect(run.teams).toHaveLength(30);
      expect(run.diagnostics).toBeNull();
      expect(run.pools).toHaveLength(29);
      for (const pool of run.pools ?? []) {
        expect(pool.playerVersionIds).toHaveLength(20);
      }
      expect(run.poolFacts).toHaveLength(29);
      for (const pool of run.poolFacts) {
        expect(pool.anchorCount).toBeGreaterThanOrEqual(0);
        expect(pool.extraEliteFlags).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('season AI property coverage', () => {
  it('never crashes on random seeds over the fixture catalog', () => {
    const seeds = Array.from({ length: 8 }, (_, i) => seasonDigestHex(`prop-${String(i)}`));
    for (const seed of seeds) {
      const result = generateAiLeague(soloInput(seed));
      expect(result.rosters).toHaveLength(30);
      expect(new Set(result.ownership.map((o) => o.playerVersionId)).size).toBe(300);
    }
  });
});
