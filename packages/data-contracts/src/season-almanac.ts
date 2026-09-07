import { z } from 'zod';
import { franchiseIdSchema, seedSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { SEASON_ALMANAC_VERSION } from './season-versions.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';
export const seasonAlmanacSchema = z.object({
  schemaVersion: z.literal(1),
  almanacVersion: z.literal(SEASON_ALMANAC_VERSION),
  runId: z.string().min(1).max(64),
  rootSeed: seedSchema,
  championFranchiseId: franchiseIdSchema,
  postseasonDigest: seasonCheckpointDigestSchema,
  commandLogDigest: seasonCheckpointDigestSchema,
  awardsDigest: seasonCheckpointDigestSchema,
  tradeGradesDigest: seasonCheckpointDigestSchema,
  digest: seasonCheckpointDigestSchema,
});
export type SeasonAlmanac = z.infer<typeof seasonAlmanacSchema>;
export function seasonAlmanacFacts(almanac: SeasonAlmanac): unknown {
  const facts: Record<string, unknown> = { ...almanac };
  delete facts.digest;
  return facts;
}
export function seasonAlmanacDigest(almanac: SeasonAlmanac): string {
  return seasonDigestHex(canonicalJson(seasonAlmanacFacts(almanac)));
}
