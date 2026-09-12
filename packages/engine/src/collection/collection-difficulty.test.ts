import { describe, expect, it } from 'vitest';
import {
  REQUIRED_RATING_KEYS,
  canonicalJson,
  collectionPreparedGameV2Schema,
  type CollectionDifficultyProfile,
} from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCollectionDifficultyProfile,
  buildCollectionDifficultyProfiles,
  buildCollectionFixtureCard,
} from '@hoop-rush/test-fixtures';
import { toControllerInput } from './adapters.ts';
import {
  materializeAdjustedCpuRatings,
  resolveDifficultyRatingAdjustmentForCard,
  verifyDifficultyRatingAdjustments,
} from './difficulty.ts';
import { simulateCollectionGame } from './game.ts';
import { generateCollectionCpuTeamV2 } from './cpu.ts';
import { buildCollectionObjectiveFacts } from './objectives.ts';
import { prepareV2Fixture, v2Catalog, v2Definitions, v2Team } from './v2-fixtures.ts';

function profileOf(difficultyId: 'street' | 'pro' | 'legend'): CollectionDifficultyProfile {
  const profile = buildCollectionDifficultyProfiles().find(
    (candidate) => candidate.difficultyId === difficultyId,
  );
  if (profile === undefined) throw new Error('missing profile');
  return profile;
}

describe('collection difficulty adjustments', () => {
  it('applies the profile shift to every cpu rating exactly once', () => {
    const { prepared, catalog } = prepareV2Fixture({ difficultyId: 'legend' });
    expect(prepared.adjustments.requestedDelta).toBe(2);
    expect(prepared.adjustments.facts).toHaveLength(12);
    for (const fact of prepared.adjustments.facts) {
      expect(fact.requestedDelta).toBe(2);
      for (const entry of fact.ratings) {
        expect(entry.after).toBe(Math.min(100, entry.before + 2));
      }
    }
    const adjusted = materializeAdjustedCpuRatings(prepared, catalog);
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const roster = [...prepared.cpuTeam.starters, ...prepared.cpuTeam.bench];
    for (const cardId of roster) {
      const ratings = adjusted.get(cardId);
      expect(ratings).toBeDefined();
      const card = byId.get(cardId);
      if (card === undefined || ratings === undefined) throw new Error('missing card');
      for (const rating of REQUIRED_RATING_KEYS) {
        expect(ratings[rating]).toBeGreaterThanOrEqual(0);
        expect(ratings[rating]).toBeLessThanOrEqual(100);
      }
    }
    expect(verifyDifficultyRatingAdjustments(prepared, catalog)).toEqual([]);
  });

  it('records bounded ratings and zero facts for a zero shift', () => {
    const boundedCard = buildCollectionFixtureCard('bounds', {
      detailedRatings: {
        ...buildCollectionFixtureCard('bounds-base').detailedRatings,
        threePoint: 99,
        freeThrow: 0,
      },
    });
    const street = resolveDifficultyRatingAdjustmentForCard(boundedCard, profileOf('street'));
    const freeThrow = street.ratings.find((entry) => entry.rating === 'freeThrow');
    expect(freeThrow?.after).toBe(0);
    expect(street.boundedRatings).toContain('freeThrow');
    const legend = resolveDifficultyRatingAdjustmentForCard(boundedCard, profileOf('legend'));
    const three = legend.ratings.find((entry) => entry.rating === 'threePoint');
    expect(three?.after).toBe(100);
    expect(legend.boundedRatings).toContain('threePoint');

    const pro = prepareV2Fixture({ difficultyId: 'pro' });
    expect(pro.prepared.adjustments.requestedDelta).toBe(0);
    expect(pro.prepared.adjustments.facts).toEqual([]);
    const adjusted = materializeAdjustedCpuRatings(pro.prepared, pro.catalog);
    const roster = [...pro.prepared.cpuTeam.starters, ...pro.prepared.cpuTeam.bench];
    for (const cardId of roster) {
      expect(adjusted.get(cardId)).toBeDefined();
    }
  });

  it('materializes adjusted simulation inputs for the controller', () => {
    const { prepared, catalog } = prepareV2Fixture({ difficultyId: 'street' });
    const input = toControllerInput(prepared, catalog, DEFAULT_ERA_SIM_PROFILE) as unknown as {
      away: { players: Array<{ playerVersionId: string; ratings: Record<string, number> }> };
    };
    const adjusted = materializeAdjustedCpuRatings(prepared, catalog);
    for (const player of input.away.players) {
      const expected = adjusted.get(player.playerVersionId);
      expect(expected).toBeDefined();
      for (const rating of REQUIRED_RATING_KEYS) {
        expect(player.ratings[rating]).toBe(expected?.[rating]);
      }
    }
  });

  it('keeps the opponent, seed, and simulation transcript independent of objective choice', () => {
    const catalog = v2Catalog();
    const team = v2Team(catalog);
    const definitions = v2Definitions();
    const offers = buildCollectionObjectiveFacts({
      definitions,
      rootSeed: '0'.repeat(32),
      difficultyId: 'pro',
      gameSequence: 3,
      team,
      selectedObjectiveId: null,
    }).offers;
    const firstOffer = offers[0];
    const secondOffer = offers[1];
    if (firstOffer === undefined || secondOffer === undefined) throw new Error('missing offers');
    const first = prepareV2Fixture({
      catalog,
      team,
      difficultyId: 'pro',
      gameSequence: 3,
      objectiveId: firstOffer.objectiveId,
    });
    const second = prepareV2Fixture({
      catalog,
      team,
      difficultyId: 'pro',
      gameSequence: 3,
      objectiveId: secondOffer.objectiveId,
    });
    expect(canonicalJson(first.prepared.cpuTeam)).toBe(canonicalJson(second.prepared.cpuTeam));
    expect(canonicalJson(first.prepared.construction)).toBe(
      canonicalJson(second.prepared.construction),
    );
    expect(canonicalJson(first.prepared.adjustments)).toBe(
      canonicalJson(second.prepared.adjustments),
    );
    expect(first.prepared.seed).toBe(second.prepared.seed);
    expect(first.prepared.inputDigest).not.toBe(second.prepared.inputDigest);

    const firstRun = simulateCollectionGame(first.prepared, first.catalog, DEFAULT_ERA_SIM_PROFILE);
    const secondRun = simulateCollectionGame(
      second.prepared,
      second.catalog,
      DEFAULT_ERA_SIM_PROFILE,
    );
    expect(canonicalJson(firstRun.result)).toBe(canonicalJson(secondRun.result));
    expect(canonicalJson(firstRun.events)).toBe(canonicalJson(secondRun.events));
  });

  it('generates player-independent cpu teams for the same seed', () => {
    const catalog = v2Catalog();
    const profile = profileOf('legend');
    const first = generateCollectionCpuTeamV2(catalog, '3'.repeat(32), 7, profile);
    const second = generateCollectionCpuTeamV2(catalog, '3'.repeat(32), 7, profile);
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.construction.candidateCount).toBe(8);
    const street = generateCollectionCpuTeamV2(catalog, '3'.repeat(32), 7, profileOf('street'));
    expect(street.construction.candidateCount).toBe(1);
    const pro = generateCollectionCpuTeamV2(catalog, '3'.repeat(32), 7, profileOf('pro'));
    expect(pro.construction.candidateCount).toBe(4);
  });

  it('moves construction quality in the declared difficulty direction', () => {
    const catalog = v2Catalog(36);
    const totals = new Map<string, number>([
      ['street', 0],
      ['pro', 0],
      ['legend', 0],
    ]);
    const seeds = 12;
    for (let sequence = 0; sequence < seeds; sequence += 1) {
      for (const difficultyId of ['street', 'pro', 'legend'] as const) {
        const result = generateCollectionCpuTeamV2(
          catalog,
          '4'.repeat(32),
          sequence,
          profileOf(difficultyId),
        );
        const chosen = result.construction.candidates.find(
          (candidate) => candidate.candidateIndex === result.construction.chosenCandidateIndex,
        );
        totals.set(
          difficultyId,
          (totals.get(difficultyId) ?? 0) + (chosen?.score.fiveCoreMillionths ?? 0),
        );
      }
    }
    expect(totals.get('legend') ?? 0).toBeGreaterThan(totals.get('pro') ?? 0);
    expect(totals.get('pro') ?? 0).toBeGreaterThan(totals.get('street') ?? 0);
  });

  it('rejects tampered adjustment facts during verification', () => {
    const { prepared, catalog } = prepareV2Fixture({ difficultyId: 'street' });
    const roster = new Set([...prepared.cpuTeam.starters, ...prepared.cpuTeam.bench]);
    const outsider = catalog.cards.find((card) => !roster.has(card.cardId));
    if (outsider === undefined) throw new Error('no unrostered card');
    const tampered = collectionPreparedGameV2Schema.parse({
      ...prepared,
      adjustments: {
        ...prepared.adjustments,
        facts: prepared.adjustments.facts.map((fact, index) =>
          index === 0 ? { ...fact, cardId: outsider.cardId } : fact,
        ),
      },
    });
    expect(verifyDifficultyRatingAdjustments(tampered, catalog).length).toBeGreaterThan(0);
  });

  it('supports the declared candidate values for each difficulty profile', () => {
    const street = buildCollectionDifficultyProfile('street');
    expect(street.ratingShift).toBe(-2);
    expect(street.rewardMultiplierBp).toBe(10_000);
    const legend = buildCollectionDifficultyProfile('legend');
    expect(legend.ratingShift).toBe(2);
    expect(legend.rewardMultiplierBp).toBe(17_500);
  });
});
