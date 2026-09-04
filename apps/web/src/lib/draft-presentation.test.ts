import { describe, expect, it } from 'vitest';
import type { PlayersIndexEntry } from '@hoop-rush/data-contracts';
import {
  eraIdSchema,
  franchiseIdSchema,
  playerIdSchema,
  seasonKeySchema,
} from '@hoop-rush/data-contracts';
import {
  presentationForVariant,
  ratingBadges,
  sortDraftRows,
} from './draft-presentation';
function row(
  partial: Omit<Partial<PlayersIndexEntry>, 'playerId' | 'franchiseId' | 'eraId' | 'seasonKey'> & {
    playerId: string;
    franchiseId?: string;
    eraId?: string;
    seasonKey?: string;
  },
): PlayersIndexEntry {
  const {
    playerId,
    franchiseId = 'lakers',
    eraId = '1990s',
    seasonKey = '1990-91',
    ...rest
  } = partial;
  return {
    franchiseId: franchiseIdSchema.parse(franchiseId),
    eraId: eraIdSchema.parse(eraId),
    seasonKey: seasonKeySchema.parse(seasonKey),
    playerId: playerIdSchema.parse(playerId),
    firstName: 'Test',
    lastName: 'Player',
    displayName: 'Test Player',
    playerExternalId: '1',
    altIds: null,
    positionsPlayable: ['SF'],
    overall: 70,
    offense: 70,
    defense: 70,
    selectionScore: 50,
    ...rest,
  };
}
describe('sortDraftRows', () => {
  it('sorts sandbox pools by overall descending, then display name', () => {
    const low = row({ playerId: 'low', displayName: 'Aaron Low', overall: 60 });
    const high = row({ playerId: 'high', displayName: 'Zed High', overall: 92 });
    const tieA = row({ playerId: 'tie-a', displayName: 'Anna Tie', overall: 80 });
    const tieB = row({ playerId: 'tie-b', displayName: 'Bob Tie', overall: 80 });
    const sorted = sortDraftRows([low, tieB, high, tieA], 'sandbox');
    expect(sorted.map((r) => r.playerId)).toEqual(['high', 'tie-a', 'tie-b', 'low']);
  });
  it('sorts ball-knowledge pools alphabetically by normalized display name', () => {
    const zed = row({ playerId: 'zed', displayName: 'Zed Zoster', overall: 99 });
    const aaron = row({ playerId: 'aaron', displayName: 'Aaron Aardvark', overall: 1 });
    const sorted = sortDraftRows([zed, aaron], 'ball-knowledge');
    expect(sorted.map((r) => r.playerId)).toEqual(['aaron', 'zed']);
  });
  it('ball-knowledge ties break by lastName, firstName, then playerId', () => {
    const same = { displayName: 'Magic Johnson', lastName: 'Johnson', firstName: 'Magic' } as const;
    const z = row({ playerId: 'z', ...same });
    const a = row({ playerId: 'a', ...same });
    const abbott = row({
      playerId: 'm',
      displayName: 'Magic Johnson',
      lastName: 'Abbott',
      firstName: 'Magic',
    });
    const sorted = sortDraftRows([z, a, abbott], 'ball-knowledge');
    expect(sorted.map((r) => r.playerId)).toEqual(['m', 'a', 'z']);
  });
  it('ball-knowledge never falls back to unstable array order for equal identities', () => {
    const x = row({ playerId: 'x', displayName: 'Dup Name' });
    const y = row({ playerId: 'y', displayName: 'Dup Name' });
    expect(sortDraftRows([y, x], 'ball-knowledge').map((r) => r.playerId)).toEqual(['x', 'y']);
    expect(sortDraftRows([x, y], 'ball-knowledge').map((r) => r.playerId)).toEqual(['x', 'y']);
  });
  it('ball-knowledge compares display names case-insensitively', () => {
    const zed = row({ playerId: 'zed', displayName: 'ZED' });
    const aaron = row({ playerId: 'aaron', displayName: 'aaron' });
    expect(sortDraftRows([zed, aaron], 'ball-knowledge').map((r) => r.playerId)).toEqual([
      'aaron',
      'zed',
    ]);
  });
  it('never mutates the input array', () => {
    const a = row({ playerId: 'a', displayName: 'Aaron A', overall: 80 });
    const b = row({ playerId: 'b', displayName: 'Zed Z', overall: 90 });
    const input = [a, b];
    sortDraftRows(input, 'sandbox');
    sortDraftRows(input, 'ball-knowledge');
    expect(input.map((r) => r.playerId)).toEqual(['a', 'b']);
  });
});
describe('ratingBadges', () => {
  const player = row({ playerId: 'x', overall: 92, offense: 90, defense: 88 });
  it('shows only Overall for sandbox', () => {
    expect(ratingBadges(player, 'sandbox')).toEqual([{ label: 'O', value: 92 }]);
  });
  it('shows only Overall for ratings', () => {
    expect(ratingBadges(player, 'ratings')).toEqual([{ label: 'O', value: 92 }]);
  });
  it('shows no rating badges for ball-knowledge', () => {
    expect(ratingBadges(player, 'ball-knowledge')).toEqual([]);
  });
  it('never reads or emits offense/defense values (presentation-only claim)', () => {
    const pristine = row({ playerId: 'y', overall: 71, offense: 55, defense: 44 });
    const snapshot = { ...pristine };
    ratingBadges(pristine, 'sandbox');
    ratingBadges(pristine, 'ratings');
    ratingBadges(pristine, 'ball-knowledge');
    expect(pristine).toEqual(snapshot);
    expect(snapshot.offense).toBe(55);
    expect(snapshot.defense).toBe(44);
    expect(ratingBadges(pristine, 'ratings')).toEqual([{ label: 'O', value: 71 }]);
  });
});
describe('presentationForVariant', () => {
  it('maps each variant to its draft presentation', () => {
    expect(presentationForVariant('ratings')).toBe('ratings');
    expect(presentationForVariant('ball-knowledge')).toBe('ball-knowledge');
  });
});
