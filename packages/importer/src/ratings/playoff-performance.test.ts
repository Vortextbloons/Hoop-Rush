import { expect, it } from 'bun:test';
import { derivePlayoffPerformance } from './playoff-performance.ts';
const stats = {
  gamesPlayed: 80,
  minutes: 2880,
  points: 1600,
  assists: 400,
  rebounds: 640,
  turnovers: 160,
  fga: 1200,
  fta: 400,
};
const playoffs = {
  playerExternalId: '1',
  gamesPlayed: 1,
  minutes: 6,
  points: 4,
  assists: 1,
  rebounds: 2,
  turnovers: null,
  fga: 3,
  fta: 0,
  tsPct: 2 / 3,
  offensiveRebounds: null,
  defensiveRebounds: null,
  steals: null,
  blocks: null,
};
it('retains a tiny sample and derives signed per-36 differences without filling missing stats', () => {
  const profile = derivePlayoffPerformance('2017-18', stats, playoffs);
  expect(profile?.playoffs.minutes).toBe(6);
  expect(profile?.differences.pointsPer36).toBe(4);
  expect(profile?.differences.reboundsPer36).toBe(4);
  expect(profile?.differences.turnoversPer36).toBeNull();
  expect(profile?.differences.tsPct).toBeCloseTo(2 / 3 - 1600 / (2 * (1200 + 0.44 * 400)));
});
it('omits profiles for absent playoff appearances and zero-minute samples', () => {
  expect(derivePlayoffPerformance('2018-19', stats, undefined)).toBeUndefined();
  expect(derivePlayoffPerformance('2018-19', stats, { ...playoffs, minutes: 0 })).toBeUndefined();
});
it('does not calculate a rate from a missing regular-season value', () => {
  expect(
    derivePlayoffPerformance('2017-18', { ...stats, turnovers: null }, playoffs)?.differences
      .turnoversPer36,
  ).toBeNull();
});
