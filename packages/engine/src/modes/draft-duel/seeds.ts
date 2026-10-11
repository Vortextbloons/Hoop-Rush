import type { DraftDuelParticipantId, Seed } from '@hoop-rush/data-contracts';
import { seedSchema } from '@hoop-rush/data-contracts';
import { FNV_OFFSET_32, fnv1a32, hex32 } from '../../sim/rng.ts';

export const DRAFT_DUEL_SEED_VERSION = 'draft-duel-v1';
export const DRAFT_DUEL_FAIR_BAND_VERSION = 'draft-duel-fair-bands-v1';
function hexSeed(material: string): Seed {
  const high = fnv1a32(material);
  const low = fnv1a32(`${material}:tail`, FNV_OFFSET_32 ^ high);
  return seedSchema.parse(`${hex32(high)}${hex32(low)}`);
}
function seedByteParity(rootSeed: Seed, offset: number): boolean {
  return Number.parseInt(rootSeed.slice(offset, offset + 2), 16) % 2 === 0;
}
export function draftDuelSharedBandSeed(rootSeed: Seed, attempt: number): Seed {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error(
      `draft duel band attempt must be a nonnegative integer (got ${String(attempt)})`,
    );
  }
  return hexSeed(
    `hoop-rush:${DRAFT_DUEL_SEED_VERSION}:${rootSeed}:fair-bands:attempt-${String(attempt)}`,
  );
}
export function draftDuelOfferSeed(
  rootSeed: Seed,
  participantId: DraftDuelParticipantId,
  round: number,
  attempt: number,
): Seed {
  if (!Number.isInteger(round) || round < 1 || round > 5) {
    throw new Error(`draft duel round must be an integer in 1..5 (got ${String(round)})`);
  }
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error(`draft duel attempt must be a nonnegative integer (got ${String(attempt)})`);
  }
  return hexSeed(
    `hoop-rush:${DRAFT_DUEL_SEED_VERSION}:${rootSeed}:offers:${participantId}:round-${String(round)}:attempt-${String(attempt)}`,
  );
}
export function draftDuelSafetySeed(
  rootSeed: Seed,
  participantId: DraftDuelParticipantId,
  pickOrdinal: number,
): Seed {
  if (!Number.isInteger(pickOrdinal) || pickOrdinal < 0 || pickOrdinal > 9) {
    throw new Error(
      `draft duel pickOrdinal must be an integer in 0..9 (got ${String(pickOrdinal)})`,
    );
  }
  return hexSeed(
    `hoop-rush:${DRAFT_DUEL_SEED_VERSION}:${rootSeed}:safety:${participantId}:pick-${String(pickOrdinal)}`,
  );
}
export function draftDuelFirstPicker(rootSeed: Seed): DraftDuelParticipantId {
  return seedByteParity(rootSeed, 0) ? 'p1' : 'p2';
}
export function draftDuelTimeoutSeed(
  rootSeed: Seed,
  participantId: DraftDuelParticipantId,
  pickOrdinal: number,
): Seed {
  if (!Number.isInteger(pickOrdinal) || pickOrdinal < 0 || pickOrdinal > 9) {
    throw new Error(
      `draft duel pickOrdinal must be an integer in 0..9 (got ${String(pickOrdinal)})`,
    );
  }
  return hexSeed(
    `hoop-rush:${DRAFT_DUEL_SEED_VERSION}:${rootSeed}:timeout:${participantId}:pick-${String(pickOrdinal)}`,
  );
}
export function draftDuelTimeoutSeedPath(
  participantId: DraftDuelParticipantId,
  pickOrdinal: number,
): string {
  return `rootSeed/timeout/${participantId}/${String(pickOrdinal)}`;
}
export function draftDuelHomeWinner(rootSeed: Seed): DraftDuelParticipantId {
  return seedByteParity(rootSeed, 2) ? 'p1' : 'p2';
}
export function draftDuelGameSeed(rootSeed: Seed, gameNumber: number): Seed {
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 7) {
    throw new Error(`draft duel gameNumber must be an integer in 1..7 (got ${String(gameNumber)})`);
  }
  return hexSeed(
    `hoop-rush:${DRAFT_DUEL_SEED_VERSION}:${rootSeed}:series:game-${String(gameNumber)}`,
  );
}
export function draftDuelRematchSeed(rootSeed: Seed, rematchOrdinal: number): Seed {
  if (!Number.isInteger(rematchOrdinal) || rematchOrdinal < 1) {
    throw new Error(`rematch ordinal must be a positive integer (got ${String(rematchOrdinal)})`);
  }
  return hexSeed(
    `hoop-rush:${DRAFT_DUEL_SEED_VERSION}:${rootSeed}:rematch-${String(rematchOrdinal)}`,
  );
}
