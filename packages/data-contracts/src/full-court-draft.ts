import { z } from 'zod';
import { commandIdSchema, idSchema, seedSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import {
  CAP_RUSH_OFFER_SIZE,
  capRushBucketSchema,
  capRushCatalogSourceSchema,
} from './cap-rush-versions.ts';
import { capRushSourcePlayerSchema } from './cap-rush-draft.ts';
import {
  fullCourtFinalizeRouletteCommandSchema,
  fullCourtPurchaseSpinCommandSchema,
  fullCourtSkipSpinCommandSchema,
  fullCourtSpinReceiptSchema,
} from './full-court-roulette.ts';

export const FULL_COURT_DRAFT_SCHEMA_VERSION = 1;
export const FULL_COURT_MONEY_VERSION = 'full-court-money-v1';
export const FULL_COURT_POOL_VERSION = 'full-court-pool-v1';
export const FULL_COURT_POOL_MIN_SIZE = 60;
export const FULL_COURT_POOL_TARGET_SIZE = 75;
export const FULL_COURT_POOL_MAX_SIZE = 90;
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
export const FULL_COURT_CAP_LINE_DOLLARS = 200_000_000;
export const FULL_COURT_FIRST_APRON_DOLLARS = FULL_COURT_CAP_LINE_DOLLARS * 1.2;
export const FULL_COURT_HARD_LIMIT_DOLLARS = FULL_COURT_CAP_LINE_DOLLARS * 1.4;

export const FULL_COURT_DEFAULT_MONEY: FullCourtMoneyConfig = fullCourtMoneyConfigSchema.parse({
  moneyVersion: FULL_COURT_MONEY_VERSION,
  capLineDollars: FULL_COURT_CAP_LINE_DOLLARS,
  firstApronDollars: FULL_COURT_FIRST_APRON_DOLLARS,
  hardLimitDollars: FULL_COURT_HARD_LIMIT_DOLLARS,
  startingWarChestDollars: 250_000_000,
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

export const fullCourtReportKindSchema = z.enum([
  'player-scouting',
  'lineup-fit',
  'opponent-film',
  'training-camp',
]);
export type FullCourtReportKind = z.infer<typeof fullCourtReportKindSchema>;

/**
 * War Room prices in integer dollars. Scouting and preseason preparation buy
 * information only: they never enter payroll, so they cannot move the apron.
 * Tuning stays here so previews and command validation quote the same number.
 */
export const FULL_COURT_REPORT_PRICES_DOLLARS = {
  'player-scouting': 5_000_000,
  'lineup-fit': 5_000_000,
  'opponent-film': 3_000_000,
  'training-camp': 15_000_000,
} as const satisfies Record<FullCourtReportKind, number>;

export function fullCourtReportPriceDollars(kind: FullCourtReportKind): number {
  return FULL_COURT_REPORT_PRICES_DOLLARS[kind];
}

/** All Full Court run perks last for the entire run. */
export function fullCourtReportScope(_kind: FullCourtReportKind): 'run' | 'game' {
  return 'run';
}

export const FULL_COURT_MAX_REPORTS = 32;

const fullCourtGameReferenceSchema = z.string().min(1).max(64);

export const fullCourtReportTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('player-scouting'),
    /**
     * Legacy per-player scouting saves carry the version they paid for. New runs
     * buy one run-wide report, which omits it and unlocks playstyle draft-wide.
     */
    playerVersionId: playerVersionIdSchema.optional(),
  }),
  z.object({ kind: z.literal('lineup-fit') }),
  z.object({
    kind: z.literal('opponent-film'),
    gameId: fullCourtGameReferenceSchema.optional(),
    opponentTeamId: fullCourtGameReferenceSchema.optional(),
  }),
  z.object({ kind: z.literal('training-camp') }),
]);
export type FullCourtReportTarget = z.infer<typeof fullCourtReportTargetSchema>;

/** Stable ownership key: one purchase per target, regardless of retries. */
export function fullCourtReportTargetKey(target: FullCourtReportTarget): string {
  switch (target.kind) {
    case 'player-scouting':
      // One run-wide scouting report; legacy per-player records keep their own key.
      return target.playerVersionId === undefined
        ? 'player-scouting'
        : `player-scouting:${target.playerVersionId}`;
    case 'lineup-fit':
      return 'lineup-fit';
    case 'opponent-film':
      return target.opponentTeamId !== undefined && target.gameId !== undefined
        ? `opponent-film:${target.opponentTeamId}:${target.gameId}`
        : 'opponent-film';
    case 'training-camp':
      return 'training-camp';
  }
}

/**
 * One paid report and its matching War Chest charge. `reportId` is also the scouting
 * spending entry's id, so a report has exactly one receipt and a retry cannot charge twice.
 * The stored price is the receipt, not a lookup: retuning the defaults never invalidates
 * an existing draft.
 */
export const fullCourtReportRecordSchema = z
  .object({
    reportId: fullCourtSpendingIdSchema,
    kind: fullCourtReportKindSchema,
    target: fullCourtReportTargetSchema,
    priceDollars: z.number().int().positive(),
    commandId: commandIdSchema,
    purchasedRevision: z.number().int().nonnegative(),
  })
  .superRefine((report, ctx) => {
    if (report.target.kind !== report.kind) {
      ctx.addIssue({ code: 'custom', message: 'report target does not match its kind' });
    }
  });
export type FullCourtReportRecord = z.infer<typeof fullCourtReportRecordSchema>;

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

export const fullCourtRouletteStatusSchema = z.enum(['open', 'skipped', 'finalized']);
export type FullCourtRouletteStatus = z.infer<typeof fullCourtRouletteStatusSchema>;

export const fullCourtRouletteDraftStateSchema = z.object({
  status: fullCourtRouletteStatusSchema,
  receipts: z.array(fullCourtSpinReceiptSchema).max(FULL_COURT_MAX_ROSTER_SIZE),
});
export type FullCourtRouletteDraftState = z.infer<typeof fullCourtRouletteDraftStateSchema>;

export const fullCourtDraftPoolSchema = z
  .object({
    poolVersion: z.string().min(1).max(64),
    playerVersionIds: z
      .array(playerVersionIdSchema)
      .min(FULL_COURT_MIN_ROSTER_SIZE)
      .max(FULL_COURT_POOL_MAX_SIZE),
  })
  .superRefine((pool, ctx) => {
    const seen = new Set<string>();
    for (const id of pool.playerVersionIds) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          message: `draft pool repeats player version ${id}`,
        });
        break;
      }
      seen.add(id);
    }
  });
export type FullCourtDraftPool = z.infer<typeof fullCourtDraftPoolSchema>;

export const fullCourtOfferCardSchema = z.object({
  cardIndex: z
    .number()
    .int()
    .min(0)
    .max(CAP_RUSH_OFFER_SIZE - 1),
  bucket: capRushBucketSchema,
  player: capRushSourcePlayerSchema,
  salaryDollars: z.number().int().nonnegative(),
});
export type FullCourtOfferCard = z.infer<typeof fullCourtOfferCardSchema>;

export const fullCourtRoundOfferSchema = z.object({
  round: z
    .number()
    .int()
    .min(0)
    .max(FULL_COURT_MAX_ROSTER_SIZE - 1),
  cards: z.array(fullCourtOfferCardSchema).min(1).max(CAP_RUSH_OFFER_SIZE),
});
export type FullCourtRoundOffer = z.infer<typeof fullCourtRoundOfferSchema>;

export const fullCourtDraftStateSchema = z
  .object({
    schemaVersion: z.literal(FULL_COURT_DRAFT_SCHEMA_VERSION),
    runId: idSchema,
    revision: z.number().int().nonnegative(),
    runSeed: seedSchema,
    variant: fullCourtVariantSchema,
    catalog: capRushCatalogSourceSchema,
    money: fullCourtMoneyConfigSchema,
    pool: fullCourtDraftPoolSchema.optional(),
    offer: fullCourtRoundOfferSchema.optional(),
    stage: fullCourtDraftStageSchema,
    picks: z.array(fullCourtDraftPickSchema).max(FULL_COURT_MAX_ROSTER_SIZE),
    spending: z.array(fullCourtSpendingEntrySchema).max(64),
    reports: z.array(fullCourtReportRecordSchema).max(FULL_COURT_MAX_REPORTS).optional(),
    roulette: fullCourtRouletteDraftStateSchema.optional(),
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

    const seenReports = new Set<string>();
    const seenReportTargets = new Set<string>();
    const seenReportCommands = new Set<string>();
    for (const report of state.reports ?? []) {
      if (seenReports.has(report.reportId)) {
        ctx.addIssue({ code: 'custom', message: `report ${report.reportId} appears twice` });
      }
      seenReports.add(report.reportId);
      if (report.purchasedRevision > state.revision) {
        ctx.addIssue({ code: 'custom', message: 'a report cannot be purchased in the future' });
      }
      const targetKey = fullCourtReportTargetKey(report.target);
      if (seenReportTargets.has(targetKey)) {
        ctx.addIssue({ code: 'custom', message: `report target ${targetKey} is owned twice` });
      }
      seenReportTargets.add(targetKey);
      if (seenReportCommands.has(report.commandId)) {
        ctx.addIssue({ code: 'custom', message: 'one command cannot buy two reports' });
      }
      seenReportCommands.add(report.commandId);
      const charge = state.spending.find((entry) => entry.commandId === report.commandId);
      if (
        charge === undefined ||
        charge.kind !== 'scouting' ||
        charge.entryId !== report.reportId ||
        charge.dollars !== report.priceDollars
      ) {
        ctx.addIssue({
          code: 'custom',
          message: `report ${report.reportId} has no matching War Chest charge`,
        });
      }
    }

    const payroll = state.picks.reduce((total, pick) => total + pick.salaryDollars, 0);
    if (payroll > state.money.hardLimitDollars) {
      ctx.addIssue({
        code: 'custom',
        message: `payroll $${String(payroll)} exceeds the hard limit`,
      });
    }

    if (state.roulette !== undefined && state.variant !== 'roulette') {
      ctx.addIssue({ code: 'custom', message: 'Standard runs cannot hold Roulette receipts' });
    }
    if (state.roulette !== undefined && state.stage !== 'complete') {
      ctx.addIssue({
        code: 'custom',
        message: 'Roulette spins open after the roster is confirmed',
      });
    }
    const rouletteReceipts = state.roulette?.receipts ?? [];
    if (rouletteReceipts.length > 0 && state.variant !== 'roulette') {
      ctx.addIssue({ code: 'custom', message: 'Standard runs cannot buy spins' });
    }
    const spinCharges = state.spending.filter((entry) => entry.kind === 'spin');
    if (spinCharges.length !== rouletteReceipts.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'every Roulette receipt needs exactly one spin charge',
      });
    }
    let spinPayroll = payroll;
    const spinTargets = new Set<string>();
    const spinCommands = new Set<string>();
    for (const receipt of rouletteReceipts) {
      const pick = state.picks.find(
        (entry) => entry.player.playerVersionId === receipt.target.playerVersionId,
      );
      if (
        pick === undefined ||
        pick.player.playerId !== receipt.target.playerId ||
        !pick.player.positions.includes(receipt.target.slot)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'spin receipts must target a rostered player at a playable position',
        });
      }
      if (spinTargets.has(receipt.target.playerVersionId)) {
        ctx.addIssue({
          code: 'custom',
          message: `player version ${receipt.target.playerVersionId} has two mutations`,
        });
      }
      spinTargets.add(receipt.target.playerVersionId);
      if (spinCommands.has(receipt.commandId)) {
        ctx.addIssue({ code: 'custom', message: 'one spin command cannot buy two mutations' });
      }
      spinCommands.add(receipt.commandId);
      if (receipt.payrollDollars !== spinPayroll) {
        ctx.addIssue({
          code: 'custom',
          message: 'spin receipts must account for prior spin spending',
        });
      }
      if (receipt.payrollDollars + receipt.priceDollars > state.money.capLineDollars) {
        ctx.addIssue({ code: 'custom', message: 'a spin must fit under the normal cap line' });
      }
      spinPayroll += receipt.priceDollars;
      const charge = state.spending.find((entry) => entry.commandId === receipt.commandId);
      if (
        charge === undefined ||
        charge.kind !== 'spin' ||
        charge.dollars !== receipt.priceDollars ||
        charge.entryId !== `fcs-${receipt.receiptDigest}`
      ) {
        ctx.addIssue({
          code: 'custom',
          message: `spin ${receipt.receiptDigest} has no matching War Chest charge`,
        });
      }
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

export const fullCourtPurchaseReportCommandSchema = z.object({
  command: z.literal('purchase-full-court-report'),
  commandId: commandIdSchema,
  runId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  target: fullCourtReportTargetSchema,
});
export type FullCourtPurchaseReportCommand = z.infer<typeof fullCourtPurchaseReportCommandSchema>;

export const fullCourtCommandSchema = z.discriminatedUnion('command', [
  fullCourtCreateDraftCommandSchema,
  fullCourtPickPlayerCommandSchema,
  fullCourtRemovePlayerCommandSchema,
  fullCourtFinishDraftCommandSchema,
  fullCourtPurchaseReportCommandSchema,
  fullCourtPurchaseSpinCommandSchema,
  fullCourtSkipSpinCommandSchema,
  fullCourtFinalizeRouletteCommandSchema,
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
  'report-owned',
  'report-unavailable',
  'spin-unavailable',
  'spin-ineligible',
  'spin-owned',
  'spin-draw-unavailable',
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
