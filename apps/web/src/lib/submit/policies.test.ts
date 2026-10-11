import { describe, expect, it } from 'vitest';
import { FIXED_FIVE_COMMAND_POLICY, SEASON_BLOCK_POLICY, canResubmitBlock } from './policies';

describe('canResubmitBlock', () => {
  it('requires an exact current revision in surface mode', () => {
    expect(canResubmitBlock(SEASON_BLOCK_POLICY, 3, 3)).toBe(true);
    expect(canResubmitBlock(SEASON_BLOCK_POLICY, 3, 4)).toBe(false);
    expect(canResubmitBlock(SEASON_BLOCK_POLICY, 3, undefined)).toBe(false);
  });

  it('always allows resubmission under a resync-retry policy', () => {
    expect(canResubmitBlock(FIXED_FIVE_COMMAND_POLICY, 3, 9)).toBe(true);
  });
});
