import {
  FULL_COURT_WATCHED_REPLAY_SCHEMA_VERSION,
  fullCourtWatchedReplaySchema,
  type FullCourtWatchedReplay,
  type Id,
  type Seed,
} from '@hoop-rush/data-contracts';
import { buildFullCourtGameReport, type FullCourtGameHealthOutcome } from '@hoop-rush/engine';

export interface FullCourtWatchedReplayRepository {
  load(runId: string): Promise<FullCourtWatchedReplay | null>;
}

export type FullCourtPlayedGameOutcome = Extract<FullCourtGameHealthOutcome, { kind: 'played' }>;

export interface BuildFullCourtWatchedReplayInput {
  readonly phase: 'regular' | 'playoff';
  readonly runId: Id;
  readonly seasonLockDigest: Seed;
  readonly lockDigest: Seed;
  readonly gameId: string;
  readonly slot: number | null;
  readonly dayOffset: number;
  readonly userTeamId: string;
  readonly game: FullCourtPlayedGameOutcome;
}

export function buildFullCourtWatchedReplay(
  input: BuildFullCourtWatchedReplayInput,
): FullCourtWatchedReplay {
  const { game } = input;
  if (game.tape === null || game.tape.length === 0) {
    throw new Error(`Full Court watched replay requires recorded tape for ${input.gameId}`);
  }
  const userSide =
    game.result.home.teamId === input.userTeamId
      ? 'home'
      : game.result.away.teamId === input.userTeamId
        ? 'away'
        : null;
  if (userSide === null) {
    throw new Error(`Full Court watched replay requires user team ${input.userTeamId}`);
  }
  const report = buildFullCourtGameReport({
    kind: 'played',
    gameId: input.gameId,
    userSide,
    result: game.result,
    tape: game.tape,
  });
  if (report.status !== 'played') {
    throw new Error(`Full Court watched replay requires a played report for ${input.gameId}`);
  }
  return fullCourtWatchedReplaySchema.parse({
    schemaVersion: FULL_COURT_WATCHED_REPLAY_SCHEMA_VERSION,
    identity: {
      runId: input.runId,
      phase: input.phase,
      seasonLockDigest: input.seasonLockDigest,
      lockDigest: input.lockDigest,
      gameId: input.gameId,
      slot: input.slot,
      dayOffset: input.dayOffset,
      homeTeamId: game.result.home.teamId,
      awayTeamId: game.result.away.teamId,
      userTeamId: input.userTeamId,
      userSide,
      gameNumber: game.result.gameNumber,
      gameSeed: game.result.seed,
    },
    facts: {
      teamPoints: report.userPoints,
      opponentPoints: report.opponentPoints,
      userWon: report.userWon,
      starterPoints: report.bench.starterPoints,
      benchPoints: report.bench.points,
      teamBonusPoints: report.teamBonusPoints,
      benchPlayerCount: report.bench.players.length,
      lineupCount: report.lineupRows.length,
    },
    health: game.health,
    injuries: game.injuries,
    result: game.result,
    tape: game.tape,
  });
}
