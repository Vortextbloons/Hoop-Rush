import { z } from 'zod';
import { franchiseIdSchema, idSchema, playerIdSchema, seedSchema } from './ids.ts';
import { positionSchema } from './positions.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { capRushBucketSchema, capRushDigestSchema } from './cap-rush-versions.ts';
import { capRushSourcePlayerSchema } from './cap-rush-draft.ts';
import {
  CAP_RUSH_MULTIPLAYER_MARKET_VERSION,
  CAP_RUSH_MULTIPLAYER_POOL_SIZE,
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  capRushMultiplayerSeatIdSchema,
} from './cap-rush-multiplayer-versions.ts';

export const capRushMultiplayerMarketPlayerSchema = z.object({
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema,
  displayName: z.string().min(1).max(96),
  position: positionSchema,
  bucket: capRushBucketSchema,
  franchiseId: franchiseIdSchema,
  seasonKey: z.string().min(4).max(11),
  originalOverall: z.number().int().min(40).max(99),
  soloSalaryDollars: z.number().int().nonnegative(),
  minimumBidDollars: z.number().int().nonnegative(),
  source: capRushSourcePlayerSchema,
});
export type CapRushMultiplayerMarketPlayer = z.infer<typeof capRushMultiplayerMarketPlayerSchema>;

export const capRushMultiplayerMarketSchema = z
  .object({
    schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION),
    version: z.literal(CAP_RUSH_MULTIPLAYER_MARKET_VERSION),
    seed: seedSchema,
    attempt: z.number().int().nonnegative(),
    players: z.array(capRushMultiplayerMarketPlayerSchema).length(60),
    digest: capRushDigestSchema,
  })
  .superRefine((market, ctx) => {
    const people = new Set<string>();
    const perPosition = new Map<string, number>();
    for (const player of market.players) {
      if (people.has(player.playerId)) {
        ctx.addIssue({ code: 'custom', message: `player ${player.playerId} appears twice` });
      }
      people.add(player.playerId);
      perPosition.set(player.position, (perPosition.get(player.position) ?? 0) + 1);
      if (player.source.playerId !== player.playerId) {
        ctx.addIssue({ code: 'custom', message: 'market source player does not match' });
      }
      if (player.source.playerVersionId !== player.playerVersionId) {
        ctx.addIssue({ code: 'custom', message: 'market source version does not match' });
      }
      if (!player.source.positions.includes(player.position)) {
        ctx.addIssue({ code: 'custom', message: 'market player cannot play its position' });
      }
    }
    for (const position of ['PG', 'SG', 'SF', 'PF', 'C'] as const) {
      if ((perPosition.get(position) ?? 0) !== CAP_RUSH_MULTIPLAYER_POOL_SIZE) {
        ctx.addIssue({
          code: 'custom',
          message: `${position} pool must hold ${String(CAP_RUSH_MULTIPLAYER_POOL_SIZE)} players`,
        });
      }
    }
  });
export type CapRushMultiplayerMarket = z.infer<typeof capRushMultiplayerMarketSchema>;

export const capRushMultiplayerAuctionSchema = z
  .object({
    playerId: playerIdSchema,
    position: positionSchema,
    status: z.enum(['open', 'closed']),
    openedAtIso: z.iso.datetime(),
    endsAtIso: z.iso.datetime(),
    leaderSeat: capRushMultiplayerSeatIdSchema.nullable(),
    leaderBidDollars: z.number().int().nonnegative().nullable(),
    winningSeat: capRushMultiplayerSeatIdSchema.nullable(),
    winningBidDollars: z.number().int().nonnegative().nullable(),
  })
  .superRefine((auction, ctx) => {
    if (auction.endsAtIso < auction.openedAtIso) {
      ctx.addIssue({ code: 'custom', message: 'an auction cannot end before it opens' });
    }
    if ((auction.leaderSeat === null) !== (auction.leaderBidDollars === null)) {
      ctx.addIssue({ code: 'custom', message: 'a leading bid needs a seat and an amount' });
    }
    if (auction.status === 'open' && auction.winningSeat !== null) {
      ctx.addIssue({ code: 'custom', message: 'an open auction has no winner' });
    }
    if (auction.status === 'closed' && auction.winningSeat !== auction.leaderSeat) {
      ctx.addIssue({ code: 'custom', message: 'a closed auction awards its leading bid' });
    }
    if (auction.status === 'closed' && auction.winningSeat !== null) {
      if (auction.winningBidDollars !== auction.leaderBidDollars) {
        ctx.addIssue({ code: 'custom', message: 'the winning bid must match the leading bid' });
      }
    }
  });
export type CapRushMultiplayerAuction = z.infer<typeof capRushMultiplayerAuctionSchema>;

export const capRushMultiplayerRoundSchema = z.object({
  index: z.number().int().min(0).max(4),
  position: positionSchema,
  status: z.enum(['bidding', 'complete']),
  auctions: z.array(capRushMultiplayerAuctionSchema).length(12),
  closedAtIso: z.iso.datetime().nullable(),
  endEarlySeats: z.array(capRushMultiplayerSeatIdSchema).max(2).optional(),
});
export type CapRushMultiplayerRound = z.infer<typeof capRushMultiplayerRoundSchema>;

export const capRushMultiplayerSigningSchema = z.object({
  seat: capRushMultiplayerSeatIdSchema,
  position: positionSchema,
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema,
  displayName: z.string().min(1).max(96),
  salaryDollars: z.number().int().nonnegative(),
  source: z.enum(['bid', 'auto']),
});
export type CapRushMultiplayerSigning = z.infer<typeof capRushMultiplayerSigningSchema>;

export const capRushMultiplayerSeatRecruitmentSchema = z.object({
  seat: capRushMultiplayerSeatIdSchema,
  filledPositions: z.array(positionSchema).max(5),
  leadPlayerId: playerIdSchema.nullable(),
  payrollDollars: z.number().int().nonnegative(),
});
export type CapRushMultiplayerSeatRecruitment = z.infer<
  typeof capRushMultiplayerSeatRecruitmentSchema
>;

export const capRushMultiplayerSeatRecruitmentMapSchema = z.object({
  p1: capRushMultiplayerSeatRecruitmentSchema,
  p2: capRushMultiplayerSeatRecruitmentSchema,
});

export const capRushMultiplayerRecruitmentSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION),
  market: capRushMultiplayerMarketSchema,
  roundIndex: z.number().int().min(0).max(4),
  rounds: z.array(capRushMultiplayerRoundSchema).min(1).max(5),
  signings: z.array(capRushMultiplayerSigningSchema).max(10),
  seats: capRushMultiplayerSeatRecruitmentMapSchema,
});
export type CapRushMultiplayerRecruitment = z.infer<typeof capRushMultiplayerRecruitmentSchema>;
