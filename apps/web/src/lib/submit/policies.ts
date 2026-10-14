import type { SubmissionPolicy } from '@hoop-rush/application';
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
