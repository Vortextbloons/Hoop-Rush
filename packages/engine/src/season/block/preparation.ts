import {
  SEASON_FREE_AGENCY_VERSION,
  SEASON_ROSTER_MAX_SIZE,
  SEASON_ROSTER_MIN_SIZE,
  SEASON_TEAM_COUNT,
  normalizeSponsorGearState,
  type SeasonBlockRunContext,
  type SeasonDraftCatalog,
  type SeasonFreeAgencyState,
  type SeasonGamePlayerInput,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import { applySponsorBoosts } from '../sponsors.ts';
import { finishingDemand } from '../../sim/offense.ts';

export function emptyFreeAgencyStateOf(
  run: SeasonRun | SeasonBlockRunContext,
): SeasonFreeAgencyState {
  const franchiseIds = run.league.teams.map((team) => team.franchiseId);
  return {
    schemaVersion: 1,
    freeAgencyVersion: SEASON_FREE_AGENCY_VERSION,
    windows: [],
    canonicalCandidates: {},
    signingCounts: Object.fromEntries(franchiseIds.map((franchiseId) => [franchiseId, 0])),
    seasonSpend: Object.fromEntries(franchiseIds.map((franchiseId) => [franchiseId, 0])),
  };
}

export function expandSeasonRunRosters(
  run: SeasonBlockRunContext,
  catalog: SeasonDraftCatalog,
): Map<string, SeasonGamePlayerInput> {
  const candidates = new Map(
    catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
  );
  const applied = normalizeSponsorGearState(run.sponsors).players.slots;
  const expanded = new Map<string, SeasonGamePlayerInput>();
  for (const roster of run.rosters) {
    for (const player of roster.players) {
      const { playerVersionId } = player;
      if (expanded.has(playerVersionId)) {
        throw new Error(`playerVersionId ${playerVersionId} appears on more than one roster`);
      }
      const candidate = candidates.get(playerVersionId);
      if (candidate === undefined) {
        throw new Error(
          `roster ${roster.franchiseId} references unknown catalog version ${playerVersionId}`,
        );
      }
      expanded.set(playerVersionId, {
        playerVersionId,
        playerId: player.playerId,
        displayName: player.displayName,
        positions: candidate.positions.playable,
        heightInches: candidate.heightInches,
        weightLbs: candidate.weightLbs,
        ratings: applySponsorBoosts(candidate.detailedRatings, applied[playerVersionId]),
        tendencies: candidate.tendencies,
        offensiveLoad: finishingDemand({
          playerId: candidate.playerId,
          displayName: candidate.displayName,
          positions: candidate.positions.playable,
          heightInches: candidate.heightInches,
          weightLbs: candidate.weightLbs,
          ratings: candidate.detailedRatings,
          tendencies: candidate.tendencies,
          anchors: candidate.anchors,
        }),
        stamina: {
          schemaVersion: 1,
          playerVersionId,
          rating: candidate.stamina.rating,
          historicalMpg: candidate.stamina.historicalMpg,
          derivationVersion: candidate.stamina.derivationVersion,
        },
      });
    }
  }
  const minExpanded = SEASON_TEAM_COUNT * SEASON_ROSTER_MIN_SIZE;
  const maxExpanded = SEASON_TEAM_COUNT * SEASON_ROSTER_MAX_SIZE;
  if (expanded.size < minExpanded || expanded.size > maxExpanded) {
    throw new Error(
      `expanded rosters must own between ${String(minExpanded)} and ${String(maxExpanded)} distinct versions (got ${String(expanded.size)})`,
    );
  }
  return expanded;
}
export function rosterPlayerIdsOf(run: SeasonBlockRunContext): Map<string, string> {
  const ids = new Map<string, string>();
  for (const roster of run.rosters) {
    for (const player of roster.players) {
      ids.set(player.playerVersionId, player.playerId);
    }
  }
  return ids;
}
