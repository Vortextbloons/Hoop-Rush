import { describe, expect, it } from 'vitest';
import { createRng } from '../sim/rng.ts';
import { memberReachCapped } from './ai/reachability.ts';
import type { GenerationState } from './ai/types.ts';

const SLOTS = 5;

function bruteReach(
  masks: readonly number[],
  targets: readonly number[],
  start: readonly number[],
  maxPicks: number,
  outlierFlags: readonly number[] | null,
  startOutliers: number,
  maxOutliers: number,
): boolean {
  if (maxPicks < 0) return false;
  if (outlierFlags !== null && startOutliers > maxOutliers) return false;
  const count = masks.length;
  const subsets = 1 << count;
  for (let subset = 0; subset < subsets; subset += 1) {
    let picked = 0;
    const counts = [...start];
    let outliers = startOutliers;
    let tooMany = false;
    for (let i = 0; i < count; i += 1) {
      if ((subset & (1 << i)) === 0) continue;
      picked += 1;
      if (picked > maxPicks) {
        tooMany = true;
        break;
      }
      const mask = masks[i] ?? 0;
      for (let p = 0; p < SLOTS; p += 1) {
        if ((mask & (1 << p)) !== 0) counts[p] = (counts[p] ?? 0) + 1;
      }
      if (outlierFlags !== null && outlierFlags[i] === 1) outliers += 1;
    }
    if (tooMany) continue;
    if (outlierFlags !== null && outliers > maxOutliers) continue;
    let complete = true;
    for (let p = 0; p < SLOTS; p += 1) {
      if ((counts[p] ?? 0) < (targets[p] ?? 0)) {
        complete = false;
        break;
      }
    }
    if (complete) return true;
  }
  return false;
}

function stateFor(masks: readonly number[], outlierFlags: readonly number[]): GenerationState {
  const maskByVersion = new Map<string, number>();
  const identityScores = new Map<string, Record<string, number>>();
  masks.forEach((mask, index) => {
    maskByVersion.set(`pv-${String(index)}`, mask);
    identityScores.set(`pv-${String(index)}`, {
      continuity: outlierFlags[index] === 1 ? 100 : 0,
    });
  });
  return { maskByVersion, identityScores } as unknown as GenerationState;
}

function randomCounts(rng: ReturnType<typeof createRng>): number[] {
  return Array.from({ length: SLOTS }, () => rng.nextInt(0, 2));
}

describe('memberReachCapped', () => {
  it('matches brute force without an outlier budget', () => {
    const rng = createRng('ai-reachability-parity-plain');
    for (let iteration = 0; iteration < 400; iteration += 1) {
      const size = rng.nextInt(0, 12);
      const masks: number[] = [];
      const flags: number[] = [];
      for (let i = 0; i < size; i += 1) {
        masks.push(rng.nextInt(0, 31));
        flags.push(rng.nextInt(0, 1));
      }
      const targets = randomCounts(rng);
      const start = randomCounts(rng);
      const maxPicks = rng.nextInt(-1, 5);
      const ids = masks.map((_mask, index) => `pv-${String(index)}`);
      const actual = memberReachCapped(stateFor(masks, flags), targets, start, ids, maxPicks);
      const expected = bruteReach(masks, targets, start, maxPicks, null, 0, 0);
      expect(actual, `iteration ${String(iteration)}`).toBe(expected);
    }
  });
  it('matches brute force with an outlier budget', () => {
    const rng = createRng('ai-reachability-parity-outliers');
    for (let iteration = 0; iteration < 400; iteration += 1) {
      const size = rng.nextInt(0, 12);
      const masks: number[] = [];
      const flags: number[] = [];
      for (let i = 0; i < size; i += 1) {
        masks.push(rng.nextInt(0, 31));
        flags.push(rng.nextInt(0, 1));
      }
      const targets = randomCounts(rng);
      const start = randomCounts(rng);
      const maxPicks = rng.nextInt(-1, 5);
      const startOutliers = rng.nextInt(0, 4);
      const maxOutliers = rng.nextInt(0, 3);
      const ids = masks.map((_mask, index) => `pv-${String(index)}`);
      const actual = memberReachCapped(stateFor(masks, flags), targets, start, ids, maxPicks, {
        identity: 'continuity',
        capValue: 50,
        startOutliers,
        maxOutliers,
      });
      const expected = bruteReach(
        masks,
        targets,
        start,
        maxPicks,
        flags,
        startOutliers,
        maxOutliers,
      );
      expect(actual, `iteration ${String(iteration)}`).toBe(expected);
    }
  });
  it('applies the outlier budget only when provided', () => {
    const masks = [1, 2, 4, 8, 16];
    const flags = [1, 1, 0, 0, 0];
    const ids = masks.map((_mask, index) => `pv-${String(index)}`);
    const state = stateFor(masks, flags);
    const targets = [1, 1, 1, 1, 1];
    const start = [0, 0, 0, 0, 0];
    expect(memberReachCapped(state, targets, start, ids, 5)).toBe(true);
    expect(
      memberReachCapped(state, targets, start, ids, 5, {
        identity: 'continuity',
        capValue: 50,
        startOutliers: 0,
        maxOutliers: 0,
      }),
    ).toBe(false);
    expect(
      memberReachCapped(state, targets, start, ids, 5, {
        identity: 'continuity',
        capValue: 50,
        startOutliers: 0,
        maxOutliers: 2,
      }),
    ).toBe(true);
  });
});
