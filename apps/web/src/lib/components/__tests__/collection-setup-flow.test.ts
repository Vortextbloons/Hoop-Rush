import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import type {
  CollectionCatalog,
  CollectionCatalogCard,
  CollectionGameRewardReceipt,
  CollectionObjectiveEvaluation,
  CollectionObjectiveOffer,
  CollectionRarity,
} from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCollectionDifficultyProfile,
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
  buildCollectionGameRulesFixture,
} from '@hoop-rush/test-fixtures';
import {
  buildCollectionObjectiveFacts,
  collectionObjectiveDefinitionsFromRules,
  initializeCollectionActiveTeam,
  prepareCollectionBasicGameV2,
} from '@hoop-rush/engine';
import DifficultyPicker from '$lib/collection/DifficultyPicker.svelte';
import MatchupReport from '$lib/collection/MatchupReport.svelte';
import ObjectivePicker from '$lib/collection/ObjectivePicker.svelte';
import RewardReceipt from '$lib/collection/RewardReceipt.svelte';
import { difficultyOptionViews, objectiveOptionViews } from '$lib/collection/collection-setup.ts';

const rules = buildCollectionGameRulesFixture();
const difficultyOptions = difficultyOptionViews(rules, []);
const offers: CollectionObjectiveOffer[] = [
  {
    objectiveVersion: 'collection-objectives-v1',
    objectiveId: 'obj-three-barrage-v1',
    title: 'Three barrage',
    condition: { kind: 'player-team-three-pointers-made', threshold: 12 },
  },
  {
    objectiveVersion: 'collection-objectives-v1',
    objectiveId: 'obj-lock-score-v1',
    title: 'Lock the score',
    condition: { kind: 'cpu-team-points-at-most', threshold: 105 },
  },
  {
    objectiveVersion: 'collection-objectives-v1',
    objectiveId: 'obj-ball-pressure-v1',
    title: 'Ball pressure',
    condition: { kind: 'cpu-team-turnovers-at-least', threshold: 14 },
  },
];
const objectiveOptions = objectiveOptionViews({ offers, rules, difficultyId: 'pro' });

describe('difficulty picker', () => {
  it('renders three semantic radio cards with exact facts and reports selection', async () => {
    const onChange = vi.fn();
    const { container } = render(DifficultyPicker, {
      props: { options: difficultyOptions, value: 'street', onChange },
    });
    const fieldset = container.querySelector('fieldset');
    expect(fieldset).not.toBeNull();
    expect(fieldset?.querySelector('legend')?.textContent).toBe('Difficulty');
    const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios).toHaveLength(3);
    expect(radios[0]?.checked).toBe(true);
    expect(container.textContent).toContain('Ember 76% · Eruption 22% · Apex 2%');
    expect(container.textContent).toContain('No CPU rating change');
    expect(container.textContent).toContain('First clear available: +200 Coins');
    expect(container.textContent).toContain('First clear available: +500 Coins');
    await fireEvent.click(radios[2] as HTMLInputElement);
    expect(onChange).toHaveBeenCalledWith('legend');
  });
});

describe('objective picker', () => {
  it('renders No objective plus the seeded offers with the scaled bonus', async () => {
    const onChange = vi.fn();
    const { container } = render(ObjectivePicker, {
      props: { options: objectiveOptions, value: null, onChange },
    });
    const radios = container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    expect(radios).toHaveLength(4);
    expect(radios[0]?.checked).toBe(true);
    expect(container.textContent).toContain('No objective bonus');
    expect(container.textContent).toContain('Hold the CPU to 105 points or fewer');
    expect(container.textContent).toContain('Potential bonus: +41 Coins');
    await fireEvent.click(radios[1] as HTMLInputElement);
    expect(onChange).toHaveBeenCalledWith('obj-three-barrage-v1');
    await fireEvent.click(radios[0] as HTMLInputElement);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('reward receipt', () => {
  it('renders every component, the total, and the new balance', () => {
    const receipt = {
      rewardVersion: 'collection-reward-v2',
      difficultyId: 'pro',
      gameOutcome: 'completed',
      playerWin: true,
      scoreMargin: 24,
      objectiveId: 'obj-three-barrage-v1',
      objectiveSucceeded: true,
      firstClearEligible: true,
      firstClearGranted: true,
      components: [
        {
          kind: 'outcome',
          reason: 'game-win-reward',
          currency: 'Coins',
          baseAmount: 100,
          multiplierBp: 13_500,
          amount: 135,
          transactionId: `txn-${'1'.repeat(32)}`,
        },
        {
          kind: 'objective',
          reason: 'game-objective-reward',
          currency: 'Coins',
          baseAmount: 30,
          multiplierBp: 13_500,
          amount: 41,
          transactionId: `txn-${'2'.repeat(32)}`,
          objectiveId: 'obj-three-barrage-v1',
        },
        {
          kind: 'first-clear',
          reason: 'game-first-clear-reward',
          currency: 'Coins',
          baseAmount: 350,
          multiplierBp: 10_000,
          amount: 350,
          transactionId: `txn-${'3'.repeat(32)}`,
          difficultyId: 'pro',
        },
      ],
      total: 526,
    } satisfies CollectionGameRewardReceipt;
    const evaluation = {
      kind: 'evaluated',
      objectiveId: 'obj-three-barrage-v1',
      condition: { kind: 'player-team-three-pointers-made', threshold: 12 },
      threshold: 12,
      actualValue: 13,
      success: true,
      supportingCardIds: [],
      supportingFacts: [],
      explanation: 'Your team made 13 three-pointers (need 12).',
    } satisfies CollectionObjectiveEvaluation;
    const record = {
      gameVersion: 'collection-game-v2',
      collectionId: 'collection-1',
      gameId: `game-${'a'.repeat(32)}`,
      gameSequence: 0,
      prepared: {},
      result: { outcome: 'completed' },
      events: [],
      eventDigest: '0'.repeat(32),
      resultDigest: '1'.repeat(32),
      objectiveEvaluation: evaluation,
      reward: receipt,
      completedAtIso: '2026-01-01T00:00:00.000Z',
    } as never;
    const { container } = render(RewardReceipt, {
      props: {
        record,
        balances: { Coins: 1026, Exchange: 0 },
        objectiveTitleOf: () => 'Three barrage',
      },
    });
    expect(container.textContent).toContain('Three barrage: passed');
    expect(container.textContent).toContain('Recorded: 13 · Threshold: 12');
    expect(container.textContent).toContain('Outcome: win');
    expect(container.textContent).toContain('First clear: pro');
    expect(container.textContent).toContain('1,026');
    expect(container.textContent).not.toContain('Margin:');
  });
});

function gameCatalog(): CollectionCatalog {
  const rarities: CollectionRarity[] = [
    'Ember',
    'Eruption',
    'Apex',
    'Titan',
    'Eclipse',
    'Immortal',
  ];
  const positions: Array<CollectionCatalogCard['positions']> = [
    ['PG'],
    ['SG'],
    ['SF'],
    ['PF'],
    ['C'],
  ];
  const cards: CollectionCatalogCard[] = [];
  for (let i = 0; i < 36; i += 1) {
    cards.push(
      buildCollectionFixtureCard(`view-${String(i).padStart(2, '0')}`, {
        playerId: `view-${String(i).padStart(2, '0')}` as CollectionCatalogCard['playerId'],
        displayName: `View Card ${String(i).padStart(2, '0')}`,
        positions: positions[i % positions.length] ?? ['PG'],
        rarity: rarities[i % rarities.length] ?? 'Ember',
        summarySource: { overallRating: 60, offenseRating: 60, defenseRating: 60 },
      }),
    );
  }
  return buildCollectionFixtureCatalog({
    cards,
    sets: [
      {
        setId: 'sharpshooter-set',
        title: 'View',
        memberCardIds: [cards[0]?.cardId as string, cards[1]?.cardId as string],
      },
    ],
  });
}

describe('matchup report', () => {
  it('declares difficulty, objective, construction, and exact adjustment facts', () => {
    const catalog = gameCatalog();
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const owned = catalog.cards.slice(0, 6).map((card) => card.cardId);
    const team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
    const facts = buildCollectionObjectiveFacts({
      definitions: collectionObjectiveDefinitionsFromRules(rules),
      rootSeed: '0'.repeat(32),
      difficultyId: 'legend',
      gameSequence: 0,
      team,
      selectedObjectiveId: null,
    });
    const selectedOffer = facts.offers[0];
    if (selectedOffer === undefined) throw new Error('no offers');
    const prepared = prepareCollectionBasicGameV2({
      collectionId: 'collection-1',
      rootSeed: '0'.repeat(32),
      gameSequence: 0,
      ownedCardIds: new Set(owned),
      team,
      catalog,
      difficulty: buildCollectionDifficultyProfile('legend'),
      objectiveDefinitions: collectionObjectiveDefinitionsFromRules(rules),
      selectedObjectiveId: selectedOffer.objectiveId,
      clearedDifficultyIds: [],
      profileVersion: DEFAULT_ERA_SIM_PROFILE.profileVersion,
      profileHash: 'a'.repeat(64),
      catalogHash: 'b'.repeat(64),
      rulesHash: 'c'.repeat(64),
    });
    const { container } = render(MatchupReport, { props: { prepared, catalog } });
    expect(container.textContent).toContain('Legend');
    expect(container.textContent).toContain(selectedOffer.title);
    expect(container.textContent).toContain('12 CPU cards');
    expect(container.textContent).toContain('→');
    const detailRows = container.querySelectorAll('details');
    expect(detailRows.length).toBe(12);
  });
});
