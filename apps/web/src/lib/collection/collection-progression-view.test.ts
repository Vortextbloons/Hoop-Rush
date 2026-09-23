import { describe, expect, it } from 'vitest';
import {
  collectionChallengeDefinitionSchema,
  collectionProgressionRulesSchema,
  type CollectionActiveTeam,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionChallengeDefinition,
  type CollectionSetRewardDefinition,
  type EraId,
  type FranchiseId,
} from '@hoop-rush/data-contracts';
import { initializeCollectionActiveTeam, validateCollectionChallengeTeam } from '@hoop-rush/engine';
import {
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
} from '@hoop-rush/test-fixtures';
import {
  challengeCardView,
  challengeEligibilityReason,
  challengeProgressLabel,
  challengeRewardPreview,
  humanizeIdentifier,
  requirementLabel,
  setProgressView,
  setProgressViews,
} from './collection-progression-view';

const HASH = 'b'.repeat(64);

function challengeDefinition(
  overrides: Partial<CollectionChallengeDefinition> = {},
): CollectionChallengeDefinition {
  return collectionChallengeDefinitionSchema.parse({
    challengeVersion: 'collection-challenge-v1',
    challengeId: 'challenge-franchise-lakers-v1',
    displayName: 'Lakers Core',
    description: 'Run the Lakers.',
    requirement: {
      kind: 'franchise-core',
      franchiseId: 'lakers',
      minimumRosterCount: 3,
      minimumStarterCount: 2,
    },
    difficultyId: 'pro',
    firstClearCoins: 450,
    repeatWinCoins: 45,
    ...overrides,
  });
}

function teamOf(catalog: CollectionCatalog, cardIds: string[]): CollectionActiveTeam {
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  return initializeCollectionActiveTeam(cardIds, (cardId) => byId.get(cardId));
}

function progressionWith(
  challenges: CollectionChallengeDefinition[],
  setRewards: CollectionSetRewardDefinition[],
) {
  return collectionProgressionRulesSchema.parse({
    schemaVersion: 1,
    progressionVersion: 'collection-progression-v1',
    targetingVersion: 'collection-targeting-v1',
    challengeVersion: 'collection-challenge-v1',
    challengeRewardVersion: 'collection-challenge-reward-v1',
    setRewardVersion: 'collection-set-reward-v1',
    sourceCatalogVersion: 'collection-catalog-v1',
    sourceCatalogHash: HASH,
    targetMultiplierBp: 80_000,
    challenges,
    setRewards,
    display: {
      challengesTitle: 'Challenges',
      challengesBlurb: 'Fixed roster challenges.',
      targetingBlurb: 'Target one player.',
      setsTitle: 'Sets',
      setsBlurb: 'Complete a set.',
    },
    contentDigest: '0'.repeat(32),
  });
}

describe('requirement labels', () => {
  it('humanizes identifiers', () => {
    expect(humanizeIdentifier('floor-general-set')).toBe('Floor General Set');
  });

  it('labels each requirement kind', () => {
    const eraId = '1980s' as EraId;
    const franchiseId = 'lakers' as FranchiseId;
    expect(
      requirementLabel({
        kind: 'era-core',
        eraId,
        minimumRosterCount: 8,
        minimumStarterCount: 5,
      }),
    ).toBe('5 starters and at least 8 active cards from the 1980s');
    expect(
      requirementLabel({
        kind: 'franchise-core',
        franchiseId,
        minimumRosterCount: 6,
        minimumStarterCount: 3,
      }),
    ).toBe('3 starters and at least 6 active cards from the Lakers');
    expect(
      requirementLabel(
        {
          kind: 'set-family-core',
          setId: 'sharpshooter-set',
          minimumRosterCount: 3,
          minimumStarterCount: 2,
        },
        () => 'Fixture Sharpshooters',
      ),
    ).toBe('2 starters and at least 3 active cards from the Fixture Sharpshooters set');
  });
});

describe('challenge eligibility facts', () => {
  it('reports success and progress from the committed team', () => {
    const catalog = buildCollectionFixtureCatalog();
    const team = teamOf(
      catalog,
      catalog.cards.slice(0, 6).map((card) => card.cardId),
    );
    const owned = new Set(catalog.cards.map((card) => card.cardId));
    const check = validateCollectionChallengeTeam({
      definition: challengeDefinition(),
      team,
      catalog,
      ownedCardIds: owned,
    });
    expect(check.facts.success).toBe(true);
    expect(challengeProgressLabel(check.facts)).toBe('6/3 active · 5/2 starters');
    expect(challengeEligibilityReason(check.facts)).toContain('meets this requirement');
  });

  it('gives one actionable reason when the roster count is short', () => {
    const catalog = buildCollectionFixtureCatalog();
    const team = teamOf(
      catalog,
      catalog.cards.slice(0, 6).map((card) => card.cardId),
    );
    const owned = new Set(catalog.cards.map((card) => card.cardId));
    const check = validateCollectionChallengeTeam({
      definition: challengeDefinition({
        requirement: {
          kind: 'franchise-core',
          franchiseId: 'lakers' as FranchiseId,
          minimumRosterCount: 12,
          minimumStarterCount: 5,
        },
      }),
      team,
      catalog,
      ownedCardIds: owned,
    });
    expect(check.facts.success).toBe(false);
    expect(challengeEligibilityReason(check.facts)).toBe(
      'Add 6 more matching cards to the active roster (5 starters and at least 12 active cards from the Lakers).',
    );
  });

  it('gives one actionable reason when the starter count is short', () => {
    const cardId = (suffix: string): string => `card-${suffix.padStart(32, '0')}`;
    const eraId = (value: string): CollectionCatalogCard['eraId'] =>
      value as CollectionCatalogCard['eraId'];
    const cards: CollectionCatalogCard[] = [
      buildCollectionFixtureCard('fixture-pg', { cardId: cardId('1'), eraId: eraId('1990s') }),
      buildCollectionFixtureCard('fixture-sg', { cardId: cardId('2'), eraId: eraId('1990s') }),
      buildCollectionFixtureCard('fixture-sf', { cardId: cardId('3'), eraId: eraId('1990s') }),
      buildCollectionFixtureCard('fixture-pf', { cardId: cardId('4'), eraId: eraId('2000s') }),
      buildCollectionFixtureCard('fixture-c', { cardId: cardId('5'), eraId: eraId('2000s') }),
      buildCollectionFixtureCard('fixture-pf2', {
        cardId: cardId('6'),
        eraId: eraId('1990s'),
        positions: ['PF'],
      }),
      buildCollectionFixtureCard('fixture-c2', {
        cardId: cardId('7'),
        eraId: eraId('1990s'),
        positions: ['C'],
      }),
    ];
    const catalog = buildCollectionFixtureCatalog({
      cards,
      sets: [
        { setId: 'sharpshooter-set', title: 'Fixture Sharpshooters', memberCardIds: [cardId('1')] },
      ],
    });
    const team: CollectionActiveTeam = {
      teamVersion: 'collection-team-v1',
      starters: [cardId('1'), cardId('2'), cardId('3'), cardId('4'), cardId('5')],
      bench: [cardId('6'), cardId('7')],
      targetMinutes: [
        { cardId: cardId('1'), minutes: 40 },
        { cardId: cardId('2'), minutes: 40 },
        { cardId: cardId('3'), minutes: 40 },
        { cardId: cardId('4'), minutes: 40 },
        { cardId: cardId('5'), minutes: 40 },
        { cardId: cardId('6'), minutes: 20 },
        { cardId: cardId('7'), minutes: 20 },
      ],
    };
    const check = validateCollectionChallengeTeam({
      definition: challengeDefinition({
        requirement: {
          kind: 'era-core',
          eraId: eraId('1990s'),
          minimumRosterCount: 5,
          minimumStarterCount: 4,
        },
      }),
      team,
      catalog,
      ownedCardIds: new Set(cards.map((card) => card.cardId)),
    });
    expect(check.facts.success).toBe(false);
    expect(check.facts.rosterCount).toBe(5);
    expect(check.facts.starterCount).toBe(3);
    expect(challengeEligibilityReason(check.facts)).toBe(
      'Start 1 more matching card (4 starters and at least 5 active cards from the 1990s).',
    );
  });

  it('explains an illegal committed team', () => {
    const catalog = buildCollectionFixtureCatalog();
    const team = teamOf(
      catalog,
      catalog.cards.slice(0, 5).map((card) => card.cardId),
    );
    const check = validateCollectionChallengeTeam({
      definition: challengeDefinition(),
      team,
      catalog,
      ownedCardIds: new Set(),
    });
    expect(check.facts.teamValid).toBe(false);
    expect(challengeEligibilityReason(check.facts)).toContain('Fix the team');
  });
});

describe('challenge card view', () => {
  it('derives the next action and status', () => {
    const catalog = buildCollectionFixtureCatalog();
    const team = teamOf(
      catalog,
      catalog.cards.slice(0, 6).map((card) => card.cardId),
    );
    const definition = challengeDefinition();
    const facts = validateCollectionChallengeTeam({
      definition,
      team,
      catalog,
      ownedCardIds: new Set(catalog.cards.map((card) => card.cardId)),
    }).facts;
    const view = challengeCardView({
      challenge: definition,
      facts,
      cleared: false,
      hasPendingGame: false,
    });
    expect(view.eligible).toBe(true);
    expect(view.nextAction).toBe('choose-objective');
    expect(view.statusLabel).toContain('first clear available');
    expect(view.firstClearCoins).toBe(450);

    const cleared = challengeCardView({
      challenge: definition,
      facts,
      cleared: true,
      hasPendingGame: true,
    });
    expect(cleared.nextAction).toBe('edit-team');
    expect(cleared.statusLabel).toContain('First clear claimed');
  });
});

describe('challenge reward preview', () => {
  it('separates first clear and repeat rewards', () => {
    const preview = challengeRewardPreview(challengeDefinition(), false);
    expect(preview.firstClearCoins).toBe(450);
    expect(preview.repeatWinCoins).toBe(45);
    expect(preview.rows[0]?.coins).toBe(450);
    expect(preview.rows[0]?.detail).toContain('fixed by the challenge');

    const cleared = challengeRewardPreview(challengeDefinition(), true);
    expect(cleared.firstClearCoins).toBe(0);
    expect(cleared.rows[0]?.coins).toBe(0);
    expect(cleared.rows[0]?.label).toContain('claimed');
  });
});

describe('set progress views', () => {
  const catalog = buildCollectionFixtureCatalog();
  const reward: CollectionSetRewardDefinition = {
    setRewardVersion: 'collection-set-reward-v1',
    setId: 'sharpshooter-set',
    title: 'Fixture Sharpshooters',
    memberCardIds: [...(catalog.sets[0]?.memberCardIds ?? [])].sort(),
    currency: 'Exchange',
    amount: 2000,
    description: 'Two fixture guards.',
  };

  it('reports owned counts and missing members', () => {
    const memberIds = reward.memberCardIds;
    const view = setProgressView({
      reward,
      catalog,
      ownedCardIds: new Set(memberIds.slice(0, 1)),
      claimed: false,
    });
    expect(view.ownedCount).toBe(1);
    expect(view.requiredCount).toBe(memberIds.length);
    expect(view.missingCardIds).toEqual(memberIds.slice(1));
    expect(view.complete).toBe(false);
    expect(view.amount).toBe(2000);
    expect(view.currency).toBe('Exchange');
  });

  it('marks complete and claimed sets', () => {
    const progression = progressionWith([challengeDefinition()], [reward]);
    const views = setProgressViews({
      progression,
      catalog,
      ownedCardIds: new Set(reward.memberCardIds),
      claimedSetIds: [reward.setId],
    });
    expect(views).toHaveLength(1);
    expect(views[0]?.complete).toBe(true);
    expect(views[0]?.claimed).toBe(true);
  });
});
