import { describe, expect, it } from 'bun:test';
import { PlaybackCadence, presentationIntervalMs } from './playback-cadence';

function simulate(
  frameHz: number,
  lite: boolean,
  durationMs: number,
): { updates: number; advancedMs: number } {
  const frameMs = 1000 / frameHz;
  const cadence = new PlaybackCadence(presentationIntervalMs(lite));
  let updates = 0;
  let advancedMs = 0;
  for (let elapsedMs = 0; elapsedMs < durationMs; elapsedMs += frameMs) {
    const delta = Math.min(frameMs, durationMs - elapsedMs);
    const advance = cadence.add(delta);
    if (advance === null) continue;
    updates += 1;
    advancedMs += advance;
  }
  return { updates, advancedMs };
}

describe('PlaybackCadence', () => {
  it('presents lite playback at approximately 30 updates per second', () => {
    const defaultRun = simulate(60, false, 1000);
    const liteRun = simulate(60, true, 1000);

    expect(Math.abs(defaultRun.updates - 60)).toBeLessThanOrEqual(1);
    expect(Math.abs(liteRun.updates - 30)).toBeLessThanOrEqual(1);
  });

  it('advances the same elapsed time within one interval', () => {
    const durationMs = 2000;
    const liteRun = simulate(60, true, durationMs);

    expect(durationMs - liteRun.advancedMs).toBeGreaterThanOrEqual(0);
    expect(durationMs - liteRun.advancedMs).toBeLessThanOrEqual(
      presentationIntervalMs(true) + 1e-6,
    );
  });

  it('delivers the remaining elapsed time on the next update', () => {
    const cadence = new PlaybackCadence(presentationIntervalMs(true));
    expect(cadence.add(10)).toBeNull();
    expect(cadence.add(10)).toBeNull();
    expect(cadence.add(20)).toBeCloseTo(40);
    expect(cadence.add(5)).toBeNull();
    cadence.reset();
    expect(cadence.add(10)).toBeNull();
  });
});
