import type { HavocRunState } from '@hoop-rush/data-contracts';
import { canonicalJson, seasonDigestHex } from '@hoop-rush/data-contracts';

// Digest material: HAVOC_STATE_DIGEST_PREFIX, NUL, canonicalJson(run state).
export const HAVOC_STATE_DIGEST_PREFIX = 'havoc-run-state-v1';

export function HavocStateDigest(state: HavocRunState): string {
  return seasonDigestHex(`${HAVOC_STATE_DIGEST_PREFIX}\u0000${canonicalJson(state)}`);
}
