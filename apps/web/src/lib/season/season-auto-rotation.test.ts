import { describe, expect, it } from 'vitest';
import { buildMinimalRotation } from '@hoop-rush/engine';
import type { SeasonRotation } from '@hoop-rush/data-contracts';
import {
  AutoUndoState,
  autoEngineArgsOf,
  autoUndoKeyOf,
  buildAutoRecommendInput,
  cloneRotation,
  hasActiveSwaps,
  swapPairsOf,
} from './season-auto-rotation';

function fixtureRotation(): SeasonRotation {
  const versionId = (n: number) => `pv-${String(n).padStart(32, '0')}`;
  const players = [
    { playerVersionId: versionId(1), playable: ['PG'] as const },
    { playerVersionId: versionId(2), playable: ['SG'] as const },
    { playerVersionId: versionId(3), playable: ['SF'] as const },
    { playerVersionId: versionId(4), playable: ['PF'] as const },
    { playerVersionId: versionId(5), playable: ['C'] as const },
    { playerVersionId: versionId(6), playable: ['PG'] as const },
    { playerVersionId: versionId(7), playable: ['SG'] as const },
    { playerVersionId: versionId(8), playable: ['SF'] as const },
    { playerVersionId: versionId(9), playable: ['PF'] as const },
    { playerVersionId: versionId(10), playable: ['C'] as const },
  ];
  return buildMinimalRotation({
    franchiseId: 'lakers',
    members: players.map((player) => ({
      playerVersionId: player.playerVersionId,
      playable: [...player.playable],
    })),
  });
}

describe('autoEngineArgsOf', () => {
  it('maps Full Auto to full/false', () => {
    expect(autoEngineArgsOf('full-auto')).toEqual({ scope: 'full', keepActive10: false });
  });
  it('maps Minutes only to minutes-only/true', () => {
    expect(autoEngineArgsOf('minutes-only')).toEqual({ scope: 'minutes-only', keepActive10: true });
  });
  it('maps Keep my active 10 to full/true', () => {
    expect(autoEngineArgsOf('keep-10')).toEqual({ scope: 'full', keepActive10: true });
  });
});

describe('buildAutoRecommendInput', () => {
  it('builds a recommend input with scope mapping and defensive copies', () => {
    const current = fixtureRotation();
    const load = [
      {
        playerVersionId: 'pv-1',
        staminaRating: 80,
        durability: 75,
        fatigueBasisPoints: 1200,
        recentLoadBasisPoints: 800,
      },
    ];
    const overall = [{ playerVersionId: 'pv-1', overall: 82 }];
    const input = buildAutoRecommendInput({
      roster: ['pv-1', 'pv-2'],
      unavailable: ['pv-3'],
      current,
      load,
      overall,
      horizon: 10,
      seed: 'seed-1',
      option: 'full-auto',
    });
    expect(input.scope).toBe('full');
    expect(input.keepActive10).toBe(false);
    expect(input.roster).toEqual(['pv-1', 'pv-2']);
    expect(input.roster).not.toBe(['pv-1', 'pv-2']);
    expect(input.load).toEqual(load);
    expect(input.load[0]).not.toBe(load[0]);
  });
});

describe('swap helpers', () => {
  it('detects active swaps and lists in/out pairs', () => {
    const withSwaps = {
      status: 'recommended',
      changes: [
        { kind: 'swap', inPlayerVersionId: 'in-1', outPlayerVersionId: 'out-1', reason: 'r1' },
        { kind: 'minutes', playerVersionId: 'p', from: 10, to: 12, reason: 'r2' },
      ],
    } as unknown as Parameters<typeof hasActiveSwaps>[0];
    expect(hasActiveSwaps(withSwaps)).toBe(true);
    expect(swapPairsOf(withSwaps)).toEqual([
      { inPlayerVersionId: 'in-1', outPlayerVersionId: 'out-1', reason: 'r1' },
    ]);
    const withoutSwaps = {
      status: 'recommended',
      changes: [{ kind: 'minutes', playerVersionId: 'p', from: 10, to: 12, reason: 'r2' }],
    } as unknown as Parameters<typeof hasActiveSwaps>[0];
    expect(hasActiveSwaps(withoutSwaps)).toBe(false);
    expect(swapPairsOf(withoutSwaps)).toEqual([]);
  });
});

describe('AutoUndoState one-step undo', () => {
  it('captures pre-Auto and restores once, then clears', () => {
    const store = new AutoUndoState();
    const rotation = fixtureRotation();
    const key = autoUndoKeyOf('run-1', 0);
    expect(store.has(key)).toBe(false);
    store.capture(key, rotation);
    expect(store.has(key)).toBe(true);
    const peeked = store.peek(key);
    expect(peeked).toEqual(rotation);
    expect(peeked).not.toBe(rotation);
    (peeked as SeasonRotation).starters = ['tampered'];
    expect(store.peek(key)).toEqual(rotation);
    const taken = store.take(key);
    expect(taken).toEqual(rotation);
    expect(store.has(key)).toBe(false);
    expect(store.peek(key)).toBeNull();
  });

  it('invalidates on manual edit, block submit, or run change', () => {
    const store = new AutoUndoState();
    const rotation = fixtureRotation();
    const key = autoUndoKeyOf('run-1', 0);
    store.capture(key, rotation);
    store.invalidate();
    expect(store.has(key)).toBe(false);
    store.capture(key, rotation);
    expect(store.peek(autoUndoKeyOf('run-1', 1))).toBeNull();
    expect(store.peek(autoUndoKeyOf('run-2', 0))).toBeNull();
    store.capture(key, rotation);
    const other = cloneRotation(rotation);
    other.starters = [...other.starters].reverse();
    store.capture(key, other);
    expect(store.peek(key)).toEqual(other);
  });
});
