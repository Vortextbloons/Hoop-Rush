import { expect, test } from 'bun:test';
import {
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  FULL_COURT_DEFAULT_MONEY,
  commandIdSchema,
  franchiseIdSchema,
  playerVersionId,
} from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import { fullCourtDraftIndexOf } from './draft-catalog.ts';
import { applyFullCourtCommand, createFullCourtDraftState } from './draft-commands.ts';
import { fullCourtTestSetup } from './draft-test-support.ts';
import { checkFullCourtGameResult } from './game.ts';
import {
  buildFullCourtRegularSeason,
  fullCourtRegularSeasonGameInput,
  simulateFullCourtRegularSeasonGame,
} from './regular-season.ts';

test('a confirmed six-guard roster plays a scheduled game against a historical rotation', () => {
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
