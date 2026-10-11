import type { SubmissionIntent, SubmissionPolicy } from '@hoop-rush/application';
import {
  SEASON_BLOCK_POLICY,
  SEASON_COMMAND_POLICY,
  canResubmitBlock,
} from '@hoop-rush/application/season';

export { SEASON_BLOCK_POLICY, SEASON_COMMAND_POLICY, canResubmitBlock };

/**
 * Fixed-five multiplayer commands retry once the room has resynced, but only
 * for idempotent, retry-safe kinds (or when the adapter proves the retry is
 * still valid against fresh state).
 */
export const FIXED_FIVE_COMMAND_POLICY: SubmissionPolicy = {
  intent: 'fixed-five-command',
  conflict: 'resync-retry',
  maxAttempts: 3,
  requiresDigest: false,
};

/** Fixed-five submission with retries explicitly disabled by the caller. */
export const FIXED_FIVE_SINGLE_ATTEMPT_POLICY: SubmissionPolicy = {
  intent: 'fixed-five-command',
  conflict: 'surface',
  maxAttempts: 1,
  requiresDigest: false,
};

/**
 * Buying a pack spends currency and advances the collection revision, so a
 * stale digest surfaces as a "review the refreshed odds" error instead of
 * re-purchasing.
 */
export const COLLECTION_PACK_PURCHASE_POLICY: SubmissionPolicy = {
  intent: 'collection-pack-purchase',
  conflict: 'surface',
  maxAttempts: 1,
  requiresDigest: true,
};

/** Non-purchase collection mutations carry the same revision/digest guard. */
export const COLLECTION_COMMAND_POLICY: SubmissionPolicy = {
  intent: 'collection-command',
  conflict: 'surface',
  maxAttempts: 1,
  requiresDigest: true,
};

export function submissionPolicyFor(intent: SubmissionIntent): SubmissionPolicy {
  switch (intent) {
    case 'fixed-five-command':
      return FIXED_FIVE_COMMAND_POLICY;
    case 'season-command':
      return SEASON_COMMAND_POLICY;
    case 'season-block':
      return SEASON_BLOCK_POLICY;
    case 'collection-command':
      return COLLECTION_COMMAND_POLICY;
    case 'collection-pack-purchase':
      return COLLECTION_PACK_PURCHASE_POLICY;
  }
}
