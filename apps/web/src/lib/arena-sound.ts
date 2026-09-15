let ctx: AudioContext | null = null;
let muted = false;

try {
  muted = localStorage.getItem('hoop-rush:arena-muted') === '1';
} catch {}

export const ARENA_MUTED_EVENT = 'hoop-rush:arena-muted-changed';

export function isArenaMuted(): boolean {
  return muted;
}

export function setArenaMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem('hoop-rush:arena-muted', value ? '1' : '0');
  } catch {}
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ARENA_MUTED_EVENT, { detail: { muted: value } }));
    }
  } catch {}
}

export function toggleArenaMuted(): boolean {
  const next = !muted;
  setArenaMuted(next);
  return next;
}

function prefersReducedMotion(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (AC === undefined) return null;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOptions {
  freq: number;
  freqEnd?: number;
  durMs: number;
  type?: OscillatorType;
  gain?: number;
  whenMs?: number;
}

function tone({ freq, freqEnd, durMs, type = 'sine', gain = 0.08, whenMs = 0 }: ToneOptions): void {
  const context = ac();
  if (!context) return;
  try {
    const t0 = context.currentTime + whenMs / 1000;
    const osc = context.createOscillator();
    const g = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, freq), t0);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t0 + durMs / 1000);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
    osc.connect(g).connect(context.destination);
    osc.start(t0);
    osc.stop(t0 + durMs / 1000 + 0.02);
  } catch {}
}

function noiseBurst(durMs: number, gain = 0.05, whenMs = 0, filterFreq = 1200): void {
  const context = ac();
  if (!context) return;
  try {
    const t0 = context.currentTime + whenMs / 1000;
    const length = Math.max(1, Math.floor((context.sampleRate * durMs) / 1000));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const decay = 1 - i / length;
      data[i] = (Math.random() * 2 - 1) * decay;
    }
    const src = context.createBufferSource();
    src.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, t0);
    const g = context.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
    src.connect(filter).connect(g).connect(context.destination);
    src.start(t0);
    src.stop(t0 + durMs / 1000 + 0.02);
  } catch {}
}

function blip(
  freq: number,
  durMs: number,
  type: OscillatorType = 'sine',
  gain = 0.08,
  whenMs = 0,
): void {
  tone({ freq, durMs, type, gain, whenMs });
}

const lastPlayByKey = new Map<string, number>();

function nowMs(): number {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch {}
  return Date.now();
}

function rateLimit(key: string, minGapMs: number): boolean {
  const now = nowMs();
  const last = lastPlayByKey.get(key) ?? Number.NEGATIVE_INFINITY;
  if (now - last < minGapMs) return false;
  lastPlayByKey.set(key, now);
  return true;
}

export function arenaYourTurn(): void {
  blip(523, 110, 'triangle', 0.09);
  blip(784, 140, 'triangle', 0.09, 90);
  blip(1046, 180, 'sine', 0.07, 180);
}

export function arenaRivalTurn(): void {
  blip(220, 160, 'sawtooth', 0.04);
  blip(165, 200, 'sawtooth', 0.04, 110);
}

export function arenaPickSlam(): void {
  noiseBurst(90, 0.05, 0, 900);
  blip(140, 120, 'square', 0.07);
  blip(880, 160, 'triangle', 0.08, 60);
}

export function arenaTick(): void {
  blip(1200, 40, 'square', 0.025);
}

export function arenaBuzzer(): void {
  noiseBurst(280, 0.03, 0, 700);
  blip(180, 320, 'sawtooth', 0.07);
}

export function arenaWin(): void {
  blip(523, 120, 'triangle', 0.09);
  blip(659, 120, 'triangle', 0.09, 110);
  blip(784, 160, 'triangle', 0.09, 220);
  blip(1046, 260, 'sine', 0.08, 330);
}

export function arenaGameResult(won: boolean): void {
  if (won) {
    blip(660, 90, 'triangle', 0.07);
    blip(990, 140, 'sine', 0.06, 70);
  } else {
    blip(200, 140, 'sawtooth', 0.045);
  }
}

export type ArenaSpotlight = 'you' | 'rival' | null;

export function arenaReelSpin(spotlight: ArenaSpotlight = null): void {
  if (prefersReducedMotion()) return;
  if (spotlight === 'rival') {
    tone({ freq: 196, freqEnd: 147, durMs: 220, type: 'sawtooth', gain: 0.04 });
  } else {
    tone({ freq: 330, freqEnd: 660, durMs: 220, type: 'triangle', gain: 0.06 });
  }
}

export function arenaReelTick(): void {
  if (prefersReducedMotion()) return;
  if (!rateLimit('reel-tick', 70)) return;
  blip(1400, 30, 'square', 0.02);
}

export function arenaReelLock(spotlight: ArenaSpotlight = null): void {
  noiseBurst(90, 0.05, 0, 900);
  if (spotlight === 'rival') {
    blip(233, 160, 'sawtooth', 0.05);
  } else {
    blip(880, 160, 'triangle', 0.07);
  }
}

export function arenaReelSettle(): void {
  blip(660, 80, 'triangle', 0.06);
  blip(990, 120, 'sine', 0.055, 60);
}

export function arenaDraftDraw(): void {
  if (prefersReducedMotion()) return;
  tone({ freq: 220, freqEnd: 440, durMs: 180, type: 'sawtooth', gain: 0.035 });
  blip(1200, 40, 'square', 0.02, 120);
}

export function arenaDraftPick(fillsNeed = false): void {
  noiseBurst(90, 0.05, 0, 900);
  blip(150, 100, 'square', 0.06);
  blip(fillsNeed ? 1174 : 880, 160, 'triangle', 0.075, 60);
}

export function arenaDraftFinalize(): void {
  blip(523, 110, 'triangle', 0.08);
  blip(659, 110, 'triangle', 0.08, 100);
  blip(784, 180, 'sine', 0.07, 200);
}

export function arenaConfirm(): void {
  blip(740, 70, 'triangle', 0.06);
  blip(1108, 90, 'sine', 0.05, 60);
}

export function arenaError(): void {
  blip(160, 200, 'sawtooth', 0.05);
  blip(120, 240, 'sawtooth', 0.05, 140);
}

export function arenaSimTick(): void {
  if (prefersReducedMotion()) return;
  if (!rateLimit('sim-tick', 90)) return;
  blip(900, 35, 'square', 0.02);
}

export function arenaStreak(count: number): void {
  const safe = Math.max(2, Math.min(8, Math.floor(count)));
  const base = 700 + safe * 60;
  blip(base, 90, 'triangle', 0.07);
  blip(base * 1.335, 130, 'sine', 0.06, 80);
}

export function arenaLeaderChange(): void {
  tone({ freq: 440, freqEnd: 660, durMs: 140, type: 'triangle', gain: 0.06 });
}

const PACK_LADDER = [523, 659, 784, 1046, 1318, 1568, 2093];
const PACK_RARITY_INDEX: Record<string, number> = {
  Ember: 1,
  Eruption: 2,
  Apex: 3,
  Titan: 4,
  Eclipse: 5,
  Immortal: 6,
};

export function arenaPackOpen(): void {
  noiseBurst(70, 0.04, 0, 2000);
  tone({ freq: 500, freqEnd: 900, durMs: 120, type: 'sine', gain: 0.07 });
}

export function arenaPackReveal(rarity?: string): void {
  const steps = rarity ? (PACK_RARITY_INDEX[rarity] ?? 1) : 1;
  const notes = PACK_LADDER.slice(0, Math.max(2, Math.min(PACK_LADDER.length, steps + 1)));
  notes.forEach((freq, i) => {
    blip(freq, i === notes.length - 1 ? 220 : 100, 'triangle', 0.07, i * 90);
  });
  if (steps >= 5) {
    noiseBurst(200, 0.03, notes.length * 90, 4000);
  }
}

export function arenaDuplicate(): void {
  tone({ freq: 300, freqEnd: 200, durMs: 140, type: 'sawtooth', gain: 0.04 });
}

export function arenaBlockComplete(record: { wins: number; losses: number } | null = null): void {
  arenaBuzzer();
  if (!record) {
    arenaConfirm();
    return;
  }
  if (record.wins > record.losses) {
    blip(523, 120, 'triangle', 0.09, 260);
    blip(659, 120, 'triangle', 0.09, 370);
    blip(784, 160, 'triangle', 0.09, 480);
    blip(1046, 260, 'sine', 0.08, 590);
  } else if (record.wins < record.losses) {
    blip(200, 160, 'sawtooth', 0.05, 260);
    blip(150, 220, 'sawtooth', 0.045, 380);
  } else {
    blip(740, 90, 'triangle', 0.07, 260);
    blip(1108, 120, 'sine', 0.06, 340);
  }
}
