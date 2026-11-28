import { describe, expect, test } from 'bun:test';
import {
  FULL_COURT_HEALTH_VERSION,
  fullCourtSeasonScoreSchema,
  fullCourtTeamHealthSchema,
  seedSchema,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import {
  createFullCourtSeasonCheckpoint,
  fullCourtPlayoffView,
  fullCourtStandings,
  type FullCourtSeasonLock,
} from '@hoop-rush/engine';
import { render } from 'svelte/server';
import type {
  FullCourtPlayoffView,
  FullCourtSimulationNotice,
} from './full-court-season-presenter';
import { fullCourtTestPlayoffLock, fullCourtTestSeasonLock } from './full-court-test-support';
import FullCourtSeasonView from './FullCourtSeasonView.svelte';
import FullCourtTeamDetail from './FullCourtTeamDetail.svelte';

const lock = fullCourtTestSeasonLock();
const userTeamId = lock.season.userTeamId;
const opened = createFullCourtSeasonCheckpoint(lock);
const completed = { ...opened, completedThroughSlot: 82 };

function renderView(input: {
  section?: 'home' | 'league' | 'stats' | 'playoffs';
  lock?: FullCourtSeasonLock;
  checkpoint?: typeof opened;
  scores?: readonly FullCourtSeasonScore[];
  playoff?: FullCourtPlayoffView | null;
  pendingForfeit?: boolean;
  health?: ReturnType<typeof fullCourtTeamHealthSchema.parse> | null;
  restingPlayerIds?: readonly string[];
  notice?: FullCourtSimulationNotice | null;
}): string {
  return render(FullCourtSeasonView, {
    props: {
      lock: input.lock ?? lock,
      checkpoint: input.checkpoint ?? opened,
      scores: input.scores ?? [],
      playoff: input.playoff ?? null,
      pendingForfeit: input.pendingForfeit ?? false,
      health: input.health ?? null,
      restingPlayerIds: input.restingPlayerIds ?? [],
      onRestingChange: () => {},
      busy: false,
      onAdvance: () => {},
      onStartPlayoffs: () => {},
      notice: input.notice ?? null,
      onDismissNotice: () => {},
      ...(input.section === undefined ? {} : { section: input.section }),
    },
  }).body;
}

function statsScore(input: {
  readonly withLineups: boolean;
  readonly forfeit?: boolean;
  readonly benchPoints?: number;
}): FullCourtSeasonScore {
  const opponent = 'opponent';
  if (input.forfeit === true) {
    return fullCourtSeasonScoreSchema.parse({
      gameId: 'fc-stats-2',
      slot: 2,
      homeTeamId: userTeamId,
      awayTeamId: opponent,
      outcome: { kind: 'forfeit', losingSides: ['home'] },
    });
  }
  const benchPoints = input.benchPoints ?? 20;
  return fullCourtSeasonScoreSchema.parse({
    gameId: 'fc-stats-1',
    slot: 1,
    homeTeamId: userTeamId,
    awayTeamId: opponent,
    outcome: {
      kind: 'played',
      homePoints: 100,
      awayPoints: 90,
      benchPoints: { home: benchPoints, away: 12 },
      benchPlayers: { home: 2, away: 2 },
      starterPoints: { home: 100 - benchPoints, away: 78 },
      ...(input.withLineups
        ? {
            lineups: {
              version: 1,
              side: 'home',
              sampleThreshold: 100,
              lineups: [
                {
                  playerIds: ['a', 'b', 'c', 'd', 'e'],
                  players: ['a', 'b', 'c', 'd', 'e'].map((playerId) => ({
                    playerId,
                    displayName: `Player ${playerId.toUpperCase()}`,
                  })),
                  seconds: 1800,
                  offensivePossessions: 120,
                  defensivePossessions: 120,
                  pointsFor: 100,
                  pointsAgainst: 90,
                },
                {
                  playerIds: ['a', 'b', 'c', 'd', 'f'],
                  players: ['a', 'b', 'c', 'd', 'f'].map((playerId) => ({
                    playerId,
                    displayName: `Player ${playerId.toUpperCase()}`,
                  })),
                  seconds: 120,
                  offensivePossessions: 5,
                  defensivePossessions: 5,
                  pointsFor: 0,
                  pointsAgainst: 0,
                },
              ],
              omitted: {
                lineups: 0,
                seconds: 0,
                offensivePossessions: 0,
                defensivePossessions: 0,
                pointsFor: 0,
                pointsAgainst: 0,
              },
            },
          }
        : {}),
    },
  });
}

function bracketView(): FullCourtPlayoffView {
  const playoffs = fullCourtTestPlayoffLock(lock);
  return fullCourtPlayoffView(playoffs.lock, playoffs.checkpoint);
}

describe('FullCourtSeasonView sections', () => {
  test('keeps the existing props working without a section', () => {
    const body = renderView({});
    expect(body).toContain('aria-label="Full Court season progress"');
    expect(body).toContain('Play next game');
    expect(body).not.toContain('aria-label="Full Court regular season"');
  });

  test('home leads with the next matchup and the season record', () => {
    const body = renderView({ section: 'home' });
    expect(body).toContain('Game 1 of 82');
    expect(body).toContain('Next game');
    expect(body).toContain('Latest Full Court result');
    expect(body).not.toContain('aria-label="Full Court standings"');
  });

  test('home shows game-day readiness and the review action', () => {
    const body = renderView({ section: 'home' });
    expect(body).toContain('aria-label="Full Court game-day readiness"');
    expect(body).toContain('Game 1 of 82');
    expect(body).toContain('Sim to next review');
    expect(body).toContain('Rest choices apply only to this game');
  });

  test('home warns about short rosters and illegal rest plans', () => {
    const userTeam = lock.season.teams.find((team) => team.teamId === userTeamId);
    const nextFixture = lock.season.games.find(
      (game) =>
        game.slot === 1 && (game.homeTeamId === userTeamId || game.awayTeamId === userTeamId),
    );
    if (userTeam === undefined || nextFixture === undefined) throw new Error('Missing fixture');
    const [first, second] = userTeam.roster;
    if (first === undefined || second === undefined) throw new Error('Missing player');
    const shortHealth = fullCourtTeamHealthSchema.parse({
      version: FULL_COURT_HEALTH_VERSION,
      teamId: userTeamId,
      throughDay: nextFixture.dayOffset - 1,
      players: {
        [first.playerId]: { loadBasisPoints: 0, availableFromDay: nextFixture.dayOffset + 5 },
        [second.playerId]: { loadBasisPoints: 0, availableFromDay: nextFixture.dayOffset + 5 },
      },
    });
    const short = renderView({ section: 'home', health: shortHealth });
    expect(short).toContain('forfeit is unavoidable');

    const oneOutHealth = fullCourtTeamHealthSchema.parse({
      ...shortHealth,
      players: {
        [first.playerId]: { loadBasisPoints: 0, availableFromDay: nextFixture.dayOffset + 5 },
      },
    });
    const blocked = renderView({
      section: 'home',
      health: oneOutHealth,
      restingPlayerIds: [second.playerId],
    });
    expect(blocked).toContain('Uncheck rest until at least five players can play');
    expect(blocked).not.toContain('Play next game');
  });

  test('home shows the postseason screen once the bracket exists', () => {
    const body = renderView({
      section: 'home',
      checkpoint: completed,
      playoff: bracketView(),
    });
    expect(body).toContain('Postseason');
    expect(body).toContain('Play next game');
    expect(body).toContain('aria-label="Full Court postseason"');
  });

  test('home hands the bracket to the postseason screen instead of simming it', () => {
    const body = renderView({
      section: 'home',
      checkpoint: completed,
      playoff: bracketView(),
    });
    expect(body).toContain('aria-label="Full Court postseason"');
    expect(body).toContain('aria-label="Full Court playoff bracket"');
    expect(body).not.toContain('aria-label="Full Court season progress"');
  });

  test('home replaces sim actions with the terminal recap after a champion', () => {
    const body = renderView({
      section: 'home',
      checkpoint: completed,
      playoff: { ...bracketView(), championTeamId: userTeamId, nextGame: null },
    });
    expect(body).toContain('aria-label="Full Court final recap"');
    expect(body).toContain('Full Court champions');
    expect(body).not.toContain('Play next game');
    expect(body).not.toContain('Start playoffs');
  });

  test('league holds the schedule and both conference tables', () => {
    const body = renderView({ section: 'league' });
    expect(body).toContain('aria-label="Full Court regular season"');
    expect(body).toContain('aria-label="Full Court standings"');
    expect(body).toContain('West Full Court standings');
    expect(body).toContain('East Full Court standings');
    expect(body).not.toContain('Game 1 of 82');
    expect(body).not.toContain('aria-label="Full Court final recap"');
  });

  test('stats shows bench scoring and withholds lineup ranks below the sample floor', () => {
    const body = renderView({ section: 'stats', scores: [statsScore({ withLineups: true })] });
    expect(body).toContain('aria-label="Full Court season stats"');
    expect(body).toContain('aria-label="Full Court lineup lab"');
    expect(body).toContain('Bench points');
    expect(body).toContain('Player A · Player B · Player C · Player D · Player E');
    expect(body).toContain('100 possessions are marked with *');
    expect(body).not.toContain('No lineup facts in this save');
    expect(body).not.toContain('aria-label="Full Court regular season"');
  });

  test('stats keeps legacy saves honest when no lineup facts were recorded', () => {
    const body = renderView({ section: 'stats', scores: [statsScore({ withLineups: false })] });
    expect(body).toContain('0 of 1 games with');
    expect(body).toContain('No lineup facts in this save');
    expect(body).toContain('Bench points');
  });

  test('stats separates forfeits from played-game coverage', () => {
    const body = renderView({
      section: 'stats',
      scores: [
        statsScore({ withLineups: true }),
        statsScore({ withLineups: false, forfeit: true }),
      ],
    });
    expect(body).toContain('Forfeits (1) are excluded');
    expect(body).toContain('1 of 1 games with');
  });

  test('playoffs lists the series and bracket, not the schedule', () => {
    const body = renderView({
      section: 'playoffs',
      checkpoint: completed,
      playoff: bracketView(),
    });
    expect(body).toContain('aria-label="Full Court playoff bracket"');
    expect(body).toContain('Four rounds to the title');
    expect(body).toContain('aria-label="Your playoff series"');
    expect(body).toContain('Your series is live');
    expect(body).not.toContain('aria-label="Full Court regular season"');
  });

  test('playoffs before the bracket explains the 82-game gate', () => {
    const body = renderView({ section: 'playoffs' });
    expect(body).toContain('The bracket opens after 82 games');
    expect(body).not.toContain('Start playoffs');
  });

  test('playoffs offers seeding once the regular season is complete', () => {
    const body = renderView({ section: 'playoffs', checkpoint: completed });
    expect(body).toContain('The bracket is ready to seed');
    expect(body).toContain('Start playoffs');
  });
});

test('forfeit confirmation replaces the sim actions with the alert', () => {
  const body = renderView({ section: 'home', pendingForfeit: true });
  expect(body).toContain('Confirm the forfeit');
  expect(body).toContain('Confirm forfeit');
  expect(body).not.toContain('Sim remaining games');
  expect(body).not.toContain('Play next game');
});

test('shows opponent tactical adjustment in playoff preview only once series evidence triggers it', () => {
  const initial = bracketView();
  const withoutAdjustment = renderView({
    section: 'home',
    checkpoint: completed,
    playoff: initial,
  });
  expect(withoutAdjustment).not.toContain('aria-label="Playoff opponent adjustment"');

  const userSeries = initial.series.find(
    (entry) => entry.highTeamId === userTeamId || entry.lowTeamId === userTeamId,
  );
  if (userSeries === undefined) throw new Error('missing user series');
  const opponentId =
    userSeries.highTeamId === userTeamId ? userSeries.lowTeamId : userSeries.highTeamId;
  const userIsHigh = userSeries.highTeamId === userTeamId;
  const sideEvidence = (rim: number, fga: number, lead: number, team: number) => ({
    fieldGoalAttempts: fga,
    rimAttempts: rim,
    leadUsageCentis: lead,
    teamUsageCentis: team,
  });
  const adaptedSeries = initial.series.map((entry) =>
    entry.seriesId === userSeries.seriesId
      ? {
          ...entry,
          games: [
            {
              gameId: `fcp-1-${String(entry.seriesSlot)}-1`,
              dayOffset: 173,
              homeTeamId: entry.highTeamId,
              awayTeamId: entry.lowTeamId,
              winnerTeamId: userTeamId,
              outcome: { kind: 'played' as const, homePoints: 102, awayPoints: 95 },
              evidence: {
                home: userIsHigh
                  ? sideEvidence(24, 80, 2900, 10000)
                  : sideEvidence(24, 80, 1900, 10000),
                away: userIsHigh
                  ? sideEvidence(24, 80, 1900, 10000)
                  : sideEvidence(24, 80, 2900, 10000),
              },
            },
            {
              gameId: `fcp-1-${String(entry.seriesSlot)}-2`,
              dayOffset: 175,
              homeTeamId: entry.highTeamId,
              awayTeamId: entry.lowTeamId,
              winnerTeamId: userTeamId,
              outcome: { kind: 'played' as const, homePoints: 104, awayPoints: 98 },
              evidence: {
                home: userIsHigh
                  ? sideEvidence(24, 80, 2800, 10000)
                  : sideEvidence(24, 80, 1900, 10000),
                away: userIsHigh
                  ? sideEvidence(24, 80, 1900, 10000)
                  : sideEvidence(24, 80, 2800, 10000),
              },
            },
          ],
        }
      : entry,
  );

  const adaptedView: FullCourtPlayoffView = {
    ...initial,
    series: adaptedSeries,
    nextGame: {
      seriesId: userSeries.seriesId,
      round: 1,
      seriesSlot: userSeries.seriesSlot,
      gameOrdinal: 3,
      homeTeamId: opponentId,
      awayTeamId: userTeamId,
      homeSeed: userSeries.lowSeed,
      awaySeed: userSeries.highSeed,
      userSide: 'away',
      isFinals: false,
      seed: seedSchema.parse('a'.repeat(32)),
      gameId: `fcp-1-${String(userSeries.seriesSlot)}-3`,
      dayOffset: 177,
    },
  };

  const homeBody = renderView({
    section: 'home',
    checkpoint: completed,
    playoff: adaptedView,
  });
  expect(homeBody).toContain('aria-label="Playoff opponent adjustment"');
  expect(homeBody).toContain('Pressure');
  expect(homeBody).toContain('Persistent opportunity concentration');
  expect(homeBody).toContain(
    '28.5% lead-player opportunity share across 2 played games (threshold 26%).',
  );

  const playoffsBody = renderView({
    section: 'playoffs',
    checkpoint: completed,
    playoff: adaptedView,
  });
  expect(playoffsBody).toContain('aria-label="Playoff opponent adjustment"');
  expect(playoffsBody).toContain('Pressure');
});

test('home renders typed simulation stop feedback', () => {
  const body = renderView({
    section: 'home',
    notice: {
      stop: { kind: 'injury', slot: 4, playerIds: ['p1'], availableFromDay: 12 },
      tone: 'warning',
      title: 'Bench Guard is out',
      message: 'Out until day 12. Adjust rest or rotation before continuing.',
    },
  });
  expect(body).toContain('Bench Guard is out');
  expect(body).toContain('Adjust rest or rotation before continuing.');
  expect(body).toContain('Dismiss');
});

test('playoffs surfaces stored per-game opponent adjustments in the series list', () => {
  const initial = bracketView();
  const adaptation = {
    defense: 'protect-paint' as const,
    reason: 'persistent-inside-scoring' as const,
    sampleGames: 2,
    windowGames: 2,
    observedShareBps: 5_000,
    thresholdShareBps: 4_600,
  };
  const userSeries = initial.series.find(
    (entry) => entry.highTeamId === userTeamId || entry.lowTeamId === userTeamId,
  );
  if (userSeries === undefined) throw new Error('missing user series');
  const userIsHigh = userSeries.highTeamId === userTeamId;
  const adaptedSeries = initial.series.map((entry) =>
    entry.seriesId === userSeries.seriesId
      ? {
          ...entry,
          games: [
            {
              gameId: `fcp-1-${String(entry.seriesSlot)}-1`,
              dayOffset: 173,
              homeTeamId: entry.highTeamId,
              awayTeamId: entry.lowTeamId,
              winnerTeamId: entry.highTeamId,
              outcome: { kind: 'played' as const, homePoints: 102, awayPoints: 95 },
              adaptations: userIsHigh ? { away: adaptation } : { home: adaptation },
            },
          ],
        }
      : entry,
  );

  const body = renderView({
    section: 'playoffs',
    checkpoint: completed,
    playoff: { ...initial, series: adaptedSeries },
  });
  expect(body).toContain('Game 1 opponent adjustment: Protect paint');
  expect(body).toContain('Persistent inside scoring');
});

test('makes conference standings teams clickable and renders team detail stats', () => {
  const leagueBody = renderView({ section: 'league' });
  const opponent = lock.season.teams.find((team) => team.teamId !== userTeamId);
  if (opponent === undefined) throw new Error('Expected an opponent team');

  expect(leagueBody).toContain(`<button type="button"`);
  expect(leagueBody).toContain(opponent.displayName);

  const standings = fullCourtStandings(lock.season.teams, []);
  const standing =
    [...standings.west, ...standings.east].find((row) => row.teamId === opponent.teamId) ?? null;
  const detailBody = render(FullCourtTeamDetail, {
    props: {
      team: opponent,
      standing,
      scores: [],
      isUserTeam: false,
    },
  }).body;

  expect(detailBody).toContain(opponent.displayName);
  expect(detailBody).toContain('Roster &amp; season stats');
  expect(detailBody).toContain('PPG');
  expect(detailBody).toContain('OPP PPG');
  expect(detailBody).toContain('ui-stats-table');
  const firstPlayer = opponent.roster[0];
  if (firstPlayer === undefined) throw new Error('Expected at least one player on opponent roster');
  expect(detailBody).toContain(firstPlayer.displayName);
});
