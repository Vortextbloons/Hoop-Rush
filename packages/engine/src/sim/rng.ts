import { FNV_OFFSET_32, fnv1a32, hex32 } from '@hoop-rush/data-contracts';
export { FNV_OFFSET_32, fnv1a32, hex32 };
export interface WeightedPickTable {
  readonly weights: readonly number[];
  readonly total: number;
}
export function buildWeightedPickTable(weights: readonly number[]): WeightedPickTable {
  const clamped: number[] = [];
  let total = 0;
  for (const weight of weights) {
    const value = Math.max(0, weight);
    clamped.push(value);
    total += value;
  }
  return { weights: clamped, total };
}
function isWeightedPickTable(value: readonly number[] | WeightedPickTable): value is WeightedPickTable {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'total' in value &&
    'weights' in value
  );
}
function weightedPickFromTable<T>(
  items: readonly T[],
  table: WeightedPickTable,
  draw: () => number,
  pickUniform: () => T,
): T {
  if (items.length === 0) throw new Error('weightedPick: cannot pick from an empty list');
  if (table.total <= 0) return pickUniform();
  let roll = draw() * table.total;
  for (let i = 0; i < items.length; i += 1) {
    const w = table.weights[i] ?? 0;
    if (roll < w) {
      const item = items[i];
      if (item === undefined) {
        throw new Error(`weightedPick: no item at index ${String(i)}`);
      }
      return item;
    }
    roll -= w;
  }
  const last = items[items.length - 1];
  if (last === undefined) {
    throw new Error('weightedPick: index out of range');
  }
  return last;
}
export interface Rng {
  next(): number;
  chance(probability: number): boolean;
  nextInt(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  weightedPick<T>(items: readonly T[], weights: readonly number[] | WeightedPickTable): T;
}
export function swapAt(values: unknown[], a: number, b: number): void {
  const va = values[a];
  const vb = values[b];
  if (va === undefined || vb === undefined) {
    throw new Error(`shuffle: index out of range (${String(a)}, ${String(b)})`);
  }
  values[a] = vb;
  values[b] = va;
}
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    swapAt(result, i, rng.nextInt(0, i));
  }
  return result;
}
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function createRng(seed: string, position = 0): Rng {
  const next = mulberry32(fnv1a32(seed));
  for (let i = 0; i < position; i += 1) next();
  function draw(): number {
    return next();
  }
  return {
    next: draw,
    chance(probability) {
      if (probability <= 0) return false;
      if (probability >= 1) return true;
      return draw() < probability;
    },
    nextInt(min, max) {
      if (max < min) throw new Error(`nextInt: max (${String(max)}) < min (${String(min)})`);
      if (max === min) return min;
      return Math.floor(draw() * (max - min + 1)) + min;
    },
    pick(items) {
      if (items.length === 0) throw new Error('pick: cannot pick from an empty list');
      const item = items[this.nextInt(0, items.length - 1)];
      if (item === undefined) {
        throw new Error('pick: index out of range');
      }
      return item;
    },
    weightedPick(items, weights) {
      if (items.length === 0) throw new Error('weightedPick: cannot pick from an empty list');
      if (isWeightedPickTable(weights)) {
        return weightedPickFromTable(items, weights, draw, () => this.pick(items));
      }
      if (items.length !== weights.length) {
        throw new Error(
          `weightedPick: items (${String(items.length)}) and weights (${String(weights.length)}) length mismatch`,
        );
      }
      return weightedPickFromTable(
        items,
        buildWeightedPickTable(weights),
        draw,
        () => this.pick(items),
      );
    },
  };
}
