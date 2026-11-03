import type {
  CapRushAcceptGameCommand,
  CapRushAcceptLeagueGamesCommand,
  CapRushCommand,
  CapRushDraftState,
  CapRushFinalizeSeasonCommand,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_CONFERENCE_AI_GAMES,
  CAP_RUSH_GAME_COUNT,
  capRushDraftStateSchema,
  capRushEmptyConferencePostseason,
} from '@hoop-rush/data-contracts';
import {
  acceptCapRushCommand,
  rejectCapRushCommand,
  validateRunAndRevision,
  type CapRushCommandEnvironment,
  type CapRushCommandOutcome,
} from './command-outcome.ts';
import { capRushLeagueSlotGames, capRushNextLeagueSlot } from './league-simulation.ts';
import { capRushFoldAggregate } from './season.ts';
export type CapRushSeasonCommand = Extract<
  CapRushCommand,
  { command: 'accept-cap-rush-game' | 'accept-cap-rush-league-games' | 'finalize-cap-rush-season' }
>;
function applyAcceptGame(
  state: CapRushDraftState,
  command: CapRushAcceptGameCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'locked' || state.locked === null) {
    return rejectCapRushCommand(state, command, 'not-locked', 'the lineup is not locked');
  }
  if (state.season.completedAt !== null) {
    return rejectCapRushCommand(
      state,
      command,
      'season-complete',
      'the season is already complete',
    );
  }
  const expected = state.season.games.length + 1;
  if (command.cursor !== expected) {
    return rejectCapRushCommand(
      state,
      command,
      'stale-cursor',
      `game ${String(command.cursor)} cannot be accepted; the next game is ${String(expected)}`,
    );
  }
  if (command.summary.gameNumber !== command.cursor) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'the accepted summary does not describe the cursor game',
    );
  }
  const entry = state.locked.schedule[command.cursor - 1];
  if (entry === undefined || entry.opponentId !== command.summary.opponentId) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'the accepted summary does not match the frozen schedule',
    );
  }
  if (
    command.summary.inputDigest !== command.inputDigest ||
    command.summary.resultDigest !== command.resultDigest
  ) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'the accept envelope digests disagree with the summary digests',
    );
  }
  let leagueGamesAccepted = state.season.leagueGamesAccepted ?? 0;
  if (state.locked.leagueSchedule !== undefined && command.leagueGames !== undefined) {
    const expected = capRushLeagueSlotGames(state.locked, command.cursor);
    const supplied = command.leagueGames ?? [];
    const expectedIds = expected.map((game) => game.gameId).sort();
    const suppliedIds = supplied.map((game) => game.gameId).sort();
    if (
      expectedIds.length !== suppliedIds.length ||
      expectedIds.some((gameId, index) => suppliedIds[index] !== gameId)
    ) {
      return rejectCapRushCommand(
        state,
        command,
        'digest-mismatch',
        'the background league games do not match the accepted slot',
      );
    }
    for (const game of supplied) {
      if (game.slot !== command.cursor) {
        return rejectCapRushCommand(
          state,
          command,
          'digest-mismatch',
          'a background league game belongs to another slot',
        );
      }
    }
    leagueGamesAccepted += supplied.length;
  }
  const aggregate = capRushFoldAggregate(state.season.aggregate, command.summary);
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    season: {
      games: [...state.season.games, command.summary],
      aggregate,
      apronTriggers: {
        isolations: state.season.apronTriggers.isolations + command.isolations,
        strikes: state.season.apronTriggers.strikes + command.strikes,
      },
      completedAt: null,
      ...(state.season.leagueGamesAccepted === undefined ? {} : { leagueGamesAccepted }),
    },
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyAcceptLeagueGames(
  state: CapRushDraftState,
  command: CapRushAcceptLeagueGamesCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'locked' || state.locked === null) {
    return rejectCapRushCommand(state, command, 'not-locked', 'the lineup is not locked');
  }
  if (state.locked.leagueSchedule === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'this run does not use background league games',
    );
  }
  if (state.season.completedAt !== null) {
    return rejectCapRushCommand(
      state,
      command,
      'season-complete',
      'the season is already complete',
    );
  }
  const accepted = state.season.leagueGamesAccepted ?? 0;
  const nextSlot = capRushNextLeagueSlot(state.locked, accepted);
  if (nextSlot === null) {
    return rejectCapRushCommand(
      state,
      command,
      'stale-cursor',
      'all background league games are already accepted',
    );
  }
  if (command.slot !== nextSlot) {
    return rejectCapRushCommand(
      state,
      command,
      'stale-cursor',
      `league slot ${String(command.slot)} cannot be accepted; the next slot is ${String(nextSlot)}`,
    );
  }
  const expected = capRushLeagueSlotGames(state.locked, command.slot);
  const expectedIds = expected.map((game) => game.gameId).sort();
  const suppliedIds = command.leagueGames.map((game) => game.gameId).sort();
  if (
    expectedIds.length !== suppliedIds.length ||
    expectedIds.some((gameId, index) => suppliedIds[index] !== gameId)
  ) {
    return rejectCapRushCommand(
      state,
      command,
      'digest-mismatch',
      'the background league games do not match the accepted slot',
    );
  }
  for (const game of command.leagueGames) {
    if (game.slot !== command.slot) {
      return rejectCapRushCommand(
        state,
        command,
        'digest-mismatch',
        'a background league game belongs to another slot',
      );
    }
  }
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    season: {
      ...state.season,
      leagueGamesAccepted: accepted + expected.length,
    },
  });
  return acceptCapRushCommand(state, command, nextState);
}

function applyFinalizeSeason(
  state: CapRushDraftState,
  command: CapRushFinalizeSeasonCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  const mismatch = validateRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'locked' || state.locked === null) {
    return rejectCapRushCommand(state, command, 'not-locked', 'the lineup is not locked');
  }
  if (state.season.completedAt !== null) {
    return rejectCapRushCommand(
      state,
      command,
      'season-complete',
      'the season is already complete',
    );
  }
  if (state.season.games.length !== CAP_RUSH_GAME_COUNT) {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      `the season has ${String(state.season.games.length)} of ${String(CAP_RUSH_GAME_COUNT)} games`,
    );
  }
  if (
    state.locked.leagueSchedule !== undefined &&
    (state.season.leagueGamesAccepted ?? 0) !== CAP_RUSH_CONFERENCE_AI_GAMES
  ) {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      `the background league has ${String(state.season.leagueGamesAccepted ?? 0)} of ${String(CAP_RUSH_CONFERENCE_AI_GAMES)} games`,
    );
  }
  if (state.postseasonEligible === true && state.locked.leagueSchedule === undefined) {
    return rejectCapRushCommand(
      state,
      command,
      'phase-mismatch',
      'this legacy season is no longer supported',
    );
  }
  const completedAt = environment.nowIso?.() ?? new Date().toISOString();
  const nextState = capRushDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    stage: state.postseasonEligible === true ? 'postseason' : 'completed',
    season: { ...state.season, completedAt },
    ...(state.postseasonEligible === true
      ? {
          postseason: capRushEmptyConferencePostseason(),
        }
      : {}),
  });
  return acceptCapRushCommand(state, command, nextState);
}
export function applyCapRushSeasonCommand(
  state: CapRushDraftState,
  command: CapRushSeasonCommand,
  environment: CapRushCommandEnvironment,
): CapRushCommandOutcome {
  switch (command.command) {
    case 'accept-cap-rush-game':
      return applyAcceptGame(state, command, environment);
    case 'accept-cap-rush-league-games':
      return applyAcceptLeagueGames(state, command, environment);
    case 'finalize-cap-rush-season':
      return applyFinalizeSeason(state, command, environment);
  }
}
