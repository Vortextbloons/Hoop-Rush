import { describe, expect, it } from 'vitest';
import {
  collectionGameRewardReceiptSchema,
  collectionScaleRewardCoins,
  type CollectionDifficultyId,
  type CollectionGameRewardReceipt,
  type CollectionGameResult,
} from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE } from '@hoop-rush/test-fixtures';
import { simulateCollectionGame } from './game.ts';
import { evaluateCollectionObjective } from './objectives.ts';
import { collectionGameRewardReceiptFor, collectionRewardTransactionId } from './rewards.ts';
import { prepareV2Fixture, withSelectedObjective } from './v2-fixtures.ts';

type CompletedResult = Extract<CollectionGameResult, { outcome: 'completed' }>;

interface ReceiptScenario {
  difficultyId: CollectionDifficultyId;
  winner: 'home' | 'away';
  margin: number;
  objectiveMade: number;
  firstClearEligible: boolean;
}

function receiptFor(scenario: ReceiptScenario): CollectionGameRewardReceipt {
  const { prepared, catalog } = prepareV2Fixture({
    difficultyId: scenario.difficultyId,
    clearedDifficultyIds: scenario.firstClearEligible ? [] : [scenario.difficultyId],
  });
  const selected = withSelectedObjective(prepared, 'obj-three-barrage-v1');
  const simulation = simulateCollectionGame(selected, catalog, DEFAULT_ERA_SIM_PROFILE);
  if (simulation.result.outcome !== 'completed') throw new Error('expected completed');
  const result = structuredClone(simulation.result) as unknown as {
    winner: 'home' | 'away';
    home: { score: number; box: { threes: { made: number } } };
    away: { score: number };
  };
  const awayScore = 100;
  const homeScore =
    scenario.winner === 'home' ? awayScore + scenario.margin : awayScore - scenario.margin;
  result.winner = scenario.winner;
  result.home.score = homeScore;
  result.away.score = awayScore;
  result.home.box.threes.made = scenario.objectiveMade;
  const completed = result as unknown as CompletedResult;
  const evaluation = evaluateCollectionObjective({ prepared: selected, result: completed });
  return collectionGameRewardReceiptFor({
    gameId: selected.gameId,
    prepared: selected,
    result: completed,
    evaluation,
  });
}

function componentAmounts(receipt: CollectionGameRewardReceipt): Record<string, number> {
  const amounts: Record<string, number> = {};
  for (const component of receipt.components) amounts[component.kind] = component.amount;
  return amounts;
}

describe('collection game rewards', () => {
  it('scales each component independently with half-up rounding', () => {
    const street = receiptFor({
      difficultyId: 'street',
      winner: 'home',
      margin: 21,
      objectiveMade: 13,
      firstClearEligible: false,
    });
    expect(componentAmounts(street)).toEqual({ outcome: 100, objective: 30, margin: 20 });
    expect(street.total).toBe(150);

    const pro = receiptFor({
      difficultyId: 'pro',
      winner: 'home',
      margin: 21,
      objectiveMade: 13,
      firstClearEligible: false,
    });
    expect(componentAmounts(pro)).toEqual({ outcome: 135, objective: 41, margin: 27 });
    expect(pro.total).toBe(203);

    const legend = receiptFor({
      difficultyId: 'legend',
      winner: 'home',
      margin: 21,
      objectiveMade: 13,
      firstClearEligible: false,
    });
    expect(componentAmounts(legend)).toEqual({ outcome: 175, objective: 53, margin: 35 });
    expect(legend.total).toBe(263);
  });

  it('caps the margin at twenty points and omits zero components', () => {
    const capped = receiptFor({
      difficultyId: 'street',
      winner: 'home',
      margin: 21,
      objectiveMade: 0,
      firstClearEligible: false,
    });
    expect(componentAmounts(capped).margin).toBe(20);
    const exact = receiptFor({
      difficultyId: 'street',
      winner: 'home',
      margin: 20,
      objectiveMade: 0,
      firstClearEligible: false,
    });
    expect(componentAmounts(exact).margin).toBe(20);
    const small = receiptFor({
      difficultyId: 'street',
      winner: 'home',
      margin: 5,
      objectiveMade: 0,
      firstClearEligible: false,
    });
    expect(componentAmounts(small).margin).toBe(5);
    expect(componentAmounts(small).objective).toBeUndefined();
  });

  it('pays a successful objective on a loss but keeps it below the base win', () => {
    const pro = receiptFor({
      difficultyId: 'pro',
      winner: 'away',
      margin: 4,
      objectiveMade: 13,
      firstClearEligible: false,
    });
    expect(componentAmounts(pro)).toEqual({ outcome: 14, objective: 41 });
    expect(pro.total).toBe(55);
    expect(pro.total).toBeLessThan(collectionScaleRewardCoins(100, 13_500));
    expect(componentAmounts(pro).margin).toBeUndefined();
    expect(pro.firstClearGranted).toBe(false);
  });

  it('grants the fixed first-clear bonus once and only to eligible wins', () => {
    const eligible = receiptFor({
      difficultyId: 'legend',
      winner: 'home',
      margin: 1,
      objectiveMade: 0,
      firstClearEligible: true,
    });
    expect(componentAmounts(eligible)['first-clear']).toBe(500);
    expect(eligible.total).toBe(175 + 2 + 500);
    expect(
      eligible.components.find((component) => component.kind === 'first-clear')?.multiplierBp,
    ).toBe(10_000);

    const ineligible = receiptFor({
      difficultyId: 'legend',
      winner: 'home',
      margin: 1,
      objectiveMade: 0,
      firstClearEligible: false,
    });
    expect(componentAmounts(ineligible)['first-clear']).toBeUndefined();
    expect(ineligible.total).toBe(175 + 2);

    const loss = receiptFor({
      difficultyId: 'street',
      winner: 'away',
      margin: 2,
      objectiveMade: 0,
      firstClearEligible: true,
    });
    expect(componentAmounts(loss)['first-clear']).toBeUndefined();
    expect(loss.total).toBe(10);
  });

  it('pays only the outcome base for a forfeit', () => {
    const { prepared, catalog } = prepareV2Fixture({ difficultyId: 'pro' });
    const selected = withSelectedObjective(prepared, 'obj-three-barrage-v1');
    const simulation = simulateCollectionGame(selected, catalog, DEFAULT_ERA_SIM_PROFILE);
    if (simulation.result.outcome !== 'completed') throw new Error('expected completed');
    const forfeit = {
      ...simulation.result,
      outcome: 'forfeit',
      losingTeamId: 'collection-player',
      trigger: 'no-legal-five-after-removal',
      homeScore: 0,
      awayScore: 2,
      winner: 'away',
    } as unknown as CollectionGameResult;
    const evaluation = evaluateCollectionObjective({ prepared: selected, result: forfeit });
    const receipt = collectionGameRewardReceiptFor({
      gameId: selected.gameId,
      prepared: selected,
      result: forfeit,
      evaluation,
    });
    expect(receipt.gameOutcome).toBe('forfeit');
    expect(componentAmounts(receipt)).toEqual({ outcome: 14 });
    expect(receipt.total).toBe(14);
    expect(receipt.scoreMargin).toBeNull();

    const cpuForfeit = {
      ...forfeit,
      losingTeamId: 'collection-cpu',
      homeScore: 2,
      awayScore: 0,
      winner: 'home',
    } as unknown as CollectionGameResult;
    const cpuEvaluation = evaluateCollectionObjective({
      prepared: selected,
      result: cpuForfeit,
    });
    const cpuReceipt = collectionGameRewardReceiptFor({
      gameId: selected.gameId,
      prepared: selected,
      result: cpuForfeit,
      evaluation: cpuEvaluation,
    });
    expect(componentAmounts(cpuReceipt)).toEqual({ outcome: 135 });
    expect(cpuReceipt.total).toBe(135);
  });

  it('derives deterministic unique transaction ids per component', () => {
    const receipt = receiptFor({
      difficultyId: 'pro',
      winner: 'home',
      margin: 10,
      objectiveMade: 13,
      firstClearEligible: true,
    });
    const again = receiptFor({
      difficultyId: 'pro',
      winner: 'home',
      margin: 10,
      objectiveMade: 13,
      firstClearEligible: true,
    });
    expect(again).toEqual(receipt);
    const ids = receipt.components.map((component) => component.transactionId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(collectionRewardTransactionId('game-x', 'collection-reward-v2', 'outcome')).toBe(
      collectionRewardTransactionId('game-x', 'collection-reward-v2', 'outcome'),
    );
    expect(collectionRewardTransactionId('game-x', 'collection-reward-v2', 'outcome')).not.toBe(
      collectionRewardTransactionId('game-x', 'collection-reward-v2', 'margin'),
    );
    expect(collectionRewardTransactionId('game-x', 'collection-reward-v2', 'outcome')).not.toBe(
      collectionRewardTransactionId('game-y', 'collection-reward-v2', 'outcome'),
    );
  });

  it('rejects tampered receipts', () => {
    const receipt = receiptFor({
      difficultyId: 'street',
      winner: 'home',
      margin: 5,
      objectiveMade: 13,
      firstClearEligible: false,
    });
    expect(() =>
      collectionGameRewardReceiptSchema.parse({ ...receipt, total: receipt.total + 1 }),
    ).toThrow();
    expect(() =>
      collectionGameRewardReceiptSchema.parse({
        ...receipt,
        components: receipt.components.map((component) =>
          component.kind === 'outcome' ? { ...component, amount: component.amount + 1 } : component,
        ),
      }),
    ).toThrow();
  });
});
