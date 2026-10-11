import {
  franchiseIdSchema,
  parsePlayoffGameId,
  playoffGameIdOf,
  postseasonPhaseOfGameId,
  type SeasonPostseasonState,
} from '@hoop-rush/data-contracts';
import { bracketSeriesOrder, findSeriesOrNull } from './bracket.ts';
import {
  CONFERENCES,
  HOME_COURT_GAMES,
  PLAYOFF_SERIES_IDS,
  POSTSEASON_GAME_ORDER,
} from './constants.ts';
import { SeasonPostseasonInvariantError } from './errors.ts';
import { parsePlayInGameId } from './play-in.ts';

export function seasonPostseasonGameOrdinal(gameId: string): number {
  const index = POSTSEASON_GAME_ORDER.indexOf(gameId);
  if (index === -1) {
    throw new SeasonPostseasonInvariantError(`unknown postseason game ${gameId}`);
  }
  return index + 1;
}
export type SeasonPostseasonNextGame =
  | {
      kind: 'game';
      gameId: string;
    }
  | {
      kind: 'complete';
    }
  | {
      kind: 'integrity-failure';
      reason: string;
    };
export function seasonPostseasonNextGame(state: SeasonPostseasonState): SeasonPostseasonNextGame {
  if (state.bracket === null) {
    for (const conference of CONFERENCES) {
      const playIn = state.playIn[conference];
      const ranking = playIn.ranking;
      if (ranking === null) {
        return {
          kind: 'integrity-failure',
          reason: `${conference} play-in has no ranking`,
        };
      }
      const sevenEight = playIn.games.sevenEight;
      const nineTen = playIn.games.nineTen;
      const final = playIn.games.final;
      if (sevenEight.status === 'scheduled') {
        return { kind: 'game', gameId: sevenEight.gameId };
      }
      if (nineTen.status === 'scheduled') {
        return { kind: 'game', gameId: nineTen.gameId };
      }
      if (final.status === 'scheduled') {
        return { kind: 'game', gameId: final.gameId };
      }
    }
    return {
      kind: 'integrity-failure',
      reason: 'both conferences completed the Play-In without a bracket',
    };
  }
  for (const series of bracketSeriesOrder(state.bracket)) {
    if (series.winnerFranchiseId !== null) continue;
    if (series.homeCourtFranchiseId === null || series.challengerFranchiseId === null) {
      return {
        kind: 'integrity-failure',
        reason: `series ${series.seriesId} is unpaired before its feeders complete`,
      };
    }
    const nextGameNumber = series.games.length + 1;
    if (nextGameNumber > 7) {
      return {
        kind: 'integrity-failure',
        reason: `series ${series.seriesId} exceeds seven games`,
      };
    }
    return { kind: 'game', gameId: playoffGameIdOf(series.seriesId, nextGameNumber) };
  }
  return { kind: 'complete' };
}
export function seasonPostseasonUpcomingGames(state: SeasonPostseasonState): string[] {
  const ids: string[] = [];
  if (state.bracket === null) {
    for (const conference of CONFERENCES) {
      const playIn = state.playIn[conference];
      const sevenDone = playIn.games.sevenEight.status !== 'scheduled';
      const nineDone = playIn.games.nineTen.status !== 'scheduled';
      if (playIn.games.sevenEight.status === 'scheduled') {
        ids.push(playIn.games.sevenEight.gameId);
      }
      if (playIn.games.nineTen.status === 'scheduled') {
        ids.push(playIn.games.nineTen.gameId);
      }
      if (playIn.games.final.status === 'scheduled' && sevenDone && nineDone) {
        ids.push(playIn.games.final.gameId);
      }
    }
    for (const seriesId of PLAYOFF_SERIES_IDS) {
      for (let gameNumber = 1; gameNumber <= 7; gameNumber += 1) {
        ids.push(playoffGameIdOf(seriesId, gameNumber));
      }
    }
    return ids;
  }
  for (const series of bracketSeriesOrder(state.bracket)) {
    if (series.winnerFranchiseId !== null) continue;
    for (let gameNumber = series.games.length + 1; gameNumber <= 7; gameNumber += 1) {
      ids.push(playoffGameIdOf(series.seriesId, gameNumber));
    }
  }
  return ids;
}
export function seasonPostseasonGameTeamsOf(
  state: SeasonPostseasonState,
  gameId: string,
): {
  home: string;
  away: string;
} | null {
  if (postseasonPhaseOfGameId(gameId) === 'play-in') {
    const parsed = parsePlayInGameId(gameId);
    if (parsed === null) return null;
    const { conference, matchup } = parsed;
    const playIn = state.playIn[conference];
    const ranking = playIn.ranking;
    if (ranking === null) return null;
    if (matchup === 'seven-eight') {
      const home = ranking[6];
      const away = ranking[7];
      return home === undefined || away === undefined ? null : { home, away };
    }
    if (matchup === 'nine-ten') {
      const home = ranking[8];
      const away = ranking[9];
      return home === undefined || away === undefined ? null : { home, away };
    }
    if (
      playIn.games.sevenEight.status === 'scheduled' ||
      playIn.games.nineTen.status === 'scheduled'
    ) {
      return null;
    }
    const home = playIn.games.sevenEight.loserFranchiseId;
    const away = playIn.games.nineTen.winnerFranchiseId;
    if (home === null || away === null) return null;
    return { home, away };
  }
  const parsed = parsePlayoffGameId(gameId);
  if (parsed === null) return null;
  const series = findSeriesOrNull(state.bracket, parsed.seriesId);
  if (series === null) return null;
  if (series.winnerFranchiseId !== null) return null;
  if (parsed.gameNumber !== series.games.length + 1) return null;
  const homeCourt = series.homeCourtFranchiseId;
  const challenger = series.challengerFranchiseId;
  if (homeCourt === null || challenger === null) return null;
  const home = HOME_COURT_GAMES.has(parsed.gameNumber) ? homeCourt : challenger;
  const away = home === homeCourt ? challenger : homeCourt;
  return { home, away };
}
export function seasonPostseasonHumanPlaysGame(
  state: SeasonPostseasonState,
  gameId: string,
  humanFranchiseId: string,
): boolean {
  const teams = seasonPostseasonGameTeamsOf(state, gameId);
  return teams !== null && (teams.home === humanFranchiseId || teams.away === humanFranchiseId);
}
export function seasonPostseasonHumanEliminated(
  state: SeasonPostseasonState,
  humanFranchiseId: string,
): boolean {
  const humanId = franchiseIdSchema.parse(humanFranchiseId);
  if (state.championFranchiseId !== null) {
    return state.championFranchiseId !== humanId;
  }
  if (state.bracket === null) {
    for (const conference of CONFERENCES) {
      const playIn = state.playIn[conference];
      const ranking = playIn.ranking;
      if (ranking === null) continue;
      const position = ranking.indexOf(humanId);
      if (position === -1) continue;
      if (position < 6) return false;
      const sevenEight = playIn.games.sevenEight;
      const nineTen = playIn.games.nineTen;
      const final = playIn.games.final;
      const wonAny = [sevenEight, nineTen, final].some(
        (game) => game.status !== 'scheduled' && game.winnerFranchiseId === humanId,
      );
      if (wonAny) return false;
      for (const game of [sevenEight, nineTen, final]) {
        if (game.status !== 'scheduled') continue;
        const teams = seasonPostseasonGameTeamsOf(state, game.gameId);
        if (teams !== null && (teams.home === humanId || teams.away === humanId)) {
          return false;
        }
      }
      if (
        sevenEight.status !== 'scheduled' &&
        sevenEight.loserFranchiseId === humanId &&
        final.status === 'scheduled'
      ) {
        return false;
      }
    }
    return true;
  }
  for (const series of bracketSeriesOrder(state.bracket)) {
    if (series.winnerFranchiseId !== null) continue;
    if (series.homeCourtFranchiseId === humanId || series.challengerFranchiseId === humanId) {
      return false;
    }
  }
  return true;
}
