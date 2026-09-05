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
import { createEngineContext } from './context.ts';
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
    expect(fnv1a32(gameResultDigest(result))).toBe(GOLDEN_EQUAL_FIXTURE_V14_HASH);
  });
  it('is stable for the strong-vs-weak fixture (golden digest)', () => {
    const { strong, weak } = buildStrongWeakFixture();
    const input = buildGameSimulationInput({
      seed: seedSchema.parse(seedFromString('golden-svsw')),
      home: strong,
      away: weak,
    });
    expect(fnv1a32(gameResultDigest(simulateGame(input, ctx)))).toBe(GOLDEN_STRONG_WEAK_V14_HASH);
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
  it('reports overtime facts on the golden overtime game', () => {
    const found = run('ot-v14-30');
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
      const start = globalThis.performance.now();
      simulateGame(input, ctx);
      samples.push(globalThis.performance.now() - start);
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
const GOLDEN_EQUAL_FIXTURE_V14_HASH = 1861299245;
const GOLDEN_STRONG_WEAK_V14_HASH = 827787984;
const GOLDEN_EQUAL_FIXTURE =
  '{"seed":"45ca740e45ca740e45ca740e45ca740e","winner":"home","overtimePeriods":1,"homeScore":131,"awayScore":120,"periodScores":{"home":[30,22,26,33,20],"away":[17,30,22,42,9]},"homeBox":["54/94","8/15","15/20","18+32+5","31","2","0","14","24","95"],"awayBox":["50/100","7/21","13/16","16+20+7","33","2","1","9","28","95"],"homePlayers":[["p-fixture-1","53","32","13/23","2/3","4/6","0+12","10","1","0","3","5"],["p-fixture-2","53","24","9/18","1/2","5/8","6+1","5","0","0","0","5"],["p-fixture-3","53","20","8/16","1/3","3/3","3+6","5","0","0","3","4"],["p-fixture-4","53","13","6/13","0/2","1/1","5+4","7","0","0","5","5"],["p-fixture-5","53","42","18/24","4/5","2/2","4+9","4","1","0","3","5"]],"awayPlayers":[["p-fixture-1","53","25","9/17","3/4","4/4","3+4","5","0","0","3","8"],["p-fixture-2","53","26","12/21","1/4","1/1","2+6","4","0","0","0","5"],["p-fixture-3","53","13","6/23","0/7","1/2","3+5","6","0","1","2","3"],["p-fixture-4","53","25","11/20","1/2","2/3","3+3","11","0","0","0","5"],["p-fixture-5","53","31","12/19","2/4","5/6","5+2","7","2","0","4","7"]]}';
const GOLDEN_STRONG_WEAK =
  '{"seed":"ad339e54ad339e54ad339e54ad339e54","winner":"home","overtimePeriods":0,"homeScore":130,"awayScore":67,"periodScores":{"home":[31,38,32,29],"away":[11,19,22,15]},"homeBox":["54/86","9/13","13/13","9+41+2","43","6","8","11","6","88"],"awayBox":["29/89","7/19","2/2","17+19+4","13","3","0","17","22","89"],"homePlayers":[["p-fx-1","48","34","14/23","1/2","5/5","1+7","7","1","0","1","1"],["p-fx-2","48","31","12/17","3/5","4/4","4+6","6","3","2","2","2"],["p-fx-3","48","18","8/12","0/0","2/2","1+8","9","1","4","3","1"],["p-fx-4","48","28","12/20","3/3","1/1","0+14","11","1","1","1","2"],["p-fx-5","48","19","8/14","2/3","1/1","3+6","10","0","1","4","0"]],"awayPlayers":[["p-fx-1","48","22","10/27","2/3","0/0","1+5","3","0","0","3","6"],["p-fx-2","48","11","4/19","1/1","2/2","3+4","5","0","0","5","2"],["p-fx-3","48","13","6/15","1/4","0/0","5+4","3","2","0","1","4"],["p-fx-4","48","13","6/16","1/6","0/0","6+2","1","0","0","5","7"],["p-fx-5","48","8","3/12","2/5","0/0","2+4","1","1","0","3","3"]]}';
void [GOLDEN_EQUAL_FIXTURE, GOLDEN_STRONG_WEAK];
