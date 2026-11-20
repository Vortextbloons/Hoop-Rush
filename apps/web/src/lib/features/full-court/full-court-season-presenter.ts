import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_PLAYOFF_ROUNDS,
  capRushConferenceRoundName,
  franchiseAbbreviation,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import {
  fullCourtPlayoffView,
  type FullCourtPlayoffSeries,
  type FullCourtSeasonLock,
} from '@hoop-rush/engine';

export type FullCourtPlayoffView = ReturnType<typeof fullCourtPlayoffView>;

export interface FullCourtResultView {
  readonly won: boolean;
  readonly forfeit: boolean;
  readonly doubleForfeit: boolean;
  readonly userPoints: number | null;
  readonly opponentPoints: number | null;
  readonly scoreLabel: string;
  readonly compactLabel: string;
}

export interface FullCourtScheduleCell {
  readonly slot: number;
  readonly gameId: string;
  readonly opponentId: string;
  readonly opponentName: string;
  readonly opponentAbbreviation: string;
  readonly userHome: boolean;
  readonly result: FullCourtResultView | null;
}

export interface FullCourtSeriesGameView extends FullCourtResultView {
  readonly gameId: string;
  readonly gameOrdinal: number;
  readonly userHome: boolean;
}

export interface FullCourtBracketRound {
  readonly round: number;
  readonly label: string;
  readonly series: readonly FullCourtPlayoffSeries[];
}

export interface FullCourtPostseasonStatus {
  readonly headline: string;
  readonly message: string;
}

type ScoreWithOutcome = Pick<FullCourtSeasonScore, 'homeTeamId' | 'awayTeamId' | 'outcome'>;

export function fullCourtResultOf(
  score: ScoreWithOutcome,
  userTeamId: string,
): FullCourtResultView {
  const userHome = score.homeTeamId === userTeamId;
  const userAway = score.awayTeamId === userTeamId;
  if (!userHome && !userAway) {
    throw new Error('Full Court result does not include the user team');
  }
  if (score.outcome.kind === 'played') {
    const userPoints = userHome ? score.outcome.homePoints : score.outcome.awayPoints;
    const opponentPoints = userHome ? score.outcome.awayPoints : score.outcome.homePoints;
    const label = `${String(userPoints)}–${String(opponentPoints)}`;
    return {
      won: userPoints > opponentPoints,
      forfeit: false,
      doubleForfeit: false,
      userPoints,
      opponentPoints,
      scoreLabel: label,
      compactLabel: label,
    };
  }
  const lost = score.outcome.losingSides.includes(userHome ? 'home' : 'away');
  const doubleForfeit = score.outcome.losingSides.length === 2;
  return {
    won: doubleForfeit ? false : !lost,
    forfeit: true,
    doubleForfeit,
    userPoints: null,
    opponentPoints: null,
    scoreLabel: doubleForfeit ? 'Double forfeit' : lost ? 'Forfeit' : 'Opponent forfeit',
    compactLabel: doubleForfeit ? 'DF' : 'FF',
  };
}

export function fullCourtUserSchedule(
  lock: FullCourtSeasonLock,
  scores: readonly FullCourtSeasonScore[],
): FullCourtScheduleCell[] {
  const { userTeamId, teams, games } = lock.season;
  const teamById = new Map(teams.map((team) => [team.teamId, team]));
  const fixtureBySlot = new Map(
    games
      .filter((game) => game.homeTeamId === userTeamId || game.awayTeamId === userTeamId)
      .map((game) => [game.slot, game]),
  );
  const scoreByGame = new Map(
    scores
      .filter((score) => score.homeTeamId === userTeamId || score.awayTeamId === userTeamId)
      .map((score) => [score.gameId, score]),
  );

  return Array.from({ length: CAP_RUSH_CONFERENCE_GAMES_PER_TEAM }, (_, index) => {
    const slot = index + 1;
    const fixture = fixtureBySlot.get(slot);
    if (fixture === undefined) {
      throw new Error(`Full Court schedule is missing user slot ${String(slot)}`);
    }
    const userHome = fixture.homeTeamId === userTeamId;
    const opponentId = userHome ? fixture.awayTeamId : fixture.homeTeamId;
    const opponent = teamById.get(opponentId);
    const score = scoreByGame.get(fixture.gameId) ?? null;
    return {
      slot,
      gameId: fixture.gameId,
      opponentId,
      opponentName: opponent?.displayName ?? opponentId,
      opponentAbbreviation: franchiseAbbreviation(opponentId),
      userHome,
      result: score === null ? null : fullCourtResultOf(score, userTeamId),
    };
  });
}

export function fullCourtPlayoffRounds(
  series: readonly FullCourtPlayoffSeries[],
): FullCourtBracketRound[] {
  return Array.from({ length: CAP_RUSH_PLAYOFF_ROUNDS }, (_, index) => {
    const round = index + 1;
    return {
      round,
      label: capRushConferenceRoundName(round),
      series: series
        .filter((entry) => entry.round === round)
        .sort((left, right) => left.seriesSlot - right.seriesSlot),
    };
  });
}

export function fullCourtUserSeries(
  series: readonly FullCourtPlayoffSeries[],
  userTeamId: string,
): FullCourtPlayoffSeries | null {
  return (
    series
      .filter((entry) => entry.highTeamId === userTeamId || entry.lowTeamId === userTeamId)
      .at(-1) ?? null
  );
}

export function fullCourtSeriesGames(
  series: FullCourtPlayoffSeries,
  userTeamId: string,
): FullCourtSeriesGameView[] {
  return series.games.map((game, index) => {
    const result = fullCourtResultOf(game, userTeamId);
    return {
      gameId: game.gameId,
      gameOrdinal: index + 1,
      ...result,
      userHome: game.homeTeamId === userTeamId,
      won: game.winnerTeamId === userTeamId,
      compactLabel: result.doubleForfeit ? 'Double forfeit' : result.compactLabel,
    };
  });
}

export function fullCourtPlayoffStatus(
  playoff: FullCourtPlayoffView,
  userTeamId: string,
  teamNameOf: (teamId: string) => string,
): FullCourtPostseasonStatus {
  const champion = playoff.championTeamId;
  if (champion === userTeamId) {
    return {
      headline: 'Full Court champions',
      message: 'The bracket is complete. Your season ends with the trophy.',
    };
  }
  const userRound =
    playoff.userOutcome.round === null
      ? null
      : capRushConferenceRoundName(playoff.userOutcome.round).toLowerCase();
  if (champion !== null) {
    const championName = teamNameOf(champion);
    if (playoff.userOutcome.status === 'not-qualified') {
      return {
        headline: `${championName} take the title`,
        message: 'The bracket is complete. You finished outside the top eight.',
      };
    }
    if (playoff.userOutcome.status === 'eliminated') {
      return {
        headline: `${championName} take the title`,
        message: `The bracket is complete. Your run ended in the ${userRound ?? 'playoffs'}.`,
      };
    }
    return {
      headline: `${championName} take the title`,
      message: 'The bracket is complete.',
    };
  }
  if (playoff.userOutcome.status === 'not-qualified') {
    return {
      headline: 'The bracket moves on without you',
      message: 'You finished outside the top eight. The remaining series are finishing.',
    };
  }
  if (playoff.userOutcome.status === 'eliminated') {
    return {
      headline: `Out in the ${userRound ?? 'playoffs'}`,
      message: 'Your run is over. Finish the bracket to crown a champion.',
    };
  }
  if (playoff.userOutcome.status === 'champion') {
    return {
      headline: 'Full Court champions',
      message: 'The title is yours.',
    };
  }
  return {
    headline: 'The postseason is live',
    message: 'One game at a time. Your locked lineup carries into every round.',
  };
}
