import { describe, expect, it } from 'vitest';
import { clamp, clampRating, safeFloat, safeInt, sha256Hex } from './json.ts';

describe('json helpers', () => {
  it('safeFloat mirrors Python _safe_float', () => {
    expect(safeFloat(7.5)).toBe(7.5);
    expect(safeFloat('7.5')).toBe(7.5);
    expect(safeFloat(null, 3)).toBe(3);
    expect(safeFloat(undefined, 3)).toBe(3);
    expect(safeFloat('', 3)).toBe(3);
    expect(safeFloat('nope', 3)).toBe(3);
    expect(safeFloat(Number.NaN, 3)).toBe(3);
    expect(safeFloat(Number.POSITIVE_INFINITY, 3)).toBe(3);
    expect(safeFloat(true)).toBe(1);
  });

  it('safeInt truncates toward zero like Python int(float())', () => {
    expect(safeInt(7.9)).toBe(7);
    expect(safeInt(-7.9)).toBe(-7);
    expect(safeInt('12.6')).toBe(12);
    expect(safeInt(Number.NaN, 5)).toBe(5);
    expect(safeInt(null, 5)).toBe(5);
  });

  it('clamp and clampRating', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    // clampRating truncates like Python int(clamp(v, 0, 100))
    expect(clampRating(99.9)).toBe(99);
    expect(clampRating(-5)).toBe(0);
    expect(clampRating(120)).toBe(100);
  });

  it('sha256Hex matches known digest', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
