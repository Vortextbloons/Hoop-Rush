import type { SubmissionPolicy } from '../submission.ts';

export const SEASON_COMMAND_POLICY: SubmissionPolicy = {
  intent: 'season-command',
  conflict: 'surface',
  maxAttempts: 1,
  requiresDigest: true,
};

export const SEASON_BLOCK_POLICY: SubmissionPolicy = {
  intent: 'season-block',
  conflict: 'surface',
  maxAttempts: 1,
  requiresDigest: true,
};

export function canResubmitBlock(
  policy: SubmissionPolicy,
  expectedRevision: number,
  currentRevision: number | undefined,
): boolean {
  if (policy.conflict === 'resync-retry') return true;
  return currentRevision !== undefined && expectedRevision === currentRevision;
}
