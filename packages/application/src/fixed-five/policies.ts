import type { SubmissionPolicy } from '../submission.ts';

export const FIXED_FIVE_COMMAND_POLICY: SubmissionPolicy = {
  intent: 'fixed-five-command',
  conflict: 'resync-retry',
  maxAttempts: 3,
  requiresDigest: false,
};

export const FIXED_FIVE_SINGLE_ATTEMPT_POLICY: SubmissionPolicy = {
  intent: 'fixed-five-command',
  conflict: 'surface',
  maxAttempts: 1,
  requiresDigest: false,
};
