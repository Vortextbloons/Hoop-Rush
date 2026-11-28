import { describe, expect, it } from 'bun:test';
import { FULL_COURT_DEFAULT_MONEY } from '@hoop-rush/data-contracts';
import { drawFullCourtRoundOffer } from './draft-offer.ts';
import { fullCourtTestSetup } from './draft-test-support.ts';

describe('drawFullCourtRoundOffer', () => {
  it('draws 8 distinct cards deterministically with varied star counts and shuffled order', () => {
    const setup = fullCourtTestSetup();
    const first = drawFullCourtRoundOffer({
      index: setup.index,
      state: setup.state,
      round: 0,
    });
    const second = drawFullCourtRoundOffer({
      index: setup.index,
      state: setup.state,
      round: 0,
    });

    expect(first).toBeDefined();
    expect(first?.cards).toHaveLength(8);
    expect(first).toEqual(second);

    const playerIds = new Set(first?.cards.map((card) => card.player.playerId));
    expect(playerIds.size).toBe(8);

    // Check across multiple rounds that star counts vary and card order is not strictly OVR-descending.
    const starCounts = new Set<number>();
    let foundNonDescending = false;
    for (let round = 0; round < 12; round += 1) {
      const offer = drawFullCourtRoundOffer({
        index: setup.index,
        state: { ...setup.state, money: FULL_COURT_DEFAULT_MONEY },
        round,
      });
      expect(offer?.cards).toHaveLength(8);
      const stars =
        offer?.cards.filter((card) => card.bucket === 'elite' || card.bucket === 'star').length ??
        0;
      starCounts.add(stars);
      const overalls = offer?.cards.map((card) => card.player.originalOverall) ?? [];
      for (let i = 1; i < overalls.length; i += 1) {
        const prev = overalls[i - 1];
        const curr = overalls[i];
        if (prev !== undefined && curr !== undefined && curr > prev) {
          foundNonDescending = true;
        }
      }
    }
    expect(starCounts.size).toBeGreaterThan(1);
    expect(foundNonDescending).toBe(true);
  });
});
