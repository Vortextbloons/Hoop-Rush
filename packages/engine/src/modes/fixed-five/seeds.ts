import type { FixedFiveParticipantId, FixedFiveRoomMode, Seed } from '@hoop-rush/data-contracts';
import { seedSchema } from '@hoop-rush/data-contracts';
import { FNV_OFFSET_32, fnv1a32, hex32 } from '../../sim/rng.ts';
import { createRng } from '../../sim/rng.ts';
export const FIXED_FIVE_SEED_VERSION = 'fixed-five-v1';
function hexSeed(material: string): Seed {
  const high = fnv1a32(material);
  const low = fnv1a32(`${material}:tail`, FNV_OFFSET_32 ^ high);
  return seedSchema.parse(`${hex32(high)}${hex32(low)}`);
}
export function fixedFiveParticipantSeed(
  rootSeed: Seed,
  participantId: FixedFiveParticipantId,
): Seed {
  return hexSeed(`hoop-rush:${FIXED_FIVE_SEED_VERSION}:${rootSeed}:participant-${participantId}`);
}
export function fixedFiveDraftSeed(rootSeed: Seed, participantId: FixedFiveParticipantId): Seed {
  return hexSeed(`hoop-rush:${FIXED_FIVE_SEED_VERSION}:${rootSeed}:draft-${participantId}`);
}
export function fixedFiveFirstPicker(rootSeed: Seed): FixedFiveParticipantId {
  const rng = createRng(`hoop-rush:${FIXED_FIVE_SEED_VERSION}:${rootSeed}:duel-first-picker`);
  return rng.chance(0.5) ? 'p1' : 'p2';
}
export function fixedFiveDuelGameSeed(rootSeed: Seed, gameNumber: number): Seed {
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 7) {
    throw new Error(`duel gameNumber must be an integer in 1..7 (got ${String(gameNumber)})`);
  }
  return hexSeed(
    `hoop-rush:${FIXED_FIVE_SEED_VERSION}:${rootSeed}:duel:game-${String(gameNumber)}`,
  );
}
export function fixedFiveSharedGameSeed(
  rootSeed: Seed,
  participantId: FixedFiveParticipantId,
  gameNumber: number,
): Seed {
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 82) {
    throw new Error(`gameNumber must be an integer in 1..82 (got ${String(gameNumber)})`);
  }
  return hexSeed(
    `hoop-rush:${FIXED_FIVE_SEED_VERSION}:${rootSeed}:shared82:${participantId}:game-${String(gameNumber)}`,
  );
}
export function fixedFiveH2HSeed(rootSeed: Seed, gameNumber: number): Seed {
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 82) {
    throw new Error(`gameNumber must be an integer in 1..82 (got ${String(gameNumber)})`);
  }
  return hexSeed(
    `hoop-rush:${FIXED_FIVE_SEED_VERSION}:${rootSeed}:shared82:h2h:game-${String(gameNumber)}`,
  );
}
export function fixedFiveAutopickSeed(
  rootSeed: Seed,
  mode: FixedFiveRoomMode,
  participantId: FixedFiveParticipantId,
  pickOrdinal: number,
): string {
  if (!Number.isInteger(pickOrdinal) || pickOrdinal < 0) {
    throw new Error(`pickOrdinal must be a nonnegative integer (got ${String(pickOrdinal)})`);
  }
  return `${rootSeed}/timeout-autopick/${mode}/${participantId}/${String(pickOrdinal)}`;
}
export function fixedFiveAutopickSeedPath(
  mode: FixedFiveRoomMode,
  participantId: FixedFiveParticipantId,
  pickOrdinal: number,
): string {
  return `rootSeed/timeout-autopick/${mode}/${participantId}/${String(pickOrdinal)}`;
}
export const FIXED_FIVE_TIEBREAK_PATH = 'rootSeed/tiebreak/participant-order';
export function fixedFiveTiebreakWinner(rootSeed: Seed): FixedFiveParticipantId {
  const rng = createRng(`hoop-rush:${FIXED_FIVE_SEED_VERSION}:${rootSeed}:tiebreak`);
  return rng.chance(0.5) ? 'p1' : 'p2';
}
