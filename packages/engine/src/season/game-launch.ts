import {
  franchiseIdSchema,
  type EraSimulationProfile,
  type Position,
  type SeasonDraftCatalog,
  type SeasonEvolutionState,
  type SeasonGamePlayerInput,
  type SeasonGameSimulationInput,
  type SeasonRoster,
  type SeasonRotation,
  type Seed,
} from '@hoop-rush/data-contracts';
import { resolveHomeGameRule } from './evolution.ts';
import { SEASON_HOME_COURT_PROFILE } from './home-court.ts';
import { seasonSideOfPlayer, type SeasonInjurySeamEvents } from './injury-events.ts';
export function activeSeasonPlayers(input: {
  roster: SeasonRoster;
  rotation: SeasonRotation;
  expandedPlayer: (playerVersionId: string) => SeasonGamePlayerInput;
}): SeasonGamePlayerInput[] {
  const activeIds = new Set([...input.rotation.starters, ...input.rotation.benchOrder]);
  return input.roster.players
    .filter((player) => activeIds.has(player.playerVersionId))
    .map((player) => input.expandedPlayer(player.playerVersionId));
}
export function positionsOfPlayers(
  players: Iterable<SeasonGamePlayerInput>,
): Map<string, readonly Position[]> {
  const positions = new Map<string, readonly Position[]>();
  for (const player of players) {
    positions.set(player.playerVersionId, player.positions);
  }
  return positions;
}
export function targetMinutesOfRotations(
  rotations: readonly SeasonRotation[],
): Map<string, number> {
  const targets = new Map<string, number>();
  for (const rotation of rotations) {
    for (const entry of rotation.targetMinutes) {
      targets.set(entry.playerVersionId, entry.minutes);
    }
  }
  return targets;
}
export function durabilityByCatalog(catalog: SeasonDraftCatalog): Map<string, number> {
  const ratings = new Map<string, number>();
  for (const candidate of catalog.candidates) {
    ratings.set(candidate.playerVersionId, candidate.durability.rating);
  }
  return ratings;
}
export function buildSeasonGameSimulationInput(input: {
  seed: Seed;
  gameNumber: number;
  dataVersion: string;
  profile: EraSimulationProfile;
  homeFranchiseId: string;
  awayFranchiseId: string;
  homePlayers: readonly SeasonGamePlayerInput[];
  awayPlayers: readonly SeasonGamePlayerInput[];
  homeRotation: SeasonRotation;
  awayRotation: SeasonRotation;
  seam: SeasonInjurySeamEvents & { pregame: ReadonlyMap<string, boolean> };
  homeRoster: SeasonRoster;
  awayRoster: SeasonRoster;
  evolution: SeasonEvolutionState | null | undefined;
  missingSide: (playerVersionId: string) => Error;
}): SeasonGameSimulationInput {
  const allPlayers = [...input.homePlayers, ...input.awayPlayers];
  return {
    schemaVersion: 1,
    seed: input.seed,
    gameNumber: input.gameNumber,
    dataVersion: input.dataVersion,
    profile: input.profile,
    home: {
      teamId: input.homeFranchiseId,
      displayName: input.homeFranchiseId,
      franchiseId: franchiseIdSchema.parse(input.homeFranchiseId),
      players: [...input.homePlayers],
    },
    away: {
      teamId: input.awayFranchiseId,
      displayName: input.awayFranchiseId,
      franchiseId: franchiseIdSchema.parse(input.awayFranchiseId),
      players: [...input.awayPlayers],
    },
    homeRotation: input.homeRotation,
    awayRotation: input.awayRotation,
    availability: allPlayers.map((player) => ({
      playerVersionId: player.playerVersionId,
      available: input.seam.pregame.get(player.playerVersionId) ?? true,
    })),
    removals: input.seam.removals.map((removal) => ({
      side: seasonSideOfPlayer(
        input.homeRoster,
        input.awayRoster,
        removal.playerVersionId,
        input.missingSide,
      ),
      playerVersionId: removal.playerVersionId,
      period: removal.clock.period,
      secondsRemaining: removal.clock.seconds,
      reason: 'injury' as const,
    })),
    returns: input.seam.returns.map((ret) => ({
      side: seasonSideOfPlayer(
        input.homeRoster,
        input.awayRoster,
        ret.playerVersionId,
        input.missingSide,
      ),
      playerVersionId: ret.playerVersionId,
      period: ret.clock.period,
      secondsRemaining: ret.clock.seconds,
      reason: 'injury-return' as const,
    })),
    homeCourt: SEASON_HOME_COURT_PROFILE,
    gameRule: resolveHomeGameRule(input.evolution, input.homeFranchiseId),
  };
}
