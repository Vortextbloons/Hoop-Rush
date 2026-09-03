import { describe, expect, it } from 'vitest';
import {
  SEASON_POSTSEASON_LEGACY_VERSION as SEASON_POSTSEASON_VERSION,
  type ConferenceId,
  type PlayoffBracketV1 as PlayoffBracket,
  type PlayoffSeriesV1 as PlayoffSeries,
  type SeasonPostseasonStateV1 as SeasonPostseasonState,
} from '@hoop-rush/data-contracts';
import { buildSeasonLeague } from '@hoop-rush/test-fixtures';
import { createRng } from '../sim/rng.ts';
import {
  auditSeasonPostseason,
  createPlayoffBracket,
  currentSeriesId,
  setPlayInRankings,
  submitPlayInGame,
  submitPlayoffGame,
} from './postseason-legacy.ts';
const league = buildSeasonLeague();
const eastTeams = league.teams
  .filter((team) => team.conference === 'east')
  .map((team) => team.franchiseId);
const westTeams = league.teams
  .filter((team) => team.conference === 'west')
  .map((team) => team.franchiseId);
function emptyPlayIn(conference: ConferenceId): SeasonPostseasonState['playIn']['east'] {
  const game = (gameId: 'seven-eight' | 'nine-ten' | 'final') => ({
    gameId,
    status: 'scheduled' as const,
    homeFranchiseId: null,
    awayFranchiseId: null,
    winnerFranchiseId: null,
    loserFranchiseId: null,
    homeScore: null,
    awayScore: null,
  });
  return {
    conference,
    ranking: null,
    games: { sevenEight: game('seven-eight'), nineTen: game('nine-ten'), final: game('final') },
    playoffSeeds: null,
  };
}
function emptyPostseason(): SeasonPostseasonState {
  return {
    schemaVersion: 1,
    postseasonVersion: SEASON_POSTSEASON_VERSION,
    seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    playIn: { east: emptyPlayIn('east'), west: emptyPlayIn('west') },
    bracket: null,
    championFranchiseId: null,
  };
}
function rankedPostseason(): SeasonPostseasonState {
  return setPlayInRankings(emptyPostseason(), league, {
    east: eastTeams.slice(0, 10),
    west: westTeams.slice(0, 10),
  });
}
function seriesOf(state: SeasonPostseasonState, seriesId: string): PlayoffSeries {
  const bracket = state.bracket;
  if (bracket === null) throw new Error('no bracket');
  const order = [
    ...bracket.east.firstRound,
    ...bracket.east.semifinals,
    bracket.east.conferenceFinal,
    ...bracket.west.firstRound,
    ...bracket.west.semifinals,
    bracket.west.conferenceFinal,
    bracket.finals,
  ];
  const series = order.find((entry) => entry.seriesId === seriesId);
  if (!series) throw new Error(`no series ${seriesId}`);
  return series;
}
function completedPlayIn(): SeasonPostseasonState {
  let state = rankedPostseason();
  for (const conference of ['east', 'west'] as const) {
    state = submitPlayInGame(state, conference, 'seven-eight', {
      status: 'final',
      homeScore: 101,
      awayScore: 99,
    });
    state = submitPlayInGame(state, conference, 'nine-ten', {
      status: 'final',
      homeScore: 95,
      awayScore: 108,
    });
    state = submitPlayInGame(state, conference, 'final', {
      status: 'final',
      homeScore: 100,
      awayScore: 98,
    });
  }
  return state;
}
function startedBracket(): SeasonPostseasonState {
  return createPlayoffBracket(completedPlayIn(), league, eastTeams[0] ?? 'hawks');
}
function playSeries(
  state: SeasonPostseasonState,
  seriesId: string,
  pattern: ReadonlyArray<'homeCourt' | 'challenger'>,
): SeasonPostseasonState {
  let current = state;
  for (const side of pattern) {
    const series = seriesOf(current, seriesId);
    if (series.winnerFranchiseId !== null) break;
    const homeCourt = series.homeCourtFranchiseId;
    const challenger = series.challengerFranchiseId;
    if (homeCourt === null || challenger === null) {
      throw new Error(`series ${seriesId} is not paired`);
    }
    const gameNumber = series.games.length + 1;
    const gameHomeIsHomeCourt = [1, 2, 5, 7].includes(gameNumber);
    const winnerIsGameHome = gameHomeIsHomeCourt === (side === 'homeCourt');
    current = submitPlayoffGame(current, seriesId, {
      status: 'final',
      homeScore: winnerIsGameHome ? 100 : 90,
      awayScore: winnerIsGameHome ? 90 : 100,
    });
  }
  return current;
}
function playFullTournament(
  state: SeasonPostseasonState,
  rng: ReturnType<typeof createRng>,
): SeasonPostseasonState {
  const pattern = (): Array<'homeCourt' | 'challenger'> => {
    const wins = { homeCourt: 0, challenger: 0 };
    const result: Array<'homeCourt' | 'challenger'> = [];
    while (wins.homeCourt < 4 && wins.challenger < 4) {
      const side: 'homeCourt' | 'challenger' = rng.chance(0.5) ? 'homeCourt' : 'challenger';
      wins[side] += 1;
      result.push(side);
    }
    return result;
  };
  let current = state;
  for (const conference of ['east', 'west'] as const) {
    for (let i = 1; i <= 4; i += 1) {
      current = playSeries(current, `${conference}-first-round-${String(i)}`, pattern());
      expect(auditSeasonPostseason(current, league)).toEqual([]);
    }
    for (let i = 1; i <= 2; i += 1) {
      current = playSeries(current, `${conference}-semifinal-${String(i)}`, pattern());
      expect(auditSeasonPostseason(current, league)).toEqual([]);
    }
    current = playSeries(current, `${conference}-conference-final`, pattern());
    expect(auditSeasonPostseason(current, league)).toEqual([]);
  }
  current = playSeries(current, 'finals', pattern());
  expect(auditSeasonPostseason(current, league)).toEqual([]);
  return current;
}
describe('setPlayInRankings', () => {
  it('records rankings and keeps the Play-In games as empty placeholders', () => {
    const state = rankedPostseason();
    expect(auditSeasonPostseason(state, league)).toEqual([]);
    const east = state.playIn.east;
    expect(east.ranking).toEqual(eastTeams.slice(0, 10));
    for (const game of [east.games.sevenEight, east.games.nineTen, east.games.final]) {
      expect(game.status).toBe('scheduled');
      expect(game.homeFranchiseId).toBeNull();
      expect(game.awayFranchiseId).toBeNull();
    }
    expect(east.playoffSeeds).toBeNull();
  });
  it('rejects malformed or foreign rankings', () => {
    const base = { east: eastTeams.slice(0, 10), west: westTeams.slice(0, 10) };
    expect(() =>
      setPlayInRankings(emptyPostseason(), league, { ...base, east: eastTeams.slice(0, 9) }),
    ).toThrow();
    expect(() =>
      setPlayInRankings(emptyPostseason(), league, {
        ...base,
        east: [...eastTeams.slice(0, 9), eastTeams[0] ?? 'hawks'],
      }),
    ).toThrow();
    expect(() =>
      setPlayInRankings(emptyPostseason(), league, {
        ...base,
        east: [...eastTeams.slice(0, 9), westTeams[0] ?? 'warriors'],
      }),
    ).toThrow();
    expect(() =>
      setPlayInRankings(emptyPostseason(), league, {
        ...base,
        east: [...eastTeams.slice(0, 9), 'sonics'],
      }),
    ).toThrow();
  });
  it('rejects re-ranking a conference', () => {
    const state = rankedPostseason();
    expect(() =>
      setPlayInRankings(state, league, {
        east: eastTeams.slice(0, 10),
        west: westTeams.slice(0, 10),
      }),
    ).toThrow();
  });
});
describe('submitPlayInGame', () => {
  it('resolves the 7/8 and 9/10 games, then the final, then seeds 7-8', () => {
    let state = rankedPostseason();
    state = submitPlayInGame(state, 'east', 'seven-eight', {
      status: 'final',
      homeScore: 101,
      awayScore: 99,
    });
    const sevenEight = state.playIn.east.games.sevenEight;
    expect(sevenEight.homeFranchiseId).toBe(eastTeams[6]);
    expect(sevenEight.awayFranchiseId).toBe(eastTeams[7]);
    expect(sevenEight.winnerFranchiseId).toBe(eastTeams[6]);
    expect(state.playIn.east.games.final.status).toBe('scheduled');
    expect(auditSeasonPostseason(state, league)).toEqual([]);
    state = submitPlayInGame(state, 'east', 'nine-ten', {
      status: 'final',
      homeScore: 95,
      awayScore: 108,
    });
    const nineTen = state.playIn.east.games.nineTen;
    expect(nineTen.homeFranchiseId).toBe(eastTeams[8]);
    expect(nineTen.awayFranchiseId).toBe(eastTeams[9]);
    expect(nineTen.winnerFranchiseId).toBe(eastTeams[9]);
    expect(state.playIn.east.games.final.status).toBe('scheduled');
    expect(state.playIn.east.playoffSeeds).toBeNull();
    expect(auditSeasonPostseason(state, league)).toEqual([]);
    state = submitPlayInGame(state, 'east', 'final', {
      status: 'final',
      homeScore: 100,
      awayScore: 98,
    });
    const final = state.playIn.east.games.final;
    expect(final.homeFranchiseId).toBe(eastTeams[7]);
    expect(final.awayFranchiseId).toBe(eastTeams[9]);
    expect(final.winnerFranchiseId).toBe(eastTeams[7]);
    expect(state.playIn.east.playoffSeeds).toEqual([
      ...eastTeams.slice(0, 6),
      eastTeams[6],
      eastTeams[7],
    ]);
    expect(auditSeasonPostseason(state, league)).toEqual([]);
  });
  it('handles forfeits across every Play-In branch', () => {
    let state = rankedPostseason();
    state = submitPlayInGame(state, 'east', 'nine-ten', {
      status: 'forfeit',
      loserFranchiseId: eastTeams[8] ?? 'hawks',
    });
    expect(state.playIn.east.games.nineTen.winnerFranchiseId).toBe(eastTeams[9]);
    state = submitPlayInGame(state, 'east', 'seven-eight', {
      status: 'forfeit',
      loserFranchiseId: eastTeams[7] ?? 'celtics',
    });
    expect(state.playIn.east.games.sevenEight.winnerFranchiseId).toBe(eastTeams[6]);
    state = submitPlayInGame(state, 'east', 'final', {
      status: 'forfeit',
      loserFranchiseId: eastTeams[9] ?? 'hornets',
    });
    const final = state.playIn.east.games.final;
    expect(final.homeFranchiseId).toBe(eastTeams[7]);
    expect(final.awayFranchiseId).toBe(eastTeams[9]);
    expect(final.winnerFranchiseId).toBe(eastTeams[7]);
    expect(state.playIn.east.playoffSeeds).toEqual([
      ...eastTeams.slice(0, 6),
      eastTeams[6],
      eastTeams[7],
    ]);
    expect(auditSeasonPostseason(state, league)).toEqual([]);
  });
  it('rejects illegal Play-In submissions', () => {
    let state = rankedPostseason();
    expect(() =>
      submitPlayInGame(state, 'east', 'final', { status: 'final', homeScore: 100, awayScore: 90 }),
    ).toThrow();
    state = submitPlayInGame(state, 'east', 'seven-eight', {
      status: 'final',
      homeScore: 101,
      awayScore: 99,
    });
    expect(() =>
      submitPlayInGame(state, 'east', 'seven-eight', {
        status: 'final',
        homeScore: 110,
        awayScore: 100,
      }),
    ).toThrow();
    expect(() =>
      submitPlayInGame(state, 'east', 'nine-ten', {
        status: 'final',
        homeScore: 90,
        awayScore: 90,
      }),
    ).toThrow();
    expect(() =>
      submitPlayInGame(state, 'east', 'nine-ten', {
        status: 'forfeit',
        loserFranchiseId: 'celtics',
      }),
    ).toThrow();
    const unranked = emptyPostseason();
    expect(() =>
      submitPlayInGame(unranked, 'east', 'seven-eight', {
        status: 'final',
        homeScore: 100,
        awayScore: 90,
      }),
    ).toThrow();
  });
  it('keeps conferences independent', () => {
    let state = rankedPostseason();
    state = submitPlayInGame(state, 'east', 'seven-eight', {
      status: 'final',
      homeScore: 100,
      awayScore: 90,
    });
    state = submitPlayInGame(state, 'west', 'seven-eight', {
      status: 'final',
      homeScore: 100,
      awayScore: 90,
    });
    expect(state.playIn.east.games.sevenEight.winnerFranchiseId).toBe(eastTeams[6]);
    expect(state.playIn.west.games.sevenEight.winnerFranchiseId).toBe(westTeams[6]);
  });
});
describe('createPlayoffBracket', () => {
  it('requires both Play-In tournaments before creating the bracket', () => {
    expect(() =>
      createPlayoffBracket(rankedPostseason(), league, eastTeams[0] ?? 'hawks'),
    ).toThrow();
  });
  it('rejects a finals home-court team outside the playoffs', () => {
    const state = completedPlayIn();
    const eliminated = eastTeams.find((id) => !state.playIn.east.playoffSeeds?.includes(id));
    expect(() => createPlayoffBracket(state, league, eliminated ?? 'wizards')).toThrow();
  });
  it('creates fixed first-round pairings with the higher seed at home', () => {
    const state = createPlayoffBracket(completedPlayIn(), league, eastTeams[0] ?? 'hawks');
    expect(state.bracket).not.toBeNull();
    expect(auditSeasonPostseason(state, league)).toEqual([]);
    const bracket = state.bracket as PlayoffBracket;
    const east = bracket.east;
    const seeds = state.playIn.east.playoffSeeds as string[];
    expect(east.seeds).toEqual(seeds);
    const pairings = [
      [0, 7],
      [3, 4],
      [2, 5],
      [1, 6],
    ] as const;
    east.firstRound.forEach((series, index) => {
      const pair = pairings[index];
      if (!pair) throw new Error(`no pairing for series ${String(index + 1)}`);
      const [higherIndex, lowerIndex] = pair;
      expect(series.homeCourtFranchiseId).toBe(seeds[higherIndex]);
      expect(series.challengerFranchiseId).toBe(seeds[lowerIndex]);
      expect(series.higherSeed).toBe(higherIndex + 1);
      expect(series.lowerSeed).toBe(lowerIndex + 1);
      expect(series.homeCourtWins).toBe(0);
      expect(series.challengerWins).toBe(0);
      expect(series.games).toEqual([]);
    });
    for (const series of [...east.semifinals, east.conferenceFinal]) {
      expect(series.homeCourtFranchiseId).toBeNull();
      expect(series.challengerFranchiseId).toBeNull();
    }
    expect(bracket.finals.homeCourtFranchiseId).toBe(eastTeams[0]);
    expect(bracket.finals.challengerFranchiseId).toBeNull();
  });
});
describe('submitPlayoffGame', () => {
  it('only accepts the current series', () => {
    const state = startedBracket();
    expect(currentSeriesId(state.bracket as PlayoffBracket)).toBe('east-first-round-1');
    expect(() =>
      submitPlayoffGame(state, 'east-first-round-2', {
        status: 'final',
        homeScore: 100,
        awayScore: 90,
      }),
    ).toThrow();
    expect(() =>
      submitPlayoffGame(state, 'finals', { status: 'final', homeScore: 100, awayScore: 90 }),
    ).toThrow();
  });
  it('follows the 2-2-1-1-1 home pattern', () => {
    let state = startedBracket();
    for (let gameNumber = 1; gameNumber <= 4; gameNumber += 1) {
      state = submitPlayoffGame(state, 'east-first-round-1', {
        status: 'final',
        homeScore: 100,
        awayScore: 90,
      });
      const game = seriesOf(state, 'east-first-round-1').games[gameNumber - 1];
      expect(game?.gameNumber).toBe(gameNumber);
      const expectedHome = [1, 2].includes(gameNumber) ? eastTeams[0] : eastTeams[7];
      expect(game?.homeFranchiseId).toBe(expectedHome);
    }
  });
  it('stops the series immediately at four wins', () => {
    let state = startedBracket();
    state = playSeries(state, 'east-first-round-1', [
      'homeCourt',
      'homeCourt',
      'homeCourt',
      'homeCourt',
      'homeCourt',
    ]);
    const series = seriesOf(state, 'east-first-round-1');
    expect(series.homeCourtWins).toBe(4);
    expect(series.challengerWins).toBe(0);
    expect(series.games).toHaveLength(4);
    expect(series.winnerFranchiseId).toBe(eastTeams[0]);
    expect(() =>
      submitPlayoffGame(state, 'east-first-round-1', {
        status: 'final',
        homeScore: 100,
        awayScore: 90,
      }),
    ).toThrow();
  });
  it('supports seven-game series and challenger comebacks', () => {
    let state = startedBracket();
    state = playSeries(state, 'east-first-round-1', [
      'homeCourt',
      'challenger',
      'homeCourt',
      'challenger',
      'homeCourt',
      'challenger',
      'challenger',
    ]);
    const series = seriesOf(state, 'east-first-round-1');
    expect(series.games).toHaveLength(7);
    expect(series.homeCourtWins).toBe(3);
    expect(series.challengerWins).toBe(4);
    expect(series.winnerFranchiseId).toBe(eastTeams[7]);
  });
  it('rejects ties and non-participant forfeit winners', () => {
    const state = startedBracket();
    expect(() =>
      submitPlayoffGame(state, 'east-first-round-1', {
        status: 'final',
        homeScore: 100,
        awayScore: 100,
      }),
    ).toThrow();
    expect(() =>
      submitPlayoffGame(state, 'east-first-round-1', {
        status: 'forfeit',
        winnerFranchiseId: 'celtics',
      }),
    ).toThrow();
  });
  it('counts a playoff forfeit as a win for the other team', () => {
    let state = startedBracket();
    state = submitPlayoffGame(state, 'east-first-round-1', {
      status: 'forfeit',
      winnerFranchiseId: eastTeams[0] ?? 'hawks',
    });
    const series = seriesOf(state, 'east-first-round-1');
    expect(series.homeCourtWins).toBe(1);
    expect(series.games[0]?.status).toBe('forfeit');
    expect(auditSeasonPostseason(state, league)).toEqual([]);
  });
});
describe('full tournament', () => {
  it('produces a champion with no duplicate or missing teams', () => {
    const state = playFullTournament(startedBracket(), createRng('postseason-tournament-1'));
    const bracket = state.bracket as PlayoffBracket;
    expect(state.championFranchiseId).not.toBeNull();
    expect(bracket.championFranchiseId).toBe(state.championFranchiseId);
    expect(bracket.finals.winnerFranchiseId).toBe(state.championFranchiseId);
    const eastTeamsInBracket = new Set(bracket.east.seeds);
    const westTeamsInBracket = new Set(bracket.west.seeds);
    expect(eastTeamsInBracket.size).toBe(8);
    expect(westTeamsInBracket.size).toBe(8);
    for (const id of eastTeamsInBracket) {
      expect(westTeamsInBracket.has(id)).toBe(false);
    }
    expect(eastTeamsInBracket.has(bracket.finals.homeCourtFranchiseId ?? '')).toBe(true);
    expect(westTeamsInBracket.has(bracket.finals.homeCourtFranchiseId ?? '')).toBe(false);
    expect(eastTeamsInBracket.has(bracket.finals.challengerFranchiseId ?? '')).toBe(false);
    expect(westTeamsInBracket.has(bracket.finals.challengerFranchiseId ?? '')).toBe(true);
  });
  it('is deterministic across seeded runs and consistent after every game', () => {
    for (const seed of ['postseason-tournament-2', 'postseason-tournament-3']) {
      const rng = createRng(seed);
      let state = startedBracket();
      let played = 0;
      while (state.championFranchiseId === null) {
        const current = currentSeriesId(state.bracket as PlayoffBracket);
        const side = rng.chance(0.5) ? ('homeCourt' as const) : ('challenger' as const);
        state = playSeries(state, current, [side]);
        played += 1;
        expect(auditSeasonPostseason(state, league)).toEqual([]);
        expect(seriesOf(state, current).games.length).toBeLessThanOrEqual(7);
      }
      expect(played).toBeGreaterThanOrEqual(60);
      const finishedBracket = state.bracket as PlayoffBracket;
      expect(finishedBracket.championFranchiseId).toBe(state.championFranchiseId);
      expect(finishedBracket.finals.winnerFranchiseId).toBe(state.championFranchiseId);
    }
  });
  it('advances winners into fixed slots with higher-seed home court', () => {
    let state = startedBracket();
    state = playSeries(state, 'east-first-round-1', [
      'homeCourt',
      'homeCourt',
      'homeCourt',
      'homeCourt',
    ]);
    state = playSeries(state, 'east-first-round-2', [
      'challenger',
      'challenger',
      'challenger',
      'challenger',
    ]);
    const semifinal = seriesOf(state, 'east-semifinal-1');
    const seeds = state.playIn.east.playoffSeeds as string[];
    expect(semifinal.homeCourtFranchiseId).toBe(seeds[0]);
    expect(semifinal.challengerFranchiseId).toBe(seeds[4]);
    expect(semifinal.higherSeed).toBe(1);
    expect(semifinal.lowerSeed).toBe(5);
    expect(auditSeasonPostseason(state, league)).toEqual([]);
  });
  it('audits a corrupt bracket and corrupt Play-In states', () => {
    const state = startedBracket();
    const bracket = state.bracket as PlayoffBracket;
    const tampered = {
      ...state,
      bracket: {
        ...bracket,
        east: {
          ...bracket.east,
          firstRound: bracket.east.firstRound.map((series, index) =>
            index === 1
              ? { ...series, homeCourtFranchiseId: series.challengerFranchiseId }
              : series,
          ),
        },
      },
    };
    expect(auditSeasonPostseason(tampered, league).length).toBeGreaterThan(0);
    const wrongWinner = {
      ...state,
      bracket: {
        ...bracket,
        finals: { ...bracket.finals, winnerFranchiseId: eastTeams[0] ?? 'hawks' },
      },
    };
    expect(auditSeasonPostseason(wrongWinner, league).length).toBeGreaterThan(0);
    const corruptSeeds = {
      ...state,
      playIn: {
        ...state.playIn,
        east: { ...state.playIn.east, playoffSeeds: null },
      },
    };
    expect(auditSeasonPostseason(corruptSeeds, league).length).toBeGreaterThan(0);
  });
});
