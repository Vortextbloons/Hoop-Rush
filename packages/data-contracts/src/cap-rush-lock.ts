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
import { capRushSpinReceiptSchema } from './cap-rush-spin.ts';

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
  });
export type CapRushLockedInputs = z.infer<typeof capRushLockedInputsSchema>;
