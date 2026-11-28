import { describe, expect, it } from 'bun:test';
import type { FullCourtCoachingPlan } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { assertFullCourtCoachingRoster, withFullCourtCoaching } from './coaching.ts';
import {
  checkFullCourtGameResult,
  fullCourtGameDigest,
  runFullCourtGame,
  simulateFullCourtGame,
  simulateRecordedFullCourtGame,
  type FullCourtGameInput,
  type FullCourtGameResult,
} from './game.ts';
import { fullCourtTestInput, fullCourtTestRoster } from './game-test-support.ts';

const ctx = createEngineContext();

const ROSTER = fullCourtTestRoster('hier', 9, (index) => ({
  rating: index === 2 ? 82 : 70,
  usageRate: index === 2 ? 32 : 18,
  minutesPerGame: index === 2 ? 34 : 24,
}));
const IDS = ROSTER.map((player) => player.playerId);

function idAt(index: number): string {
  const id = IDS[index];
  if (id === undefined) throw new Error('hierarchy test roster is missing a player');
  return id;
}

/** 240 regulation minutes with the primary option on the floor for 32. */
const ROTATION = {
  startingFive: IDS.slice(0, 5),
  minuteTargets: {
    [idAt(0)]: 36,
    [idAt(1)]: 34,
    [idAt(2)]: 32,
    [idAt(3)]: 30,
    [idAt(4)]: 28,
    [idAt(5)]: 30,
    [idAt(6)]: 26,
    [idAt(7)]: 18,
    [idAt(8)]: 6,
  },
};

const HIERARCHY = {
  primaryPlayerId: idAt(2),
  secondaryPlayerId: idAt(3),
  floorGeneralPlayerId: idAt(0),
};

const SEEDS = Array.from({ length: 12 }, (_value, index) => `hierarchy-${String(index)}`);

function inputFor(
  seed: string,
  hierarchy: FullCourtGameInput['home']['hierarchy'],
): FullCourtGameInput {
  const input = fullCourtTestInput({ seed, homeRoster: ROSTER });
  return {
    ...input,
    home: {
      ...input.home,
      rotation: ROTATION,
      ...(hierarchy === undefined ? {} : { hierarchy }),
    },
  };
}

function attemptsPer36(result: FullCourtGameResult, playerId: string): number {
  const line = result.home.players.find((player) => player.playerId === playerId);
  if (line === undefined) throw new Error(`missing player ${playerId}`);
  return line.seconds === 0 ? 0 : (line.fieldGoals.attempted * 36 * 60) / line.seconds;
}

function attemptsOf(result: FullCourtGameResult, playerId: string): number {
  const line = result.home.players.find((player) => player.playerId === playerId);
  if (line === undefined) throw new Error(`missing player ${playerId}`);
  return line.fieldGoals.attempted;
}

function benchAttempts(result: FullCourtGameResult): number {
  return result.home.players
    .filter((player) => !player.startedGame)
    .reduce((sum, player) => sum + player.fieldGoals.attempted, 0);
}

describe('Full Court offensive hierarchy', () => {
  it('raises the assigned scorer’s opportunities without changing team accounting', () => {
    let baselineAttempts = 0;
    let hierarchyAttempts = 0;
    let baselineTeamAttempts = 0;
    let hierarchyTeamAttempts = 0;
    let baselineBenchAttempts = 0;
    let hierarchyBenchAttempts = 0;

    for (const seed of SEEDS) {
      const baseline = simulateFullCourtGame(inputFor(seed, undefined), ctx);
      const treatment = simulateFullCourtGame(inputFor(seed, HIERARCHY), ctx);

      expect(checkFullCourtGameResult(baseline)).toEqual([]);
      expect(checkFullCourtGameResult(treatment)).toEqual([]);

      baselineAttempts += attemptsOf(baseline, idAt(2));
      hierarchyAttempts += attemptsOf(treatment, idAt(2));
      baselineTeamAttempts += baseline.home.box.fieldGoals.attempted;
      hierarchyTeamAttempts += treatment.home.box.fieldGoals.attempted;
      baselineBenchAttempts += benchAttempts(baseline);
      hierarchyBenchAttempts += benchAttempts(treatment);
    }

    // The primary option's share rises; the team still earns the same possessions.
    expect(hierarchyAttempts).toBeGreaterThan(baselineAttempts * 1.06);
    // A named scorer should lift his own volume without swallowing the offense.
    expect(hierarchyAttempts).toBeLessThan(baselineAttempts * 1.4);
    expect(
      Math.abs(hierarchyTeamAttempts - baselineTeamAttempts) / baselineTeamAttempts,
    ).toBeLessThan(0.1);
    // Bench players keep contributing rather than being removed from the offense.
    expect(hierarchyBenchAttempts).toBeGreaterThan(baselineBenchAttempts * 0.75);
  });

  it('uses passing reads in seeded games without changing accounting', () => {
    const passingReads = Object.fromEntries(
      IDS.filter((id) => id !== idAt(2)).map((id) => [id, [idAt(2)]]),
    );
    let baselineAttempts = 0;
    let coachedAttempts = 0;
    for (const seed of SEEDS) {
      const baseline = simulateFullCourtGame(inputFor(seed, undefined), ctx);
      const coachedInput = inputFor(seed, { passingReads });
      const coached = simulateFullCourtGame(coachedInput, ctx);
      expect(checkFullCourtGameResult(coached)).toEqual([]);
      expect(fullCourtGameDigest(coached)).toBe(
        fullCourtGameDigest(simulateFullCourtGame(coachedInput, ctx)),
      );
      baselineAttempts += attemptsOf(baseline, idAt(2));
      coachedAttempts += attemptsOf(coached, idAt(2));
    }
    expect(coachedAttempts).toBeGreaterThan(baselineAttempts);
  });

  it('changes nothing when the assigned scorer is unavailable', () => {
    const hierarchy = { primaryPlayerId: idAt(8) };
    for (const seed of SEEDS.slice(0, 4)) {
      const input = fullCourtTestInput({ seed, homeRoster: ROSTER });
      const unavailable = ROSTER.map((player) => ({
        playerId: player.playerId,
        available: player.playerId !== idAt(8),
      }));
      const baseline = simulateFullCourtGame(
        {
          ...input,
          home: { ...input.home, rotation: ROTATION, availability: unavailable },
        },
        ctx,
      );
      const treatment = simulateFullCourtGame(
        {
          ...input,
          home: {
            ...input.home,
            rotation: ROTATION,
            availability: unavailable,
            hierarchy,
          },
        },
        ctx,
      );
      expect(treatment).toEqual(baseline);
      expect(treatment.home.players.find((player) => player.playerId === idAt(8))?.seconds).toBe(0);
    }
  });

  it('keeps legacy plans without a hierarchy byte-for-byte identical', () => {
    const input = inputFor('hierarchy-legacy', undefined);
    const legacy = simulateFullCourtGame(input, ctx);
    const fromPlan: FullCourtCoachingPlan = {
      schemaVersion: 1,
      tactics: { pace: 'balanced', offense: 'balanced', defense: 'balanced' },
    };
    expect(() => assertFullCourtCoachingRoster(fromPlan, ROSTER)).not.toThrow();
    const team = { ...input.home, rotation: ROTATION };
    expect(withFullCourtCoaching(team, { hierarchy: fromPlan.hierarchy })).toBe(team);
    expect(fullCourtGameDigest(simulateFullCourtGame({ ...input, home: team }, ctx))).toBe(
      fullCourtGameDigest(legacy),
    );
  });

  it('records the same hierarchy game with or without the event writer', () => {
    const input = inputFor('hierarchy-recording', HIERARCHY);
    const plain = runFullCourtGame(input, ctx);
    const recorded = simulateRecordedFullCourtGame(input, ctx);
    const replay = simulateRecordedFullCourtGame(input, ctx);

    expect(plain.tape).toBeNull();
    expect(recorded.tape.length).toBeGreaterThan(0);
    expect(fullCourtGameDigest(recorded.result)).toBe(fullCourtGameDigest(plain.result));
    expect(recorded.result).toEqual(plain.result);
    expect(fullCourtGameDigest(replay.result)).toBe(fullCourtGameDigest(recorded.result));
    expect(replay.tape).toEqual(recorded.tape);
  });

  it('measures a per-minute opportunity lift while the scorer is active', () => {
    let baselineRate = 0;
    let hierarchyRate = 0;
    for (const seed of SEEDS.slice(0, 6)) {
      baselineRate += attemptsPer36(simulateFullCourtGame(inputFor(seed, undefined), ctx), idAt(2));
      hierarchyRate += attemptsPer36(
        simulateFullCourtGame(inputFor(seed, HIERARCHY), ctx),
        idAt(2),
      );
    }
    expect(hierarchyRate).toBeGreaterThan(baselineRate);
  });
});
