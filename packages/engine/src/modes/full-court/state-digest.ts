import type { FullCourtDraftState } from '@hoop-rush/data-contracts';
import { canonicalJson, seasonDigestHex } from '@hoop-rush/data-contracts';

export const FULL_COURT_STATE_DIGEST_PREFIX = 'full-court-draft-state-v1';

export function fullCourtStateDigest(state: FullCourtDraftState): string {
  return seasonDigestHex(`${FULL_COURT_STATE_DIGEST_PREFIX}\u0000${canonicalJson(state)}`);
}
