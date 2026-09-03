import type {
  ContentHash,
  FixedFiveCommand,
  FixedFiveCompetitionResult,
  FixedFiveLineupEntry,
  FixedFiveVersionLocks,
  Seed,
} from '@hoop-rush/data-contracts';
import { canonicalJson, contentHashSchema, seasonDigestHex } from '@hoop-rush/data-contracts';

export interface FixedFiveDigestInput {
  rootSeed: Seed;
  versions: FixedFiveVersionLocks;
  lineups: { p1: FixedFiveLineupEntry; p2: FixedFiveLineupEntry };
  acceptedCommands: FixedFiveCommand[];
  result: FixedFiveCompetitionResult;
  aggregates?: unknown;
}

export function canonicalFixedFiveDigestPayload(
  input: FixedFiveDigestInput,
): Record<string, unknown> {
  return {
    rootSeed: input.rootSeed,
    versions: input.versions,
    lineups: input.lineups,
    acceptedCommands: input.acceptedCommands,
    result: input.result,
    aggregates: input.aggregates ?? null,
  };
}

export function fixedFiveResultDigest(input: FixedFiveDigestInput): ContentHash {
  const material = canonicalJson(canonicalFixedFiveDigestPayload(input));
  return contentHashSchema.parse(
    `${seasonDigestHex(`fixed-five-digest-v1:${material}`)}${seasonDigestHex(`fixed-five-digest-v2:${material}`)}`,
  );
}

export function verifyFixedFiveDigest(
  input: FixedFiveDigestInput,
  expectedDigest: string,
): boolean {
  return fixedFiveResultDigest(input) === expectedDigest;
}
