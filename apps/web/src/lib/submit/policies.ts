import type { SubmissionPolicy } from '@hoop-rush/application';
import { FIXED_FIVE_COMMAND_POLICY } from '@hoop-rush/application/fixed-five';

export { FIXED_FIVE_COMMAND_POLICY };

export const COLLECTION_PACK_PURCHASE_POLICY: SubmissionPolicy = {
  intent: 'collection-pack-purchase',
  conflict: 'surface',
  maxAttempts: 1,
  requiresDigest: true,
};

export const COLLECTION_COMMAND_POLICY: SubmissionPolicy = {
  intent: 'collection-command',
  conflict: 'surface',
  maxAttempts: 1,
  requiresDigest: true,
};
