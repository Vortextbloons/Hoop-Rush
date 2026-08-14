import { z } from 'zod';
import { idSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { seasonRunCommandSchema } from './season-commands.ts';
import { SEASON_COMMAND_LOG_VERSION } from './season-versions.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';

/**
 * Accepted-command log (M2.6, command-log-v1): the run-scoped, append-only
 * authoritative record of every ACCEPTED run command. Rejected commands are
 * transient and never enter the log. Each entry carries the full validated
 * command payload, the run state chain position before and after (pre/post
 * revision and digest), a canonical digest of the accepted result facts,
 * the digest of every earlier entry (a hash chain head), and the related
 * game and transaction ids the command produced.
 *
 * The log digest is a pure function of the entries (canonical JSON over the
 * canonical entry order), so repeated seeded runs reproduce identical
 * hashes; timestamps are never part of the digest.
 */

/** One accepted command record. */
export const seasonCommandLogEntrySchema = z
  .object({
    runId: z.string().min(1).max(64),
    /** Append ordinal; 0 for the first accepted command of the run. */
    ordinal: z.number().int().nonnegative(),
    /** The full validated command payload. */
    command: seasonRunCommandSchema,
    /** Run state chain position the command asserted. */
    preStateRevision: z.number().int().nonnegative(),
    preStateDigest: seasonCheckpointDigestSchema,
    /** Run state chain position after the command applied. */
    postStateRevision: z.number().int().nonnegative(),
    postStateDigest: seasonCheckpointDigestSchema,
    /** Canonical 32-hex digest of the accepted result facts (self-excluded). */
    resultDigest: seasonCheckpointDigestSchema,
    /** Digest of every earlier entry; the fixed chain head for ordinal 0. */
    previousLogDigest: seasonCheckpointDigestSchema,
    /** Game ids (regular-season or postseason) the command advanced, canonically ordered. */
    relatedGameIds: z.array(z.string().min(1).max(64)),
    /** Transaction ids the command produced, canonically ordered. */
    transactionIds: z.array(idSchema),
  })
  .superRefine((entry, ctx) => {
    if (entry.command.runId !== entry.runId) {
      ctx.addIssue({
        code: 'custom',
        message: 'the command payload must target the log run',
      });
    }
    if (entry.preStateRevision > entry.postStateRevision) {
      ctx.addIssue({
        code: 'custom',
        message: 'postStateRevision must not regress below preStateRevision',
      });
    }
  });
export type SeasonCommandLogEntry = z.infer<typeof seasonCommandLogEntrySchema>;

/** The versioned command-log artifact. */
export const seasonCommandLogSchema = z.object({
  schemaVersion: z.literal(1),
  commandLogVersion: z.literal(SEASON_COMMAND_LOG_VERSION),
  runId: z.string().min(1).max(64),
  entries: z.array(seasonCommandLogEntrySchema),
});
export type SeasonCommandLog = z.infer<typeof seasonCommandLogSchema>;

/** The fixed chain head digest of an empty command log. */
export const SEASON_EMPTY_COMMAND_LOG_DIGEST = seasonDigestHex(canonicalJson([]));

/** Canonical 32-hex digest of the full log (entries in append order). */
export function seasonCommandLogDigest(entries: readonly SeasonCommandLogEntry[]): string {
  return seasonDigestHex(canonicalJson(entries));
}

/**
 * The canonical digest of one accepted command's result facts (M2.6): the
 * command id, the advanced game ids (canonically sorted), and the result
 * digests of the summaries the command produced (canonically sorted). This
 * is the ONE construction shared by the persistence commit path, the web
 * history export, and the CLI reproduce command, so the log's stored
 * `resultDigest` and a replayed reproduction always agree. Commands that
 * produce no summaries pass the empty summary-digest array.
 */
export function seasonCommandResultDigest(facts: {
  commandId: string;
  gameIds: readonly string[];
  summaryDigests: readonly string[];
}): string {
  return seasonDigestHex(
    canonicalJson({
      commandId: facts.commandId,
      gameIds: [...facts.gameIds].sort(),
      summaryDigests: [...facts.summaryDigests].sort(),
    }),
  );
}
