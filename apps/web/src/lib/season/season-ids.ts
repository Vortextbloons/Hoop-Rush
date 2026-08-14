import type { Seed } from '@hoop-rush/data-contracts';
import { randomHex } from '$lib/random-hex';

export function newSeasonId(prefix: string): string {
  const random = randomHex(16);
  return `${prefix}-${random}`;
}

export function seasonRootSeed(): Seed {
  return randomHex(32);
}
