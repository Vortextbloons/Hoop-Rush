import { describe, expect, it, vi } from 'bun:test';
import { LobbyAutoStart, type AutoStartGate } from './lobby-auto-start';

function gate(overrides: Partial<AutoStartGate> = {}): AutoStartGate {
  return {
    sharedLobby: true,
    isHost: true,
    bothOnline: true,
    phase: 'lobby',
    roomKey: 'room-a',
    ...overrides,
  };
}

describe('shared-lobby auto start', () => {
  it('starts once for a shared-lobby room once both seats are present', async () => {
    const auto = new LobbyAutoStart();
    expect(auto.shouldStart(gate({ bothOnline: false }))).toBe(false);
    expect(auto.shouldStart(gate())).toBe(true);
    const start = vi.fn(() => Promise.resolve());
    await auto.run('room-a', start);
    expect(start).toHaveBeenCalledTimes(1);
    expect(auto.shouldStart(gate())).toBe(false);
  });

  it('never starts direct-invite or guest rooms', () => {
    const auto = new LobbyAutoStart();
    expect(auto.shouldStart(gate({ sharedLobby: false }))).toBe(false);
    expect(auto.shouldStart(gate({ isHost: false }))).toBe(false);
    expect(auto.shouldStart(gate({ phase: 'drafting' }))).toBe(false);
  });

  it('attempts a new room again but does not retry a rejected start in a loop', async () => {
    const auto = new LobbyAutoStart();
    const failing = vi.fn(() => Promise.reject(new Error('not-ready')));
    const outcome = await auto.run('room-a', failing).then(
      () => 'started',
      () => 'rejected',
    );
    expect(outcome).toBe('rejected');
    expect(auto.failed('room-a')).toBe(true);
    expect(auto.shouldStart(gate())).toBe(false);
    expect(auto.shouldStart(gate({ roomKey: 'room-b' }))).toBe(true);
    expect(auto.failed('room-b')).toBe(false);
  });

  it('allows one more automatic attempt only after an explicit retry', async () => {
    const auto = new LobbyAutoStart();
    const outcome = await auto
      .run('room-a', () => Promise.reject(new Error('lost')))
      .then(
        () => 'started',
        () => 'rejected',
      );
    expect(outcome).toBe('rejected');
    auto.retry('room-a');
    expect(auto.failed('room-a')).toBe(false);
    expect(auto.shouldStart(gate())).toBe(true);
    const start = vi.fn(() => Promise.resolve());
    await auto.run('room-a', start);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not run two starts at once', async () => {
    const auto = new LobbyAutoStart();
    let release!: () => void;
    const start = vi.fn(
      () =>
        new Promise<void>((yes) => {
          release = yes;
        }),
    );
    const first = auto.run('room-a', start);
    expect(auto.shouldStart(gate())).toBe(false);
    release();
    await first;
    expect(start).toHaveBeenCalledTimes(1);
  });
});
