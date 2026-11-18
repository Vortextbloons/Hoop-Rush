import { describe, expect, it } from 'bun:test';
import { CAP_RUSH_SPIN_PURCHASES } from '@hoop-rush/data-contracts';
import { capRushSpinOutcomeRows, capRushSpinPurchaseLabel } from './cap-rush-presentation.ts';

describe('cap rush spin presentation', () => {
  it('names both purchases', () => {
    expect(capRushSpinPurchaseLabel('standard')).toBe('Mutation Spark');
    expect(capRushSpinPurchaseLabel('surge')).toBe('Mutation Surge');
  });

  it('describes exact Spark outcomes and odds', () => {
    expect(capRushSpinOutcomeRows('standard', CAP_RUSH_SPIN_PURCHASES.standard.tierOdds)).toEqual([
      { tier: 1, label: '1 Tier 1 mutation', odds: 0.7 },
      { tier: 2, label: '1 Tier 2 mutation', odds: 0.3 },
      { tier: 3, label: 'No Tier 3 outcome', odds: 0 },
    ]);
  });

  it('describes exact Surge outcomes and odds', () => {
    expect(capRushSpinOutcomeRows('surge', CAP_RUSH_SPIN_PURCHASES.surge.tierOdds)).toEqual([
      { tier: 1, label: '3 Tier 1 mutations', odds: 0.6 },
      { tier: 2, label: '2 mutations: 1 Tier 2 + 1 Tier 1', odds: 0.3 },
      { tier: 3, label: '1 Tier 3 mutation', odds: 0.1 },
    ]);
  });
});
