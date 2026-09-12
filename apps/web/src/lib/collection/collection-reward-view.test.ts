import { describe, expect, it } from 'vitest';
import type {
  CollectionGameRewardReceipt,
  CollectionObjectiveEvaluation,
} from '@hoop-rush/data-contracts';
import {
  firstClearView,
  objectiveEvaluationView,
  receiptPrimaryReason,
  rewardComponentRows,
} from './collection-reward-view.ts';

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
      kind: 'margin',
      reason: 'game-margin-reward',
      currency: 'Coins',
      baseAmount: 20,
      multiplierBp: 13_500,
      amount: 27,
      transactionId: `txn-${'3'.repeat(32)}`,
      marginPoints: 20,
    },
    {
      kind: 'first-clear',
      reason: 'game-first-clear-reward',
      currency: 'Coins',
      baseAmount: 350,
      multiplierBp: 10_000,
      amount: 350,
      transactionId: `txn-${'4'.repeat(32)}`,
      difficultyId: 'pro',
    },
  ],
  total: 553,
} satisfies CollectionGameRewardReceipt;

const titleOf = (objectiveId: string): string | null =>
  objectiveId === 'obj-three-barrage-v1' ? 'Three barrage' : null;

describe('reward component rows', () => {
  it('renders every component with its unscaled base, multiplier, and amount', () => {
    const rows = rewardComponentRows(receipt, titleOf);
    expect(rows.map((row) => row.kind)).toEqual(['outcome', 'objective', 'margin', 'first-clear']);
    expect(rows[0]).toMatchObject({ label: 'Outcome: win', detail: '100 Coins × 1.35×' });
    expect(rows[1]).toMatchObject({ label: 'Objective: Three barrage', amount: 41 });
    expect(rows[2]).toMatchObject({ label: 'Margin: 20 points', amount: 27 });
    expect(rows[3]).toMatchObject({ label: 'First clear: pro', detail: '350 Coins, not scaled' });
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(receipt.total);
  });

  it('falls back to the objective id when no title is supplied', () => {
    const rows = rewardComponentRows(receipt);
    expect(rows[1]?.label).toBe('Objective: obj-three-barrage-v1');
  });

  it('derives the primary ledger reason from the outcome component', () => {
    expect(receiptPrimaryReason(receipt)).toBe('game-win-reward');
    expect(
      receiptPrimaryReason({
        ...receipt,
        playerWin: false,
        components: [
          {
            kind: 'outcome',
            reason: 'game-loss-reward',
            currency: 'Coins',
            baseAmount: 10,
            multiplierBp: 13_500,
            amount: 14,
            transactionId: `txn-${'5'.repeat(32)}`,
          },
        ],
        total: 14,
      }),
    ).toBe('game-loss-reward');
  });
});

describe('objective evaluation views', () => {
  const passed = {
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

  it('shows the recorded actual value and threshold for a pass', () => {
    const view = objectiveEvaluationView(passed, titleOf);
    expect(view).toMatchObject({
      kind: 'evaluated',
      statusLabel: 'Three barrage: passed',
      success: true,
      actualValue: 13,
      threshold: 12,
    });
    expect(view.conditionLabel).toBe('Make at least 12 three-pointers as a team');
  });

  it('shows a boundary failure factually', () => {
    const view = objectiveEvaluationView(
      {
        ...passed,
        actualValue: 11,
        success: false,
        explanation: 'Your team made 11 three-pointers (need 12).',
      },
      titleOf,
    );
    expect(view.statusLabel).toBe('Three barrage: failed');
    expect(view.actualValue).toBe(11);
  });

  it('handles not-selected and forfeit evaluations', () => {
    expect(objectiveEvaluationView({ kind: 'not-selected' })).toMatchObject({
      statusLabel: 'No objective',
      success: null,
    });
    expect(
      objectiveEvaluationView({
        kind: 'forfeit',
        objectiveId: 'obj-own-glass-v1',
        success: false,
        explanation: 'The game ended in a forfeit, so the objective failed.',
      }),
    ).toMatchObject({ kind: 'forfeit', success: false, actualValue: null });
  });
});

describe('first clear views', () => {
  it('distinguishes granted, available, and claimed', () => {
    expect(firstClearView(receipt).granted).toBe(true);
    expect(firstClearView({ ...receipt, firstClearGranted: false }).label).toBe(
      'First clear still available',
    );
    expect(
      firstClearView({
        ...receipt,
        firstClearGranted: false,
        firstClearEligible: false,
      }).label,
    ).toBe('First clear already claimed');
  });
});
