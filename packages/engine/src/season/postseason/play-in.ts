import {
  franchiseIdSchema,
  type ConferenceId,
  type FranchiseId,
  type PlayInGame,
  type PlayInMatchupId,
  type PlayInState,
  type SeasonPostseasonState,
} from '@hoop-rush/data-contracts';
import { SeasonPostseasonInvariantError } from './errors.ts';
import type { SeasonPostseasonGameFacts } from './types.ts';

export function parsePlayInGameId(gameId: string): {
  conference: ConferenceId;
  matchup: PlayInMatchupId;
} | null {
  const match = /^pi-(east|west)-(seven-eight|nine-ten|final)$/.exec(gameId);
  if (match === null) return null;
  const conference = match[1];
  const matchup = match[2];
  if ((conference !== 'east' && conference !== 'west') || matchup === undefined) return null;
  if (matchup !== 'seven-eight' && matchup !== 'nine-ten' && matchup !== 'final') return null;
  return {
    conference,
    matchup,
  };
}
function gameKeyOf(matchup: PlayInMatchupId): 'sevenEight' | 'nineTen' | 'final' {
  if (matchup === 'seven-eight') return 'sevenEight';
  if (matchup === 'nine-ten') return 'nineTen';
  return 'final';
}
export function applyPlayInGameResult(
  state: SeasonPostseasonState,
  facts: SeasonPostseasonGameFacts,
): SeasonPostseasonState {
  const parsed = parsePlayInGameId(facts.gameId);
  if (parsed === null) {
    throw new SeasonPostseasonInvariantError(`malformed play-in game id ${facts.gameId}`);
  }
  const { conference, matchup } = parsed;
  const playIn = state.playIn[conference];
  const key = gameKeyOf(matchup);
  const game = playIn.games[key];
  if (game.status !== 'scheduled') {
    throw new SeasonPostseasonInvariantError(`${facts.gameId} is already resolved`);
  }
  const ranking = playIn.ranking;
  if (ranking === null) {
    throw new SeasonPostseasonInvariantError(`${conference} play-in has no ranking`);
  }
  let homeRaw: string;
  let awayRaw: string;
  if (matchup === 'seven-eight') {
    homeRaw = ranking[6] ?? '';
    awayRaw = ranking[7] ?? '';
  } else if (matchup === 'nine-ten') {
    homeRaw = ranking[8] ?? '';
    awayRaw = ranking[9] ?? '';
  } else {
    const sevenDone = playIn.games.sevenEight.status !== 'scheduled';
    const nineDone = playIn.games.nineTen.status !== 'scheduled';
    if (!sevenDone || !nineDone) {
      throw new SeasonPostseasonInvariantError(
        `${conference} play-in final requires the 7/8 and 9/10 games first`,
      );
    }
    homeRaw = playIn.games.sevenEight.loserFranchiseId ?? '';
    awayRaw = playIn.games.nineTen.winnerFranchiseId ?? '';
  }
  if (homeRaw === '' || awayRaw === '') {
    throw new SeasonPostseasonInvariantError(`${facts.gameId} has no derived matchup`);
  }
  const home = franchiseIdSchema.parse(homeRaw);
  const away = franchiseIdSchema.parse(awayRaw);
  const resolved = resolvePlayInGame(playIn.games[key], home, away, facts);
  const updated = advanceConferencePlayIn({
    ...playIn,
    games: { ...playIn.games, [key]: resolved },
  });
  return { ...state, playIn: { ...state.playIn, [conference]: updated } };
}
function resolvePlayInGame(
  game: PlayInGame,
  home: FranchiseId,
  away: FranchiseId,
  facts: SeasonPostseasonGameFacts,
): PlayInGame {
  const winnerFranchiseId = franchiseIdSchema.parse(facts.winnerFranchiseId);
  const loserFranchiseId = franchiseIdSchema.parse(facts.loserFranchiseId);
  const teams = [home, away];
  if (home === away) {
    throw new SeasonPostseasonInvariantError(
      `play-in game ${facts.gameId} cannot pair a team with itself`,
    );
  }
  if (!teams.includes(winnerFranchiseId) || !teams.includes(loserFranchiseId)) {
    throw new SeasonPostseasonInvariantError(
      `play-in game ${facts.gameId} winner/loser must be participants`,
    );
  }
  if (facts.status === 'final') {
    const homeScore = facts.homeScore;
    const awayScore = facts.awayScore;
    if (homeScore === null || awayScore === null || homeScore === awayScore) {
      throw new SeasonPostseasonInvariantError(
        `play-in game ${facts.gameId} final must carry unequal scores`,
      );
    }
    const homeWon = homeScore > awayScore;
    const expectedWinner = homeWon ? home : away;
    if (winnerFranchiseId !== expectedWinner) {
      throw new SeasonPostseasonInvariantError(
        `play-in game ${facts.gameId} winner must match the score`,
      );
    }
    return {
      gameId: game.gameId,
      status: 'final',
      homeFranchiseId: home,
      awayFranchiseId: away,
      winnerFranchiseId,
      loserFranchiseId,
      homeScore,
      awayScore,
    };
  }
  if (facts.homeScore !== null || facts.awayScore !== null) {
    throw new SeasonPostseasonInvariantError(
      `play-in game ${facts.gameId} forfeit carries no scores`,
    );
  }
  return {
    gameId: game.gameId,
    status: 'forfeit',
    homeFranchiseId: home,
    awayFranchiseId: away,
    winnerFranchiseId,
    loserFranchiseId,
    homeScore: null,
    awayScore: null,
  };
}
function advanceConferencePlayIn(playIn: PlayInState): PlayInState {
  const sevenDone = playIn.games.sevenEight.status !== 'scheduled';
  const nineDone = playIn.games.nineTen.status !== 'scheduled';
  const finalDone = playIn.games.final.status !== 'scheduled';
  if (!sevenDone || !nineDone || !finalDone) return playIn;
  const ranking = playIn.ranking;
  const seedSeven = playIn.games.sevenEight.winnerFranchiseId;
  const seedEight = playIn.games.final.winnerFranchiseId;
  if (ranking === null || seedSeven === null || seedEight === null) {
    throw new SeasonPostseasonInvariantError(
      `${playIn.conference} play-in final resolved without complete winners`,
    );
  }
  return {
    ...playIn,
    playoffSeeds: [...ranking.slice(0, 6), seedSeven, seedEight],
  };
}
