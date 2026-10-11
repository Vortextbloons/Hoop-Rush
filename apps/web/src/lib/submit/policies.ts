import type { SubmissionIntent, SubmissionPolicy } from './submission';

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
 * Season Run commands are engine-computed and committed atomically behind an
 * expected state revision plus digest. A stale commit is never blind-retried:
 * the roster may already have moved, so it surfaces and lets the user refresh.
 */
export const SEASON_COMMAND_POLICY: SubmissionPolicy = {
  intent: 'season-command',
  conflict: 'surface',
  maxAttempts: 1,
  requiresDigest: true,
};

/**
 * Season block / lineup submission is a worker lifecycle that owns its own
 * digest and expected-revision gates. It must never auto-retry a stale block,
 * because a retry could simulate the same games twice.
 */
export const SEASON_BLOCK_POLICY: SubmissionPolicy = {
  intent: 'season-block',
  conflict: 'surface',
  maxAttempts: 1,
  requiresDigest: true,
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

/**
 * A surface-mode submission may only be re-issued when the state it targets is
 * still current. For a season block that means the submitted revision still
 * matches the run's committed revision.
 */
export function canResubmitBlock(
  policy: SubmissionPolicy,
  expectedRevision: number,
  currentRevision: number | undefined,
): boolean {
  if (policy.conflict === 'resync-retry') return true;
  return currentRevision !== undefined && expectedRevision === currentRevision;
}
