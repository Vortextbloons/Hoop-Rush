import { describe, expect, it } from 'bun:test';
import {
  HAVOC_REVEAL_FLIP_MS,
  HAVOC_REVEAL_SELECTION_MS,
  HAVOC_REVEAL_STAGGER_MS,
  havocRevealBeginOffer,
  havocRevealDelayMs,
  havocRevealFlipMs,
  havocRevealResolve,
  havocRevealSelect,
  initialHavocRevealState,
} from './havoc-multiplayer-reveal';

describe('havoc multiplayer reveal sequence', () => {
  it('staggered card flips start at the first card and step by the stagger', () => {
    expect(HAVOC_REVEAL_FLIP_MS).toBe(300);
    expect(HAVOC_REVEAL_STAGGER_MS).toBe(80);
    expect(HAVOC_REVEAL_SELECTION_MS).toBe(300);
    expect([0, 1, 2].map((index) => havocRevealDelayMs(index))).toEqual([0, 80, 160]);
    expect(havocRevealFlipMs(1)).toBe(300);
    expect(havocRevealFlipMs(2)).toBe(380);
    expect(havocRevealFlipMs(3)).toBe(460);
  });

  it('reduced motion reveals immediately', () => {
    expect(havocRevealDelayMs(0, true)).toBe(0);
    expect(havocRevealDelayMs(2, true)).toBe(0);
    expect(havocRevealFlipMs(3, true)).toBe(0);
    expect(havocRevealFlipMs(0)).toBe(0);
  });

  it('prevents repeated submissions and ignores stale cards', () => {
    const state = havocRevealBeginOffer('hvo-a', ['hvc-1', 'hvc-2', 'hvc-3']);
    const selected = havocRevealSelect(state, 'hvc-2');
    expect(selected?.pendingCardId).toBe('hvc-2');
    expect(selected && havocRevealSelect(selected, 'hvc-3')).toBeNull();
    expect(havocRevealSelect(state, 'hvc-stale')).toBeNull();
    const resolved = havocRevealResolve(selected as NonNullable<typeof selected>, true);
    expect(resolved.state.pendingCardId).toBeNull();
    expect(resolved.acceptedCardId).toBe('hvc-2');
    const reselected = havocRevealSelect(resolved.state, 'hvc-3');
    expect(reselected?.pendingCardId).toBe('hvc-3');
  });

  it('only accepted picks produce a card to move into the lineup', () => {
    const selected = havocRevealSelect(havocRevealBeginOffer('hvo-a', ['hvc-1', 'hvc-2']), 'hvc-1');
    const rejected = havocRevealResolve(selected as NonNullable<typeof selected>, false);
    expect(rejected.acceptedCardId).toBeNull();
    expect(rejected.state.pendingCardId).toBeNull();
    const accepted = havocRevealResolve(rejected.state, true);
    expect(accepted.acceptedCardId).toBeNull();
    const again = havocRevealResolve(selected as NonNullable<typeof selected>, true);
    expect(again.acceptedCardId).toBe('hvc-1');
  });

  it('drops pending selections when the offer changes or the room resumes', () => {
    const selected = havocRevealSelect(havocRevealBeginOffer('hvo-a', ['hvc-1', 'hvc-2']), 'hvc-1');
    expect(selected?.pendingCardId).toBe('hvc-1');
    const nextOffer = havocRevealBeginOffer('hvo-b', ['hvc-4', 'hvc-5', 'hvc-6']);
    expect(nextOffer.pendingCardId).toBeNull();
    expect(nextOffer.offerId).toBe('hvo-b');
    expect(havocRevealSelect(nextOffer, 'hvc-1')).toBeNull();
    const resumed = havocRevealBeginOffer('hvo-b', ['hvc-4', 'hvc-5', 'hvc-6']);
    expect(resumed.pendingCardId).toBeNull();
  });

  it('starts idle with no offer', () => {
    const state = initialHavocRevealState();
    expect(state).toEqual({ offerId: null, cardIds: [], pendingCardId: null });
    expect(havocRevealSelect(state, 'hvc-1')).toBeNull();
  });
});
