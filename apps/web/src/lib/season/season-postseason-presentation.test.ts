import { describe, expect, it } from 'vitest';
import { generateSeasonSchedule } from '@hoop-rush/engine';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import {
  buildInitialPostseasonState,
  type PlayoffSeries,
  type SeasonPostseasonState,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import {
  franchiseIdSchema,
  commandIdSchema,
  seedSchema,
  seasonGameIdSchema,
  idSchema,
} from '@hoop-rush/data-contracts';
import {
  awardsViewModel,
  bracketColumnsOf,
  describePostseasonRejection,
  humanSeriesOf,
  mobileBracketCardsOf,
  playInColumnViewModel,
  postseasonRankingsOf,
  rankedEntriesOf,
  riskyRehabOptionsOf,
  roundLabel,
  seriesCardViewModel,
} from './season-postseason-presentation';
const SEED = seedSchema.parse('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
function fixtureRun(): SeasonRun {
  const league = buildSeasonLeague({}, { humanFranchiseId: franchiseIdSchema.parse('lakers') });
  const schedule = generateSeasonSchedule({ league, seed: SEED });
  return buildSeasonRunFixture({
    schedule,
    league,
    seed: SEED,
    humanFranchiseId: franchiseIdSchema.parse('lakers'),
  });
}
function series(
  seriesId: string,
  round: PlayoffSeries['round'],
  conference: 'east' | 'west' | null,
  higherSeed: number | null,
  lowerSeed: number | null,
  homeCourt: string | null,
  challenger: string | null,
  homeWins: number,
  challengerWins: number,
  winner: string | null,
): PlayoffSeries {
  const played = homeWins + challengerWins;
  return {
    seriesId: idSchema.parse(seriesId),
    round,
    conference,
    higherSeed,
    lowerSeed,
    homeCourtFranchiseId: homeCourt === null ? null : franchiseIdSchema.parse(homeCourt),
    challengerFranchiseId: challenger === null ? null : franchiseIdSchema.parse(challenger),
    homeCourtWins: homeWins,
    challengerWins: challengerWins,
    games: Array.from({ length: played }, (_, index) => {
      const gameNumber = index + 1;
      const homeIsHomeSide = [1, 2, 5, 7].includes(gameNumber);
      const home = homeIsHomeSide ? (homeCourt ?? '') : (challenger ?? '');
      const away = homeIsHomeSide ? (challenger ?? '') : (homeCourt ?? '');
      const homeScore = 100 + gameNumber;
      const awayScore = 90 + gameNumber;
      const winnerId = homeScore > awayScore ? home : away;
      return {
        gameId: `po-${seriesId}-g${String(gameNumber)}`,
        gameNumber,
        homeFranchiseId: franchiseIdSchema.parse(home),
        awayFranchiseId: franchiseIdSchema.parse(away),
        status: 'final' as const,
        homeScore,
        awayScore,
        winnerFranchiseId: franchiseIdSchema.parse(winnerId),
      };
    }),
    winnerFranchiseId: winner === null ? null : franchiseIdSchema.parse(winner),
  };
}
function decidedPostseason(humanFranchiseId: string): SeasonPostseasonState {
  const state = buildInitialPostseasonState(SEED);
  const fids = (ids: string[]) => ids.map((id) => franchiseIdSchema.parse(id));
  state.playIn.east.ranking = fids([
    'east1',
    'east2',
    'east3',
    'east4',
    'east5',
    'east6',
    'east7',
    'east8',
    'east9',
    'east10',
  ]);
  state.playIn.west.ranking = fids([
    'west1',
    'west2',
    'west3',
    'west4',
    'west5',
    'west6',
    'west7',
    'west8',
    'west9',
    'west10',
  ]);
  for (const conference of ['east', 'west'] as const) {
    const game = (gameId: string) => ({
      gameId,
      status: 'final' as const,
      homeFranchiseId: franchiseIdSchema.parse('west7'),
      awayFranchiseId: franchiseIdSchema.parse('west8'),
      winnerFranchiseId: franchiseIdSchema.parse('west7'),
      loserFranchiseId: franchiseIdSchema.parse('west8'),
      homeScore: 110,
      awayScore: 99,
    });
    state.playIn[conference].games.sevenEight = game(`pi-${conference}-seven-eight`);
    state.playIn[conference].games.nineTen = game(`pi-${conference}-nine-ten`);
    state.playIn[conference].games.final = game(`pi-${conference}-final`);
    state.playIn[conference].playoffSeeds = fids([
      `${conference}1`,
      `${conference}2`,
      `${conference}3`,
      `${conference}4`,
      `${conference}5`,
      `${conference}6`,
      `${conference}7`,
      `${conference}8`,
    ]);
  }
  const bracket = (conference: 'east' | 'west') => ({
    conference,
    seeds: fids([
      `${conference}1`,
      `${conference}2`,
      `${conference}3`,
      `${conference}4`,
      `${conference}5`,
      `${conference}6`,
      `${conference}7`,
      `${conference}8`,
    ]),
    firstRound: [
      series(
        `po-${conference}1-8`,
        'first-round',
        conference,
        1,
        8,
        `${conference}1`,
        `${conference}8`,
        4,
        1,
        `${conference}1`,
      ),
      series(
        `po-${conference}4-5`,
        'first-round',
        conference,
        4,
        5,
        `${conference}4`,
        `${conference}5`,
        2,
        4,
        `${conference}5`,
      ),
      series(
        `po-${conference}3-6`,
        'first-round',
        conference,
        3,
        6,
        `${conference}3`,
        `${conference}6`,
        4,
        0,
        `${conference}3`,
      ),
      series(
        `po-${conference}2-7`,
        'first-round',
        conference,
        2,
        7,
        `${conference}2`,
        `${conference}7`,
        4,
        2,
        `${conference}2`,
      ),
    ],
    semifinals: [
      series(
        `po-${conference}1-5`,
        'conference-semifinal',
        conference,
        1,
        5,
        `${conference}1`,
        `${conference}5`,
        4,
        3,
        `${conference}1`,
      ),
      series(
        `po-${conference}3-2`,
        'conference-semifinal',
        conference,
        3,
        2,
        `${conference}3`,
        `${conference}2`,
        1,
        4,
        `${conference}2`,
      ),
    ],
    conferenceFinal: series(
      `po-${conference}1-2`,
      'conference-final',
      conference,
      1,
      2,
      `${conference}1`,
      `${conference}2`,
      4,
      2,
      `${conference}1`,
    ),
  });
  state.bracket = {
    schemaVersion: 1,
    postseasonVersion: 'postseason-v2',
    east: bracket('east'),
    west: bracket('west'),
    finals: series('po-finals', 'finals', null, null, null, 'east1', 'west1', 4, 2, 'east1'),
    championFranchiseId: franchiseIdSchema.parse('east1'),
  };
  state.championFranchiseId = franchiseIdSchema.parse('east1');
  void humanFranchiseId;
  return state;
}
describe('postseasonRankingsOf / rankedEntriesOf', () => {
  it('ranks 15 teams per conference and orders the standings table by ranking', () => {
    const run = fixtureRun();
    const rankings = postseasonRankingsOf(run);
    expect(rankings.east.ranked).toHaveLength(15);
    expect(rankings.west.ranked).toHaveLength(15);
    expect(rankings.east.topTen).toHaveLength(10);
    expect(rankings.east.directSeeds).toHaveLength(6);
    expect(rankings.east.playInSeeds).toHaveLength(4);
    const entries = rankedEntriesOf(rankings, run.standings);
    expect(entries).toHaveLength(30);
    expect(entries[0]?.row.franchiseId).toBe(rankings.east.ranked[0]);
    expect(entries[0]?.rank).toBe(1);
    expect(entries[0]?.conference).toBe('east');
    const eastRanks = entries
      .filter((entry) => entry.conference === 'east')
      .map((entry) => entry.rank);
    expect(eastRanks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });
  it('is deterministic for identical inputs', () => {
    const run = fixtureRun();
    expect(postseasonRankingsOf(run)).toEqual(postseasonRankingsOf(run));
  });
});
describe('series card view models', () => {
  it('reports score, winner, and status', () => {
    const card = seriesCardViewModel(
      series('po-x1', 'first-round', 'east', 1, 8, 'a', 'b', 4, 1, 'a'),
      'lakers',
    );
    expect(card.homeWins).toBe(4);
    expect(card.awayWins).toBe(1);
    expect(card.status).toBe('complete');
    expect(card.winnerFranchiseId).toBe('a');
    expect(card.humanSeries).toBe(false);
    expect(card.nextGame).toBeNull();
    expect(card.lastResult?.gameNumber).toBe(5);
  });
  it('names the next game host from the 2-2-1-1-1 pattern', () => {
    const card = seriesCardViewModel(
      series('po-x2', 'first-round', 'east', 1, 8, 'a', 'b', 2, 1, null),
      null,
    );
    expect(card.status).toBe('in-progress');
    expect(card.nextGame?.gameNumber).toBe(4);
    expect(card.nextGame?.homeFranchiseId).toBe('b');
    const game5 = seriesCardViewModel(
      series('po-x3', 'first-round', 'east', 1, 8, 'a', 'b', 2, 2, null),
      null,
    );
    expect(game5.nextGame?.gameNumber).toBe(5);
    expect(game5.nextGame?.homeFranchiseId).toBe('a');
  });
  it('marks the human franchise series', () => {
    const card = seriesCardViewModel(
      series('po-x4', 'conference-semifinal', 'west', 1, 5, 'lakers', 'b', 2, 2, null),
      'lakers',
    );
    expect(card.humanSeries).toBe(true);
    expect(roundLabel(card.round)).toBe('Conference Semis');
  });
});
describe('humanSeriesOf', () => {
  it('finds the human series in a decided bracket', () => {
    const run = fixtureRun();
    run.postseason = decidedPostseason('lakers');
    expect(humanSeriesOf(run, 'lakers')).toBeNull();
    run.postseason = decidedPostseason('east1');
    const card = humanSeriesOf(run, 'east1');
    expect(card).not.toBeNull();
    expect(card?.winnerFranchiseId).toBe('east1');
  });
});
describe('bracket columns', () => {
  it('builds play-in plus four playoff round columns with correct sizes', () => {
    const state = decidedPostseason('east1');
    const columns = bracketColumnsOf(state, 'east1');
    expect(columns.map((column) => column.key)).toEqual([
      'play-in',
      'first-round',
      'conference-semifinal',
      'conference-final',
      'finals',
    ]);
    expect(columns[0]?.playIn).toHaveLength(2);
    expect(columns[1]?.series).toHaveLength(8);
    expect(columns[2]?.series).toHaveLength(4);
    expect(columns[3]?.series).toHaveLength(2);
    expect(columns[4]?.series).toHaveLength(1);
    expect(columns[4]?.series[0]?.winnerFranchiseId).toBe('east1');
  });
  it('exposes only the play-in column before the bracket exists', () => {
    const state = buildInitialPostseasonState(SEED);
    state.playIn.east.ranking = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10'].map(
      (id) => franchiseIdSchema.parse(id),
    );
    state.playIn.west.ranking = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10'].map(
      (id) => franchiseIdSchema.parse(id),
    );
    const columns = bracketColumnsOf(state, 'lakers');
    expect(columns).toHaveLength(1);
    expect(columns[0]?.key).toBe('play-in');
  });
  it('orders mobile cards play-in first, then round by round', () => {
    const state = decidedPostseason('east1');
    const cards = mobileBracketCardsOf(state, 'east1');
    expect(cards[0]?.kind).toBe('play-in');
    expect(cards[1]?.kind).toBe('play-in');
    const seriesIds = cards
      .filter(
        (
          card,
        ): card is Extract<
          (typeof cards)[number],
          {
            kind: 'series';
          }
        > => card.kind === 'series',
      )
      .map((card) => card.card.seriesId);
    expect(seriesIds[0]).toBe('po-east1-8');
  });
});
describe('play-in cards', () => {
  it('maps seeds 7-10 from the ranking', () => {
    const state = buildInitialPostseasonState(SEED);
    state.playIn.west.ranking = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) =>
      franchiseIdSchema.parse(id),
    );
    const column = playInColumnViewModel(state, 'west', 'g');
    expect(column.seeds.map((entry) => entry.seed)).toEqual([7, 8, 9, 10]);
    expect(column.seeds[0]?.franchiseId).toBe('g');
    const sevenEight = column.games[0];
    expect(sevenEight?.matchupLabel).toBe('7 vs 8');
    expect(sevenEight?.homeSeed).toBe(7);
    expect(sevenEight?.awaySeed).toBe(8);
    expect(sevenEight?.status).toBe('scheduled');
    expect(sevenEight?.consequence).toContain('seed 7');
    expect(sevenEight?.humanGame).toBe(true);
    expect(sevenEight?.status).toBe('scheduled');
    const final = column.games[2];
    expect(final?.consequence).toContain('seed 8');
  });
});
describe('awards view model', () => {
  it('builds the three awards and the positionless first team with rule copy', () => {
    const view = awardsViewModel(
      {
        schemaVersion: 1,
        awardsVersion: 'awards-v1',
        runId: idSchema.parse('run-1'),
        mvp: { playerVersionId: 'pv-a', franchiseId: franchiseIdSchema.parse('f-a') },
        defensivePlayerOfYear: {
          playerVersionId: 'pv-b',
          franchiseId: franchiseIdSchema.parse('f-b'),
        },
        sixthManOfYear: { playerVersionId: 'pv-c', franchiseId: franchiseIdSchema.parse('f-c') },
        allLeagueFirstTeam: [
          { playerVersionId: 'pv-1', franchiseId: franchiseIdSchema.parse('f-1') },
          { playerVersionId: 'pv-2', franchiseId: franchiseIdSchema.parse('f-2') },
          { playerVersionId: 'pv-3', franchiseId: franchiseIdSchema.parse('f-3') },
          { playerVersionId: 'pv-4', franchiseId: franchiseIdSchema.parse('f-4') },
          { playerVersionId: 'pv-5', franchiseId: franchiseIdSchema.parse('f-5') },
        ],
        digest: '0'.repeat(32),
      },
      (id) => `Player ${id}`,
      (id) => `Team ${id}`,
    );
    expect(view.awards).toHaveLength(3);
    expect(view.awards[0]?.title).toBe('Most Valuable Player');
    expect(view.awards[1]?.title).toBe('Defensive Player of the Year');
    expect(view.awards[2]?.title).toBe('Sixth Man of the Year');
    expect(view.awards[0]?.playerName).toBe('Player pv-a');
    expect(view.awards[0]?.franchiseLabel).toBe('Team f-a');
    expect(view.awards[0]?.explanation).toContain('MVP composite');
    expect(view.firstTeam).toHaveLength(5);
    expect(view.firstTeam[0]?.title).toBe('All-League First Team');
    expect(view.firstTeam[0]?.explanation).toContain('positionless');
  });
});
describe('risky rehab options', () => {
  it('lists active human injuries with the 2-Influence cost and availability', () => {
    const run = fixtureRun();
    run.health = {
      schemaVersion: 1,
      healthVersion: 'season-health-v2',
      injuries: [
        {
          injuryId: 'inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          playerVersionId: 'pv-injured',
          franchiseId: franchiseIdSchema.parse('lakers'),
          gameId: seasonGameIdSchema.parse('s000001'),
          type: 'soft-tissue',
          severity: 'moderate',
          occurredBeforeHalftime: false,
          sameGameReturn: false,
          sameGameReturned: null,
          missedGamesTotal: 6,
          missedGamesRemaining: 2,
          actualReturnRound: null,
          seasonEnding: false,
          rehabModifier: 0 as const,
          recurrenceWindowRoundsRemaining: 0,
          seedPath: ['test'],
        },
        {
          injuryId: 'inj-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          playerVersionId: 'pv-returned',
          franchiseId: franchiseIdSchema.parse('lakers'),
          gameId: seasonGameIdSchema.parse('s000002'),
          type: 'upper-body',
          severity: 'minor',
          occurredBeforeHalftime: true,
          sameGameReturn: true,
          sameGameReturned: true,
          missedGamesTotal: 2,
          missedGamesRemaining: 0,
          actualReturnRound: 41,
          seasonEnding: false,
          rehabModifier: 0 as const,
          recurrenceWindowRoundsRemaining: 0,
          seedPath: ['test'],
        },
        {
          injuryId: 'inj-cccccccccccccccccccccccccccccccc',
          playerVersionId: 'pv-other',
          franchiseId: franchiseIdSchema.parse('celtics'),
          gameId: seasonGameIdSchema.parse('s000003'),
          type: 'lower-body',
          severity: 'major',
          occurredBeforeHalftime: false,
          sameGameReturn: false,
          sameGameReturned: null,
          missedGamesTotal: 10,
          missedGamesRemaining: 4,
          actualReturnRound: null,
          seasonEnding: false,
          rehabModifier: 0 as const,
          recurrenceWindowRoundsRemaining: 0,
          seedPath: ['test'],
        },
      ],
    };
    run.influence.balances[franchiseIdSchema.parse('lakers')] = 1;
    const options = riskyRehabOptionsOf(run, 'lakers', (id) => `Name ${id}`);
    expect(options).toHaveLength(1);
    const option = options[0];
    expect(option?.injuryId).toBe('inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(option?.cost).toBe(2);
    expect(option?.balance).toBe(1);
    expect(option?.available).toBe(false);
    expect(option?.alreadyRehabbed).toBe(false);
    expect(option?.displayName).toBe('Name pv-injured');
    run.influence.balances[franchiseIdSchema.parse('lakers')] = 3;
    run.influence.rehabs['inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] = {
      franchiseId: franchiseIdSchema.parse('lakers'),
      outcome: 'pending',
      commandId: commandIdSchema.parse('cmd-1'),
    };
    const after = riskyRehabOptionsOf(run, 'lakers', (id) => `Name ${id}`);
    expect(after[0]?.available).toBe(true);
    expect(after[0]?.alreadyRehabbed).toBe(true);
  });
});
describe('typed rejection copy', () => {
  it('maps every M2.6 postseason rejection code', () => {
    expect(
      describePostseasonRejection('advance-postseason', {
        code: 'invalid-stage',
        requiredStage: 'play-in',
        currentStage: 'regular-season',
      }),
    ).toContain('play-in');
    expect(
      describePostseasonRejection('advance-postseason', {
        code: 'wrong-game',
        targetGameId: 'po-x-g1',
        nextGameId: 'po-x-g2',
      }),
    ).toContain('next scheduled postseason game');
    expect(
      describePostseasonRejection('submit-postseason-rotation', {
        code: 'invalid-rotation',
        franchiseId: franchiseIdSchema.parse('lakers'),
        reasons: ['starter PG cannot play slot'],
      }),
    ).toContain('starter PG cannot play slot');
    expect(
      describePostseasonRejection('submit-postseason-rotation', {
        code: 'unavailable-player',
        playerVersionId: 'pv-1',
        reason: 'injured',
      }),
    ).toContain('injured');
    expect(
      describePostseasonRejection('submit-postseason-rotation', {
        code: 'insufficient-rehab-resources',
        franchiseId: franchiseIdSchema.parse('lakers'),
        balance: 1,
        required: 2,
      }),
    ).toContain('2');
    expect(
      describePostseasonRejection('advance-postseason', {
        code: 'invalid-series-state',
        seriesId: 'po-x',
        reason: 'not-current',
      }),
    ).toContain('not-current');
    expect(
      describePostseasonRejection('advance-postseason', {
        code: 'integrity-failure',
        reason: 'series wins exceed played games',
      }),
    ).toContain('integrity check');
    expect(
      describePostseasonRejection('start-postseason', {
        code: 'stale-state',
        expectedStateRevision: 3,
        expectedStateDigest: '0'.repeat(32),
        currentStateRevision: 4,
        currentStateDigest: '1'.repeat(32),
      }),
    ).toContain('Refresh and try again');
  });
});
