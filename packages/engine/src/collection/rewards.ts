import {
  collectionGameRewardReceiptSchema,
  collectionScaleRewardCoins,
  seasonDigestHex,
  COLLECTION_GAME_FIRST_CLEAR_COINS,
  COLLECTION_GAME_REWARD_LOSS_COINS,
  COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS,
  COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT,
  COLLECTION_GAME_REWARD_OBJECTIVE_COINS,
  COLLECTION_GAME_REWARD_WIN_COINS,
  COLLECTION_REWARD_VERSION,
  type CollectionGameResult,
  type CollectionGameRewardReceipt,
  type CollectionObjectiveEvaluation,
  type CollectionObjectiveId,
  type CollectionPreparedGameV2,
  type CollectionRewardComponent,
  type CollectionRewardComponentKind,
  type CollectionRewardReason,
  type CollectionDifficultyId,
} from '@hoop-rush/data-contracts';
import { CollectionCommandError } from './packs.ts';

export function collectionRewardTransactionId(
  gameId: string,
  rewardVersion: string,
  kind: CollectionRewardComponentKind,
): string {
  return `txn-${seasonDigestHex(
    ['collection-reward', gameId, rewardVersion, kind].join('\u0000'),
  )}`;
}

function firstClearBonusOf(difficultyId: CollectionDifficultyId): number {
  return COLLECTION_GAME_FIRST_CLEAR_COINS[difficultyId];
}

export function collectionGameRewardReceiptFor(input: {
  gameId: string;
  prepared: CollectionPreparedGameV2;
  result: CollectionGameResult;
  evaluation: CollectionObjectiveEvaluation;
}): CollectionGameRewardReceipt {
  const { prepared, result, evaluation } = input;
  const multiplierBp = prepared.difficulty.rewardMultiplierBp;
  const playerWin = result.winner === 'home';
  const completed = result.outcome === 'completed';
  const scoreMargin = completed ? Math.abs(result.home.score - result.away.score) : null;
  const components: CollectionRewardComponent[] = [];
  interface RewardComponentDraft {
    kind: CollectionRewardComponentKind;
    reason: CollectionRewardReason;
    baseAmount: number;
    objectiveId?: CollectionObjectiveId;
    marginPoints?: number;
    difficultyId?: CollectionDifficultyId;
    multiplierBp?: number;
  }
  const push = (component: RewardComponentDraft): void => {
    if (component.baseAmount <= 0) return;
    const basisPoints = component.multiplierBp ?? multiplierBp;
    const amount = collectionScaleRewardCoins(component.baseAmount, basisPoints);
    if (amount <= 0) return;
    components.push({
      ...component,
      currency: 'Coins',
      multiplierBp: basisPoints,
      amount,
      transactionId: collectionRewardTransactionId(
        input.gameId,
        COLLECTION_REWARD_VERSION,
        component.kind,
      ),
    });
  };

  push({
    kind: 'outcome',
    reason: playerWin ? 'game-win-reward' : 'game-loss-reward',
    baseAmount: playerWin ? COLLECTION_GAME_REWARD_WIN_COINS : COLLECTION_GAME_REWARD_LOSS_COINS,
  });
  const objectiveSucceeded = evaluation.kind === 'evaluated' && evaluation.success;
  const objectiveId = prepared.objectives.selectedObjectiveId;
  if (objectiveSucceeded && objectiveId !== null) {
    push({
      kind: 'objective',
      reason: 'game-objective-reward',
      baseAmount: COLLECTION_GAME_REWARD_OBJECTIVE_COINS,
      objectiveId,
    });
  }
  if (completed && playerWin && scoreMargin !== null) {
    const capped = Math.min(scoreMargin, COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS);
    if (capped > 0) {
      push({
        kind: 'margin',
        reason: 'game-margin-reward',
        baseAmount: capped * COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT,
        marginPoints: capped,
      });
    }
  }
  const firstClearGranted = completed && playerWin && prepared.firstClearEligible;
  if (firstClearGranted) {
    push({
      kind: 'first-clear',
      reason: 'game-first-clear-reward',
      baseAmount: firstClearBonusOf(prepared.difficulty.difficultyId),
      multiplierBp: 10_000,
      difficultyId: prepared.difficulty.difficultyId,
    });
  }
  const total = components.reduce((sum, component) => sum + component.amount, 0);
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new CollectionCommandError('arithmetic-overflow', 'reward total is not positive');
  }
  try {
    return collectionGameRewardReceiptSchema.parse({
      rewardVersion: COLLECTION_REWARD_VERSION,
      difficultyId: prepared.difficulty.difficultyId,
      gameOutcome: result.outcome,
      playerWin,
      scoreMargin,
      objectiveId,
      objectiveSucceeded,
      firstClearEligible: prepared.firstClearEligible,
      firstClearGranted,
      components,
      total,
    });
  } catch (error) {
    throw new CollectionCommandError(
      'invalid-reward-facts',
      error instanceof Error ? error.message : 'reward receipt failed validation',
    );
  }
}
