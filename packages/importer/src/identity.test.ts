import { describe, expect, it } from 'vitest';
import { canonicalPlayerName } from './identity.ts';

describe('canonicalPlayerName', () => {
  it('repairs the source split for Joe Barry Carroll by stable ID', () => {
    expect(canonicalPlayerName('76353', 'Joe Barry', 'Barry Carroll')).toEqual([
      'Joe Barry',
      'Carroll',
    ]);
  });

  it('leaves unrelated source names unchanged', () => {
    expect(canonicalPlayerName('1', 'Alpha', 'Ace')).toEqual(['Alpha', 'Ace']);
  });
});
