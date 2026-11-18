import { describe, expect, it } from 'bun:test';
import { PlaybackCadence, presentationIntervalMs } from '#lib/playback-cadence.js';
import {
  broadcastCursor,
  broadcastDurationMs,
  broadcastStep,
} from './cap-rush-broadcast-playback.js';

const TOTAL = 100;
const SPEED: 2 | 4 = 2;

/** Nominal 100ms frames with one 1000ms stall every 10th frame. */
function stalledDelays(count: number, stallEvery = 10, stallMs = 1000): number[] {
  return Array.from({ length: count }, (_, index) =>
    index % stallEvery === stallEvery - 1 ? stallMs : 100,
  );
}

/** Drives the new elapsed-time path: cadence gates frames, then maps time to cursor. */
function simulateNew(
  delays: readonly number[],
  total = TOTAL,
  speed = SPEED,
  lite = false,
): { cursor: number; finishedWallMs: number; wallMs: number } {
  const cadence = new PlaybackCadence(presentationIntervalMs(lite));
  const durationMs = broadcastDurationMs(total, speed);
  let elapsedMs = 0;
  let cursor = 0;
  let wallMs = 0;
  let finishedWallMs = -1;
  for (const delta of delays) {
    const advance = cadence.add(delta);
    if (advance !== null) elapsedMs = Math.min(elapsedMs + advance, durationMs);
    wallMs += delta;
    cursor = broadcastCursor(elapsedMs, total, speed);
    if (finishedWallMs < 0 && cursor >= total) finishedWallMs = wallMs;
  }
  return { cursor, finishedWallMs, wallMs };
}

/** Faithful model of the legacy setInterval loop: one fixed step per callback. */
function simulateOld(
  total = TOTAL,
  speed = SPEED,
): { step: number; callbacks: number; durationMs: number } {
  const step = broadcastStep(total, speed);
  const durationMs = broadcastDurationMs(total, speed);
  let cursor = 0;
  let callbacks = 0;
  while (cursor < total) {
    cursor = Math.min(total, cursor + step);
    callbacks += 1;
  }
  return { step, callbacks, durationMs };
}

function wallMsFor(delays: readonly number[], callbacks: number): number {
  return delays.slice(0, callbacks).reduce((sum, delta) => sum + delta, 0);
}

describe('cap rush broadcast playback timing', () => {
  it('keeps nominal timing when frames are on time', () => {
    const delays = Array<number>(50).fill(100);
    const legacy = simulateOld();
    const fixed = simulateNew(delays);

    expect(legacy.step).toBe(2);
    expect(legacy.durationMs).toBe(5000);
    expect(wallMsFor(delays, legacy.callbacks)).toBe(5000);
    expect(fixed.finishedWallMs).toBe(5000);
  });

  it('catches up on late frames instead of stretching playback', () => {
    const delays = stalledDelays(50); // 5 x 1000ms stalls inside 50 frames
    const legacy = simulateOld();
    const legacyWallMs = wallMsFor(delays, legacy.callbacks);
    const fixed = simulateNew(delays);

    // Same deterministic delays: legacy stretches by the stalled time, the
    // elapsed-time path finishes at (nominal + at most one late-frame overshoot).
    expect(legacyWallMs).toBe(9500);
    expect(fixed.finishedWallMs).toBeGreaterThanOrEqual(legacy.durationMs);
    expect(fixed.finishedWallMs).toBeLessThanOrEqual(legacy.durationMs + 1000);
    expect(fixed.finishedWallMs).toBeLessThan(legacyWallMs);

    // At the same real time (after 20 delivered frames = 3800ms) the fixed
    // cursor has caught up while the legacy cursor is still step-limited.
    const fixedAt20 = simulateNew(delays.slice(0, 20));
    expect(fixedAt20.cursor).toBe(76);
    expect(legacy.step * 20).toBe(40);
  });

  it('does not lose time under the low-power (lite) cadence', () => {
    const frameMs = 1000 / 60;
    const delays = Array.from({ length: 301 }, () => frameMs);
    const fixed = simulateNew(delays, TOTAL, SPEED, true);
    const interval = presentationIntervalMs(true);

    expect(fixed.cursor).toBeGreaterThanOrEqual(TOTAL - 1);
    expect(fixed.wallMs).toBeGreaterThanOrEqual(broadcastDurationMs(TOTAL, SPEED));
    // Sub-interval remainder never exceeds one low-power presentation interval.
    expect(broadcastDurationMs(TOTAL, SPEED) - Math.min(fixed.wallMs, 5000)).toBeLessThan(
      interval + 1e-6,
    );
  });

  it('excludes paused wall time from playback', () => {
    const cadence = new PlaybackCadence(presentationIntervalMs(false));
    const durationMs = broadcastDurationMs(TOTAL, SPEED);
    let elapsedMs = 0;
    const feed = (delta: number): void => {
      const advance = cadence.add(delta);
      if (advance !== null) elapsedMs = Math.min(elapsedMs + advance, durationMs);
    };

    for (const delta of Array<number>(40).fill(100)) feed(delta);
    const beforePause = broadcastCursor(elapsedMs, TOTAL, SPEED);
    // While paused the rAF loop keeps its timestamp fresh but feeds nothing.
    const duringPause = broadcastCursor(elapsedMs, TOTAL, SPEED);
    expect(beforePause).toBe(80);
    expect(duringPause).toBe(beforePause);

    for (const delta of Array<number>(5).fill(100)) feed(delta);
    const afterResume = broadcastCursor(elapsedMs, TOTAL, SPEED);
    expect(afterResume).toBe(90);

    // Control: the same 2000ms pause, if counted, would have completed playback.
    const control = new PlaybackCadence(presentationIntervalMs(false));
    let controlElapsed = 0;
    for (const delta of [...Array<number>(40).fill(100), 2000, ...Array<number>(5).fill(100)]) {
      const advance = control.add(delta);
      if (advance !== null) controlElapsed += advance;
    }
    expect(broadcastCursor(controlElapsed, TOTAL, SPEED)).toBe(100);
  });

  it('completes exactly, monotonically, without overshoot, for any size/speed', () => {
    for (const total of [1, 7, 100, 1000]) {
      for (const speed of [2, 4] as const) {
        const durationMs = broadcastDurationMs(total, speed);
        expect(broadcastCursor(durationMs, total, speed)).toBe(total);
        expect(broadcastCursor(durationMs + 5000, total, speed)).toBe(total);
        expect(broadcastCursor(durationMs - 1e-6, total, speed)).toBeLessThan(total);

        let previous = 0;
        const probe = Math.max(1, durationMs / 50);
        for (let elapsed = 0; elapsed <= durationMs + probe; elapsed += probe) {
          const cursor = broadcastCursor(elapsed, total, speed);
          expect(cursor).toBeGreaterThanOrEqual(previous);
          expect(cursor).toBeLessThanOrEqual(total);
          previous = cursor;
        }
      }
    }
  });

  it('preserves legacy duration mapping including the minimum-step case', () => {
    // Legacy step = max(1, ceil(total*speed/100)); duration = total*100/step.
    expect(broadcastStep(10, 2)).toBe(1);
    expect(broadcastDurationMs(10, 2)).toBe(1000);
    expect(broadcastStep(100, 4)).toBe(4);
    expect(broadcastDurationMs(100, 4)).toBe(2500);
    expect(broadcastDurationMs(0, 2)).toBe(0);
    expect(broadcastCursor(1, 0, 2)).toBe(0);
    expect(broadcastCursor(Number.NaN, TOTAL, SPEED)).toBe(0);
    expect(broadcastCursor(-50, TOTAL, SPEED)).toBe(0);
  });
});
