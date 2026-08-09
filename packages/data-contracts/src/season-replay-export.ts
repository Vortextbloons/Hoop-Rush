import { z } from 'zod';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { postseasonGameIdSchema } from './season-postseason.ts';
import { seasonPostseasonSummarySchema } from './season-postseason-summary.ts';
import { SEASON_REPLAY_EXPORT_VERSION } from './season-versions.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';

/**
 * Replay exports (M2.6, replay-export-v1): self-contained exports of one
 * postseason game (its compact summary) so a later replay phase can
 * reproduce or present the game from recorded facts. The digest is a
 * deterministic function of the export facts; timestamps are never part of
 * it.
 */

export const seasonReplayExportSchema = z.object({
  schemaVersion: z.literal(1),
  replayExportVersion: z.literal(SEASON_REPLAY_EXPORT_VERSION),
  runId: z.string().min(1).max(64),
  gameId: postseasonGameIdSchema,
  summary: seasonPostseasonSummarySchema,
  /** Canonical 32-hex digest of the export facts (self-excluded). */
  digest: seasonCheckpointDigestSchema,
});
export type SeasonReplayExport = z.infer<typeof seasonReplayExportSchema>;

/** The digest material of a replay export (every fact except `digest`). */
export function seasonReplayExportFacts(exportArtifact: SeasonReplayExport): unknown {
  const facts: Record<string, unknown> = { ...exportArtifact };
  delete facts.digest;
  return facts;
}

/** Canonical 32-hex digest of the replay-export facts. */
export function seasonReplayExportDigest(exportArtifact: SeasonReplayExport): string {
  return seasonDigestHex(canonicalJson(seasonReplayExportFacts(exportArtifact)));
}
