import {
  collectionGameRewardReceiptV2Schema,
  collectionGameRewardReceiptV3Schema,
  collectionScaleRewardCoins,
  seasonDigestHex,
  COLLECTION_CHALLENGE_REWARD_VERSION,
  COLLECTION_GAME_FIRST_CLEAR_COINS,
  COLLECTION_GAME_REWARD_LOSS_COINS,
  COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS,
  COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT,
  COLLECTION_GAME_REWARD_OBJECTIVE_COINS,
  COLLECTION_GAME_REWARD_WIN_COINS,
  COLLECTION_REWARD_V2_VERSION,
  COLLECTION_REWARD_VERSION,
  type CollectionChallengeEvaluation,
  type CollectionCurrentPreparedGame,
  type CollectionDifficultyId,
  type CollectionGameResultV2,
  type CollectionGameResultV3,
  type CollectionGameRewardReceiptV2,
  type CollectionGameRewardReceiptV3,
  type CollectionObjectiveEvaluation,
  type CollectionObjectiveId,
  type CollectionPreparedGameV3,
  type CollectionRewardComponentV2,
  type CollectionRewardComponent,
  type CollectionRewardComponentKind,
  type CollectionRewardReason,
} from '@hoop-rush/data-contracts';
import { CollectionCommandError } from './packs.ts';

export function collectionRewardTransactionId(
  gameId: string,
  rewardVersion: string,
  kind: string,
): string {
  return `txn-${seasonDigestHex(
    ['collection-reward', gameId, rewardVersion, kind].join('\u0000'),
  )}`;
}

export function collectionChallengeRewardTransactionId(
  gameId: string,
  componentKind: string,
  challengeId: string,
): string {
  return `txn-${seasonDigestHex(
    [
      'collection-challenge-reward',
      gameId,
      COLLECTION_CHALLENGE_REWARD_VERSION,
      componentKind,
      challengeId,
    ].join('\u0000'),
  )}`;
}

function firstClearBonusOf(difficultyId: CollectionDifficultyId): number {
  return COLLECTION_GAME_FIRST_CLEAR_COINS[difficultyId];
}

interface RewardComponentDraft {
  kind: CollectionRewardComponentKind;
  reason: CollectionRewardReason;
  baseAmount: number;
  objectiveId?: CollectionObjectiveId;
  marginPoints?: number;
  difficultyId?: CollectionDifficultyId;
  multiplierBp?: number;
}

interface BaseRewardFacts {
  playerWin: boolean;
  completed: boolean;
  scoreMargin: number | null;
  objectiveSucceeded: boolean;
  objectiveId: CollectionObjectiveId | null;
  firstClearGranted: boolean;
  drafts: RewardComponentDraft[];
}

function collectionBaseRewardFacts(input: {
  prepared: CollectionCurrentPreparedGame;
  result: CollectionGameResultV2 | CollectionGameResultV3;
  evaluation: CollectionObjectiveEvaluation;
}): BaseRewardFacts {
  const { prepared, result, evaluation } = input;
  const playerWin = result.winner === 'home';
  const completed = result.outcome === 'completed';
  const scoreMargin = completed ? Math.abs(result.home.score - result.away.score) : null;
  const drafts: RewardComponentDraft[] = [];
  drafts.push({
    kind: 'outcome',
    reason: playerWin ? 'game-win-reward' : 'game-loss-reward',
    baseAmount: playerWin ? COLLECTION_GAME_REWARD_WIN_COINS : COLLECTION_GAME_REWARD_LOSS_COINS,
  });
  const objectiveSucceeded = evaluation.kind === 'evaluated' && evaluation.success;
  const objectiveId = prepared.objectives.selectedObjectiveId;
  if (objectiveSucceeded && objectiveId !== null) {
    drafts.push({
      kind: 'objective',
      reason: 'game-objective-reward',
      baseAmount: COLLECTION_GAME_REWARD_OBJECTIVE_COINS,
      objectiveId,
    });
  }
  if (completed && playerWin && scoreMargin !== null) {
    const capped = Math.min(scoreMargin, COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS);
    if (capped > 0) {
      drafts.push({
        kind: 'margin',
        reason: 'game-margin-reward',
        baseAmount: capped * COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT,
        marginPoints: capped,
      });
    }
  }
  const firstClearGranted = completed && playerWin && prepared.firstClearEligible;
  if (firstClearGranted) {
    drafts.push({
      kind: 'first-clear',
      reason: 'game-first-clear-reward',
      baseAmount: firstClearBonusOf(prepared.difficulty.difficultyId),
      multiplierBp: 10_000,
      difficultyId: prepared.difficulty.difficultyId,
    });
  }
  return {
    playerWin,
    completed,
    scoreMargin,
    objectiveSucceeded,
    objectiveId,
    firstClearGranted,
    drafts,
  };
}

function componentV2For(
  draft: RewardComponentDraft,
  gameId: string,
  multiplierBp: number,
): CollectionRewardComponentV2 | null {
  if (draft.baseAmount <= 0) return null;
  const basisPoints = draft.multiplierBp ?? multiplierBp;
  const amount = collectionScaleRewardCoins(draft.baseAmount, basisPoints);
  if (amount <= 0) return null;
  return {
    kind: draft.kind as CollectionRewardComponentV2['kind'],
    reason: draft.reason as CollectionRewardComponentV2['reason'],
    currency: 'Coins',
    baseAmount: draft.baseAmount,
    multiplierBp: basisPoints,
    amount,
    transactionId: collectionRewardTransactionId(gameId, COLLECTION_REWARD_V2_VERSION, draft.kind),
    ...(draft.objectiveId !== undefined ? { objectiveId: draft.objectiveId } : {}),
    ...(draft.marginPoints !== undefined ? { marginPoints: draft.marginPoints } : {}),
    ...(draft.difficultyId !== undefined ? { difficultyId: draft.difficultyId } : {}),
  };
}

export function collectionGameRewardReceiptFor(input: {
  gameId: string;
  prepared: CollectionCurrentPreparedGame;
  result: CollectionGameResultV2 | CollectionGameResultV3;
  evaluation: CollectionObjectiveEvaluation;
}): CollectionGameRewardReceiptV2 {
  const facts = collectionBaseRewardFacts(input);
  const multiplierBp = input.prepared.difficulty.rewardMultiplierBp;
  const components: CollectionRewardComponentV2[] = [];
  for (const draft of facts.drafts) {
    const component = componentV2For(draft, input.gameId, multiplierBp);
    if (component !== null) components.push(component);
  }
  const total = components.reduce((sum, component) => sum + component.amount, 0);
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new CollectionCommandError('arithmetic-overflow', 'reward total is not positive');
  }
  try {
    return collectionGameRewardReceiptV2Schema.parse({
      rewardVersion: COLLECTION_REWARD_V2_VERSION,
      difficultyId: input.prepared.difficulty.difficultyId,
      gameOutcome: input.result.outcome,
      playerWin: facts.playerWin,
      scoreMargin: facts.scoreMargin,
      objectiveId: facts.objectiveId,
      objectiveSucceeded: facts.objectiveSucceeded,
      firstClearEligible: input.prepared.firstClearEligible,
      firstClearGranted: facts.firstClearGranted,
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

export function collectionChallengeEvaluationFor(input: {
  prepared: CollectionPreparedGameV3;
  result: CollectionGameResultV2 | CollectionGameResultV3;
}): CollectionChallengeEvaluation {
  const playerWin = input.result.winner === 'home';
  const completed = input.result.outcome === 'completed';
  const firstClearGranted = completed && playerWin && input.prepared.challenge.firstClearEligible;
  return {
    challengeVersion: input.prepared.challenge.challengeVersion,
    challengeId: input.prepared.challenge.challengeId,
    difficultyId: input.prepared.difficulty.difficultyId,
    firstClearEligible: input.prepared.challenge.firstClearEligible,
    firstClearGranted,
    componentKind: firstClearGranted
      ? 'challenge-first-clear'
      : completed && playerWin
        ? 'challenge-repeat-win'
        : null,
  };
}

export function collectionChallengeRewardReceiptFor(input: {
  gameId: string;
  prepared: CollectionCurrentPreparedGame;
  result: CollectionGameResultV2 | CollectionGameResultV3;
  evaluation: CollectionObjectiveEvaluation;
  challengeEvaluation: CollectionChallengeEvaluation;
}): CollectionGameRewardReceiptV3 {
  const prepared = input.prepared;
  if (!('challenge' in prepared)) {
    throw new CollectionCommandError(
      'challenge-reward-divergence',
      'challenge rewards require a prepared challenge game',
    );
  }
  const facts = collectionBaseRewardFacts({
    prepared,
    result: input.result,
    evaluation: input.evaluation,
  });
  const multiplierBp = prepared.difficulty.rewardMultiplierBp;
  const components: CollectionRewardComponent[] = [];
  for (const draft of facts.drafts) {
    if (draft.baseAmount <= 0) continue;
    const basisPoints = draft.multiplierBp ?? multiplierBp;
    const amount = collectionScaleRewardCoins(draft.baseAmount, basisPoints);
    if (amount <= 0) continue;
    components.push({
      kind: draft.kind,
      reason: draft.reason,
      currency: 'Coins',
      baseAmount: draft.baseAmount,
      multiplierBp: basisPoints,
      amount,
      transactionId: collectionRewardTransactionId(
        input.gameId,
        COLLECTION_REWARD_VERSION,
        draft.kind,
      ),
      ...(draft.objectiveId !== undefined ? { objectiveId: draft.objectiveId } : {}),
      ...(draft.marginPoints !== undefined ? { marginPoints: draft.marginPoints } : {}),
      ...(draft.difficultyId !== undefined ? { difficultyId: draft.difficultyId } : {}),
    });
  }
  const challengeFirstClearGranted =
    facts.completed && facts.playerWin && prepared.challenge.firstClearEligible;
  const challengeComponentKind = challengeFirstClearGranted
    ? ('challenge-first-clear' as const)
    : facts.completed && facts.playerWin
      ? ('challenge-repeat-win' as const)
      : null;
  if (challengeComponentKind !== null) {
    const baseAmount = challengeFirstClearGranted
      ? prepared.challenge.firstClearCoins
      : prepared.challenge.repeatWinCoins;
    components.push({
      kind: challengeComponentKind,
      reason:
        challengeComponentKind === 'challenge-first-clear'
          ? 'challenge-first-clear-reward'
          : 'challenge-repeat-win-reward',
      currency: 'Coins',
      baseAmount,
      multiplierBp: 10_000,
      amount: baseAmount,
      transactionId: collectionChallengeRewardTransactionId(
        input.gameId,
        challengeComponentKind,
        prepared.challenge.challengeId,
      ),
      challengeId: prepared.challenge.challengeId,
    });
  }
  const total = components.reduce((sum, component) => sum + component.amount, 0);
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new CollectionCommandError('arithmetic-overflow', 'reward total is not positive');
  }
  try {
    return collectionGameRewardReceiptV3Schema.parse({
      rewardVersion: COLLECTION_REWARD_VERSION,
      challengeVersion: prepared.challenge.challengeVersion,
      difficultyId: prepared.difficulty.difficultyId,
      gameOutcome: input.result.outcome,
      playerWin: facts.playerWin,
      scoreMargin: facts.scoreMargin,
      objectiveId: facts.objectiveId,
      objectiveSucceeded: facts.objectiveSucceeded,
      firstClearEligible: prepared.firstClearEligible,
      firstClearGranted: facts.firstClearGranted,
      challengeId: prepared.challenge.challengeId,
      challengeFirstClearEligible: prepared.challenge.firstClearEligible,
      challengeFirstClearGranted,
      challengeComponentKind,
      components,
      total,
    });
  } catch (error) {
    throw new CollectionCommandError(
      'challenge-reward-divergence',
      error instanceof Error ? error.message : 'challenge reward receipt failed validation',
    );
  }
}
