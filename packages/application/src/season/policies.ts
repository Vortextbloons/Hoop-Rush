import type { SubmissionPolicy } from '../submission.ts';

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
