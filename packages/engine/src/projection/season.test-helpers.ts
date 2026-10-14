import type { SeasonDraftCandidate, SimulationPlayer } from '@hoop-rush/data-contracts';

export function candidateToPlayer(candidate: SeasonDraftCandidate): SimulationPlayer {
  return {
    playerId: candidate.playerId,
    playerVersionId: candidate.playerVersionId,
    displayName: candidate.displayName,
    positions: candidate.positions.playable,
    heightInches: candidate.heightInches,
    weightLbs: candidate.weightLbs,
    ratings: candidate.detailedRatings,
    tendencies: candidate.tendencies,
    anchors: candidate.anchors,
    reconstructedThreePoint: candidate.reconstructedThreePoint,
  };
}
