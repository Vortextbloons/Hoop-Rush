import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_PLAYOFF_ROUNDS,
  CAP_RUSH_PLAYOFF_TEAMS,
  CAP_RUSH_SERIES_GAMES,
  capRushConferenceRoundName,
  capRushSeriesWinner,
  capRushSeriesWins,
  franchiseAbbreviation,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import {
  fullCourtPlayoffView,
  type FullCourtPlayoffSeries,
  type FullCourtSeasonLock,
} from '@hoop-rush/engine';

export type FullCourtPlayoffView = ReturnType<typeof fullCourtPlayoffView>;

/**
 * Parent-owned tab selection. `home` is the matchup-led overview, `league` holds
 * the schedule and standings, and `playoffs` holds the series and bracket.
 */
export type FullCourtSeasonSection = 'home' | 'league' | 'playoffs';

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

export interface FullCourtMatchupSide {
  readonly teamId: string;
  readonly name: string;
  readonly abbreviation: string;
  readonly seed: number | null;
}

export interface FullCourtMatchupSeries {
  readonly userWins: number;
  readonly opponentWins: number;
}

export interface FullCourtMatchupView {
  readonly phase: 'regular' | 'playoff';
  readonly label: string;
  readonly home: FullCourtMatchupSide;
  readonly away: FullCourtMatchupSide;
  readonly userSide: 'home' | 'away' | null;
  readonly series: FullCourtMatchupSeries | null;
}

export type FullCourtHomeActionKind = 'sim' | 'start-playoffs';

export interface FullCourtHomeAction {
  readonly kind: FullCourtHomeActionKind;
  readonly label: string;
  readonly count: number;
}

export interface FullCourtHomeControls {
  readonly primary: FullCourtHomeAction | null;
  readonly secondary: readonly FullCourtHomeAction[];
  readonly status: string;
}

export interface FullCourtSeriesRecapView {
  readonly round: number;
  readonly roundLabel: string;
  readonly opponentId: string;
  readonly opponentName: string;
  readonly won: boolean;
  readonly userWins: number;
  readonly opponentWins: number;
}

export interface FullCourtFinalRecap {
  readonly championTeamId: string;
  readonly championName: string;
  readonly userChampion: boolean;
  readonly seriesWon: number;
  readonly seriesPlayed: number;
  readonly gameWins: number;
  readonly gameLosses: number;
  readonly headline: string;
  readonly message: string;
  readonly series: readonly FullCourtSeriesRecapView[];
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

function sideOf(
  teamId: string,
  teamNameOf: (teamId: string) => string,
  seed: number | null,
): FullCourtMatchupSide {
  return {
    teamId,
    name: teamNameOf(teamId),
    abbreviation: franchiseAbbreviation(teamId),
    seed,
  };
}

/**
 * Next matchup for the home card. It reads the same locked schedule and bracket
 * the engine plays from, so the card never advertises a game the season cannot
 * advance to.
 */
export function fullCourtNextMatchup(
  lock: FullCourtSeasonLock,
  checkpoint: FullCourtSeasonCheckpoint,
  playoff: FullCourtPlayoffView | null,
  teamNameOf: (teamId: string) => string,
): FullCourtMatchupView | null {
  const { userTeamId, games } = lock.season;
  if (playoff !== null) {
    const next = playoff.nextGame;
    if (next !== null) {
      return {
        phase: 'playoff',
        label: `Game ${String(next.gameOrdinal)} · ${capRushConferenceRoundName(next.round)}`,
        home: sideOf(next.homeTeamId, teamNameOf, next.homeSeed),
        away: sideOf(next.awayTeamId, teamNameOf, next.awaySeed),
        userSide: next.homeTeamId === userTeamId ? 'home' : 'away',
        series: null,
      };
    }
    const series = fullCourtUserSeries(playoff.series, userTeamId);
    if (series === null) return null;
    const opponentId = series.highTeamId === userTeamId ? series.lowTeamId : series.highTeamId;
    const userWins = capRushSeriesWins(series, userTeamId);
    const opponentWins = capRushSeriesWins(series, opponentId);
    const decided = capRushSeriesWinner(series) !== null;
    return {
      phase: 'playoff',
      label: decided
        ? `${capRushConferenceRoundName(series.round)} · Series decided`
        : `${capRushConferenceRoundName(series.round)} · Your series`,
      home: sideOf(series.highTeamId, teamNameOf, series.highSeed),
      away: sideOf(series.lowTeamId, teamNameOf, series.lowSeed),
      userSide: series.highTeamId === userTeamId ? 'home' : 'away',
      series: { userWins, opponentWins },
    };
  }
  const slot = Math.min(checkpoint.completedThroughSlot + 1, CAP_RUSH_CONFERENCE_GAMES_PER_TEAM);
  if (checkpoint.completedThroughSlot >= CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) return null;
  const fixture = games.find(
    (game) =>
      game.slot === slot && (game.homeTeamId === userTeamId || game.awayTeamId === userTeamId),
  );
  if (fixture === undefined) return null;
  const homeId = fixture.homeTeamId;
  const awayId = fixture.awayTeamId;
  const userHome = homeId === userTeamId;
  return {
    phase: 'regular',
    label: `Game ${String(slot)} of ${String(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM)}`,
    home: sideOf(homeId, teamNameOf, null),
    away: sideOf(awayId, teamNameOf, null),
    userSide: userHome ? 'home' : 'away',
    series: null,
  };
}

/**
 * The home screen owns the one primary action for the current season state.
 * Regular season sims, the playoff seeding step, forfeit confirmation, and
 * terminal recap are mutually exclusive so the card never offers a stale action.
 */
export function fullCourtHomeControls(input: {
  readonly checkpoint: FullCourtSeasonCheckpoint;
  readonly playoff: FullCourtPlayoffView | null;
  readonly pendingForfeit: boolean;
  readonly busy: boolean;
}): FullCourtHomeControls {
  const { checkpoint, playoff, pendingForfeit, busy } = input;
  const played = Math.min(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM, checkpoint.completedThroughSlot);
  const remaining = CAP_RUSH_CONFERENCE_GAMES_PER_TEAM - played;
  const regularComplete = remaining === 0;
  const sim = (label: string, count: number): FullCourtHomeAction => ({
    kind: 'sim',
    label,
    count,
  });
  const withStatus = (controls: Omit<FullCourtHomeControls, 'status'>, status: string) =>
    busy ? { ...controls, status: 'Simulation in progress…' } : { ...controls, status };
  if (pendingForfeit) {
    return withStatus(
      { primary: null, secondary: [] },
      'The next game cannot continue until the forfeit is accepted.',
    );
  }
  if (playoff !== null) {
    if (playoff.championTeamId !== null || playoff.nextGame === null) {
      return withStatus({ primary: null, secondary: [] }, 'The bracket and champion are saved.');
    }
    const userAlive = playoff.userOutcome.status === 'pending';
    return withStatus(
      {
        primary: sim('Sim next game', 1),
        secondary: [
          userAlive
            ? sim('Sim next five', 5)
            : sim('Sim remaining games', (CAP_RUSH_PLAYOFF_TEAMS - 1) * CAP_RUSH_SERIES_GAMES),
        ],
      },
      'Accepted results save immediately.',
    );
  }
  if (regularComplete) {
    return withStatus(
      {
        primary: {
          kind: 'start-playoffs',
          label: 'Start playoffs',
          count: 0,
        },
        secondary: [],
      },
      'The 82-game regular season is complete. Seed the bracket.',
    );
  }
  return withStatus(
    {
      primary: sim('Sim next game', 1),
      secondary: [
        sim(`Sim ${String(Math.min(5, remaining))}`, Math.min(5, remaining)),
        sim('Sim remaining games', remaining),
      ],
    },
    'One game, five games, or the rest of the regular season.',
  );
}

/** Season-ending recap once a champion exists; the only terminal state in Full Court. */
export function fullCourtFinalRecap(
  lock: FullCourtSeasonLock,
  playoff: FullCourtPlayoffView | null,
  teamNameOf: (teamId: string) => string,
): FullCourtFinalRecap | null {
  if (playoff === null || playoff.championTeamId === null) return null;
  const { userTeamId } = lock.season;
  const championTeamId = playoff.championTeamId;
  const status = fullCourtPlayoffStatus(playoff, userTeamId, teamNameOf);
  const userSeries = playoff.series.filter(
    (entry) => entry.highTeamId === userTeamId || entry.lowTeamId === userTeamId,
  );
  const series: FullCourtSeriesRecapView[] = userSeries.map((entry) => {
    const opponentId = entry.highTeamId === userTeamId ? entry.lowTeamId : entry.highTeamId;
    const winner = capRushSeriesWinner(entry);
    return {
      round: entry.round,
      roundLabel: capRushConferenceRoundName(entry.round),
      opponentId,
      opponentName: teamNameOf(opponentId),
      won: winner === userTeamId,
      userWins: capRushSeriesWins(entry, userTeamId),
      opponentWins: capRushSeriesWins(entry, opponentId),
    };
  });
  const gameWins = series.reduce((total, entry) => total + entry.userWins, 0);
  const gameLosses = series.reduce((total, entry) => total + entry.opponentWins, 0);
  return {
    championTeamId,
    championName: teamNameOf(championTeamId),
    userChampion: championTeamId === userTeamId,
    seriesWon: series.filter((entry) => entry.won).length,
    seriesPlayed: series.length,
    gameWins,
    gameLosses,
    headline: status.headline,
    message: status.message,
    series,
  };
}
