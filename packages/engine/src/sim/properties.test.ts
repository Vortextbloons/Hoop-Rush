import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildGameSimulationInput,
  buildSimulationPlayer,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { simulateGame } from './game.js';
import { checkGameResult, gameResultDigest } from './invariants.js';
import { createEngineContext } from './context.js';

/**
 * Property-based accounting, determinism, and distribution invariants
 * (spec/06) over arbitrary legal lineups, ratings, and seeds.
 */

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

const SLOT_ORDER: readonly SimulationPlayer['positions'][] = [['G'], ['G'], ['F'], ['F'], ['C']];

const playerArb: fc.Arbitrary<SimulationPlayer> = fc.record({
  playerId: fc.string({ minLength: 3, maxLength: 12 }),
  displayName: fc.string({ minLength: 3, maxLength: 12 }),
  positions: fc.constantFrom<SimulationPlayer['positions']>(['G'], ['F'], ['C']),
  heightInches: fc.constant<number | null>(78),
  weightLbs: fc.constant<number | null>(210),
  ratings: ratingsArb,
  tendencies: tendenciesArb,
});

/** A legal five with the fixed G,G,F,F,C structure and random ratings. */
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
          // Each trip ends in a shot, free throws, or a turnover; offensive
          // rebounds continue a trip with up to four extra shot attempts.
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

describe('property: zone skill correlation', () => {
  it('high-zone-skill teams make more shots in that zone', () => {
    const makeSharpshooter = (threePoint: number): SimulationTeam => {
      const slots: SimulationPlayer['positions'][] = [['G'], ['G'], ['F'], ['F'], ['C']];
      const players = Array.from({ length: 5 }, (_, i) => {
        const positions = slots[i];
        if (positions === undefined) {
          throw new Error('property: slot order requires five positions');
        }
        return buildSimulationPlayer({
          playerId: `p-3pt-${String(i)}`,
          positions,
          ratings: { ...buildSimulationPlayer().ratings, threePoint },
        });
      });
      return { teamId: 'shooters', displayName: 'Shooters', players };
    };
    const bad = makeSharpshooter(45);
    const good = makeSharpshooter(90);
    let badThreePct = 0;
    let goodThreePct = 0;
    for (let i = 0; i < 120; i += 1) {
      const seed = seedFromString(`zone-${String(i)}`);
      const badR = simulateGame(
        buildGameSimulationInput({ seed, profile, home: bad, away: bad }),
        ctx,
      ).home.box.threes;
      const goodR = simulateGame(
        buildGameSimulationInput({ seed, profile, home: good, away: good }),
        ctx,
      ).home.box.threes;
      badThreePct += badR.made / Math.max(1, badR.attempted);
      goodThreePct += goodR.made / Math.max(1, goodR.attempted);
    }
    expect(goodThreePct / 120).toBeGreaterThan((badThreePct / 120) * 1.2);
  });
});
