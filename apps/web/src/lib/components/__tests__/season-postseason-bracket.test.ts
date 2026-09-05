import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { buildManifest } from '@hoop-rush/test-fixtures';
import { buildInitialPostseasonState, type SeasonPostseasonState } from '@hoop-rush/data-contracts';
import { franchiseIdSchema, idSchema, seedSchema } from '@hoop-rush/data-contracts';
import PostseasonBracket from '$lib/components/season/PostseasonBracket.svelte';
import SeriesCard from '$lib/components/season/SeriesCard.svelte';
import PlayInCard from '$lib/components/season/PlayInCard.svelte';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
mockSvelteKitApp();
const MANIFEST = buildManifest();
function series(
  seriesId: string,
  round: 'first-round' | 'conference-semifinal' | 'conference-final' | 'finals',
  conference: 'east' | 'west' | null,
  higherSeed: number | null,
  lowerSeed: number | null,
  homeCourt: string | null,
  challenger: string | null,
  homeWins: number,
  challengerWins: number,
  winner: string | null,
  played: number,
): NonNullable<SeasonPostseasonState['bracket']>['finals'] {
  return {
    seriesId: idSchema.parse(seriesId),
    round,
    conference,
    higherSeed,
    lowerSeed,
    homeCourtFranchiseId: homeCourt === null ? null : franchiseIdSchema.parse(homeCourt),
    challengerFranchiseId: challenger === null ? null : franchiseIdSchema.parse(challenger),
    homeCourtWins: homeWins,
    challengerWins,
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
function fixturePostseason(): SeasonPostseasonState {
  const state = buildInitialPostseasonState(seedSchema.parse('a1b2c3d4e5f60718293a4b5c6d7e8f9a'));
  state.playIn.east.ranking = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10'].map(
    (id) => franchiseIdSchema.parse(id),
  );
  state.playIn.west.ranking = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9', 'w10'].map(
    (id) => franchiseIdSchema.parse(id),
  );
  for (const conference of ['east', 'west'] as const) {
    const playIn = state.playIn[conference];
    playIn.games.sevenEight = {
      gameId: `pi-${conference}-seven-eight`,
      status: 'final',
      homeFranchiseId: franchiseIdSchema.parse(`${conference}7`),
      awayFranchiseId: franchiseIdSchema.parse(`${conference}8`),
      winnerFranchiseId: franchiseIdSchema.parse(`${conference}7`),
      loserFranchiseId: franchiseIdSchema.parse(`${conference}8`),
      homeScore: 112,
      awayScore: 101,
    };
    playIn.games.nineTen = {
      gameId: `pi-${conference}-nine-ten`,
      status: 'final',
      homeFranchiseId: franchiseIdSchema.parse(`${conference}9`),
      awayFranchiseId: franchiseIdSchema.parse(`${conference}10`),
      winnerFranchiseId: franchiseIdSchema.parse(`${conference}9`),
      loserFranchiseId: franchiseIdSchema.parse(`${conference}10`),
      homeScore: 98,
      awayScore: 91,
    };
    playIn.games.final = {
      gameId: `pi-${conference}-final`,
      status: 'final',
      homeFranchiseId: franchiseIdSchema.parse(`${conference}8`),
      awayFranchiseId: franchiseIdSchema.parse(`${conference}9`),
      winnerFranchiseId: franchiseIdSchema.parse(`${conference}8`),
      loserFranchiseId: franchiseIdSchema.parse(`${conference}9`),
      homeScore: 104,
      awayScore: 100,
    };
    playIn.playoffSeeds = [
      `${conference}1`,
      `${conference}2`,
      `${conference}3`,
      `${conference}4`,
      `${conference}5`,
      `${conference}6`,
      `${conference}7`,
      `${conference}8`,
    ].map((id) => franchiseIdSchema.parse(id));
  }
  const conferenceBracket = (conference: 'east' | 'west') => ({
    conference,
    seeds: [
      `${conference}1`,
      `${conference}2`,
      `${conference}3`,
      `${conference}4`,
      `${conference}5`,
      `${conference}6`,
      `${conference}7`,
      `${conference}8`,
    ].map((id) => franchiseIdSchema.parse(id)),
    firstRound: [
      series(
        `c${conference}1-8`,
        'first-round',
        conference,
        1,
        8,
        `${conference}1`,
        `${conference}8`,
        4,
        1,
        `${conference}1`,
        5,
      ),
      series(
        `c${conference}4-5`,
        'first-round',
        conference,
        4,
        5,
        `${conference}4`,
        `${conference}5`,
        2,
        2,
        null,
        4,
      ),
      series(
        `c${conference}3-6`,
        'first-round',
        conference,
        3,
        6,
        `${conference}3`,
        `${conference}6`,
        0,
        0,
        null,
        0,
      ),
      series(
        `c${conference}2-7`,
        'first-round',
        conference,
        2,
        7,
        `${conference}2`,
        `${conference}7`,
        4,
        0,
        `${conference}2`,
        4,
      ),
    ],
    semifinals: [
      series(
        `c${conference}1-5`,
        'conference-semifinal',
        conference,
        1,
        5,
        `${conference}1`,
        `${conference}5`,
        0,
        0,
        null,
        0,
      ),
      series(
        `c${conference}3-2`,
        'conference-semifinal',
        conference,
        3,
        2,
        `${conference}3`,
        `${conference}2`,
        0,
        0,
        null,
        0,
      ),
    ],
    conferenceFinal: series(
      `c${conference}1-2`,
      'conference-final',
      conference,
      1,
      2,
      `${conference}1`,
      `${conference}2`,
      0,
      0,
      null,
      0,
    ),
  });
  state.bracket = {
    schemaVersion: 1,
    postseasonVersion: 'postseason-v2',
    east: conferenceBracket('east'),
    west: conferenceBracket('west'),
    finals: series('finals', 'finals', null, null, null, 'east1', 'west1', 0, 0, null, 0),
    championFranchiseId: null,
  };
  return state;
}
const NAME = (franchiseId: string): string => `Team ${franchiseId}`;
const ABBREV = (franchiseId: string): string => franchiseId.toUpperCase().slice(0, 3);
describe('PostseasonBracket', () => {
  it('renders the five desktop round columns with the Play-In games', () => {
    const postseason = fixturePostseason();
    const { container } = render(PostseasonBracket, {
      props: {
        postseason,
        franchiseName: NAME,
        franchiseAbbrev: ABBREV,
        manifest: MANIFEST,
        humanFranchiseId: 'e1',
      },
    });
    const columns = [...container.querySelectorAll('h3')].map((heading) => heading.textContent);
    expect(columns).toEqual(
      expect.arrayContaining([
        'Play-In',
        'First Round',
        'Conference Semis',
        'Conference Finals',
        'Finals',
      ]),
    );
    expect(container.querySelectorAll('[data-season-playin-card]')).toHaveLength(12);
    expect(container.querySelectorAll('[data-season-series-card]')).toHaveLength(30);
  });
  it('shows series score, next game host, and the completed result', () => {
    const postseason = fixturePostseason();
    const { container } = render(PostseasonBracket, {
      props: {
        postseason,
        franchiseName: NAME,
        franchiseAbbrev: ABBREV,
        manifest: MANIFEST,
        humanFranchiseId: null,
      },
    });
    const completed = container.querySelector('[data-season-series-card="ceast1-8"]');
    expect(completed).not.toBeNull();
    expect(completed?.textContent).toContain('4–1');
    expect(completed?.textContent).toContain('wins 4–1');
    const inProgress = container.querySelector('[data-season-series-card="ceast4-5"]');
    expect(inProgress?.textContent).toContain('2–2');
    expect(inProgress?.textContent).toContain('Next: Game 5 · at Team east4');
    const upcoming = container.querySelector('[data-season-series-card="ceast3-6"]');
    expect(upcoming?.textContent).toContain('Next: Game 1 · at Team east3');
    expect(upcoming?.textContent).toContain('home court EAS');
  });
  it('renders Play-In cards with seeds and win-or-go-home copy', () => {
    const postseason = fixturePostseason();
    const { container } = render(PostseasonBracket, {
      props: {
        postseason,
        franchiseName: NAME,
        franchiseAbbrev: ABBREV,
        manifest: MANIFEST,
        humanFranchiseId: 'east9',
      },
    });
    const nineTen = container.querySelector('[data-season-playin-card="pi-east-nine-ten"]');
    expect(nineTen).not.toBeNull();
    expect(nineTen?.textContent).toContain('East · 9 vs 10');
    expect(nineTen?.textContent).toContain('98–91');
    expect(nineTen?.textContent).toContain('Loser eliminated');
    expect(nineTen?.textContent).toContain('Team east9');
    expect(nineTen?.querySelector('[aria-label="your team"]')).not.toBeNull();
  });
});
describe('SeriesCard accessibility', () => {
  it('labels the win pips for each side', () => {
    const card = {
      seriesId: 'a1-8',
      round: 'first-round' as const,
      conference: 'east' as const,
      label: 'First Round',
      homeFranchiseId: 'a',
      awayFranchiseId: 'b',
      homeSeed: 1,
      awaySeed: 8,
      homeWins: 3,
      awayWins: 1,
      winnerFranchiseId: null,
      nextGame: { gameNumber: 5, homeFranchiseId: 'a' },
      lastResult: {
        gameNumber: 4,
        homeFranchiseId: 'b',
        awayFranchiseId: 'a',
        homeScore: 96,
        awayScore: 104,
      },
      status: 'in-progress' as const,
      humanSeries: false,
    };
    const { container } = render(SeriesCard, {
      props: {
        card,
        franchiseName: NAME,
        franchiseAbbrev: ABBREV,
        manifest: MANIFEST,
        humanFranchiseId: null,
      },
    });
    const pipGroups = container.querySelectorAll('span[aria-label]');
    const labels = [...pipGroups].map((el) => el.getAttribute('aria-label'));
    expect(labels).toContain('3 wins');
    expect(labels).toContain('1 wins');
  });
});
describe('PlayInCard accessibility', () => {
  it('marks the winner and the loser with text, not color alone', () => {
    const { container } = render(PlayInCard, {
      props: {
        card: {
          gameId: 'pi-east-seven-eight',
          matchup: 'seven-eight',
          matchupLabel: '7 vs 8',
          conference: 'east',
          homeFranchiseId: 'east7',
          awayFranchiseId: 'east8',
          homeSeed: 7,
          awaySeed: 8,
          status: 'final',
          homeScore: 112,
          awayScore: 101,
          winnerFranchiseId: 'east7',
          loserFranchiseId: 'east8',
          consequence: 'Winner takes seed 7 · loser hosts the final',
          humanGame: true,
          started: true,
        },
        franchiseName: NAME,
        franchiseAbbrev: ABBREV,
        manifest: MANIFEST,
        humanFranchiseId: 'east7',
      },
    });
    const winnerRow = container.querySelector('[data-playin-team="east7"]');
    expect(winnerRow?.textContent).toContain('W');
    const loserRow = container.querySelector('[data-playin-team="east8"]');
    expect(loserRow?.textContent).toContain('L');
    expect(loserRow?.textContent).toContain('Team east8');
  });
});
