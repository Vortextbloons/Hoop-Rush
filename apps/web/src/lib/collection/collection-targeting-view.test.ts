import { describe, expect, it } from 'vitest';
import type {
  CollectionCatalog,
  CollectionCatalogCard,
  CollectionPullRecord,
} from '@hoop-rush/data-contracts';
import { describeCollectionTargetOdds } from '@hoop-rush/engine';
import {
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
} from '@hoop-rush/test-fixtures';
import {
  formatTargetProbability,
  isTargetedPullSlot,
  packTargetOddsView,
  pullTargetPlayerId,
  targetPlayerSummary,
  targetedReceiptFacts,
  targetedSummaryForPlayer,
} from './collection-targeting-view';

function cardId(suffix: string): string {
  return `card-${suffix.padStart(32, '0')}`;
}

function buildCatalog(): CollectionCatalog {
  const cards: CollectionCatalogCard[] = [
    buildCollectionFixtureCard('fixture-pg', {
      cardId: cardId('1'),
      displayName: 'Fixture Guard One',
      rarity: 'Ember',
      summarySource: { overallRating: 60, offenseRating: 60, defenseRating: 60 },
    }),
    buildCollectionFixtureCard('fixture-pg', {
      cardId: cardId('2'),
      family: 'Sharpshooter',
      rarity: 'Apex',
      displayName: 'Fixture Guard One',
      summarySource: { overallRating: 90, offenseRating: 90, defenseRating: 70 },
    }),
    buildCollectionFixtureCard('fixture-sg', {
      cardId: cardId('3'),
      displayName: 'Fixture Guard Two',
      rarity: 'Ember',
    }),
  ];
  return buildCollectionFixtureCatalog({
    cards,
    sets: [
      {
        setId: 'sharpshooter-set',
        title: 'Fixture Sharpshooters',
        memberCardIds: [cardId('2')],
      },
    ],
  });
}

const PLAYER_PG_EMBER = cardId('1');
const PLAYER_PG_APEX = cardId('2');
const PLAYER_SG_EMBER = cardId('3');

const playerIdOf =
  (catalog: CollectionCatalog) =>
  (cardId: string): string | null =>
    catalog.cards.find((card) => card.cardId === cardId)?.playerId ?? null;

function targetedPull(targetPlayerId: string | null): CollectionPullRecord {
  return {
    pullSequence: 3,
    kind: 'pack',
    packId: 'tip-off',
    packRulesVersion: 'collection-pack-rules-v1',
    economyVersion: 'collection-economy-v1',
    catalogVersion: 'collection-catalog-v1',
    catalogHash: 'a'.repeat(64),
    commandId: 'cmd-1' as CollectionPullRecord['commandId'],
    seedPath: ['collection', 'pulls', 'tip-off'],
    slots: [
      { slotIndex: 0, cardId: PLAYER_PG_EMBER, rarity: 'Ember', kept: true, conversionAmount: 0 },
      { slotIndex: 1, cardId: PLAYER_SG_EMBER, rarity: 'Ember', kept: true, conversionAmount: 0 },
    ],
    replayVersion: 'collection-replay-v2',
    targeting:
      targetPlayerId === null
        ? null
        : {
            targetingVersion: 'collection-targeting-v1',
            targetPlayerId: targetPlayerId as never,
            multiplierBp: 80_000,
            packId: 'tip-off',
            packRulesVersion: 'collection-pack-rules-v1',
            eligibleByRarity: [
              { rarity: 'Ember', cardIds: [PLAYER_PG_EMBER] },
              { rarity: 'Eruption', cardIds: [] },
              { rarity: 'Apex', cardIds: [PLAYER_PG_APEX] },
              { rarity: 'Titan', cardIds: [] },
              { rarity: 'Eclipse', cardIds: [] },
              { rarity: 'Immortal', cardIds: [] },
            ],
            eligibleCardCount: 2,
            seedPath: ['collection', 'targeting', 'tip-off'],
          },
  } as CollectionPullRecord;
}

describe('formatTargetProbability', () => {
  it('renders zero as exactly 0%', () => {
    expect(formatTargetProbability(0)).toBe('0%');
    expect(formatTargetProbability(-0.5)).toBe('0%');
    expect(formatTargetProbability(Number.NaN)).toBe('0%');
  });

  it('never rounds a tiny nonzero probability to zero', () => {
    const label = formatTargetProbability(1e-12);
    expect(label).not.toBe('0%');
    expect(label).toMatch(/e-/);
    const small = formatTargetProbability(0.000004);
    expect(small).not.toBe('0%');
  });

  it('renders readable percents', () => {
    expect(formatTargetProbability(0.5)).toBe('50%');
    expect(formatTargetProbability(0.123456)).toBe('12.35%');
    expect(formatTargetProbability(0.0001)).toBe('0.01%');
  });
});

describe('targetPlayerSummary', () => {
  it('counts catalog versions and eligible packs', () => {
    const catalog = buildCatalog();
    const summary = targetPlayerSummary(catalog, 'fixture-pg');
    expect(summary).not.toBeNull();
    expect(summary?.versionCount).toBe(2);
    expect(summary?.versionsByRarity.Ember).toBe(1);
    expect(summary?.versionsByRarity.Apex).toBe(1);
    expect(summary?.packsWithEligibleVersions).toBe(1);
  });

  it('returns null for a player outside the catalog', () => {
    expect(targetPlayerSummary(buildCatalog(), 'missing-player')).toBeNull();
  });

  it('formats a summary line', () => {
    const summary = targetPlayerSummary(buildCatalog(), 'fixture-pg');
    expect(targetedSummaryForPlayer(summary, 'fixture-pg')).toBe(
      'Fixture Guard One · 2 catalog versions · eligible in 1 pack',
    );
  });
});

describe('packTargetOddsView', () => {
  it('reports an untargeted pack honestly', () => {
    const catalog = buildCatalog();
    const pack = catalog.packs[0];
    if (!pack) throw new Error('missing pack');
    const odds = describeCollectionTargetOdds({
      catalog,
      pack,
      targetPlayerId: null,
      multiplierBp: 80_000,
    });
    const view = packTargetOddsView({
      odds,
      playerName: 'Fixture Guard One',
      eligibleVersionCount: 2,
    });
    expect(view.hasTarget).toBe(false);
    expect(view.summary).toContain('No active target');
    expect(view.atLeastOneLabel).toBe('0%');
  });

  it('reports eligible target odds beside the unchanged pack', () => {
    const catalog = buildCatalog();
    const pack = catalog.packs[0];
    if (!pack) throw new Error('missing pack');
    const odds = describeCollectionTargetOdds({
      catalog,
      pack,
      targetPlayerId: 'fixture-pg',
      multiplierBp: 80_000,
    });
    const view = packTargetOddsView({
      odds,
      playerName: 'Fixture Guard One',
      eligibleVersionCount: 2,
    });
    expect(view.eligible).toBe(true);
    expect(view.atLeastOneLabel).not.toBe('0%');
    expect(view.summary).toContain('P(at least one Fixture Guard One)');
    expect(view.summary).toContain('2 eligible versions');
  });

  it('says a pack has no eligible version instead of implying a boost', () => {
    const catalog = buildCatalog();
    const pack = catalog.packs[0];
    if (!pack) throw new Error('missing pack');
    const odds = describeCollectionTargetOdds({
      catalog,
      pack,
      targetPlayerId: 'fixture-sf',
      multiplierBp: 80_000,
    });
    const view = packTargetOddsView({
      odds,
      playerName: 'Fixture Forward One',
      eligibleVersionCount: 0,
    });
    expect(view.hasTarget).toBe(true);
    expect(view.eligible).toBe(false);
    expect(view.atLeastOneLabel).toBe('0%');
    expect(view.summary).toContain('No eligible version');
  });
});

describe('targeted receipt facts', () => {
  it('identifies a targeted hit factually and keeps the target', () => {
    const catalog = buildCatalog();
    const pull = targetedPull('fixture-pg');
    expect(pullTargetPlayerId(pull)).toBe('fixture-pg');
    const facts = targetedReceiptFacts({
      pull,
      playerName: 'Fixture Guard One',
      playerIdOf: playerIdOf(catalog),
    });
    expect(facts?.hitCount).toBe(1);
    expect(facts?.slotCount).toBe(2);
    expect(facts?.hitSlotIndices).toEqual([0]);
    expect(facts?.summary).toContain('The target stays active.');
  });

  it('reports a miss without a streak', () => {
    const catalog = buildCatalog();
    const facts = targetedReceiptFacts({
      pull: targetedPull('fixture-sf'),
      playerName: 'Fixture Forward One',
      playerIdOf: playerIdOf(catalog),
    });
    expect(facts?.hitCount).toBe(0);
    expect(facts?.summary).toContain('No Fixture Forward One in this pull');
    expect(facts?.summary).not.toContain('streak');
  });

  it('returns null for an untargeted pull', () => {
    expect(pullTargetPlayerId(targetedPull(null))).toBeNull();
    expect(
      targetedReceiptFacts({
        pull: targetedPull(null),
        playerName: 'Fixture Guard One',
        playerIdOf: playerIdOf(buildCatalog()),
      }),
    ).toBeNull();
  });

  it('marks only targeted slots', () => {
    const catalog = buildCatalog();
    const pull = targetedPull('fixture-pg');
    expect(isTargetedPullSlot(pull, PLAYER_PG_EMBER, playerIdOf(catalog))).toBe(true);
    expect(isTargetedPullSlot(pull, PLAYER_SG_EMBER, playerIdOf(catalog))).toBe(false);
  });
});
