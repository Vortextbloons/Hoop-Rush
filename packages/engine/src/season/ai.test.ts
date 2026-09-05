import { describe, expect, it } from 'vitest';
import {
  seasonLeagueGenerationResultSchema,
  seasonRosterCalibrationRunSchema,
  seedSchema,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonLeague,
  type SeasonLeagueGenerationResult,
} from '@hoop-rush/data-contracts';
import { buildSeasonDraftCatalog, seedFromString } from '@hoop-rush/test-fixtures';
import {
  SeasonAiGenerationError,
  assignAiBandsAndIdentities,
  evaluateSeasonRoster,
  generateAiLeague,
  runSeasonRosterCalibrationSeeds,
} from './ai.ts';
import { completionTargetsMet, validateSeasonRoster } from './roster-rules.ts';
import { rotationTargetMinutes } from './rotation.ts';
import {
  buildTestTargets,
  CATALOG,
  humanRoster,
  LEAGUE,
  membersOf,
  soloInput,
} from './ai-test-support.ts';
function brandedSolo(
  seed: string,
  catalog: SeasonDraftCatalog = CATALOG,
  league: SeasonLeague = LEAGUE,
  humanFranchiseId = 'lakers',
) {
  const base = soloInput(seed, catalog, league, humanFranchiseId);
  return { ...base, seed: seedSchema.parse(base.seed) };
}
describe('season AI band and identity assignment', () => {
  it('assigns solo quotas 4/8/10/7 with balanced identities', () => {
    const assignments = assignAiBandsAndIdentities({
      seed: seedSchema.parse(seedFromString('bands')),
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
      seed: seedSchema.parse(seedFromString('bands-duo')),
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
        seed: seedSchema.parse(seed),
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
    const result = generateAiLeague(brandedSolo(seedFromString('gen-1')));
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
    const result = generateAiLeague(brandedSolo(seedFromString('gen-roles')));
    for (const evaluation of result.evaluations) {
      expect(evaluation.rolesCovered).toHaveLength(8);
    }
  });
  it('preserves human rosters and never duplicates a human version', () => {
    const human = humanRoster(CATALOG, 'lakers', '1990s');
    const result = generateAiLeague({
      seed: seedSchema.parse(seedFromString('gen-human')),
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
  it('allows a human roster to hold two versions of the same person', () => {
    const catalog = structuredClone(CATALOG);
    const human = humanRoster(catalog, 'lakers', '1990s');
    const firstVersion = human[0];
    const secondVersion = human[1];
    if (firstVersion === undefined || secondVersion === undefined) {
      throw new Error('human roster needs two versions');
    }
    const first = catalog.candidates.find((c) => c.playerVersionId === firstVersion);
    const second = catalog.candidates.find((c) => c.playerVersionId === secondVersion);
    if (first === undefined || second === undefined) throw new Error('candidates missing');
    second.playerId = first.playerId;
    const result = generateAiLeague({
      seed: seedSchema.parse(seedFromString('same-person-human')),
      catalog,
      league: LEAGUE,
      humanFranchiseIds: ['lakers'],
      humanRosters: [{ franchiseId: 'lakers', playerVersionIds: human }],
      targets: buildTestTargets(),
    });
    const humanRow = result.rosters.find((r) => r.franchiseId === 'lakers');
    expect(humanRow?.players.map((p) => p.playerVersionId).sort()).toEqual([...human].sort());
    const humanIdentities = humanRow?.players.map((p) => p.playerId) ?? [];
    expect(new Set(humanIdentities).size).toBe(humanIdentities.length - 1);
    for (const roster of result.rosters.filter((r) => r.franchiseId !== 'lakers')) {
      expect(roster.players.some((p) => p.playerId === first.playerId)).toBe(false);
      const identities = roster.players.map((p) => p.playerId);
      expect(new Set(identities).size).toBe(identities.length);
    }
  });
  it('orders band medians (contender > weaker) across seeds', () => {
    const seeds = ['order-1', 'order-2', 'order-3', 'order-4', 'order-5'];
    const scores = { contender: [] as number[], weaker: [] as number[] };
    for (const s of seeds) {
      const result = generateAiLeague(brandedSolo(seedFromString(s)));
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
      seed: seedSchema.parse(seedFromString('duo-gen')),
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
      ...brandedSolo(seedFromString('scarce'), CATALOG, LEAGUE, 'lakers'),
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
    try {
      generateAiLeague({
        ...brandedSolo(seedFromString('exhausted'), CATALOG, LEAGUE, 'lakers'),
        catalog,
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
    const seeds = [
      seedSchema.parse(seedFromString('cal-1')),
      seedSchema.parse(seedFromString('cal-2')),
      seedSchema.parse(seedFromString('cal-3')),
    ];
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
