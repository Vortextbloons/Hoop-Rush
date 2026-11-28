import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  capRushConferenceRoundName,
  capRushPlayoffSeriesId,
  type FullCourtCoachingPlan,
  type FullCourtDefensiveMatchupAssignment,
  type FullCourtPlayoffAdaptation,
  type FullCourtPlayoffCheckpoint,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import {
  fullCourtPlayoffView,
  fullCourtUserNextPlayoffMatchup,
  type FullCourtGameHealthOutcome,
  type FullCourtPlayoffLock,
  type FullCourtPlayoffSeries,
  type FullCourtSeasonLock,
  type FullCourtSeasonSlotOptions,
  type FullCourtSeasonSlotOutcome,
} from '@hoop-rush/engine';
import { fullCourtRotationInputForPlan } from './coaching.ts';

export type FullCourtPlayoffView = ReturnType<typeof fullCourtPlayoffView>;
export type FullCourtPlayedGame = Extract<FullCourtGameHealthOutcome, { kind: 'played' }>;

/** Optional interruptions for a regular-season or playoff batch. */
export interface FullCourtAdvanceOptions {
  /** Stop after the first user injury that would affect the next fixture. */
  readonly stopAtInjury?: boolean;
  /** Stop after a scheduled quarterly review slot. */
  readonly stopAtReview?: boolean;
  /** In playoffs, sim through opponent adjustments until the series finishes. */
  readonly ignoreOpponentAdjustment?: boolean;
}

/** Pinned rest and matchup choices captured for the next user fixture. */
export interface FullCourtPinnedGamePlan {
  readonly restGameId: string | null;
  readonly restingPlayerIds: readonly string[];
  readonly matchupGameId: string | null;
  readonly matchupOpponentId: string | null;
  readonly matchupAssignments: readonly FullCourtDefensiveMatchupAssignment[];
}

export interface FullCourtAdvanceSeasonState {
  readonly lock: FullCourtSeasonLock;
  readonly checkpoint: FullCourtSeasonCheckpoint;
  readonly scores: readonly FullCourtSeasonScore[];
  readonly coaching: FullCourtCoachingPlan;
}

export interface FullCourtAdvancePlayoffState {
  readonly lock: FullCourtPlayoffLock;
  readonly checkpoint: FullCourtPlayoffCheckpoint;
  readonly view: FullCourtPlayoffView;
}

export type FullCourtSimulationStop =
  | { readonly kind: 'review'; readonly slot: number }
  | {
      readonly kind: 'injury';
      readonly slot: number;
      readonly playerIds: readonly string[];
      readonly availableFromDay: number;
    }
  | {
      readonly kind: 'series-complete';
      readonly round: number;
      readonly opponentTeamId: string;
      readonly won: boolean;
      readonly userWins: number;
      readonly opponentWins: number;
    }
  | {
      readonly kind: 'opponent-change';
      readonly round: number;
      readonly opponentTeamId: string;
      readonly gameOrdinal: number;
    }
  | {
      readonly kind: 'opponent-adjustment';
      readonly round: number;
      readonly opponentTeamId: string;
      readonly gameOrdinal: number;
      readonly adaptation: FullCourtPlayoffAdaptation;
    }
  | {
      readonly kind: 'game-limit';
      readonly userGames: number;
      readonly bracketGames: number;
    }
  | {
      readonly kind: 'playoffs-complete';
      readonly championTeamId: string;
      readonly userTeamId: string;
    }
  | { readonly kind: 'stopped'; readonly userGames: number; readonly bracketGames: number };

export interface FullCourtUserFixture {
  readonly gameId: string;
  readonly phase: 'regular' | 'playoff';
  readonly label: string;
  readonly dayOffset: number;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly userSide: 'home' | 'away';
}

/** Engine bracket spacing, mirrored here only to label the next user fixture day. */
const FULL_COURT_PLAYOFF_ROUND_GAP_DAYS = 3;
const FULL_COURT_PLAYOFF_GAME_GAP_DAYS = 2;

function fullCourtPlayoffSeriesStartDay(
  lock: FullCourtSeasonLock,
  playoff: FullCourtPlayoffView,
  round: number,
): number | null {
  if (round <= 1) {
    return (
      Math.max(...lock.season.games.map((game) => game.dayOffset)) +
      FULL_COURT_PLAYOFF_ROUND_GAP_DAYS
    );
  }
  const priorGames = playoff.series
    .filter((series) => series.round === round - 1)
    .flatMap((series) => series.games);
  if (priorGames.length === 0) return null;
  return Math.max(...priorGames.map((game) => game.dayOffset)) + FULL_COURT_PLAYOFF_ROUND_GAP_DAYS;
}

function fullCourtPlayoffUserGameDay(
  lock: FullCourtSeasonLock,
  playoff: FullCourtPlayoffView,
  series: FullCourtPlayoffSeries,
  gameOrdinal: number,
): number | null {
  const lastGame = series.games.at(-1);
  if (lastGame !== undefined) {
    return lastGame.dayOffset + FULL_COURT_PLAYOFF_GAME_GAP_DAYS;
  }
  const startDay = fullCourtPlayoffSeriesStartDay(lock, playoff, series.round);
  return startDay === null ? null : startDay + (gameOrdinal - 1) * FULL_COURT_PLAYOFF_GAME_GAP_DAYS;
}

/**
 * The next fixture the user actually plays. Playoff brackets can schedule
 * AI-only games first, so this reads the next user series game rather than the
 * next bracket game.
 */
export function fullCourtNextUserFixture(
  lock: FullCourtSeasonLock,
  checkpoint: FullCourtSeasonCheckpoint,
  playoff: FullCourtPlayoffView | null,
): FullCourtUserFixture | null {
  const { userTeamId } = lock.season;
  if (playoff !== null) {
    const preview = fullCourtUserNextPlayoffMatchup({
      userTeamId,
      runSeed: lock.season.runSeed,
      series: playoff.series,
    });
    if (preview === null) return null;
    const series = playoff.series.find(
      (entry) => entry.seriesId === capRushPlayoffSeriesId(preview.round, preview.seriesSlot),
    );
    if (series === undefined) return null;
    const dayOffset = fullCourtPlayoffUserGameDay(lock, playoff, series, preview.gameOrdinal);
    if (dayOffset === null) return null;
    return {
      gameId: preview.gameId,
      phase: 'playoff',
      label: `Game ${String(preview.gameOrdinal)} · ${capRushConferenceRoundName(preview.round)}`,
      dayOffset,
      homeTeamId: preview.homeTeamId,
      awayTeamId: preview.awayTeamId,
      userSide: preview.userSide,
    };
  }
  if (checkpoint.completedThroughSlot >= CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) return null;
  const slot = checkpoint.completedThroughSlot + 1;
  const fixture = lock.season.games.find(
    (game) =>
      game.slot === slot && (game.homeTeamId === userTeamId || game.awayTeamId === userTeamId),
  );
  if (fixture === undefined) return null;
  return {
    gameId: fixture.gameId,
    phase: 'regular',
    label: `Game ${String(slot)} of ${String(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM)}`,
    dayOffset: fixture.dayOffset,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    userSide: fixture.homeTeamId === userTeamId ? 'home' : 'away',
  };
}

/** Roughly quarterly season reviews use the same committed-game stop path. */
export const FULL_COURT_REVIEW_SLOTS = [20, 41, 61, 82] as const;

export function fullCourtNextReviewSlot(completedThroughSlot: number): number | null {
  return FULL_COURT_REVIEW_SLOTS.find((slot) => slot > completedThroughSlot) ?? null;
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

/** True when the opponent's next-game adjustment is new or has changed setting. */
export function fullCourtPlayoffAdjustmentChanged(
  applied: FullCourtPlayoffAdaptation | null | undefined,
  next: FullCourtPlayoffAdaptation | null | undefined,
): boolean {
  return next !== null && next !== undefined && (applied?.defense ?? null) !== next.defense;
}

export function fullCourtRegularSeasonInjuryStop(
  outcome: Extract<FullCourtSeasonSlotOutcome, { kind: 'simulated' }>,
  lock: FullCourtSeasonLock,
): FullCourtSimulationStop | null {
  if (outcome.userGame.kind !== 'played') return null;
  const userTeamId = lock.season.userTeamId;
  const injuries = outcome.userGame.injuries.filter((injury) => injury.teamId === userTeamId);
  if (injuries.length === 0) return null;
  const nextFixture = fullCourtNextUserFixture(lock, outcome.checkpoint, null);
  const actionable = injuries.filter(
    (injury) => nextFixture === null || injury.availableFromDay > nextFixture.dayOffset,
  );
  if (actionable.length === 0) return null;
  return {
    kind: 'injury',
    slot: outcome.checkpoint.completedThroughSlot,
    playerIds: [...new Set(actionable.map((injury) => injury.playerId))],
    availableFromDay: Math.max(...actionable.map((injury) => injury.availableFromDay)),
  };
}

/** Pinned choices apply only to the fixture they were captured for. */
export function fullCourtSlotOptions(input: {
  readonly coaching: FullCourtCoachingPlan;
  readonly pinned: FullCourtPinnedGamePlan;
  readonly userGameId: string | null;
  readonly acceptForfeit: boolean;
  readonly record: boolean;
}): FullCourtSeasonSlotOptions {
  const { coaching, pinned, userGameId } = input;
  const matchupGameId = pinned.matchupGameId;
  const matchupOpponentId = pinned.matchupOpponentId;
  return {
    acceptForfeit: input.acceptForfeit,
    rotation: fullCourtRotationInputForPlan(coaching),
    tactics: coaching.tactics,
    rules: coaching.rules,
    hierarchy: coaching.hierarchy,
    record: input.record,
    ...(pinned.restGameId !== null &&
    pinned.restGameId === userGameId &&
    pinned.restingPlayerIds.length > 0
      ? { restingPlayerIds: pinned.restingPlayerIds }
      : {}),
    ...(matchupGameId !== null &&
    matchupOpponentId !== null &&
    matchupGameId === userGameId &&
    pinned.matchupAssignments.length > 0
      ? {
          defensiveMatchups: {
            gameId: matchupGameId,
            opponentTeamId: matchupOpponentId,
            assignments: [...pinned.matchupAssignments],
          },
        }
      : {}),
  };
}
