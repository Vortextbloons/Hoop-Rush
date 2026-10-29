import { z } from 'zod';

export const multiplayerRoomSyncSchema = z.object({
  room: z.record(z.string(), z.unknown()),
  members: z.array(z.record(z.string(), z.unknown())).min(1),
  commands: z.array(z.record(z.string(), z.unknown())),
});
import {
  fixedFiveVersionLocksSchema,
  fixedFiveRoomModeSchema,
  fixedFiveSourceModeSchema,
} from './fixed-five-multiplayer.ts';
import { draftDuelVersionLocksSchema } from './draft-duel.ts';
import {
  havocMultiplayerVariantSchema,
  havocMultiplayerVersionLocksSchema,
} from './havoc-multiplayer.ts';

export const multiplayerGameKindSchema = z.enum(['fixed-five', 'draft-duel', 'havoc']);
const gameKindSchema = multiplayerGameKindSchema;
const legacyRoomSchema = z.object({
  legacy: z.literal(true),
  gameKind: gameKindSchema,
  gameRoomId: z.uuid(),
  variant: havocMultiplayerVariantSchema.optional(),
});
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
export const multiplayerRoomLookupSchema = z.union([multiplayerLobbySchema, legacyRoomSchema]);
export const multiplayerRoomPreviewSchema = z.union([
  z.object({
    legacy: z.literal(false),
    code: z.string().regex(/^\d{4}$/),
    guestJoined: z.boolean(),
  }),
  legacyRoomSchema,
]);
export const multiplayerMatchSettingsSchema = z.discriminatedUnion('gameKind', [
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
  z.object({
    gameKind: z.literal('havoc'),
    variant: havocMultiplayerVariantSchema,
    versions: havocMultiplayerVersionLocksSchema,
  }),
]);
export type MultiplayerMatchSettings = z.infer<typeof multiplayerMatchSettingsSchema>;
export type MultiplayerGameKind = z.infer<typeof multiplayerGameKindSchema>;
export type MultiplayerRoomPreview = z.infer<typeof multiplayerRoomPreviewSchema>;
export const multiplayerLobbyCommandSchema = z.union([
  z.object({ kind: z.literal('create') }),
  z.object({ kind: z.enum(['join', 'preview']), code: z.string().regex(/^\d{4}$/) }),
  z.object({ kind: z.enum(['get', 'leave', 'remove-guest']), lobbyId: z.uuid() }),
  z.object({
    kind: z.literal('start'),
    lobbyId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    settings: multiplayerMatchSettingsSchema,
  }),
]);
export type MultiplayerLobbyCommand = z.infer<typeof multiplayerLobbyCommandSchema>;
