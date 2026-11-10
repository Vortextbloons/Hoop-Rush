import type { CapRushBucket } from './cap-rush-versions.ts';
import { seedSchema } from './ids.ts';
import { seasonDigestHex } from './season-hash.ts';
import { positionSchema, type Position } from './positions.ts';
import {
  CAP_RUSH_MULTIPLAYER_SEED_DERIVATION_VERSION,
  CAP_RUSH_MULTIPLAYER_SEED_ROOT,
  capRushMultiplayerSeatIdSchema,
  type CapRushMultiplayerSeatId,
} from './cap-rush-multiplayer-versions.ts';

type Seed = ReturnType<typeof seedSchema.parse>;

function multiplayerSeed(...parts: readonly (string | number)[]): Seed {
  return seedSchema.parse(
    seasonDigestHex(
      [
        CAP_RUSH_MULTIPLAYER_SEED_DERIVATION_VERSION,
        CAP_RUSH_MULTIPLAYER_SEED_ROOT,
        ...parts.map((part) => String(part)),
      ].join('\u0000'),
    ),
  );
}

function assertAttempt(attempt: number): void {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error(`cap rush multiplayer attempt must be nonnegative (got ${String(attempt)})`);
  }
}

export function capRushMultiplayerFranchiseSeed(rootSeed: Seed): Seed {
  return multiplayerSeed(rootSeed, 'franchise-assignment');
}

export function capRushMultiplayerMarketSeed(rootSeed: Seed, attempt: number): Seed {
  assertAttempt(attempt);
  return multiplayerSeed(rootSeed, 'market', 'attempt', attempt);
}

export function capRushMultiplayerMarketBucketSeed(
  rootSeed: Seed,
  attempt: number,
  position: Position,
  bucket: CapRushBucket,
): Seed {
  positionSchema.parse(position);
  return multiplayerSeed(
    capRushMultiplayerMarketSeed(rootSeed, attempt),
    'bucket',
    position,
    bucket,
  );
}

export function capRushMultiplayerAutoSignPrioritySeed(rootSeed: Seed): Seed {
  return multiplayerSeed(rootSeed, 'auto-sign-priority');
}

export function capRushMultiplayerMutationSeed(
  rootSeed: Seed,
  seat: CapRushMultiplayerSeatId,
  purchase: string,
  ordinal: number,
): Seed {
  capRushMultiplayerSeatIdSchema.parse(seat);
  if (!Number.isInteger(ordinal) || ordinal < 0) {
    throw new Error(
      `cap rush multiplayer spin ordinal must be nonnegative (got ${String(ordinal)})`,
    );
  }
  return multiplayerSeed(rootSeed, 'spin', seat, purchase, ordinal);
}
