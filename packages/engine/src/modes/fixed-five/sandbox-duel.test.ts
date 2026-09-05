import { describe, expect, it } from 'vitest';
import type { FranchiseId, PlayerId, SlotIndex } from '@hoop-rush/data-contracts';
import {
  eraIdSchema,
  franchiseIdSchema,
  playerIdSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { seedFromString } from '@hoop-rush/test-fixtures';
import type { FixedFiveCandidate } from './sandbox-builder.ts';
import {
  claimSandboxDuelPlayer,
  createSandboxDuelDraft,
  isSandboxDuelComplete,
  sandboxDuelAlternationHolds,
  sandboxDuelPicker,
  sandboxDuelPicksFor,
  type SandboxDuelState,
} from './sandbox-duel.ts';
import { chooseAutopick, enumerateSandboxDuelSafeMoves } from './timeout.ts';
const pid = (value: string): PlayerId => playerIdSchema.parse(value);
const slot = (value: SlotIndex): SlotIndex => value;
const ROOT = seedSchema.parse(seedFromString('sandbox-duel-golden'));
function candidatePool(): FixedFiveCandidate[] {
  const defs: Array<{
    playerId: string;
    positions: FixedFiveCandidate['positions'];
    score: number;
  }> = [
    { playerId: 'p-g1', positions: ['PG'], score: 90 },
    { playerId: 'p-g2', positions: ['SG'], score: 88 },
    { playerId: 'p-g3', positions: ['PG', 'SG'], score: 85 },
    { playerId: 'p-f1', positions: ['SF'], score: 87 },
    { playerId: 'p-f2', positions: ['PF'], score: 86 },
    { playerId: 'p-f3', positions: ['SF', 'PF'], score: 84 },
    { playerId: 'p-c1', positions: ['C'], score: 89 },
    { playerId: 'p-c2', positions: ['PF', 'C'], score: 83 },
  ];
  const fid = (value: string): FranchiseId => franchiseIdSchema.parse(value);
  return defs.map((d) => ({
    playerId: pid(d.playerId),
    playerVersionId: `pv-${d.playerId}`,
    positions: d.positions,
    selectionScore: d.score,
    franchiseId: fid('lakers'),
    eraId: eraIdSchema.parse('1990s'),
  }));
}
function claim(
  state: SandboxDuelState,
  pool: FixedFiveCandidate[],
  playerId: string,
  slotIndex: number,
): SandboxDuelState {
  const actor = sandboxDuelPicker(state);
  return claimSandboxDuelPlayer(state, pool, {
    playerId: pid(playerId),
    slotIndex: slot(slotIndex),
    actor,
  });
}
describe('sandbox duel draft', () => {
  it('alternates picks starting from the seeded first picker', () => {
    const pool = candidatePool();
    let state = createSandboxDuelDraft(ROOT, 'p1');
    expect(sandboxDuelPicker(state)).toBe('p1');
    state = claim(state, pool, 'p-g1', 0);
    expect(sandboxDuelPicker(state)).toBe('p2');
    state = claim(state, pool, 'p-g2', 1);
    expect(sandboxDuelPicker(state)).toBe('p1');
    expect(sandboxDuelAlternationHolds(state)).toBe(true);
    expect(state.pickOrdinal).toBe(2);
  });
  it('rejects out-of-turn claims', () => {
    const pool = candidatePool();
    const state = createSandboxDuelDraft(ROOT, 'p1');
    expect(() =>
      claimSandboxDuelPlayer(state, pool, {
        playerId: pid('p-g1'),
        slotIndex: slot(0),
        actor: 'p2',
      }),
    ).toThrow();
  });
  it('allows the same player on both fives but not twice on one five', () => {
    const pool = candidatePool();
    let state = createSandboxDuelDraft(ROOT, 'p1');
    state = claim(state, pool, 'p-g1', 0);
    state = claim(state, pool, 'p-g1', 0);
    expect(sandboxDuelPicksFor(state, 'p2').map((p) => p.playerId)).toContain(pid('p-g1'));
    expect(() =>
      claimSandboxDuelPlayer(state, pool, {
        playerId: pid('p-g1'),
        slotIndex: slot(1),
        actor: 'p1',
      }),
    ).toThrow();
    expect(state.picks.length).toBe(2);
  });
  it('rejects illegal slots and unknown players', () => {
    const pool = candidatePool();
    const state = createSandboxDuelDraft(ROOT, 'p1');
    expect(() =>
      claimSandboxDuelPlayer(state, pool, {
        playerId: pid('p-c1'),
        slotIndex: slot(0),
        actor: 'p1',
      }),
    ).toThrow();
    expect(() =>
      claimSandboxDuelPlayer(state, pool, {
        playerId: pid('nope'),
        slotIndex: slot(0),
        actor: 'p1',
      }),
    ).toThrow();
  });
  it('completes after ten alternating picks with five per side', () => {
    const pool = candidatePool();
    const plan: Array<[string, number]> = [
      ['p-g1', 0],
      ['p-g2', 1],
      ['p-f1', 2],
      ['p-f2', 3],
      ['p-c1', 4],
      ['p-g1', 0],
      ['p-g3', 1],
      ['p-f3', 2],
      ['p-c2', 3],
      ['p-c1', 4],
    ];
    let state = createSandboxDuelDraft(ROOT, 'p1');
    for (const [playerId, slotIndex] of plan) {
      state = claim(state, pool, playerId, slotIndex);
    }
    expect(isSandboxDuelComplete(state)).toBe(true);
    expect(sandboxDuelPicksFor(state, 'p1')).toHaveLength(5);
    expect(sandboxDuelPicksFor(state, 'p2')).toHaveLength(5);
    expect(sandboxDuelAlternationHolds(state)).toBe(true);
    expect(() => sandboxDuelPicker(state)).toThrow();
  });
  it('enumerates feasible autopick moves scoped to the picker', () => {
    const pool = candidatePool();
    let state = createSandboxDuelDraft(ROOT, 'p1');
    state = claim(state, pool, 'p-g1', 0);
    const moves = enumerateSandboxDuelSafeMoves(pool, state);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.slotIndex !== slot(0))).toBe(false);
    const picked = chooseAutopick(ROOT, 'duel', 'p2', state.pickOrdinal, moves);
    const applied = claimSandboxDuelPlayer(state, pool, {
      playerId: picked.playerId,
      slotIndex: picked.slotIndex,
      actor: 'p2',
    });
    expect(applied.picks.length).toBe(2);
  });
});
