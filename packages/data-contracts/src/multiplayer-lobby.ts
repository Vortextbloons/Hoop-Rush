import { z } from 'zod';
import {
  fixedFiveVersionLocksSchema,
  fixedFiveRoomModeSchema,
  fixedFiveSourceModeSchema,
} from './fixed-five-multiplayer.ts';
import { draftDuelVersionLocksSchema } from './draft-duel.ts';

const gameKindSchema = z.enum(['fixed-five', 'draft-duel']);
export const multiplayerLobbySchema = z.object({
  id: z.uuid(),
  code: z.string().regex(/^\d{4}$/),
  revision: z.number().int().nonnegative(),
  participantId: z.enum(['p1', 'p2']),
  guestJoined: z.boolean(),
  gameKind: gameKindSchema.nullable(),
  gameRoomId: z.uuid().nullable(),
  canStart: z.boolean(),
});
export type MultiplayerLobby = z.infer<typeof multiplayerLobbySchema>;
export const multiplayerRoomLookupSchema = z.union([
  multiplayerLobbySchema,
  z.object({ legacy: z.literal(true), gameKind: gameKindSchema, gameRoomId: z.uuid() }),
]);
export const multiplayerRoomPreviewSchema = z.union([
  z.object({
    legacy: z.literal(false),
    code: z.string().regex(/^\d{4}$/),
    guestJoined: z.boolean(),
  }),
  z.object({ legacy: z.literal(true), gameKind: gameKindSchema, gameRoomId: z.uuid() }),
]);
export const multiplayerLobbyCommandSchema = z.union([
  z.object({ kind: z.literal('create') }),
  z.object({ kind: z.enum(['join', 'preview']), code: z.string().regex(/^\d{4}$/) }),
  z.object({ kind: z.enum(['get', 'leave', 'remove-guest']), lobbyId: z.uuid() }),
  z.object({
    kind: z.literal('start'),
    lobbyId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    settings: z.discriminatedUnion('gameKind', [
      z.object({
        gameKind: z.literal('fixed-five'),
        mode: fixedFiveRoomModeSchema,
        sourceMode: fixedFiveSourceModeSchema,
        variant: z.enum(['ratings', 'ball-knowledge']),
        versions: fixedFiveVersionLocksSchema,
      }),
      z.object({
        gameKind: z.literal('draft-duel'),
        fairness: z.enum(['fair', 'unfair']),
        variant: z.enum(['ratings', 'ball-knowledge']),
        versions: draftDuelVersionLocksSchema,
      }),
    ]),
  }),
]);
export type MultiplayerLobbyCommand = z.infer<typeof multiplayerLobbyCommandSchema>;
