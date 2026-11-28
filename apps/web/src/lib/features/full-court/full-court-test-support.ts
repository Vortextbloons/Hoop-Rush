import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  FULL_COURT_DEFAULT_MONEY,
  FULL_COURT_HEALTH_VERSION,
  commandIdSchema,
  franchiseIdSchema,
  fullCourtCreateDraftCommandSchema,
  playerVersionId,
  seedSchema,
  type FullCourtSeasonScore,
  type SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import {
  applyFullCourtCommand,
  buildFullCourtRegularSeason,
  createFullCourtDraftState,
  createFullCourtPlayoffCheckpoint,
  createFullCourtSeasonCheckpoint,
  fullCourtDraftIndexOf,
  lockFullCourtPlayoffs,
  lockFullCourtRegularSeason,
  type CapRushLeagueField,
  type FullCourtSeasonLock,
} from '@hoop-rush/engine';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCapRushTestCatalog,
  capRushTestCatalogSource,
} from '@hoop-rush/test-fixtures';

export function fullCourtTestField(): CapRushLeagueField[] {
  return CAP_RUSH_FRANCHISE_ALIGNMENT.map(({ franchiseId }) => ({
    teamId: franchiseId,
    displayName: franchiseId,
  }));
}

/**
 * A 30-franchise historical field from the shared test catalog, mirroring the
 * engine's own Full Court fixtures with public APIs only.
 */
export function fullCourtTestSeasonLock(): FullCourtSeasonLock {
  const field = fullCourtTestField();
  const base = buildCapRushTestCatalog({ overalls: [70, 71, 72, 73, 74, 75] });
  const catalog: SeasonDraftCatalog = {
    ...base,
    candidates: field.flatMap(({ teamId }) =>
      base.candidates.map((player) => ({
        ...player,
        franchiseId: franchiseIdSchema.parse(teamId),
        playerVersionId: playerVersionId(player.playerId, teamId, player.eraId, player.seasonKey),
      })),
    ),
  };
  const catalogSource = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, catalogSource);
  let draft = createFullCourtDraftState(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse('full-court-create'),
      runId: 'full-court-test-run',
      runSeed: seedSchema.parse('a'.repeat(32)),
      variant: 'standard',
      catalog: catalogSource,
      money: { ...FULL_COURT_DEFAULT_MONEY, capLineDollars: 0, firstApronDollars: 0 },
    }),
    index,
    { pool: 'open' },
  );
  for (const candidate of base.candidates.filter((player) => player.positions.primary === 'PG')) {
    draft = applyFullCourtCommand(
      draft,
      {
        command: 'pick-full-court-player',
        commandId: commandIdSchema.parse(`full-court-pick-${String(draft.revision)}`),
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
      commandId: commandIdSchema.parse('full-court-finish'),
      runId: draft.runId,
      expectedRevision: draft.revision,
    },
    { index },
  ).state;
  return lockFullCourtRegularSeason(
    buildFullCourtRegularSeason({
      draft,
      field,
      catalog,
      catalogSource,
      profile: DEFAULT_ERA_SIM_PROFILE,
    }),
  );
}

/** A completed regular season plus the opening playoff checkpoint. */
export function fullCourtTestPlayoffLock(lock: FullCourtSeasonLock) {
  const regular = createFullCourtSeasonCheckpoint(lock);
  regular.completedThroughSlot = CAP_RUSH_CONFERENCE_GAMES_PER_TEAM;
  const scores = lock.season.games.map((fixture): FullCourtSeasonScore => {
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
    const homeWins = fixture.awayTeamId !== lock.season.userTeamId;
    return {
      ...fixture,
      outcome: {
        kind: 'played',
        homePoints: homeWins ? 100 : 90,
        awayPoints: homeWins ? 90 : 100,
      },
    };
  });
  const playoffs = lockFullCourtPlayoffs(lock, regular, scores);
  return { lock: playoffs, checkpoint: createFullCourtPlayoffCheckpoint(playoffs) };
}
