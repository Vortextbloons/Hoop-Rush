import { canonicalJson, seasonDigestHex } from '@hoop-rush/data-contracts';
import type { ChallengeRun } from '@hoop-rush/data-contracts';

export function challengeRunProgressDigest(run: ChallengeRun): string {
  return seasonDigestHex(
    canonicalJson({
      runId: run.runId,
      status: run.status,
      firstLossGameNumber: run.firstLossGameNumber,
      aggregates: run.aggregates,
      games: run.games,
    }),
  );
}
