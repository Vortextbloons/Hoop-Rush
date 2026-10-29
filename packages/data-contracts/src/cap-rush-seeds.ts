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

export function capRushAdditionalSpinSeed(runSeed: Seed, ordinal: number): Seed {
  if (!Number.isInteger(ordinal) || ordinal < 1) throw new Error('spin ordinal must be positive');
  return capRushSeed(runSeed, 'spin', 'purchase', ordinal);
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

export function capRushGameSeed(runSeed: Seed, gameNumber: number): Seed {
  if (!Number.isInteger(gameNumber) || gameNumber < 1) {
    throw new Error(`cap rush game number must be a positive integer (got ${String(gameNumber)})`);
  }
  return capRushSeed(runSeed, 'game', gameNumber);
}

export function capRushLeagueSeed(runSeed: Seed): Seed {
  return capRushSeed(runSeed, 'background-league');
}

export function capRushPlayoffGameSeed(
  runSeed: Seed,
  round: number,
  seriesSlot: number,
  gameOrdinal: number,
): Seed {
  if (!Number.isInteger(round) || round < 1 || round > 4) {
    throw new Error(`cap rush playoff round must be an integer in 1..4 (got ${String(round)})`);
  }
  if (!Number.isInteger(seriesSlot) || seriesSlot < 0 || seriesSlot > 7) {
    throw new Error(
      `cap rush playoff series slot must be an integer in 0..7 (got ${String(seriesSlot)})`,
    );
  }
  if (!Number.isInteger(gameOrdinal) || gameOrdinal < 1 || gameOrdinal > 7) {
    throw new Error(
      `cap rush playoff game ordinal must be an integer in 1..7 (got ${String(gameOrdinal)})`,
    );
  }
  return capRushSeed(runSeed, 'playoffs', round, seriesSlot, gameOrdinal);
}
