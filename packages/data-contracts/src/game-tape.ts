import {
  DRAFT_DUEL_TAPE_STAT_FIELDS,
  draftDuelTapeEventSchema,
  draftDuelTapePeriodSchema,
  draftDuelTapeStatLineSchema,
  draftDuelTapeTripSchema,
  type DraftDuelTapeEvent,
  type DraftDuelTapePeriod,
  type DraftDuelTapeStatLine,
  type DraftDuelTapeTrip,
} from './draft-duel.ts';

export const GAME_TAPE_STAT_FIELDS = DRAFT_DUEL_TAPE_STAT_FIELDS;
export type GameTapeStatField = (typeof GAME_TAPE_STAT_FIELDS)[number];
export const gameTapeStatLineSchema = draftDuelTapeStatLineSchema;
export type GameTapeStatLine = DraftDuelTapeStatLine;
export const gameTapeTripSchema = draftDuelTapeTripSchema;
export type GameTapeTrip = DraftDuelTapeTrip;
export const gameTapePeriodSchema = draftDuelTapePeriodSchema;
export type GameTapePeriod = DraftDuelTapePeriod;
export const gameTapeEventSchema = draftDuelTapeEventSchema;
export type GameTapeEvent = DraftDuelTapeEvent;
