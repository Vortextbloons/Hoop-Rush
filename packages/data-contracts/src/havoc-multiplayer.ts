import { z } from 'zod';
import { commandIdSchema, contentHashSchema, idSchema, playerIdSchema, seedSchema } from './ids.ts';
import { POSITIONS, positionSchema } from './positions.ts';
import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  havocDigestSchema,
} from './havoc-versions.ts';
import {
  havocCardIdSchema,
  havocDraftCardSchema,
  havocDraftOfferSchema,
  havocOfferIdSchema,
} from './havoc-draft.ts';
import { havocClaimKeySchema } from './havoc-profile.ts';
import {
  HAVOC_CURATED_RATING_BANDS,
  HAVOC_CURATED_RATING_BAND_NAMES,
  HAVOC_MULTIPLAYER_LEGACY_VERSION,
  HAVOC_MULTIPLAYER_REROLLS_PER_PARTICIPANT,
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  HAVOC_MULTIPLAYER_SERIES_GAMES,
  HAVOC_MULTIPLAYER_SERIES_WINS,
  HAVOC_MULTIPLAYER_TURNS,
  HAVOC_MULTIPLAYER_VERSION,
} from './havoc-multiplayer-versions.ts';

export const havocMultiplayerVariantSchema = z.enum(['standard', 'curated']);
export type HavocMultiplayerVariant = z.infer<typeof havocMultiplayerVariantSchema>;
export const havocCuratedRatingBandSchema = z.enum(HAVOC_CURATED_RATING_BAND_NAMES);
export type HavocCuratedRatingBand = z.infer<typeof havocCuratedRatingBandSchema>;

export function havocOverallInCuratedBand(
  originalOverall: number,
  band: HavocCuratedRatingBand,
): boolean {
  const bounds = HAVOC_CURATED_RATING_BANDS[band];
  return originalOverall >= bounds.minOverall && originalOverall <= bounds.maxOverall;
}

export const havocMultiplayerParticipantIdSchema = z.enum(['p1', 'p2']);
export type HavocMultiplayerParticipantId = z.infer<typeof havocMultiplayerParticipantIdSchema>;
export const havocMultiplayerRoomCodeSchema = z.string().regex(/^[0-9]{4}$/);
export type HavocMultiplayerRoomCode = z.infer<typeof havocMultiplayerRoomCodeSchema>;
export const havocMultiplayerPhaseSchema = z.enum([
  'lobby',
  'drafting',
  'lineup-showdown',
  'preparing-game',
  'broadcasting',
  'game-results',
  'championship',
  'expired',
  'integrity-failed',
]);
export type HavocMultiplayerPhase = z.infer<typeof havocMultiplayerPhaseSchema>;

export const havocMultiplayerVersionLocksSchema = z.object({
  schemaVersion: z.literal(HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION),
  multiplayerVersion: z.enum([HAVOC_MULTIPLAYER_VERSION, HAVOC_MULTIPLAYER_LEGACY_VERSION]),
  engineVersion: z.string().min(1).max(64),
  rulesVersion: z.string().min(1).max(64),
  mutationCatalogVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  catalogVersion: z.string().min(1).max(64),
  catalogHash: contentHashSchema,
  profileHash: contentHashSchema,
});
export type HavocMultiplayerVersionLocks = z.infer<typeof havocMultiplayerVersionLocksSchema>;

export function defaultHavocMultiplayerVersionLocks(
  overrides: Partial<
    Omit<
      HavocMultiplayerVersionLocks,
      'schemaVersion' | 'multiplayerVersion' | 'catalogHash' | 'profileHash'
    >
  > & {
    catalogHash: string;
    profileHash: string;
  },
): HavocMultiplayerVersionLocks {
  return {
    schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
    multiplayerVersion: HAVOC_MULTIPLAYER_VERSION,
    engineVersion: overrides.engineVersion ?? 'unknown',
    rulesVersion: overrides.rulesVersion ?? HAVOC_RULES_VERSION,
    mutationCatalogVersion: overrides.mutationCatalogVersion ?? HAVOC_MUTATION_CATALOG_VERSION,
    profileVersion: overrides.profileVersion ?? 'unknown',
    dataVersion: overrides.dataVersion ?? 'unknown',
    catalogVersion: overrides.catalogVersion ?? 'unknown',
    catalogHash: contentHashSchema.parse(overrides.catalogHash),
    profileHash: contentHashSchema.parse(overrides.profileHash),
  };
}

export const havocMultiplayerRoomSettingsSchema = z.object({
  schemaVersion: z.literal(HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION),
  variant: havocMultiplayerVariantSchema.default('standard'),
  versions: havocMultiplayerVersionLocksSchema,
});
export type HavocMultiplayerRoomSettings = z.infer<typeof havocMultiplayerRoomSettingsSchema>;
export type HavocMultiplayerRoomSettingsInput = Omit<
  z.input<typeof havocMultiplayerRoomSettingsSchema>,
  'schemaVersion'
> &
  Partial<Pick<HavocMultiplayerRoomSettings, 'schemaVersion'>>;

export const havocMultiplayerDraftPickSchema = z.object({
  turnOrdinal: z
    .number()
    .int()
    .min(0)
    .max(HAVOC_MULTIPLAYER_TURNS - 1),
  participantId: havocMultiplayerParticipantIdSchema,
  slot: positionSchema,
  claimKey: havocClaimKeySchema,
  card: havocDraftCardSchema,
});
export type HavocMultiplayerDraftPick = z.infer<typeof havocMultiplayerDraftPickSchema>;

function pickerFor(
  firstPicker: HavocMultiplayerParticipantId,
  turnOrdinal: number,
): HavocMultiplayerParticipantId {
  return turnOrdinal % 2 === 0 ? firstPicker : firstPicker === 'p1' ? 'p2' : 'p1';
}

export const havocMultiplayerDraftStateSchema = z
  .object({
    schemaVersion: z.literal(HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION),
    revision: z.number().int().nonnegative(),
    rootSeed: seedSchema,
    firstPicker: havocMultiplayerParticipantIdSchema,
    turnOrdinal: z.number().int().min(0).max(HAVOC_MULTIPLAYER_TURNS),
    activeParticipantId: havocMultiplayerParticipantIdSchema.nullable(),
    offer: havocDraftOfferSchema.nullable(),
    rerollsUsed: z.object({
      p1: z.union([z.literal(0), z.literal(HAVOC_MULTIPLAYER_REROLLS_PER_PARTICIPANT)]),
      p2: z.union([z.literal(0), z.literal(HAVOC_MULTIPLAYER_REROLLS_PER_PARTICIPANT)]),
    }),
    picks: z.array(havocMultiplayerDraftPickSchema).max(HAVOC_MULTIPLAYER_TURNS),
    claimedPlayerIds: z.array(playerIdSchema).max(HAVOC_MULTIPLAYER_TURNS),
    status: z.enum(['drafting', 'complete']),
  })
  .superRefine((state, ctx) => {
    const drafting = state.status === 'drafting';
    if (drafting && state.turnOrdinal >= HAVOC_MULTIPLAYER_TURNS) {
      ctx.addIssue({
        code: 'custom',
        message: `a drafting state cannot pass turn ${String(HAVOC_MULTIPLAYER_TURNS - 1)}`,
      });
    }
    const expectedPicks = drafting ? state.turnOrdinal : HAVOC_MULTIPLAYER_TURNS;
    if (state.picks.length !== expectedPicks) {
      ctx.addIssue({
        code: 'custom',
        message: `turn ${String(state.turnOrdinal)} requires ${String(expectedPicks)} completed picks`,
      });
    }
    if (drafting) {
      if (state.offer === null) {
        ctx.addIssue({ code: 'custom', message: 'a drafting state requires an active offer' });
      }
      const expectedPicker = pickerFor(state.firstPicker, state.turnOrdinal);
      if (state.activeParticipantId !== expectedPicker) {
        ctx.addIssue({
          code: 'custom',
          message: `turn ${String(state.turnOrdinal)} belongs to ${expectedPicker}`,
        });
      }
    } else {
      if (state.turnOrdinal !== HAVOC_MULTIPLAYER_TURNS) {
        ctx.addIssue({
          code: 'custom',
          message: 'a complete draft ends at the final turn ordinal',
        });
      }
      if (state.offer !== null) {
        ctx.addIssue({ code: 'custom', message: 'a complete draft carries no active offer' });
      }
      if (state.activeParticipantId !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'a complete draft carries no active participant',
        });
      }
    }
    const seenClaims = new Set<string>();
    state.picks.forEach((pick, index) => {
      if (pick.turnOrdinal !== index) {
        ctx.addIssue({ code: 'custom', message: 'pick turn ordinals must be sequential' });
      }
      const expectedPicker = pickerFor(state.firstPicker, index);
      if (pick.participantId !== expectedPicker) {
        ctx.addIssue({
          code: 'custom',
          message: `pick ${String(index)} belongs to ${expectedPicker}`,
        });
      }
      const expectedSlot = POSITIONS[Math.floor(index / 2)];
      if (expectedSlot !== undefined && pick.slot !== expectedSlot) {
        ctx.addIssue({
          code: 'custom',
          message: `pick ${String(index)} must fill ${expectedSlot}`,
        });
      }
      if (pick.card.slot !== pick.slot) {
        ctx.addIssue({ code: 'custom', message: 'picked card slot does not match the pick slot' });
      }
      if (
        pick.card.source.playerId !== pick.claimKey.playerId ||
        pick.card.source.seasonKey !== pick.claimKey.seasonKey
      ) {
        ctx.addIssue({ code: 'custom', message: 'pick claim key does not match the picked card' });
      }
      if (state.claimedPlayerIds[index] !== pick.claimKey.playerId) {
        ctx.addIssue({ code: 'custom', message: 'claimed player ids must mirror the picks' });
      }
      const key = `${pick.claimKey.playerId}::${String(pick.claimKey.seasonKey)}`;
      if (seenClaims.has(key)) {
        ctx.addIssue({ code: 'custom', message: `claim ${key} drafted twice` });
      }
      seenClaims.add(key);
    });
    const seenPlayerIds = new Set<string>();
    for (const playerId of state.claimedPlayerIds) {
      if (seenPlayerIds.has(playerId)) {
        ctx.addIssue({
          code: 'custom',
          message: `claimed players must be unique (${playerId} claimed twice)`,
        });
      }
      seenPlayerIds.add(playerId);
    }
  });
export type HavocMultiplayerDraftState = z.infer<typeof havocMultiplayerDraftStateSchema>;

export const havocMultiplayerReadyPayloadSchema = z.object({
  kind: z.literal('ready'),
});
export const havocMultiplayerStartPayloadSchema = z.object({
  kind: z.literal('start'),
});
export const havocMultiplayerPickPayloadSchema = z.object({
  kind: z.literal('pick'),
  turnOrdinal: z
    .number()
    .int()
    .min(0)
    .max(HAVOC_MULTIPLAYER_TURNS - 1),
  offerId: havocOfferIdSchema,
  cardId: havocCardIdSchema,
  claimKey: havocClaimKeySchema,
});
export const havocMultiplayerRerollPayloadSchema = z.object({
  kind: z.literal('reroll'),
  turnOrdinal: z
    .number()
    .int()
    .min(0)
    .max(HAVOC_MULTIPLAYER_TURNS - 1),
  offerId: havocOfferIdSchema,
});
export const havocMultiplayerTimeoutPickPayloadSchema = z.object({
  kind: z.literal('timeout-pick'),
  turnOrdinal: z
    .number()
    .int()
    .min(0)
    .max(HAVOC_MULTIPLAYER_TURNS - 1),
  offerId: havocOfferIdSchema,
  cardId: havocCardIdSchema,
});
export const havocMultiplayerReadyNextGamePayloadSchema = z.object({
  kind: z.literal('ready-next-game'),
  gameNumber: z.number().int().min(1).max(HAVOC_MULTIPLAYER_SERIES_GAMES),
});
export const havocMultiplayerBroadcastStartPayloadSchema = z.object({
  kind: z.literal('broadcast-start'),
  gameNumber: z.number().int().min(1).max(HAVOC_MULTIPLAYER_SERIES_GAMES),
  auto: z.boolean().optional(),
});
export const havocMultiplayerProposeResultPayloadSchema = z.object({
  kind: z.literal('propose-result'),
  gameNumber: z.number().int().min(1).max(HAVOC_MULTIPLAYER_SERIES_GAMES),
  winner: havocMultiplayerParticipantIdSchema,
  inputDigest: havocDigestSchema,
  resultDigest: havocDigestSchema,
  tapeDigest: havocDigestSchema,
});
export const havocMultiplayerConfirmResultPayloadSchema = z.object({
  kind: z.literal('confirm-result'),
  gameNumber: z.number().int().min(1).max(HAVOC_MULTIPLAYER_SERIES_GAMES),
  verified: z.boolean(),
  inputDigest: havocDigestSchema,
  resultDigest: havocDigestSchema,
  tapeDigest: havocDigestSchema,
});
export const havocMultiplayerRematchRequestPayloadSchema = z.object({
  kind: z.literal('rematch-request'),
});
export const havocMultiplayerRematchConfirmPayloadSchema = z.object({
  kind: z.literal('rematch-confirm'),
});
export const havocMultiplayerLeavePayloadSchema = z.object({
  kind: z.literal('leave'),
});
export const havocMultiplayerRemoveGuestPayloadSchema = z.object({
  kind: z.literal('remove-guest'),
  targetParticipantId: havocMultiplayerParticipantIdSchema,
});
export const havocMultiplayerCommandPayloadSchema = z.discriminatedUnion('kind', [
  havocMultiplayerReadyPayloadSchema,
  havocMultiplayerStartPayloadSchema,
  havocMultiplayerPickPayloadSchema,
  havocMultiplayerRerollPayloadSchema,
  havocMultiplayerTimeoutPickPayloadSchema,
  havocMultiplayerReadyNextGamePayloadSchema,
  havocMultiplayerBroadcastStartPayloadSchema,
  havocMultiplayerProposeResultPayloadSchema,
  havocMultiplayerConfirmResultPayloadSchema,
  havocMultiplayerRematchRequestPayloadSchema,
  havocMultiplayerRematchConfirmPayloadSchema,
  havocMultiplayerLeavePayloadSchema,
  havocMultiplayerRemoveGuestPayloadSchema,
]);
export type HavocMultiplayerCommandPayload = z.infer<typeof havocMultiplayerCommandPayloadSchema>;
export type HavocMultiplayerCommandKind = HavocMultiplayerCommandPayload['kind'];

export const havocMultiplayerCommandSchema = z.object({
  schemaVersion: z.literal(HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION),
  commandId: commandIdSchema,
  roomId: idSchema,
  actorParticipantId: havocMultiplayerParticipantIdSchema,
  expectedRevision: z.number().int().nonnegative().optional(),
  payload: havocMultiplayerCommandPayloadSchema,
});
export type HavocMultiplayerCommand = z.infer<typeof havocMultiplayerCommandSchema>;

export const havocMultiplayerCommandRejectionCodeSchema = z.enum([
  'not-a-member',
  'invalid-phase',
  'wrong-turn',
  'stale-revision',
  'offer-mismatch',
  'card-unavailable',
  'reroll-unavailable',
  'claim-taken',
  'command-conflict',
  'unknown-command',
  'deadline-passed',
  'room-full',
  'expired',
]);
export type HavocMultiplayerCommandRejectionCode = z.infer<
  typeof havocMultiplayerCommandRejectionCodeSchema
>;

export const havocMultiplayerCommandReceiptSchema = z
  .object({
    roomId: idSchema,
    commandId: commandIdSchema,
    accepted: z.boolean(),
    rejectionCode: havocMultiplayerCommandRejectionCodeSchema.nullable(),
    revision: z.number().int().nonnegative(),
  })
  .superRefine((receipt, ctx) => {
    if (receipt.accepted && receipt.rejectionCode !== null) {
      ctx.addIssue({ code: 'custom', message: 'accepted commands carry no rejection code' });
    }
    if (!receipt.accepted && receipt.rejectionCode === null) {
      ctx.addIssue({ code: 'custom', message: 'rejected commands require a rejection code' });
    }
  });
export type HavocMultiplayerCommandReceipt = z.infer<typeof havocMultiplayerCommandReceiptSchema>;

export const havocMultiplayerMemberSnapshotSchema = z.object({
  participantId: havocMultiplayerParticipantIdSchema,
  displayName: z.string().min(1).max(64),
  online: z.boolean(),
  ready: z.boolean(),
  nextGameReady: z.number().int().min(0).max(HAVOC_MULTIPLAYER_SERIES_GAMES).nullable(),
});
export type HavocMultiplayerMemberSnapshot = z.infer<typeof havocMultiplayerMemberSnapshotSchema>;

export const havocMultiplayerDeadlineSchema = z.object({
  at: z.iso.datetime({ offset: true }),
  cursor: z.string().min(1).max(128),
  participantId: havocMultiplayerParticipantIdSchema,
  fallback: havocMultiplayerCommandPayloadSchema.nullable(),
});
export type HavocMultiplayerDeadline = z.infer<typeof havocMultiplayerDeadlineSchema>;

export const havocMultiplayerBroadcastSchema = z.object({
  gameNumber: z.number().int().min(1).max(HAVOC_MULTIPLAYER_SERIES_GAMES),
  durationMs: z.number().int().positive(),
  startedAt: z.iso.datetime({ offset: true }),
});
export type HavocMultiplayerBroadcast = z.infer<typeof havocMultiplayerBroadcastSchema>;

export const havocMultiplayerSeriesGameStatusSchema = z.enum([
  'scheduled',
  'ready',
  'broadcast',
  'proposed',
  'verified',
  'mismatch',
]);
export type HavocMultiplayerSeriesGameStatus = z.infer<
  typeof havocMultiplayerSeriesGameStatusSchema
>;

export const havocMultiplayerSeriesGameSchema = z
  .object({
    gameNumber: z.number().int().min(1).max(HAVOC_MULTIPLAYER_SERIES_GAMES),
    homeParticipantId: havocMultiplayerParticipantIdSchema,
    awayParticipantId: havocMultiplayerParticipantIdSchema,
    status: havocMultiplayerSeriesGameStatusSchema,
    winner: havocMultiplayerParticipantIdSchema.nullable(),
    inputDigest: havocDigestSchema.nullable(),
    resultDigest: havocDigestSchema.nullable(),
    tapeDigest: havocDigestSchema.nullable(),
  })
  .superRefine((game, ctx) => {
    if (game.homeParticipantId === game.awayParticipantId) {
      ctx.addIssue({ code: 'custom', message: 'series games require two distinct participants' });
    }
    const decided =
      game.status === 'proposed' || game.status === 'verified' || game.status === 'mismatch';
    if (decided) {
      if (game.winner === null) {
        ctx.addIssue({ code: 'custom', message: 'decided games require a winner' });
      }
      if (game.inputDigest === null || game.resultDigest === null || game.tapeDigest === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'decided games require input, result, and tape digests',
        });
      }
    } else {
      if (game.winner !== null) {
        ctx.addIssue({ code: 'custom', message: 'undecided games carry no winner' });
      }
      if (game.inputDigest !== null || game.resultDigest !== null || game.tapeDigest !== null) {
        ctx.addIssue({ code: 'custom', message: 'undecided games carry no digests' });
      }
    }
  });
export type HavocMultiplayerSeriesGame = z.infer<typeof havocMultiplayerSeriesGameSchema>;

const homeCourtGameNumbers: readonly number[] = [1, 2, 5, 7];

export const havocMultiplayerSeriesWinsSchema = z.object({
  p1: z.number().int().min(0).max(HAVOC_MULTIPLAYER_SERIES_WINS),
  p2: z.number().int().min(0).max(HAVOC_MULTIPLAYER_SERIES_WINS),
});
export type HavocMultiplayerSeriesWins = z.infer<typeof havocMultiplayerSeriesWinsSchema>;

export const havocMultiplayerSeriesSnapshotSchema = z
  .object({
    wins: havocMultiplayerSeriesWinsSchema,
    games: z.array(havocMultiplayerSeriesGameSchema).max(HAVOC_MULTIPLAYER_SERIES_GAMES),
    champion: havocMultiplayerParticipantIdSchema.nullable(),
  })
  .superRefine((series, ctx) => {
    const homeParticipantId = series.games[0]?.homeParticipantId;
    const verifiedWins = { p1: 0, p2: 0 };
    series.games.forEach((game, index) => {
      if (game.gameNumber !== index + 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'series game numbers must be sequential from 1',
        });
      }
      if (homeParticipantId !== undefined) {
        const expectedHome = homeCourtGameNumbers.includes(game.gameNumber)
          ? homeParticipantId
          : homeParticipantId === 'p1'
            ? 'p2'
            : 'p1';
        if (game.homeParticipantId !== expectedHome) {
          ctx.addIssue({
            code: 'custom',
            message: 'series games must follow the 2-2-1-1-1 home court pattern',
          });
        }
      }
      if (game.status === 'verified' && game.winner !== null) {
        verifiedWins[game.winner] += 1;
      }
    });
    if (verifiedWins.p1 !== series.wins.p1 || verifiedWins.p2 !== series.wins.p2) {
      ctx.addIssue({ code: 'custom', message: 'series wins must match the verified games' });
    }
    const champion =
      series.wins.p1 === HAVOC_MULTIPLAYER_SERIES_WINS
        ? 'p1'
        : series.wins.p2 === HAVOC_MULTIPLAYER_SERIES_WINS
          ? 'p2'
          : null;
    if (series.champion !== champion) {
      ctx.addIssue({ code: 'custom', message: 'a champion is crowned only at four wins' });
    }
    const runningWins = { p1: 0, p2: 0 };
    series.games.forEach((game, index) => {
      if (game.status !== 'verified' || game.winner === null) {
        return;
      }
      runningWins[game.winner] += 1;
      if (
        runningWins[game.winner] === HAVOC_MULTIPLAYER_SERIES_WINS &&
        index !== series.games.length - 1
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'series games cannot continue after a championship',
        });
      }
    });
  });
export type HavocMultiplayerSeriesSnapshot = z.infer<typeof havocMultiplayerSeriesSnapshotSchema>;

export const havocMultiplayerRoomSnapshotSchema = z.object({
  roomId: idSchema,
  code: havocMultiplayerRoomCodeSchema,
  phase: havocMultiplayerPhaseSchema,
  revision: z.number().int().nonnegative(),
  settings: havocMultiplayerRoomSettingsSchema,
  members: z.array(havocMultiplayerMemberSnapshotSchema).length(2),
  draft: havocMultiplayerDraftStateSchema.nullable(),
  series: havocMultiplayerSeriesSnapshotSchema.nullable(),
  broadcast: havocMultiplayerBroadcastSchema.nullable(),
  deadline: havocMultiplayerDeadlineSchema.nullable(),
  successorRoomId: idSchema.nullable(),
});
export type HavocMultiplayerRoomSnapshot = z.infer<typeof havocMultiplayerRoomSnapshotSchema>;

export const havocMultiplayerRoomMembershipSchema = z.object({
  roomId: idSchema,
  participantId: havocMultiplayerParticipantIdSchema,
  code: havocMultiplayerRoomCodeSchema,
});
export type HavocMultiplayerRoomMembership = z.infer<typeof havocMultiplayerRoomMembershipSchema>;

export const havocMultiplayerVerificationReceiptSchema = z.object({
  receiptId: z.string().min(1).max(64),
  challenge: contentHashSchema,
  receiptDigest: contentHashSchema,
  resultDigest: havocDigestSchema,
  commandIds: z.array(commandIdSchema),
  gameSeeds: z.array(seedSchema),
});
export type HavocMultiplayerVerificationReceipt = z.infer<
  typeof havocMultiplayerVerificationReceiptSchema
>;

export const havocMultiplayerTransientEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('consideration'),
    participantId: havocMultiplayerParticipantIdSchema,
    turnOrdinal: z
      .number()
      .int()
      .min(0)
      .max(HAVOC_MULTIPLAYER_TURNS - 1),
    offerId: havocOfferIdSchema,
    cardId: havocCardIdSchema,
    sentAtMs: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('reaction'),
    participantId: havocMultiplayerParticipantIdSchema,
    turnOrdinal: z
      .number()
      .int()
      .min(0)
      .max(HAVOC_MULTIPLAYER_TURNS - 1),
    reaction: z.enum(['hype', 'clap', 'cold', 'wow']),
    sentAtMs: z.number().int().nonnegative(),
  }),
]);
export type HavocMultiplayerTransientEvent = z.infer<typeof havocMultiplayerTransientEventSchema>;

export const havocMultiplayerErrorCodeSchema = z.enum([
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
export type HavocMultiplayerErrorCode = z.infer<typeof havocMultiplayerErrorCodeSchema>;
export const havocMultiplayerErrorSchema = z.object({
  code: havocMultiplayerErrorCodeSchema,
  message: z.string().min(1).max(512),
  retryable: z.boolean(),
});
export type HavocMultiplayerError = z.infer<typeof havocMultiplayerErrorSchema>;

export interface HavocMultiplayerTransport {
  create(settings: HavocMultiplayerRoomSettingsInput): Promise<{
    snapshot: HavocMultiplayerRoomSnapshot;
    code: HavocMultiplayerRoomCode;
    membership: HavocMultiplayerRoomMembership;
  }>;
  preview(code: string): Promise<HavocMultiplayerRoomSnapshot>;
  join(code: string): Promise<{
    snapshot: HavocMultiplayerRoomSnapshot;
    membership: HavocMultiplayerRoomMembership;
  }>;
  resume(roomId: string): Promise<{
    snapshot: HavocMultiplayerRoomSnapshot;
    membership: HavocMultiplayerRoomMembership;
  }>;
  sync(
    roomId: string,
    afterOrdinal?: number,
  ): Promise<{
    snapshot: HavocMultiplayerRoomSnapshot;
    commands: HavocMultiplayerCommand[];
    commandCount: number;
  }>;
  subscribe(
    roomId: string,
    handler: () => void,
    onError?: (error: Error) => void,
  ): {
    unsubscribe: () => void;
  };
  subscribeTransient(
    roomId: string,
    handler: (event: HavocMultiplayerTransientEvent) => void,
  ): {
    unsubscribe: () => void;
  };
  publishTransient(roomId: string, event: HavocMultiplayerTransientEvent): Promise<boolean>;
  refetch(roomId: string, afterRevision: number): Promise<HavocMultiplayerCommand[]>;
  submitCommand(command: HavocMultiplayerCommand): Promise<HavocMultiplayerCommandReceipt>;
  commitFallback(
    roomId: string,
    cursor: string,
    payload: HavocMultiplayerCommandPayload,
    expectedRevision?: number,
  ): Promise<{
    stored: boolean;
    revision: number;
  }>;
  resolveTimeout(roomId: string): Promise<HavocMultiplayerCommandReceipt | null>;
  removeGuest(
    roomId: string,
    targetParticipantId: HavocMultiplayerParticipantId,
  ): Promise<HavocMultiplayerRoomSnapshot>;
  leave(roomId: string, participantId: HavocMultiplayerParticipantId): Promise<void>;
  rematch(roomId: string): Promise<{
    snapshot: HavocMultiplayerRoomSnapshot;
    code: HavocMultiplayerRoomCode;
  }>;
  verificationChallenge(roomId: string): Promise<string>;
  submitVerification(
    roomId: string,
    receipt: HavocMultiplayerVerificationReceipt,
    expectedRevision?: number,
  ): Promise<{
    receiptId: string;
    revision: number;
  }>;
  complete(
    roomId: string,
    receiptId: string,
  ): Promise<{
    completed: boolean;
    phase: HavocMultiplayerPhase;
  }>;
  fail(roomId: string): Promise<{
    failed: boolean;
    phase: HavocMultiplayerPhase;
  }>;
}
