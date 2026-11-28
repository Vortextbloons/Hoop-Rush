import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_PLAYOFF_ROUNDS,
  CAP_RUSH_SERIES_WINS,
  fullCourtSeasonScoreSchema,
  fullCourtVariantSchema,
  type FullCourtPlayoffScore,
  type FullCourtSeasonScore,
  type FullCourtVariant,
} from '@hoop-rush/data-contracts';
import {
  FULL_COURT_LINEUP_SAMPLE_POSSESSIONS,
  fullCourtLineupKey,
  type FullCourtCompletedGameFacts,
  type FullCourtReportedPlayer,
} from './report.ts';

/**
 * Bounded season-completion summary for Full Court.
 *
 * The summary reads only the locked regular-season fixtures, recorded playoff
 * series, and completed-game facts supplied by the caller. It never invents a
 * missing postseason, champion, or award, and it keeps its output bounded to the
 * user's record, at most four playoff series, and the single best bench game.
 */

export const FULL_COURT_SEASON_ACHIEVEMENT_IDS = ['bench-mob', 'the-chess-match'] as const;
export const FULL_COURT_BENCH_MOB_POINTS = 50;

/**
 * Bench Mob requires at least 50 bench points in a completed game (even when
 * starters score more). The Chess Match uses a series won after a 3-1 deficit.
 * Both are gated on the completed regular season and carry the run's draft
 * variant.
 */
export type FullCourtSeasonAchievementId = (typeof FULL_COURT_SEASON_ACHIEVEMENT_IDS)[number];

export interface FullCourtSeasonAchievement {
  /** Full Court-local id; catalog registration belongs to the release slice. */
  readonly id: FullCourtSeasonAchievementId;
  readonly name: 'Bench Mob' | 'The Chess Match';
  /** The draft variant this run used. */
  readonly variant: FullCourtVariant;
  readonly evidence: string;
}

export interface FullCourtSeasonRegularSummary {
  readonly gamesExpected: number;
  readonly gamesRecorded: number;
  readonly complete: boolean;
  readonly wins: number;
  readonly losses: number;
  readonly playedGames: number;
  readonly forfeitGames: number;
  readonly forfeitsWon: number;
  readonly forfeitsLost: number;
  readonly doubleForfeits: number;
  /** Points are summed only over played games; forfeits have no score. */
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly pointDifferential: number;
}

export interface FullCourtSeasonBenchSummary {
  readonly gamesRecorded: number;
  /** Played user games in the supplied regular season plus playoff record. */
  readonly gamesExpected: number;
  readonly coverageComplete: boolean;
  /** Signed aggregate; deductions can bring it below zero. */
  readonly totalBenchPoints: number;
  /** Zero when no completed-game facts were supplied. */
  readonly averageBenchPoints: number;
  /** Highest bench scoring game; ties break on game number, then game id. */
  readonly bestGame: FullCourtCompletedGameFacts | null;
  /** Best game where the bench scored at least 50 points. */
  readonly benchMobGame: FullCourtCompletedGameFacts | null;
}

export interface FullCourtUserSeriesSummary {
  readonly seriesId: string;
  readonly round: number;
  readonly opponentTeamId: string;
  readonly userWins: number;
  readonly opponentWins: number;
  readonly gamesPlayed: number;
  readonly complete: boolean;
  /** Null until the series is decided. */
  readonly won: boolean | null;
  /** True only when the user trailed 1-3 after four games and won the series. */
  readonly comebackFromThreeOne: boolean;
}

export interface FullCourtFinalsSummary {
  readonly seriesId: string;
  readonly highTeamId: string;
  readonly lowTeamId: string;
  readonly highWins: number;
  readonly lowWins: number;
  readonly winnerTeamId: string | null;
}

export type FullCourtPostseasonUserOutcome =
  'champion' | 'eliminated' | 'pending' | 'not-qualified';

export interface FullCourtPostseasonSummary {
  readonly seriesRecorded: number;
  readonly gamesRecorded: number;
  /** The user's series in round order; at most four. */
  readonly userSeries: readonly FullCourtUserSeriesSummary[];
  readonly userOutcome: FullCourtPostseasonUserOutcome;
  readonly eliminatedRound: number | null;
  readonly championTeamId: string | null;
  readonly championSource: 'series' | 'provided' | 'none';
  readonly finals: FullCourtFinalsSummary | null;
  /** True once the user's season is decided (champion, eliminated, or not qualified). */
  readonly complete: boolean;
}

export interface FullCourtSeasonCompletion {
  readonly regularSeason: boolean;
  readonly postseason: 'not-provided' | 'pending' | 'complete';
  readonly complete: boolean;
}

export interface FullCourtSeasonCompletionInput {
  readonly runId: string;
  readonly userTeamId: string;
  /** The variant pinned into the run's draft, not a caller preference. */
  readonly variant: FullCourtVariant;
  /** Locked regular-season scores; all teams' scores are accepted and filtered here. */
  readonly regularScores: readonly FullCourtSeasonScore[];
  /** Optional player facts from completed games; required for Bench Mob. */
  readonly completedGames?: readonly FullCourtCompletedGameFacts[] | undefined;
  /** Optional recorded playoff series; omitted means no postseason record was provided. */
  readonly series?: readonly FullCourtSeriesFacts[] | undefined;
  /** The postseason view's explicit champion, if the caller has one. */
  readonly championTeamId?: string | null | undefined;
}

/** Minimal series shape; `FullCourtPlayoffSeries` satisfies it. */
export interface FullCourtSeriesFacts {
  readonly seriesId: string;
  readonly round: number;
  readonly highTeamId: string;
  readonly lowTeamId: string;
  readonly games: readonly FullCourtPlayoffScore[];
}

export interface FullCourtSeasonSummary {
  readonly runId: string;
  readonly variant: FullCourtVariant;
  readonly regularSeason: FullCourtSeasonRegularSummary;
  readonly bench: FullCourtSeasonBenchSummary | null;
  readonly postseason: FullCourtPostseasonSummary | null;
  readonly completion: FullCourtSeasonCompletion;
  readonly achievements: readonly FullCourtSeasonAchievement[];
  /** Plain-language summary built only from the fields above. */
  readonly summary: string;
}

export interface FullCourtSeasonLineupRow {
  readonly key: string;
  readonly playerIds: readonly string[];
  readonly players: readonly FullCourtReportedPlayer[];
  readonly games: number;
  readonly seconds: number;
  readonly minutes: number;
  readonly offensivePossessions: number;
  readonly defensivePossessions: number;
  readonly pacePossessions: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly netPoints: number;
  /** True net rating per 100 possessions; null when either possession count is zero. */
  readonly netRatingPer100: number | null;
  /** False below the displayed sample floor; the row is still reported. */
  readonly sampleMet: boolean;
  /** Rank by net rating among sample-met lineups; null when the sample is too small. */
  readonly rank: number | null;
}

export interface FullCourtSeasonLineupOmitted {
  readonly lineups: number;
  readonly games: number;
  readonly seconds: number;
  readonly offensivePossessions: number;
  readonly defensivePossessions: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
}

export interface FullCourtSeasonLineupSummary {
  readonly sampleThreshold: number;
  /** Played user games in the supplied regular season and playoff record. */
  readonly gamesExpected: number;
  /** Played user games that carried compact lineup facts. */
  readonly gamesRecorded: number;
  readonly coverageComplete: boolean;
  readonly rows: readonly FullCourtSeasonLineupRow[];
  readonly omitted: FullCourtSeasonLineupOmitted;
}

export interface FullCourtSeasonPlayoffStats {
  readonly playedGames: number;
  readonly forfeitGames: number;
}

export interface FullCourtSeasonStatsSummary {
  readonly regular: FullCourtSeasonRegularSummary;
  readonly playoff: FullCourtSeasonPlayoffStats;
  readonly bench: FullCourtSeasonBenchSummary | null;
  readonly lineups: FullCourtSeasonLineupSummary;
}

export interface FullCourtSeasonStatsInput {
  readonly userTeamId: string;
  readonly regularScores: readonly FullCourtSeasonScore[];
  /** Recorded playoff series; omitted means no postseason games are counted. */
  readonly series?: readonly FullCourtSeriesFacts[] | undefined;
  /** Override the displayed possession floor, mainly for tests or tuning. */
  readonly sampleThreshold?: number;
}

interface UserRegularGame {
  readonly gameId: string;
  readonly slot: number;
  readonly userSide: 'home' | 'away';
  readonly opponentTeamId: string;
  readonly outcome: FullCourtSeasonScore['outcome'];
  readonly userPoints: number | null;
}

interface DerivedSeries {
  readonly input: FullCourtSeriesFacts;
  readonly games: readonly FullCourtPlayoffScore[];
  readonly highWins: number;
  readonly lowWins: number;
  readonly winnerTeamId: string | null;
}

const PLAYOFF_GAME_ID = /^fcp-([1-4])-([0-7])-([1-7])$/;

function roundToTenth(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function userRegularGames(input: {
  readonly regularScores: readonly FullCourtSeasonScore[];
  readonly userTeamId: string;
}): readonly UserRegularGame[] {
  const seen = new Set<string>();
  const bySlot = new Map<number, UserRegularGame>();
  for (const raw of input.regularScores) {
    const score = fullCourtSeasonScoreSchema.parse(raw);
    if (seen.has(score.gameId)) {
      throw new Error(`Full Court summary: duplicate regular-season game ${score.gameId}`);
    }
    seen.add(score.gameId);
    const isHome = score.homeTeamId === input.userTeamId;
    if (!isHome && score.awayTeamId !== input.userTeamId) continue;
    if (bySlot.has(score.slot)) {
      throw new Error(
        `Full Court summary: ${input.userTeamId} has two games in slot ${String(score.slot)}`,
      );
    }
    bySlot.set(score.slot, {
      gameId: score.gameId,
      slot: score.slot,
      userSide: isHome ? 'home' : 'away',
      opponentTeamId: isHome ? score.awayTeamId : score.homeTeamId,
      outcome: score.outcome,
      userPoints:
        score.outcome.kind === 'played'
          ? isHome
            ? score.outcome.homePoints
            : score.outcome.awayPoints
          : null,
    });
  }
  return [...bySlot.values()].sort((left, right) => left.slot - right.slot);
}

function summarizeRegular(games: readonly UserRegularGame[]): FullCourtSeasonRegularSummary {
  let wins = 0;
  let losses = 0;
  let playedGames = 0;
  let forfeitGames = 0;
  let forfeitsWon = 0;
  let forfeitsLost = 0;
  let doubleForfeits = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;

  for (const game of games) {
    if (game.outcome.kind === 'played') {
      playedGames += 1;
      const userPoints =
        game.userSide === 'home' ? game.outcome.homePoints : game.outcome.awayPoints;
      const opponentPoints =
        game.userSide === 'home' ? game.outcome.awayPoints : game.outcome.homePoints;
      pointsFor += userPoints;
      pointsAgainst += opponentPoints;
      if (userPoints > opponentPoints) wins += 1;
      else if (userPoints < opponentPoints) losses += 1;
      else throw new Error(`Full Court summary: tied regular-season game ${game.gameId}`);
      continue;
    }

    forfeitGames += 1;
    const userForfeit = game.outcome.losingSides.includes(game.userSide);
    const opponentSide = game.userSide === 'home' ? 'away' : 'home';
    const opponentForfeit = game.outcome.losingSides.includes(opponentSide);
    if (!userForfeit && !opponentForfeit) {
      throw new Error(`Full Court summary: forfeit ${game.gameId} does not include a played side`);
    }
    if (userForfeit && opponentForfeit) {
      doubleForfeits += 1;
      losses += 1;
    } else if (userForfeit) {
      forfeitsLost += 1;
      losses += 1;
    } else {
      forfeitsWon += 1;
      wins += 1;
    }
  }

  const gamesRecorded = games.length;
  return {
    gamesExpected: CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
    gamesRecorded,
    complete: gamesRecorded === CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
    wins,
    losses,
    playedGames,
    forfeitGames,
    forfeitsWon,
    forfeitsLost,
    doubleForfeits,
    pointsFor,
    pointsAgainst,
    pointDifferential: pointsFor - pointsAgainst,
  };
}

function playoffOrdinal(gameId: string): number {
  const match = PLAYOFF_GAME_ID.exec(gameId);
  if (match === null) throw new Error(`Full Court summary: invalid playoff game id ${gameId}`);
  return Number(match[3]);
}

function deriveSeries(series: FullCourtSeriesFacts): DerivedSeries {
  if (
    !Number.isInteger(series.round) ||
    series.round < 1 ||
    series.round > CAP_RUSH_PLAYOFF_ROUNDS
  ) {
    throw new Error(`Full Court summary: invalid playoff round on ${series.seriesId}`);
  }
  if (series.highTeamId === series.lowTeamId) {
    throw new Error(`Full Court summary: ${series.seriesId} has the same team on both sides`);
  }
  if (series.games.length > CAP_RUSH_SERIES_WINS * 2 - 1) {
    throw new Error(`Full Court summary: ${series.seriesId} has too many games`);
  }

  const ordered = series.games
    .map((game) => ({ game, ordinal: playoffOrdinal(game.gameId) }))
    .sort((left, right) => left.ordinal - right.ordinal);
  let highWins = 0;
  let lowWins = 0;
  let clinchedAt = -1;
  for (const [index, entry] of ordered.entries()) {
    if (entry.ordinal !== index + 1) {
      throw new Error(`Full Court summary: ${series.seriesId} game ordinals are not contiguous`);
    }
    const round = Number(PLAYOFF_GAME_ID.exec(entry.game.gameId)?.[1] ?? 0);
    if (round !== series.round) {
      throw new Error(
        `Full Court summary: ${entry.game.gameId} is not in round ${String(series.round)}`,
      );
    }
    const game = entry.game;
    const teams = new Set([series.highTeamId, series.lowTeamId]);
    if (
      !teams.has(game.homeTeamId) ||
      !teams.has(game.awayTeamId) ||
      !teams.has(game.winnerTeamId)
    ) {
      throw new Error(`Full Court summary: ${game.gameId} does not match ${series.seriesId}`);
    }
    if (game.outcome.kind === 'played') {
      const expected =
        game.outcome.homePoints > game.outcome.awayPoints ? game.homeTeamId : game.awayTeamId;
      if (game.winnerTeamId !== expected) {
        throw new Error(`Full Court summary: ${game.gameId} winner does not match its score`);
      }
    }
    if (game.winnerTeamId === series.highTeamId) highWins += 1;
    else lowWins += 1;
    if (highWins > CAP_RUSH_SERIES_WINS || lowWins > CAP_RUSH_SERIES_WINS) {
      throw new Error(`Full Court summary: ${series.seriesId} has too many wins`);
    }
    if (
      clinchedAt === -1 &&
      (highWins === CAP_RUSH_SERIES_WINS || lowWins === CAP_RUSH_SERIES_WINS)
    ) {
      clinchedAt = index;
    }
  }
  if (clinchedAt !== -1 && clinchedAt !== ordered.length - 1) {
    throw new Error(`Full Court summary: ${series.seriesId} has games after the series was won`);
  }
  return {
    input: series,
    games: ordered.map((entry) => entry.game),
    highWins,
    lowWins,
    winnerTeamId:
      highWins === CAP_RUSH_SERIES_WINS
        ? series.highTeamId
        : lowWins === CAP_RUSH_SERIES_WINS
          ? series.lowTeamId
          : null,
  };
}

function winsOf(games: readonly FullCourtPlayoffScore[], teamId: string): number {
  return games.filter((game) => game.winnerTeamId === teamId).length;
}

function comebackFromThreeOne(
  games: readonly FullCourtPlayoffScore[],
  userTeamId: string,
  opponentTeamId: string,
): boolean {
  if (games.length < 4 || winsOf(games, userTeamId) !== CAP_RUSH_SERIES_WINS) return false;
  return (
    winsOf(games.slice(0, 4), userTeamId) === 1 && winsOf(games.slice(0, 4), opponentTeamId) === 3
  );
}

function summarizePostseason(input: FullCourtSeasonCompletionInput): {
  readonly summary: FullCourtPostseasonSummary;
  readonly chessMatch: FullCourtUserSeriesSummary | null;
} | null {
  if (input.series === undefined) return null;
  const derived = input.series.map(deriveSeries);
  const userSeries = derived
    .filter(
      (series) =>
        series.input.highTeamId === input.userTeamId || series.input.lowTeamId === input.userTeamId,
    )
    .sort((left, right) => left.input.round - right.input.round);
  const rounds = new Set<number>();
  for (const series of userSeries) {
    if (rounds.has(series.input.round)) {
      throw new Error(
        `Full Court summary: user has two series in round ${String(series.input.round)}`,
      );
    }
    rounds.add(series.input.round);
  }
  if (userSeries.length > CAP_RUSH_PLAYOFF_ROUNDS) {
    throw new Error('Full Court summary: user has more than four playoff series');
  }

  const finalsSeries = derived.find((series) => series.input.round === CAP_RUSH_PLAYOFF_ROUNDS);
  if (derived.filter((series) => series.input.round === CAP_RUSH_PLAYOFF_ROUNDS).length > 1) {
    throw new Error('Full Court summary: more than one Finals series was supplied');
  }
  const derivedChampion = finalsSeries?.winnerTeamId ?? null;
  const providedChampion = input.championTeamId ?? null;
  if (
    derivedChampion !== null &&
    providedChampion !== null &&
    derivedChampion !== providedChampion
  ) {
    throw new Error('Full Court summary: the supplied champion does not match the Finals record');
  }
  const championTeamId = derivedChampion ?? providedChampion;
  const championSource =
    derivedChampion !== null ? 'series' : providedChampion !== null ? 'provided' : 'none';

  const seriesSummaries = userSeries.map((series): FullCourtUserSeriesSummary => {
    const opponentTeamId =
      series.input.highTeamId === input.userTeamId
        ? series.input.lowTeamId
        : series.input.highTeamId;
    const userWins = winsOf(series.games, input.userTeamId);
    const opponentWins = winsOf(series.games, opponentTeamId);
    const complete = series.winnerTeamId !== null;
    const won = series.winnerTeamId === null ? null : series.winnerTeamId === input.userTeamId;
    return {
      seriesId: series.input.seriesId,
      round: series.input.round,
      opponentTeamId,
      userWins,
      opponentWins,
      gamesPlayed: series.games.length,
      complete,
      won,
      comebackFromThreeOne: comebackFromThreeOne(series.games, input.userTeamId, opponentTeamId),
    };
  });

  let userOutcome: FullCourtPostseasonUserOutcome = 'pending';
  let eliminatedRound: number | null = null;
  const loss = seriesSummaries.find((series) => series.won === false);
  const finalsWin = seriesSummaries.find(
    (series) => series.round === CAP_RUSH_PLAYOFF_ROUNDS && series.won === true,
  );
  if (championTeamId === input.userTeamId) {
    if (loss !== undefined) {
      throw new Error('Full Court summary: the user lost a series but is marked champion');
    }
    userOutcome = 'champion';
  } else if (finalsWin !== undefined) {
    throw new Error('Full Court summary: the user won the Finals but is not the champion');
  } else if (loss !== undefined) {
    userOutcome = 'eliminated';
    eliminatedRound = loss.round;
  } else if (seriesSummaries.length === 0) {
    userOutcome = derived.length === 0 ? 'pending' : 'not-qualified';
  } else {
    const last = seriesSummaries.at(-1);
    if (
      last !== undefined &&
      last.complete &&
      last.won === true &&
      last.round < CAP_RUSH_PLAYOFF_ROUNDS
    ) {
      userOutcome = 'pending';
    } else if (last !== undefined && !last.complete) {
      userOutcome = 'pending';
    }
  }

  const finals =
    finalsSeries === undefined
      ? null
      : {
          seriesId: finalsSeries.input.seriesId,
          highTeamId: finalsSeries.input.highTeamId,
          lowTeamId: finalsSeries.input.lowTeamId,
          highWins: finalsSeries.highWins,
          lowWins: finalsSeries.lowWins,
          winnerTeamId: finalsSeries.winnerTeamId,
        };

  return {
    summary: {
      seriesRecorded: derived.length,
      gamesRecorded: derived.reduce((total, series) => total + series.games.length, 0),
      userSeries: seriesSummaries,
      userOutcome,
      eliminatedRound,
      championTeamId,
      championSource,
      finals,
      complete: userOutcome !== 'pending',
    },
    chessMatch: seriesSummaries.find((series) => series.comebackFromThreeOne) ?? null,
  };
}

function validCompletedGame(
  fact: FullCourtCompletedGameFacts,
  expectedPoints: number,
  gameKind: 'regular-season' | 'playoff',
): void {
  const numbers = [
    fact.gameNumber,
    fact.teamPoints,
    fact.starterPoints,
    fact.benchPoints,
    fact.teamBonusPoints,
    fact.benchPlayerCount,
  ];
  if (numbers.some((value) => !Number.isSafeInteger(value))) {
    throw new Error(`Full Court summary: invalid completed-game facts for ${fact.gameId}`);
  }
  if (
    fact.gameNumber < 1 ||
    fact.teamPoints < 0 ||
    fact.teamBonusPoints < 0 ||
    fact.benchPlayerCount < 0
  ) {
    throw new Error(`Full Court summary: invalid completed-game facts for ${fact.gameId}`);
  }
  if (fact.starterPoints + fact.benchPoints + fact.teamBonusPoints !== fact.teamPoints) {
    throw new Error(`Full Court summary: bench facts for ${fact.gameId} do not sum to team points`);
  }
  if (fact.teamPoints !== expectedPoints) {
    throw new Error(
      `Full Court summary: bench facts for ${fact.gameId} do not match the ${gameKind} score`,
    );
  }
  if (fact.benchPoints !== 0 && fact.benchPlayerCount === 0) {
    throw new Error(`Full Court summary: bench facts for ${fact.gameId} have no bench player`);
  }
}

function summarizeBench(
  input: Pick<FullCourtSeasonCompletionInput, 'completedGames' | 'userTeamId'>,
  regularGames: readonly UserRegularGame[],
  playoffGames: readonly Pick<
    FullCourtPlayoffScore,
    'gameId' | 'homeTeamId' | 'awayTeamId' | 'outcome'
  >[],
): FullCourtSeasonBenchSummary | null {
  if (input.completedGames === undefined) return null;
  const playedRegular = new Map(
    regularGames
      .filter((game) => game.outcome.kind === 'played')
      .map((game) => [game.gameId, game.userPoints ?? 0]),
  );
  const playedPlayoff = new Map(
    playoffGames
      .filter((game) => game.outcome.kind === 'played')
      .map((game) => {
        if (game.outcome.kind !== 'played') return [game.gameId, 0] as const;
        return [
          game.gameId,
          game.homeTeamId === input.userTeamId ? game.outcome.homePoints : game.outcome.awayPoints,
        ] as const;
      }),
  );

  const seen = new Set<string>();
  const facts: FullCourtCompletedGameFacts[] = [];
  for (const fact of input.completedGames) {
    if (seen.has(fact.gameId)) {
      throw new Error(`Full Court summary: duplicate completed game ${fact.gameId}`);
    }
    seen.add(fact.gameId);
    const regularPoints = playedRegular.get(fact.gameId);
    const playoffPoints = playedPlayoff.get(fact.gameId);
    if (regularPoints === undefined && playoffPoints === undefined) {
      throw new Error(
        `Full Court summary: completed game ${fact.gameId} is not a played user game`,
      );
    }
    validCompletedGame(
      fact,
      regularPoints ?? playoffPoints ?? 0,
      regularPoints === undefined ? 'playoff' : 'regular-season',
    );
    facts.push(fact);
  }

  const totalBenchPoints = facts.reduce((total, fact) => total + fact.benchPoints, 0);
  const bestGame =
    [...facts].sort(
      (left, right) =>
        right.benchPoints - left.benchPoints ||
        left.gameNumber - right.gameNumber ||
        left.gameId.localeCompare(right.gameId),
    )[0] ?? null;
  const benchMobGame =
    facts
      .filter((fact) => fact.benchPoints >= FULL_COURT_BENCH_MOB_POINTS)
      .sort(
        (left, right) =>
          right.benchPoints - left.benchPoints ||
          left.gameNumber - right.gameNumber ||
          left.gameId.localeCompare(right.gameId),
      )[0] ?? null;
  const gamesExpected = playedRegular.size + playedPlayoff.size;

  return {
    gamesRecorded: facts.length,
    gamesExpected,
    coverageComplete: facts.length === gamesExpected,
    totalBenchPoints,
    averageBenchPoints: facts.length === 0 ? 0 : roundToTenth(totalBenchPoints / facts.length),
    bestGame,
    benchMobGame,
  };
}

interface CompletedGameScore {
  readonly score: Pick<FullCourtSeasonScore, 'gameId' | 'outcome'>;
  readonly side: 'home' | 'away';
  readonly gameNumber: number;
}

function completedGameFactsOf(game: CompletedGameScore): FullCourtCompletedGameFacts | null {
  const { outcome } = game.score;
  if (outcome.kind !== 'played' || outcome.benchPoints === undefined) return null;
  if (outcome.benchPlayers === undefined) return null;
  const teamPoints = game.side === 'home' ? outcome.homePoints : outcome.awayPoints;
  const benchPoints = outcome.benchPoints[game.side];
  const teamBonusPoints = outcome.teamBonusPoints?.[game.side] ?? 0;
  return {
    gameId: game.score.gameId,
    gameNumber: game.gameNumber,
    teamPoints,
    benchPoints,
    starterPoints: outcome.starterPoints?.[game.side] ?? teamPoints - benchPoints - teamBonusPoints,
    teamBonusPoints,
    benchPlayerCount: outcome.benchPlayers[game.side],
  };
}

interface UserPlayoffGame {
  readonly score: FullCourtPlayoffScore;
  readonly side: 'home' | 'away';
  readonly gameNumber: number;
}

function userPlayoffGames(
  series: readonly FullCourtSeriesFacts[] | undefined,
  userTeamId: string,
): UserPlayoffGame[] {
  if (series === undefined) return [];
  const derived = series
    .map(deriveSeries)
    .sort(
      (left, right) =>
        left.input.round - right.input.round ||
        left.input.seriesId.localeCompare(right.input.seriesId),
    );
  const games: UserPlayoffGame[] = [];
  const seen = new Set<string>();
  let gameNumber = CAP_RUSH_CONFERENCE_GAMES_PER_TEAM;
  for (const entry of derived) {
    for (const score of entry.games) {
      gameNumber += 1;
      if (seen.has(score.gameId)) {
        throw new Error(`Full Court stats: duplicate playoff game ${score.gameId}`);
      }
      seen.add(score.gameId);
      const side =
        score.homeTeamId === userTeamId ? 'home' : score.awayTeamId === userTeamId ? 'away' : null;
      if (side !== null) games.push({ score, side, gameNumber });
    }
  }
  return games;
}

interface LineupAccumulator {
  readonly playerIds: readonly string[];
  readonly names: Map<string, string>;
  readonly games: Set<string>;
  seconds: number;
  offensivePossessions: number;
  defensivePossessions: number;
  pointsFor: number;
  pointsAgainst: number;
}

function lineupSummaryOf(
  games: readonly CompletedGameScore[],
  sampleThreshold: number,
): FullCourtSeasonLineupSummary {
  const accumulators = new Map<string, LineupAccumulator>();
  const omitted = {
    lineups: 0,
    games: 0,
    seconds: 0,
    offensivePossessions: 0,
    defensivePossessions: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  };
  let gamesRecorded = 0;
  let gamesExpected = 0;
  for (const game of games) {
    const { outcome } = game.score;
    if (outcome.kind !== 'played') continue;
    gamesExpected += 1;
    const lineups = outcome.lineups;
    if (lineups === undefined) continue;
    if (lineups.side !== game.side) {
      throw new Error(
        `Full Court stats: ${game.score.gameId} lineups are recorded for the wrong side`,
      );
    }
    gamesRecorded += 1;
    for (const fact of lineups.lineups) {
      const key = fullCourtLineupKey(fact.playerIds);
      let accumulator = accumulators.get(key);
      if (accumulator === undefined) {
        accumulator = {
          playerIds: [...fact.playerIds],
          names: new Map(),
          games: new Set(),
          seconds: 0,
          offensivePossessions: 0,
          defensivePossessions: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        };
        accumulators.set(key, accumulator);
      }
      for (const player of fact.players) {
        const known = accumulator.names.get(player.playerId);
        if (known !== undefined && known !== player.displayName) {
          throw new Error(`Full Court stats: ${player.playerId} has two recorded names`);
        }
        accumulator.names.set(player.playerId, player.displayName);
      }
      accumulator.games.add(game.score.gameId);
      accumulator.seconds += fact.seconds;
      accumulator.offensivePossessions += fact.offensivePossessions;
      accumulator.defensivePossessions += fact.defensivePossessions;
      accumulator.pointsFor += fact.pointsFor;
      accumulator.pointsAgainst += fact.pointsAgainst;
    }
    omitted.lineups += lineups.omitted.lineups;
    omitted.seconds += lineups.omitted.seconds;
    omitted.offensivePossessions += lineups.omitted.offensivePossessions;
    omitted.defensivePossessions += lineups.omitted.defensivePossessions;
    omitted.pointsFor += lineups.omitted.pointsFor;
    omitted.pointsAgainst += lineups.omitted.pointsAgainst;
    if (lineups.omitted.lineups > 0) omitted.games += 1;
  }

  const rows: FullCourtSeasonLineupRow[] = [...accumulators.values()]
    .map((accumulator): FullCourtSeasonLineupRow => {
      const pacePossessions =
        (accumulator.offensivePossessions + accumulator.defensivePossessions) / 2;
      const netRatingPer100 =
        accumulator.offensivePossessions === 0 || accumulator.defensivePossessions === 0
          ? null
          : roundToTenth(
              (accumulator.pointsFor / accumulator.offensivePossessions -
                accumulator.pointsAgainst / accumulator.defensivePossessions) *
                100,
            );
      const players = accumulator.playerIds.map((playerId) => {
        const displayName = accumulator.names.get(playerId);
        if (displayName === undefined) {
          throw new Error(`Full Court stats: lineup references unknown player ${playerId}`);
        }
        return { playerId, displayName };
      });
      return {
        key: fullCourtLineupKey(accumulator.playerIds),
        playerIds: accumulator.playerIds,
        players,
        games: accumulator.games.size,
        seconds: accumulator.seconds,
        minutes: roundToTenth(accumulator.seconds / 60),
        offensivePossessions: accumulator.offensivePossessions,
        defensivePossessions: accumulator.defensivePossessions,
        pacePossessions,
        pointsFor: accumulator.pointsFor,
        pointsAgainst: accumulator.pointsAgainst,
        netPoints: accumulator.pointsFor - accumulator.pointsAgainst,
        netRatingPer100,
        sampleMet: pacePossessions >= sampleThreshold,
        rank: null,
      };
    })
    .sort((left, right) => right.seconds - left.seconds || left.key.localeCompare(right.key));

  const ranked = rows
    .filter((row) => row.sampleMet && row.netRatingPer100 !== null)
    .sort(
      (left, right) =>
        (right.netRatingPer100 ?? 0) - (left.netRatingPer100 ?? 0) ||
        left.key.localeCompare(right.key),
    );
  const rankByKey = new Map(ranked.map((row, index) => [row.key, index + 1]));
  return {
    sampleThreshold,
    gamesExpected,
    gamesRecorded,
    coverageComplete: gamesRecorded === gamesExpected,
    rows: rows.map((row) => ({ ...row, rank: rankByKey.get(row.key) ?? null })),
    omitted,
  };
}

export function buildFullCourtSeasonStats(
  input: FullCourtSeasonStatsInput,
): FullCourtSeasonStatsSummary {
  const sampleThreshold = input.sampleThreshold ?? FULL_COURT_LINEUP_SAMPLE_POSSESSIONS;
  if (!Number.isSafeInteger(sampleThreshold) || sampleThreshold < 0) {
    throw new Error('Full Court stats: sample threshold must be a nonnegative integer');
  }
  const regularGames = userRegularGames(input);
  const playoffGames = userPlayoffGames(input.series, input.userTeamId);
  const allGames: CompletedGameScore[] = [
    ...regularGames.map((game) => ({
      score: { gameId: game.gameId, outcome: game.outcome },
      side: game.userSide,
      gameNumber: game.slot,
    })),
    ...playoffGames,
  ];
  const facts = allGames
    .map(completedGameFactsOf)
    .filter((fact): fact is FullCourtCompletedGameFacts => fact !== null);
  const bench = summarizeBench(
    { completedGames: facts, userTeamId: input.userTeamId },
    regularGames,
    playoffGames.map((game) => game.score),
  );
  const lineups = lineupSummaryOf(allGames, sampleThreshold);
  return {
    regular: summarizeRegular(regularGames),
    playoff: {
      playedGames: playoffGames.filter((game) => game.score.outcome.kind === 'played').length,
      forfeitGames: playoffGames.filter((game) => game.score.outcome.kind === 'forfeit').length,
    },
    bench,
    lineups,
  };
}

function buildSummaryText(input: {
  readonly regularSeason: FullCourtSeasonRegularSummary;
  readonly bench: FullCourtSeasonBenchSummary | null;
  readonly postseason: FullCourtPostseasonSummary | null;
  readonly achievements: readonly FullCourtSeasonAchievement[];
}): string {
  const regular = input.regularSeason;
  const record = `${String(regular.wins)}-${String(regular.losses)}`;
  let text = regular.complete
    ? `${record} regular season`
    : `${record} in ${String(regular.gamesRecorded)} of ${String(regular.gamesExpected)} regular-season games`;
  if (regular.forfeitGames > 0) {
    text += `, ${String(regular.forfeitGames)} forfeit${regular.forfeitGames === 1 ? '' : 's'}`;
  }
  text += '.';

  if (input.postseason === null) {
    text += ' No postseason record was provided.';
  } else if (input.postseason.userOutcome === 'champion') {
    text += ' Won the championship.';
  } else if (input.postseason.userOutcome === 'eliminated') {
    text += ` Eliminated in Round ${String(input.postseason.eliminatedRound)}.`;
  } else if (input.postseason.userOutcome === 'not-qualified') {
    text += ' Did not qualify for the playoffs.';
  } else {
    text += ' The postseason record is incomplete.';
  }

  if (input.bench === null) {
    text += ' Bench scoring was not provided.';
  } else if (input.bench.gamesRecorded === 0) {
    text += ' No completed-game bench facts were provided.';
  } else {
    text +=
      ` Bench averaged ${String(input.bench.averageBenchPoints)} points across ` +
      `${String(input.bench.gamesRecorded)} completed game${input.bench.gamesRecorded === 1 ? '' : 's'}`;
    if (!input.bench.coverageComplete) {
      text += ` of ${String(input.bench.gamesExpected)} with player facts`;
    }
    text += '.';
  }

  if (input.achievements.length > 0) {
    text += ` Achievements: ${input.achievements.map((achievement) => achievement.name).join(', ')}.`;
  }
  return text;
}

export function buildFullCourtSeasonSummary(
  input: FullCourtSeasonCompletionInput,
): FullCourtSeasonSummary {
  const variant = fullCourtVariantSchema.parse(input.variant);
  const regularGames = userRegularGames(input);
  const regularSeason = summarizeRegular(regularGames);
  const postseason = summarizePostseason(input);
  const playoffGames =
    input.series === undefined
      ? []
      : input.series.flatMap((series) =>
          series.games.filter(
            (game) => game.homeTeamId === input.userTeamId || game.awayTeamId === input.userTeamId,
          ),
        );
  const bench = summarizeBench(input, regularGames, playoffGames);

  const achievements: FullCourtSeasonAchievement[] = [];
  if (regularSeason.complete && bench !== null && bench.benchMobGame !== null) {
    const game = bench.benchMobGame;
    achievements.push({
      id: 'bench-mob',
      name: 'Bench Mob',
      variant,
      evidence:
        `Bench scored ${String(game.benchPoints)} points (starters ${String(game.starterPoints)}` +
        `${game.teamBonusPoints > 0 ? `, team bonus ${String(game.teamBonusPoints)}` : ''}) ` +
        `in game ${String(game.gameNumber)} (${game.gameId}).`,
    });
  }
  if (regularSeason.complete && postseason !== null && postseason.chessMatch !== null) {
    const series = postseason.chessMatch;
    achievements.push({
      id: 'the-chess-match',
      name: 'The Chess Match',
      variant,
      evidence:
        `Won the Round ${String(series.round)} series after trailing 3-1 ` +
        `(${series.seriesId}).`,
    });
  }

  const completion: FullCourtSeasonCompletion = {
    regularSeason: regularSeason.complete,
    postseason:
      postseason === null ? 'not-provided' : postseason.summary.complete ? 'complete' : 'pending',
    complete: regularSeason.complete && postseason !== null && postseason.summary.complete,
  };

  return {
    runId: input.runId,
    variant,
    regularSeason,
    bench,
    postseason: postseason?.summary ?? null,
    completion,
    achievements,
    summary: buildSummaryText({
      regularSeason,
      bench,
      postseason: postseason?.summary ?? null,
      achievements,
    }),
  };
}
