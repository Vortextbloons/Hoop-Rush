import {
  SEASON_POSTSEASON_VERSION,
  franchiseIdSchema,
  idSchema,
  parsePlayoffGameId,
  seasonDigestHex,
  seedSchema,
  type ConferenceId,
  type FranchiseId,
  type PlayoffBracket,
  type PlayoffConferenceBracket,
  type PlayoffRound,
  type PlayoffSeries,
  type PlayoffSeriesGame,
  type SeasonLeague,
  type SeasonPostseasonState,
  type SeasonStandings,
  type SeasonTiebreakResolution,
} from '@hoop-rush/data-contracts';
import { createRng } from '../../sim/rng.ts';
import { conferenceOf } from '../league.ts';
import { FIRST_ROUND_PAIRS, HOME_COURT_GAMES } from './constants.ts';
import { SeasonPostseasonInvariantError } from './errors.ts';
import type { SeasonPostseasonGameFacts } from './types.ts';

function buildConferenceBracket(
  conference: ConferenceId,
  seeds: readonly FranchiseId[],
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
function seededSeries(
  seriesId: string,
  round: PlayoffRound,
  conference: ConferenceId,
  homeCourtFranchiseId: FranchiseId | string | null,
  challengerFranchiseId: FranchiseId | string | null,
  higherSeed: number | null,
  lowerSeed: number | null,
): PlayoffSeries {
  return {
    seriesId: idSchema.parse(seriesId),
    round,
    conference,
    higherSeed,
    lowerSeed,
    homeCourtFranchiseId:
      homeCourtFranchiseId === null ? null : franchiseIdSchema.parse(homeCourtFranchiseId),
    challengerFranchiseId:
      challengerFranchiseId === null ? null : franchiseIdSchema.parse(challengerFranchiseId),
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
export function createSeasonPlayoffBracket(state: SeasonPostseasonState): SeasonPostseasonState {
  const eastSeeds = state.playIn.east.playoffSeeds;
  const westSeeds = state.playIn.west.playoffSeeds;
  if (eastSeeds === null || westSeeds === null) {
    throw new SeasonPostseasonInvariantError(
      'both conferences must complete the Play-In before the bracket is created',
    );
  }
  const bracket: PlayoffBracket = {
    schemaVersion: 1,
    postseasonVersion: SEASON_POSTSEASON_VERSION,
    east: buildConferenceBracket('east', eastSeeds),
    west: buildConferenceBracket('west', westSeeds),
    finals: {
      seriesId: idSchema.parse('finals'),
      round: 'finals',
      conference: null,
      higherSeed: null,
      lowerSeed: null,
      homeCourtFranchiseId: null,
      challengerFranchiseId: null,
      homeCourtWins: 0,
      challengerWins: 0,
      games: [],
      winnerFranchiseId: null,
    },
    championFranchiseId: null,
  };
  return { ...state, bracket };
}
export function bracketSeriesOrder(bracket: PlayoffBracket): PlayoffSeries[] {
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
export function findSeriesOrNull(
  bracket: PlayoffBracket | null,
  seriesId: string,
): PlayoffSeries | null {
  if (bracket === null) return null;
  return bracketSeriesOrder(bracket).find((series) => series.seriesId === seriesId) ?? null;
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
      throw new SeasonPostseasonInvariantError(`unknown series ${seriesId}`);
    }
    return {
      ...confBracket,
      firstRound: confBracket.firstRound.map((series, i) => (i === index ? replacement : series)),
    };
  }
  if (name.startsWith('semifinal-')) {
    const index = Number(name.slice('semifinal-'.length)) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= confBracket.semifinals.length) {
      throw new SeasonPostseasonInvariantError(`unknown series ${seriesId}`);
    }
    return {
      ...confBracket,
      semifinals: confBracket.semifinals.map((series, i) => (i === index ? replacement : series)),
    };
  }
  throw new SeasonPostseasonInvariantError(`unknown series ${seriesId}`);
}
function winnerSeedOf(series: PlayoffSeries): number | null {
  const winner = series.winnerFranchiseId;
  if (winner === null || series.higherSeed === null || series.lowerSeed === null) {
    return null;
  }
  return winner === series.homeCourtFranchiseId ? series.higherSeed : series.lowerSeed;
}
function pairSeededSeries(
  slot: PlayoffSeries,
  sideA: {
    team: FranchiseId;
    seed: number | null;
  },
  sideB: {
    team: FranchiseId;
    seed: number | null;
  },
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
function advanceSeriesWinner(
  bracket: PlayoffBracket,
  seriesId: string,
  winner: string,
): PlayoffBracket {
  const winnerId = franchiseIdSchema.parse(winner);
  const conference = seriesId.startsWith('east-') ? 'east' : 'west';
  const confBracket = conference === 'east' ? bracket.east : bracket.west;
  if (seriesId.startsWith(`${conference}-first-round-`)) {
    const index = Number(seriesId.slice(`${conference}-first-round-`.length)) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= confBracket.firstRound.length) {
      throw new SeasonPostseasonInvariantError(`unknown series ${seriesId}`);
    }
    const semifinalIndex = Math.floor(index / 2);
    const semifinal = confBracket.semifinals[semifinalIndex];
    const feed = confBracket.firstRound[index];
    if (semifinal === undefined || feed === undefined) {
      throw new SeasonPostseasonInvariantError(`no semifinal slot for ${seriesId}`);
    }
    const side = index % 2 === 0 ? 'home' : 'away';
    const nextSlot: PlayoffSeries =
      side === 'home'
        ? { ...semifinal, homeCourtFranchiseId: winnerId }
        : { ...semifinal, challengerFranchiseId: winnerId };
    const otherIndex = index % 2 === 0 ? index + 1 : index - 1;
    const other = confBracket.firstRound[otherIndex];
    let paired = nextSlot;
    if (nextSlot.homeCourtFranchiseId !== null && nextSlot.challengerFranchiseId !== null) {
      if (other === undefined || other.winnerFranchiseId === null) {
        throw new SeasonPostseasonInvariantError(
          `first-round winner ${winnerId} cannot pair a semifinal`,
        );
      }
      paired = pairSeededSeries(
        nextSlot,
        { team: winnerId, seed: winnerSeedOf(feed) },
        { team: other.winnerFranchiseId, seed: winnerSeedOf(other) },
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
    if (!Number.isInteger(index) || index < 0 || index >= confBracket.semifinals.length) {
      throw new SeasonPostseasonInvariantError(`unknown series ${seriesId}`);
    }
    const current = confBracket.semifinals[index];
    const other = confBracket.semifinals[index === 0 ? 1 : 0];
    if (current === undefined || other === undefined) {
      throw new SeasonPostseasonInvariantError(`no semifinal series for ${seriesId}`);
    }
    const side = index === 0 ? 'home' : 'away';
    const nextSlot: PlayoffSeries =
      side === 'home'
        ? { ...confBracket.conferenceFinal, homeCourtFranchiseId: winnerId }
        : { ...confBracket.conferenceFinal, challengerFranchiseId: winnerId };
    let paired = nextSlot;
    if (nextSlot.homeCourtFranchiseId !== null && nextSlot.challengerFranchiseId !== null) {
      if (other.winnerFranchiseId === null) {
        throw new SeasonPostseasonInvariantError(
          `semifinal winner ${winnerId} cannot pair the conference final`,
        );
      }
      paired = pairSeededSeries(
        nextSlot,
        { team: winnerId, seed: winnerSeedOf(current) },
        { team: other.winnerFranchiseId, seed: winnerSeedOf(other) },
      );
    }
    const confUpdated = { ...confBracket, conferenceFinal: paired };
    return conference === 'east'
      ? { ...bracket, east: confUpdated }
      : { ...bracket, west: confUpdated };
  }
  if (seriesId === `${conference}-conference-final`) {
    return bracket;
  }
  throw new SeasonPostseasonInvariantError(`cannot advance unknown series ${seriesId}`);
}
export function decideSeasonFinalsHomeCourt(input: {
  league: SeasonLeague;
  standings: SeasonStandings;
  eastChampionFranchiseId: string;
  westChampionFranchiseId: string;
  drawSeed: string;
}): {
  homeCourtFranchiseId: string;
  resolution: SeasonTiebreakResolution;
} {
  const { league, standings } = input;
  const east = franchiseIdSchema.parse(input.eastChampionFranchiseId);
  const west = franchiseIdSchema.parse(input.westChampionFranchiseId);
  const rowOf = (franchiseId: FranchiseId) =>
    standings.rows.find((row) => row.franchiseId === franchiseId);
  const eastRow = rowOf(east);
  const westRow = rowOf(west);
  if (eastRow === undefined || westRow === undefined) {
    throw new SeasonPostseasonInvariantError(
      'finals home-court decision requires standings rows for both champions',
    );
  }
  let homeCourtFranchiseId: FranchiseId;
  let rule: 'overall-record' | 'head-to-head' | 'points-differential' | 'random-draw';
  let evidence: SeasonTiebreakResolution['evidence'];
  const crossProduct = eastRow.wins * westRow.losses - westRow.wins * eastRow.losses;
  if (crossProduct > 0) {
    homeCourtFranchiseId = east;
    rule = 'overall-record';
    evidence = [
      {
        label: 'overall record',
        value: `${String(eastRow.wins)}-${String(eastRow.losses)} vs ${String(westRow.wins)}-${String(westRow.losses)}`,
      },
    ];
  } else if (crossProduct < 0) {
    homeCourtFranchiseId = west;
    rule = 'overall-record';
    evidence = [
      {
        label: 'overall record',
        value: `${String(westRow.wins)}-${String(westRow.losses)} vs ${String(eastRow.wins)}-${String(eastRow.losses)}`,
      },
    ];
  } else {
    const eastH2h = eastRow.headToHead.find((entry) => entry.franchiseId === west);
    const westH2h = westRow.headToHead.find((entry) => entry.franchiseId === east);
    if (eastH2h === undefined || westH2h === undefined) {
      throw new SeasonPostseasonInvariantError(
        'finals home-court decision requires head-to-head records',
      );
    }
    if (eastH2h.wins > westH2h.wins) {
      homeCourtFranchiseId = east;
      rule = 'head-to-head';
      evidence = [
        {
          label: 'head-to-head record',
          value: `${String(eastH2h.wins)}-${String(eastH2h.losses)}`,
        },
      ];
    } else if (eastH2h.wins < westH2h.wins) {
      homeCourtFranchiseId = west;
      rule = 'head-to-head';
      evidence = [
        {
          label: 'head-to-head record',
          value: `${String(westH2h.wins)}-${String(westH2h.losses)}`,
        },
      ];
    } else {
      const eastDifferential = eastRow.pointsFor - eastRow.pointsAgainst;
      const westDifferential = westRow.pointsFor - westRow.pointsAgainst;
      if (eastDifferential > westDifferential) {
        homeCourtFranchiseId = east;
        rule = 'points-differential';
        evidence = [{ label: 'points differential', value: eastDifferential }];
      } else if (eastDifferential < westDifferential) {
        homeCourtFranchiseId = west;
        rule = 'points-differential';
        evidence = [{ label: 'points differential', value: westDifferential }];
      } else {
        homeCourtFranchiseId = createRng(input.drawSeed).chance(0.5) ? east : west;
        rule = 'random-draw';
        evidence = [{ label: 'deciding rule', value: 'random-draw' }];
      }
    }
  }
  const challenger = homeCourtFranchiseId === east ? west : east;
  const resolution: SeasonTiebreakResolution = {
    resolutionId: idSchema.parse(
      `tb-finals-home-court-${seasonDigestHex([east, west, input.drawSeed, rule].join('\u0000'))}`,
    ),
    conference: conferenceOf(league, homeCourtFranchiseId),
    kind: 'finals-home-court',
    rule,
    teams: [homeCourtFranchiseId, challenger],
    slots: [1],
    evidence,
    drawSeed: rule === 'random-draw' ? seedSchema.parse(input.drawSeed) : null,
  };
  return { homeCourtFranchiseId, resolution };
}
function pairFinals(
  bracket: PlayoffBracket,
  league: SeasonLeague,
  standings: SeasonStandings,
  drawSeed: string,
): {
  bracket: PlayoffBracket;
  resolution: SeasonTiebreakResolution;
} {
  const eastChamp = bracket.east.conferenceFinal.winnerFranchiseId;
  const westChamp = bracket.west.conferenceFinal.winnerFranchiseId;
  if (eastChamp === null || westChamp === null) {
    throw new SeasonPostseasonInvariantError('finals pairing requires both conference champions');
  }
  if (eastChamp === westChamp) {
    throw new SeasonPostseasonInvariantError('finals teams must come from different conferences');
  }
  const decision = decideSeasonFinalsHomeCourt({
    league,
    standings,
    eastChampionFranchiseId: eastChamp,
    westChampionFranchiseId: westChamp,
    drawSeed,
  });
  const homeCourtId = franchiseIdSchema.parse(decision.homeCourtFranchiseId);
  const challenger = homeCourtId === eastChamp ? westChamp : eastChamp;
  return {
    bracket: {
      ...bracket,
      finals: {
        ...bracket.finals,
        homeCourtFranchiseId: homeCourtId,
        challengerFranchiseId: challenger,
      },
    },
    resolution: decision.resolution,
  };
}
export function applyPlayoffGameResult(
  state: SeasonPostseasonState,
  facts: SeasonPostseasonGameFacts,
  league: SeasonLeague,
  standings: SeasonStandings,
): SeasonPostseasonState {
  const bracket = state.bracket;
  if (bracket === null) {
    throw new SeasonPostseasonInvariantError('no playoff bracket exists');
  }
  const parsed = parsePlayoffGameId(facts.gameId);
  if (parsed === null) {
    throw new SeasonPostseasonInvariantError(`malformed playoff game id ${facts.gameId}`);
  }
  const { seriesId, gameNumber } = parsed;
  const series = findSeriesOrNull(bracket, seriesId);
  if (series === null) {
    throw new SeasonPostseasonInvariantError(`unknown series ${seriesId}`);
  }
  const homeCourt = series.homeCourtFranchiseId;
  const challenger = series.challengerFranchiseId;
  if (homeCourt === null || challenger === null) {
    throw new SeasonPostseasonInvariantError(`series ${seriesId} is not paired`);
  }
  if (series.winnerFranchiseId !== null) {
    throw new SeasonPostseasonInvariantError(`series ${seriesId} already has a winner`);
  }
  if (gameNumber !== series.games.length + 1) {
    throw new SeasonPostseasonInvariantError(
      `series ${seriesId} game ${String(gameNumber)} is out of sequence (expected ${String(series.games.length + 1)})`,
    );
  }
  if (gameNumber > 7) {
    throw new SeasonPostseasonInvariantError(
      `series ${seriesId} cannot play more than seven games`,
    );
  }
  const home = HOME_COURT_GAMES.has(gameNumber) ? homeCourt : challenger;
  const away = home === homeCourt ? challenger : homeCourt;
  if (home === away) {
    throw new SeasonPostseasonInvariantError(`series ${seriesId} cannot pair a team with itself`);
  }
  const winnerFranchiseId = franchiseIdSchema.parse(facts.winnerFranchiseId);
  const loserFranchiseId = franchiseIdSchema.parse(facts.loserFranchiseId);
  const teams = [home, away];
  if (!teams.includes(winnerFranchiseId) || !teams.includes(loserFranchiseId)) {
    throw new SeasonPostseasonInvariantError(
      `series ${seriesId} winner/loser must be participants`,
    );
  }
  if (facts.status === 'final') {
    const homeScore = facts.homeScore;
    const awayScore = facts.awayScore;
    if (homeScore === null || awayScore === null || homeScore === awayScore) {
      throw new SeasonPostseasonInvariantError(
        `series ${seriesId} game ${String(gameNumber)} final must carry unequal scores`,
      );
    }
    const homeWon = homeScore > awayScore;
    const expectedWinner = homeWon ? home : away;
    if (winnerFranchiseId !== expectedWinner) {
      throw new SeasonPostseasonInvariantError(
        `series ${seriesId} game ${String(gameNumber)} winner must match the score`,
      );
    }
  } else if (facts.homeScore !== null || facts.awayScore !== null) {
    throw new SeasonPostseasonInvariantError(`series ${seriesId} forfeit carries no scores`);
  }
  const game: PlayoffSeriesGame = {
    gameId: facts.gameId,
    gameNumber,
    homeFranchiseId: home,
    awayFranchiseId: away,
    status: facts.status,
    homeScore: facts.status === 'final' ? facts.homeScore : null,
    awayScore: facts.status === 'final' ? facts.awayScore : null,
    winnerFranchiseId,
  };
  const homeCourtWins = series.homeCourtWins + (winnerFranchiseId === homeCourt ? 1 : 0);
  const challengerWins = series.challengerWins + (winnerFranchiseId === challenger ? 1 : 0);
  const completed = homeCourtWins === 4 || challengerWins === 4;
  const updatedSeries: PlayoffSeries = {
    ...series,
    homeCourtWins,
    challengerWins,
    games: [...series.games, game],
    winnerFranchiseId: completed ? winnerFranchiseId : null,
  };
  let updatedBracket = replaceSeries(bracket, seriesId, updatedSeries);
  let resolutions = state.tiebreakResolutions;
  if (completed && seriesId !== 'finals') {
    updatedBracket = advanceSeriesWinner(updatedBracket, seriesId, winnerFranchiseId);
    if (series.round === 'conference-final') {
      const eastChamp = updatedBracket.east.conferenceFinal.winnerFranchiseId;
      const westChamp = updatedBracket.west.conferenceFinal.winnerFranchiseId;
      if (
        eastChamp !== null &&
        westChamp !== null &&
        updatedBracket.finals.challengerFranchiseId === null
      ) {
        const paired = pairFinals(updatedBracket, league, standings, state.finalsHomeCourtDrawSeed);
        updatedBracket = paired.bracket;
        resolutions = [...resolutions, paired.resolution];
      }
    }
  }
  const champion =
    completed && seriesId === 'finals' ? winnerFranchiseId : updatedBracket.championFranchiseId;
  return {
    ...state,
    tiebreakResolutions: resolutions,
    championFranchiseId: champion,
    bracket: { ...updatedBracket, championFranchiseId: champion },
  };
}
