import { z } from 'zod';
import { seedSchema } from './ids.ts';
import { seasonDigestHex } from './season-hash.ts';
import { HAVOC_SEED_ROOT, HAVOC_SEED_DERIVATION_VERSION } from './havoc-versions.ts';

type Seed = z.infer<typeof seedSchema>;

function havocSeed(...parts: readonly (string | number)[]): Seed {
  return seedSchema.parse(
    seasonDigestHex(
      [HAVOC_SEED_DERIVATION_VERSION, HAVOC_SEED_ROOT, ...parts.map((part) => String(part))].join(
        '\u0000',
      ),
    ),
  );
}

function assertRound(round: number): void {
  if (!Number.isInteger(round) || round < 1 || round > 5) {
    throw new Error(`havoc draft round must be an integer in 1..5 (got ${String(round)})`);
  }
}

function assertOfferIndex(offerIndex: number): void {
  if (!Number.isInteger(offerIndex) || offerIndex < 0) {
    throw new Error(`havoc offer index must be a nonnegative integer (got ${String(offerIndex)})`);
  }
}

function assertGameNumber(gameNumber: number): void {
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 82) {
    throw new Error(`havoc game number must be an integer in 1..82 (got ${String(gameNumber)})`);
  }
}

export function havocDraftWindowSeed(runSeed: Seed, round: number, offerIndex: number): Seed {
  assertRound(round);
  assertOfferIndex(offerIndex);
  return havocSeed(runSeed, 'draft', round, 'offer', offerIndex, 'window');
}

export function havocDraftPlayersSeed(runSeed: Seed, round: number, offerIndex: number): Seed {
  assertRound(round);
  assertOfferIndex(offerIndex);
  return havocSeed(runSeed, 'draft', round, 'offer', offerIndex, 'players');
}

export type HavocDraftCardStream = 'tier' | 'mutations' | 'physical' | 'nickname';

export function havocDraftCardSeed(
  runSeed: Seed,
  round: number,
  offerIndex: number,
  cardIndex: number,
  stream: HavocDraftCardStream,
): Seed {
  assertRound(round);
  assertOfferIndex(offerIndex);
  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex > 2) {
    throw new Error(`havoc card index must be an integer in 0..2 (got ${String(cardIndex)})`);
  }
  return havocSeed(runSeed, 'draft', round, 'offer', offerIndex, 'card', cardIndex, stream);
}

export function havocGameSeed(runSeed: Seed, gameNumber: number): Seed {
  assertGameNumber(gameNumber);
  return havocSeed(runSeed, 'game', gameNumber, 'basketball');
}
export function havocMutationStreamSeed(
  runSeed: Seed,
  gameNumber: number,
  instanceId: string,
  effect: string,
  eventOrdinal: number,
): Seed {
  assertGameNumber(gameNumber);
  if (!Number.isInteger(eventOrdinal) || eventOrdinal < 0) {
    throw new Error(
      `havoc event ordinal must be a nonnegative integer (got ${String(eventOrdinal)})`,
    );
  }
  return havocSeed(runSeed, 'game', gameNumber, 'mutation', instanceId, effect, eventOrdinal);
}
export function havocInstanceSeed(
  runSeed: Seed,
  purpose: string,
  ...keys: readonly (string | number)[]
): Seed {
  return havocSeed(runSeed, 'instance', purpose, ...keys);
}
