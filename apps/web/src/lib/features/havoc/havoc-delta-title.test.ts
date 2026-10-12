import { describe, expect, it } from 'vitest';
import { havocDeltaTitle } from './havoc-presentation';
describe('Havoc delta titles', () => {
  it.each([
    [-20, 'Havoc overload'],
    [-19, 'Backfire'],
    [-10, 'Backfire'],
    [-9, 'Power tradeoff'],
    [-1, 'Power tradeoff'],
    [0, 'Even split'],
    [1, 'Extra edge'],
    [9, 'Extra edge'],
    [10, 'Power surge'],
    [19, 'Power surge'],
    [20, 'Game changers'],
  ])('labels a %i win delta as %s', (delta, title) => {
    expect(havocDeltaTitle(delta)).toBe(title);
  });
});
