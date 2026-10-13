import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataThrottle, progressTickIntervalMs } from './throttle';

describe('progressTickIntervalMs', () => {
  it('gives low-end devices a coarser cadence', () => {
    expect(progressTickIntervalMs(true)).toBeGreaterThan(progressTickIntervalMs(false));
  });
});

describe('DataThrottle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies the first value immediately', () => {
    const seen: number[] = [];
    const throttle = new DataThrottle<number>((value) => seen.push(value), 100);
    throttle.push(1);
    expect(seen).toEqual([1]);
    throttle.cancel();
  });

  it('coalesces rapid pushes and surfaces only the latest', () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const throttle = new DataThrottle<number>((value) => seen.push(value), 100);
    throttle.push(1);
    throttle.push(2);
    throttle.push(3);
    expect(seen).toEqual([1]);
    vi.advanceTimersByTime(100);
    expect(seen).toEqual([1, 3]);
    throttle.cancel();
  });

  it('drops pending work when cancelled', () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const throttle = new DataThrottle<number>((value) => seen.push(value), 100);
    throttle.push(1);
    throttle.push(2);
    throttle.cancel();
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([1]);
  });
});
