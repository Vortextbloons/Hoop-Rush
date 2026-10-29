import { describe, expect, it } from 'bun:test';
import type { CapRushCard, Position } from '@hoop-rush/data-contracts';
import { CAP_RUSH_OFFER_RECIPE, POSITIONS } from '@hoop-rush/data-contracts';
import { capRushTestSetup } from './cap-rush-test-support.ts';
import { capRushOfferLegalCardIds } from './feasibility.ts';
import { generateCapRushOffer, generateCapRushReplacementOffer } from './offers.ts';
import { capRushSalaryDollars } from './salary.ts';

const setup = capRushTestSetup();

function offerFor(slot: Position, offerRevision = 0, picks = setup.state.picks) {
  return generateCapRushOffer({
    index: setup.index,
    runSeed: setup.state.runSeed,
    round: picks.length + 1,
    slot,
    offerRevision,
    picks,
  });
}

function bucketCounts(cards: readonly CapRushCard[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const card of cards) counts[card.bucket] = (counts[card.bucket] ?? 0) + 1;
  return counts;
}

describe('cap rush offers', () => {
  it('builds the exact ten-card recipe for every position', () => {
    const expected = Object.fromEntries(
      CAP_RUSH_OFFER_RECIPE.map((rule) => [rule.bucket, rule.count]),
    );
    for (const slot of POSITIONS) {
      const offer = offerFor(slot);
      expect(offer.cards).toHaveLength(10);
      expect(bucketCounts(offer.cards)).toEqual(expected);
      expect(
        offer.cards.find((card) => card.bucket === 'elite')?.source.originalOverall,
      ).toBeGreaterThanOrEqual(95);
      expect(
        offer.cards.find((card) => card.bucket === 'star')?.source.originalOverall,
      ).toBeGreaterThanOrEqual(90);
    }
  });

  it('keeps every card playable at the selected exact position', () => {
    for (const slot of POSITIONS) {
      const offer = offerFor(slot);
      for (const card of offer.cards) {
        expect(card.slot).toBe(slot);
        expect(card.source.positions).toContain(slot);
      }
    }
  });

  it('prices every card from its original overall', () => {
    const offer = offerFor('PG');
    for (const card of offer.cards) {
      expect(card.salaryDollars).toBe(
        capRushSalaryDollars(card.source.originalOverall, card.source.seasonKey),
      );
      expect(card.salaryDollars).toBeGreaterThanOrEqual(920_000);
      expect(card.salaryDollars).toBeLessThanOrEqual(75_900_000);
    }
  });

  it('offers ten distinct people with distinct card ids', () => {
    const offer = offerFor('SG');
    expect(new Set(offer.cards.map((card) => card.source.playerId)).size).toBe(10);
    expect(new Set(offer.cards.map((card) => card.cardId)).size).toBe(10);
  });

  it('offers and prices sub-60 players only as wildcards', () => {
    const lowSetup = capRushTestSetup({
      extraPlayers: [40, 50, 59].map((overall) => ({ positions: ['PG'], overall })),
    });
    const seen = new Set<number>();
    for (let offerRevision = 0; offerRevision < 100; offerRevision += 1) {
      const offer = generateCapRushOffer({
        index: lowSetup.index,
        runSeed: lowSetup.state.runSeed,
        round: 1,
        slot: 'PG',
        offerRevision,
        picks: [],
      });
      expect(offer.cards).toHaveLength(10);
      expect(offer.cards.filter((card) => card.bucket === 'wildcard')).toHaveLength(2);
      for (const card of offer.cards) {
        if (card.source.originalOverall >= 60) continue;
        seen.add(card.source.originalOverall);
        expect(card.bucket).toBe('wildcard');
        expect(card.salaryDollars).toBe(
          capRushSalaryDollars(card.source.originalOverall, card.source.seasonKey),
        );
      }
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([40, 50, 59]);
  });

  it('always contains at least one legal signing', () => {
    for (const slot of POSITIONS) {
      const offer = offerFor(slot);
      expect(
        capRushOfferLegalCardIds(setup.state, setup.index, offer.cards).length,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps a legal signing late in the draft', () => {
    const expensives = [
      { slot: 'C' as const, overall: 99 },
      { slot: 'SG' as const, overall: 92 },
      { slot: 'SF' as const, overall: 86 },
    ];
    const draftPicks = expensives.map(({ slot, overall }, pickOrdinal) => {
      const player = (setup.index.bySlot.get(slot) ?? []).find(
        (entry) => entry.originalOverall === overall,
      );
      if (player === undefined) throw new Error(`missing ${slot} ${String(overall)}`);
      return {
        pickOrdinal,
        slot,
        card: {
          cardId: `crc-${String(pickOrdinal).repeat(32)}`,
          offerId: `cro-${'a'.repeat(32)}`,
          cardIndex: pickOrdinal,
          slot,
          bucket: 'star' as const,
          source: player,
          salaryDollars: capRushSalaryDollars(player.originalOverall, player.seasonKey),
        },
      };
    });
    const offer = generateCapRushOffer({
      index: setup.index,
      runSeed: setup.state.runSeed,
      round: 4,
      slot: 'PG',
      offerRevision: 0,
      picks: draftPicks,
    });
    expect(
      capRushOfferLegalCardIds({ picks: draftPicks }, setup.index, offer.cards).length,
    ).toBeGreaterThan(0);
  });

  it('replays identical inputs to identical offers', () => {
    const left = offerFor('PF');
    const right = offerFor('PF');
    expect(right).toEqual(left);
  });

  it('changes the offer when the revision changes', () => {
    const first = offerFor('C', 0);
    const second = offerFor('C', 1);
    expect(second.offerId).not.toBe(first.offerId);
  });
});

describe('cap rush protected rerolls', () => {
  it('keeps the protected card in place and replaces the other nine people', () => {
    const offer = offerFor('SF');
    const protectedCard = offer.cards[3];
    if (protectedCard === undefined) throw new Error('missing card');
    const discarded = offer.cards
      .filter((card) => card.cardId !== protectedCard.cardId)
      .map((card) => card.source.playerId);
    const replacement = generateCapRushReplacementOffer({
      index: setup.index,
      runSeed: setup.state.runSeed,
      round: 1,
      slot: 'SF',
      offerRevision: 1,
      picks: setup.state.picks,
      protectedCard,
      discardedPlayerIds: discarded,
    });
    const kept = replacement.cards[protectedCard.cardIndex];
    expect(kept?.cardId).toBe(protectedCard.cardId);
    expect(kept?.bucket).toBe(protectedCard.bucket);
    expect(kept?.salaryDollars).toBe(protectedCard.salaryDollars);
    expect(kept?.source.playerId).toBe(protectedCard.source.playerId);
    expect(replacement.offerId).not.toBe(offer.offerId);
    expect(replacement.offerRevision).toBe(1);
    const replacedPeople = new Set(
      replacement.cards
        .filter((card) => card.cardIndex !== protectedCard.cardIndex)
        .map((card) => card.source.playerId),
    );
    expect(replacedPeople.size).toBe(9);
    for (const playerId of discarded) expect(replacedPeople.has(playerId)).toBe(false);
    expect(bucketCounts(replacement.cards)).toEqual(bucketCounts(offer.cards));
    expect(
      replacement.cards.find((card) => card.bucket === 'elite')?.source.originalOverall,
    ).toBeGreaterThanOrEqual(95);
  });

  it('replays identical rerolls to identical offers', () => {
    const offer = offerFor('SG');
    const protectedCard = offer.cards[0];
    if (protectedCard === undefined) throw new Error('missing card');
    const input = {
      index: setup.index,
      runSeed: setup.state.runSeed,
      round: 1,
      slot: 'SG' as const,
      offerRevision: 1,
      picks: setup.state.picks,
      protectedCard,
      discardedPlayerIds: offer.cards
        .filter((card) => card.cardId !== protectedCard.cardId)
        .map((card) => card.source.playerId),
    };
    expect(generateCapRushReplacementOffer(input)).toEqual(generateCapRushReplacementOffer(input));
  });
});
