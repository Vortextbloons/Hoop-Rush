import { z } from 'zod';
import { seedSchema } from './ids.ts';
import { seasonDigestHex } from './season-hash.ts';
import type { HavocMultiplayerParticipantId } from './havoc-multiplayer.ts';
import {
  HAVOC_MULTIPLAYER_SEED_DERIVATION_VERSION,
  HAVOC_MULTIPLAYER_SEED_ROOT,
  HAVOC_MULTIPLAYER_SERIES_GAMES,
  HAVOC_MULTIPLAYER_TURNS,
} from './havoc-multiplayer-versions.ts';

type Seed = z.infer<typeof seedSchema>;

function havocMultiplayerSeed(...parts: readonly (string | number)[]): Seed {
  return seedSchema.parse(
    seasonDigestHex(
      [
        HAVOC_MULTIPLAYER_SEED_DERIVATION_VERSION,
        HAVOC_MULTIPLAYER_SEED_ROOT,
        ...parts.map((part) => String(part)),
      ].join('\u0000'),
    ),
  );
}

function assertParticipantId(participantId: string): void {
  if (participantId !== 'p1' && participantId !== 'p2') {
    throw new Error(`havoc multiplayer participant must be p1 or p2 (got ${participantId})`);
  }
}

function assertTurnOrdinal(turnOrdinal: number): void {
  if (!Number.isInteger(turnOrdinal) || turnOrdinal < 0 || turnOrdinal >= HAVOC_MULTIPLAYER_TURNS) {
    throw new Error(
      `havoc multiplayer turn ordinal must be an integer in 0..${String(HAVOC_MULTIPLAYER_TURNS - 1)} (got ${String(turnOrdinal)})`,
    );
  }
}

function assertOfferRevision(offerRevision: number): void {
  if (!Number.isInteger(offerRevision) || offerRevision < 0) {
    throw new Error(
      `havoc multiplayer offer revision must be a nonnegative integer (got ${String(offerRevision)})`,
    );
  }
}

function assertGameNumber(gameNumber: number): void {
  if (
    !Number.isInteger(gameNumber) ||
    gameNumber < 1 ||
    gameNumber > HAVOC_MULTIPLAYER_SERIES_GAMES
  ) {
    throw new Error(
      `havoc multiplayer game number must be an integer in 1..${String(HAVOC_MULTIPLAYER_SERIES_GAMES)} (got ${String(gameNumber)})`,
    );
  }
}

export function havocMultiplayerFirstPickerSeed(rootSeed: Seed): Seed {
  return havocMultiplayerSeed(rootSeed, 'draft', 'first-picker');
}

export type HavocMultiplayerOfferStream =
  'players' | 'version' | 'tier' | 'mutations' | 'physical' | 'nickname' | 'specialist';

export function havocMultiplayerOfferSeed(
  rootSeed: Seed,
  participantId: HavocMultiplayerParticipantId,
  turnOrdinal: number,
  stream: HavocMultiplayerOfferStream,
): Seed {
  assertParticipantId(participantId);
  assertTurnOrdinal(turnOrdinal);
  return havocMultiplayerSeed(rootSeed, 'draft', 'offer', participantId, turnOrdinal, stream);
}

export function havocMultiplayerRerollSeed(
  rootSeed: Seed,
  participantId: HavocMultiplayerParticipantId,
  turnOrdinal: number,
): Seed {
  assertParticipantId(participantId);
  assertTurnOrdinal(turnOrdinal);
  return havocMultiplayerSeed(rootSeed, 'draft', 'reroll', participantId, turnOrdinal);
}

export function havocMultiplayerTimeoutSeed(
  rootSeed: Seed,
  turnOrdinal: number,
  offerRevision: number,
): Seed {
  assertTurnOrdinal(turnOrdinal);
  assertOfferRevision(offerRevision);
  return havocMultiplayerSeed(rootSeed, 'draft', 'timeout', turnOrdinal, offerRevision);
}

export function havocMultiplayerHomeCourtSeed(rootSeed: Seed): Seed {
  return havocMultiplayerSeed(rootSeed, 'series', 'home-court');
}

export function havocMultiplayerGameSeed(rootSeed: Seed, gameNumber: number): Seed {
  assertGameNumber(gameNumber);
  return havocMultiplayerSeed(rootSeed, 'series', 'game', gameNumber, 'basketball');
}
