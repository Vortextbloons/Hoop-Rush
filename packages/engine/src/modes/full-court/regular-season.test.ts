import { expect, test } from 'bun:test';
import {
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  FULL_COURT_DEFAULT_MONEY,
  FULL_COURT_DEFAULT_COACHING_PLAN,
  FULL_COURT_HEALTH_PROFILE_VERSION,
  FULL_COURT_HEALTH_VERSION,
  commandIdSchema,
  contentHashSchema,
  franchiseIdSchema,
  fullCourtCoachingPlanSchema,
  fullCourtSeasonCheckpointSchema,
  playerVersionId,
  type FullCourtCoachingRule,
  type FullCourtHealthProfileSet,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import { defaultFullCourtCoachingRotation } from './coaching.ts';
import { fullCourtDraftIndexOf } from './draft-catalog.ts';
import { applyFullCourtCommand, createFullCourtDraftState } from './draft-commands.ts';
import { fullCourtTestSetup } from './draft-test-support.ts';
import { checkFullCourtGameResult } from './game.ts';
import {
  buildFullCourtRegularSeason,
  fullCourtFutureDaysOf,
  fullCourtRegularSeasonGameInput,
  fullCourtSeasonIndexOf,
  simulateFullCourtRegularSeasonGame,
} from './regular-season.ts';
import {
  createFullCourtPlayoffCheckpoint,
  fullCourtPlayoffView,
  lockFullCourtPlayoffs,
  simulateFullCourtPlayoffGame,
} from './playoffs.ts';
import { buildFullCourtSeasonStats } from './report-season.ts';
import {
  createFullCourtSeasonCheckpoint,
  lockFullCourtRegularSeason,
  simulateFullCourtSeasonSlot,
  type FullCourtSeasonLock,
} from './season-slot.ts';

function preparedSeason() {
  const setup = fullCourtTestSetup({ overalls: [70, 71, 72, 73, 74, 75] });
  const field = CAP_RUSH_FRANCHISE_ALIGNMENT.map(({ franchiseId }) => ({
    teamId: franchiseId,
    displayName: franchiseId,
  }));
  const catalog = {
    ...setup.catalog,
    candidates: field.flatMap(({ teamId }) =>
      setup.catalog.candidates.map((player) => ({
        ...player,
        franchiseId: franchiseIdSchema.parse(teamId),
        playerVersionId: playerVersionId(player.playerId, teamId, player.eraId, player.seasonKey),
      })),
    ),
  };
  const catalogSource = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, catalogSource);
  let draft = createFullCourtDraftState(
    {
      ...setup.createCommand,
      catalog: catalogSource,
      money: { ...FULL_COURT_DEFAULT_MONEY, capLineDollars: 0, firstApronDollars: 0 },
    },
    index,
    { pool: 'open' },
  );
  const chosen = setup.catalog.candidates.filter((player) => player.positions.primary === 'PG');
  for (const candidate of chosen) {
    const outcome = applyFullCourtCommand(
      draft,
      {
        command: 'pick-full-court-player',
        commandId: commandIdSchema.parse(`pick-${String(draft.revision)}`),
        runId: draft.runId,
        expectedRevision: draft.revision,
        playerVersionId: candidate.playerVersionId,
      },
      { index },
    );
    expect(outcome.result.status).toBe('accepted');
    draft = outcome.state;
  }
  draft = applyFullCourtCommand(
    draft,
    {
      command: 'finish-full-court-draft',
      commandId: commandIdSchema.parse('finish'),
      runId: draft.runId,
      expectedRevision: draft.revision,
    },
    { index },
  ).state;

  const season = buildFullCourtRegularSeason({
    draft,
    field,
    catalog,
    catalogSource,
    profile: DEFAULT_ERA_SIM_PROFILE,
  });
  return { season, chosen };
}

test('indexes every fixture and future day set for the locked season', () => {
  const { season } = preparedSeason();
  const index = fullCourtSeasonIndexOf(season);
  expect(fullCourtSeasonIndexOf(season)).toBe(index);
  expect(index.gameById.size).toBe(season.games.length);
  expect(index.gamesBySlot.size).toBe(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM);
  for (let slot = 1; slot <= CAP_RUSH_CONFERENCE_GAMES_PER_TEAM; slot += 1) {
    expect(index.gamesBySlot.get(slot)).toHaveLength(15);
  }
  for (const fixture of season.games.slice(0, 12)) {
    for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
      const expected = season.games
        .filter(
          (game) =>
            game.slot > fixture.slot && (game.homeTeamId === teamId || game.awayTeamId === teamId),
        )
        .map((game) => game.dayOffset)
        .sort((left, right) => left - right);
      expect(fullCourtFutureDaysOf(season, fixture, teamId)).toEqual(expected);
    }
  }
});

test('a confirmed six-guard roster plays a scheduled game against a historical rotation', () => {
  const { season, chosen } = preparedSeason();
  expect(season.teams).toHaveLength(30);
  const fixture = season.games.find(
    (game) => game.homeTeamId === season.userTeamId || game.awayTeamId === season.userTeamId,
  );
  if (fixture === undefined) throw new Error('Missing user fixture');
  const game = fullCourtRegularSeasonGameInput(season, fixture.gameId);
  const homeUser = game.home.teamId === season.userTeamId;
  const user = homeUser ? game.home : game.away;
  const opponent = homeUser ? game.away : game.home;
  expect(user.roster.map((player) => player.playerVersionId)).toEqual(
    chosen.map((player) => player.playerVersionId),
  );
  expect(user.availability?.map((entry) => entry.staminaRating)).toEqual(
    chosen.map((player) => player.stamina.rating),
  );
  expect(user.roster[0]?.ratings.passing).toBe((chosen[0]?.detailedRatings.passing ?? 0) - 8);
  expect(opponent.roster).toHaveLength(12);
  expect(opponent.rotation?.startingFive).toHaveLength(5);

  const gameOutcome = simulateFullCourtRegularSeasonGame(
    season,
    fixture.gameId,
    createEngineContext(),
  );
  if (gameOutcome.kind !== 'played') throw new Error('Expected a playable fixture');
  const { result, health } = gameOutcome;
  expect(health.home.throughDay).toBe(fixture.dayOffset);
  expect(Object.keys(health.away.players).length).toBeGreaterThan(5);
  expect(checkFullCourtGameResult(result)).toEqual([]);
  const played = homeUser ? result.home : result.away;
  expect(played.players.some((player) => !player.startedGame && player.seconds > 0)).toBe(true);
});

test('pins the checked injury profile to the slot lock', () => {
  const { season } = preparedSeason();
  const catalogHash = contentHashSchema.parse('a'.repeat(64));
  const players: FullCourtHealthProfileSet['players'] = {};
  for (const team of season.teams) {
    for (const { playerVersionId } of team.roster) {
      if (playerVersionId === undefined) throw new Error('Missing fixture profile key');
      players[playerVersionId] = {
        cohortId: 'prior',
        episodesPer10kAppearances: 100,
        playerEvidence: { source: 'population' },
      };
    }
  }
  const profiles: FullCourtHealthProfileSet = {
    version: FULL_COURT_HEALTH_PROFILE_VERSION,
    catalogHash,
    evidenceHash: contentHashSchema.parse('b'.repeat(64)),
    cohorts: { prior: { durationCounts: [1, 0, 0, 0], observedAppearances: 100 } },
    players,
  };
  expect(() =>
    lockFullCourtRegularSeason(season, { profiles, catalogAssetHash: 'b'.repeat(64) }),
  ).toThrow('different catalog asset');
  const initial = createFullCourtSeasonCheckpoint(lockFullCourtRegularSeason(season));
  const lock = lockFullCourtRegularSeason(season, { profiles, catalogAssetHash: catalogHash });
  expect(() => simulateFullCourtSeasonSlot(lock, initial, createEngineContext())).toThrow(
    'does not match',
  );
});

test('simulates an entire slot, resumes serialized health, and pauses for decisions', () => {
  const { season, chosen } = preparedSeason();
  const lock = lockFullCourtRegularSeason(season);
  const initial = createFullCourtSeasonCheckpoint(lock);
  const context = createEngineContext();
  expect(
    simulateFullCourtSeasonSlot(lock, initial, context, {
      restingPlayerIds: chosen.slice(0, 2).map((player) => player.playerId),
    }),
  ).toMatchObject({ kind: 'decision', reason: 'rest-conflict' });
  const first = simulateFullCourtSeasonSlot(lock, initial, context);
  const watched = simulateFullCourtSeasonSlot(lock, initial, context, { record: true });
  if (first.kind !== 'simulated' || watched.kind !== 'simulated')
    throw new Error('Expected an opening slot');
  expect(first.scores).toHaveLength(15);
  expect(watched.scores).toEqual(first.scores);
  expect(watched.checkpoint).toEqual(first.checkpoint);
  expect(watched.userGame.kind === 'played' ? watched.userGame.tape?.length : 0).toBeGreaterThan(0);
  if (first.userGame.kind !== 'played') throw new Error('Expected a played user game');
  expect(first.userGame.tape).toBeNull();
  const detailedScores = first.scores.filter(
    (score) => score.outcome.kind === 'played' && score.outcome.benchPoints !== undefined,
  );
  expect(detailedScores).toHaveLength(1);
  const lineupScores = first.scores.filter(
    (score) => score.outcome.kind === 'played' && score.outcome.lineups !== undefined,
  );
  expect(lineupScores).toHaveLength(1);
  const { home, away } = first.userGame.result;
  expect(detailedScores[0]).toMatchObject({
    homeTeamId: home.teamId,
    awayTeamId: away.teamId,
    outcome: {
      benchPoints: {
        home: home.players
          .filter((player) => !player.startedGame)
          .reduce((sum, p) => sum + p.points, 0),
        away: away.players
          .filter((player) => !player.startedGame)
          .reduce((sum, p) => sum + p.points, 0),
      },
      lineups: { side: home.teamId === season.userTeamId ? 'home' : 'away' },
    },
  });
  expect(Object.keys(first.checkpoint.healthByTeam)).toHaveLength(30);
  const stats = buildFullCourtSeasonStats({
    userTeamId: season.userTeamId,
    regularScores: first.scores,
  });
  expect(stats.regular.playedGames).toBe(1);
  expect(stats.lineups.gamesRecorded).toBe(1);
  expect(stats.lineups.gamesExpected).toBe(1);
  expect(stats.lineups.coverageComplete).toBe(true);
  expect(stats.lineups.rows.reduce((total, row) => total + row.seconds, 0)).toBe(
    home.teamId === season.userTeamId ? home.liveSeconds : away.liveSeconds,
  );

  const restored = fullCourtSeasonCheckpointSchema.parse(
    JSON.parse(JSON.stringify(first.checkpoint)),
  );
  const next = simulateFullCourtSeasonSlot(lockFullCourtRegularSeason(season), restored, context);
  expect(next).toMatchObject({ kind: 'simulated', checkpoint: { completedThroughSlot: 2 } });

  const userHealth = restored.healthByTeam[season.userTeamId];
  if (userHealth === undefined) throw new Error('Missing user health');
  for (const player of chosen.slice(0, 2)) {
    userHealth.players[player.playerId] = { loadBasisPoints: 0, availableFromDay: 100 };
  }
  expect(simulateFullCourtSeasonSlot(lock, restored, context)).toMatchObject({
    kind: 'decision',
    reason: 'confirm-forfeit',
  });
  const accepted = simulateFullCourtSeasonSlot(lock, restored, context, { acceptForfeit: true });
  if (accepted.kind !== 'simulated' || accepted.userGame.kind !== 'forfeit') {
    throw new Error('Expected an accepted forfeit');
  }
  expect(accepted.checkpoint.completedThroughSlot).toBe(2);
  expect(accepted.scores.filter((score) => score.outcome.kind === 'forfeit')).toHaveLength(1);
});

function closingRuleFor(
  season: FullCourtSeasonLock['season'],
  rotation: { readonly startingFive: readonly string[] },
): FullCourtCoachingRule[] {
  const team = season.teams.find(({ teamId }) => teamId === season.userTeamId);
  if (team === undefined) throw new Error('Missing user roster');
  const bench = team.roster
    .map(({ playerId }) => playerId)
    .filter((playerId) => !rotation.startingFive.includes(playerId));
  const reserve = bench[0];
  if (reserve === undefined) throw new Error('Missing user reserve');
  return [
    {
      ruleId: 'closing',
      kind: 'closing-lineup',
      secondsRemainingMax: 48 * 60,
      scoreMarginMax: 40,
      lineup: [...rotation.startingFive.slice(0, 4), reserve],
    },
  ];
}

function customRotationFor(season: FullCourtSeasonLock['season']) {
  const team = season.teams.find(({ teamId }) => teamId === season.userTeamId);
  if (team === undefined) throw new Error('Missing user roster');
  const rotation = defaultFullCourtCoachingRotation(team);
  const reserve = team.roster.find(({ playerId }) => !rotation.startingFive.includes(playerId));
  if (reserve === undefined) throw new Error('Missing user reserve');
  rotation.startingFive[4] = reserve.playerId;
  fullCourtCoachingPlanSchema.parse({ ...FULL_COURT_DEFAULT_COACHING_PLAN, rotation });
  return { rotation, reserveId: reserve.playerId };
}

test('applies lineup, minute targets, and tactics only to the user regular-season game', () => {
  const { season } = preparedSeason();
  const { rotation, reserveId } = customRotationFor(season);
  const lock = lockFullCourtRegularSeason(season);
  const initial = createFullCourtSeasonCheckpoint(lock);
  const context = createEngineContext();
  const standard = simulateFullCourtSeasonSlot(lock, initial, context, { rotation });
  const edited = simulateFullCourtSeasonSlot(lock, initial, context, {
    rotation,
    tactics: { pace: 'fast', offense: 'perimeter', defense: 'pressure' },
  });
  if (
    standard.kind !== 'simulated' ||
    standard.userGame.kind !== 'played' ||
    edited.kind !== 'simulated' ||
    edited.userGame.kind !== 'played'
  ) {
    throw new Error('Expected a simulated opening slot');
  }
  const aiScores = (scores: readonly FullCourtSeasonScore[]) =>
    scores.filter(
      (score) => score.homeTeamId !== season.userTeamId && score.awayTeamId !== season.userTeamId,
    );
  expect(aiScores(edited.scores)).toEqual(aiScores(standard.scores));
  expect(edited.userGame).not.toEqual(standard.userGame);
  const user =
    edited.userGame.result.home.teamId === season.userTeamId
      ? edited.userGame.result.home
      : edited.userGame.result.away;
  const reserve = user.players.find((player) => player.playerId === reserveId);
  expect(reserve).toMatchObject({
    startedGame: true,
    plannedSeconds: (rotation.minuteTargets[reserveId] ?? 0) * 60,
  });
});

test('applies conditional rules to the user regular-season game and records them', () => {
  const { season } = preparedSeason();
  const { rotation } = customRotationFor(season);
  const rules = closingRuleFor(season, rotation);
  const lock = lockFullCourtRegularSeason(season);
  const initial = createFullCourtSeasonCheckpoint(lock);
  const context = createEngineContext();
  const standard = simulateFullCourtSeasonSlot(lock, initial, context, { record: true });
  const ruled = simulateFullCourtSeasonSlot(lock, initial, context, {
    rotation,
    rules,
    record: true,
  });
  if (standard.kind !== 'simulated' || ruled.kind !== 'simulated') {
    throw new Error('Expected a simulated opening slot');
  }
  if (standard.userGame.kind !== 'played' || ruled.userGame.kind !== 'played') {
    throw new Error('Expected a played opening game');
  }
  const aiScores = (scores: readonly FullCourtSeasonScore[]) =>
    scores.filter(
      (score) => score.homeTeamId !== season.userTeamId && score.awayTeamId !== season.userTeamId,
    );
  expect(aiScores(ruled.scores)).toEqual(aiScores(standard.scores));
  expect(
    ruled.userGame.tape?.some(
      (event) => event.kind === 'substitution' && event.reason === 'coach-rule',
    ),
  ).toBe(true);
});

function completedSeason() {
  const { season } = preparedSeason();
  const lock = lockFullCourtRegularSeason(season);
  const regular = createFullCourtSeasonCheckpoint(lock);
  regular.completedThroughSlot = CAP_RUSH_CONFERENCE_GAMES_PER_TEAM;
  const scores = season.games.map((fixture): FullCourtSeasonScore => {
    if (fixture.slot === regular.completedThroughSlot) {
      for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
        regular.healthByTeam[teamId] = {
          teamId,
          version: FULL_COURT_HEALTH_VERSION,
          throughDay: fixture.dayOffset,
          players: {},
        };
      }
    }
    const homeWins = fixture.awayTeamId !== season.userTeamId;
    return {
      ...fixture,
      outcome: { kind: 'played', homePoints: homeWins ? 100 : 90, awayPoints: homeWins ? 90 : 100 },
    };
  });
  return { lock, regular, scores };
}

test('advances a serialized playoffs through four rounds and a champion', () => {
  const { lock, regular, scores } = completedSeason();
  expect(() => lockFullCourtPlayoffs(lock, regular, scores.slice(1))).toThrow('one score per');
  const playoffs = lockFullCourtPlayoffs(lock, regular, [...scores].reverse());
  let checkpoint = createFullCourtPlayoffCheckpoint(playoffs);
  const context = createEngineContext();
  let watched = false;
  expect(fullCourtPlayoffView(playoffs, checkpoint).series).toHaveLength(8);
  for (let index = 0; index < 106; index += 1) {
    const view = fullCourtPlayoffView(playoffs, checkpoint);
    const game = simulateFullCourtPlayoffGame(playoffs, checkpoint, context);
    if (game.kind === 'playoffs-complete') break;
    if (game.kind !== 'simulated') throw new Error('Unexpected playoff decision');
    if (!watched && view.nextGame?.userSide != null) {
      const userSide = view.nextGame.userSide;
      const restored = structuredClone(checkpoint);
      const recorded = simulateFullCourtPlayoffGame(playoffs, restored, context, { record: true });
      if (recorded.kind !== 'simulated' || recorded.game.kind !== 'played')
        throw new Error('Expected a recorded playoff game');
      expect(recorded.game.tape?.length).toBeGreaterThan(0);
      expect(recorded.checkpoint).toEqual(game.checkpoint);
      const { rotation, reserveId } = customRotationFor(lock.season);
      const rules = closingRuleFor(lock.season, rotation);
      const edited = simulateFullCourtPlayoffGame(playoffs, restored, context, {
        rotation,
        rules,
        record: true,
      });
      if (edited.kind !== 'simulated' || edited.game.kind !== 'played') {
        throw new Error('Expected a playoff game with the edited rotation');
      }
      expect(
        edited.game.result[userSide].players.find((player) => player.playerId === reserveId)
          ?.startedGame,
      ).toBe(true);
      expect(
        edited.game.tape?.some(
          (event) => event.kind === 'substitution' && event.reason === 'coach-rule',
        ),
      ).toBe(true);
      watched = true;
    }
    checkpoint = game.checkpoint;
  }
  const final = fullCourtPlayoffView(playoffs, checkpoint);
  expect(watched).toBe(true);
  expect(final.nextGame).toBeNull();
  expect(final.championTeamId).toBeTruthy();
  expect(final.series).toHaveLength(15);
  expect(final.series.every(({ games }) => games.length >= 4 && games.length <= 7)).toBe(true);
  expect(new Set(checkpoint.games.map((game) => game.gameId)).size).toBe(checkpoint.games.length);
  const forged = structuredClone(checkpoint);
  const first = forged.games[0];
  if (first === undefined) throw new Error('Missing playoff game');
  first.gameId = 'fcp-1-0-7';
  expect(() => fullCourtPlayoffView(playoffs, forged)).toThrow('does not match the bracket');
});

test('double forfeits go to the series home-court holder even when playing away', () => {
  const { lock, regular, scores } = completedSeason();
  const initialLock = lockFullCourtPlayoffs(lock, regular, scores);
  const view = fullCourtPlayoffView(initialLock, createFullCourtPlayoffCheckpoint(initialLock));
  const firstSeries = view.series[0];
  if (firstSeries === undefined) throw new Error('Missing opening series');
  for (const teamId of [firstSeries.highTeamId, firstSeries.lowTeamId]) {
    const team = lock.season.teams.find((entry) => entry.teamId === teamId);
    const health = regular.healthByTeam[teamId];
    if (team === undefined || health === undefined) throw new Error('Missing playoff roster');
    for (const player of team.roster) {
      health.players[player.playerId] = {
        loadBasisPoints: 0,
        availableFromDay: initialLock.firstGameDay + 9,
      };
    }
  }
  const playoffs = lockFullCourtPlayoffs(lock, regular, scores);
  const context = createEngineContext();
  let checkpoint = createFullCourtPlayoffCheckpoint(playoffs);
  for (let index = 0; index < 24; index += 1) {
    const step = simulateFullCourtPlayoffGame(playoffs, checkpoint, context, {
      acceptForfeit: true,
    });
    if (step.kind !== 'simulated') throw new Error('Expected an opening game');
    checkpoint = step.checkpoint;
  }
  expect(checkpoint.games.find((game) => game.gameId === 'fcp-1-0-3')).toMatchObject({
    awayTeamId: firstSeries.highTeamId,
    winnerTeamId: firstSeries.highTeamId,
    outcome: { kind: 'forfeit', losingSides: ['home', 'away'] },
  });
});

test('applies a scoring hierarchy only to the user regular-season game', () => {
  const { season } = preparedSeason();
  const { rotation } = customRotationFor(season);
  const userTeam = season.teams.find(({ teamId }) => teamId === season.userTeamId);
  if (userTeam === undefined) throw new Error('Missing user roster');
  const hierarchy = { primaryPlayerId: userTeam.roster[0]?.playerId ?? '' };
  const lock = lockFullCourtRegularSeason(season);
  const initial = createFullCourtSeasonCheckpoint(lock);
  const context = createEngineContext();
  const standard = simulateFullCourtSeasonSlot(lock, initial, context, { rotation });
  const edited = simulateFullCourtSeasonSlot(lock, initial, context, { rotation, hierarchy });
  if (
    standard.kind !== 'simulated' ||
    standard.userGame.kind !== 'played' ||
    edited.kind !== 'simulated' ||
    edited.userGame.kind !== 'played'
  ) {
    throw new Error('Expected a simulated opening slot');
  }
  const aiScores = (scores: readonly FullCourtSeasonScore[]) =>
    scores.filter(
      (score) => score.homeTeamId !== season.userTeamId && score.awayTeamId !== season.userTeamId,
    );
  expect(aiScores(edited.scores)).toEqual(aiScores(standard.scores));
  expect(edited.userGame).not.toEqual(standard.userGame);
  expect(checkFullCourtGameResult(edited.userGame.result)).toEqual([]);
});

test('applies a scoring hierarchy only to the user playoff game', () => {
  const { lock, regular, scores } = completedSeason();
  const playoffs = lockFullCourtPlayoffs(lock, regular, scores);
  const userTeam = lock.season.teams.find(({ teamId }) => teamId === lock.season.userTeamId);
  if (userTeam === undefined) throw new Error('Missing user roster');
  const hierarchy = { primaryPlayerId: userTeam.roster[0]?.playerId ?? '' };
  const context = createEngineContext();
  let checkpoint = createFullCourtPlayoffCheckpoint(playoffs);
  for (let index = 0; index < 106; index += 1) {
    const view = fullCourtPlayoffView(playoffs, checkpoint);
    if (view.nextGame === null) break;
    if (view.nextGame.userSide !== null) {
      const standard = simulateFullCourtPlayoffGame(playoffs, structuredClone(checkpoint), context);
      const edited = simulateFullCourtPlayoffGame(playoffs, structuredClone(checkpoint), context, {
        hierarchy,
      });
      if (standard.kind !== 'simulated' || edited.kind !== 'simulated') {
        throw new Error('Expected a simulated playoff game');
      }
      if (standard.game.kind !== 'played' || edited.game.kind !== 'played') {
        throw new Error('Expected a played playoff game');
      }
      expect(edited.game).not.toEqual(standard.game);
      expect(checkFullCourtGameResult(edited.game.result)).toEqual([]);
      return;
    }
    const step = simulateFullCourtPlayoffGame(playoffs, checkpoint, context);
    if (step.kind !== 'simulated') break;
    checkpoint = step.checkpoint;
  }
  throw new Error('Expected a user playoff game');
});
