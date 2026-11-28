import { expect, test } from 'bun:test';
import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  CAP_RUSH_PLAYOFF_ROUNDS,
  CAP_RUSH_SERIES_WINS,
  FULL_COURT_COACHING_SCHEMA_VERSION,
  FULL_COURT_DEFAULT_MONEY,
  FULL_COURT_DEFAULT_TACTICS,
  FULL_COURT_HEALTH_VERSION,
  commandIdSchema,
  franchiseIdSchema,
  fullCourtCreateDraftCommandSchema,
  playerVersionId,
  seedSchema,
  type FullCourtHistoryRecord,
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
import {
  archiveFullCourtRun,
  fullCourtHistoryFromSeason,
  type FullCourtHistoryRepository,
} from './history.ts';

function buildCompletedDraft() {
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
      runId: 'fc-app-history',
      runSeed: seedSchema.parse('b'.repeat(32)),
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
  return { draft, field, catalog, catalogSource };
}

function buildPlayoffRun(options: { readonly userQualifies: boolean }) {
  const { draft, field, catalog, catalogSource } = buildCompletedDraft();
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
    const homeWins = isUser
      ? options.userQualifies
        ? userHome
        : !userHome
      : fixture.homeTeamId < fixture.awayTeamId;
    const userBonus = fixture.slot === 1 ? 4 : 0;
    return {
      ...fixture,
      outcome: {
        kind: 'played',
        homePoints: homeWins ? 120 : 90,
        awayPoints: homeWins ? 90 : 120,
        ...(isUser
          ? {
              benchPoints: {
                home: userHome ? 50 : 20,
                away: userHome ? 20 : 50,
              },
              benchPlayers: { home: 4, away: 4 },
              ...(userBonus > 0
                ? {
                    teamBonusPoints: {
                      home: userHome ? userBonus : 0,
                      away: userHome ? 0 : userBonus,
                    },
                  }
                : {}),
            }
          : {}),
      },
    };
  });
  const lock = lockFullCourtPlayoffs(seasonLock, regular, scores);
  const checkpoint: FullCourtPlayoffCheckpoint = createFullCourtPlayoffCheckpoint(lock);
  return { draft, lock, initialCheckpoint: checkpoint };
}

function finishPlayoffs(
  lock: ReturnType<typeof buildPlayoffRun>['lock'],
  initial: FullCourtPlayoffCheckpoint,
): FullCourtPlayoffCheckpoint {
  let checkpoint = initial;
  for (;;) {
    const view = fullCourtPlayoffView(lock, checkpoint);
    if (view.nextGame === null) return checkpoint;
    const fixture = view.nextGame;
    const winnerTeamId = fixture.homeTeamId;
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
          winnerTeamId,
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

test('returns null before finals finish and reconciles teamBonusPoints + Bench Mob after completion', async () => {
  const { draft, lock, initialCheckpoint } = buildPlayoffRun({ userQualifies: true });
  const coaching = {
    schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION as 1,
    tactics: FULL_COURT_DEFAULT_TACTICS,
  };
  expect(
    fullCourtHistoryFromSeason({
      draft,
      coaching,
      lock,
      checkpoint: initialCheckpoint,
      completedAtIso: '2026-10-01T00:00:00.000Z',
    }),
  ).toBeNull();

  const finished = finishPlayoffs(lock, initialCheckpoint);
  const stored = new Map<string, FullCourtHistoryRecord>();
  let saveCalls = 0;
  const repo: FullCourtHistoryRepository = {
    load(runId) {
      return Promise.resolve(stored.get(runId) ?? null);
    },
    list() {
      return Promise.resolve([...stored.values()]);
    },
    save(record) {
      saveCalls += 1;
      if (stored.has(record.runId)) return Promise.resolve('existing');
      stored.set(record.runId, record);
      return Promise.resolve('saved');
    },
  };

  const first = await archiveFullCourtRun(
    {
      draft,
      coaching,
      lock,
      checkpoint: finished,
      completedAtIso: '2026-10-02T00:00:00.000Z',
    },
    repo,
  );
  expect(first).not.toBeNull();
  expect(first?.draft.variant).toBe('standard');
  expect(first?.regularSeason.wins).toBe(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM);
  expect(first?.playoffs.status).toBe('champion');
  expect(first?.playoffs.seriesWon).toBe(CAP_RUSH_PLAYOFF_ROUNDS);
  // Bench scored 50 against 66 starter + 4 teamBonus = 120 team points; >=50 triggers Bench Mob.
  expect(first?.achievements).toEqual(['bench-mob']);
  expect(saveCalls).toBe(1);

  // Resume call returns the archived record without rewriting.
  const resumed = await archiveFullCourtRun(
    {
      draft,
      coaching,
      lock,
      checkpoint: finished,
      completedAtIso: '2026-10-09T00:00:00.000Z',
    },
    repo,
  );
  expect(resumed).toEqual(first);
  expect(saveCalls).toBe(1);
});

test('records non-qualified runs once the bracket finishes', () => {
  const { draft, lock, initialCheckpoint } = buildPlayoffRun({ userQualifies: false });
  const finished = finishPlayoffs(lock, initialCheckpoint);
  const record = fullCourtHistoryFromSeason({
    draft,
    coaching: {
      schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
      tactics: FULL_COURT_DEFAULT_TACTICS,
    },
    lock,
    checkpoint: finished,
    completedAtIso: '2026-10-03T00:00:00.000Z',
  });
  expect(record?.playoffs.status).toBe('not-qualified');
  expect(record?.playoffs.seriesWon).toBe(0);
  expect(record?.playoffs.eliminatedRound).toBeNull();
  expect(record?.playoffs.championTeamId).not.toBe(record?.teamId);
  expect(record?.achievements).toEqual(['bench-mob']);
  expect(CAP_RUSH_SERIES_WINS).toBe(4);
});
