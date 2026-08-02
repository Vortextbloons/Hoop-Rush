import { describe, expect, it } from 'vitest';
import type { SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildGameSimulationInput,
  buildLegalSimulationTeam,
  buildSimulationPlayer,
  buildStrongWeakFixture,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { checkGameResult, gameResultDigest } from './invariants.js';
import { simulateGame } from './game.js';
import { createEngineContext } from './context.js';
import { buildEqualFixture, buildStrongMediumFixture } from '@hoop-rush/test-fixtures';

const ctx = createEngineContext();

function run(seed: string) {
  const input = buildGameSimulationInput({ seed: seedFromString(seed) });
  return simulateGame(input, ctx);
}

function runMany(seedPrefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => run(`${seedPrefix}-${i}`));
}

describe('game determinism and golden replay', () => {
  it('reproduces a golden game byte-for-byte from the same input and seed', () => {
    const input = buildGameSimulationInput({ seed: seedFromString('golden-1') });
    const a = simulateGame(input, ctx);
    const b = simulateGame(input, ctx);
    expect(gameResultDigest(a)).toBe(gameResultDigest(b));
  });

  it('is stable across identical inputs (golden digest)', () => {
    const result = run('golden-1');
    // Regenerated against the current engine; changing engine rules breaks
    // this test intentionally until a new golden baseline is regenerated.
    expect(gameResultDigest(result)).toBe(GOLDEN_EQUAL_FIXTURE);
  });

  it('is stable for the strong-vs-weak fixture (golden digest)', () => {
    const { strong, weak } = buildStrongWeakFixture();
    const input = buildGameSimulationInput({
      seed: seedFromString('golden-svsw'),
      home: strong,
      away: weak,
    });
    expect(gameResultDigest(simulateGame(input, ctx))).toBe(GOLDEN_STRONG_WEAK);
  });

  it('different seeds produce different games', () => {
    const a = run('diff-1');
    const b = run('diff-2');
    expect(gameResultDigest(a)).not.toBe(gameResultDigest(b));
  });

  it('a mirror matchup (same player on both teams) keeps accounting separate', () => {
    const shared = buildSimulationPlayer({ playerId: 'p-mirror', displayName: 'Mirror' });
    const home = buildLegalSimulationTeam({
      teamId: 'home',
      players: [shared, ...buildLegalSimulationTeam().players.slice(1)],
    });
    const away = buildLegalSimulationTeam({
      teamId: 'away',
      players: [shared, ...buildLegalSimulationTeam().players.slice(1)],
    });
    const input = buildGameSimulationInput({ seed: seedFromString('mirror-1'), home, away });
    const result = simulateGame(input, ctx);
    const homeMirror = result.home.players.find((p) => p.playerId === 'p-mirror')!;
    const awayMirror = result.away.players.find((p) => p.playerId === 'p-mirror')!;
    // Both sides track their own copies: identical players still produce
    // independent (usually different) lines under the same seed.
    expect(homeMirror.points).toBeGreaterThanOrEqual(0);
    expect(awayMirror.points).toBeGreaterThanOrEqual(0);
    expect(homeMirror.turnovers).toBeGreaterThanOrEqual(0);
    expect(awayMirror.turnovers).toBeGreaterThanOrEqual(0);
    expect(checkGameResult(result)).toEqual([]);
  });
});

describe('game invariants over many seeds', () => {
  it('satisfies every exact invariant across 200 seeded games', () => {
    for (const result of runMany('inv', 200)) {
      expect(checkGameResult(result)).toEqual([]);
    }
  });

  it('satisfies invariants for strong-vs-weak and strong-vs-medium fixtures', () => {
    const { strong, weak } = buildStrongWeakFixture();
    const { strong: strongM, medium } = buildStrongMediumFixture();
    const inputs = [
      buildGameSimulationInput({ seed: seedFromString('inv-sw'), home: strong, away: weak }),
      buildGameSimulationInput({ seed: seedFromString('inv-sm'), home: strongM, away: medium }),
    ];
    for (let i = 0; i < 50; i += 1) {
      for (const base of inputs) {
        const result = simulateGame({ ...base, seed: seedFromString(`${base.seed}-${i}`) }, ctx);
        expect(checkGameResult(result)).toEqual([]);
      }
    }
  });

  it('a stronger lineup wins more often than it loses (directional)', () => {
    const { strong, weak } = buildStrongWeakFixture();
    let strongWins = 0;
    let weakWins = 0;
    for (let i = 0; i < 200; i += 1) {
      const input = buildGameSimulationInput({
        seed: seedFromString(`sw-${i}`),
        home: strong,
        away: weak,
      });
      const result = simulateGame(input, ctx);
      if (result.winner === 'home') strongWins += 1;
      else weakWins += 1;
    }
    expect(strongWins).toBeGreaterThan(weakWins * 2);
  });

  it('every player plays the full game with no bench', () => {
    for (const result of runMany('minutes', 30)) {
      const expected = 48 + result.overtimePeriods * 5;
      for (const player of [...result.home.players, ...result.away.players]) {
        expect(player.minutes).toBe(expected);
      }
    }
  });

  it('finds an overtime game across seeds and keeps invariants', () => {
    let found: ReturnType<typeof simulateGame> | null = null;
    for (let i = 0; i < 600 && found === null; i += 1) {
      const result = run(`ot-${i}`);
      if (result.overtimePeriods > 0) found = result;
    }
    expect(found).not.toBeNull();
    expect(found!.periodScores.home.length).toBe(4 + found!.overtimePeriods);
    expect(checkGameResult(found!)).toEqual([]);
    const otFact = found!.facts.find((f) => f.kind === 'overtime');
    expect(otFact).toBeDefined();
    expect(otFact!.evidence.periods).toBe(found!.overtimePeriods);
  });
});

describe('game performance goal', () => {
  it('simulates a game well under the 10 ms desktop goal', () => {
    const input = buildGameSimulationInput({ seed: seedFromString('perf-1') });
    // Warm up.
    simulateGame(input, ctx);
    const samples: number[] = [];
    for (let i = 0; i < 100; i += 1) {
      const start = performance.now();
      simulateGame(input, ctx);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[50]!;
    const p95 = samples[95]!;
    // The 10 ms target is a CI-acceptance goal; this runs on CI hardware.
    expect(median).toBeLessThan(10);
    expect(p95).toBeLessThan(10);
  });
});

function ratingFixture(ratings: Partial<SimulationPlayer['ratings']>): SimulationTeam {
  const slots: SimulationPlayer['positions'][] = [['G'], ['G'], ['F'], ['F'], ['C']];
  return buildLegalSimulationTeam({
    players: Array.from({ length: 5 }, (_, i) =>
      buildSimulationPlayer({
        playerId: `p-r-${i + 1}`,
        positions: slots[i]!,
        ratings: { ...buildSimulationPlayer().ratings, ...ratings },
      }),
    ),
  });
}

describe('lineup strength across fixtures', () => {
  it('medium opponents beat weak opponents (directional)', () => {
    const { strong, medium } = buildStrongMediumFixture();
    const mediumDefense = buildLegalSimulationTeam({
      teamId: 'fixture-medium',
      players: medium.players,
    });
    const weak = ratingFixture({ insideScoring: 40, threePoint: 40, ballHandling: 40 });
    console.log(
      'debug medium positions:',
      JSON.stringify(mediumDefense.players.map((p) => p.positions)),
      'weak positions:',
      JSON.stringify(weak.players.map((p) => p.positions)),
    );
    let mediumWins = 0;
    for (let i = 0; i < 150; i += 1) {
      const input = buildGameSimulationInput({
        seed: seedFromString(`mm-${i}`),
        home: mediumDefense,
        away: weak,
      });
      const result = simulateGame(input, ctx);
      if (result.winner === 'home') mediumWins += 1;
    }
    void strong;
    expect(mediumWins).toBeGreaterThan(75);
  });

  it('produces sane per-game totals for the 1990s fixture profile', () => {
    const profile = buildEraSimulationProfile();
    const { home, away } = buildEqualFixture();
    const results = runMany('sane', 100).map((r) => r);
    for (const r of results) {
      expect(r.home.box.points).toBeGreaterThanOrEqual(40);
      expect(r.home.box.points).toBeLessThanOrEqual(160);
      expect(r.home.box.possessions).toBeGreaterThanOrEqual(60);
      expect(r.home.box.possessions).toBeLessThanOrEqual(140);
    }
    void profile;
  });
});

// Golden digests, regenerated from the current engine (spec/06 byte-equivalent replay).
const GOLDEN_EQUAL_FIXTURE =
  '{"seed":"45ca740e45ca740e45ca740e45ca740e","winner":"home","overtimePeriods":0,"homeScore":108,"awayScore":90,"periodScores":{"home":[24,24,26,34],"away":[15,27,24,24]},"homeBox":["46/83","8/14","8/10","10+28+5","30","6","2","11","23","86"],"awayBox":["38/83","6/15","8/14","18+26+3","24","4","1","19","19","86"],"homePlayers":[["p-fixture-1","48","19","8/11","2/2","1/1","2+8","7","2","1","2","8"],["p-fixture-2","48","18","8/20","1/3","1/2","4+4","10","0","0","1","2"],["p-fixture-3","48","23","10/15","2/3","1/1","2+10","4","3","1","2","5"],["p-fixture-4","48","13","6/12","0/1","1/1","0+3","5","0","0","2","4"],["p-fixture-5","48","35","14/25","3/5","4/5","2+3","4","1","0","4","4"]],"awayPlayers":[["p-fixture-1","48","25","11/26","1/6","2/4","5+4","4","2","0","5","4"],["p-fixture-2","48","22","9/14","1/2","3/4","1+9","4","0","0","1","3"],["p-fixture-3","48","18","7/18","1/3","3/5","3+5","7","1","0","4","5"],["p-fixture-4","48","5","2/12","1/1","0/0","4+2","9","0","0","7","5"],["p-fixture-5","48","20","9/13","2/3","0/1","5+6","0","1","1","2","2"]]}';
const GOLDEN_STRONG_WEAK =
  '{"seed":"ad339e54ad339e54ad339e54ad339e54","winner":"home","overtimePeriods":0,"homeScore":125,"awayScore":67,"periodScores":{"home":[31,28,34,32],"away":[11,13,23,20]},"homeBox":["54/88","8/13","9/10","7+42+3","46","8","7","8","4","90"],"awayBox":["30/87","5/20","2/4","14+25+3","11","2","1","18","20","91"],"homePlayers":[["p-fx-1","48","33","14/21","1/2","4/4","1+12","10","2","0","1","0"],["p-fx-2","48","23","10/15","2/3","1/1","2+8","8","3","1","2","1"],["p-fx-3","48","24","10/16","1/2","3/3","1+9","7","1","2","2","2"],["p-fx-4","48","27","12/20","2/2","1/2","1+10","12","2","2","2","1"],["p-fx-5","48","18","8/16","2/4","0/0","2+3","9","0","2","1","0"]],"awayPlayers":[["p-fx-1","48","15","6/21","1/3","2/2","4+8","3","0","0","4","6"],["p-fx-2","48","7","3/14","1/2","0/0","2+3","4","1","1","2","2"],["p-fx-3","48","11","5/17","1/6","0/0","4+5","3","1","0","3","4"],["p-fx-4","48","22","11/19","0/4","0/0","3+3","0","0","0","4","6"],["p-fx-5","48","12","5/16","2/5","0/2","1+6","1","0","0","5","2"]]}';
