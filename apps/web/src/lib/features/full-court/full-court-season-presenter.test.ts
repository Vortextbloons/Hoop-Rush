import { describe, expect, test } from 'bun:test';
import {
  FULL_COURT_HEALTH_VERSION,
  fullCourtTeamHealthSchema,
  seedSchema,
  type FullCourtPlayoffAdaptation,
  type FullCourtPlayoffScore,
} from '@hoop-rush/data-contracts';
import {
  createFullCourtSeasonCheckpoint,
  fullCourtPlayoffView,
  fullCourtUserNextPlayoffMatchup,
  type FullCourtPlayoffSeries,
} from '@hoop-rush/engine';
import {
  FULL_COURT_REVIEW_SLOTS,
  fullCourtFinalRecap,
  fullCourtGameDayReadiness,
  fullCourtHomeControls,
  fullCourtNextMatchup,
  fullCourtNextReviewSlot,
  fullCourtNextUserFixture,
  fullCourtPlayoffAdjustmentChanged,
  fullCourtResultOf,
  fullCourtSeriesGames,
  fullCourtSimulationNotice,
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
    expect(controls.secondary.map((action) => action.count)).toEqual([5, 20, 82]);
    expect(controls.secondary.map((action) => action.label)).toContain('Sim to next review');
  });

  test('offers quarterly review checkpoints and withholds illegal rest plans', () => {
    expect(FULL_COURT_REVIEW_SLOTS).toEqual([20, 41, 61, 82]);
    expect(fullCourtNextReviewSlot(0)).toBe(20);
    expect(fullCourtNextReviewSlot(20)).toBe(41);
    expect(fullCourtNextReviewSlot(61)).toBe(82);
    expect(fullCourtNextReviewSlot(82)).toBeNull();

    const review = fullCourtHomeControls({
      checkpoint: { ...opened, completedThroughSlot: 61 },
      playoff: null,
      pendingForfeit: false,
      busy: false,
    });
    expect(review.secondary.map((action) => action.label)).toEqual(['Sim 5', 'Sim to next review']);
    expect(review.secondary.at(-1)?.count).toBe(21);

    const blocked = fullCourtHomeControls({
      checkpoint: opened,
      playoff: null,
      pendingForfeit: false,
      busy: false,
      restConflict: true,
    });
    expect(blocked.primary).toBeNull();
    expect(blocked.secondary).toEqual([]);
    expect(blocked.status).toContain('fewer than five');
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
    expect(controls.status).toBe(
      'Sims count your games; AI-only bracket games advance automatically.',
    );
  });

  test('offers a remaining-bracket batch after the user is eliminated', () => {
    const playoffs = fullCourtTestPlayoffLock(lock);
    const view = fullCourtPlayoffView(playoffs.lock, playoffs.checkpoint);
    const controls = fullCourtHomeControls({
      checkpoint: { ...opened, completedThroughSlot: 82 },
      playoff: { ...view, userOutcome: { status: 'eliminated', round: 1 } },
      pendingForfeit: false,
      busy: false,
    });
    expect(controls.primary).toMatchObject({ kind: 'sim', label: 'Sim next game', count: 1 });
    expect(controls.secondary[0]).toMatchObject({
      label: 'Sim remaining games',
    });
    expect(controls.status).toContain('Your run is over');
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

  test('reads the next user playoff game even when AI-only games come first', () => {
    const playoffs = fullCourtTestPlayoffLock(lock);
    const view = fullCourtPlayoffView(playoffs.lock, playoffs.checkpoint);
    const next = fullCourtUserNextPlayoffMatchup({
      userTeamId,
      runSeed: lock.season.runSeed,
      series: view.series,
    });
    expect(next).not.toBeNull();
    expect(view.nextGame?.userSide).toBeNull();

    const matchup = fullCourtNextMatchup(
      lock,
      { ...opened, completedThroughSlot: 82 },
      view,
      teamNameOf,
    );
    expect(matchup).toMatchObject({
      phase: 'playoff',
      label: `Game ${String(next?.gameOrdinal)} · First round`,
      userSide: next?.userSide,
    });
    expect(matchup?.home.seed).toBe(next?.homeSeed);
    expect(matchup?.away.seed).toBe(next?.awaySeed);
    expect([matchup?.home.teamId, matchup?.away.teamId]).toEqual([
      next?.homeTeamId,
      next?.awayTeamId,
    ]);
  });

  test('shows nothing to play once the regular season is complete', () => {
    expect(
      fullCourtNextMatchup(lock, { ...opened, completedThroughSlot: 82 }, null, teamNameOf),
    ).toBeNull();
  });
});

describe('full court game-day readiness', () => {
  const userTeam = lock.season.teams.find((team) => team.teamId === userTeamId);
  if (userTeam === undefined) throw new Error('Missing user team');
  const fixture = fullCourtNextUserFixture(lock, opened, null);
  if (fixture === null) throw new Error('Missing next user fixture');
  const rosterIds = userTeam.roster.map((player) => player.playerId);
  const firstId = rosterIds[0];
  const secondId = rosterIds[1];
  if (firstId === undefined || secondId === undefined) {
    throw new Error('Full Court readiness test needs two players');
  }

  test('reads availability at the next fixture day so a return-day player can play', () => {
    const health = fullCourtTeamHealthSchema.parse({
      version: FULL_COURT_HEALTH_VERSION,
      teamId: userTeamId,
      throughDay: fixture.dayOffset - 1,
      players: {
        [firstId]: {
          loadBasisPoints: 6_000,
          availableFromDay: fixture.dayOffset,
        },
      },
    });
    const ready = fullCourtGameDayReadiness({
      roster: userTeam.roster,
      availability: userTeam.availability,
      health,
      fixture,
      restingPlayerIds: [],
    });
    expect(ready.players[0]).toMatchObject({
      status: 'ready',
      statusLabel: 'Ready',
    });

    const stillOut = fullCourtGameDayReadiness({
      roster: userTeam.roster,
      availability: userTeam.availability,
      health: fullCourtTeamHealthSchema.parse({
        ...health,
        players: {
          [firstId]: {
            loadBasisPoints: 6_000,
            availableFromDay: fixture.dayOffset + 1,
          },
        },
      }),
      fixture,
      restingPlayerIds: [],
    });
    expect(stillOut.players[0]).toMatchObject({
      status: 'injured',
      statusLabel: 'Out',
    });
  });

  test('recovers workload across rest days before the next fixture', () => {
    const throughDay = Math.max(0, fixture.dayOffset - 2);
    const recoveryDays = fixture.dayOffset - throughDay;
    const health = fullCourtTeamHealthSchema.parse({
      version: FULL_COURT_HEALTH_VERSION,
      teamId: userTeamId,
      throughDay,
      players: {
        [firstId]: {
          loadBasisPoints: 3_000 + recoveryDays * 3_500,
          availableFromDay: null,
        },
      },
    });
    const readiness = fullCourtGameDayReadiness({
      roster: userTeam.roster,
      availability: userTeam.availability,
      health,
      fixture,
      restingPlayerIds: [],
    });
    expect(readiness.players[0]).toMatchObject({
      status: 'ready',
      detail: '30% carried into this game',
    });
  });

  test('warns when injuries leave fewer than five and when rest would do the same', () => {
    const health = fullCourtTeamHealthSchema.parse({
      version: FULL_COURT_HEALTH_VERSION,
      teamId: userTeamId,
      throughDay: fixture.dayOffset - 1,
      players: {
        [firstId]: { loadBasisPoints: 0, availableFromDay: fixture.dayOffset + 5 },
        [secondId]: { loadBasisPoints: 0, availableFromDay: fixture.dayOffset + 5 },
      },
    });
    const short = fullCourtGameDayReadiness({
      roster: userTeam.roster,
      availability: userTeam.availability,
      health,
      fixture,
      restingPlayerIds: [],
    });
    expect(short.eligibleCount).toBe(rosterIds.length - 2);
    expect(short.forfeitLikely).toBe(true);
    expect(short.warnings[0]).toContain('forfeit is unavoidable');

    const oneOut = fullCourtGameDayReadiness({
      roster: userTeam.roster,
      availability: userTeam.availability,
      health: fullCourtTeamHealthSchema.parse({
        ...health,
        players: {
          [firstId]: { loadBasisPoints: 0, availableFromDay: fixture.dayOffset + 5 },
        },
      }),
      fixture,
      restingPlayerIds: [secondId],
    });
    expect(oneOut.eligibleCount).toBe(rosterIds.length - 1);
    expect(oneOut.availableCount).toBe(rosterIds.length - 2);
    expect(oneOut.restConflict).toBe(true);
    expect(oneOut.warnings[0]).toContain('leaves');
  });

  test('uses the next user playoff fixture when AI-only games are scheduled first', () => {
    const playoffs = fullCourtTestPlayoffLock(lock);
    const view = fullCourtPlayoffView(playoffs.lock, playoffs.checkpoint);
    const userSeries = view.series.find(
      (series) => series.highTeamId === userTeamId || series.lowTeamId === userTeamId,
    );
    const aiSeries = view.series.find(
      (series) => series.highTeamId !== userTeamId && series.lowTeamId !== userTeamId,
    );
    if (userSeries === undefined || aiSeries === undefined) {
      throw new Error('Missing playoff series');
    }
    const nextUser = fullCourtNextUserFixture(
      lock,
      { ...opened, completedThroughSlot: 82 },
      {
        ...view,
        nextGame: {
          seriesId: aiSeries.seriesId,
          round: aiSeries.round,
          seriesSlot: aiSeries.seriesSlot,
          gameOrdinal: 1,
          homeTeamId: aiSeries.highTeamId,
          awayTeamId: aiSeries.lowTeamId,
          homeSeed: aiSeries.highSeed,
          awaySeed: aiSeries.lowSeed,
          userSide: null,
          isFinals: false,
          seed: seedSchema.parse('a'.repeat(32)),
          gameId: `fcp-${String(aiSeries.round)}-${String(aiSeries.seriesSlot)}-1`,
          dayOffset: 250,
        },
      },
    );
    expect(nextUser).toMatchObject({
      phase: 'playoff',
      gameId: `fcp-${String(userSeries.round)}-${String(userSeries.seriesSlot)}-1`,
      userSide: userSeries.highTeamId === userTeamId ? 'home' : 'away',
      dayOffset: Math.max(...lock.season.games.map((game) => game.dayOffset)) + 3,
    });
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

describe('full court simulation interruptions', () => {
  test('regular-season single games and short batches pause for reviews and injuries', () => {
    const controls = fullCourtHomeControls({
      checkpoint: opened,
      playoff: null,
      pendingForfeit: false,
      busy: false,
    });
    expect(controls.primary).toMatchObject({
      count: 1,
      stopAtInjury: true,
      stopAtReview: true,
    });
    const five = controls.secondary.find((action) => action.label === 'Sim 5');
    expect(five).toMatchObject({ stopAtInjury: true, stopAtReview: true });
    const remaining = controls.secondary.find((action) => action.label === 'Sim remaining games');
    expect(remaining).toBeDefined();
    expect(remaining?.stopAtInjury).toBeUndefined();
    expect(remaining?.stopAtReview).toBeUndefined();
  });

  test('playoff sims leave series and opponent decisions to the controller', () => {
    const playoffs = fullCourtTestPlayoffLock(lock);
    const view = fullCourtPlayoffView(playoffs.lock, playoffs.checkpoint);
    const controls = fullCourtHomeControls({
      checkpoint: { ...opened, completedThroughSlot: 82 },
      playoff: view,
      pendingForfeit: false,
      busy: false,
    });
    expect(controls.primary?.stopAtInjury).toBeUndefined();
    expect(controls.secondary[0]?.label).toBe('Sim next five');
    expect(controls.secondary[0]?.count).toBe(5);
  });

  test('regular-season batches stay uninterrupted once the season is over', () => {
    const controls = fullCourtHomeControls({
      checkpoint: { ...opened, completedThroughSlot: 82 },
      playoff: null,
      pendingForfeit: false,
      busy: false,
    });
    expect(controls.primary).toMatchObject({ kind: 'start-playoffs' });
    expect(controls.secondary).toEqual([]);
  });
});

describe('full court stored playoff adaptations', () => {
  const adaptation: FullCourtPlayoffAdaptation = {
    defense: 'protect-paint',
    reason: 'persistent-inside-scoring',
    sampleGames: 2,
    windowGames: 2,
    observedShareBps: 5_000,
    thresholdShareBps: 4_600,
  };

  test('reads the opponent adjustment stored on each series game', () => {
    const played: FullCourtPlayoffScore = {
      gameId: 'fcp-1-0-3',
      dayOffset: 180,
      homeTeamId: 'lal',
      awayTeamId: 'bos',
      winnerTeamId: 'lal',
      outcome: { kind: 'played', homePoints: 100, awayPoints: 95 },
      adaptations: { home: adaptation },
      evidence: {
        home: {
          fieldGoalAttempts: 100,
          rimAttempts: 60,
          leadUsageCentis: 4_000,
          teamUsageCentis: 12_000,
        },
        away: {
          fieldGoalAttempts: 100,
          rimAttempts: 38,
          leadUsageCentis: 4_000,
          teamUsageCentis: 12_000,
        },
      },
    };
    const series: FullCourtPlayoffSeries = {
      seriesId: 'fcs-1-0',
      round: 1,
      seriesSlot: 0,
      highSeed: 1,
      lowSeed: 8,
      highTeamId: 'lal',
      lowTeamId: 'bos',
      games: [played],
    };

    expect(fullCourtSeriesGames(series, 'bos')[0]?.opponentAdaptation).toEqual(adaptation);
    expect(fullCourtSeriesGames(series, 'bos')[0]?.adjustmentResponse).toBe(
      'Your rim share was 38% this game, after 50% in the prior sample.',
    );
    expect(fullCourtSeriesGames(series, 'lal')[0]?.opponentAdaptation).toBeNull();
  });

  test('treats a new or changed opponent setting as an adjustment, not a repeat', () => {
    expect(fullCourtPlayoffAdjustmentChanged(undefined, adaptation)).toBe(true);
    expect(fullCourtPlayoffAdjustmentChanged(null, adaptation)).toBe(true);
    expect(fullCourtPlayoffAdjustmentChanged(adaptation, adaptation)).toBe(false);
    expect(
      fullCourtPlayoffAdjustmentChanged(adaptation, {
        ...adaptation,
        defense: 'pressure',
        reason: 'persistent-opportunity-concentration',
      }),
    ).toBe(true);
    expect(fullCourtPlayoffAdjustmentChanged(adaptation, undefined)).toBe(false);
  });
});

describe('full court stop notices', () => {
  const playerNameOf = (playerId: string) => `Player ${playerId}`;

  test('describes schedule reviews, injuries, series, and opponent decisions', () => {
    expect(
      fullCourtSimulationNotice({ kind: 'review', slot: 20 }, teamNameOf, playerNameOf),
    ).toMatchObject({
      tone: 'info',
      title: 'Scheduled review · 20 games played',
    });
    expect(
      fullCourtSimulationNotice(
        { kind: 'injury', slot: 4, playerIds: ['p1'], availableFromDay: 12 },
        teamNameOf,
        playerNameOf,
      ),
    ).toMatchObject({
      tone: 'warning',
      title: 'Player p1 is out',
      message: 'Out until day 12. Adjust rest or rotation before continuing.',
    });
    expect(
      fullCourtSimulationNotice(
        {
          kind: 'series-complete',
          round: 1,
          opponentTeamId: lock.season.teams[1]?.teamId ?? 'opponent',
          won: true,
          userWins: 4,
          opponentWins: 2,
        },
        teamNameOf,
        playerNameOf,
      ),
    ).toMatchObject({ tone: 'success', title: 'Series won' });
    expect(
      fullCourtSimulationNotice(
        { kind: 'opponent-change', round: 2, opponentTeamId: 'opponent', gameOrdinal: 1 },
        teamNameOf,
        playerNameOf,
      ),
    ).toMatchObject({ title: 'Next opponent: opponent' });
  });

  test('explains an adjusted opponent and a finished bracket', () => {
    const adaptation: FullCourtPlayoffAdaptation = {
      defense: 'pressure',
      reason: 'persistent-opportunity-concentration',
      sampleGames: 2,
      windowGames: 2,
      observedShareBps: 2_800,
      thresholdShareBps: 2_600,
    };
    const adjustmentNotice = fullCourtSimulationNotice(
      {
        kind: 'opponent-adjustment',
        round: 1,
        opponentTeamId: 'opponent',
        gameOrdinal: 3,
        adaptation,
      },
      teamNameOf,
      playerNameOf,
    );
    expect(adjustmentNotice).toMatchObject({
      tone: 'warning',
      title: 'Opponent adjusted: Pressure',
    });
    expect(adjustmentNotice.message).toContain('Game 3');
    expect(
      fullCourtSimulationNotice(
        { kind: 'playoffs-complete', championTeamId: 'opponent', userTeamId },
        teamNameOf,
        playerNameOf,
      ),
    ).toMatchObject({ title: 'Bracket complete' });
  });
});
