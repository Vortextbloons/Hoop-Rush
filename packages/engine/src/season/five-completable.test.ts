import { describe, expect, it } from 'vitest';
import {
  fiveCompletable,
  legalFiveExists,
  type SeasonRosterMemberInput,
} from './roster-rules.ts';

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;

function bruteFiveCompletable(
  owned: readonly SeasonRosterMemberInput[],
  available: readonly SeasonRosterMemberInput[],
  remainingPicks: number,
): boolean {
  if (owned.length + remainingPicks !== 10) return false;
  if (available.length < remainingPicks) return false;
  if (legalFiveExists(owned)) return true;
  if (remainingPicks <= 0) return false;
  const n = available.length;
  const take: number[] = [];
  const rec = (start: number, left: number): boolean => {
    if (left === 0) {
      const ten = [...owned, ...take.map((i) => available[i] as SeasonRosterMemberInput)];
      return legalFiveExists(ten);
    }
    for (let i = start; i < n; i += 1) {
      take.push(i);
      if (rec(i + 1, left - 1)) return true;
      take.pop();
    }
    return false;
  };
  for (let k = 1; k <= Math.min(remainingPicks, n); k += 1) {
    if (rec(0, k)) return true;
  }
  return false;
}

let seed = 12345;
function rand(n: number): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
}

function randomMember(id: string): SeasonRosterMemberInput {
  const count = 1 + rand(3);
  const playable: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const p = POSITIONS[rand(5)] as string;
    if (!playable.includes(p)) playable.push(p);
  }
  return { playerVersionId: id, playable: playable as SeasonRosterMemberInput['playable'] };
}

describe('fiveCompletable', () => {
  it('matches brute force with no scarcity margin', () => {
    const mismatches: unknown[] = [];
    for (let trial = 0; trial < 400; trial += 1) {
      const ownedSize = rand(10);
      const availSize = rand(13);
      const remaining = 10 - ownedSize;
      const owned = Array.from({ length: ownedSize }, (_, i) => randomMember(`o${trial}-${i}`));
      const available = Array.from({ length: availSize }, (_, i) =>
        randomMember(`a${trial}-${i}`),
      );
      const got = fiveCompletable(owned, available, remaining, 0);
      const want = bruteFiveCompletable(owned, available, remaining);
      if (got !== want) {
        mismatches.push({
          trial,
          owned: owned.map((m) => m.playable),
          available: available.map((m) => m.playable),
          remaining,
          got,
          want,
        });
        if (mismatches.length >= 3) break;
      }
    }
    expect(mismatches).toEqual([]);
  });
  it('margin acceptance implies robustness to any K removals', () => {
    const savedSeed = seed;
    seed = 987654321;
    let checked = 0;
    for (let trial = 0; trial < 300; trial += 1) {
      const ownedSize = rand(10);
      const availSize = rand(9);
      const remaining = 10 - ownedSize;
      const margin = rand(3);
      const owned = Array.from({ length: ownedSize }, (_, i) => randomMember(`m${trial}-${i}`));
      const available = Array.from({ length: availSize }, (_, i) =>
        randomMember(`n${trial}-${i}`),
      );
      if (!fiveCompletable(owned, available, remaining, margin)) continue;
      checked += 1;
      const indices = available.map((_, i) => i);
      const removals: number[][] = [[]];
      for (let size = 1; size <= Math.min(margin, indices.length); size += 1) {
        const combo = (start: number, left: number, acc: number[]): void => {
          if (left === 0) {
            removals.push([...acc]);
            return;
          }
          for (let i = start; i < indices.length; i += 1) {
            acc.push(indices[i] as number);
            combo(i + 1, left - 1, acc);
            acc.pop();
          }
        };
        combo(0, size, []);
      }
      for (const removal of removals) {
        const removed = new Set(removal);
        const rest = available.filter((_, i) => !removed.has(i));
        if (rest.length < remaining) continue;
        expect(bruteFiveCompletable(owned, rest, remaining)).toBe(true);
      }
    }
    seed = savedSeed;
    expect(checked).toBeGreaterThan(0);
  });
  it('rejects the single-body two-need trap within one pick', () => {
    const c = (id: string, ...playable: string[]): SeasonRosterMemberInput => ({
      playerVersionId: id,
      playable: playable as SeasonRosterMemberInput['playable'],
    });
    const ownedNine = [
      c('o-1', 'PG'),
      c('o-2', 'PG'),
      c('o-3', 'PG'),
      c('o-4', 'PG'),
      c('o-5', 'PG'),
      c('o-6', 'PG'),
      c('o-7', 'PG'),
      c('o-8', 'PG'),
      c('o-9', 'SF'),
    ];
    const swing = [c('a-1', 'PF', 'C')];
    expect(fiveCompletable(ownedNine, swing, 1, 0)).toBe(false);
    expect(fiveCompletable(ownedNine, swing, 1, 1)).toBe(false);
    expect(fiveCompletable(ownedNine, [], 1, 0)).toBe(false);
    const ownedEight = [...ownedNine.slice(0, 7), c('o-9', 'SF')];
    const pair = [c('a-1', 'PF'), c('a-2', 'C')];
    expect(fiveCompletable(ownedEight, pair, 2, 0)).toBe(true);
    expect(fiveCompletable(ownedEight, pair, 2, 1)).toBe(false);
    expect(fiveCompletable(ownedEight, [], 2, 0)).toBe(false);
  });
});
