import { describe, expect, it } from 'vitest';
import { canonicalPlayerName } from './identity.ts';

describe('canonicalPlayerName', () => {
  it.each([
    ['2397', 'Yao', 'Ming'],
    ['201146', 'Yi', 'Jianlian'],
    ['2403', 'Nene', 'Hilario'],
    ['1642905', 'Hansen', 'Yang'],
    ['76353', 'Joe Barry', 'Carroll'],
  ])('canonicalizes external id %s', (externalId, firstName, lastName) => {
    expect(canonicalPlayerName(externalId, 'nickname', 'nickname')).toEqual([firstName, lastName]);
  });

  it('keeps unknown player names unchanged', () => {
    expect(canonicalPlayerName('unknown', 'First', 'Last')).toEqual(['First', 'Last']);
  });
});
