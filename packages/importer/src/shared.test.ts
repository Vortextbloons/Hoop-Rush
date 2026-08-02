import { describe, expect, it } from 'vitest';
import { createRng, pythonSeasonSeed } from './rng.js';
import { clamp, clampRating, safeFloat, safeInt, sha256Hex } from './json.js';

describe('rng', () => {
  it('is deterministic for the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const drawsA = Array.from({ length: 1000 }, () => a.gauss(0, 2));
    const drawsB = Array.from({ length: 1000 }, () => b.gauss(0, 2));
    expect(drawsA).toEqual(drawsB);
  });

  it('produces different streams for different seeds', () => {
    const a = createRng(1).next();
    const b = createRng(2).next();
    expect(a).not.toBe(b);
  });

  it('next() stays in [0, 1)', () => {
    const rng = createRng(42);
    for (let i = 0; i < 10_000; i += 1) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('gauss draws are approximately standard normal', () => {
    const rng = createRng(7);
    let sum = 0;
    let sumSq = 0;
    const n = 50_000;
    for (let i = 0; i < n; i += 1) {
      const v = rng.gauss();
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
  });

  it('derives the Python-compatible season seed', () => {
    expect(pythonSeasonSeed('1995-96')).toBe((parseInt('d3f965d7cc95', 16) + 42) >>> 0);
    expect(pythonSeasonSeed('2024-25')).toBe((parseInt('fea15f4127ef', 16) + 42) >>> 0);
  });
});

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
