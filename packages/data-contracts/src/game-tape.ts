import {
  DRAFT_DUEL_TAPE_STAT_FIELDS,
  draftDuelTapeEventSchema,
  type DraftDuelTapeEvent,
  type DraftDuelTapeStatLine,
  type DraftDuelTapeTrip,
} from './draft-duel.ts';

export const GAME_TAPE_STAT_FIELDS = DRAFT_DUEL_TAPE_STAT_FIELDS;
export type GameTapeStatField = (typeof GAME_TAPE_STAT_FIELDS)[number];
export type GameTapeStatLine = DraftDuelTapeStatLine;
export type GameTapeTrip = DraftDuelTapeTrip;
export const gameTapeEventSchema = draftDuelTapeEventSchema;
export type GameTapeEvent = DraftDuelTapeEvent;
