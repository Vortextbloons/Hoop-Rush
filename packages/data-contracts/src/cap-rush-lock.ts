import { z } from 'zod';
import { idSchema, playerIdSchema, seedSchema } from './ids.ts';
import { positionSchema } from './positions.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { eraSimulationProfileSchema } from './era-sim-profile.ts';
import { havocInstanceIdSchema } from './havoc-profile.ts';
import { havocTeamInputSchema } from './havoc-game.ts';
import {
  CAP_RUSH_DRAFT_ROUNDS,
  CAP_RUSH_GAME_COUNT,
  CAP_RUSH_SCHEMA_VERSION,
  capRushBucketSchema,
  capRushCardIdSchema,
  capRushCatalogSourceSchema,
  capRushPayrollStatusSchema,
  capRushVariantSchema,
  capRushVersionSetSchema,
} from './cap-rush-versions.ts';
import {
  CAP_RUSH_CONFERENCE_AI_GAMES,
  CAP_RUSH_CONFERENCE_GAMES,
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  CAP_RUSH_TAKEOVER_TEAMS,
  capRushAlignmentOf,
  capRushConferenceSchema,
  capRushDivisionSchema,
  capRushLeagueScheduleEntrySchema,
  type CapRushLeagueScheduleEntry,
} from './cap-rush-league.ts';
import { capRushSpinReceiptSchema } from './cap-rush-spin.ts';

export const capRushFranchiseAssignmentSchema = z.object({
  franchiseId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  conference: capRushConferenceSchema,
  division: capRushDivisionSchema,
});
export type CapRushFranchiseAssignment = z.infer<typeof capRushFranchiseAssignmentSchema>;

export const capRushLockedPickSchema = z.object({
  pickOrdinal: z
    .number()
    .int()
    .min(0)
    .max(CAP_RUSH_DRAFT_ROUNDS - 1),
  slot: positionSchema,
  cardId: capRushCardIdSchema,
  bucket: capRushBucketSchema,
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema,
  salaryDollars: z.number().int().nonnegative(),
});
export type CapRushLockedPick = z.infer<typeof capRushLockedPickSchema>;

export const capRushHighestPaidTargetSchema = z.object({
  pickOrdinal: z
    .number()
    .int()
    .min(0)
    .max(CAP_RUSH_DRAFT_ROUNDS - 1),
  cardId: capRushCardIdSchema,
  slot: positionSchema,
  instanceId: havocInstanceIdSchema,
});
export type CapRushHighestPaidTarget = z.infer<typeof capRushHighestPaidTargetSchema>;

export const capRushScheduleEntrySchema = z.object({
  gameNumber: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT),
  opponentId: z.string().min(1).max(64),
  humanHome: z.boolean(),
});
export type CapRushScheduleEntry = z.infer<typeof capRushScheduleEntrySchema>;

export const capRushFrozenOpponentSchema = z.object({
  opponentId: z.string().min(1).max(64),
  team: havocTeamInputSchema,
});
export type CapRushFrozenOpponent = z.infer<typeof capRushFrozenOpponentSchema>;

export const capRushLockedInputsSchema = z
  .object({
    schemaVersion: z.literal(CAP_RUSH_SCHEMA_VERSION),
    runId: idSchema,
    runSeed: seedSchema,
    variant: capRushVariantSchema,
    versionSet: capRushVersionSetSchema,
    profile: eraSimulationProfileSchema,
    catalog: capRushCatalogSourceSchema,
    picks: z.array(capRushLockedPickSchema).length(CAP_RUSH_DRAFT_ROUNDS),
    payrollDollars: z.number().int().nonnegative(),
    payrollStatus: capRushPayrollStatusSchema,
    target: capRushHighestPaidTargetSchema,
    spin: capRushSpinReceiptSchema.nullable(),
    additionalSpins: z.array(capRushSpinReceiptSchema).max(4).optional(),
    franchise: capRushFranchiseAssignmentSchema.optional(),
    leagueSchedule: z
      .array(capRushLeagueScheduleEntrySchema)
      .max(CAP_RUSH_CONFERENCE_GAMES)
      .optional(),
    human: havocTeamInputSchema,
    schedule: z.array(capRushScheduleEntrySchema).length(CAP_RUSH_GAME_COUNT),
    opponents: z.array(capRushFrozenOpponentSchema).min(1).max(64),
  })
  .superRefine((locked, ctx) => {
    if (locked.human.side !== 'human') {
      ctx.addIssue({ code: 'custom', message: 'locked human team must carry the human side' });
    }
    if (locked.payrollStatus === 'illegal') {
      ctx.addIssue({ code: 'custom', message: 'an illegal payroll cannot be locked' });
    }
    if (locked.spin !== null && locked.payrollStatus !== 'under-cap') {
      ctx.addIssue({
        code: 'custom',
        message: 'a spin receipt is only valid under the normal cap',
      });
    }
    if (locked.spin !== null && locked.variant !== 'roulette') {
      ctx.addIssue({ code: 'custom', message: 'Cap Clash cannot lock a spin receipt' });
    }
    const receipts = locked.spin === null ? [] : [locked.spin, ...(locked.additionalSpins ?? [])];
    if (locked.spin === null && (locked.additionalSpins?.length ?? 0) > 0) {
      ctx.addIssue({ code: 'custom', message: 'additional spins require a first spin' });
    }
    let spend = locked.payrollDollars;
    const spinTargets = new Set<string>();
    for (const receipt of receipts) {
      const pick = locked.picks.find((entry) => entry.cardId === receipt.target.cardId);
      if (
        !pick ||
        pick.slot !== receipt.target.slot ||
        pick.pickOrdinal !== receipt.target.pickOrdinal ||
        pick.playerVersionId !== receipt.target.playerVersionId ||
        spinTargets.has(receipt.target.cardId) ||
        receipt.payrollDollars !== spend
      ) {
        ctx.addIssue({
          code: 'custom',
          message:
            'spin receipts must target distinct locked players and account for prior spending',
        });
      }
      spinTargets.add(receipt.target.cardId);
      spend += receipt.priceDollars;
    }
    locked.picks.forEach((pick, index) => {
      if (pick.pickOrdinal !== index) {
        ctx.addIssue({ code: 'custom', message: 'locked picks must be in draft order' });
      }
    });
    const slots = new Set(locked.picks.map((pick) => pick.slot));
    if (slots.size !== CAP_RUSH_DRAFT_ROUNDS) {
      ctx.addIssue({ code: 'custom', message: 'locked picks must fill five distinct slots' });
    }
    const starter = locked.human.starters.find(
      (candidate) => candidate.instanceId === locked.target.instanceId,
    );
    if (starter === undefined) {
      ctx.addIssue({ code: 'custom', message: 'the apron target must be a locked starter' });
    } else if (starter.slot !== locked.target.slot) {
      ctx.addIssue({ code: 'custom', message: 'the apron target slot must match its starter' });
    }
    const opponentIds = new Set(locked.opponents.map((opponent) => opponent.opponentId));
    locked.schedule.forEach((entry, index) => {
      if (entry.gameNumber !== index + 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'schedule game numbers must be sequential from 1',
        });
      }
      if (!opponentIds.has(entry.opponentId)) {
        ctx.addIssue({
          code: 'custom',
          message: `schedule references unknown opponent ${entry.opponentId}`,
        });
      }
    });
    for (const opponent of locked.opponents) {
      if (opponent.team.side !== 'opponent' || opponent.team.clones.length !== 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'frozen opponents must be opponent-side teams without clones',
        });
      }
    }
    if ((locked.franchise === undefined) !== (locked.leagueSchedule === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'takeover runs carry both a franchise assignment and a league schedule',
      });
    }
    if (locked.franchise !== undefined && locked.leagueSchedule !== undefined) {
      const franchise = locked.franchise;
      if (
        !CAP_RUSH_FRANCHISE_ALIGNMENT.some((entry) => entry.franchiseId === franchise.franchiseId)
      ) {
        ctx.addIssue({ code: 'custom', message: 'unknown takeover franchise' });
      }
      const alignment = capRushAlignmentOf(franchise.franchiseId);
      if (
        alignment.conference !== franchise.conference ||
        alignment.division !== franchise.division
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'franchise alignment does not match its identity',
        });
      }
      if (locked.human.teamId !== franchise.franchiseId) {
        ctx.addIssue({ code: 'custom', message: 'the user team must be the takeover franchise' });
      }
      if (locked.human.displayName !== franchise.displayName) {
        ctx.addIssue({ code: 'custom', message: 'the user team must carry franchise branding' });
      }
      if (locked.opponents.length !== CAP_RUSH_TAKEOVER_TEAMS - 1) {
        ctx.addIssue({
          code: 'custom',
          message: `a takeover field carries ${String(CAP_RUSH_TAKEOVER_TEAMS - 1)} opponents`,
        });
      }
      const teamIds = new Set<string>([locked.human.teamId]);
      for (const opponent of locked.opponents) teamIds.add(opponent.team.teamId);
      if (teamIds.size !== CAP_RUSH_TAKEOVER_TEAMS) {
        ctx.addIssue({
          code: 'custom',
          message: 'the league field must hold thirty distinct teams',
        });
      }
      if (locked.leagueSchedule.length !== CAP_RUSH_CONFERENCE_GAMES) {
        ctx.addIssue({
          code: 'custom',
          message: `the league schedule carries ${String(CAP_RUSH_CONFERENCE_GAMES)} games`,
        });
      }
      const slots = new Map<number, Set<string>>();
      const gamesPerTeam = new Map<string, { home: number; away: number }>();
      let userGames = 0;
      const userBySlot = new Map<number, CapRushLeagueScheduleEntry>();
      for (const game of locked.leagueSchedule) {
        if (!teamIds.has(game.homeTeamId) || !teamIds.has(game.awayTeamId)) {
          ctx.addIssue({ code: 'custom', message: 'league schedule references an unknown team' });
        }
        const slotTeams = slots.get(game.slot) ?? new Set<string>();
        if (slotTeams.has(game.homeTeamId) || slotTeams.has(game.awayTeamId)) {
          ctx.addIssue({ code: 'custom', message: 'a team plays twice in one league slot' });
        }
        slotTeams.add(game.homeTeamId);
        slotTeams.add(game.awayTeamId);
        slots.set(game.slot, slotTeams);
        const home = gamesPerTeam.get(game.homeTeamId) ?? { home: 0, away: 0 };
        home.home += 1;
        gamesPerTeam.set(game.homeTeamId, home);
        const away = gamesPerTeam.get(game.awayTeamId) ?? { home: 0, away: 0 };
        away.away += 1;
        gamesPerTeam.set(game.awayTeamId, away);
        if (game.homeTeamId === locked.human.teamId || game.awayTeamId === locked.human.teamId) {
          userGames += 1;
          const humanHome = game.homeTeamId === locked.human.teamId;
          userBySlot.set(game.slot, game);
          const entry = locked.schedule[game.slot - 1];
          const opponentId = humanHome ? game.awayTeamId : game.homeTeamId;
          if (
            entry === undefined ||
            entry.opponentId !== opponentId ||
            entry.humanHome !== humanHome
          ) {
            ctx.addIssue({
              code: 'custom',
              message: 'the user schedule must match the league schedule',
            });
          }
        }
      }
      if (userGames !== CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) {
        ctx.addIssue({ code: 'custom', message: 'the user plays exactly 82 league games' });
      }
      if (locked.leagueSchedule.length - userGames !== CAP_RUSH_CONFERENCE_AI_GAMES) {
        ctx.addIssue({
          code: 'custom',
          message: `the league plays ${String(CAP_RUSH_CONFERENCE_AI_GAMES)} AI-only games`,
        });
      }
      for (let slot = 1; slot <= CAP_RUSH_CONFERENCE_GAMES_PER_TEAM; slot += 1) {
        const slotTeams = slots.get(slot);
        if (slotTeams === undefined || slotTeams.size !== CAP_RUSH_TAKEOVER_TEAMS) {
          ctx.addIssue({
            code: 'custom',
            message: `league slot ${String(slot)} must play every team`,
          });
        }
        if (!userBySlot.has(slot)) {
          ctx.addIssue({
            code: 'custom',
            message: `league slot ${String(slot)} misses the user game`,
          });
        }
      }
      for (const teamId of teamIds) {
        const record = gamesPerTeam.get(teamId);
        if (record === undefined || record.home !== 41 || record.away !== 41) {
          ctx.addIssue({
            code: 'custom',
            message: `${teamId} must play 41 home and 41 away games`,
          });
        }
      }
    }
  });
export type CapRushLockedInputs = z.infer<typeof capRushLockedInputsSchema>;
