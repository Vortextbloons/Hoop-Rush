import { expect, test } from 'bun:test';
import {
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  FULL_COURT_DEFAULT_MONEY,
  FULL_COURT_HEALTH_PROFILE_VERSION,
  commandIdSchema,
  contentHashSchema,
  franchiseIdSchema,
  fullCourtSeasonCheckpointSchema,
  playerVersionId,
  type FullCourtHealthProfileSet,
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
import {
  createFullCourtSeasonCheckpoint,
  lockFullCourtRegularSeason,
  simulateFullCourtSeasonSlot,
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
  expect(Object.keys(first.checkpoint.healthByTeam)).toHaveLength(30);

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
