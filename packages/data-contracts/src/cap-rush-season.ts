import { z } from 'zod';
import { franchiseIdSchema, idSchema, playerIdSchema, seedSchema } from './ids.ts';
import { positionSchema } from './positions.ts';
import { havocInstanceIdSchema } from './havoc-profile.ts';
import { havocGameAuditSchema, havocGameResultSchema } from './havoc-game.ts';
import {
  CAP_RUSH_GAME_COUNT,
  CAP_RUSH_REPORT_VERSION,
  CAP_RUSH_SCHEMA_VERSION,
  capRushCardIdSchema,
  capRushDigestSchema,
  capRushPayrollStatusSchema,
  capRushSpinPurchaseSchema,
  capRushVariantSchema,
} from './cap-rush-versions.ts';
import { havocMutationIdSchema, havocTierSchema } from './havoc-mutations.ts';

export const capRushGameSummarySchema = z.object({
  gameNumber: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT),
  opponentId: z.string().min(1).max(64),
  humanHome: z.boolean(),
  humanPoints: z.number().int(),
  opponentPoints: z.number().int(),
  won: z.boolean(),
  overtimePeriods: z.number().int().nonnegative(),
  inputDigest: capRushDigestSchema,
  resultDigest: capRushDigestSchema,
});
export type CapRushGameSummary = z.infer<typeof capRushGameSummarySchema>;

export const capRushSeasonAggregateSchema = z
  .object({
    games: z.number().int().min(0).max(CAP_RUSH_GAME_COUNT),
    wins: z.number().int().min(0).max(CAP_RUSH_GAME_COUNT),
    losses: z.number().int().min(0).max(CAP_RUSH_GAME_COUNT),
    pointsFor: z.number().int(),
    pointsAgainst: z.number().int(),
    perfectSeason: z.boolean(),
  })
  .superRefine((aggregate, ctx) => {
    if (aggregate.wins + aggregate.losses !== aggregate.games) {
      ctx.addIssue({ code: 'custom', message: 'wins and losses must sum to games' });
    }
    if (aggregate.perfectSeason && aggregate.losses !== 0) {
      ctx.addIssue({ code: 'custom', message: 'a perfect season has no losses' });
    }
    if (aggregate.perfectSeason && aggregate.games !== CAP_RUSH_GAME_COUNT) {
      ctx.addIssue({ code: 'custom', message: 'a perfect season must play all 82 games' });
    }
  });
export type CapRushSeasonAggregate = z.infer<typeof capRushSeasonAggregateSchema>;

export const capRushApronTriggerTotalsSchema = z.object({
  isolations: z.number().int().nonnegative(),
  strikes: z.number().int().nonnegative(),
});
export type CapRushApronTriggerTotals = z.infer<typeof capRushApronTriggerTotalsSchema>;

export const capRushPlayerSeasonLineSchema = z.object({
  slot: positionSchema,
  cardId: capRushCardIdSchema,
  playerId: playerIdSchema,
  playerVersionId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  salaryDollars: z.number().int().nonnegative(),
  gamesPlayed: z.number().int().nonnegative(),
  minutes: z.number().int().nonnegative(),
  points: z.number().int(),
  rebounds: z.number().int(),
  assists: z.number().int(),
  steals: z.number().int(),
  blocks: z.number().int(),
  turnovers: z.number().int(),
  fouls: z.number().int(),
  fieldGoalsMade: z.number().int(),
  fieldGoalsAttempted: z.number().int(),
  threesMade: z.number().int(),
  threesAttempted: z.number().int(),
  freeThrowsMade: z.number().int(),
  freeThrowsAttempted: z.number().int(),
  adjustments: z.number().int(),
});
export type CapRushPlayerSeasonLine = z.infer<typeof capRushPlayerSeasonLineSchema>;

export const capRushMvpEntrySchema = z.object({
  playerId: playerIdSchema,
  displayName: z.string().min(1).max(96),
  teamId: z.string().min(1).max(64),
  teamName: z.string().min(1).max(96),
  isUserTeam: z.boolean(),
  slot: positionSchema.nullable(),
  appearances: z.number().int().nonnegative(),
  mvpScore: z.number(),
  averageGameScore: z.number(),
  averageEfficiency: z.number(),
  consistency: z.number(),
  averagePoints: z.number(),
  averageRebounds: z.number(),
  averageAssists: z.number(),
  averageSteals: z.number(),
  averageBlocks: z.number(),
});
export type CapRushMvpEntry = z.infer<typeof capRushMvpEntrySchema>;

export const capRushReportSchema = z
  .object({
    reportVersion: z.literal(CAP_RUSH_REPORT_VERSION),
    schemaVersion: z.literal(CAP_RUSH_SCHEMA_VERSION),
    runId: idSchema,
    runSeed: seedSchema,
    variant: capRushVariantSchema,
    payrollStatus: capRushPayrollStatusSchema,
    payrollDollars: z.number().int().nonnegative(),
    spinSpendDollars: z.number().int().nonnegative(),
    totalSpendDollars: z.number().int().nonnegative(),
    unusedCapDollars: z.number().int(),
    winsPerMillion: z.number().nullable(),
    aggregate: capRushSeasonAggregateSchema,
    apronTriggers: capRushApronTriggerTotalsSchema,
    targetSlot: positionSchema,
    targetInstanceId: havocInstanceIdSchema,
    spin: z
      .object({
        purchase: capRushSpinPurchaseSchema,
        priceDollars: z.number().int().nonnegative(),
        tier: havocTierSchema,
        mutationId: havocMutationIdSchema,
        targetCardId: capRushCardIdSchema,
      })
      .nullable(),
    players: z.array(capRushPlayerSeasonLineSchema).length(5),
    mvp: capRushMvpEntrySchema.nullable(),
    leagueBaselineTs: z.number(),
    hasMutationScoring: z.boolean(),
    games: z.array(capRushGameSummarySchema).length(CAP_RUSH_GAME_COUNT),
  })
  .superRefine((report, ctx) => {
    if (report.spinSpendDollars < 0) {
      ctx.addIssue({ code: 'custom', message: 'spin spend cannot be negative' });
    }
    const expected = report.payrollDollars + report.spinSpendDollars;
    if (report.totalSpendDollars !== expected) {
      ctx.addIssue({
        code: 'custom',
        message: `total spend ${String(report.totalSpendDollars)} must equal payroll plus spin`,
      });
    }
    if (report.spin === null && report.spinSpendDollars !== 0) {
      ctx.addIssue({ code: 'custom', message: 'a no-spin report cannot carry spin spend' });
    }
    if (report.spin !== null && report.spinSpendDollars !== report.spin.priceDollars) {
      ctx.addIssue({ code: 'custom', message: 'spin spend must equal the purchased price' });
    }
    const slots = new Set(report.players.map((line) => line.slot));
    if (slots.size !== 5) {
      ctx.addIssue({ code: 'custom', message: 'a report carries exactly five distinct slots' });
    }
  });
export type CapRushReport = z.infer<typeof capRushReportSchema>;

export const capRushStoredGameSchema = z.object({
  gameNumber: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT),
  summary: capRushGameSummarySchema,
  audit: havocGameAuditSchema,
  result: havocGameResultSchema,
});
export type CapRushStoredGame = z.infer<typeof capRushStoredGameSchema>;

export const capRushHistoryEntrySchema = z.object({
  runId: idSchema,
  variant: capRushVariantSchema,
  payrollStatus: capRushPayrollStatusSchema,
  payrollDollars: z.number().int().nonnegative(),
  wins: z.number().int().min(0).max(CAP_RUSH_GAME_COUNT),
  losses: z.number().int().min(0).max(CAP_RUSH_GAME_COUNT),
  perfectSeason: z.boolean(),
  completedAtIso: z.iso.datetime(),
});
export type CapRushHistoryEntry = z.infer<typeof capRushHistoryEntrySchema>;

export const capRushSeasonStateSchema = z.object({
  games: z.array(capRushGameSummarySchema).max(CAP_RUSH_GAME_COUNT),
  aggregate: capRushSeasonAggregateSchema,
  apronTriggers: capRushApronTriggerTotalsSchema,
  completedAt: z.iso.datetime().nullable(),
});
export type CapRushSeasonState = z.infer<typeof capRushSeasonStateSchema>;

export const capRushEmptySeasonState = (): CapRushSeasonState => ({
  games: [],
  aggregate: {
    games: 0,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    perfectSeason: false,
  },
  apronTriggers: { isolations: 0, strikes: 0 },
  completedAt: null,
});

export const capRushTeamIdSchema = franchiseIdSchema;
