import type { PeakPlayerSeason, SimulationPlayer } from '@hoop-rush/data-contracts';

/**
 * Adapts packaged peak player-seasons to the explicit SimulationPlayer
 * contract at the application boundary (spec/12).
 *
 * Packaging is strict: detailed ratings, tendencies, and simulation anchors
 * are produced at build time and validated against the frozen engine
 * contracts before a pool is advertised. This adapter therefore performs no
 * computation and applies no runtime defaults — an incomplete record fails
 * packaging instead of silently receiving neutral values.
 */

export function toSimulationPlayer(player: PeakPlayerSeason): SimulationPlayer {
  return {
    playerId: player.playerId,
    displayName: player.displayName,
    positions: player.positions.canonical,
    heightInches: player.heightInches,
    weightLbs: player.weightLbs,
    ratings: player.detailedRatings,
    tendencies: player.tendencies,
    anchors: player.anchors,
  };
}
