import { describe, expect, it } from 'vitest';
import {
  collectionGameRewardReceiptV2Schema,
  collectionGameRewardReceiptV3Schema,
} from '@hoop-rush/data-contracts';
import {
  challengeRewardView,
  firstClearView,
  receiptPrimaryReason,
  rewardComponentRows,
} from './collection-reward-view';

function txn(seed: string): string {
  return `txn-${seed.repeat(32)}`;
}

const CHALLENGE_ID = 'challenge-franchise-lakers-v1' as const;

function challengeReceipt(input: {
  firstClearGranted: boolean;
  firstClearEligible: boolean;
  componentKind: 'challenge-first-clear' | 'challenge-repeat-win';
}) {
  const challengeComponent = {
    kind: input.componentKind,
    reason:
      input.componentKind === 'challenge-first-clear'
        ? ('challenge-first-clear-reward' as const)
        : ('challenge-repeat-win-reward' as const),
    currency: 'Coins' as const,
    baseAmount: input.componentKind === 'challenge-first-clear' ? 450 : 45,
    multiplierBp: 10_000,
    amount: input.componentKind === 'challenge-first-clear' ? 450 : 45,
    transactionId: txn('2'),
    challengeId: CHALLENGE_ID,
  };
  return collectionGameRewardReceiptV3Schema.parse({
    rewardVersion: 'collection-reward-v3',
    challengeVersion: 'collection-challenge-v1',
    difficultyId: 'pro',
    gameOutcome: 'completed',
    playerWin: true,
    scoreMargin: 5,
    objectiveId: null,
    objectiveSucceeded: false,
    firstClearEligible: false,
    firstClearGranted: false,
    challengeId: CHALLENGE_ID,
    challengeFirstClearEligible: input.firstClearEligible,
    challengeFirstClearGranted: input.firstClearGranted,
    challengeComponentKind: input.componentKind,
    components: [
      {
        kind: 'outcome',
        reason: 'game-win-reward',
        currency: 'Coins',
        baseAmount: 100,
        multiplierBp: 13_000,
        amount: 130,
        transactionId: txn('1'),
      },
      challengeComponent,
    ],
    total: 130 + challengeComponent.amount,
  });
}

describe('rewardComponentRows', () => {
  it('labels challenge components without implying a multiplier', () => {
    const receipt = challengeReceipt({
      firstClearGranted: true,
      firstClearEligible: true,
      componentKind: 'challenge-first-clear',
    });
    const rows = rewardComponentRows(receipt);
    expect(rows).toHaveLength(2);
    const challengeRow = rows.find((row) => row.kind === 'challenge-first-clear');
    expect(challengeRow?.label).toBe('Challenge first clear');
    expect(challengeRow?.detail).toBe('450 Coins, fixed by the challenge');
    expect(challengeRow?.amount).toBe(450);
  });

  it('keeps M4.3 component labels unchanged', () => {
    const receipt = collectionGameRewardReceiptV2Schema.parse({
      rewardVersion: 'collection-reward-v2',
      difficultyId: 'street',
      gameOutcome: 'completed',
      playerWin: true,
      scoreMargin: 5,
      objectiveId: null,
      objectiveSucceeded: false,
      firstClearEligible: true,
      firstClearGranted: true,
      components: [
        {
          kind: 'outcome',
          reason: 'game-win-reward',
          currency: 'Coins',
          baseAmount: 100,
          multiplierBp: 10_000,
          amount: 100,
          transactionId: txn('1'),
        },
        {
          kind: 'first-clear',
          reason: 'game-first-clear-reward',
          currency: 'Coins',
          baseAmount: 200,
          multiplierBp: 10_000,
          amount: 200,
          transactionId: txn('2'),
          difficultyId: 'street',
        },
      ],
      total: 300,
    });
    const rows = rewardComponentRows(receipt);
    expect(rows[0]?.label).toBe('Outcome: win');
    expect(rows[1]?.label).toBe('First clear: street');
    expect(rows[1]?.detail).toBe('200 Coins, not scaled');
  });
});

describe('challengeRewardView', () => {
  it('reports a granted first clear', () => {
    const view = challengeRewardView(
      challengeReceipt({
        firstClearGranted: true,
        firstClearEligible: true,
        componentKind: 'challenge-first-clear',
      }),
    );
    expect(view?.firstClearGranted).toBe(true);
    expect(view?.challengeId).toBe(CHALLENGE_ID);
    expect(view?.detail).toContain('first-clear reward');
  });

  it('reports a repeat win after the first clear', () => {
    const view = challengeRewardView(
      challengeReceipt({
        firstClearGranted: false,
        firstClearEligible: false,
        componentKind: 'challenge-repeat-win',
      }),
    );
    expect(view?.firstClearGranted).toBe(false);
    expect(view?.label).toBe('Challenge repeat win');
    expect(view?.detail).toContain('repeat-win');
  });

  it('returns null for M4.3 receipts', () => {
    const receipt = collectionGameRewardReceiptV2Schema.parse({
      rewardVersion: 'collection-reward-v2',
      difficultyId: 'street',
      gameOutcome: 'completed',
      playerWin: true,
      scoreMargin: 5,
      objectiveId: null,
      objectiveSucceeded: false,
      firstClearEligible: true,
      firstClearGranted: true,
      components: [
        {
          kind: 'outcome',
          reason: 'game-win-reward',
          currency: 'Coins',
          baseAmount: 100,
          multiplierBp: 10_000,
          amount: 100,
          transactionId: txn('1'),
        },
        {
          kind: 'first-clear',
          reason: 'game-first-clear-reward',
          currency: 'Coins',
          baseAmount: 200,
          multiplierBp: 10_000,
          amount: 200,
          transactionId: txn('2'),
          difficultyId: 'street',
        },
      ],
      total: 300,
    });
    expect(challengeRewardView(receipt)).toBeNull();
    expect(firstClearView(receipt).label).toBe('First clear granted');
    expect(receiptPrimaryReason(receipt)).toBe('game-win-reward');
  });
});
