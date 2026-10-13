import type {
  SeasonBlockChallengeEvaluation,
  SeasonChallengeDeal,
  SeasonRun,
} from '@hoop-rush/data-contracts';

export interface ChallengesViewModel {
  blockIndex: number | null;
  deal: SeasonChallengeDeal | null;
  evaluation: SeasonBlockChallengeEvaluation | null;
}

export function challengesViewModel(
  run: SeasonRun | null,
  nextBlockIndex: number | null,
): ChallengesViewModel | null {
  if (run === null) return null;
  const challenges = (
    run as unknown as { challenges?: import('@hoop-rush/data-contracts').SeasonChallengeState }
  ).challenges;
  if (challenges === undefined) return null;
  if (nextBlockIndex === null || nextBlockIndex >= 8) {
    const lastEvaluation =
      [...challenges.evaluations].sort((a, b) => b.blockIndex - a.blockIndex)[0] ?? null;
    if (lastEvaluation === null) return { blockIndex: null, deal: null, evaluation: null };
    const deal = challenges.deals[lastEvaluation.blockIndex] ?? null;
    return { blockIndex: lastEvaluation.blockIndex, deal, evaluation: lastEvaluation };
  }
  const deal = challenges.deals[nextBlockIndex] ?? null;
  const evaluation =
    challenges.evaluations.find((entry) => entry.blockIndex === nextBlockIndex) ?? null;
  return { blockIndex: nextBlockIndex, deal, evaluation };
}
