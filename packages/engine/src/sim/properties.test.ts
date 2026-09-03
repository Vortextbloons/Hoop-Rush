import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildGameSimulationInput,
  buildSimulationPlayer,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { simulateGame } from './game.ts';
import { checkGameResult, gameResultDigest } from './invariants.ts';
import { createEngineContext } from './context.ts';
const ctx = createEngineContext();
const profile = buildEraSimulationProfile();
const ratingArb = fc.integer({ min: 40, max: 95 });
const ratingsArb = fc.record({
  insideScoring: ratingArb,
  closeShot: ratingArb,
  midrange: ratingArb,
  threePoint: ratingArb,
  freeThrow: ratingArb,
  ballHandling: ratingArb,
  passing: ratingArb,
  offensiveIq: ratingArb,
  offensiveRebound: ratingArb,
  defensiveRebound: ratingArb,
  perimeterDefense: ratingArb,
  interiorDefense: ratingArb,
  steal: ratingArb,
  block: ratingArb,
  defensiveIq: ratingArb,
  speed: ratingArb,
  strength: ratingArb,
  vertical: ratingArb,
});
const tendencyArb = fc.integer({ min: 0, max: 45 });
const tendenciesArb = fc.record({
  usageRate: tendencyArb,
  passRate: tendencyArb,
  shotRate: tendencyArb,
  driveRate: tendencyArb,
  postUpRate: tendencyArb,
  rimFrequency: tendencyArb,
  shortMidFrequency: tendencyArb,
  longMidFrequency: tendencyArb,
  cornerThreeFrequency: tendencyArb,
  aboveBreakThreeFrequency: tendencyArb,
  threePointRate: tendencyArb,
  freeThrowRate: tendencyArb,
  turnoverRate: tendencyArb,
  isolationRate: tendencyArb,
  pickAndRollBallHandlerRate: tendencyArb,
  pickAndRollRollManRate: tendencyArb,
  spotUpRate: tendencyArb,
  transitionRate: tendencyArb,
  cutRate: tendencyArb,
  foulRate: fc.integer({ min: 0, max: 5 }),
  stealAttemptRate: tendencyArb,
  blockAttemptRate: tendencyArb,
  crashOffensiveGlassRate: tendencyArb,
});
const SLOT_ORDER: readonly SimulationPlayer['positions'][] = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
];
const playerArb: fc.Arbitrary<SimulationPlayer> = fc.record({
  playerId: fc.string({ minLength: 3, maxLength: 12 }),
  displayName: fc.string({ minLength: 3, maxLength: 12 }),
  positions: fc.constantFrom<SimulationPlayer['positions']>(['PG'], ['SG'], ['SF'], ['PF'], ['C']),
  heightInches: fc.constant<number | null>(78),
  weightLbs: fc.constant<number | null>(210),
  ratings: ratingsArb,
  tendencies: tendenciesArb,
});
const teamArb: fc.Arbitrary<SimulationTeam> = fc
  .array(playerArb, { minLength: 5, maxLength: 5 })
  .map((players) => ({
    teamId: 'prop',
    displayName: 'Prop Team',
    players: players.map((p, i) => {
      const positions = SLOT_ORDER[i];
      if (positions === undefined) {
        throw new Error('property: slot order requires five positions');
      }
      return { ...p, positions, playerId: `${p.playerId}-${String(i)}` };
    }),
  }));
const inputArb = fc.record({
  seed: fc.string({ minLength: 8, maxLength: 24 }),
  home: teamArb,
  away: teamArb,
});
describe('property: accounting and determinism', () => {
  it('satisfies every exact invariant for arbitrary teams and seeds', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const gameInput = buildGameSimulationInput({
          seed: seedFromString(`prop-${input.seed}`),
          home: input.home,
          away: input.away,
        });
        const result = simulateGame(gameInput, ctx);
        expect(checkGameResult(result)).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });
  it('reproduces byte-equivalent results for identical inputs', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const gameInput = buildGameSimulationInput({
          seed: seedFromString(`prop-${input.seed}`),
          home: input.home,
          away: input.away,
        });
        expect(gameResultDigest(simulateGame(gameInput, ctx))).toBe(
          gameResultDigest(simulateGame(gameInput, ctx)),
        );
      }),
      { numRuns: 30 },
    );
  });
  it('never ends in a tie and always has exactly one winner', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const gameInput = buildGameSimulationInput({
          seed: seedFromString(`prop-${input.seed}`),
          home: input.home,
          away: input.away,
        });
        const result = simulateGame(gameInput, ctx);
        expect(result.home.box.points).not.toBe(result.away.box.points);
        const winnerScore =
          result.winner === 'home' ? result.home.box.points : result.away.box.points;
        const loserScore =
          result.winner === 'home' ? result.away.box.points : result.home.box.points;
        expect(winnerScore).toBeGreaterThan(loserScore);
      }),
      { numRuns: 60 },
    );
  });
  it('bounds possessions and scoring to basketball plausibility', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const gameInput = buildGameSimulationInput({
          seed: seedFromString(`prop-${input.seed}`),
          home: input.home,
          away: input.away,
        });
        const result = simulateGame(gameInput, ctx);
        for (const side of [result.home, result.away]) {
          expect(side.box.possessions).toBeGreaterThanOrEqual(50);
          expect(side.box.possessions).toBeLessThanOrEqual(150);
          expect(side.box.points).toBeGreaterThanOrEqual(30);
          expect(side.box.points).toBeLessThanOrEqual(180);
          expect(side.box.fieldGoals.attempted).toBeLessThanOrEqual(side.box.possessions + 60);
        }
      }),
      { numRuns: 40 },
    );
  });
  it('keeps five distinct players on each side with full minutes', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const gameInput = buildGameSimulationInput({
          seed: seedFromString(`prop-${input.seed}`),
          home: input.home,
          away: input.away,
        });
        const result = simulateGame(gameInput, ctx);
        for (const side of [result.home, result.away]) {
          expect(new Set(side.players.map((p) => p.playerId)).size).toBe(5);
          const expected = 48 + result.overtimePeriods * 5;
          for (const player of side.players) expect(player.minutes).toBe(expected);
        }
      }),
      { numRuns: 30 },
    );
  });
});
