import type { Seed } from '@hoop-rush/data-contracts';
import { randomHex } from '$lib/random-hex';

/**
 * Season Run identity and seed generation at the UI boundary (spec/2.0/07).
 * Command ids and run ids follow the frozen id contract
 * (`packages/data-contracts/src/ids.ts`: `^[a-z0-9][a-z0-9._:-]*$`), and the
 * run root seed is 32 hex digits as the packaged `seedSchema` requires.
 * Identity generation is UI-only work: domain logic never derives ids here.
 */

export function newSeasonId(prefix: string): string {
  const random = randomHex(16);
  return `${prefix}-${random}`;
}

export function seasonRootSeed(): Seed {
  return randomHex(32);
}
