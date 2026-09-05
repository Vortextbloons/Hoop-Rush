import { describe, expect, it } from 'vitest';
import { seasonTierFromWins } from './season-tier';
describe('seasonTierFromWins', () => {
  it('classifies perfect, contender, playoff, lottery, and tanking bands', () => {
    expect(seasonTierFromWins(82).tier).toBe('perfect');
    expect(seasonTierFromWins(69).tier).toBe('contender');
    expect(seasonTierFromWins(55).tier).toBe('contender');
    expect(seasonTierFromWins(54).tier).toBe('playoff');
    expect(seasonTierFromWins(42).tier).toBe('playoff');
    expect(seasonTierFromWins(41).tier).toBe('lottery');
    expect(seasonTierFromWins(30).tier).toBe('lottery');
    expect(seasonTierFromWins(29).tier).toBe('tanking');
    expect(seasonTierFromWins(0).tier).toBe('tanking');
  });
});
