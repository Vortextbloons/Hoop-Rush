import { describe, expect, it } from 'vitest';
import { canonicalPlayerName } from './identity.ts';
describe('canonicalPlayerName', () => {
  it('leaves unrelated source names unchanged', () => {
    expect(canonicalPlayerName('1', 'Alpha', 'Ace')).toEqual(['Alpha', 'Ace']);
  });
});
