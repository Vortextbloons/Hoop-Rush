import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_AWARDS_VERSION } from './season-versions.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';
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
  digest: seasonCheckpointDigestSchema,
});
export type SeasonAwards = z.infer<typeof seasonAwardsSchema>;
export function seasonAwardsFacts(awards: SeasonAwards): unknown {
  const facts: Record<string, unknown> = { ...awards };
  delete facts.digest;
  return facts;
}
export function seasonAwardsDigest(awards: SeasonAwards): string {
  return seasonDigestHex(canonicalJson(seasonAwardsFacts(awards)));
}
