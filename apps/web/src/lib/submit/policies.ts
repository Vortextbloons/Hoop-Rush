import type { SubmissionIntent, SubmissionPolicy } from '@hoop-rush/application';
import {
  FIXED_FIVE_COMMAND_POLICY,
  FIXED_FIVE_SINGLE_ATTEMPT_POLICY,
} from '@hoop-rush/application/fixed-five';
import {
  SEASON_BLOCK_POLICY,
  SEASON_COMMAND_POLICY,
  canResubmitBlock,
} from '@hoop-rush/application/season';

export {
  FIXED_FIVE_COMMAND_POLICY,
  FIXED_FIVE_SINGLE_ATTEMPT_POLICY,
  SEASON_BLOCK_POLICY,
  SEASON_COMMAND_POLICY,
  canResubmitBlock,
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
