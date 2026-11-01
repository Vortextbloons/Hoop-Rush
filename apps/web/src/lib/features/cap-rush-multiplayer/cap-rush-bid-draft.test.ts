import { describe, expect, test } from 'bun:test';
import { CapRushBidDraft } from './cap-rush-bid-draft.svelte.js';

describe('cap rush bid draft', () => {
  test('follows the authoritative minimum until edited', () => {
    const draft = new CapRushBidDraft(12_000_000);
    expect(draft.proposedTotal).toBe(12_000_000);

    draft.adoptMinimum(12_100_000);
    expect(draft.proposedTotal).toBe(12_100_000);

    draft.setText('13,500,000');
    expect(draft.proposedTotal).toBe(13_500_000);

    draft.adoptMinimum(13_600_000);
    expect(draft.proposedTotal).toBe(13_500_000);
    expect(draft.stale).toBe(true);
  });

  test('preserves an explicitly edited total but flags staleness', () => {
    const draft = new CapRushBidDraft(12_000_000);
    draft.setTotal(12_500_000);
    expect(draft.stale).toBe(false);
    expect(draft.valid).toBe(true);

    draft.adoptMinimum(12_600_000);
    expect(draft.proposedTotal).toBe(12_500_000);
    expect(draft.stale).toBe(true);
    expect(draft.valid).toBe(false);

    draft.useMinimum();
    expect(draft.followsMinimum).toBe(true);
    expect(draft.proposedTotal).toBe(12_600_000);
  });

  test('rejects empty and malformed totals without rounding', () => {
    const draft = new CapRushBidDraft(12_000_000);
    draft.setText('');
    expect(draft.empty).toBe(true);
    expect(draft.valid).toBe(false);

    draft.setText('12.5');
    expect(draft.malformed).toBe(true);
    expect(draft.proposedTotal).toBeNull();
    expect(draft.valid).toBe(false);

    draft.setText('$13,123,456');
    expect(draft.proposedTotal).toBe(13_123_456);
    expect(draft.valid).toBe(true);
  });

  test('reset returns to the next legal minimum for a new lot', () => {
    const draft = new CapRushBidDraft(12_000_000);
    draft.setTotal(20_000_000);
    draft.reset(9_000_000);
    expect(draft.followsMinimum).toBe(true);
    expect(draft.proposedTotal).toBe(9_000_000);
    expect(draft.valid).toBe(true);
  });
});

test('repeated adjustments accumulate and stop at the latest legal minimum', () => {
  const draft = new CapRushBidDraft(12694850);
  draft.adjust(100000);
  draft.adjust(500000);
  expect(draft.proposedTotal).toBe(13294850);
  draft.adjust(-1000000);
  expect(draft.proposedTotal).toBe(12694850);
  draft.adoptMinimum(14000000);
  draft.adjust(-100000);
  expect(draft.proposedTotal).toBe(14000000);
});
