import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_AWARDS_VERSION } from './season-versions.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';

/**
 * Season awards (M2.6, awards-v1): MVP, Defensive Player of the Year, Sixth
 * Man of the Year, and All-League First Team, all derived from recorded
 * regular-season facts AFTER postseason qualification (regular-season
 * statistics are immutable from that point). The digest is a deterministic
 * function of the award facts; derivation rules land with the awards engine
 * work in a later phase.
 */

/** One award recipient: a rostered player-version on their franchise. */
export const seasonAwardRecipientSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  franchiseId: franchiseIdSchema,
});
export type SeasonAwardRecipient = z.infer<typeof seasonAwardRecipientSchema>;

export const seasonAwardsSchema = z.object({
  schemaVersion: z.literal(1),
  awardsVersion: z.literal(SEASON_AWARDS_VERSION),
  runId: z.string().min(1).max(64),
  mvp: seasonAwardRecipientSchema,
  defensivePlayerOfYear: seasonAwardRecipientSchema,
  sixthManOfYear: seasonAwardRecipientSchema,
  allLeagueFirstTeam: z.array(seasonAwardRecipientSchema).length(5),
  /** Canonical 32-hex digest of the award facts (self-excluded). */
  digest: seasonCheckpointDigestSchema,
});
export type SeasonAwards = z.infer<typeof seasonAwardsSchema>;

/** The digest material of an awards record (every fact except `digest`). */
export function seasonAwardsFacts(awards: SeasonAwards): unknown {
  const facts: Record<string, unknown> = { ...awards };
  delete facts.digest;
  return facts;
}

/** Canonical 32-hex digest of the awards facts. */
export function seasonAwardsDigest(awards: SeasonAwards): string {
  return seasonDigestHex(canonicalJson(seasonAwardsFacts(awards)));
}
