import type { PeakPlayerSeason, SimulationPlayer } from '@hoop-rush/data-contracts';

export function toSimulationPlayer(player: PeakPlayerSeason): SimulationPlayer {
  return {
    playerId: player.playerId,
    displayName: player.displayName,
    positions: player.positions.playable,
    heightInches: player.heightInches,
    weightLbs: player.weightLbs,
    ratings: player.detailedRatings,
    tendencies: player.tendencies,
    anchors: player.anchors,
    reconstructedThreePoint: player.reconstructedThreePoint,
    overall: player.summaryRatings.overallRating,
    ratingProfile: player.ratingProfile,
  };
}
