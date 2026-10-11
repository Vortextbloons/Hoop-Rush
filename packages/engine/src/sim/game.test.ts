import { describe, expect, it } from 'vitest';
import type { SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import { playerIdSchema, seedSchema } from '@hoop-rush/data-contracts';
import {
  buildGameSimulationInput,
  buildLegalSimulationTeam,
  buildSimulationPlayer,
  buildStrongWeakFixture,
  buildStrongMediumFixture,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { checkGameResult, gameResultDigest } from './invariants.ts';
import { fnv1a32 } from './rng.ts';
import { simulateGame } from './game.ts';
import { createEngineContext } from './kernel.ts';
declare const process: {
  env: Record<string, string | undefined>;
};
const ctx = createEngineContext();
function run(seed: string) {
  const input = buildGameSimulationInput({ seed: seedSchema.parse(seedFromString(seed)) });
  return simulateGame(input, ctx);
}
describe('game determinism and golden replay', () => {
  it('is stable across identical inputs (golden digest)', () => {
    const result = run('golden-1');
    expect(fnv1a32(gameResultDigest(result))).toBe(GOLDEN_EQUAL_FIXTURE_V15_HASH);
  });
  it('is stable for the strong-vs-weak fixture (golden digest)', () => {
    const { strong, weak } = buildStrongWeakFixture();
    const input = buildGameSimulationInput({
      seed: seedSchema.parse(seedFromString('golden-svsw')),
      home: strong,
      away: weak,
    });
    expect(fnv1a32(gameResultDigest(simulateGame(input, ctx)))).toBe(GOLDEN_STRONG_WEAK_V15_HASH);
  });
  it('a mirror matchup (same player on both teams) keeps accounting separate', () => {
    const shared = buildSimulationPlayer({
      playerId: playerIdSchema.parse('p-mirror'),
      displayName: 'Mirror',
    });
    const home = buildLegalSimulationTeam({
      teamId: 'home',
      players: [shared, ...buildLegalSimulationTeam().players.slice(1)],
    });
    const away = buildLegalSimulationTeam({
      teamId: 'away',
      players: [shared, ...buildLegalSimulationTeam().players.slice(1)],
    });
    const input = buildGameSimulationInput({
      seed: seedSchema.parse(seedFromString('mirror-1')),
      home,
      away,
    });
    const result = simulateGame(input, ctx);
    const homeMirror = result.home.players.find((p) => p.playerId === 'p-mirror');
    const awayMirror = result.away.players.find((p) => p.playerId === 'p-mirror');
    if (homeMirror === undefined || awayMirror === undefined) {
      throw new Error('mirror players missing from box scores');
    }
    expect(homeMirror.points).toBeGreaterThanOrEqual(0);
    expect(awayMirror.points).toBeGreaterThanOrEqual(0);
    expect(homeMirror.turnovers).toBeGreaterThanOrEqual(0);
    expect(awayMirror.turnovers).toBeGreaterThanOrEqual(0);
    expect(checkGameResult(result)).toEqual([]);
  });
});
describe('game invariants over many seeds', () => {
  it('reports overtime facts on a golden overtime game', () => {
    let found: ReturnType<typeof run> | null = null;
    for (let i = 0; i < 100 && found === null; i += 1) {
      const candidate = run(`ot-v21-${String(i)}`);
      if (candidate.overtimePeriods > 0) found = candidate;
    }
    expect(found, 'expected an overtime game within 100 v21 seeds').not.toBeNull();
    if (found === null) throw new Error('no overtime game found');
    expect(found.overtimePeriods).toBeGreaterThan(0);
    expect(found.periodScores.home.length).toBe(4 + found.overtimePeriods);
    expect(checkGameResult(found)).toEqual([]);
    const otFact = found.facts.find((f) => f.kind === 'overtime');
    expect(otFact).toBeDefined();
    expect(otFact?.evidence.periods).toBe(found.overtimePeriods);
  });
});
describe.skipIf(process.env.HOOP_RUSH_PERF_STRICT !== '1')('game performance goal', () => {
  it('simulates a game well under the 10 ms desktop goal', () => {
    const input = buildGameSimulationInput({ seed: seedSchema.parse(seedFromString('perf-1')) });
    simulateGame(input, ctx);
    const samples: number[] = [];
    for (let i = 0; i < 100; i += 1) {
      // eslint-disable-next-line no-restricted-globals -- perf-gated timing probe only, never sim input
      const start = performance.now();
      simulateGame(input, ctx);
      // eslint-disable-next-line no-restricted-globals -- perf-gated timing probe only, never sim input
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[50];
    const p95 = samples[95];
    if (median === undefined || p95 === undefined) {
      throw new Error('expected 100 performance samples');
    }
    expect(median).toBeLessThan(10);
    expect(p95).toBeLessThan(25);
  });
});
function ratingFixture(ratings: Partial<SimulationPlayer['ratings']>): SimulationTeam {
  const slots: SimulationPlayer['positions'][] = [['PG'], ['SG'], ['SF'], ['PF'], ['C']];
  return buildLegalSimulationTeam({
    players: Array.from({ length: 5 }, (_, i) => {
      const positions = slots[i];
      if (positions === undefined) {
        throw new Error('fixture slots require five positions');
      }
      return buildSimulationPlayer({
        playerId: playerIdSchema.parse(`p-r-${String(i + 1)}`),
        positions,
        ratings: { ...buildSimulationPlayer().ratings, ...ratings },
      });
    }),
  });
}
describe('lineup strength across fixtures', () => {
  interface StrengthCase {
    label: string;
    buildHome: () => SimulationTeam;
    buildAway: () => SimulationTeam;
    seedPrefix: string;
    runs: number;
    assert: (homeWins: number, awayWins: number) => void;
  }
  const strengthCases: StrengthCase[] = [
    {
      label: 'a strong lineup beats a weak lineup decisively',
      buildHome: () => buildStrongWeakFixture().strong,
      buildAway: () => buildStrongWeakFixture().weak,
      seedPrefix: 'sw',
      runs: 200,
      assert: (homeWins, awayWins) => {
        expect(homeWins).toBeGreaterThan(awayWins * 2);
      },
    },
    {
      label: 'medium opponents beat weak opponents more often than not',
      buildHome: () =>
        buildLegalSimulationTeam({
          teamId: 'fixture-medium',
          players: buildStrongMediumFixture().medium.players,
        }),
      buildAway: () => ratingFixture({ insideScoring: 40, threePoint: 40, ballHandling: 40 }),
      seedPrefix: 'mm',
      runs: 150,
      assert: (homeWins) => {
        expect(homeWins).toBeGreaterThan(75);
      },
    },
  ];
  it.each(strengthCases)('$label', ({ buildHome, buildAway, seedPrefix, runs, assert }) => {
    const home = buildHome();
    const away = buildAway();
    let homeWins = 0;
    let awayWins = 0;
    for (let i = 0; i < runs; i += 1) {
      const input = buildGameSimulationInput({
        seed: seedSchema.parse(seedFromString(`${seedPrefix}-${String(i)}`)),
        home,
        away,
      });
      const result = simulateGame(input, ctx);
      if (result.winner === 'home') homeWins += 1;
      else awayWins += 1;
    }
    assert(homeWins, awayWins);
  });
});
const GOLDEN_EQUAL_FIXTURE_V15_HASH = 1556887179;
const GOLDEN_STRONG_WEAK_V15_HASH = 1704936435;
const GOLDEN_EQUAL_FIXTURE =
  '{"schemaVersion":1,"gameNumber":1,"seed":"45ca740e45ca740e45ca740e45ca740e","engineVersion":"m3-engine-v24","dataVersion":"data-v1","profileVersion":"m2-1990s-fixture-v1","home":{"teamId":"fixture-a","displayName":"Fixture A","box":{"teamId":"fixture-a","points":99,"fieldGoals":{"made":41,"attempted":83},"threes":{"made":6,"attempted":10},"freeThrows":{"made":11,"attempted":16},"rebounds":{"total":60,"offensive":11,"defensive":38,"team":11},"assists":24,"steals":1,"blocks":1,"turnovers":12,"fouls":21,"possessions":86,"shotClockViolations":0,"diagnostics":{"assistedFieldGoals":30,"unassistedFieldGoals":11,"reboundOpportunities":40,"contestedShots":89}},"players":[{"playerId":"p-fixture-1","minutes":48,"points":22,"fieldGoals":{"made":10,"attempted":18},"threes":{"made":0,"attempted":1},"freeThrows":{"made":2,"attempted":2},"rebounds":{"total":9,"offensive":1,"defensive":8},"assists":4,"steals":0,"blocks":1,"turnovers":2,"fouls":4,"diagnostics":{"usage":20.88,"shotZones":[{"zone":"rim","attempts":11,"makes":6},{"zone":"shortMid","attempts":4,"makes":3},{"zone":"longMid","attempts":2,"makes":1},{"zone":"cornerThree","attempts":0,"makes":0},{"zone":"aboveBreakThree","attempts":1,"makes":0}],"assistOpportunities":8,"offensiveReboundChances":40,"defensiveReboundChances":56,"contestedShots":24}},{"playerId":"p-fixture-2","minutes":48,"points":30,"fieldGoals":{"made":13,"attempted":23},"threes":{"made":1,"attempted":3},"freeThrows":{"made":3,"attempted":5},"rebounds":{"total":10,"offensive":4,"defensive":6},"assists":4,"steals":0,"blocks":0,"turnovers":0,"fouls":5,"diagnostics":{"usage":25.2,"shotZones":[{"zone":"rim","attempts":9,"makes":7},{"zone":"shortMid","attempts":5,"makes":1},{"zone":"longMid","attempts":6,"makes":4},{"zone":"cornerThree","attempts":3,"makes":1},{"zone":"aboveBreakThree","attempts":0,"makes":0}],"assistOpportunities":4,"offensiveReboundChances":40,"defensiveReboundChances":56,"contestedShots":12}},{"playerId":"p-fixture-3","minutes":48,"points":16,"fieldGoals":{"made":6,"attempted":13},"threes":{"made":2,"attempted":3},"freeThrows":{"made":2,"attempted":2},"rebounds":{"total":14,"offensive":3,"defensive":11},"assists":6,"steals":0,"blocks":0,"turnovers":3,"fouls":4,"diagnostics":{"usage":16.880000000000003,"shotZones":[{"zone":"rim","attempts":1,"makes":0},{"zone":"shortMid","attempts":4,"makes":1},{"zone":"longMid","attempts":5,"makes":3},{"zone":"cornerThree","attempts":2,"makes":2},{"zone":"aboveBreakThree","attempts":1,"makes":0}],"assistOpportunities":6,"offensiveReboundChances":40,"defensiveReboundChances":56,"contestedShots":13}},{"playerId":"p-fixture-4","minutes":48,"points":17,"fieldGoals":{"made":7,"attempted":17},"threes":{"made":2,"attempted":2},"freeThrows":{"made":1,"attempted":2},"rebounds":{"total":1,"offensive":0,"defensive":1},"assists":7,"steals":0,"blocks":0,"turnovers":5,"fouls":3,"diagnostics":{"usage":22.88,"shotZones":[{"zone":"rim","attempts":4,"makes":1},{"zone":"shortMid","attempts":2,"makes":0},{"zone":"longMid","attempts":9,"makes":4},{"zone":"cornerThree","attempts":2,"makes":2},{"zone":"aboveBreakThree","attempts":0,"makes":0}],"assistOpportunities":9,"offensiveReboundChances":40,"defensiveReboundChances":56,"contestedShots":11}},{"playerId":"p-fixture-5","minutes":48,"points":14,"fieldGoals":{"made":5,"attempted":12},"threes":{"made":1,"attempted":1},"freeThrows":{"made":3,"attempted":5},"rebounds":{"total":15,"offensive":3,"defensive":12},"assists":3,"steals":1,"blocks":0,"turnovers":2,"fouls":5,"diagnostics":{"usage":16.2,"shotZones":[{"zone":"rim","attempts":7,"makes":4},{"zone":"shortMid","attempts":1,"makes":0},{"zone":"longMid","attempts":3,"makes":0},{"zone":"cornerThree","attempts":0,"makes":0},{"zone":"aboveBreakThree","attempts":1,"makes":1}],"assistOpportunities":3,"offensiveReboundChances":40,"defensiveReboundChances":56,"contestedShots":29}}],"shotZones":[{"zone":"rim","attempts":32,"makes":18},{"zone":"shortMid","attempts":16,"makes":5},{"zone":"longMid","attempts":25,"makes":12},{"zone":"cornerThree","attempts":7,"makes":5},{"zone":"aboveBreakThree","attempts":3,"makes":1}]},"away":{"teamId":"fixture-b","displayName":"Fixture B","box":{"teamId":"fixture-b","points":82,"fieldGoals":{"made":31,"attempted":89},"threes":{"made":8,"attempted":15},"freeThrows":{"made":12,"attempted":21},"rebounds":{"total":54,"offensive":18,"defensive":29,"team":7},"assists":22,"steals":2,"blocks":5,"turnovers":11,"fouls":19,"possessions":85,"shotClockViolations":0,"diagnostics":{"assistedFieldGoals":24,"unassistedFieldGoals":7,"reboundOpportunities":56,"contestedShots":83}},"players":[{"playerId":"p-fixture-1","minutes":48,"points":12,"fieldGoals":{"made":4,"attempted":12},"threes":{"made":3,"attempted":3},"freeThrows":{"made":1,"attempted":1},"rebounds":{"total":11,"offensive":5,"defensive":6},"assists":7,"steals":1,"blocks":0,"turnovers":4,"fouls":3,"diagnostics":{"usage":16.439999999999998,"shotZones":[{"zone":"rim","attempts":2,"makes":1},{"zone":"shortMid","attempts":6,"makes":0},{"zone":"longMid","attempts":1,"makes":0},{"zone":"cornerThree","attempts":1,"makes":1},{"zone":"aboveBreakThree","attempts":2,"makes":2}],"assistOpportunities":8,"offensiveReboundChances":56,"defensiveReboundChances":40,"contestedShots":14}},{"playerId":"p-fixture-2","minutes":48,"points":20,"fieldGoals":{"made":7,"attempted":22},"threes":{"made":3,"attempted":4},"freeThrows":{"made":3,"attempted":4},"rebounds":{"total":7,"offensive":2,"defensive":5},"assists":5,"steals":0,"blocks":2,"turnovers":1,"fouls":4,"diagnostics":{"usage":24.76,"shotZones":[{"zone":"rim","attempts":8,"makes":3},{"zone":"shortMid","attempts":5,"makes":0},{"zone":"longMid","attempts":5,"makes":1},{"zone":"cornerThree","attempts":0,"makes":0},{"zone":"aboveBreakThree","attempts":4,"makes":3}],"assistOpportunities":6,"offensiveReboundChances":56,"defensiveReboundChances":40,"contestedShots":10}},{"playerId":"p-fixture-3","minutes":48,"points":14,"fieldGoals":{"made":6,"attempted":18},"threes":{"made":1,"attempted":5},"freeThrows":{"made":1,"attempted":4},"rebounds":{"total":9,"offensive":4,"defensive":5},"assists":1,"steals":0,"blocks":1,"turnovers":0,"fouls":5,"diagnostics":{"usage":19.76,"shotZones":[{"zone":"rim","attempts":5,"makes":2},{"zone":"shortMid","attempts":5,"makes":1},{"zone":"longMid","attempts":3,"makes":2},{"zone":"cornerThree","attempts":3,"makes":0},{"zone":"aboveBreakThree","attempts":2,"makes":1}],"assistOpportunities":1,"offensiveReboundChances":56,"defensiveReboundChances":40,"contestedShots":24}},{"playerId":"p-fixture-4","minutes":48,"points":14,"fieldGoals":{"made":6,"attempted":16},"threes":{"made":1,"attempted":2},"freeThrows":{"made":1,"attempted":2},"rebounds":{"total":10,"offensive":3,"defensive":7},"assists":8,"steals":1,"blocks":0,"turnovers":4,"fouls":2,"diagnostics":{"usage":20.88,"shotZones":[{"zone":"rim","attempts":7,"makes":4},{"zone":"shortMid","attempts":4,"makes":0},{"zone":"longMid","attempts":3,"makes":1},{"zone":"cornerThree","attempts":2,"makes":1},{"zone":"aboveBreakThree","attempts":0,"makes":0}],"assistOpportunities":8,"offensiveReboundChances":56,"defensiveReboundChances":40,"contestedShots":7}},{"playerId":"p-fixture-5","minutes":48,"points":22,"fieldGoals":{"made":8,"attempted":21},"threes":{"made":0,"attempted":1},"freeThrows":{"made":6,"attempted":10},"rebounds":{"total":10,"offensive":4,"defensive":6},"assists":1,"steals":0,"blocks":2,"turnovers":2,"fouls":5,"diagnostics":{"usage":27.4,"shotZones":[{"zone":"rim","attempts":4,"makes":4},{"zone":"shortMid","attempts":7,"makes":3},{"zone":"longMid","attempts":9,"makes":1},{"zone":"cornerThree","attempts":0,"makes":0},{"zone":"aboveBreakThree","attempts":1,"makes":0}],"assistOpportunities":1,"offensiveReboundChances":56,"defensiveReboundChances":40,"contestedShots":28}}],"shotZones":[{"zone":"rim","attempts":26,"makes":14},{"zone":"shortMid","attempts":27,"makes":4},{"zone":"longMid","attempts":21,"makes":5},{"zone":"cornerThree","attempts":6,"makes":2},{"zone":"aboveBreakThree","attempts":9,"makes":6}]},"periodScores":{"home":[18,31,27,23],"away":[18,18,18,28]},"winner":"home","overtimePeriods":0,"facts":[{"kind":"shotEfficiency","teamId":"fixture-a","magnitude":13.686205496141874,"evidence":{"efgPct":0.5301204819277109,"opponentEfgPct":0.39325842696629215,"efgDiff":0.13686205496141873,"madeFieldGoals":41,"attemptedFieldGoals":83},"playerIds":[]}]}';
const GOLDEN_STRONG_WEAK =
  '{"schemaVersion":1,"gameNumber":1,"seed":"ad339e54ad339e54ad339e54ad339e54","engineVersion":"m3-engine-v24","dataVersion":"data-v1","profileVersion":"m2-1990s-fixture-v1","home":{"teamId":"fixture-strong","displayName":"Fixture Strong","box":{"teamId":"fixture-strong","points":141,"fieldGoals":{"made":56,"attempted":90},"threes":{"made":7,"attempted":13},"freeThrows":{"made":22,"attempted":23},"rebounds":{"total":58,"offensive":15,"defensive":38,"team":5},"assists":48,"steals":3,"blocks":6,"turnovers":7,"fouls":13,"possessions":86,"shotClockViolations":0,"diagnostics":{"assistedFieldGoals":49,"unassistedFieldGoals":7,"reboundOpportunities":29,"contestedShots":81}},"players":[{"playerId":"p-fx-1","minutes":48,"points":38,"fieldGoals":{"made":16,"attempted":23},"threes":{"made":3,"attempted":4},"freeThrows":{"made":3,"attempted":3},"rebounds":{"total":8,"offensive":1,"defensive":7},"assists":6,"steals":1,"blocks":0,"turnovers":2,"fouls":2,"diagnostics":{"usage":26.32,"shotZones":[{"zone":"rim","attempts":13,"makes":9},{"zone":"shortMid","attempts":2,"makes":1},{"zone":"longMid","attempts":4,"makes":3},{"zone":"cornerThree","attempts":1,"makes":0},{"zone":"aboveBreakThree","attempts":3,"makes":3}],"assistOpportunities":6,"offensiveReboundChances":29,"defensiveReboundChances":50,"contestedShots":19}},{"playerId":"p-fx-2","minutes":48,"points":27,"fieldGoals":{"made":9,"attempted":18},"threes":{"made":2,"attempted":4},"freeThrows":{"made":7,"attempted":7},"rebounds":{"total":8,"offensive":0,"defensive":8},"assists":7,"steals":1,"blocks":1,"turnovers":1,"fouls":3,"diagnostics":{"usage":22.08,"shotZones":[{"zone":"rim","attempts":5,"makes":4},{"zone":"shortMid","attempts":6,"makes":1},{"zone":"longMid","attempts":3,"makes":2},{"zone":"cornerThree","attempts":0,"makes":0},{"zone":"aboveBreakThree","attempts":4,"makes":2}],"assistOpportunities":7,"offensiveReboundChances":29,"defensiveReboundChances":50,"contestedShots":12}},{"playerId":"p-fx-3","minutes":48,"points":31,"fieldGoals":{"made":13,"attempted":21},"threes":{"made":1,"attempted":3},"freeThrows":{"made":4,"attempted":4},"rebounds":{"total":14,"offensive":4,"defensive":10},"assists":11,"steals":0,"blocks":3,"turnovers":0,"fouls":1,"diagnostics":{"usage":22.76,"shotZones":[{"zone":"rim","attempts":10,"makes":7},{"zone":"shortMid","attempts":5,"makes":4},{"zone":"longMid","attempts":3,"makes":1},{"zone":"cornerThree","attempts":2,"makes":1},{"zone":"aboveBreakThree","attempts":1,"makes":0}],"assistOpportunities":11,"offensiveReboundChances":29,"defensiveReboundChances":50,"contestedShots":16}},{"playerId":"p-fx-4","minutes":48,"points":27,"fieldGoals":{"made":10,"attempted":17},"threes":{"made":1,"attempted":2},"freeThrows":{"made":6,"attempted":7},"rebounds":{"total":11,"offensive":6,"defensive":5},"assists":13,"steals":0,"blocks":0,"turnovers":2,"fouls":4,"diagnostics":{"usage":22.08,"shotZones":[{"zone":"rim","attempts":7,"makes":5},{"zone":"shortMid","attempts":3,"makes":2},{"zone":"longMid","attempts":5,"makes":2},{"zone":"cornerThree","attempts":1,"makes":1},{"zone":"aboveBreakThree","attempts":1,"makes":0}],"assistOpportunities":14,"offensiveReboundChances":29,"defensiveReboundChances":50,"contestedShots":17}},{"playerId":"p-fx-5","minutes":48,"points":18,"fieldGoals":{"made":8,"attempted":11},"threes":{"made":0,"attempted":0},"freeThrows":{"made":2,"attempted":2},"rebounds":{"total":12,"offensive":4,"defensive":8},"assists":11,"steals":1,"blocks":2,"turnovers":2,"fouls":3,"diagnostics":{"usage":13.88,"shotZones":[{"zone":"rim","attempts":6,"makes":5},{"zone":"shortMid","attempts":3,"makes":2},{"zone":"longMid","attempts":2,"makes":1},{"zone":"cornerThree","attempts":0,"makes":0},{"zone":"aboveBreakThree","attempts":0,"makes":0}],"assistOpportunities":11,"offensiveReboundChances":29,"defensiveReboundChances":50,"contestedShots":17}}],"shotZones":[{"zone":"rim","attempts":41,"makes":30},{"zone":"shortMid","attempts":19,"makes":10},{"zone":"longMid","attempts":17,"makes":9},{"zone":"cornerThree","attempts":4,"makes":2},{"zone":"aboveBreakThree","attempts":9,"makes":5}]},"away":{"teamId":"fixture-weak","displayName":"Fixture Weak","box":{"teamId":"fixture-weak","points":64,"fieldGoals":{"made":29,"attempted":81},"threes":{"made":1,"attempted":13},"freeThrows":{"made":5,"attempted":8},"rebounds":{"total":32,"offensive":12,"defensive":14,"team":6},"assists":9,"steals":2,"blocks":2,"turnovers":17,"fouls":24,"possessions":87,"shotClockViolations":0,"diagnostics":{"assistedFieldGoals":22,"unassistedFieldGoals":7,"reboundOpportunities":50,"contestedShots":90}},"players":[{"playerId":"p-fx-1","minutes":48,"points":22,"fieldGoals":{"made":9,"attempted":25},"threes":{"made":1,"attempted":3},"freeThrows":{"made":3,"attempted":4},"rebounds":{"total":5,"offensive":2,"defensive":3},"assists":1,"steals":0,"blocks":0,"turnovers":5,"fouls":5,"diagnostics":{"usage":31.76,"shotZones":[{"zone":"rim","attempts":9,"makes":5},{"zone":"shortMid","attempts":7,"makes":1},{"zone":"longMid","attempts":6,"makes":2},{"zone":"cornerThree","attempts":0,"makes":0},{"zone":"aboveBreakThree","attempts":3,"makes":1}],"assistOpportunities":3,"offensiveReboundChances":50,"defensiveReboundChances":29,"contestedShots":13}},{"playerId":"p-fx-2","minutes":48,"points":13,"fieldGoals":{"made":6,"attempted":16},"threes":{"made":0,"attempted":4},"freeThrows":{"made":1,"attempted":2},"rebounds":{"total":5,"offensive":3,"defensive":2},"assists":1,"steals":0,"blocks":1,"turnovers":4,"fouls":5,"diagnostics":{"usage":20.88,"shotZones":[{"zone":"rim","attempts":4,"makes":3},{"zone":"shortMid","attempts":5,"makes":1},{"zone":"longMid","attempts":3,"makes":2},{"zone":"cornerThree","attempts":1,"makes":0},{"zone":"aboveBreakThree","attempts":3,"makes":0}],"assistOpportunities":5,"offensiveReboundChances":50,"defensiveReboundChances":29,"contestedShots":13}},{"playerId":"p-fx-3","minutes":48,"points":8,"fieldGoals":{"made":4,"attempted":14},"threes":{"made":0,"attempted":1},"freeThrows":{"made":0,"attempted":0},"rebounds":{"total":8,"offensive":4,"defensive":4},"assists":4,"steals":2,"blocks":0,"turnovers":6,"fouls":5,"diagnostics":{"usage":20,"shotZones":[{"zone":"rim","attempts":6,"makes":1},{"zone":"shortMid","attempts":1,"makes":1},{"zone":"longMid","attempts":6,"makes":2},{"zone":"cornerThree","attempts":0,"makes":0},{"zone":"aboveBreakThree","attempts":1,"makes":0}],"assistOpportunities":8,"offensiveReboundChances":50,"defensiveReboundChances":29,"contestedShots":24}},{"playerId":"p-fx-4","minutes":48,"points":14,"fieldGoals":{"made":7,"attempted":14},"threes":{"made":0,"attempted":3},"freeThrows":{"made":0,"attempted":0},"rebounds":{"total":5,"offensive":3,"defensive":2},"assists":1,"steals":0,"blocks":1,"turnovers":2,"fouls":4,"diagnostics":{"usage":16,"shotZones":[{"zone":"rim","attempts":3,"makes":2},{"zone":"shortMid","attempts":5,"makes":3},{"zone":"longMid","attempts":3,"makes":2},{"zone":"cornerThree","attempts":2,"makes":0},{"zone":"aboveBreakThree","attempts":1,"makes":0}],"assistOpportunities":4,"offensiveReboundChances":50,"defensiveReboundChances":29,"contestedShots":22}},{"playerId":"p-fx-5","minutes":48,"points":7,"fieldGoals":{"made":3,"attempted":12},"threes":{"made":0,"attempted":2},"freeThrows":{"made":1,"attempted":2},"rebounds":{"total":3,"offensive":0,"defensive":3},"assists":2,"steals":0,"blocks":0,"turnovers":0,"fouls":5,"diagnostics":{"usage":12.88,"shotZones":[{"zone":"rim","attempts":4,"makes":2},{"zone":"shortMid","attempts":5,"makes":0},{"zone":"longMid","attempts":1,"makes":1},{"zone":"cornerThree","attempts":0,"makes":0},{"zone":"aboveBreakThree","attempts":2,"makes":0}],"assistOpportunities":2,"offensiveReboundChances":50,"defensiveReboundChances":29,"contestedShots":18}}],"shotZones":[{"zone":"rim","attempts":26,"makes":13},{"zone":"shortMid","attempts":23,"makes":6},{"zone":"longMid","attempts":19,"makes":9},{"zone":"cornerThree","attempts":3,"makes":0},{"zone":"aboveBreakThree","attempts":10,"makes":1}]},"periodScores":{"home":[36,40,37,28],"away":[11,20,19,14]},"winner":"home","overtimePeriods":0,"facts":[{"kind":"turnoverMargin","teamId":"fixture-strong","magnitude":10,"evidence":{"teamTurnovers":7,"opponentTurnovers":17,"margin":10},"playerIds":[]},{"kind":"shotEfficiency","teamId":"fixture-strong","magnitude":29.691358024691354,"evidence":{"efgPct":0.6611111111111111,"opponentEfgPct":0.36419753086419754,"efgDiff":0.29691358024691356,"madeFieldGoals":56,"attemptedFieldGoals":90},"playerIds":[]},{"kind":"offensiveRebounds","teamId":"fixture-strong","magnitude":3,"evidence":{"teamOffensiveRebounds":15,"opponentOffensiveRebounds":12,"margin":3},"playerIds":[]},{"kind":"freeThrows","teamId":"fixture-strong","magnitude":15,"evidence":{"teamFreeThrowAttempts":23,"teamFreeThrowMakes":22,"opponentFreeThrowAttempts":8,"margin":15},"playerIds":[]}]}';
void [GOLDEN_EQUAL_FIXTURE, GOLDEN_STRONG_WEAK];
