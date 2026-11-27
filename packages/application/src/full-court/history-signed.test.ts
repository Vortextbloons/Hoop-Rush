import { expect, test } from 'bun:test';
import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  FULL_COURT_COACHING_SCHEMA_VERSION,
  FULL_COURT_DEFAULT_MONEY,
  FULL_COURT_DEFAULT_TACTICS,
  FULL_COURT_HEALTH_VERSION,
  commandIdSchema,
  franchiseIdSchema,
  fullCourtCreateDraftCommandSchema,
  fullCourtHistoryRecordSchema,
  playerVersionId,
  seedSchema,
  type FullCourtDraftState,
  type FullCourtPlayoffCheckpoint,
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
  fullCourtPlayoffView,
  lockFullCourtPlayoffs,
  lockFullCourtRegularSeason,
} from '@hoop-rush/engine';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCapRushTestCatalog,
  capRushTestCatalogSource,
} from '@hoop-rush/test-fixtures';
import { fullCourtHistoryFromSeason } from './history.ts';

function buildRouletteDraft(): {
  draft: FullCourtDraftState;
  field: { teamId: string; displayName: string }[];
  catalog: SeasonDraftCatalog;
  catalogSource: ReturnType<typeof capRushTestCatalogSource>;
} {
  const field = CAP_RUSH_FRANCHISE_ALIGNMENT.map(({ franchiseId }) => ({
    teamId: franchiseId,
    displayName: franchiseId,
  }));
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
      commandId: commandIdSchema.parse('create'),
      runId: 'fc-signed-history',
      runSeed: seedSchema.parse('b'.repeat(32)),
      variant: 'roulette',
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
        commandId: commandIdSchema.parse(`pick-${String(draft.revision)}`),
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
      commandId: commandIdSchema.parse('finish'),
      runId: draft.runId,
      expectedRevision: draft.revision,
    },
    { index },
  ).state;
  draft = applyFullCourtCommand(
    draft,
    {
      command: 'finalize-full-court-roulette',
      commandId: commandIdSchema.parse('finalize-roulette'),
      runId: draft.runId,
      expectedRevision: draft.revision,
    },
    { index },
  ).state;
  return { draft, field, catalog, catalogSource };
}

function signedRun() {
  const { draft, field, catalog, catalogSource } = buildRouletteDraft();
  const seasonLock = lockFullCourtRegularSeason(
    buildFullCourtRegularSeason({
      draft,
      field,
      catalog,
      catalogSource,
      profile: DEFAULT_ERA_SIM_PROFILE,
    }),
  );
  const regular = createFullCourtSeasonCheckpoint(seasonLock);
  regular.completedThroughSlot = CAP_RUSH_CONFERENCE_GAMES_PER_TEAM;
  const userTeamId = seasonLock.season.userTeamId;
  const scores: FullCourtSeasonScore[] = seasonLock.season.games.map((fixture) => {
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
    const isUser = fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId;
    const userHome = fixture.homeTeamId === userTeamId;
    const homeWins = isUser ? true : fixture.homeTeamId < fixture.awayTeamId;
    const homePoints = homeWins ? 100 : 90;
    const awayPoints = homeWins ? 90 : 100;
    return {
      ...fixture,
      outcome: {
        kind: 'played',
        homePoints,
        awayPoints,
        ...(isUser
          ? {
              benchPoints: { home: userHome ? -1 : 50, away: userHome ? 50 : -1 },
              benchPlayers: { home: 1, away: 1 },
              starterPoints: {
                home: userHome ? homePoints + 1 : homePoints - 50,
                away: userHome ? awayPoints - 50 : awayPoints + 1,
              },
            }
          : {}),
      },
    };
  });
  const lock = lockFullCourtPlayoffs(seasonLock, regular, scores);
  return { draft, lock, initialCheckpoint: createFullCourtPlayoffCheckpoint(lock) };
}

function finishPlayoffs(
  lock: ReturnType<typeof signedRun>['lock'],
  initial: FullCourtPlayoffCheckpoint,
): FullCourtPlayoffCheckpoint {
  let checkpoint = initial;
  for (;;) {
    const view = fullCourtPlayoffView(lock, checkpoint);
    if (view.nextGame === null) return checkpoint;
    const fixture = view.nextGame;
    const homeHealth = checkpoint.healthByTeam[fixture.homeTeamId];
    const awayHealth = checkpoint.healthByTeam[fixture.awayTeamId];
    if (homeHealth === undefined || awayHealth === undefined) {
      throw new Error('Missing playoff team health');
    }
    checkpoint = {
      ...checkpoint,
      games: [
        ...checkpoint.games,
        {
          gameId: fixture.gameId,
          dayOffset: fixture.dayOffset,
          homeTeamId: fixture.homeTeamId,
          awayTeamId: fixture.awayTeamId,
          winnerTeamId: fixture.homeTeamId,
          outcome: { kind: 'played', homePoints: 105, awayPoints: 95 },
        },
      ],
      healthByTeam: {
        ...checkpoint.healthByTeam,
        [fixture.homeTeamId]: { ...homeHealth, throughDay: fixture.dayOffset },
        [fixture.awayTeamId]: { ...awayHealth, throughDay: fixture.dayOffset },
      },
    };
  }
}

test('archives a signed bench aggregate and keeps legacy records loadable', () => {
  const { draft, lock, initialCheckpoint } = signedRun();
  const finished = finishPlayoffs(lock, initialCheckpoint);
  const record = fullCourtHistoryFromSeason({
    draft,
    coaching: {
      schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
      tactics: FULL_COURT_DEFAULT_TACTICS,
    },
    lock,
    checkpoint: finished,
    completedAtIso: '2026-11-24T00:00:00.000Z',
  });
  if (record === null) throw new Error('expected an archived record');
  expect(record.bench).toMatchObject({
    gamesRecorded: CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
    totalBenchPoints: -CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
    averageBenchPoints: -1,
  });
  expect(record.bench?.bestGame?.benchPoints).toBe(-1);

  const legacy: Record<string, unknown> = { ...record };
  delete legacy.bench;
  expect(fullCourtHistoryRecordSchema.parse(legacy).bench).toBeUndefined();
});

test('rejects a signed archive whose compact starter evidence is inconsistent', () => {
  const { draft, lock, initialCheckpoint } = signedRun();
  const finished = finishPlayoffs(lock, initialCheckpoint);
  let corruptedOnce = false;
  const corrupted = {
    ...lock,
    regularScores: lock.regularScores.map((score) => {
      if (corruptedOnce || score.outcome.kind !== 'played') return score;
      const starterPoints = score.outcome.starterPoints;
      if (starterPoints === undefined) return score;
      corruptedOnce = true;
      return {
        ...score,
        outcome: {
          ...score.outcome,
          starterPoints: { ...starterPoints, home: starterPoints.home + 1 },
        },
      };
    }),
  };
  expect(() =>
    fullCourtHistoryFromSeason({
      draft,
      coaching: {
        schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
        tactics: FULL_COURT_DEFAULT_TACTICS,
      },
      lock: corrupted,
      checkpoint: finished,
      completedAtIso: '2026-11-24T00:00:00.000Z',
    }),
  ).toThrow(/must sum to team points/);
});
