import { afterEach, describe, expect, it, vi } from 'bun:test';
import { CapRushMultiplayerController } from './cap-rush-multiplayer-controller.svelte';
import * as assets from './cap-rush-multiplayer-assets';
import * as transports from './cap-rush-multiplayer-transport';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});

function fakeTransport() {
  return {
    resume: vi.fn(() => new Promise(() => {})),
    sync: vi.fn(() => Promise.resolve({ snapshot: null, commands: [], commandCount: 0 })),
    subscribe: vi.fn(() => () => {}),
  };
}

describe('cap rush polling cadence', () => {
  it('separates the UI clock from the network fallback and slows hidden tabs', () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    let hidden = false;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        get hidden() {
          return hidden;
        },
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
      },
    });
    vi.spyOn(assets, 'getCapRushMultiplayerData').mockReturnValue(new Promise(() => {}));
    const transport = fakeTransport();
    vi.spyOn(transports, 'getCapRushMultiplayerTransport').mockReturnValue(
      transport as unknown as transports.CapRushMultiplayerSupabaseTransport,
    );

    const controller = new CapRushMultiplayerController('room-a');
    const tick = vi.spyOn(controller as unknown as { tick(): Promise<void> }, 'tick');
    controller.start();

    // The visible tab polls every second for the network fallback.
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(3);

    // A hidden tab keeps its clock but polls far less often.
    hidden = true;
    events.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(10_000);
    expect(tick).toHaveBeenCalledTimes(5);
    expect(controller.nowMs).toBeGreaterThan(0);

    // Returning to the tab refreshes immediately, then resumes the fast cadence.
    hidden = false;
    events.dispatchEvent(new Event('visibilitychange'));
    expect(tick).toHaveBeenCalledTimes(6);
    vi.advanceTimersByTime(2000);
    expect(tick).toHaveBeenCalledTimes(8);

    controller.dispose();
    vi.advanceTimersByTime(10_000);
    expect(tick).toHaveBeenCalledTimes(8);
  });
});
