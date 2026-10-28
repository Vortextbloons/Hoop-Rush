import type { CapRushDraftState } from '@hoop-rush/data-contracts';
import { canonicalJson, seasonDigestHex } from '@hoop-rush/data-contracts';

export const CAP_RUSH_STATE_DIGEST_PREFIX = 'cap-rush-draft-state-v1';

export function capRushStateDigest(state: CapRushDraftState): string {
  return seasonDigestHex(`${CAP_RUSH_STATE_DIGEST_PREFIX}\u0000${canonicalJson(state)}`);
}
