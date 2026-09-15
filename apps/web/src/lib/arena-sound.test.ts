import { beforeEach, describe, expect, it, vi } from 'vitest';

function createOscillatorMock(created: { count: number }) {
  return () => {
    created.count += 1;
    const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
    return {
      type: 'sine',
      frequency: param(),
      connect: vi.fn().mockReturnThis(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  };
}

function installAudioMock(created: { count: number }) {
  const gainParam = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const gainNode = () => ({
    gain: gainParam(),
    connect: vi.fn().mockReturnThis(),
  });
  const filterNode = () => ({
    type: 'lowpass',
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn().mockReturnThis(),
  });
  const bufferSource = () => ({
    buffer: null as unknown,
    connect: vi.fn().mockReturnThis(),
    start: vi.fn(),
    stop: vi.fn(),
  });
  const MockAC = vi.fn(function mockAudioContext(this: unknown) {
    return {
      state: 'running',
      currentTime: 0,
      sampleRate: 44100,
      destination: {},
      resume: vi.fn(() => Promise.resolve()),
      createOscillator: createOscillatorMock(created),
      createGain: gainNode,
      createBiquadFilter: filterNode,
      createBufferSource: bufferSource,
      createBuffer: (_channels: number, length: number) => ({
        getChannelData: () => new Float32Array(length),
      }),
    };
  });
  const win = (globalThis as Record<string, unknown>).window as Record<string, unknown> | undefined;
  if (win) {
    win.AudioContext = MockAC;
  } else {
    (globalThis as Record<string, unknown>).window = {
      AudioContext: MockAC,
      matchMedia: () => ({ matches: false }),
      dispatchEvent: vi.fn(() => true),
    };
  }
  return MockAC;
}

function setMatchMedia(matches: boolean) {
  const win = (globalThis as Record<string, unknown>).window as Record<string, unknown>;
  win.matchMedia = vi.fn(() => ({ matches }));
}

describe('arena-sound', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).localStorage;
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    (globalThis as Record<string, unknown>).window = {
      matchMedia: () => ({ matches: false }),
      dispatchEvent: vi.fn(() => true),
    };
  });

  it('exposes cues that never throw without an AudioContext', async () => {
    const sound = await import('./arena-sound');
    expect(() => {
      sound.arenaReelSpin('you');
    }).not.toThrow();
    const cues: Array<() => void> = [
      () => {
        sound.arenaYourTurn();
      },
      () => {
        sound.arenaRivalTurn();
      },
      () => {
        sound.arenaPickSlam();
      },
      () => {
        sound.arenaTick();
      },
      () => {
        sound.arenaBuzzer();
      },
      () => {
        sound.arenaWin();
      },
      () => {
        sound.arenaGameResult(true);
      },
      () => {
        sound.arenaGameResult(false);
      },
      () => {
        sound.arenaReelSpin(null);
      },
      () => {
        sound.arenaReelTick();
      },
      () => {
        sound.arenaReelLock('you');
      },
      () => {
        sound.arenaReelLock('rival');
      },
      () => {
        sound.arenaReelSettle();
      },
      () => {
        sound.arenaDraftDraw();
      },
      () => {
        sound.arenaDraftPick(true);
      },
      () => {
        sound.arenaDraftFinalize();
      },
      () => {
        sound.arenaConfirm();
      },
      () => {
        sound.arenaError();
      },
      () => {
        sound.arenaSimTick();
      },
      () => {
        sound.arenaStreak(4);
      },
      () => {
        sound.arenaLeaderChange();
      },
      () => {
        sound.arenaPackOpen();
      },
      () => {
        sound.arenaPackReveal('Apex');
      },
      () => {
        sound.arenaDuplicate();
      },
      () => {
        sound.arenaBlockComplete({ wins: 3, losses: 1 });
      },
      () => {
        sound.arenaBlockComplete({ wins: 1, losses: 3 });
      },
      () => {
        sound.arenaBlockComplete(null);
      },
    ];
    for (const cue of cues) expect(cue).not.toThrow();
  });

  it('stays silent while muted and plays after unmuting', async () => {
    const created = { count: 0 };
    installAudioMock(created);
    const sound = await import('./arena-sound');
    sound.setArenaMuted(true);
    sound.arenaWin();
    expect(created.count).toBe(0);
    sound.setArenaMuted(false);
    sound.arenaWin();
    expect(created.count).toBe(4);
  });

  it('toggles mute, persists, and notifies listeners', async () => {
    const created = { count: 0 };
    installAudioMock(created);
    const sound = await import('./arena-sound');
    sound.setArenaMuted(false);
    const win = (globalThis as Record<string, unknown>).window as Record<string, unknown>;
    const dispatch = win.dispatchEvent as ReturnType<typeof vi.fn>;
    const next = sound.toggleArenaMuted();
    expect(next).toBe(true);
    expect(sound.isArenaMuted()).toBe(true);
    expect(dispatch).toHaveBeenCalled();
    expect(sound.toggleArenaMuted()).toBe(false);
  });

  it('rate-limits reel and sim ticks', async () => {
    const created = { count: 0 };
    installAudioMock(created);
    setMatchMedia(false);
    const sound = await import('./arena-sound');
    sound.setArenaMuted(false);
    sound.arenaReelTick();
    sound.arenaReelTick();
    expect(created.count).toBe(1);
    sound.arenaSimTick();
    sound.arenaSimTick();
    expect(created.count).toBe(2);
  });

  it('skips ambient ticks under reduced motion but keeps finals', async () => {
    const created = { count: 0 };
    installAudioMock(created);
    setMatchMedia(true);
    const sound = await import('./arena-sound');
    sound.setArenaMuted(false);
    sound.arenaReelTick();
    sound.arenaSimTick();
    sound.arenaReelSpin('you');
    sound.arenaDraftDraw();
    expect(created.count).toBe(0);
    sound.arenaReelLock('you');
    expect(created.count).toBeGreaterThan(0);
    const before = created.count;
    sound.arenaBuzzer();
    expect(created.count).toBeGreaterThan(before);
  });

  it('scales pack reveals by rarity', async () => {
    const created = { count: 0 };
    installAudioMock(created);
    setMatchMedia(false);
    const sound = await import('./arena-sound');
    sound.setArenaMuted(false);
    sound.arenaPackReveal('Ember');
    const ember = created.count;
    created.count = 0;
    sound.arenaPackReveal('Immortal');
    expect(created.count).toBeGreaterThan(ember);
  });

  it('plays buzzer plus result for block finales', async () => {
    const created = { count: 0 };
    installAudioMock(created);
    setMatchMedia(false);
    const sound = await import('./arena-sound');
    sound.setArenaMuted(false);
    sound.arenaBlockComplete({ wins: 4, losses: 0 });
    const winNotes = created.count;
    expect(winNotes).toBeGreaterThanOrEqual(5);
    created.count = 0;
    sound.arenaBlockComplete({ wins: 0, losses: 4 });
    expect(created.count).toBeGreaterThan(0);
    expect(created.count).toBeLessThan(winNotes);
  });
});
