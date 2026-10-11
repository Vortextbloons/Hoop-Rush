import {
  franchiseIdSchema,
  postseasonPhaseOfGameId,
  type SeasonLeague,
  type SeasonPostseasonState,
  type SeasonRunStage,
  type SeasonStandings,
} from '@hoop-rush/data-contracts';
import { franchisesInConference } from '../league.ts';
import { applyPlayoffGameResult, createSeasonPlayoffBracket } from './bracket.ts';
import { CONFERENCES } from './constants.ts';
import { SeasonPostseasonInvariantError } from './errors.ts';
import { applyPlayInGameResult } from './play-in.ts';
import type { SeasonPostseasonGameFacts, SeasonPostseasonRankings } from './types.ts';

export function seasonPostseasonSetRankings(
  state: SeasonPostseasonState,
  league: SeasonLeague,
  rankings: SeasonPostseasonRankings,
): SeasonPostseasonState {
  const playIn = { ...state.playIn };
  for (const conference of CONFERENCES) {
    const current = state.playIn[conference];
    if (current.ranking !== null) {
      throw new SeasonPostseasonInvariantError(`${conference} play-in rankings are already set`);
    }
    const ids = [...rankings[conference]].map((id) => franchiseIdSchema.parse(id));
    if (ids.length !== 10 || new Set(ids).size !== 10) {
      throw new SeasonPostseasonInvariantError(
        `${conference} rankings must contain exactly ten unique teams`,
      );
    }
    const conferenceTeams = new Set(franchisesInConference(league, conference));
    for (const id of ids) {
      if (!conferenceTeams.has(id)) {
        throw new SeasonPostseasonInvariantError(
          `ranking team ${id} is not in the ${conference} conference`,
        );
      }
    }
    playIn[conference] = { ...current, ranking: ids };
  }
  return { ...state, playIn };
}
export function seasonPostseasonApplyGameResult(
  state: SeasonPostseasonState,
  facts: SeasonPostseasonGameFacts,
  league: SeasonLeague,
  standings: SeasonStandings,
): SeasonPostseasonState {
  if (postseasonPhaseOfGameId(facts.gameId) === 'play-in') {
    let next = applyPlayInGameResult(state, facts);
    if (
      next.playIn.east.playoffSeeds !== null &&
      next.playIn.west.playoffSeeds !== null &&
      next.bracket === null
    ) {
      next = createSeasonPlayoffBracket(next);
    }
    return next;
  }
  return applyPlayoffGameResult(state, facts, league, standings);
}
export function seasonPostseasonStageOf(state: SeasonPostseasonState): SeasonRunStage {
  if (state.championFranchiseId !== null) return 'completed';
  return state.bracket === null ? 'play-in' : 'playoffs';
}
