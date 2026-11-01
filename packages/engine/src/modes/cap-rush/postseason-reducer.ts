import type {
  CapRushAcceptPlayoffGameCommand,
  CapRushAcceptStandingsCommand,
  CapRushCommand,
  CapRushConferencePostseason,
  CapRushDraftState,
  CapRushFinalizePostseasonCommand,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_CONFERENCE_AI_GAMES,
  CAP_RUSH_CONFERENCE_GAMES,
  CAP_RUSH_GAME_COUNT,
  CAP_RUSH_PLAYOFF_ROUNDS,
  CAP_RUSH_SERIES_GAMES,
  CAP_RUSH_USER_TEAM_ID,
  canonicalJson,
  capRushDraftStateSchema,
  capRushEmptyConferencePostseason,
  capRushLeagueSeed,
  capRushPlayoffGameSeed,
  isConferencePostseason,
} from '@hoop-rush/data-contracts';
import { havocGameResultDigest } from '../havoc/digests.ts';
import {
  acceptCapRushCommand,
  rejectCapRushCommand,
  validateRunAndRevision,
  type CapRushCommandEnvironment,
  type CapRushCommandOutcome,
} from './command-outcome.ts';
import {
  capRushConferenceFinalsMvp,
  capRushConferenceOpeningSeries,
  capRushRefreshConferencePostseason,
} from './conference-postseason.ts';
import { buildCapRushConferenceStandings } from './conference-standings.ts';
import { capRushLeagueFieldOfLocked } from './league-simulation.ts';
import {
  buildCapRushPostseasonStandings,
  capRushFinalsMvp,
  capRushOpeningSeries,
  capRushRefreshPostseason,
  capRushSeriesIsComplete,
} from './postseason.ts';
export type CapRushPostseasonCommand = Extract<
  CapRushCommand,
  {
    command:
      'accept-cap-rush-standings' | 'accept-cap-rush-playoff-game' | 'finalize-cap-rush-postseason';
  }
>;
function applyAcceptStandings(
  state: CapRushDraftState,
  command: CapRushAcceptStandingsCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'postseason' || state.locked === null || state.postseason === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-unavailable',
      'the run is not in its postseason',
    );
  }
  if (state.postseason.phase !== 'awaiting-standings') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'the final standings were already accepted',
    );
  }
  if (state.season.games.length !== CAP_RUSH_GAME_COUNT) {
    return rejectCapRushCommand(
      state,
      command,
      'standings-invalid',
      'the regular season is incomplete',
    );
  }
  if (
    state.locked.leagueSchedule !== undefined &&
    (state.season.leagueGamesAccepted ?? 0) !== CAP_RUSH_CONFERENCE_AI_GAMES
  ) {
    return rejectCapRushCommand(
      state,
      command,
      'standings-invalid',
      'the background league games are incomplete',
    );
  }
  if (command.standings !== undefined) {
    if (state.locked.leagueSchedule === undefined) {
      return rejectCapRushCommand(
        state,
        command,
        'standings-invalid',
        'this run does not use conference standings',
      );
    }
    const standings = command.standings;
    const expectedTeams = new Set<string>([
      state.locked.human.teamId,
      ...state.locked.opponents.map((entry) => entry.team.teamId),
    ]);
    if (standings.games.length !== CAP_RUSH_CONFERENCE_GAMES) {
      return rejectCapRushCommand(
        state,
        command,
        'standings-invalid',
        'the conference standings must cover all 1,230 league games',
      );
    }
    const seen = new Set<string>();
    for (const game of standings.games) {
      if (!expectedTeams.has(game.homeTeamId) || !expectedTeams.has(game.awayTeamId)) {
        return rejectCapRushCommand(
          state,
          command,
          'standings-invalid',
          'the standings reference an unknown team',
        );
      }
      if (seen.has(game.gameId)) {
        return rejectCapRushCommand(
          state,
          command,
          'standings-invalid',
          `the standings repeat game ${game.gameId}`,
        );
      }
      seen.add(game.gameId);
    }
    let recomputed;
    try {
      recomputed = buildCapRushConferenceStandings({
        teams: capRushLeagueFieldOfLocked(state.locked),
        games: standings.games,
      });
    } catch (error) {
      return rejectCapRushCommand(
        state,
        command,
        'standings-invalid',
        error instanceof Error ? error.message : 'the conference standings are invalid',
      );
    }
    if (canonicalJson(recomputed) !== canonicalJson(standings)) {
      return rejectCapRushCommand(
        state,
        command,
        'standings-invalid',
        'the conference standings do not match their accepted results',
      );
    }
    const qualified = standings.qualifiedTeamIds.includes(state.locked.human.teamId);
    const nextState = capRushDraftStateSchema.parse({
      ...state,
      revision: state.revision + 1,
      postseason: capRushRefreshConferencePostseason({
        postseason: {
          ...capRushEmptyConferencePostseason(),
          phase: 'playoffs',
          standings,
          series: capRushConferenceOpeningSeries(standings),
          userOutcome: qualified
            ? { status: 'pending', round: null }
            : { status: 'not-qualified', round: null },
        },
        userTeamId: state.locked.human.teamId,
      }),
    });
    return acceptCapRushCommand(state, command, nextState);
  }
  if (command.league === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'standings-invalid',
      'the command carries no standings',
    );
  }
  if (isConferencePostseason(state.postseason)) {
    return rejectCapRushCommand(
      state,
      command,
      'standings-invalid',
      'conference runs require conference standings',
    );
  }
  if (command.league.league.seed !== capRushLeagueSeed(state.runSeed)) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'the league standings do not carry the locked background seed',
    );
  }
  let standings;
  try {
    standings = buildCapRushPostseasonStandings({
      locked: state.locked,
      league: command.league,
      userGames: state.season.games.map((game) => ({
        opponentId: game.opponentId,
        humanPoints: game.humanPoints,
        opponentPoints: game.opponentPoints,
        won: game.won,
      })),
    });
  } catch (error) {
    return rejectCapRushCommand(
      state,
      command,
      'standings-invalid',
      error instanceof Error ? error.message : 'the league standings are invalid',
    );
  }
  const userEntry = standings.entries.find((entry) => entry.teamId === CAP_RUSH_USER_TEAM_ID);
  const qualified = userEntry?.qualified === true;
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    postseason: capRushRefreshPostseason({
      postseason: {
        ...state.postseason,
        phase: 'playoffs',
        standings,
        series: capRushOpeningSeries(standings),
        userOutcome: qualified
          ? { status: 'pending', round: null }
          : { status: 'not-qualified', round: null },
      },
      userTeamId: state.locked.human.teamId,
    }),
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyAcceptPlayoffGame(
  state: CapRushDraftState,
  command: CapRushAcceptPlayoffGameCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'postseason' || state.locked === null || state.postseason === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-unavailable',
      'the run is not in its postseason',
    );
  }
  if (isConferencePostseason(state.postseason)) {
    return applyAcceptConferencePlayoffGame(state, command, environment, state.postseason);
  }
  if (state.postseason.phase !== 'playoffs') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'the playoff bracket is not open',
    );
  }
  const { game } = command;
  if (!command.audit.ok) {
    return rejectCapRushCommand(state, command, 'digest-mismatch', 'the playoff game audit failed');
  }
  const series = state.postseason.series.find((entry) => entry.seriesId === game.seriesId);
  if (series === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game belongs to an unknown series',
    );
  }
  if (capRushSeriesIsComplete(series)) {
    return rejectCapRushCommand(state, command, 'series-complete', 'the series is already decided');
  }
  if (series.round !== game.round || series.seriesSlot !== game.seriesSlot) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game identity does not match its series',
    );
  }
  const expectedOrdinal = series.games.length + 1;
  if (game.gameOrdinal !== expectedOrdinal || expectedOrdinal > CAP_RUSH_SERIES_GAMES) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      `the series expects game ${String(expectedOrdinal)}`,
    );
  }
  const highHome = [1, 2, 5, 7].includes(expectedOrdinal);
  const expectedHome = highHome ? series.highTeamId : series.lowTeamId;
  const expectedAway = highHome ? series.lowTeamId : series.highTeamId;
  if (game.homeTeamId !== expectedHome || game.awayTeamId !== expectedAway) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game does not follow the bracket home court',
    );
  }
  if (game.homeSeed !== (highHome ? series.highSeed : series.lowSeed)) {
    return rejectCapRushCommand(state, command, 'playoff-mismatch', 'the home seed is wrong');
  }
  if (game.awaySeed !== (highHome ? series.lowSeed : series.highSeed)) {
    return rejectCapRushCommand(state, command, 'playoff-mismatch', 'the away seed is wrong');
  }
  if (
    game.seed !==
    capRushPlayoffGameSeed(state.runSeed, game.round, game.seriesSlot, game.gameOrdinal)
  ) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'the playoff game seed does not match the locked run seed',
    );
  }
  const isUserGame =
    series.highTeamId === state.locked.human.teamId ||
    series.lowTeamId === state.locked.human.teamId;
  if (isUserGame !== (game.userSide !== null)) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game user side does not match the matchup',
    );
  }
  if (isUserGame && command.result === null) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'a user playoff game requires its box score',
    );
  }
  if (command.result !== null) {
    if (
      command.result.home.points !== game.homePoints ||
      command.result.away.points !== game.awayPoints ||
      command.result.home.teamId !== game.homeTeamId ||
      command.result.away.teamId !== game.awayTeamId ||
      command.result.humanSide !== game.userSide ||
      havocGameResultDigest(command.result) !== game.resultDigest
    ) {
      return rejectCapRushCommand(
        state,
        command,
        'digest-mismatch',
        'the playoff box score disagrees with the accepted summary',
      );
    }
  }
  const nextSeries = { ...series, games: [...series.games, game] };
  const updatedPostseason = capRushRefreshPostseason({
    postseason: {
      ...state.postseason,
      series: state.postseason.series.map((entry) =>
        entry.seriesId === series.seriesId ? nextSeries : entry,
      ),
    },
    userTeamId: state.locked.human.teamId,
  });
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    postseason: updatedPostseason,
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyFinalizePostseason(
  state: CapRushDraftState,
  command: CapRushFinalizePostseasonCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'postseason' || state.postseason === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-unavailable',
      'the run is not in its postseason',
    );
  }
  if (isConferencePostseason(state.postseason)) {
    return applyFinalizeConferencePostseason(state, command, environment, state.postseason);
  }
  if (state.postseason.phase !== 'playoffs') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'the playoff bracket is not open',
    );
  }
  if (state.postseason.championTeamId === null) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-complete',
      'the postseason is not finished',
    );
  }
  const finalsSeries = state.postseason.series.find(
    (series) => series.round === CAP_RUSH_PLAYOFF_ROUNDS && series.seriesSlot === 0,
  );
  if (finalsSeries === undefined || !capRushSeriesIsComplete(finalsSeries)) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-complete',
      'the Finals are not finished',
    );
  }
  const finalsMvp = capRushFinalsMvp(state.postseason);
  if (finalsMvp === null) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-complete',
      'the Finals MVP evidence is missing',
    );
  }
  const completedAt = environment.nowIso?.() ?? new Date().toISOString();
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    stage: 'completed',
    postseason: {
      ...state.postseason,
      phase: 'complete',
      finalsMvp,
      completedAt,
    },
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyFinalizeConferencePostseason(
  state: CapRushDraftState,
  command: CapRushFinalizePostseasonCommand,
  environment: CapRushCommandEnvironment,
  postseason: CapRushConferencePostseason,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (postseason.phase !== 'playoffs') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'the playoff bracket is not open',
    );
  }
  if (postseason.championTeamId === null) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-complete',
      'the postseason is not finished',
    );
  }
  const finalsSeries = postseason.series.find(
    (series) => series.round === CAP_RUSH_PLAYOFF_ROUNDS && series.seriesSlot === 0,
  );
  if (finalsSeries === undefined || !capRushSeriesIsComplete(finalsSeries)) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-complete',
      'the Finals are not finished',
    );
  }
  const userTeamId = state.locked?.human.teamId ?? CAP_RUSH_USER_TEAM_ID;
  const finalsMvp = capRushConferenceFinalsMvp(postseason, userTeamId);
  if (finalsMvp === null) {
    return rejectCapRushCommand(
      state,
      command,
      'postseason-complete',
      'the Finals MVP evidence is missing',
    );
  }
  const completedAt = environment.nowIso?.() ?? new Date().toISOString();
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    stage: 'completed',
    postseason: {
      ...postseason,
      phase: 'complete',
      finalsMvp,
      completedAt,
    },
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyAcceptConferencePlayoffGame(
  state: CapRushDraftState,
  command: CapRushAcceptPlayoffGameCommand,
  environment: CapRushCommandEnvironment,
  postseason: CapRushConferencePostseason,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.locked === null) {
    return rejectCapRushCommand(state, command, 'not-locked', 'the lineup is not locked');
  }
  if (postseason.phase !== 'playoffs') {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'the playoff bracket is not open',
    );
  }
  const { game } = command;
  if (!command.audit.ok) {
    return rejectCapRushCommand(state, command, 'digest-mismatch', 'the playoff game audit failed');
  }
  const series = postseason.series.find((entry) => entry.seriesId === game.seriesId);
  if (series === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game belongs to an unknown series',
    );
  }
  if (capRushSeriesIsComplete(series)) {
    return rejectCapRushCommand(state, command, 'series-complete', 'the series is already decided');
  }
  if (series.round !== game.round || series.seriesSlot !== game.seriesSlot) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game identity does not match its series',
    );
  }
  const expectedOrdinal = series.games.length + 1;
  if (game.gameOrdinal !== expectedOrdinal || expectedOrdinal > CAP_RUSH_SERIES_GAMES) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      `the series expects game ${String(expectedOrdinal)}`,
    );
  }
  const highHome = [1, 2, 5, 7].includes(expectedOrdinal);
  const expectedHome = highHome ? series.highTeamId : series.lowTeamId;
  const expectedAway = highHome ? series.lowTeamId : series.highTeamId;
  if (game.homeTeamId !== expectedHome || game.awayTeamId !== expectedAway) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game does not follow the bracket home court',
    );
  }
  if (
    game.homeSeed !== (highHome ? series.highSeed : series.lowSeed) ||
    game.awaySeed !== (highHome ? series.lowSeed : series.highSeed)
  ) {
    return rejectCapRushCommand(state, command, 'playoff-mismatch', 'the game seeds are wrong');
  }
  if (
    game.seed !==
    capRushPlayoffGameSeed(state.runSeed, game.round, game.seriesSlot, game.gameOrdinal)
  ) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'the playoff game seed does not match the locked run seed',
    );
  }
  const isUserGame =
    series.highTeamId === state.locked.human.teamId ||
    series.lowTeamId === state.locked.human.teamId;
  if (isUserGame !== (game.userSide !== null)) {
    return rejectCapRushCommand(
      state,
      command,
      'playoff-mismatch',
      'the playoff game user side does not match the matchup',
    );
  }
  if (isUserGame && command.result === null) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'a user playoff game requires its box score',
    );
  }
  if (command.result !== null) {
    if (
      command.result.home.points !== game.homePoints ||
      command.result.away.points !== game.awayPoints ||
      command.result.home.teamId !== game.homeTeamId ||
      command.result.away.teamId !== game.awayTeamId ||
      command.result.humanSide !== game.userSide ||
      havocGameResultDigest(command.result) !== game.resultDigest
    ) {
      return rejectCapRushCommand(
        state,
        command,
        'digest-mismatch',
        'the playoff box score disagrees with the accepted summary',
      );
    }
  }
  const nextSeries = { ...series, games: [...series.games, game] };
  const updatedPostseason = capRushRefreshConferencePostseason({
    postseason: {
      ...postseason,
      series: postseason.series.map((entry) =>
        entry.seriesId === series.seriesId ? nextSeries : entry,
      ),
    },
    userTeamId: state.locked.human.teamId,
  });
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    postseason: updatedPostseason,
  });
  return acceptCapRushCommand(state, command, nextState);
}
export function applyCapRushPostseasonCommand(
  state: CapRushDraftState,
  command: CapRushPostseasonCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  switch (command.command) {
    case 'accept-cap-rush-standings':
      return applyAcceptStandings(state, command, environment);
    case 'accept-cap-rush-playoff-game':
      return applyAcceptPlayoffGame(state, command, environment);
    case 'finalize-cap-rush-postseason':
      return applyFinalizePostseason(state, command, environment);
  }
}
