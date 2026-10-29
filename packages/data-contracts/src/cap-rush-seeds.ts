import { z } from 'zod';
import type { CapRushBucket } from './cap-rush-versions.ts';
import {
  CAP_RUSH_DRAFT_ROUNDS,
  CAP_RUSH_SEED_DERIVATION_VERSION,
  CAP_RUSH_SEED_ROOT,
} from './cap-rush-versions.ts';
import { positionSchema, type Position } from './positions.ts';
import { seedSchema } from './ids.ts';
import { seasonDigestHex } from './season-hash.ts';

type Seed = z.infer<typeof seedSchema>;

function capRushSeed(...parts: readonly (string | number)[]): Seed {
  return seedSchema.parse(
    seasonDigestHex(
      [
        CAP_RUSH_SEED_DERIVATION_VERSION,
        CAP_RUSH_SEED_ROOT,
        ...parts.map((part) => String(part)),
      ].join('\u0000'),
    ),
  );
}

function assertRound(round: number): void {
  if (!Number.isInteger(round) || round < 1 || round > CAP_RUSH_DRAFT_ROUNDS) {
    throw new Error(
      `cap rush draft round must be an integer in 1..${String(CAP_RUSH_DRAFT_ROUNDS)} (got ${String(round)})`,
    );
  }
}

function assertOfferRevision(offerRevision: number): void {
  if (!Number.isInteger(offerRevision) || offerRevision < 0) {
    throw new Error(
      `cap rush offer revision must be a nonnegative integer (got ${String(offerRevision)})`,
    );
  }
}

function assertAttempt(attempt: number): void {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error(`cap rush generation attempt must be nonnegative (got ${String(attempt)})`);
  }
}

export function capRushOfferSeed(
  runSeed: Seed,
  round: number,
  slot: Position,
  offerRevision: number,
): Seed {
  assertRound(round);
  positionSchema.parse(slot);
  assertOfferRevision(offerRevision);
  return capRushSeed(runSeed, 'draft', round, 'slot', slot, 'offer', offerRevision);
}

export function capRushOfferBucketSeed(
  runSeed: Seed,
  round: number,
  slot: Position,
  offerRevision: number,
  bucket: CapRushBucket,
  attempt: number,
): Seed {
  assertAttempt(attempt);
  return capRushSeed(
    capRushOfferSeed(runSeed, round, slot, offerRevision),
    'bucket',
    bucket,
    'attempt',
    attempt,
  );
}

export function capRushOfferShuffleSeed(
  runSeed: Seed,
  round: number,
  slot: Position,
  offerRevision: number,
  attempt: number,
): Seed {
  assertAttempt(attempt);
  return capRushSeed(
    capRushOfferSeed(runSeed, round, slot, offerRevision),
    'display-shuffle',
    'attempt',
    attempt,
  );
}

export function capRushSpinTierSeed(runSeed: Seed): Seed {
  return capRushSeed(runSeed, 'spin', 'tier');
}

export function capRushSpinMutationSeed(runSeed: Seed): Seed {
  return capRushSeed(runSeed, 'spin', 'mutation');
}

export function capRushSpinPhysicalSeed(runSeed: Seed): Seed {
  return capRushSeed(runSeed, 'spin', 'physical');
}

export function capRushSpinSpecialistSeed(runSeed: Seed): Seed {
  return capRushSeed(runSeed, 'spin', 'specialist');
}
