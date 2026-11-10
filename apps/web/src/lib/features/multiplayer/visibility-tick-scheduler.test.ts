import { afterEach, expect, it, vi } from 'bun:test';
import { visibilityTickScheduler } from './visibility-tick-scheduler';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
afterEach(() => {
  vi.useRealTimers();
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});

it('slows hidden ticks, wakes polling immediately, and removes visibility listeners on disposal', () => {
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
  const tick = vi.fn();
  const poll = vi.fn();
  const stop = visibilityTickScheduler(tick, 250);
  const stopPoll = visibilityTickScheduler(poll, 15000);
  vi.advanceTimersByTime(1000);
  expect(tick).toHaveBeenCalledTimes(4);
  hidden = true;
  events.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(1000);
  expect(tick).toHaveBeenCalledTimes(5);
  hidden = false;
  events.dispatchEvent(new Event('visibilitychange'));
  expect(tick).toHaveBeenCalledTimes(6);
  expect(poll).toHaveBeenCalledTimes(1);
  stop();
  stopPoll();
  events.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(15000);
  expect(tick).toHaveBeenCalledTimes(6);
  expect(poll).toHaveBeenCalledTimes(1);
});
