import type { SimulationPlayer } from '@hoop-rush/data-contracts';
import { creationScore } from '../domain/archetypes.ts';
import type { HavocEvidence } from './havoc-runtime.ts';
import { ENGINE_CONSTANTS } from './constants.ts';

export const OFFENSIVE_ALLOCATION_VERSION = 'offensive-allocation-v1';

export interface FinishingDemand {
  attemptsPer36: number;
  observedAttemptsPer36?: number;
  source: 'observed-attempts' | 'derived-attempts' | 'tendency';
  confidence: number;
}

export function finishingDemand(
  player: SimulationPlayer,
  evidence?: HavocEvidence,
): FinishingDemand {
  const parameters = ENGINE_CONSTANTS.offensiveAllocation;
  const anchors = player.anchors;
  if (
    evidence?.isAuthoritative('offensive-allocation') !== true &&
    player.offensiveLoad !== undefined
  ) {
    return {
      ...player.offensiveLoad,
      attemptsPer36: Math.max(parameters.minimumDemand, player.offensiveLoad.attemptsPer36),
    };
  }
  if (
    evidence?.isAuthoritative('offensive-allocation') !== true &&
    anchors &&
    anchors.minutesPerGame > 0
  ) {
    const observed = anchors.fieldGoalAttemptsPerGame;
    const attempts = observed ?? (player.tendencies.shotRate * 48) / 100;
    const observedAttemptsPer36 = (attempts * 36) / anchors.minutesPerGame;
    const confidence = Math.min(
      1,
      (anchors.gamesPlayed * anchors.minutesPerGame) / parameters.evidenceMinutes,
    );
    const skill =
      (player.ratings.insideScoring +
        player.ratings.midrange +
        player.ratings.threePoint +
        player.ratings.offensiveIq) /
      400;
    const prior = parameters.neutralAttemptsPer36 * (0.5 + 0.5 * skill);
    return {
      attemptsPer36: Math.max(
        parameters.minimumDemand,
        observedAttemptsPer36 * confidence + prior * (1 - confidence),
      ),
      observedAttemptsPer36,
      source: observed === undefined ? 'derived-attempts' : 'observed-attempts',
      confidence,
    };
  }
  return {
    attemptsPer36: Math.max(
      parameters.minimumDemand,
      player.tendencies.shotRate * 0.36 * parameters.fallbackShotWeight +
        player.tendencies.usageRate * 0.5 * (1 - parameters.fallbackShotWeight),
    ),
    source: 'tendency',
    confidence: 0.25,
  };
}

export function creationResponsibility(player: SimulationPlayer): number {
  const style =
    0.5 + (player.tendencies.pickAndRollBallHandlerRate + player.tendencies.isolationRate) / 100;
  const passing = 0.6 + player.tendencies.passRate / 100;
  return Math.max(0.1, creationScore(player) ** 2 * style * passing);
}
