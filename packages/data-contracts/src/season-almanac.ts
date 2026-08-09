import { z } from 'zod';
import { franchiseIdSchema, seedSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { SEASON_ALMANAC_VERSION } from './season-versions.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';

/**
 * Completed-season almanac (M2.6, almanac-v1): the champion-history record
 * created atomically at promotion (final result, almanac, champion,
 * finalized command log, completed-history registration, active-run
 * removal). The almanac identifies the run, its champion, and the canonical
 * digests of the final postseason state, the finalized command log, and the
 * derived awards, plus its own self-excluded digest.
 */

export const seasonAlmanacSchema = z.object({
  schemaVersion: z.literal(1),
  almanacVersion: z.literal(SEASON_ALMANAC_VERSION),
  runId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  championFranchiseId: franchiseIdSchema,
  /** Canonical digest of the final postseason state at promotion. */
  postseasonDigest: seasonCheckpointDigestSchema,
  /** Canonical digest of the finalized command log. */
  commandLogDigest: seasonCheckpointDigestSchema,
  /** Canonical digest of the derived awards. */
  awardsDigest: seasonCheckpointDigestSchema,
  /** Canonical 32-hex digest of the almanac facts (self-excluded). */
  digest: seasonCheckpointDigestSchema,
});
export type SeasonAlmanac = z.infer<typeof seasonAlmanacSchema>;

/** The digest material of an almanac (every fact except `digest`). */
export function seasonAlmanacFacts(almanac: SeasonAlmanac): unknown {
  const facts: Record<string, unknown> = { ...almanac };
  delete facts.digest;
  return facts;
}

/** Canonical 32-hex digest of the almanac facts. */
export function seasonAlmanacDigest(almanac: SeasonAlmanac): string {
  return seasonDigestHex(canonicalJson(seasonAlmanacFacts(almanac)));
}
