import { describe, expect, it } from 'bun:test';
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
import { createGameBatchSimulator, simulateGame, type TripObservation } from './game.ts';
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
    expect(fnv1a32(gameResultDigest(result))).toBe(GOLDEN_EQUAL_FIXTURE_V25_HASH);
  });
  it('is stable for the strong-vs-weak fixture (golden digest)', () => {
    const { strong, weak } = buildStrongWeakFixture();
    const input = buildGameSimulationInput({
      seed: seedSchema.parse(seedFromString('golden-svsw')),
      home: strong,
      away: weak,
    });
    expect(fnv1a32(gameResultDigest(simulateGame(input, ctx)))).toBe(GOLDEN_STRONG_WEAK_V25_HASH);
  });
  it('batch preparation preserves complete results and observations across seeds, teams, and profiles', () => {
    const simulate = createGameBatchSimulator(ctx);
    const base = buildGameSimulationInput();
    const { strong, weak } = buildStrongWeakFixture();
    const profiles = [
      base.profile,
      {
        ...base.profile,
        parameters: { ...base.profile.parameters, league3PARate: 0.4 },
      },
    ];
    for (const profile of profiles) {
      for (let i = 0; i < 40; i += 1) {
        const input = {
          ...base,
          seed: seedSchema.parse(seedFromString(`batch-${String(i)}`)),
          profile,
          home: i % 2 === 0 ? base.home : strong,
          away: i % 3 === 0 ? base.away : weak,
        };
        const expectedTrips: TripObservation[] = [];
        const actualTrips: TripObservation[] = [];
        const expected = simulateGame(input, ctx, { onTrip: (trip) => expectedTrips.push(trip) });
        const actual = simulate(input, { onTrip: (trip) => actualTrips.push(trip) });
        expect(actual).toEqual(expected);
        expect(actualTrips).toEqual(expectedTrips);
        expect(checkGameResult(actual)).toEqual([]);
      }
    }
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
const GOLDEN_EQUAL_FIXTURE_V25_HASH = 156550049;
const GOLDEN_STRONG_WEAK_V25_HASH = 3185917802;
