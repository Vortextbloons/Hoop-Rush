import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_PLAYOFF_ROUNDS,
  CAP_RUSH_PLAYOFF_TEAMS,
  CAP_RUSH_SERIES_GAMES,
  capRushConferenceRoundName,
  capRushPlayoffSeriesId,
  capRushSeriesWinner,
  capRushSeriesWins,
  franchiseAbbreviation,
  type FullCourtPlayoffAdaptation,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
  type FullCourtTeamHealth,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import {
  fullCourtPlayoffView,
  fullCourtUserNextPlayoffMatchup,
  type FullCourtPlayoffSeries,
  type FullCourtSeasonLock,
} from '@hoop-rush/engine';

export type FullCourtPlayoffView = ReturnType<typeof fullCourtPlayoffView>;

/**
 * Parent-owned tab selection. `home` is the matchup-led overview, `league` holds
 * the schedule and standings, `stats` holds the honest season sample, and
 * `playoffs` holds the series and bracket.
 */
export type FullCourtSeasonSection = 'home' | 'league' | 'stats' | 'playoffs';

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
  /** The opponent's stored adjustment for this game, when one was applied. */
  readonly opponentAdaptation: FullCourtPlayoffAdaptation | null;
  readonly adjustmentResponse: string | null;
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

/** Optional interruptions for a regular-season batch. */
export interface FullCourtAdvanceOptions {
  /** Stop after the first user injury that would affect the next fixture. */
  readonly stopAtInjury?: boolean;
  /** Stop after a scheduled quarterly review slot. */
  readonly stopAtReview?: boolean;
}

export interface FullCourtHomeAction extends FullCourtAdvanceOptions {
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
    const userHome = game.homeTeamId === userTeamId;
    const opponentSide = userHome ? 'away' : 'home';
    const opponentAdaptation = game.adaptations?.[opponentSide] ?? null;
    const evidence = game.evidence?.[userHome ? 'home' : 'away'];
    let adjustmentResponse: string | null = null;
    if (opponentAdaptation !== null && evidence !== undefined) {
      const inside = opponentAdaptation.reason === 'persistent-inside-scoring';
      const basisPoints = inside
        ? (evidence.rimAttempts / evidence.fieldGoalAttempts) * 10_000
        : (evidence.leadUsageCentis / evidence.teamUsageCentis) * 10_000;
      const metric = inside ? 'rim share' : 'lead-player opportunity share';
      const current = formatBpsPercent(Math.round(basisPoints));
      const previous = formatBpsPercent(opponentAdaptation.observedShareBps);
      adjustmentResponse = `Your ${metric} was ${current} this game, after ${previous} in the prior sample.`;
    }
    return {
      gameId: game.gameId,
      gameOrdinal: index + 1,
      ...result,
      userHome,
      won: game.winnerTeamId === userTeamId,
      compactLabel: result.doubleForfeit ? 'Double forfeit' : result.compactLabel,
      opponentAdaptation,
      adjustmentResponse,
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
    const preview = fullCourtUserNextPlayoffMatchup({
      userTeamId,
      runSeed: lock.season.runSeed,
      series: playoff.series,
    });
    if (preview !== null) {
      return {
        phase: 'playoff',
        label: `Game ${String(preview.gameOrdinal)} · ${capRushConferenceRoundName(preview.round)}`,
        home: sideOf(preview.homeTeamId, teamNameOf, preview.homeSeed),
        away: sideOf(preview.awayTeamId, teamNameOf, preview.awaySeed),
        userSide: preview.userSide,
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

export type FullCourtGameDayPlayerStatus =
  'ready' | 'fatigued' | 'injured' | 'unavailable' | 'resting';

export interface FullCourtGameDayPlayerView {
  readonly playerId: string;
  readonly playerVersionId?: string | undefined;
  readonly displayName: string;
  readonly positions: readonly string[];
  readonly status: FullCourtGameDayPlayerStatus;
  readonly statusLabel: string;
  readonly detail: string | null;
  readonly resting: boolean;
  readonly canRest: boolean;
}

export interface FullCourtGameDayReadiness {
  readonly fixture: FullCourtUserFixture | null;
  readonly players: readonly FullCourtGameDayPlayerView[];
  /** Healthy players before voluntary rest. */
  readonly eligibleCount: number;
  /** Healthy players after voluntary rest. */
  readonly availableCount: number;
  readonly restingCount: number;
  readonly requiredPlayers: number;
  readonly canRest: boolean;
  readonly restConflict: boolean;
  readonly forfeitLikely: boolean;
  readonly warnings: readonly string[];
}

export interface FullCourtGameDayAvailabilityEntry {
  readonly playerId: string;
  readonly available: boolean;
  readonly reason?: string;
}

const FULL_COURT_GAME_DAY_MIN_PLAYERS = 5;
const FULL_COURT_GAME_DAY_HEAVY_LOAD = 6_000;
const FULL_COURT_GAME_DAY_RECOVERY_PER_DAY = 3_500;

function fullCourtGameDayLoad(loadBasisPoints: number): number {
  return Math.round((loadBasisPoints / 100) * 10) / 10;
}

/**
 * Reads the saved health row at the next user fixture's day. Injury returns on
 * that day are available, and workload recovers by the calendar days between
 * the last committed game and the fixture.
 */
export function fullCourtGameDayReadiness(input: {
  readonly roster: readonly SimulationPlayer[];
  readonly availability?: readonly FullCourtGameDayAvailabilityEntry[];
  readonly health: FullCourtTeamHealth | null;
  readonly fixture: FullCourtUserFixture | null;
  readonly restingPlayerIds: readonly string[];
}): FullCourtGameDayReadiness {
  const { roster, availability = [], health, fixture, restingPlayerIds } = input;
  const availabilityById = new Map(availability.map((entry) => [entry.playerId, entry]));
  const resting = new Set(restingPlayerIds);
  const fixtureDay = fixture?.dayOffset ?? null;
  const recoveryDays =
    fixtureDay === null || health === null ? 0 : Math.max(0, fixtureDay - health.throughDay);

  const baseRows = roster.map((player) => {
    const playerHealth = health?.players[player.playerId];
    const base = availabilityById.get(player.playerId);
    const baseAvailable = base?.available ?? true;
    const returnDay = playerHealth?.availableFromDay ?? null;
    const injured = returnDay !== null && (fixtureDay === null || returnDay > fixtureDay);
    const restingThisGame = resting.has(player.playerId) && baseAvailable && !injured;
    const projectedLoad = Math.max(
      0,
      (playerHealth?.loadBasisPoints ?? 0) - recoveryDays * FULL_COURT_GAME_DAY_RECOVERY_PER_DAY,
    );
    const loadPercent = fullCourtGameDayLoad(projectedLoad);
    return {
      player,
      base,
      baseAvailable,
      returnDay,
      injured,
      resting: restingThisGame,
      loadPercent,
      eligible: baseAvailable && !injured,
    };
  });

  const eligibleCount = baseRows.filter((row) => row.eligible).length;
  const restingCount = baseRows.filter((row) => row.resting).length;
  const availableCount = eligibleCount - restingCount;
  const canRest = eligibleCount > FULL_COURT_GAME_DAY_MIN_PLAYERS;
  const restConflict =
    restingCount > 0 &&
    availableCount < FULL_COURT_GAME_DAY_MIN_PLAYERS &&
    eligibleCount >= FULL_COURT_GAME_DAY_MIN_PLAYERS;
  const forfeitLikely = fixture !== null && eligibleCount < FULL_COURT_GAME_DAY_MIN_PLAYERS;

  const players = baseRows.map((row): FullCourtGameDayPlayerView => {
    const common = {
      playerId: row.player.playerId,
      playerVersionId: row.player.playerVersionId,
      displayName: row.player.displayName,
      positions: row.player.positions,
      resting: row.resting,
      canRest: row.eligible && (row.resting || availableCount > FULL_COURT_GAME_DAY_MIN_PLAYERS),
    };
    if (row.injured) {
      return {
        ...common,
        status: 'injured',
        statusLabel: 'Out',
        detail: row.returnDay === null ? null : `Back on day ${String(row.returnDay)}`,
      };
    }
    if (!row.baseAvailable) {
      return {
        ...common,
        status: 'unavailable',
        statusLabel: 'Unavailable',
        detail: row.base?.reason ?? null,
      };
    }
    if (row.resting) {
      return {
        ...common,
        status: 'resting',
        statusLabel: 'Resting',
        detail: 'Clears after this game',
      };
    }
    if (row.loadPercent >= FULL_COURT_GAME_DAY_HEAVY_LOAD / 100) {
      return {
        ...common,
        status: 'fatigued',
        statusLabel: 'Heavy load',
        detail: `${String(row.loadPercent)}% carried into this game`,
      };
    }
    return {
      ...common,
      status: 'ready',
      statusLabel: 'Ready',
      detail: row.loadPercent > 0 ? `${String(row.loadPercent)}% carried into this game` : null,
    };
  });

  const warnings: string[] = [];
  if (fixture === null) {
    warnings.push(
      'No upcoming Full Court game. Availability appears when your next fixture is set.',
    );
  } else if (forfeitLikely) {
    warnings.push(
      `Only ${String(eligibleCount)} healthy ${eligibleCount === 1 ? 'player is' : 'players are'} available for ${fixture.label}. A forfeit is unavoidable; confirm it when the game is simulated.`,
    );
  } else if (restConflict) {
    warnings.push(
      `Resting ${String(restingCount)} ${restingCount === 1 ? 'player' : 'players'} leaves ${String(availableCount)} available. Uncheck rest until at least five players can play.`,
    );
  } else if (eligibleCount === FULL_COURT_GAME_DAY_MIN_PLAYERS && restingCount === 0) {
    warnings.push(
      `All five healthy players are needed for ${fixture.label}. Voluntary rest is unavailable.`,
    );
  }

  return {
    fixture,
    players,
    eligibleCount,
    availableCount,
    restingCount,
    requiredPlayers: FULL_COURT_GAME_DAY_MIN_PLAYERS,
    canRest,
    restConflict,
    forfeitLikely,
    warnings,
  };
}

/** Roughly quarterly season reviews use the same committed-game stop path. */
export const FULL_COURT_REVIEW_SLOTS = [20, 41, 61, 82] as const;

export function fullCourtNextReviewSlot(completedThroughSlot: number): number | null {
  return FULL_COURT_REVIEW_SLOTS.find((slot) => slot > completedThroughSlot) ?? null;
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
  readonly restConflict?: boolean;
}): FullCourtHomeControls {
  const { checkpoint, playoff, pendingForfeit, busy, restConflict = false } = input;
  const played = Math.min(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM, checkpoint.completedThroughSlot);
  const remaining = CAP_RUSH_CONFERENCE_GAMES_PER_TEAM - played;
  const regularComplete = remaining === 0;
  const sim = (
    label: string,
    count: number,
    options: FullCourtAdvanceOptions = {},
  ): FullCourtHomeAction => ({
    kind: 'sim',
    label,
    count,
    ...options,
  });
  const withStatus = (controls: Omit<FullCourtHomeControls, 'status'>, status: string) =>
    busy ? { ...controls, status: 'Simulation in progress…' } : { ...controls, status };
  if (pendingForfeit) {
    return withStatus(
      { primary: null, secondary: [] },
      'The next game cannot continue until the forfeit is accepted.',
    );
  }
  if (restConflict) {
    return withStatus(
      { primary: null, secondary: [] },
      'Your rest plan leaves fewer than five available. Uncheck rest to continue.',
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
      userAlive
        ? 'Sims count your games; AI-only bracket games advance automatically.'
        : 'Your run is over. Sim the remaining bracket to crown a champion.',
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
  const reviewSlot = fullCourtNextReviewSlot(played);
  const reviewCount = reviewSlot === null ? null : reviewSlot - played;
  const shortCount = Math.min(5, remaining);
  const interrupted: FullCourtAdvanceOptions = { stopAtInjury: true, stopAtReview: true };
  const secondary: FullCourtHomeAction[] = [];
  if (reviewCount !== null && reviewCount === shortCount) {
    secondary.push(sim('Sim to next review', reviewCount, interrupted));
  } else {
    secondary.push(sim(`Sim ${String(shortCount)}`, shortCount, interrupted));
    if (reviewCount !== null) secondary.push(sim('Sim to next review', reviewCount, interrupted));
  }
  if (remaining !== shortCount && remaining !== reviewCount) {
    secondary.push(sim('Sim remaining games', remaining));
  }
  return withStatus(
    {
      primary: sim('Sim next game', 1, interrupted),
      secondary,
    },
    'Sim one game, to the next review, or through the regular season. Batches pause at a review or an actionable injury.',
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

export interface FullCourtPlayoffAdaptationRead {
  readonly settingLabel: string;
  readonly reasonLabel: string;
  readonly detailLabel: string;
}

function formatBpsPercent(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? String(pct) : pct.toFixed(1)}%`;
}

export function fullCourtPlayoffAdaptationRead(
  adaptation: FullCourtPlayoffAdaptation,
): FullCourtPlayoffAdaptationRead {
  const settingLabel = adaptation.defense === 'protect-paint' ? 'Protect paint' : 'Pressure';
  const observed = formatBpsPercent(adaptation.observedShareBps);
  const threshold = formatBpsPercent(adaptation.thresholdShareBps);
  if (adaptation.reason === 'persistent-inside-scoring') {
    return {
      settingLabel,
      reasonLabel: 'Persistent inside scoring',
      detailLabel: `${observed} rim share across ${String(adaptation.sampleGames)} played games (threshold ${threshold}).`,
    };
  }
  return {
    settingLabel,
    reasonLabel: 'Persistent opportunity concentration',
    detailLabel: `${observed} lead-player opportunity share across ${String(adaptation.sampleGames)} played games (threshold ${threshold}).`,
  };
}

/** True when the opponent's next-game adjustment is new or has changed setting. */
export function fullCourtPlayoffAdjustmentChanged(
  applied: FullCourtPlayoffAdaptation | null | undefined,
  next: FullCourtPlayoffAdaptation | null | undefined,
): boolean {
  return next !== null && next !== undefined && (applied?.defense ?? null) !== next.defense;
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

/** Typed, display-ready feedback for why a simulation batch returned control. */
export interface FullCourtSimulationNotice {
  readonly stop: FullCourtSimulationStop;
  readonly tone: 'info' | 'success' | 'warning';
  readonly title: string;
  readonly message: string;
}

function gamesLabel(count: number): string {
  return `${String(count)} ${count === 1 ? 'game' : 'games'}`;
}

export function fullCourtSimulationNotice(
  stop: FullCourtSimulationStop,
  teamNameOf: (teamId: string) => string,
  playerNameOf: (playerId: string) => string,
): FullCourtSimulationNotice {
  switch (stop.kind) {
    case 'review':
      return {
        stop,
        tone: 'info',
        title: `Scheduled review · ${gamesLabel(stop.slot)} played`,
        message:
          'Review injuries, rest choices, and tactics before simulating the next block of games.',
      };
    case 'injury': {
      const names = stop.playerIds.map(playerNameOf);
      const playerList = names.join(', ');
      return {
        stop,
        tone: 'warning',
        title: names.length === 1 ? `${playerList} is out` : `${playerList} are out`,
        message: `Out until day ${String(stop.availableFromDay)}. Adjust rest or rotation before continuing.`,
      };
    }
    case 'series-complete': {
      const opponent = teamNameOf(stop.opponentTeamId);
      return {
        stop,
        tone: stop.won ? 'success' : 'warning',
        title: stop.won ? 'Series won' : 'Series lost',
        message: stop.won
          ? `You beat ${opponent} ${String(stop.userWins)}–${String(stop.opponentWins)} in the ${capRushConferenceRoundName(stop.round)}. Return when the next opponent is ready.`
          : `Your run ended against ${opponent} ${String(stop.userWins)}–${String(stop.opponentWins)} in the ${capRushConferenceRoundName(stop.round)}. Sim the remaining bracket when ready.`,
      };
    }
    case 'opponent-change': {
      const opponent = teamNameOf(stop.opponentTeamId);
      return {
        stop,
        tone: 'info',
        title: `Next opponent: ${opponent}`,
        message: `${capRushConferenceRoundName(stop.round)}. Set matchups, rest, and tactics before Game ${String(stop.gameOrdinal)}.`,
      };
    }
    case 'opponent-adjustment': {
      const read = fullCourtPlayoffAdaptationRead(stop.adaptation);
      return {
        stop,
        tone: 'warning',
        title: `Opponent adjusted: ${read.settingLabel}`,
        message: `${read.reasonLabel} (${read.detailLabel}). They will use it in Game ${String(stop.gameOrdinal)}. Adjust your plan, then continue.`,
      };
    }
    case 'game-limit':
      return {
        stop,
        tone: 'info',
        title: 'Simulation complete',
        message:
          stop.userGames > 0
            ? `${gamesLabel(stop.userGames)} played for your team.`
            : `${gamesLabel(stop.bracketGames)} of the bracket played.`,
      };
    case 'playoffs-complete': {
      const champion = teamNameOf(stop.championTeamId);
      return {
        stop,
        tone: stop.championTeamId === stop.userTeamId ? 'success' : 'info',
        title: 'Bracket complete',
        message:
          stop.championTeamId === stop.userTeamId
            ? 'You are the Full Court champion.'
            : `${champion} take the title. Your run is complete.`,
      };
    }
    case 'stopped':
      return {
        stop,
        tone: 'info',
        title: 'Simulation stopped',
        message:
          stop.userGames > 0
            ? `Saved after ${gamesLabel(stop.userGames)} for your team.`
            : `Saved after ${gamesLabel(stop.bracketGames)} of the bracket.`,
      };
  }
}

const PLAYOFF_GAME_ID_PATTERN = /^fcp-([1-4])-([0-7])-([1-7])$/;

export function fullCourtPlayoffFixtureLabel(gameId: string): string | null {
  const match = PLAYOFF_GAME_ID_PATTERN.exec(gameId);
  if (match === null) return null;
  const round = Number(match[1]);
  const ordinal = Number(match[3]);
  return `Game ${String(ordinal)} · ${capRushConferenceRoundName(round)}`;
}
