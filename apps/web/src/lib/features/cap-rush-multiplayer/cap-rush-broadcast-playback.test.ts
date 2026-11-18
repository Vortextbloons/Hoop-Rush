import { describe, expect, it } from 'bun:test';
import { BROADCAST_TICK_MS, broadcastCursor } from './cap-rush-broadcast-playback.js';

describe('Cap Rush broadcast playback', () => {
  it('catches up after delayed ticks while preserving the presentation cadence', () => {
    expect(broadcastCursor(100, 100, 2)).toBe(2);
    expect(broadcastCursor(1900, 100, 2)).toBe(38);
    expect(broadcastCursor(3800, 100, 2)).toBe(76);
    expect(broadcastCursor(3800 + BROADCAST_TICK_MS, 100, 2)).toBe(78);
  });

  it('completes on the final step and clamps a late tick to the end', () => {
    expect(broadcastCursor(4900, 100, 2)).toBe(98);
    expect(broadcastCursor(5000, 100, 2)).toBe(100);
    expect(broadcastCursor(2099, 101, 4)).toBe(100);
    expect(broadcastCursor(2100, 101, 4)).toBe(101);
    expect(broadcastCursor(299, 3, 2)).toBe(2);
    expect(broadcastCursor(300, 3, 2)).toBe(3);
    expect(broadcastCursor(1000, 0, 2)).toBe(0);
  });
});
