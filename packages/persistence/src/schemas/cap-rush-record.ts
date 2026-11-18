import { z } from 'zod';
import {
  CAP_RUSH_GAME_COUNT,
  CAP_RUSH_LEGACY_SAVE_SCHEMA_VERSION,
  CAP_RUSH_SAVE_SCHEMA_VERSION,
  capRushCommandResultSchema,
  capRushCommandSchema,
  capRushDraftStateSchema,
  capRushDigestSchema,
  capRushHistoryEntrySchema,
  capRushLeagueAggregateSchema,
  capRushLeagueGameIdSchema,
  capRushLeagueGameSchema,
  capRushLeagueResultSchema,
  capRushLockedInputsSchema,
  capRushPlaybackSchema,
  capRushReportSchema,
  capRushStoredGameSchema,
  capRushStoredPlayoffGameSchema,
  capRushPlayoffGameIdSchema,
  commandIdSchema,
  idSchema,
} from '@hoop-rush/data-contracts';

export const CAP_RUSH_ACTIVE_DRAFT_RECORD_ID = 'cap-rush-draft';
const isoDateSchema = z.iso.datetime();

/**
 * Save schema 3 remains readable for existing saves; every new record is
 * written with the current version. Keeping the union explicit (instead of
 * rewriting old rows on open) preserves "never rewrite a record on read".
 */
const capRushReadableSaveSchemaVersionSchema = z.union([
  z.literal(CAP_RUSH_LEGACY_SAVE_SCHEMA_VERSION),
  z.literal(CAP_RUSH_SAVE_SCHEMA_VERSION),
]);

export function capRushPlaybackGameKey(game: number | string): string {
  return typeof game === 'number' ? `regular:${String(game)}` : `playoff:${game}`;
}

export const storedCapRushPlaybackEvidenceRowSchema = z
  .object({
    saveSchemaVersion: capRushReadableSaveSchemaVersionSchema,
    runId: idSchema,
    gameKey: z.string().min(1),
    playback: capRushPlaybackSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.playback.cursor !== 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'stored playback evidence must start at cursor zero',
      });
    }
  });
export type StoredCapRushPlaybackEvidenceRow = z.infer<
  typeof storedCapRushPlaybackEvidenceRowSchema
>;

export const storedCapRushPlaybackCursorRowSchema = z
  .object({
    saveSchemaVersion: capRushReadableSaveSchemaVersionSchema,
    runId: idSchema,
    gameKey: z.string().min(1),
    cursor: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.cursor > row.total) {
      ctx.addIssue({ code: 'custom', message: 'stored playback cursor exceeds the recorded tape' });
    }
  });
export type StoredCapRushPlaybackCursorRow = z.infer<typeof storedCapRushPlaybackCursorRowSchema>;

/**
 * Version-3 active draft row: the full draft, including the ~1 MB immutable
 * `locked` subtree, lives inline. Kept for reading saves written before the
 * split; new writes use {@link storedCapRushDraftProgressRowSchema}.
 */
export const storedCapRushLegacyDraftRowSchema = z
  .object({
    saveSchemaVersion: z.literal(CAP_RUSH_LEGACY_SAVE_SCHEMA_VERSION),
    recordId: z.literal(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID),
    runId: idSchema,
    revision: z.number().int().nonnegative(),
    stateDigest: capRushDigestSchema,
    draft: capRushDraftStateSchema,
    createdAtIso: isoDateSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.draft.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored draft run id does not match its row' });
    }
    if (row.draft.revision !== row.revision) {
      ctx.addIssue({ code: 'custom', message: 'stored draft revision does not match its row' });
    }
  });
export type StoredCapRushLegacyDraftRow = z.infer<typeof storedCapRushLegacyDraftRowSchema>;

/**
 * Reference from the active progress row to the immutable locked inputs held in
 * `capRushLockedInputs`. The digest covers the locked inputs themselves, so a
 * mutated lock cannot silently pass as the one the run locked.
 */
export const capRushStoredLockedInputsRefSchema = z.object({
  runId: idSchema,
  digest: capRushDigestSchema,
});
export type CapRushStoredLockedInputsRef = z.infer<typeof capRushStoredLockedInputsRefSchema>;

/**
 * Version-4 active draft progress: the same domain draft with `locked` reduced
 * to a reference. The row-level `stateDigest` still covers the full hydrated
 * draft, so revision and digest validation are unchanged.
 *
 * This is a storage projection, not a second domain schema: field-level domain
 * validation is inherited from the draft shape, and the hydrated draft is
 * parsed with `capRushDraftStateSchema` on load.
 */
export const storedCapRushDraftProgressStateSchema = z.object({
  ...capRushDraftStateSchema.shape,
  locked: capRushStoredLockedInputsRefSchema.nullable(),
});
export type StoredCapRushDraftProgressState = z.infer<typeof storedCapRushDraftProgressStateSchema>;

export const storedCapRushDraftProgressRowSchema = z
  .object({
    saveSchemaVersion: z.literal(CAP_RUSH_SAVE_SCHEMA_VERSION),
    recordId: z.literal(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID),
    runId: idSchema,
    revision: z.number().int().nonnegative(),
    stateDigest: capRushDigestSchema,
    draft: storedCapRushDraftProgressStateSchema,
    createdAtIso: isoDateSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.draft.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored draft run id does not match its row' });
    }
    if (row.draft.revision !== row.revision) {
      ctx.addIssue({ code: 'custom', message: 'stored draft revision does not match its row' });
    }
    if (row.draft.locked !== null && row.draft.locked.runId !== row.runId) {
      ctx.addIssue({
        code: 'custom',
        message: 'stored locked inputs reference belongs to another run',
      });
    }
  });
export type StoredCapRushDraftProgressRow = z.infer<typeof storedCapRushDraftProgressRowSchema>;

/**
 * Envelope-only view of the version-4 active row for the per-command overwrite
 * guard. The season progress is validated on load and on write; the guard only
 * needs the revision and the locked-input reference, so it never walks a full
 * draft on every commit.
 */
export const storedCapRushDraftProgressEnvelopeRowSchema = z
  .object({
    saveSchemaVersion: z.literal(CAP_RUSH_SAVE_SCHEMA_VERSION),
    recordId: z.literal(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID),
    runId: idSchema,
    revision: z.number().int().nonnegative(),
    stateDigest: capRushDigestSchema,
    draft: z.object({
      runId: idSchema,
      revision: z.number().int().nonnegative(),
      locked: capRushStoredLockedInputsRefSchema.nullable(),
    }),
    createdAtIso: isoDateSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.draft.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored draft run id does not match its row' });
    }
    if (row.draft.revision !== row.revision) {
      ctx.addIssue({ code: 'custom', message: 'stored draft revision does not match its row' });
    }
    if (row.draft.locked !== null && row.draft.locked.runId !== row.runId) {
      ctx.addIssue({
        code: 'custom',
        message: 'stored locked inputs reference belongs to another run',
      });
    }
  });
export type StoredCapRushDraftProgressEnvelopeRow = z.infer<
  typeof storedCapRushDraftProgressEnvelopeRowSchema
>;

export const storedCapRushLockedInputsRowSchema = z
  .object({
    saveSchemaVersion: z.literal(CAP_RUSH_SAVE_SCHEMA_VERSION),
    runId: idSchema,
    digest: capRushDigestSchema,
    locked: capRushLockedInputsSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.locked.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored locked inputs belong to another run' });
    }
  });
export type StoredCapRushLockedInputsRow = z.infer<typeof storedCapRushLockedInputsRowSchema>;

export const storedCapRushCommandRowSchema = z
  .object({
    saveSchemaVersion: capRushReadableSaveSchemaVersionSchema,
    commandId: commandIdSchema,
    runId: idSchema,
    command: capRushCommandSchema,
    result: capRushCommandResultSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.command.commandId !== row.commandId) {
      ctx.addIssue({ code: 'custom', message: 'stored command does not match its command id' });
    }
    if (row.command.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored command does not match its run id' });
    }
    if (row.result.commandId !== row.commandId || row.result.runId !== row.runId) {
      ctx.addIssue({
        code: 'custom',
        message: 'stored result does not match its command envelope',
      });
    }
  });
export type StoredCapRushCommandRow = z.infer<typeof storedCapRushCommandRowSchema>;

export const storedCapRushGameRowSchema = z
  .object({
    saveSchemaVersion: capRushReadableSaveSchemaVersionSchema,
    runId: idSchema,
    gameNumber: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT),
    game: capRushStoredGameSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    const { game, gameNumber } = row;
    if (game.gameNumber !== gameNumber || game.summary.gameNumber !== gameNumber) {
      ctx.addIssue({ code: 'custom', message: 'stored game number does not match its row' });
    }
    if (game.result.gameNumber !== gameNumber) {
      ctx.addIssue({ code: 'custom', message: 'stored game result number does not match its row' });
    }
    if (game.result.inputDigest !== game.summary.inputDigest) {
      ctx.addIssue({
        code: 'custom',
        message: 'stored game result digest does not match its summary',
      });
    }
    const humanHome = game.summary.humanHome;
    if ((game.result.humanSide === 'home') !== humanHome) {
      ctx.addIssue({
        code: 'custom',
        message: 'stored game human side does not match its summary',
      });
    }
    const humanPoints = humanHome ? game.result.home.points : game.result.away.points;
    const opponentPoints = humanHome ? game.result.away.points : game.result.home.points;
    if (
      humanPoints !== game.summary.humanPoints ||
      opponentPoints !== game.summary.opponentPoints
    ) {
      ctx.addIssue({ code: 'custom', message: 'stored game scoreline does not match its summary' });
    }
  });
export type StoredCapRushGameRow = z.infer<typeof storedCapRushGameRowSchema>;

export const storedCapRushPlayoffGameRowSchema = z
  .object({
    saveSchemaVersion: capRushReadableSaveSchemaVersionSchema,
    runId: idSchema,
    gameId: capRushPlayoffGameIdSchema,
    game: capRushStoredPlayoffGameSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.game.gameId !== row.gameId || row.game.summary.gameId !== row.gameId) {
      ctx.addIssue({ code: 'custom', message: 'stored playoff game id does not match its row' });
    }
    if (
      row.game.result !== null &&
      (row.game.result.inputDigest !== row.game.summary.inputDigest ||
        row.game.result.humanSide !== row.game.summary.userSide)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'stored playoff result does not match its summary',
      });
    }
  });
export type StoredCapRushPlayoffGameRow = z.infer<typeof storedCapRushPlayoffGameRowSchema>;

export const storedCapRushLeagueGameRowSchema = z
  .object({
    saveSchemaVersion: capRushReadableSaveSchemaVersionSchema,
    runId: idSchema,
    gameId: capRushLeagueGameIdSchema,
    game: capRushLeagueGameSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.game.gameId !== row.gameId) {
      ctx.addIssue({ code: 'custom', message: 'stored league game id does not match its row' });
    }
  });
export type StoredCapRushLeagueGameRow = z.infer<typeof storedCapRushLeagueGameRowSchema>;

/**
 * Projection of a stored league-game row for schedule/standings reads. The box
 * score is stripped by the schema and never parsed, so listing a full season
 * does not validate every box on the main thread.
 */
export const storedCapRushLeagueGameResultRowSchema = z
  .object({
    saveSchemaVersion: capRushReadableSaveSchemaVersionSchema,
    runId: idSchema,
    gameId: capRushLeagueGameIdSchema,
    game: capRushLeagueResultSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.game.gameId !== row.gameId) {
      ctx.addIssue({ code: 'custom', message: 'stored league game id does not match its row' });
    }
  });
export type StoredCapRushLeagueGameResultRow = z.infer<
  typeof storedCapRushLeagueGameResultRowSchema
>;

/**
 * Compact league score row. `listLeagueResults` reads these (a few hundred
 * bytes each) instead of deserializing 1,148 full box scores. Full boxes stay
 * in `capRushLeagueGames` for on-demand reads.
 */
export const storedCapRushLeagueScoreRowSchema = z
  .object({
    saveSchemaVersion: z.literal(CAP_RUSH_SAVE_SCHEMA_VERSION),
    runId: idSchema,
    gameId: capRushLeagueGameIdSchema,
    result: capRushLeagueResultSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.result.gameId !== row.gameId) {
      ctx.addIssue({ code: 'custom', message: 'stored league score id does not match its row' });
    }
  });
export type StoredCapRushLeagueScoreRow = z.infer<typeof storedCapRushLeagueScoreRowSchema>;

export const storedCapRushHistoryRowSchema = capRushHistoryEntrySchema
  .safeExtend({ saveSchemaVersion: capRushReadableSaveSchemaVersionSchema })
  .superRefine((row, ctx) => {
    if (row.wins + row.losses > CAP_RUSH_GAME_COUNT) {
      ctx.addIssue({ code: 'custom', message: 'stored history wins and losses exceed a season' });
    }
  });
export type StoredCapRushHistoryRow = z.infer<typeof storedCapRushHistoryRowSchema>;

export const storedCapRushReportRowSchema = z
  .object({
    saveSchemaVersion: capRushReadableSaveSchemaVersionSchema,
    runId: idSchema,
    report: capRushReportSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.report.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored report belongs to another run' });
    }
  });
export type StoredCapRushReportRow = z.infer<typeof storedCapRushReportRowSchema>;

export const storedCapRushLeagueAggregateRowSchema = z
  .object({
    saveSchemaVersion: capRushReadableSaveSchemaVersionSchema,
    runId: idSchema,
    aggregate: capRushLeagueAggregateSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.aggregate.games !== row.aggregate.gameIds.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'league aggregate game count disagrees with its ids',
      });
    }
  });
export type StoredCapRushLeagueAggregateRow = z.infer<typeof storedCapRushLeagueAggregateRowSchema>;
