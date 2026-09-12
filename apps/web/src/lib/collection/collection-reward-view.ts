import type {
  CollectionGameRewardReceipt,
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
  }
}

export function rewardComponentRows(
  receipt: CollectionGameRewardReceipt,
  objectiveTitleOf?: (objectiveId: string) => string | null,
): RewardComponentRow[] {
  return receipt.components.map((component) => ({
    kind: component.kind,
    label: componentLabel(component, objectiveTitleOf),
    detail:
      component.kind === 'first-clear'
        ? `${String(component.baseAmount)} Coins, not scaled`
        : `${String(component.baseAmount)} Coins × ${formatMultiplier(component.multiplierBp)}`,
    amount: component.amount,
  }));
}

export function receiptPrimaryReason(receipt: CollectionGameRewardReceipt): CollectionRewardReason {
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

export function firstClearView(receipt: CollectionGameRewardReceipt): FirstClearView {
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
