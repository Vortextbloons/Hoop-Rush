import { z } from 'zod';
import { commandIdSchema, idSchema, seedSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { capRushCatalogSourceSchema } from './cap-rush-versions.ts';
import { capRushSourcePlayerSchema } from './cap-rush-draft.ts';

export const FULL_COURT_DRAFT_SCHEMA_VERSION = 1;
export const FULL_COURT_MONEY_VERSION = 'full-court-money-v1';
export const FULL_COURT_MIN_ROSTER_SIZE = 6;
export const FULL_COURT_MAX_ROSTER_SIZE = 12;
export const FULL_COURT_MATCH_MINIMUM_PLAYERS = 5;

export const fullCourtVariantSchema = z.enum(['standard', 'roulette']);
export type FullCourtVariant = z.infer<typeof fullCourtVariantSchema>;

export const fullCourtDigestSchema = z.string().regex(/^[0-9a-f]{32}$/);
export const fullCourtSpendingIdSchema = z.string().regex(/^fcs-[0-9a-f]{32}$/);

/**
 * Payroll and War Chest rules pinned into a draft.
 *
 * `moneyVersion` labels the tuning that produced the numbers but is not a literal, so
 * retuning the defaults never invalidates a stored draft: the saved amounts themselves
 * stay authoritative.
 */
export const fullCourtMoneyConfigSchema = z
  .object({
    moneyVersion: z.string().min(1).max(64),
    capLineDollars: z.number().int().nonnegative(),
    firstApronDollars: z.number().int().nonnegative(),
    hardLimitDollars: z.number().int().nonnegative(),
    startingWarChestDollars: z.number().int().positive(),
  })
  .superRefine((money, ctx) => {
    if (money.capLineDollars > money.firstApronDollars) {
      ctx.addIssue({ code: 'custom', message: 'the first apron cannot sit below the cap line' });
    }
    if (money.firstApronDollars > money.hardLimitDollars) {
      ctx.addIssue({ code: 'custom', message: 'the hard limit cannot sit below the first apron' });
    }
  });
export type FullCourtMoneyConfig = z.infer<typeof fullCourtMoneyConfigSchema>;

// Provisional Phase 1 tuning, measured against the packaged catalog's cheapest version of
// each real player: a twelve-player budget build (~$65M) and twelve-player depth build
// (~$172M) and an eight-player competitive build (~$232M) all stay under the cap line,
// while a six-player star-heavy build (~$428M) lands in the second apron and consumes
// almost the whole War Chest, which is the intended choice between apron cost, depth, and
// purchase room.
export const FULL_COURT_DEFAULT_MONEY: FullCourtMoneyConfig = fullCourtMoneyConfigSchema.parse({
  moneyVersion: FULL_COURT_MONEY_VERSION,
  capLineDollars: 250_000_000,
  firstApronDollars: 300_000_000,
  hardLimitDollars: 440_000_000,
  startingWarChestDollars: 450_000_000,
});

/**
 * Fixed display conversion for War Chest amounts quoted in CR. Ledger arithmetic stays
 * in integer dollars; every CR figure divides by this one unit.
 */
export const FULL_COURT_CR_DOLLARS = 1_000_000;

export function fullCourtCrAmount(dollars: number): number {
  if (!Number.isInteger(dollars) || dollars < 0) {
    throw new Error(
      `full court CR amounts require a nonnegative integer dollar amount (got ${String(dollars)})`,
    );
  }
  return dollars / FULL_COURT_CR_DOLLARS;
}

export const fullCourtSpendingKindSchema = z.enum(['salary', 'scouting', 'spin']);
export type FullCourtSpendingKind = z.infer<typeof fullCourtSpendingKindSchema>;

export const fullCourtSpendingEntrySchema = z
  .object({
    entryId: fullCourtSpendingIdSchema,
    kind: fullCourtSpendingKindSchema,
    dollars: z.number().int().positive(),
    commandId: commandIdSchema,
    playerVersionId: playerVersionIdSchema.optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.kind === 'salary' && entry.playerVersionId === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'a salary entry requires the player version it pays',
      });
    }
    if (entry.kind !== 'salary' && entry.playerVersionId !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'only salary entries name a player version' });
    }
  });
export type FullCourtSpendingEntry = z.infer<typeof fullCourtSpendingEntrySchema>;

export const fullCourtDraftPickSchema = z.object({
  pickOrdinal: z
    .number()
    .int()
    .min(0)
    .max(FULL_COURT_MAX_ROSTER_SIZE - 1),
  player: capRushSourcePlayerSchema,
  salaryDollars: z.number().int().nonnegative(),
});
export type FullCourtDraftPick = z.infer<typeof fullCourtDraftPickSchema>;

export const fullCourtDraftStageSchema = z.enum(['drafting', 'complete']);
export type FullCourtDraftStage = z.infer<typeof fullCourtDraftStageSchema>;

export const fullCourtDraftStateSchema = z
  .object({
    schemaVersion: z.literal(FULL_COURT_DRAFT_SCHEMA_VERSION),
    runId: idSchema,
    revision: z.number().int().nonnegative(),
    runSeed: seedSchema,
    variant: fullCourtVariantSchema,
    catalog: capRushCatalogSourceSchema,
    money: fullCourtMoneyConfigSchema,
    stage: fullCourtDraftStageSchema,
    picks: z.array(fullCourtDraftPickSchema).max(FULL_COURT_MAX_ROSTER_SIZE),
    spending: z.array(fullCourtSpendingEntrySchema).max(64),
  })
  .superRefine((state, ctx) => {
    const seenPeople = new Set<string>();
    const seenVersions = new Set<string>();
    state.picks.forEach((pick, index) => {
      if (pick.pickOrdinal !== index) {
        ctx.addIssue({ code: 'custom', message: 'pick ordinals must be sequential' });
      }
      if (seenPeople.has(pick.player.playerId)) {
        ctx.addIssue({
          code: 'custom',
          message: `player ${pick.player.playerId} is on the roster twice`,
        });
      }
      seenPeople.add(pick.player.playerId);
      if (seenVersions.has(pick.player.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `player version ${pick.player.playerVersionId} is signed twice`,
        });
      }
      seenVersions.add(pick.player.playerVersionId);
    });

    const seenEntries = new Set<string>();
    const seenCommands = new Set<string>();
    const salaryByVersion = new Map<string, number>();
    for (const entry of state.spending) {
      if (seenEntries.has(entry.entryId)) {
        ctx.addIssue({ code: 'custom', message: `spending entry ${entry.entryId} appears twice` });
      }
      seenEntries.add(entry.entryId);
      if (seenCommands.has(entry.commandId)) {
        ctx.addIssue({
          code: 'custom',
          message: `command ${entry.commandId} charged more than once`,
        });
      }
      seenCommands.add(entry.commandId);
      if (entry.playerVersionId === undefined) continue;
      if (salaryByVersion.has(entry.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `player version ${entry.playerVersionId} is paid twice`,
        });
      }
      salaryByVersion.set(entry.playerVersionId, entry.dollars);
    }

    for (const pick of state.picks) {
      const paid = salaryByVersion.get(pick.player.playerVersionId);
      if (paid === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `pick ${String(pick.pickOrdinal)} has no salary entry`,
        });
      } else if (paid !== pick.salaryDollars) {
        ctx.addIssue({
          code: 'custom',
          message: `pick ${String(pick.pickOrdinal)} salary does not match its spending entry`,
        });
      }
    }
    if (salaryByVersion.size !== state.picks.length) {
      ctx.addIssue({ code: 'custom', message: 'salary entries and roster picks must correspond' });
    }

    const payroll = state.picks.reduce((total, pick) => total + pick.salaryDollars, 0);
    if (payroll > state.money.hardLimitDollars) {
      ctx.addIssue({
        code: 'custom',
        message: `payroll $${String(payroll)} exceeds the hard limit`,
      });
    }
    const spent = state.spending.reduce((total, entry) => total + entry.dollars, 0);
    if (spent > state.money.startingWarChestDollars) {
      ctx.addIssue({
        code: 'custom',
        message: `spending $${String(spent)} exceeds the War Chest`,
      });
    }

    if (state.stage === 'complete' && state.picks.length < FULL_COURT_MIN_ROSTER_SIZE) {
      ctx.addIssue({
        code: 'custom',
        message: 'a confirmed roster requires at least six players',
      });
    }
  });
export type FullCourtDraftState = z.infer<typeof fullCourtDraftStateSchema>;

export const fullCourtCreateDraftCommandSchema = z.object({
  command: z.literal('create-full-court-draft'),
  commandId: commandIdSchema,
  runId: idSchema,
  runSeed: seedSchema,
  variant: fullCourtVariantSchema,
  catalog: capRushCatalogSourceSchema,
  money: fullCourtMoneyConfigSchema.optional(),
});
export type FullCourtCreateDraftCommand = z.infer<typeof fullCourtCreateDraftCommandSchema>;

export const fullCourtPickPlayerCommandSchema = z.object({
  command: z.literal('pick-full-court-player'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  playerVersionId: playerVersionIdSchema,
});
export type FullCourtPickPlayerCommand = z.infer<typeof fullCourtPickPlayerCommandSchema>;

export const fullCourtRemovePlayerCommandSchema = z.object({
  command: z.literal('remove-full-court-player'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  playerVersionId: playerVersionIdSchema,
});
export type FullCourtRemovePlayerCommand = z.infer<typeof fullCourtRemovePlayerCommandSchema>;

export const fullCourtFinishDraftCommandSchema = z.object({
  command: z.literal('finish-full-court-draft'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
});
export type FullCourtFinishDraftCommand = z.infer<typeof fullCourtFinishDraftCommandSchema>;

export const fullCourtCommandSchema = z.discriminatedUnion('command', [
  fullCourtCreateDraftCommandSchema,
  fullCourtPickPlayerCommandSchema,
  fullCourtRemovePlayerCommandSchema,
  fullCourtFinishDraftCommandSchema,
]);
export type FullCourtCommand = z.infer<typeof fullCourtCommandSchema>;

export const fullCourtCommandRejectionCodeSchema = z.enum([
  'run-mismatch',
  'stale-revision',
  'command-conflict',
  'phase-mismatch',
  'catalog-mismatch',
  'player-unavailable',
  'duplicate-player',
  'roster-full',
  'budget-rejected',
  'player-not-rostered',
  'roster-too-small',
]);
export type FullCourtCommandRejectionCode = z.infer<typeof fullCourtCommandRejectionCodeSchema>;

export const fullCourtCommandResultSchema = z.object({
  schemaVersion: z.literal(FULL_COURT_DRAFT_SCHEMA_VERSION),
  commandId: commandIdSchema,
  runId: idSchema,
  status: z.enum(['accepted', 'rejected']),
  revisionBefore: z.number().int().nonnegative(),
  revisionAfter: z.number().int().nonnegative(),
  stateDigest: fullCourtDigestSchema,
  rejection: z
    .object({
      code: fullCourtCommandRejectionCodeSchema,
      message: z.string().min(1).max(320),
    })
    .nullable(),
});
export type FullCourtCommandResult = z.infer<typeof fullCourtCommandResultSchema>;
