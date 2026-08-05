import {
  SEASON_POSTSEASON_VERSION,
  seasonPostseasonStateSchema,
  type ConferenceId,
  type PlayInGame,
  type PlayInGameId,
  type PlayoffBracket,
  type PlayoffConferenceBracket,
  type PlayoffRound,
  type PlayoffSeries,
  type PlayoffSeriesGame,
  type SeasonLeague,
  type SeasonPostseasonState,
} from '@hoop-rush/data-contracts';
import { franchisesInConference } from './league.ts';

/**
 * Season Run postseason state machine (spec/2.0/02, postseason-v1). M2.0
 * receives an explicitly seeded top ten per conference and carries the facts
 * later tiebreak work requires; the full published NBA tiebreak sequence
 * lands in M2.6. The machine implements the exact 7/8, 9/10, and final
 * Play-In flow, fixed 1-8, 4-5, 3-6, 2-7 first-round pairings, no
 * reseeding, best-of-seven series ending immediately at four wins, the
 * 2-2-1-1-1 home pattern, and a caller-supplied Finals home-court team.
 * Every transition is a pure function of the current state and the submitted
 * result; nothing depends on call order or external randomness.
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

const CONFERENCES: readonly ConferenceId[] = ['east', 'west'];

/** Home-court games of the 2-2-1-1-1 pattern (games 1, 2, 5, 7). */
const HOME_COURT_GAMES = new Set([1, 2, 5, 7]);

/** Fixed first-round index pairs: (higher seed index, lower seed index). */
const FIRST_ROUND_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 7],
  [3, 4],
  [2, 5],
  [1, 6],
];

export interface PostseasonRankings {
  east: readonly string[];
  west: readonly string[];
}

export type PlayInGameResult =
  | { status: 'final'; homeScore: number; awayScore: number }
  | { status: 'forfeit'; loserFranchiseId: string };

export type PlayoffGameResult =
  | { status: 'final'; homeScore: number; awayScore: number }
  | { status: 'forfeit'; winnerFranchiseId: string };

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/** Resolves one scheduled Play-In game from its derived matchup and result. */
function resolvePlayInGame(
  game: PlayInGame,
  home: string,
  away: string,
  result: PlayInGameResult,
): PlayInGame {
  if (game.status !== 'scheduled') {
    throw new Error(`play-in game ${game.gameId} is already resolved`);
  }
  if (home === away) {
    throw new Error(`play-in game ${game.gameId} cannot pair a team with itself`);
  }
  if (result.status === 'final') {
    if (!isNonNegativeInteger(result.homeScore) || !isNonNegativeInteger(result.awayScore)) {
      throw new Error(`play-in game ${game.gameId} scores must be non-negative integers`);
    }
    if (result.homeScore === result.awayScore) {
      throw new Error(`play-in game ${game.gameId} is tied`);
    }
    const homeWon = result.homeScore > result.awayScore;
    return {
      gameId: game.gameId,
      status: 'final',
      homeFranchiseId: home,
      awayFranchiseId: away,
      winnerFranchiseId: homeWon ? home : away,
      loserFranchiseId: homeWon ? away : home,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
    };
  }
  const loser = result.loserFranchiseId;
  if (loser !== home && loser !== away) {
    throw new Error(`play-in forfeit loser ${loser} is not a participant of ${game.gameId}`);
  }
  const winner = loser === home ? away : home;
  return {
    gameId: game.gameId,
    status: 'forfeit',
    homeFranchiseId: home,
    awayFranchiseId: away,
    winnerFranchiseId: winner,
    loserFranchiseId: loser,
    homeScore: null,
    awayScore: null,
  };
}

/** Advances a conference's Play-In: pairs the final and resolves seeds 7-8. */
function advanceConferencePlayIn(
  playIn: SeasonPostseasonState['playIn']['east'],
): SeasonPostseasonState['playIn']['east'] {
  const sevenEight = playIn.games.sevenEight;
  const nineTen = playIn.games.nineTen;
  const sevenDone = sevenEight.status !== 'scheduled';
  const nineDone = nineTen.status !== 'scheduled';
  let playoffSeeds = playIn.playoffSeeds;
  if (sevenDone && nineDone) {
    const final = playIn.games.final;
    if (final.status !== 'scheduled') {
      const ranking = playIn.ranking;
      const seedSeven = sevenEight.winnerFranchiseId;
      const seedEight = final.winnerFranchiseId;
      if (ranking === null || seedSeven === null || seedEight === null) {
        throw new Error(`${playIn.conference} play-in final resolved without complete winners`);
      }
      playoffSeeds = [...ranking.slice(0, 6), seedSeven, seedEight];
    }
  }
  return { ...playIn, playoffSeeds };
}

/**
 * Records the explicitly seeded top ten for each conference (M2.6 supplies
 * these from the regular-season ranking). Play-In matchups derive from the
 * ranking at submission time; all three games stay empty placeholders until
 * their results resolve.
 */
export function setPlayInRankings(
  state: SeasonPostseasonState,
  league: SeasonLeague,
  rankings: PostseasonRankings,
): SeasonPostseasonState {
  const playIn = { ...state.playIn };
  for (const conference of CONFERENCES) {
    const current = state.playIn[conference];
    if (current.ranking !== null) {
      throw new Error(`${conference} play-in rankings are already set`);
    }
    const ids = [...rankings[conference]];
    if (ids.length !== 10 || new Set(ids).size !== 10) {
      throw new Error(`${conference} rankings must contain exactly ten unique teams`);
    }
    const conferenceTeams = new Set(franchisesInConference(league, conference));
    for (const id of ids) {
      if (!conferenceTeams.has(id)) {
        throw new Error(`ranking team ${id} is not in the ${conference} conference`);
      }
    }
    playIn[conference] = { ...current, ranking: ids };
  }
  return { ...state, playIn };
}

/** Maps a Play-In game id to its record key. */
function playInKey(gameId: PlayInGameId): 'sevenEight' | 'nineTen' | 'final' {
  if (gameId === 'seven-eight') return 'sevenEight';
  if (gameId === 'nine-ten') return 'nineTen';
  return 'final';
}

/**
 * Submits one Play-In game result. Matchups derive from the ranking: seeds
 * 7 and 8 for the 7/8 game, 9 and 10 for the 9/10 game, and the 7/8 loser
 * hosting the 9/10 winner for the final. Only currently playable games are
 * accepted; winning is by score for finals and by forfeit loser for
 * forfeits.
 */
export function submitPlayInGame(
  state: SeasonPostseasonState,
  conference: ConferenceId,
  gameId: PlayInGameId,
  result: PlayInGameResult,
): SeasonPostseasonState {
  const playIn = state.playIn[conference];
  const ranking = playIn.ranking;
  if (ranking === null) {
    throw new Error(`${conference} play-in has no ranking`);
  }
  const key = playInKey(gameId);
  if (playIn.games[key].status !== 'scheduled') {
    throw new Error(`${conference} play-in game ${gameId} is already resolved`);
  }
  const sevenDone = playIn.games.sevenEight.status !== 'scheduled';
  const nineDone = playIn.games.nineTen.status !== 'scheduled';
  let home: string;
  let away: string;
  if (gameId === 'seven-eight') {
    home = ranking[6] ?? '';
    away = ranking[7] ?? '';
  } else if (gameId === 'nine-ten') {
    home = ranking[8] ?? '';
    away = ranking[9] ?? '';
  } else {
    if (!sevenDone || !nineDone) {
      throw new Error(`${conference} play-in final requires the 7/8 and 9/10 games first`);
    }
    home = playIn.games.sevenEight.loserFranchiseId ?? '';
    away = playIn.games.nineTen.winnerFranchiseId ?? '';
  }
  if (home === '' || away === '') {
    throw new Error(`${conference} play-in game ${gameId} has no derived matchup`);
  }
  const resolved = resolvePlayInGame(playIn.games[key], home, away, result);
  const updated = advanceConferencePlayIn({
    ...playIn,
    games: { ...playIn.games, [key]: resolved },
  });
  return { ...state, playIn: { ...state.playIn, [conference]: updated } };
}

function seededSeries(
  seriesId: string,
  round: PlayoffRound,
  conference: ConferenceId,
  homeCourtFranchiseId: string | null,
  challengerFranchiseId: string | null,
  higherSeed: number | null,
  lowerSeed: number | null,
): PlayoffSeries {
  return {
    seriesId,
    round,
    conference,
    higherSeed,
    lowerSeed,
    homeCourtFranchiseId,
    challengerFranchiseId,
    homeCourtWins: 0,
    challengerWins: 0,
    games: [],
    winnerFranchiseId: null,
  };
}

function pendingSeries(
  seriesId: string,
  round: PlayoffRound,
  conference: ConferenceId,
): PlayoffSeries {
  return seededSeries(seriesId, round, conference, null, null, null, null);
}

/** Builds one conference's bracket with first-round series and pending slots. */
function buildConferenceBracket(
  conference: ConferenceId,
  seeds: readonly string[],
): PlayoffConferenceBracket {
  const firstRound = FIRST_ROUND_PAIRS.map(([higherIndex, lowerIndex], index) => {
    const higherSeed = higherIndex + 1;
    const lowerSeed = lowerIndex + 1;
    return seededSeries(
      `${conference}-first-round-${String(index + 1)}`,
      'first-round',
      conference,
      seeds[higherIndex] ?? null,
      seeds[lowerIndex] ?? null,
      higherSeed,
      lowerSeed,
    );
  });
  return {
    conference,
    seeds: [...seeds],
    firstRound,
    semifinals: [
      pendingSeries(`${conference}-semifinal-1`, 'conference-semifinal', conference),
      pendingSeries(`${conference}-semifinal-2`, 'conference-semifinal', conference),
    ],
    conferenceFinal: pendingSeries(
      `${conference}-conference-final`,
      'conference-final',
      conference,
    ),
  };
}

/**
 * Creates the fixed playoff bracket once both conferences complete their
 * Play-In. The Finals home-court team is supplied by the caller until M2.6
 * resolves cross-conference tiebreaks; it must be one of the 16 playoff
 * teams.
 */
export function createPlayoffBracket(
  state: SeasonPostseasonState,
  league: SeasonLeague,
  finalsHomeCourtFranchiseId: string,
): SeasonPostseasonState {
  const eastSeeds = state.playIn.east.playoffSeeds;
  const westSeeds = state.playIn.west.playoffSeeds;
  if (eastSeeds === null || westSeeds === null) {
    throw new Error('both conferences must complete the Play-In before the bracket is created');
  }
  const playoffTeams = new Set([...eastSeeds, ...westSeeds]);
  if (!playoffTeams.has(finalsHomeCourtFranchiseId)) {
    throw new Error(`finals home-court team ${finalsHomeCourtFranchiseId} is not a playoff team`);
  }
  const east = buildConferenceBracket('east', eastSeeds);
  const west = buildConferenceBracket('west', westSeeds);
  const finals: PlayoffSeries = {
    seriesId: 'finals',
    round: 'finals',
    conference: null,
    higherSeed: null,
    lowerSeed: null,
    homeCourtFranchiseId: finalsHomeCourtFranchiseId,
    challengerFranchiseId: null,
    homeCourtWins: 0,
    challengerWins: 0,
    games: [],
    winnerFranchiseId: null,
  };
  const bracket: PlayoffBracket = {
    schemaVersion: 1,
    postseasonVersion: SEASON_POSTSEASON_VERSION,
    east,
    west,
    finals,
    championFranchiseId: null,
  };
  return { ...state, bracket };
}

/** All series of a bracket in fixed order: east rounds, then west, then Finals. */
function bracketSeriesOrder(bracket: PlayoffBracket): PlayoffSeries[] {
  return [
    ...bracket.east.firstRound,
    ...bracket.east.semifinals,
    bracket.east.conferenceFinal,
    ...bracket.west.firstRound,
    ...bracket.west.semifinals,
    bracket.west.conferenceFinal,
    bracket.finals,
  ];
}

/** The one series whose next game may be submitted. */
export function currentSeriesId(bracket: PlayoffBracket): string {
  const current = bracketSeriesOrder(bracket).find((series) => series.winnerFranchiseId === null);
  if (current === undefined) {
    throw new Error('the tournament is already complete');
  }
  return current.seriesId;
}

function findSeries(bracket: PlayoffBracket, seriesId: string): PlayoffSeries {
  const found = bracketSeriesOrder(bracket).find((series) => series.seriesId === seriesId);
  if (found === undefined) {
    throw new Error(`unknown series ${seriesId}`);
  }
  return found;
}

function replaceSeries(
  bracket: PlayoffBracket,
  seriesId: string,
  replacement: PlayoffSeries,
): PlayoffBracket {
  if (seriesId === 'finals') {
    return { ...bracket, finals: replacement };
  }
  const conference = seriesId.startsWith('east-') ? 'east' : 'west';
  const confBracket = conference === 'east' ? bracket.east : bracket.west;
  const updated = replaceConferenceSeries(confBracket, seriesId, replacement);
  return conference === 'east' ? { ...bracket, east: updated } : { ...bracket, west: updated };
}

function replaceConferenceSeries(
  confBracket: PlayoffConferenceBracket,
  seriesId: string,
  replacement: PlayoffSeries,
): PlayoffConferenceBracket {
  if (seriesId === `${confBracket.conference}-conference-final`) {
    return { ...confBracket, conferenceFinal: replacement };
  }
  const name = seriesId.slice(confBracket.conference.length + 1);
  if (name.startsWith('first-round-')) {
    const index = Number(name.slice('first-round-'.length)) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= confBracket.firstRound.length) {
      throw new Error(`unknown series ${seriesId}`);
    }
    return {
      ...confBracket,
      firstRound: confBracket.firstRound.map((series, i) => (i === index ? replacement : series)),
    };
  }
  if (name.startsWith('semifinal-')) {
    const index = Number(name.slice('semifinal-'.length)) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= confBracket.semifinals.length) {
      throw new Error(`unknown series ${seriesId}`);
    }
    return {
      ...confBracket,
      semifinals: confBracket.semifinals.map((series, i) => (i === index ? replacement : series)),
    };
  }
  throw new Error(`unknown series ${seriesId}`);
}

/** The seed number of a completed series' winner, or null when unknown. */
function winnerSeedOf(series: PlayoffSeries): number | null {
  const winner = series.winnerFranchiseId;
  if (winner === null || series.higherSeed === null || series.lowerSeed === null) {
    return null;
  }
  return winner === series.homeCourtFranchiseId ? series.higherSeed : series.lowerSeed;
}

/** Pairs a pending slot from its two advancing teams, home court to the higher seed. */
function pairSeries(
  slot: PlayoffSeries,
  sideA: { team: string; seed: number | null },
  sideB: { team: string; seed: number | null },
): PlayoffSeries {
  const aHigher = sideA.seed !== null && sideB.seed !== null && sideA.seed < sideB.seed;
  const homeSide = aHigher ? sideA : sideB;
  const awaySide = aHigher ? sideB : sideA;
  return {
    ...slot,
    homeCourtFranchiseId: homeSide.team,
    challengerFranchiseId: awaySide.team,
    higherSeed: homeSide.seed,
    lowerSeed: awaySide.seed,
  };
}

/** Advances a completed series' winner into its fixed next-round slot. */
function advanceWinner(bracket: PlayoffBracket, seriesId: string, winner: string): PlayoffBracket {
  const conference = seriesId.startsWith('east-') ? 'east' : 'west';
  const confBracket = conference === 'east' ? bracket.east : bracket.west;

  if (seriesId.startsWith(`${conference}-first-round-`)) {
    const index = Number(seriesId.slice(`${conference}-first-round-`.length)) - 1;
    const semifinalIndex = Math.floor(index / 2);
    const semifinal = confBracket.semifinals[semifinalIndex];
    if (semifinal === undefined) throw new Error(`no semifinal slot for ${seriesId}`);
    const feed = confBracket.firstRound[index];
    const side = index % 2 === 0 ? 'home' : 'away';
    const nextSlot: PlayoffSeries =
      side === 'home'
        ? { ...semifinal, homeCourtFranchiseId: winner }
        : { ...semifinal, challengerFranchiseId: winner };
    const otherIndex = index % 2 === 0 ? index + 1 : index - 1;
    const other = confBracket.firstRound[otherIndex];
    let paired = nextSlot;
    if (nextSlot.homeCourtFranchiseId !== null && nextSlot.challengerFranchiseId !== null) {
      if (other === undefined || feed === undefined || other.winnerFranchiseId === null) {
        throw new Error(`first-round winner ${winner} cannot pair a semifinal`);
      }
      paired = pairSeries(
        nextSlot,
        { team: winner, seed: winnerSeedOf(feed) },
        {
          team: other.winnerFranchiseId,
          seed: winnerSeedOf(other),
        },
      );
    }
    const confUpdated = {
      ...confBracket,
      semifinals: confBracket.semifinals.map((series, i) =>
        i === semifinalIndex ? paired : series,
      ),
    };
    return conference === 'east'
      ? { ...bracket, east: confUpdated }
      : { ...bracket, west: confUpdated };
  }

  if (seriesId.startsWith(`${conference}-semifinal-`)) {
    const index = Number(seriesId.slice(`${conference}-semifinal-`.length)) - 1;
    const side = index === 0 ? 'home' : 'away';
    const nextSlot: PlayoffSeries =
      side === 'home'
        ? { ...confBracket.conferenceFinal, homeCourtFranchiseId: winner }
        : { ...confBracket.conferenceFinal, challengerFranchiseId: winner };
    const otherIndex = index === 0 ? 1 : 0;
    const other = confBracket.semifinals[otherIndex];
    const current = confBracket.semifinals[index];
    let paired = nextSlot;
    if (nextSlot.homeCourtFranchiseId !== null && nextSlot.challengerFranchiseId !== null) {
      if (other === undefined || current === undefined || other.winnerFranchiseId === null) {
        throw new Error(`semifinal winner ${winner} cannot pair the conference final`);
      }
      paired = pairSeries(
        nextSlot,
        { team: winner, seed: winnerSeedOf(current) },
        {
          team: other.winnerFranchiseId,
          seed: winnerSeedOf(other),
        },
      );
    }
    const confUpdated = { ...confBracket, conferenceFinal: paired };
    return conference === 'east'
      ? { ...bracket, east: confUpdated }
      : { ...bracket, west: confUpdated };
  }

  if (seriesId === `${conference}-conference-final`) {
    const finals = bracket.finals;
    const homeIsEast = bracket.east.seeds.includes(finals.homeCourtFranchiseId ?? '');
    let paired: PlayoffSeries;
    if (homeIsEast) {
      paired =
        conference === 'east'
          ? { ...finals, homeCourtFranchiseId: winner }
          : { ...finals, challengerFranchiseId: winner };
    } else {
      paired =
        conference === 'east'
          ? { ...finals, challengerFranchiseId: winner }
          : { ...finals, homeCourtFranchiseId: winner };
    }
    const otherConference = conference === 'east' ? 'west' : 'east';
    const otherWinner = (otherConference === 'east' ? bracket.east : bracket.west).conferenceFinal
      .winnerFranchiseId;
    if (otherWinner !== null) {
      const otherRepIsHome = otherConference === 'east' ? homeIsEast : !homeIsEast;
      paired = otherRepIsHome
        ? { ...paired, homeCourtFranchiseId: otherWinner }
        : { ...paired, challengerFranchiseId: otherWinner };
      if (paired.homeCourtFranchiseId === null || paired.challengerFranchiseId === null) {
        throw new Error('finals pairing is incomplete');
      }
    }
    return { ...bracket, finals: paired };
  }

  throw new Error(`cannot advance unknown series ${seriesId}`);
}

/**
 * Submits one playoff game. Only the current series may receive a result;
 * the series stops immediately at four wins, games follow the 2-2-1-1-1 home
 * pattern, and the winner advances into its fixed bracket slot.
 */
export function submitPlayoffGame(
  state: SeasonPostseasonState,
  seriesId: string,
  result: PlayoffGameResult,
): SeasonPostseasonState {
  const bracket = state.bracket;
  if (bracket === null) {
    throw new Error('no playoff bracket exists');
  }
  const current = currentSeriesId(bracket);
  if (seriesId !== current) {
    throw new Error(`series ${seriesId} is not the current series (current is ${current})`);
  }
  const series = findSeries(bracket, seriesId);
  const homeCourt = series.homeCourtFranchiseId;
  const challenger = series.challengerFranchiseId;
  if (homeCourt === null || challenger === null) {
    throw new Error(`series ${seriesId} is not paired`);
  }
  if (series.winnerFranchiseId !== null) {
    throw new Error(`series ${seriesId} already has a winner`);
  }
  const gameNumber = series.games.length + 1;
  if (gameNumber > 7) {
    throw new Error(`series ${seriesId} cannot play more than seven games`);
  }
  const home = HOME_COURT_GAMES.has(gameNumber) ? homeCourt : challenger;
  const away = home === homeCourt ? challenger : homeCourt;

  let winner: string;
  let game: PlayoffSeriesGame;
  if (result.status === 'final') {
    if (!isNonNegativeInteger(result.homeScore) || !isNonNegativeInteger(result.awayScore)) {
      throw new Error(`series ${seriesId} scores must be non-negative integers`);
    }
    if (result.homeScore === result.awayScore) {
      throw new Error(`series ${seriesId} game ${String(gameNumber)} is tied`);
    }
    winner = result.homeScore > result.awayScore ? home : away;
    game = {
      gameNumber,
      homeFranchiseId: home,
      awayFranchiseId: away,
      status: 'final',
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      winnerFranchiseId: winner,
    };
  } else {
    winner = result.winnerFranchiseId;
    if (winner !== homeCourt && winner !== challenger) {
      throw new Error(`series ${seriesId} forfeit winner must be a participant`);
    }
    game = {
      gameNumber,
      homeFranchiseId: home,
      awayFranchiseId: away,
      status: 'forfeit',
      homeScore: null,
      awayScore: null,
      winnerFranchiseId: winner,
    };
  }

  const homeCourtWins = series.homeCourtWins + (winner === homeCourt ? 1 : 0);
  const challengerWins = series.challengerWins + (winner === challenger ? 1 : 0);
  const completed = homeCourtWins === 4 || challengerWins === 4;
  const updatedSeries: PlayoffSeries = {
    ...series,
    homeCourtWins,
    challengerWins,
    games: [...series.games, game],
    winnerFranchiseId: completed ? winner : null,
  };

  let updatedBracket = replaceSeries(bracket, seriesId, updatedSeries);
  if (completed && seriesId !== 'finals') {
    updatedBracket = advanceWinner(updatedBracket, seriesId, winner);
  }
  const champion = completed && seriesId === 'finals' ? winner : updatedBracket.championFranchiseId;
  return {
    ...state,
    championFranchiseId: champion,
    bracket: { ...updatedBracket, championFranchiseId: champion },
  };
}

function auditPlayInGame(
  conference: ConferenceId,
  gameId: PlayInGameId,
  game: PlayInGame,
  failures: string[],
): void {
  const label = `${conference} play-in ${gameId}`;
  if (game.status === 'scheduled') {
    return;
  }
  const home = game.homeFranchiseId;
  const away = game.awayFranchiseId;
  const winner = game.winnerFranchiseId;
  const loser = game.loserFranchiseId;
  if (home === null || away === null || home === away) {
    failures.push(`${label} played game must name two teams`);
    return;
  }
  if (winner !== home && winner !== away) {
    failures.push(`${label} winner must be a participant`);
  }
  if (loser !== home && loser !== away) {
    failures.push(`${label} loser must be a participant`);
  }
  if (winner !== null && winner === loser) {
    failures.push(`${label} winner and loser must differ`);
  }
  if (game.status === 'final') {
    if (game.homeScore === null || game.awayScore === null) {
      failures.push(`${label} final must carry scores`);
    } else if (game.homeScore === game.awayScore) {
      failures.push(`${label} final is tied`);
    } else {
      const homeWon = game.homeScore > game.awayScore;
      if ((homeWon && winner !== home) || (!homeWon && winner !== away)) {
        failures.push(`${label} winner must match the score`);
      }
    }
  } else if (game.homeScore !== null || game.awayScore !== null) {
    failures.push(`${label} forfeit carries no scores`);
  }
}

function auditPlayInConference(
  conference: ConferenceId,
  playIn: SeasonPostseasonState['playIn']['east'],
  league: SeasonLeague,
  failures: string[],
): void {
  const ranking = playIn.ranking;
  if (ranking !== null) {
    if (ranking.length !== 10 || new Set(ranking).size !== 10) {
      failures.push(`${conference} ranking must contain ten unique teams`);
    }
    const conferenceTeams = new Set(franchisesInConference(league, conference));
    for (const id of ranking) {
      if (!conferenceTeams.has(id)) {
        failures.push(`${conference} ranking team ${id} is not in the conference`);
      }
    }
  }
  auditPlayInGame(conference, 'seven-eight', playIn.games.sevenEight, failures);
  auditPlayInGame(conference, 'nine-ten', playIn.games.nineTen, failures);
  auditPlayInGame(conference, 'final', playIn.games.final, failures);

  // Resolved games must match their ranking-derived matchups.
  const sevenEight = playIn.games.sevenEight;
  const nineTen = playIn.games.nineTen;
  const final = playIn.games.final;
  if (sevenEight.status !== 'scheduled') {
    if (
      sevenEight.homeFranchiseId !== (ranking?.[6] ?? null) ||
      sevenEight.awayFranchiseId !== (ranking?.[7] ?? null)
    ) {
      failures.push(`${conference} 7/8 game must match ranking seeds 7 and 8`);
    }
  }
  if (nineTen.status !== 'scheduled') {
    if (
      nineTen.homeFranchiseId !== (ranking?.[8] ?? null) ||
      nineTen.awayFranchiseId !== (ranking?.[9] ?? null)
    ) {
      failures.push(`${conference} 9/10 game must match ranking seeds 9 and 10`);
    }
  }
  const sevenDone = sevenEight.status !== 'scheduled';
  const nineDone = nineTen.status !== 'scheduled';
  const finalDone = final.status !== 'scheduled';
  if (finalDone && !(sevenDone && nineDone)) {
    failures.push(`${conference} play-in final resolved before its qualifiers`);
  }
  if (finalDone) {
    if (final.homeFranchiseId !== sevenEight.loserFranchiseId) {
      failures.push(`${conference} play-in final home must be the 7/8 loser`);
    }
    if (final.awayFranchiseId !== nineTen.winnerFranchiseId) {
      failures.push(`${conference} play-in final away must be the 9/10 winner`);
    }
  }

  const seeds = playIn.playoffSeeds;
  if (seeds !== null) {
    if (ranking === null || !sevenDone || !nineDone || !finalDone) {
      failures.push(`${conference} playoff seeds must resolve only when the Play-In completes`);
    } else {
      const expected = [
        ...ranking.slice(0, 6),
        playIn.games.sevenEight.winnerFranchiseId,
        playIn.games.final.winnerFranchiseId,
      ];
      const expectedIds = expected.map((id) => id ?? null);
      if (
        expectedIds.some((id) => id === null) ||
        seeds.length !== expectedIds.length ||
        seeds.some((id, i) => id !== expectedIds[i])
      ) {
        failures.push(
          `${conference} playoff seeds must be seeds 1-6 plus the 7/8 and final winners`,
        );
      }
    }
    if (new Set(seeds).size !== 8) {
      failures.push(`${conference} playoff seeds must be eight unique teams`);
    }
  } else if (finalDone) {
    failures.push(`${conference} Play-In completed without playoff seeds`);
  }
}

function auditSeries(series: PlayoffSeries, failures: string[], label: string): void {
  if (series.games.length !== series.homeCourtWins + series.challengerWins) {
    failures.push(`${label} series wins must equal played games`);
  }
  const home = series.homeCourtFranchiseId;
  const away = series.challengerFranchiseId;
  if (home === null || away === null) {
    if (
      series.games.length > 0 ||
      series.winnerFranchiseId !== null ||
      series.homeCourtWins + series.challengerWins > 0
    ) {
      failures.push(`${label} unpaired series must be untouched`);
    }
    return;
  }
  if (home === away) {
    failures.push(`${label} series cannot pair a team with itself`);
  }
  if (series.higherSeed !== null && series.lowerSeed !== null) {
    if (series.higherSeed >= series.lowerSeed) {
      failures.push(`${label} home court must belong to the higher seed`);
    }
  }
  series.games.forEach((game, index) => {
    const gameNumber = index + 1;
    if (game.gameNumber !== gameNumber) {
      failures.push(`${label} game ${String(game.gameNumber)} is out of sequence`);
    }
    const expectedHome = HOME_COURT_GAMES.has(gameNumber) ? home : away;
    const expectedAway = expectedHome === home ? away : home;
    if (game.homeFranchiseId !== expectedHome || game.awayFranchiseId !== expectedAway) {
      failures.push(`${label} game ${String(gameNumber)} breaks the 2-2-1-1-1 home pattern`);
    }
    if (game.winnerFranchiseId !== home && game.winnerFranchiseId !== away) {
      failures.push(`${label} game ${String(gameNumber)} winner must be a participant`);
    }
    if (game.status === 'final') {
      if (game.homeScore === null || game.awayScore === null) {
        failures.push(`${label} game ${String(gameNumber)} final must carry scores`);
      } else if (game.homeScore === game.awayScore) {
        failures.push(`${label} game ${String(gameNumber)} is tied`);
      } else {
        const expectedWinner =
          game.homeScore > game.awayScore ? game.homeFranchiseId : game.awayFranchiseId;
        if (game.winnerFranchiseId !== expectedWinner) {
          failures.push(`${label} game ${String(gameNumber)} winner must match the score`);
        }
      }
    } else if (game.homeScore !== null || game.awayScore !== null) {
      failures.push(`${label} game ${String(gameNumber)} forfeit carries no scores`);
    }
  });
  const homeWinsFromGames = series.games.filter((game) => game.winnerFranchiseId === home).length;
  const awayWinsFromGames = series.games.filter((game) => game.winnerFranchiseId === away).length;
  if (homeWinsFromGames !== series.homeCourtWins || awayWinsFromGames !== series.challengerWins) {
    failures.push(`${label} series wins must match game winners`);
  }
  if (series.winnerFranchiseId !== null) {
    if (series.homeCourtWins !== 4 && series.challengerWins !== 4) {
      failures.push(`${label} winner requires four wins`);
    } else {
      const expectedWinner = series.homeCourtWins === 4 ? home : away;
      if (series.winnerFranchiseId !== expectedWinner) {
        failures.push(`${label} winner must be the four-win side`);
      }
    }
  } else if (series.homeCourtWins === 4 || series.challengerWins === 4) {
    failures.push(`${label} series must name its winner at four wins`);
  }
}

function auditBracket(
  state: SeasonPostseasonState,
  league: SeasonLeague,
  failures: string[],
): void {
  const bracket = state.bracket;
  if (bracket === null) {
    if (state.championFranchiseId !== null) {
      failures.push('champion cannot exist without a bracket');
    }
    return;
  }
  const leagueTeams = new Set(league.teams.map((team) => team.franchiseId));
  for (const conference of CONFERENCES) {
    const conf = conference === 'east' ? bracket.east : bracket.west;
    const seeds = state.playIn[conference].playoffSeeds;
    if (seeds === null) {
      failures.push(`${conference} bracket exists without playoff seeds`);
      continue;
    }
    if (conf.seeds.length !== seeds.length || conf.seeds.some((id, i) => id !== seeds[i])) {
      failures.push(`${conference} bracket seeds must match the playoff seeds`);
    }
    const distinct = new Set(conf.seeds);
    if (distinct.size !== 8) {
      failures.push(`${conference} bracket must contain eight distinct teams`);
    }
    for (const id of conf.seeds) {
      if (!leagueTeams.has(id)) {
        failures.push(`${conference} bracket team ${id} is not a league franchise`);
      }
    }
    conf.firstRound.forEach((series, index) => {
      auditSeries(series, failures, `${conference} first-round ${String(index + 1)}`);
      const pair = FIRST_ROUND_PAIRS[index];
      if (pair === undefined) return;
      const [higherIndex, lowerIndex] = pair;
      const home = conf.seeds[higherIndex] ?? null;
      const away = conf.seeds[lowerIndex] ?? null;
      if (series.homeCourtFranchiseId !== home || series.challengerFranchiseId !== away) {
        failures.push(
          `${conference} first-round ${String(index + 1)} must pair seeds ${String(higherIndex + 1)} and ${String(lowerIndex + 1)}`,
        );
      }
      if (series.higherSeed !== higherIndex + 1 || series.lowerSeed !== lowerIndex + 1) {
        failures.push(
          `${conference} first-round ${String(index + 1)} seed numbers must match its pairing`,
        );
      }
    });
    conf.semifinals.forEach((series, index) => {
      auditSeries(series, failures, `${conference} semifinal ${String(index + 1)}`);
      const feedA = conf.firstRound[index * 2];
      const feedB = conf.firstRound[index * 2 + 1];
      if (feedA === undefined || feedB === undefined) return;
      if (feedA.winnerFranchiseId !== null && feedB.winnerFranchiseId !== null) {
        const teamA = feedA.winnerFranchiseId;
        const teamB = feedB.winnerFranchiseId;
        if (series.homeCourtFranchiseId === null || series.challengerFranchiseId === null) {
          failures.push(
            `${conference} semifinal ${String(index + 1)} must be paired after the first round`,
          );
        } else {
          const teams = new Set([series.homeCourtFranchiseId, series.challengerFranchiseId]);
          if (teams.size !== 2 || !teams.has(teamA) || !teams.has(teamB)) {
            failures.push(
              `${conference} semifinal ${String(index + 1)} must match its first-round winners`,
            );
          } else {
            const seedA = winnerSeedOf(feedA);
            const seedB = winnerSeedOf(feedB);
            if (seedA !== null && seedB !== null) {
              const expectedHome = seedA < seedB ? teamA : teamB;
              if (series.homeCourtFranchiseId !== expectedHome) {
                failures.push(
                  `${conference} semifinal ${String(index + 1)} home court must be the higher seed`,
                );
              }
            }
          }
        }
      }
    });
    auditSeries(conf.conferenceFinal, failures, `${conference} conference final`);
    const semifinalA = conf.semifinals[0];
    const semifinalB = conf.semifinals[1];
    if (
      semifinalA !== undefined &&
      semifinalB !== undefined &&
      semifinalA.winnerFranchiseId !== null &&
      semifinalB.winnerFranchiseId !== null
    ) {
      const teamA = semifinalA.winnerFranchiseId;
      const teamB = semifinalB.winnerFranchiseId;
      if (
        conf.conferenceFinal.homeCourtFranchiseId === null ||
        conf.conferenceFinal.challengerFranchiseId === null
      ) {
        failures.push(`${conference} conference final must be paired after the semifinals`);
      } else {
        const teams = new Set([
          conf.conferenceFinal.homeCourtFranchiseId,
          conf.conferenceFinal.challengerFranchiseId,
        ]);
        if (teams.size !== 2 || !teams.has(teamA) || !teams.has(teamB)) {
          failures.push(`${conference} conference final must match its semifinal winners`);
        } else {
          const seedA = winnerSeedOf(semifinalA);
          const seedB = winnerSeedOf(semifinalB);
          if (seedA !== null && seedB !== null) {
            const expectedHome = seedA < seedB ? teamA : teamB;
            if (conf.conferenceFinal.homeCourtFranchiseId !== expectedHome) {
              failures.push(`${conference} conference final home court must be the higher seed`);
            }
          }
        }
      }
    }
  }

  auditSeries(bracket.finals, failures, 'finals');
  const eastChampion = bracket.east.conferenceFinal.winnerFranchiseId;
  const westChampion = bracket.west.conferenceFinal.winnerFranchiseId;
  if (eastChampion !== null && westChampion !== null) {
    if (eastChampion === westChampion) {
      failures.push('finals teams must come from different conferences');
    }
    if (
      bracket.finals.homeCourtFranchiseId === null ||
      bracket.finals.challengerFranchiseId === null
    ) {
      failures.push('finals must be paired after the conference finals');
    } else {
      const teams = new Set([
        bracket.finals.homeCourtFranchiseId,
        bracket.finals.challengerFranchiseId,
      ]);
      if (!teams.has(eastChampion) || !teams.has(westChampion)) {
        failures.push('finals teams must be the conference champions');
      }
    }
  }
  if (bracket.championFranchiseId !== bracket.finals.winnerFranchiseId) {
    failures.push('bracket champion must match the finals winner');
  }
  if (state.championFranchiseId !== bracket.championFranchiseId) {
    failures.push('state champion must match the bracket champion');
  }

  let incompleteSeen = false;
  for (const series of bracketSeriesOrder(bracket)) {
    if (series.winnerFranchiseId === null) {
      incompleteSeen = true;
      if (
        series.games.length > 0 &&
        (series.homeCourtFranchiseId === null || series.challengerFranchiseId === null)
      ) {
        failures.push(`${series.seriesId} started without teams`);
      }
    } else if (incompleteSeen) {
      failures.push(`${series.seriesId} completed before an earlier series`);
    }
  }
}

/**
 * Audits a postseason state against the frozen postseason rules. Returns a
 * failure list; an empty list means every Play-In branch, pairing, series
 * score line, home pattern, advancement, and champion fact is consistent.
 */
export function auditSeasonPostseason(
  state: SeasonPostseasonState,
  league: SeasonLeague,
): string[] {
  const failures: string[] = [];
  const parsed = seasonPostseasonStateSchema.safeParse(state);
  if (!parsed.success) {
    failures.push(`postseason fails the schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  }
  for (const conference of CONFERENCES) {
    auditPlayInConference(conference, state.playIn[conference], league, failures);
  }
  auditBracket(state, league, failures);
  return failures;
}
