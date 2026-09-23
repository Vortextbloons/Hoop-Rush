import type {
  CollectionGameRewardReceiptUnion,
  CollectionObjectiveEvaluation,
  CollectionRewardComponent,
  CollectionRewardReason,
} from '@hoop-rush/data-contracts';
import { formatMultiplier, objectiveConditionLabel } from './collection-setup.ts';

export interface RewardComponentRow {
  kind: CollectionRewardComponent['kind'];
  label: string;
  detail: string;
  amount: number;
}

function componentLabel(
  component: CollectionRewardComponent,
  objectiveTitleOf?: (objectiveId: string) => string | null,
): string {
  switch (component.kind) {
    case 'outcome':
      return component.reason === 'game-win-reward' ? 'Outcome: win' : 'Outcome: loss';
    case 'objective': {
      const title =
        component.objectiveId === undefined
          ? null
          : (objectiveTitleOf?.(component.objectiveId) ?? null);
      return `Objective: ${title ?? component.objectiveId ?? 'selected'}`;
    }
    case 'margin':
      return `Margin: ${String(component.marginPoints ?? component.baseAmount)} points`;
    case 'first-clear':
      return `First clear: ${component.difficultyId ?? 'difficulty'}`;
    case 'challenge-first-clear':
      return 'Challenge first clear';
    case 'challenge-repeat-win':
      return 'Challenge repeat win';
  }
}

export function rewardComponentRows(
  receipt: CollectionGameRewardReceiptUnion,
  objectiveTitleOf?: (objectiveId: string) => string | null,
): RewardComponentRow[] {
  return receipt.components.map((component) => ({
    kind: component.kind,
    label: componentLabel(component, objectiveTitleOf),
    detail:
      component.kind === 'first-clear'
        ? `${String(component.baseAmount)} Coins, not scaled`
        : component.kind === 'challenge-first-clear' || component.kind === 'challenge-repeat-win'
          ? `${String(component.baseAmount)} Coins, fixed by the challenge`
          : `${String(component.baseAmount)} Coins × ${formatMultiplier(component.multiplierBp)}`,
    amount: component.amount,
  }));
}

export function receiptPrimaryReason(
  receipt: CollectionGameRewardReceiptUnion,
): CollectionRewardReason {
  const outcome = receipt.components.find((component) => component.kind === 'outcome');
  if (outcome !== undefined) return outcome.reason;
  return receipt.playerWin ? 'game-win-reward' : 'game-loss-reward';
}

export interface ObjectiveEvaluationView {
  kind: CollectionObjectiveEvaluation['kind'];
  statusLabel: string;
  success: boolean | null;
  actualValue: number | null;
  threshold: number | null;
  conditionLabel: string | null;
  detail: string;
}

export function objectiveEvaluationView(
  evaluation: CollectionObjectiveEvaluation,
  objectiveTitleOf?: (objectiveId: string) => string | null,
): ObjectiveEvaluationView {
  if (evaluation.kind === 'not-selected') {
    return {
      kind: 'not-selected',
      statusLabel: 'No objective',
      success: null,
      actualValue: null,
      threshold: null,
      conditionLabel: null,
      detail: 'No objective was selected, so no objective bonus applied.',
    };
  }
  const title = objectiveTitleOf?.(evaluation.objectiveId) ?? evaluation.objectiveId;
  if (evaluation.kind === 'forfeit') {
    return {
      kind: 'forfeit',
      statusLabel: `${title}: failed`,
      success: false,
      actualValue: null,
      threshold: null,
      conditionLabel: null,
      detail: evaluation.explanation,
    };
  }
  return {
    kind: 'evaluated',
    statusLabel: evaluation.success ? `${title}: passed` : `${title}: failed`,
    success: evaluation.success,
    actualValue: evaluation.actualValue,
    threshold: evaluation.threshold,
    conditionLabel: objectiveConditionLabel(evaluation.condition),
    detail: evaluation.explanation,
  };
}

export interface FirstClearView {
  granted: boolean;
  label: string;
  detail: string;
}

export function firstClearView(receipt: CollectionGameRewardReceiptUnion): FirstClearView {
  if (receipt.firstClearGranted) {
    return {
      granted: true,
      label: 'First clear granted',
      detail: `The first win at ${receipt.difficultyId} paid its fixed bonus.`,
    };
  }
  if (receipt.firstClearEligible) {
    return {
      granted: false,
      label: 'First clear still available',
      detail: `Win at ${receipt.difficultyId} to claim the first-clear bonus.`,
    };
  }
  return {
    granted: false,
    label: 'First clear already claimed',
    detail: `${receipt.difficultyId} was cleared before this game.`,
  };
}

export interface ChallengeRewardView {
  challengeId: string;
  componentKind: 'challenge-first-clear' | 'challenge-repeat-win' | null;
  firstClearGranted: boolean;
  label: string;
  detail: string;
}

export function challengeRewardView(
  receipt: CollectionGameRewardReceiptUnion,
): ChallengeRewardView | null {
  if (receipt.rewardVersion !== 'collection-reward-v3') return null;
  if (receipt.challengeFirstClearGranted) {
    return {
      challengeId: receipt.challengeId,
      componentKind: receipt.challengeComponentKind,
      firstClearGranted: true,
      label: 'Challenge first clear granted',
      detail: 'The first completed win for this challenge paid its fixed first-clear reward.',
    };
  }
  if (receipt.challengeComponentKind === 'challenge-repeat-win') {
    return {
      challengeId: receipt.challengeId,
      componentKind: receipt.challengeComponentKind,
      firstClearGranted: false,
      label: 'Challenge repeat win',
      detail: 'This challenge was already cleared, so the fixed repeat-win reward applied.',
    };
  }
  if (receipt.playerWin && receipt.gameOutcome === 'completed') {
    return {
      challengeId: receipt.challengeId,
      componentKind: null,
      firstClearGranted: false,
      label: 'No challenge reward',
      detail: 'This challenge already recorded a completed win, so no challenge reward applied.',
    };
  }
  return {
    challengeId: receipt.challengeId,
    componentKind: null,
    firstClearGranted: false,
    label: 'No challenge reward',
    detail: 'A challenge reward requires a completed win.',
  };
}
