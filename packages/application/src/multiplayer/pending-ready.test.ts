import { describe, expect, it } from 'bun:test';
import { PendingReadyCoordinator } from './pending-ready.ts';

const BASE = {
  disposed: false,
  busy: false,
  phase: 'preparing-game',
  currentGameNumber: 2,
  localReady: false,
  now: 1000,
};

describe('PendingReadyCoordinator', () => {
  it('does nothing without a scheduled game', () => {
    let calls = 0;
    const coordinator = new PendingReadyCoordinator(5000, () => {
      calls += 1;
    });
    coordinator.tick(BASE);
    expect(calls).toBe(0);
  });

  it('clears on terminal phases and missing game numbers', () => {
    let calls = 0;
    const coordinator = new PendingReadyCoordinator(5000, () => {
      calls += 1;
    });
    coordinator.schedule(2);
    coordinator.tick({ ...BASE, phase: 'championship' });
    coordinator.tick(BASE);
    expect(calls).toBe(0);

    coordinator.schedule(2);
    coordinator.tick({ ...BASE, currentGameNumber: null });
    coordinator.tick(BASE);
    expect(calls).toBe(0);
  });

  it('drops a target that the room has already passed', () => {
    let calls = 0;
    const coordinator = new PendingReadyCoordinator(5000, () => {
      calls += 1;
    });
    coordinator.schedule(2);
    coordinator.tick({ ...BASE, currentGameNumber: 3 });
    coordinator.tick(BASE);
    expect(calls).toBe(0);
  });

  it('waits for the scheduled game and for the local seat to be unready', () => {
    let calls = 0;
    const coordinator = new PendingReadyCoordinator(5000, () => {
      calls += 1;
    });
    coordinator.schedule(3);
    coordinator.tick(BASE);
    expect(calls).toBe(0);

    coordinator.schedule(2);
    coordinator.tick({ ...BASE, localReady: true });
    coordinator.tick(BASE);
    expect(calls).toBe(0);
  });

  it('retries only after the retry window', () => {
    let calls = 0;
    const coordinator = new PendingReadyCoordinator(5000, () => {
      calls += 1;
    });
    coordinator.schedule(2);
    coordinator.tick(BASE);
    coordinator.tick({ ...BASE, now: 5999 });
    expect(calls).toBe(1);
    coordinator.tick({ ...BASE, now: 6000 });
    expect(calls).toBe(2);
  });

  it('does not fire while disposed or busy', () => {
    let calls = 0;
    const coordinator = new PendingReadyCoordinator(5000, () => {
      calls += 1;
    });
    coordinator.schedule(2);
    coordinator.tick({ ...BASE, disposed: true });
    coordinator.tick({ ...BASE, busy: true });
    expect(calls).toBe(0);
  });
});
