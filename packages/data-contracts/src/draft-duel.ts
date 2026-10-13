import { z } from 'zod';
import { collectionCardIdSchema } from './collection-primitives.ts';
import {
  commandIdSchema,
  contentHashSchema,
  eraIdSchema,
  franchiseIdSchema,
  idSchema,
  playerIdSchema,
  seasonKeySchema,
  seedSchema,
} from './ids.ts';
import { positionNormalizationVersionSchema, positionUnionSchema } from './positions.ts';
import { gameResultSchema } from './result.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { simulationPlayerSchema, simulationTeamSchema } from './simulation.ts';
import {
  DRAFT_DUEL_AUTOPICK_VERSION,
  DRAFT_DUEL_MULTIPLAYER_VERSION,
  DRAFT_DUEL_TAPE_VERSION,
} from './draft-duel-versions.ts';
export {
  DRAFT_DUEL_ROOM_SCHEMA_VERSION,
  DRAFT_DUEL_ROOM_PROTOCOL_VERSION,
  DRAFT_DUEL_MULTIPLAYER_VERSION,
  DRAFT_DUEL_AUTOPICK_VERSION,
  DRAFT_DUEL_WORKER_WIRE_VERSION,
  DRAFT_DUEL_ENVELOPE_MAX_BYTES,
  DRAFT_DUEL_CODE_TTL_MS,
  DRAFT_DUEL_ROOM_RETENTION_MS,
  DRAFT_DUEL_PICK_TIMEOUT_MS,
  DRAFT_DUEL_GAME_READY_TIMEOUT_MS,
  DRAFT_DUEL_BROADCAST_MS,
  DRAFT_DUEL_PICK_ANIMATION_MS,
  DRAFT_DUEL_SHOWDOWN_MS,
  DRAFT_DUEL_SEED_VERSION,
  DRAFT_DUEL_CATALOG_FAMILY,
  DRAFT_DUEL_TAPE_VERSION,
  DRAFT_DUEL_CONSIDERATION_TTL_MS,
  DRAFT_DUEL_CONSIDERATION_PER_SECOND,
  DRAFT_DUEL_REACTION_MIN_INTERVAL_MS,
  DRAFT_DUEL_MAX_GENERATION_ATTEMPTS,
} from './draft-duel-versions.ts';

export const draftDuelFairnessSchema = z.enum(['fair', 'unfair']);
export type DraftDuelFairness = z.infer<typeof draftDuelFairnessSchema>;
export const draftDuelPresentationSchema = z.enum(['ratings', 'ball-knowledge']);
export type DraftDuelPresentation = z.infer<typeof draftDuelPresentationSchema>;
export const draftDuelParticipantIdSchema = z.enum(['p1', 'p2']);
export type DraftDuelParticipantId = z.infer<typeof draftDuelParticipantIdSchema>;
export const draftDuelRoomCodeSchema = z.string().regex(/^[0-9]{4}$/);
export type DraftDuelRoomCode = z.infer<typeof draftDuelRoomCodeSchema>;
export const draftDuelRoomPhaseSchema = z.enum([
  'lobby',
  'drafting',
  'lineup-showdown',
  'preparing-game',
  'broadcasting',
  'game-results',
  'championship',
  'integrity-failed',
  'expired',
]);
export type DraftDuelRoomPhase = z.infer<typeof draftDuelRoomPhaseSchema>;
export const draftDuelVersionLocksSchema = z.object({
  dataVersion: z.string().min(1).max(64),
  ratingsVersion: z.string().min(1).max(64),
  catalogVersion: z.string().min(1).max(64),
  catalogHash: contentHashSchema,
  playerVersionIdVersion: z.string().min(1).max(64),
  positionNormalizationVersion: positionNormalizationVersionSchema,
  engineVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  seedDerivationVersion: z.string().min(1).max(64),
  multiplayerVersion: z.string().min(1).max(64),
  autopickVersion: z.string().min(1).max(64),
});
export type DraftDuelVersionLocks = z.infer<typeof draftDuelVersionLocksSchema>;
export function defaultDraftDuelVersionLocks(
  overrides: Partial<Omit<DraftDuelVersionLocks, 'catalogHash'>> & { catalogHash: string },
): DraftDuelVersionLocks {
  return {
    dataVersion: overrides.dataVersion ?? 'unknown',
    ratingsVersion: overrides.ratingsVersion ?? 'unknown',
    catalogVersion: overrides.catalogVersion ?? 'unknown',
    catalogHash: contentHashSchema.parse(overrides.catalogHash),
    playerVersionIdVersion: overrides.playerVersionIdVersion ?? 'unknown',
    positionNormalizationVersion: overrides.positionNormalizationVersion ?? 'unknown',
    engineVersion: overrides.engineVersion ?? 'unknown',
    profileVersion: overrides.profileVersion ?? 'unknown',
    seedDerivationVersion: overrides.seedDerivationVersion ?? 'draft-duel-v1',
    multiplayerVersion: overrides.multiplayerVersion ?? DRAFT_DUEL_MULTIPLAYER_VERSION,
    autopickVersion: overrides.autopickVersion ?? DRAFT_DUEL_AUTOPICK_VERSION,
  };
}
export const draftDuelRoomSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  fairness: draftDuelFairnessSchema,
  presentation: draftDuelPresentationSchema,
  timerPolicyVersion: z.literal(DRAFT_DUEL_AUTOPICK_VERSION),
  versions: draftDuelVersionLocksSchema,
});
export type DraftDuelRoomSettings = z.infer<typeof draftDuelRoomSettingsSchema>;

export const draftDuelCardSchema = z.object({
  cardId: collectionCardIdSchema,
  playerId: playerIdSchema,
  playerExternalId: z.string().min(1).max(64).optional(),
  playerVersionId: playerVersionIdSchema,
  displayName: z.string().min(1).max(96),
  seasonKey: seasonKeySchema,
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  positions: positionUnionSchema,
  overall: z.number().int().min(0).max(100),
  bandIndex: z.number().int().min(0).max(9),
});
export type DraftDuelCard = z.infer<typeof draftDuelCardSchema>;
export const draftDuelCatalogEntrySchema = z.object({
  card: draftDuelCardSchema,
  simulation: simulationPlayerSchema,
});
export type DraftDuelCatalogEntry = z.infer<typeof draftDuelCatalogEntrySchema>;
export const draftDuelCatalogSourceSchema = z.object({
  catalogVersion: z.string().min(1).max(64),
  catalogHash: contentHashSchema,
  dataVersion: z.string().min(1).max(64),
  ratingsVersion: z.string().min(1).max(64),
  playerVersionIdVersion: z.string().min(1).max(64),
  positionNormalizationVersion: positionNormalizationVersionSchema,
  entries: z.array(draftDuelCatalogEntrySchema).min(1),
});
export type DraftDuelCatalogSource = z.infer<typeof draftDuelCatalogSourceSchema>;

export const draftDuelPickSchema = z.object({
  pickOrdinal: z.number().int().min(0).max(9),
  round: z.number().int().min(1).max(5),
  slot: z.number().int().min(0).max(7),
  participantId: draftDuelParticipantIdSchema,
  card: draftDuelCardSchema,
  slotIndex: z.number().int().min(0).max(4).optional(),
});
export type DraftDuelPick = z.infer<typeof draftDuelPickSchema>;
export const draftDuelRoundSchema = z.object({
  round: z.number().int().min(1).max(5),
  offers: z.object({
    p1: z.array(draftDuelCardSchema).length(8),
    p2: z.array(draftDuelCardSchema).length(8),
  }),
  picks: z.array(draftDuelPickSchema).max(2),
});
export type DraftDuelRound = z.infer<typeof draftDuelRoundSchema>;
export const draftDuelDraftSchema = z.object({
  schemaVersion: z.literal(1),
  rootSeed: seedSchema,
  fairness: draftDuelFairnessSchema,
  firstPicker: draftDuelParticipantIdSchema,
  pickOrdinal: z.number().int().min(0).max(10),
  rounds: z.array(draftDuelRoundSchema).length(5),
  status: z.enum(['drafting', 'complete']),
});
export type DraftDuelDraft = z.infer<typeof draftDuelDraftSchema>;
export const draftDuelRosterSlotSchema = z.object({
  slotIndex: z.number().int().min(0).max(4),
  card: draftDuelCardSchema,
});
export type DraftDuelRosterSlot = z.infer<typeof draftDuelRosterSlotSchema>;
export const draftDuelRosterSchema = z.object({
  participantId: draftDuelParticipantIdSchema,
  slots: z.array(draftDuelRosterSlotSchema).max(5),
});
export type DraftDuelRoster = z.infer<typeof draftDuelRosterSchema>;
export const draftDuelUnavailableReasonSchema = z.enum([
  'claimed',
  'position',
  'completion',
  'turn',
  'phase',
]);
export type DraftDuelUnavailableReason = z.infer<typeof draftDuelUnavailableReasonSchema>;
export const draftDuelOfferedPickSchema = z.object({
  slot: z.number().int().min(0).max(7),
  card: draftDuelCardSchema,
  available: z.boolean(),
  reason: draftDuelUnavailableReasonSchema.nullable(),
  legalSlots: z.array(z.number().int().min(0).max(4)).max(5).optional(),
});
export type DraftDuelOfferedPick = z.infer<typeof draftDuelOfferedPickSchema>;

export const draftDuelReadyPayloadSchema = z.object({
  kind: z.literal('ready'),
  ready: z.boolean(),
});
export const draftDuelSettingsPayloadSchema = z.object({
  kind: z.literal('settings'),
  fairness: draftDuelFairnessSchema,
  presentation: draftDuelPresentationSchema,
});
export const draftDuelStartPayloadSchema = z.object({
  kind: z.literal('start'),
});
export const draftDuelPickPayloadSchema = z.object({
  kind: z.literal('pick'),
  pickOrdinal: z.number().int().min(0).max(9),
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema,
  slotIndex: z.number().int().min(0).max(4).optional(),
});
export const draftDuelRepositionPayloadSchema = z.object({
  kind: z.literal('reposition'),
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema,
  slotIndex: z.number().int().min(0).max(4),
});
export const draftDuelTimeoutAutopickPayloadSchema = z.object({
  kind: z.literal('timeout-autopick'),
  pickOrdinal: z.number().int().min(0).max(9),
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema,
  slotIndex: z.number().int().min(0).max(4).optional(),
  seedPath: z.string().min(1).max(256),
});
export const draftDuelReadyNextGamePayloadSchema = z.object({
  kind: z.literal('ready-next-game'),
  gameNumber: z.number().int().min(1).max(7),
  ready: z.boolean(),
});
export const draftDuelBroadcastStartPayloadSchema = z.object({
  kind: z.literal('broadcast-start'),
  gameNumber: z.number().int().min(1).max(7),
  auto: z.boolean().optional(),
});
export const draftDuelProposeResultPayloadSchema = z.object({
  kind: z.literal('propose-result'),
  gameNumber: z.number().int().min(1).max(7),
  winner: draftDuelParticipantIdSchema,
  resultDigest: contentHashSchema,
  tapeDigest: contentHashSchema,
  inputDigest: contentHashSchema,
});
export const draftDuelConfirmResultPayloadSchema = z.object({
  kind: z.literal('confirm-result'),
  gameNumber: z.number().int().min(1).max(7),
  resultDigest: contentHashSchema,
  verified: z.boolean(),
});
export const draftDuelRematchRequestPayloadSchema = z.object({
  kind: z.literal('rematch-request'),
});
export const draftDuelRematchConfirmPayloadSchema = z.object({
  kind: z.literal('rematch-confirm'),
});
export const draftDuelLeavePayloadSchema = z.object({
  kind: z.literal('leave'),
});
export const draftDuelRemoveGuestPayloadSchema = z.object({
  kind: z.literal('remove-guest'),
  targetParticipantId: draftDuelParticipantIdSchema,
});
export const draftDuelCommandPayloadSchema = z.discriminatedUnion('kind', [
  draftDuelReadyPayloadSchema,
  draftDuelSettingsPayloadSchema,
  draftDuelStartPayloadSchema,
  draftDuelPickPayloadSchema,
  draftDuelRepositionPayloadSchema,
  draftDuelTimeoutAutopickPayloadSchema,
  draftDuelReadyNextGamePayloadSchema,
  draftDuelBroadcastStartPayloadSchema,
  draftDuelProposeResultPayloadSchema,
  draftDuelConfirmResultPayloadSchema,
  draftDuelRematchRequestPayloadSchema,
  draftDuelRematchConfirmPayloadSchema,
  draftDuelLeavePayloadSchema,
  draftDuelRemoveGuestPayloadSchema,
]);
export type DraftDuelCommandPayload = z.infer<typeof draftDuelCommandPayloadSchema>;
export type DraftDuelCommandKind = DraftDuelCommandPayload['kind'];
export const draftDuelCommandSchema = z.object({
  schemaVersion: z.literal(1),
  roomId: idSchema,
  commandId: commandIdSchema,
  ordinal: z.number().int().nonnegative(),
  actorParticipantId: draftDuelParticipantIdSchema,
  payload: draftDuelCommandPayloadSchema,
});
export type DraftDuelCommand = z.infer<typeof draftDuelCommandSchema>;
export const draftDuelCommandReceiptSchema = z.object({
  roomId: idSchema,
  commandId: commandIdSchema,
  ordinal: z.number().int().nonnegative(),
  accepted: z.boolean(),
  rejectionCode: z.string().min(1).max(64).nullable(),
  revision: z.number().int().nonnegative(),
});
export type DraftDuelCommandReceipt = z.infer<typeof draftDuelCommandReceiptSchema>;
export const draftDuelMemberSnapshotSchema = z.object({
  participantId: draftDuelParticipantIdSchema,
  online: z.boolean(),
  ready: z.boolean(),
  nextGameReady: z.number().int().min(0).max(7).nullable(),
  locked: z.boolean(),
  lastSeenAt: z.string().min(1).max(64).nullable(),
});
export type DraftDuelMemberSnapshot = z.infer<typeof draftDuelMemberSnapshotSchema>;
export const draftDuelDeadlineSchema = z.object({
  roomId: idSchema,
  cursor: z.string().min(1).max(128),
  participantId: draftDuelParticipantIdSchema,
  deadlineAt: z.string().min(1).max(64),
  fallback: draftDuelCommandPayloadSchema.nullable(),
  pickOrdinal: z.number().int().nonnegative(),
});
export type DraftDuelDeadline = z.infer<typeof draftDuelDeadlineSchema>;

export const draftDuelSeriesGameSchema = z.object({
  gameNumber: z.number().int().min(1).max(7),
  homeParticipantId: draftDuelParticipantIdSchema,
  awayParticipantId: draftDuelParticipantIdSchema,
  winner: draftDuelParticipantIdSchema,
});
export type DraftDuelSeriesGame = z.infer<typeof draftDuelSeriesGameSchema>;
export const draftDuelSeriesSnapshotSchema = z.object({
  homeWinner: draftDuelParticipantIdSchema,
  games: z.array(draftDuelSeriesGameSchema).max(7),
  p1Wins: z.number().int().min(0).max(4),
  p2Wins: z.number().int().min(0).max(4),
  currentGameNumber: z.number().int().min(1).max(7).nullable(),
  champion: draftDuelParticipantIdSchema.nullable(),
});
export type DraftDuelSeriesSnapshot = z.infer<typeof draftDuelSeriesSnapshotSchema>;
export const draftDuelBroadcastSchema = z.object({
  gameNumber: z.number().int().min(1).max(7),
  startedAtIso: z.string().min(1).max(64),
  durationMs: z.number().int().positive(),
});
export type DraftDuelBroadcast = z.infer<typeof draftDuelBroadcastSchema>;
export const draftDuelRoomSnapshotSchema = z.object({
  roomId: idSchema,
  code: draftDuelRoomCodeSchema.nullable(),
  codeActive: z.boolean(),
  settings: draftDuelRoomSettingsSchema,
  phase: draftDuelRoomPhaseSchema,
  revision: z.number().int().nonnegative(),
  commandCount: z.number().int().nonnegative(),
  rootSeed: seedSchema.nullable(),
  members: z.array(draftDuelMemberSnapshotSchema).length(2),
  deadline: draftDuelDeadlineSchema.nullable(),
  series: draftDuelSeriesSnapshotSchema.nullable(),
  broadcast: draftDuelBroadcastSchema.nullable(),
  resultDigest: contentHashSchema.nullable(),
  confirmedDigest: contentHashSchema.nullable(),
  successorRoomId: idSchema.nullable(),
  expiresAt: z.string().min(1).max(64),
  createdAt: z.string().min(1).max(64),
});
export type DraftDuelRoomSnapshot = z.infer<typeof draftDuelRoomSnapshotSchema>;
export const draftDuelRoomMembershipSchema = z.object({
  roomId: idSchema,
  participantId: draftDuelParticipantIdSchema,
  code: draftDuelRoomCodeSchema,
});
export type DraftDuelRoomMembership = z.infer<typeof draftDuelRoomMembershipSchema>;

export const draftDuelPartiallyVerifiedSchema = z.object({
  gameNumber: z.number().int().min(1).max(7),
  localResultDigest: contentHashSchema,
  peerResultDigest: contentHashSchema.nullable(),
  status: z.enum(['pending', 'verified', 'mismatch']),
});
export type DraftDuelPartiallyVerified = z.infer<typeof draftDuelPartiallyVerifiedSchema>;

const tapeStatSchema = z.number().int().min(0).max(10000);
export const draftDuelTapeStatLineSchema = z.tuple([
  tapeStatSchema,
  tapeStatSchema,
  tapeStatSchema,
  tapeStatSchema,
  tapeStatSchema,
  tapeStatSchema,
  tapeStatSchema,
  tapeStatSchema,
  tapeStatSchema,
  tapeStatSchema,
  tapeStatSchema,
  tapeStatSchema,
  tapeStatSchema,
  tapeStatSchema,
  tapeStatSchema,
]);
export type DraftDuelTapeStatLine = z.infer<typeof draftDuelTapeStatLineSchema>;
export const DRAFT_DUEL_TAPE_STAT_FIELDS = [
  'points',
  'fieldGoalMakes',
  'fieldGoalAttempts',
  'threeMakes',
  'threeAttempts',
  'freeThrowMakes',
  'freeThrowAttempts',
  'offensiveRebounds',
  'defensiveRebounds',
  'assists',
  'steals',
  'blocks',
  'turnovers',
  'fouls',
  'teamRebounds',
] as const;
export type DraftDuelTapeStatField = (typeof DRAFT_DUEL_TAPE_STAT_FIELDS)[number];
export const draftDuelTapeTripSchema = z.object({
  kind: z.literal('trip'),
  index: z.number().int().nonnegative(),
  period: z.number().int().min(1).max(40),
  clockSeconds: z.number().min(0).max(3600),
  offense: z.union([z.literal(0), z.literal(1)]),
  ended: z.boolean(),
  secondsElapsed: z.number().min(0).max(3600),
  homeScore: z.number().int().nonnegative(),
  awayScore: z.number().int().nonnegative(),
  homeDeltas: z.array(draftDuelTapeStatLineSchema).length(5),
  awayDeltas: z.array(draftDuelTapeStatLineSchema).length(5),
  homeTeamDeltas: draftDuelTapeStatLineSchema,
  awayTeamDeltas: draftDuelTapeStatLineSchema,
});
export type DraftDuelTapeTrip = z.infer<typeof draftDuelTapeTripSchema>;
export const draftDuelTapePeriodSchema = z.object({
  kind: z.literal('period'),
  index: z.number().int().nonnegative(),
  period: z.number().int().min(1).max(40),
  homeScore: z.number().int().nonnegative(),
  awayScore: z.number().int().nonnegative(),
});
export type DraftDuelTapePeriod = z.infer<typeof draftDuelTapePeriodSchema>;
export const draftDuelTapeEventSchema = z.discriminatedUnion('kind', [
  draftDuelTapeTripSchema,
  draftDuelTapePeriodSchema,
]);
export type DraftDuelTapeEvent = z.infer<typeof draftDuelTapeEventSchema>;
export const draftDuelGameOutputSchema = z.object({
  schemaVersion: z.literal(DRAFT_DUEL_TAPE_VERSION),
  roomId: idSchema,
  gameNumber: z.number().int().min(1).max(7),
  homeParticipantId: draftDuelParticipantIdSchema,
  awayParticipantId: draftDuelParticipantIdSchema,
  seed: seedSchema,
  result: gameResultSchema,
  tape: z.array(draftDuelTapeEventSchema).min(1),
  inputDigest: contentHashSchema,
  resultDigest: contentHashSchema,
  tapeDigest: contentHashSchema,
});
export type DraftDuelGameOutput = z.infer<typeof draftDuelGameOutputSchema>;
export const draftDuelSimulationInputSchema = z.object({
  schemaVersion: z.literal(1),
  roomId: idSchema,
  gameNumber: z.number().int().min(1).max(7),
  homeParticipantId: draftDuelParticipantIdSchema,
  awayParticipantId: draftDuelParticipantIdSchema,
  seed: seedSchema,
  dataVersion: z.string().min(1).max(64),
  home: simulationTeamSchema,
  away: simulationTeamSchema,
});
export type DraftDuelSimulationInput = z.infer<typeof draftDuelSimulationInputSchema>;

export const draftDuelSeriesMvpSchema = z.object({
  participantId: draftDuelParticipantIdSchema,
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema,
  displayName: z.string().min(1).max(96),
  games: z.number().int().min(4).max(7),
  points: z.number().int().nonnegative(),
  rebounds: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  gameScoreSum: z.number(),
});
export type DraftDuelSeriesMvp = z.infer<typeof draftDuelSeriesMvpSchema>;
export const draftDuelStandoutSchema = z.object({
  participantId: draftDuelParticipantIdSchema,
  playerId: playerIdSchema,
  displayName: z.string().min(1).max(96),
  gameNumber: z.number().int().min(1).max(7),
  points: z.number().int().nonnegative(),
  rebounds: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
});
export type DraftDuelStandout = z.infer<typeof draftDuelStandoutSchema>;

export const draftDuelTransientEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('consideration'),
    roomId: idSchema,
    participantId: draftDuelParticipantIdSchema,
    pickOrdinal: z.number().int().min(0).max(9),
    playerId: playerIdSchema,
    playerVersionId: playerVersionIdSchema,
    sentAtMs: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('reaction'),
    roomId: idSchema,
    participantId: draftDuelParticipantIdSchema,
    pickOrdinal: z.number().int().min(0).max(9),
    reaction: z.enum(['hype', 'clap', 'cold', 'wow']),
    sentAtMs: z.number().int().nonnegative(),
  }),
]);
export type DraftDuelTransientEvent = z.infer<typeof draftDuelTransientEventSchema>;
export const draftDuelMultiplayerErrorCodeSchema = z.enum([
  'authorization',
  'membership',
  'phase',
  'turn',
  'stale-revision',
  'expiry',
  'rate-limit',
  'duplicate-command',
  'invalid-code',
  'code-expired',
  'room-full',
  'outdated-room',
  'payload-too-large',
  'illegal-move',
  'claim-taken',
  'not-ready',
  'already-locked',
  'generation-failed',
  'integrity-failed',
]);
export type DraftDuelMultiplayerErrorCode = z.infer<typeof draftDuelMultiplayerErrorCodeSchema>;
export const draftDuelMultiplayerErrorSchema = z.object({
  code: draftDuelMultiplayerErrorCodeSchema,
  message: z.string().min(1).max(512),
  retryable: z.boolean(),
});
export type DraftDuelMultiplayerError = z.infer<typeof draftDuelMultiplayerErrorSchema>;

const receiptHexSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const draftDuelReceiptGameSeedSchema = z.object({
  gameNumber: z.number().int().min(1).max(7),
  seed: seedSchema,
});
export type DraftDuelReceiptGameSeed = z.infer<typeof draftDuelReceiptGameSeedSchema>;
export const draftDuelVerificationReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  roomId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  versions: draftDuelVersionLocksSchema,
  challenge: z.string().min(1).max(256),
  participantIds: z.tuple([draftDuelParticipantIdSchema, draftDuelParticipantIdSchema]),
  commandIds: z.array(z.string().min(1).max(64)),
  gameSeeds: z.array(draftDuelReceiptGameSeedSchema),
  resultDigest: receiptHexSchema,
  receiptDigest: receiptHexSchema,
});
export type DraftDuelVerificationReceipt = z.infer<typeof draftDuelVerificationReceiptSchema>;

export interface DraftDuelMultiplayerTransport {
  create(
    settings: Omit<DraftDuelRoomSettings, 'schemaVersion' | 'timerPolicyVersion'> &
      Partial<Pick<DraftDuelRoomSettings, 'schemaVersion' | 'timerPolicyVersion'>>,
  ): Promise<{
    snapshot: DraftDuelRoomSnapshot;
    code: DraftDuelRoomCode;
    membership: DraftDuelRoomMembership;
  }>;
  preview(code: string): Promise<DraftDuelRoomSnapshot>;
  join(code: string): Promise<{
    snapshot: DraftDuelRoomSnapshot;
    membership: DraftDuelRoomMembership;
  }>;
  resume(roomId: string): Promise<{
    snapshot: DraftDuelRoomSnapshot;
    membership: DraftDuelRoomMembership;
  }>;
  subscribe(
    roomId: string,
    handler: (snapshot: DraftDuelRoomSnapshot) => void,
  ): {
    unsubscribe: () => void;
  };
  subscribeTransient(
    roomId: string,
    handler: (event: DraftDuelTransientEvent) => void,
  ): {
    unsubscribe: () => void;
  };
  publishTransient(roomId: string, event: DraftDuelTransientEvent): Promise<boolean>;
  refetch(roomId: string, afterOrdinal: number): Promise<DraftDuelCommand[]>;
  submitCommand(
    command: Omit<DraftDuelCommand, 'ordinal'> & {
      ordinal?: number;
      expectedRevision?: number;
    },
  ): Promise<DraftDuelCommandReceipt>;
  verificationChallenge(roomId: string): Promise<string>;
  submitVerification(
    roomId: string,
    receipt: DraftDuelVerificationReceipt,
    expectedRevision?: number,
  ): Promise<{
    receiptId: string;
    revision: number;
  }>;
  commitFallback(
    roomId: string,
    cursor: string,
    payload: DraftDuelCommandPayload,
    expectedRevision?: number,
  ): Promise<{
    stored: boolean;
    revision: number;
  }>;
  resolveTimeout(roomId: string): Promise<DraftDuelCommandReceipt | null>;
  removeGuest(
    roomId: string,
    targetParticipantId: DraftDuelParticipantId,
  ): Promise<DraftDuelRoomSnapshot>;
  leave(roomId: string, participantId: DraftDuelParticipantId): Promise<void>;
  rematch(roomId: string): Promise<{
    snapshot: DraftDuelRoomSnapshot;
    code: DraftDuelRoomCode;
  }>;
  complete(
    roomId: string,
    receiptId: string,
  ): Promise<{
    completed: boolean;
    phase: DraftDuelRoomPhase;
  }>;
  fail(roomId: string): Promise<{
    failed: boolean;
    phase: DraftDuelRoomPhase;
  }>;
}
