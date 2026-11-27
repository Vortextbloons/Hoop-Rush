import { expect, test } from 'bun:test';
import {
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  FULL_COURT_DEFAULT_MONEY,
  commandIdSchema,
  franchiseIdSchema,
  havocInstanceSeed,
  playerVersionId,
  seedSchema,
  type SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../../sim/kernel.ts';
import { fullCourtDraftIndexOf } from './draft-catalog.ts';
import { applyFullCourtCommand, createFullCourtDraftState } from './draft-commands.ts';
import { fullCourtTestSetup } from './draft-test-support.ts';
import { fullCourtTrainingCampSeed, simulateFullCourtTrainingCamp } from './preparation.ts';
import { buildFullCourtRegularSeason } from './regular-season.ts';

function preparedSeason() {
  const setup = fullCourtTestSetup({ overalls: [70, 71, 72, 73, 74, 75] });
  const field = CAP_RUSH_FRANCHISE_ALIGNMENT.map(({ franchiseId }) => ({
    teamId: franchiseId,
    displayName: franchiseId,
  }));
  const catalog: SeasonDraftCatalog = {
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
    draft = applyFullCourtCommand(
      draft,
      {
        command: 'pick-full-court-player',
        commandId: commandIdSchema.parse(`camp-pick-${String(draft.revision)}`),
        runId: draft.runId,
        expectedRevision: draft.revision,
        playerVersionId: candidate.playerVersionId,
      },
      { index },
    ).state;
  }
  draft = applyFullCourtCommand(
    draft,
    {
      command: 'finish-full-court-draft',
      commandId: commandIdSchema.parse('camp-finish'),
      runId: draft.runId,
      expectedRevision: draft.revision,
    },
    { index },
  ).state;
  return buildFullCourtRegularSeason({
    draft,
    field,
    catalog,
    catalogSource,
    profile: DEFAULT_ERA_SIM_PROFILE,
  });
}

test('practice is deterministic, uses its own seed, and leaves the locked season untouched', () => {
  const season = preparedSeason();
  const fixture = season.games.find(
    (game) =>
      game.slot === 1 &&
      (game.homeTeamId === season.userTeamId || game.awayTeamId === season.userTeamId),
  );
  if (fixture === undefined) throw new Error('missing opening fixture');
  const opponentTeamId =
    fixture.homeTeamId === season.userTeamId ? fixture.awayTeamId : fixture.homeTeamId;
  const seed = fullCourtTrainingCampSeed(season.runSeed, `fcs-${'a'.repeat(32)}`);
  const before = JSON.stringify(season);
  const context = createEngineContext();

  const first = simulateFullCourtTrainingCamp(season, { seed, opponentTeamId }, context);
  const second = simulateFullCourtTrainingCamp(season, { seed, opponentTeamId }, context);

  expect(second).toEqual(first);
  expect(JSON.stringify(season)).toBe(before);
  expect(seed).not.toBe(
    havocInstanceSeed(season.runSeed, 'full-court-regular-game-v1', fixture.gameId),
  );
  expect(first.rotation).toHaveLength(
    season.teams.find((team) => team.teamId === season.userTeamId)?.roster.length ?? 0,
  );
  expect(first.rotation.filter((player) => player.starter)).toHaveLength(5);
  expect(first.rotation.reduce((total, player) => total + player.minutes, 0)).toBeGreaterThan(0);
  expect(first.bench.playersUsed).toBeGreaterThanOrEqual(0);
  expect(first.fatigue.lowestEnergy).toBeLessThanOrEqual(1);
  expect(first.fatigue.tiredPlayers).toBeLessThanOrEqual(first.rotation.length);
});

test('a later camp report id derives a different practice seed', () => {
  const season = preparedSeason();
  const left = fullCourtTrainingCampSeed(season.runSeed, `fcs-${'a'.repeat(32)}`);
  const right = fullCourtTrainingCampSeed(season.runSeed, `fcs-${'b'.repeat(32)}`);
  expect(left).not.toBe(right);
  expect(seedSchema.safeParse(left).success).toBe(true);
});
