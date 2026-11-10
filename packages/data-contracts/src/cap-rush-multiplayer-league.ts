import { z } from 'zod';
import { idSchema, seedSchema } from './ids.ts';
import { eraSimulationProfileSchema } from './era-sim-profile.ts';
import { havocTeamInputSchema } from './havoc-game.ts';
import { capRushCatalogSourceSchema, capRushPayrollStatusSchema } from './cap-rush-versions.ts';
import {
  capRushFranchiseAssignmentSchema,
  capRushFrozenOpponentSchema,
  capRushHighestPaidTargetSchema,
  capRushLockedPickSchema,
} from './cap-rush-lock.ts';
import {
  CAP_RUSH_CONFERENCE_GAMES,
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_CONFERENCE_SIZE,
  CAP_RUSH_TAKEOVER_TEAMS,
  capRushAlignmentOf,
  capRushConferenceStandingsSchema,
  capRushLeagueGameSchema,
  capRushLeagueScheduleEntrySchema,
} from './cap-rush-league.ts';
import {
  capRushConferenceSeriesSchema,
  capRushFinalsMvpSchema,
  capRushPostseasonUserOutcomeSchema,
} from './cap-rush-postseason.ts';
import { capRushSpinReceiptSchema } from './cap-rush-spin.ts';
import { capRushPlayoffPerformanceSchema } from './cap-rush-playoff.ts';
import {
  CAP_RUSH_MULTIPLAYER_BLOCK_COUNT,
  CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS,
  CAP_RUSH_MULTIPLAYER_POSTSEASON_VERSION,
  CAP_RUSH_MULTIPLAYER_REPORT_VERSION,
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  capRushMultiplayerBlockChoiceSchema,
  capRushMultiplayerSeatIdSchema,
  capRushMultiplayerVariantSchema,
  capRushMultiplayerVersionLocksSchema,
} from './cap-rush-multiplayer-versions.ts';

export const capRushMultiplayerSeatLockSchema = z.object({
  seat: capRushMultiplayerSeatIdSchema,
  franchise: capRushFranchiseAssignmentSchema,
  picks: z.array(capRushLockedPickSchema).length(5),
  team: havocTeamInputSchema,
  payrollDollars: z.number().int().nonnegative(),
  payrollStatus: capRushPayrollStatusSchema,
  target: capRushHighestPaidTargetSchema,
  spin: capRushSpinReceiptSchema.nullable(),
  additionalSpins: z.array(capRushSpinReceiptSchema).max(4).optional(),
  ready: z.boolean(),
});
export type CapRushMultiplayerSeatLock = z.infer<typeof capRushMultiplayerSeatLockSchema>;

export const capRushMultiplayerSeatLockMapSchema = z.object({
  p1: capRushMultiplayerSeatLockSchema,
  p2: capRushMultiplayerSeatLockSchema,
});

export const capRushMultiplayerLockedInputsSchema = z
  .object({
    schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION),
    roomId: idSchema,
    rootSeed: seedSchema,
    variant: capRushMultiplayerVariantSchema,
    versionLocks: capRushMultiplayerVersionLocksSchema,
    profile: eraSimulationProfileSchema,
    catalog: capRushCatalogSourceSchema,
    seats: capRushMultiplayerSeatLockMapSchema,
    opponents: z.array(capRushFrozenOpponentSchema).length(CAP_RUSH_TAKEOVER_TEAMS - 2),
    leagueSchedule: z.array(capRushLeagueScheduleEntrySchema).length(CAP_RUSH_CONFERENCE_GAMES),
    playoffPerformance: z
      .object({
        p1: capRushPlayoffPerformanceSchema.optional(),
        p2: capRushPlayoffPerformanceSchema.optional(),
      })
      .optional(),
  })
  .superRefine((locked, ctx) => {
    const seats = [locked.seats.p1, locked.seats.p2];
    const teamIds = new Set<string>();
    for (const seat of seats) {
      if (seat.payrollStatus === 'illegal') {
        ctx.addIssue({ code: 'custom', message: 'an illegal payroll cannot be locked' });
      }
      if (seat.team.teamId !== seat.franchise.franchiseId) {
        ctx.addIssue({ code: 'custom', message: 'the locked team must be the assigned franchise' });
      }
      if (seat.team.side !== 'human') {
        ctx.addIssue({ code: 'custom', message: 'both seats must field a human-side team' });
      }
      if (seat.team.starters.length !== 5 || seat.team.replacements.length !== 5) {
        ctx.addIssue({
          code: 'custom',
          message: 'a locked team needs five starters and replacements',
        });
      }
      if (seat.payrollDollars > CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS) {
        ctx.addIssue({ code: 'custom', message: 'a locked payroll exceeds the hard limit' });
      }
      if (seat.spin !== null && seat.payrollStatus !== 'under-cap') {
        ctx.addIssue({ code: 'custom', message: 'a spin receipt is only valid under the cap' });
      }
      if (seat.spin !== null && locked.variant !== 'roulette') {
        ctx.addIssue({ code: 'custom', message: 'Cap Clash cannot lock a spin receipt' });
      }
      const slots = new Set(seat.picks.map((pick) => pick.slot));
      if (slots.size !== 5) {
        ctx.addIssue({ code: 'custom', message: 'a locked seat must fill five distinct slots' });
      }
      if (teamIds.has(seat.franchise.franchiseId)) {
        ctx.addIssue({
          code: 'custom',
          message: 'the two seats must control different franchises',
        });
      }
      teamIds.add(seat.franchise.franchiseId);
    }
    const first = seats[0];
    const second = seats[1];
    if (first !== undefined && second !== undefined) {
      if (first.franchise.franchiseId !== second.franchise.franchiseId) {
        const left = capRushAlignmentOf(first.franchise.franchiseId);
        const right = capRushAlignmentOf(second.franchise.franchiseId);
        if (left.conference === right.conference) {
          ctx.addIssue({
            code: 'custom',
            message: 'the two seats must sit in opposite conferences',
          });
        }
      }
    }
    for (const opponent of locked.opponents) teamIds.add(opponent.team.teamId);
    if (teamIds.size !== CAP_RUSH_TAKEOVER_TEAMS) {
      ctx.addIssue({ code: 'custom', message: 'the league field must hold thirty distinct teams' });
    }
    const scheduleTeams = new Set<string>();
    for (const game of locked.leagueSchedule) {
      scheduleTeams.add(game.homeTeamId);
      scheduleTeams.add(game.awayTeamId);
    }
    for (const teamId of teamIds) {
      if (!scheduleTeams.has(teamId)) {
        ctx.addIssue({ code: 'custom', message: `the schedule misses ${teamId}` });
      }
    }
  });
export type CapRushMultiplayerLockedInputs = z.infer<typeof capRushMultiplayerLockedInputsSchema>;

export const capRushMultiplayerBlockSchema = z.object({
  index: z
    .number()
    .int()
    .min(0)
    .max(CAP_RUSH_MULTIPLAYER_BLOCK_COUNT - 1),
  endpoint: z.number().int().min(1).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
  plans: z.object({
    p1: capRushMultiplayerBlockChoiceSchema.nullable(),
    p2: capRushMultiplayerBlockChoiceSchema.nullable(),
  }),
  status: z.enum(['choosing', 'running', 'complete']),
  startedAtIso: z.iso.datetime().nullable(),
  completedAtIso: z.iso.datetime().nullable(),
});

export const capRushMultiplayerPlaybackAckSchema = z.object({
  gameId: z.string().min(1).max(80),
  seat: capRushMultiplayerSeatIdSchema,
  cursor: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  resolved: z.boolean(),
});

export const capRushMultiplayerSeasonStateSchema = z.object({
  games: z.array(capRushLeagueGameSchema).max(CAP_RUSH_CONFERENCE_GAMES),
  frontierSlot: z.number().int().min(0).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
  h2hSlots: z.array(z.number().int().min(1).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM)).max(2),
  block: capRushMultiplayerBlockSchema,
  slotAcks: z.object({
    p1: z.number().int().min(0).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
    p2: z.number().int().min(0).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
  }),
  playbackAcks: z.array(capRushMultiplayerPlaybackAckSchema).max(256),
});
export type CapRushMultiplayerSeasonState = z.infer<typeof capRushMultiplayerSeasonStateSchema>;

export const capRushMultiplayerPlayoffStateSchema = z.object({
  version: z.literal(CAP_RUSH_MULTIPLAYER_POSTSEASON_VERSION),
  phase: z.enum(['awaiting-standings', 'playoffs', 'complete']),
  standings: capRushConferenceStandingsSchema.nullable(),
  series: z.array(capRushConferenceSeriesSchema).max(15),
  outcomes: z.object({
    p1: capRushPostseasonUserOutcomeSchema,
    p2: capRushPostseasonUserOutcomeSchema,
  }),
  plans: z.object({
    p1: capRushMultiplayerBlockChoiceSchema.nullable(),
    p2: capRushMultiplayerBlockChoiceSchema.nullable(),
  }),
  planRound: z.number().int().min(1).max(4),
  championTeamId: z.string().min(1).max(64).nullable(),
  finalsMvp: capRushFinalsMvpSchema.nullable(),
  completedAt: z.iso.datetime().nullable(),
});
export type CapRushMultiplayerPlayoffState = z.infer<typeof capRushMultiplayerPlayoffStateSchema>;

export const capRushMultiplayerSeatReportSchema = z.object({
  seat: capRushMultiplayerSeatIdSchema,
  franchiseId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  pointsFor: z.number().int(),
  pointsAgainst: z.number().int(),
  payrollDollars: z.number().int().nonnegative(),
  payrollStatus: capRushPayrollStatusSchema,
  spinSpendDollars: z.number().int().nonnegative(),
  winsPerMillion: z.number().nullable(),
  outcome: capRushPostseasonUserOutcomeSchema,
  roster: z.array(capRushLockedPickSchema).length(5),
});
export type CapRushMultiplayerSeatReport = z.infer<typeof capRushMultiplayerSeatReportSchema>;

export const capRushMultiplayerReportSchema = z.object({
  version: z.literal(CAP_RUSH_MULTIPLAYER_REPORT_VERSION),
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION),
  roomId: idSchema,
  rootSeed: seedSchema,
  variant: capRushMultiplayerVariantSchema,
  championTeamId: z.string().min(1).max(64),
  seats: z.object({
    p1: capRushMultiplayerSeatReportSchema,
    p2: capRushMultiplayerSeatReportSchema,
  }),
  finalsMvp: capRushFinalsMvpSchema.nullable(),
  completedAtIso: z.iso.datetime(),
});
export type CapRushMultiplayerReport = z.infer<typeof capRushMultiplayerReportSchema>;

export const capRushMultiplayerCheckpointSchema = z.object({
  revision: z.number().int().nonnegative(),
  commandCount: z.number().int().nonnegative(),
  stateDigest: z.string().min(1).max(64),
  acceptedThroughSlot: z.number().int().min(0).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
  gamesDigest: z.string().min(1).max(64),
  standingsDigest: z.string().min(1).max(64).nullable(),
});
export type CapRushMultiplayerCheckpoint = z.infer<typeof capRushMultiplayerCheckpointSchema>;

export const capRushMultiplayerOutcomeSchema = z.object({
  championTeamId: z.string().min(1).max(64),
  completedAtIso: z.iso.datetime(),
});
