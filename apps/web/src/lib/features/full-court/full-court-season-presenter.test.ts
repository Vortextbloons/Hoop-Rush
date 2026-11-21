import { describe, expect, test } from 'bun:test';
import type { FullCourtPlayoffScore } from '@hoop-rush/data-contracts';
import {
  createFullCourtSeasonCheckpoint,
  fullCourtPlayoffView,
  type FullCourtPlayoffSeries,
} from '@hoop-rush/engine';
import {
  fullCourtFinalRecap,
  fullCourtHomeControls,
  fullCourtNextMatchup,
  fullCourtResultOf,
  fullCourtSeriesGames,
} from './full-court-season-presenter';
import { fullCourtTestPlayoffLock, fullCourtTestSeasonLock } from './full-court-test-support';

const game: FullCourtPlayoffScore = {
  gameId: 'fcp-1-0-3',
  dayOffset: 180,
  homeTeamId: 'lal',
  awayTeamId: 'bos',
  winnerTeamId: 'bos',
  outcome: { kind: 'forfeit', losingSides: ['home', 'away'] },
};

test('shows a double forfeit as a loss from either regular-season perspective', () => {
  for (const teamId of [game.homeTeamId, game.awayTeamId]) {
    expect(fullCourtResultOf(game, teamId)).toMatchObject({
      won: false,
      doubleForfeit: true,
      scoreLabel: 'Double forfeit',
      userPoints: null,
      opponentPoints: null,
    });
  }
});

test('shows the recorded series winner even when the home team and away team both forfeit', () => {
  const series: FullCourtPlayoffSeries = {
    seriesId: 'fcs-1-0',
    round: 1,
    seriesSlot: 0,
    highSeed: 1,
    lowSeed: 8,
    highTeamId: game.winnerTeamId,
    lowTeamId: game.homeTeamId,
    games: [game],
  };
  expect(fullCourtSeriesGames(series, game.awayTeamId)[0]).toMatchObject({
    won: true,
    doubleForfeit: true,
    scoreLabel: 'Double forfeit',
  });
  expect(fullCourtSeriesGames(series, game.homeTeamId)[0]?.won).toBe(false);
});

const lock = fullCourtTestSeasonLock();
const userTeamId = lock.season.userTeamId;
const opened = createFullCourtSeasonCheckpoint(lock);
const teamNameOf = (teamId: string) =>
  lock.season.teams.find((team) => team.teamId === teamId)?.displayName ?? teamId;
const userFixtureOf = (slot: number) =>
  lock.season.games.find(
    (game) =>
      game.slot === slot && (game.homeTeamId === userTeamId || game.awayTeamId === userTeamId),
  );

describe('full court home controls', () => {
  test('offers the opening regular-season actions before any game is played', () => {
    const controls = fullCourtHomeControls({
      checkpoint: opened,
      playoff: null,
      pendingForfeit: false,
      busy: false,
    });
    expect(controls.primary).toMatchObject({ kind: 'sim', count: 1 });
    expect(controls.secondary.map((action) => action.count)).toEqual([5, 82]);
  });

  test('withholds sim actions while a forfeit waits for confirmation', () => {
    const controls = fullCourtHomeControls({
      checkpoint: opened,
      playoff: null,
      pendingForfeit: true,
      busy: false,
    });
    expect(controls.primary).toBeNull();
    expect(controls.secondary).toEqual([]);
    expect(controls.status).toBe('The next game cannot continue until the forfeit is accepted.');
  });

  test('offers playoff seeding once all 82 games are played', () => {
    const controls = fullCourtHomeControls({
      checkpoint: { ...opened, completedThroughSlot: 82 },
      playoff: null,
      pendingForfeit: false,
      busy: false,
    });
    expect(controls.primary).toMatchObject({ kind: 'start-playoffs', label: 'Start playoffs' });
    expect(controls.secondary).toEqual([]);
  });

  test('keeps the playoff primary action available during the bracket', () => {
    const playoffs = fullCourtTestPlayoffLock(lock);
    const view = fullCourtPlayoffView(playoffs.lock, playoffs.checkpoint);
    const controls = fullCourtHomeControls({
      checkpoint: { ...opened, completedThroughSlot: 82 },
      playoff: view,
      pendingForfeit: false,
      busy: false,
    });
    expect(controls.primary).toMatchObject({ kind: 'sim', label: 'Sim next game', count: 1 });
    expect(controls.secondary).toHaveLength(1);
    expect(controls.status).toBe('Accepted results save immediately.');
  });

  test('stops offering sim actions once a champion exists', () => {
    const playoffs = fullCourtTestPlayoffLock(lock);
    const view = fullCourtPlayoffView(playoffs.lock, playoffs.checkpoint);
    const controls = fullCourtHomeControls({
      checkpoint: { ...opened, completedThroughSlot: 82 },
      playoff: { ...view, championTeamId: userTeamId, nextGame: null },
      pendingForfeit: false,
      busy: false,
    });
    expect(controls.primary).toBeNull();
    expect(controls.secondary).toEqual([]);
  });
});

describe('full court matchup', () => {
  test('reads the next regular-season fixture from the locked schedule', () => {
    const matchup = fullCourtNextMatchup(lock, opened, null, teamNameOf);
    const fixture = userFixtureOf(1);
    expect(matchup).not.toBeNull();
    expect(matchup?.phase).toBe('regular');
    expect(matchup?.label).toBe('Game 1 of 82');
    expect([matchup?.home.teamId, matchup?.away.teamId]).toEqual([
      fixture?.homeTeamId,
      fixture?.awayTeamId,
    ]);
    expect(matchup?.userSide).toBe(fixture?.homeTeamId === userTeamId ? 'home' : 'away');
    expect(matchup?.series).toBeNull();
  });

  test('reads the next playoff game with its seeds and series score', () => {
    const playoffs = fullCourtTestPlayoffLock(lock);
    const view = fullCourtPlayoffView(playoffs.lock, playoffs.checkpoint);
    const next = view.nextGame;
    expect(next).not.toBeNull();

    const matchup = fullCourtNextMatchup(
      lock,
      { ...opened, completedThroughSlot: 82 },
      view,
      teamNameOf,
    );
    expect(matchup).toMatchObject({
      phase: 'playoff',
      label: `Game ${String(next?.gameOrdinal)} · First round`,
      userSide: next?.homeTeamId === userTeamId ? 'home' : 'away',
    });
    expect(matchup?.home.seed).toBe(next?.homeSeed);
    expect(matchup?.away.seed).toBe(next?.awaySeed);
  });

  test('shows nothing to play once the regular season is complete', () => {
    expect(
      fullCourtNextMatchup(lock, { ...opened, completedThroughSlot: 82 }, null, teamNameOf),
    ).toBeNull();
  });
});

describe('full court final recap', () => {
  test('returns nothing until a champion is crowned', () => {
    expect(fullCourtFinalRecap(lock, null, teamNameOf)).toBeNull();
    const playoffs = fullCourtTestPlayoffLock(lock);
    const view = fullCourtPlayoffView(playoffs.lock, playoffs.checkpoint);
    expect(view.championTeamId).toBeNull();
    expect(fullCourtFinalRecap(lock, view, teamNameOf)).toBeNull();
  });

  test('summarises the user path and the champion once the bracket resolves', () => {
    const opponentId = lock.season.teams.find((team) => team.teamId !== userTeamId)?.teamId ?? '';
    const series: FullCourtPlayoffSeries = {
      seriesId: 'crs-1-0',
      round: 1,
      seriesSlot: 0,
      highSeed: 1,
      lowSeed: 8,
      highTeamId: userTeamId,
      lowTeamId: opponentId,
      games: Array.from({ length: 4 }, (_, index) => ({
        gameId: `fcp-1-0-${String(index + 1)}`,
        dayOffset: 180 + index,
        homeTeamId: userTeamId,
        awayTeamId: opponentId,
        winnerTeamId: opponentId,
        outcome: { kind: 'played' as const, homePoints: 90, awayPoints: 100 },
      })),
    };
    const recap = fullCourtFinalRecap(
      lock,
      {
        series: [series],
        championTeamId: opponentId,
        userOutcome: { status: 'eliminated', round: 1 },
        nextGame: null,
      },
      teamNameOf,
    );
    expect(recap).toMatchObject({
      championTeamId: opponentId,
      championName: teamNameOf(opponentId),
      userChampion: false,
      seriesWon: 0,
      seriesPlayed: 1,
      gameWins: 0,
      gameLosses: 4,
    });
    expect(recap?.series[0]).toMatchObject({
      roundLabel: 'First round',
      opponentId,
      won: false,
      userWins: 0,
      opponentWins: 4,
    });
  });

  test('reports a title run across every round the user played', () => {
    const opponentId = lock.season.teams.find((team) => team.teamId !== userTeamId)?.teamId ?? '';
    const rounds = [1, 2, 3, 4].map((round): FullCourtPlayoffSeries => ({
      seriesId: `crs-${String(round)}-0`,
      round,
      seriesSlot: 0,
      highSeed: 1,
      lowSeed: 8,
      highTeamId: userTeamId,
      lowTeamId: opponentId,
      games: Array.from({ length: 4 }, (_, index) => ({
        gameId: `fcp-${String(round)}-0-${String(index + 1)}`,
        dayOffset: 180 + round * 10 + index,
        homeTeamId: userTeamId,
        awayTeamId: opponentId,
        winnerTeamId: userTeamId,
        outcome: { kind: 'played' as const, homePoints: 100, awayPoints: 90 },
      })),
    }));
    const recap = fullCourtFinalRecap(
      lock,
      {
        series: rounds,
        championTeamId: userTeamId,
        userOutcome: { status: 'champion', round: 4 },
        nextGame: null,
      },
      teamNameOf,
    );
    expect(recap).toMatchObject({
      userChampion: true,
      seriesWon: 4,
      seriesPlayed: 4,
      gameWins: 16,
      gameLosses: 0,
      headline: 'Full Court champions',
    });
  });
});
