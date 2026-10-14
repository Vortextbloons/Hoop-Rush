import { describe, expect, it, vi } from 'vitest';
import {
  HAVOC_MULTIPLAYER_REVEAL_FLIP_MS,
  HAVOC_MULTIPLAYER_REVEAL_SELECTION_MS,
  HAVOC_MULTIPLAYER_REVEAL_STAGGER_MS,
  HavocMultiplayerRevealDirector,
  havocMultiplayerOfferRevealPlan,
  type HavocMultiplayerRevealAttempt,
} from './havoc-multiplayer-reveal';

describe('havoc multiplayer offer reveal plan', () => {
  it('staggers three cards by 80ms with 300ms flips', () => {
    const plan = havocMultiplayerOfferRevealPlan(3);
    expect(plan.flipMs).toBe(HAVOC_MULTIPLAYER_REVEAL_FLIP_MS);
    expect(plan.staggerMs).toBe(HAVOC_MULTIPLAYER_REVEAL_STAGGER_MS);
    expect(plan.delaysMs).toEqual([0, 80, 160]);
    expect(plan.totalMs).toBe(300 + 2 * 80);
  });

  it('keeps reveal ordering stable for larger offer sizes', () => {
    const plan = havocMultiplayerOfferRevealPlan(5);
    expect(plan.delaysMs).toEqual([0, 80, 160, 240, 320]);
    for (let index = 1; index < plan.delaysMs.length; index += 1) {
      const previous = plan.delaysMs[index - 1];
      const current = plan.delaysMs[index];
      if (previous === undefined || current === undefined) throw new Error('missing delay');
      expect(current).toBeGreaterThan(previous);
    }
  });

  it('handles empty offers without animations', () => {
    expect(havocMultiplayerOfferRevealPlan(0).totalMs).toBe(0);
    expect(havocMultiplayerOfferRevealPlan(-1).cardCount).toBe(0);
  });
});

function director(reducedMotion = false): {
  readonly director: HavocMultiplayerRevealDirector;
  readonly played: HavocMultiplayerRevealAttempt[];
  readonly cancelled: HavocMultiplayerRevealAttempt[];
} {
  const played: HavocMultiplayerRevealAttempt[] = [];
  const cancelled: HavocMultiplayerRevealAttempt[] = [];
  const value = new HavocMultiplayerRevealDirector({
    reducedMotion: () => reducedMotion,
    cancel: (attempt) => {
      cancelled.push(attempt);
    },
  });
  return { director: value, played, cancelled };
}

describe('havoc multiplayer reveal director', () => {
  it('plays accepted picks and reports the selection transition duration', () => {
    const { director: value } = director();
    expect(HAVOC_MULTIPLAYER_REVEAL_SELECTION_MS).toBe(300);
    value.setOffer('hvo-offer-1');
    const attempt = value.beginSelection({ offerId: 'hvo-offer-1', cardId: 'hvc-card-1' });
    expect(attempt).not.toBeNull();
    if (attempt === null) return;
    const settlement = value.settleSelection(attempt, {
      accepted: true,
      offerId: 'hvo-offer-2',
    });
    expect(settlement).toBe('played');
    value.finishSelection(attempt);
  });

  it('skips rejected picks', () => {
    const { director: value, cancelled } = director();
    value.setOffer('hvo-offer-1');
    const attempt = value.beginSelection({ offerId: 'hvo-offer-1', cardId: 'hvc-card-1' });
    expect(attempt).not.toBeNull();
    if (attempt === null) return;
    expect(value.settleSelection(attempt, { accepted: false, offerId: 'hvo-offer-1' })).toBe(
      'rejected',
    );
    expect(cancelled).toEqual([]);
  });

  it('treats a settlement against an unchanged offer as stale', () => {
    const { director: value } = director();
    value.setOffer('hvo-offer-1');
    const attempt = value.beginSelection({ offerId: 'hvo-offer-1', cardId: 'hvc-card-1' });
    expect(attempt).not.toBeNull();
    if (attempt === null) return;
    expect(value.settleSelection(attempt, { accepted: true, offerId: 'hvo-offer-1' })).toBe(
      'stale',
    );
    expect(value.settleSelection(attempt, { accepted: true, offerId: 'hvo-offer-2' })).toBe(
      'stale',
    );
  });

  it('prevents repeated submissions while a transition is pending', () => {
    const { director: value } = director();
    value.setOffer('hvo-offer-1');
    const first = value.beginSelection({ offerId: 'hvo-offer-1', cardId: 'hvc-card-1' });
    expect(first).not.toBeNull();
    expect(value.beginSelection({ offerId: 'hvo-offer-1', cardId: 'hvc-card-2' })).toBeNull();
    if (first === null) return;
    value.settleSelection(first, { accepted: true, offerId: 'hvo-offer-2' });
    expect(value.beginSelection({ offerId: 'hvo-offer-1', cardId: 'hvc-card-2' })).toBeNull();
  });

  it('ignores selections for a stale offer', () => {
    const { director: value } = director();
    value.setOffer('hvo-offer-2');
    expect(value.beginSelection({ offerId: 'hvo-offer-1', cardId: 'hvc-card-1' })).toBeNull();
  });

  it('cancels a playing transition when the offer changes', () => {
    const { director: value, cancelled } = director();
    value.setOffer('hvo-offer-1');
    const attempt = value.beginSelection({ offerId: 'hvo-offer-1', cardId: 'hvc-card-1' });
    if (attempt === null) throw new Error('selection did not start');
    expect(value.settleSelection(attempt, { accepted: true, offerId: 'hvo-offer-2' })).toBe(
      'played',
    );
    value.setOffer('hvo-offer-3');
    expect(cancelled).toEqual([attempt]);
    expect(value.beginSelection({ offerId: 'hvo-offer-3', cardId: 'hvc-card-2' })).not.toBeNull();
  });

  it('cancels pending and playing transitions on resume or unmount', () => {
    const { director: value, cancelled } = director();
    value.setOffer('hvo-offer-1');
    const pending = value.beginSelection({ offerId: 'hvo-offer-1', cardId: 'hvc-card-1' });
    if (pending === null) throw new Error('selection did not start');
    value.cancelAll();
    expect(cancelled).toEqual([pending]);

    value.setOffer('hvo-offer-2');
    const playing = value.beginSelection({ offerId: 'hvo-offer-2', cardId: 'hvc-card-2' });
    if (playing === null) throw new Error('selection did not start');
    value.settleSelection(playing, { accepted: true, offerId: 'hvo-offer-3' });
    value.cancelAll();
    expect(cancelled).toEqual([pending, playing]);
  });

  it('shows updates immediately under reduced motion', () => {
    const reduced = vi.fn(() => true);
    const cancel = vi.fn();
    const value = new HavocMultiplayerRevealDirector({ reducedMotion: reduced, cancel });
    value.setOffer('hvo-offer-1');
    expect(value.beginSelection({ offerId: 'hvo-offer-1', cardId: 'hvc-card-1' })).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
  });
});
