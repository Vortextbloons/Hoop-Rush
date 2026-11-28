import '../../../../../../packages/persistence/src/test-setup.ts';
import { afterEach, describe, expect, mock, test } from 'bun:test';
import Dexie from 'dexie';
import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  FULL_COURT_DEFAULT_COACHING_PLAN,
  FULL_COURT_DEFAULT_MONEY,
  FULL_COURT_HEALTH_VERSION,
  commandIdSchema,
  franchiseIdSchema,
  fullCourtCreateDraftCommandSchema,
  fullCourtReportPriceDollars,
  havocInstanceSeed,
  idSchema,
  playerVersionId,
  seedSchema,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
  type SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import { submitFullCourtDraftCommand } from '@hoop-rush/application/full-court';
import {
  buildFullCourtRegularSeason,
  createEngineContext,
  createFullCourtSeasonCheckpoint,
  fullCourtDraftIndexOf,
  fullCourtTrainingCampSeed,
  lockFullCourtRegularSeason,
  simulateFullCourtPlayoffGame,
  simulateFullCourtSeasonSlot,
  simulateFullCourtTrainingCamp,
  type CapRushLeagueField,
  type FullCourtInjuryEvent,
} from '@hoop-rush/engine';
import {
  DexieCapRushMultiplayerRepository,
  DexieCapRushRepository,
  DexieChallengeRepository,
  DexieDraftDuelRepository,
  DexieFixedFiveRepository,
  DexieFullCourtDraftRepository,
  DexieHavocMultiplayerRepository,
  DexieHavocRepository,
  DexieProfileRepository,
  HoopRushDatabase,
  createFullCourtBlueprintRepository,
  createFullCourtCoachingRepository,
  createFullCourtHistoryRepository,
  createFullCourtNextGamePlanRepository,
  createFullCourtPlayoffRepository,
  createFullCourtSeasonRepository,
  createFullCourtWatchedReplayRepository,
} from '@hoop-rush/persistence';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCapRushTestCatalog,
  capRushTestCatalogSource,
} from '@hoop-rush/test-fixtures';
import type { Persistence } from '#lib/persistence.js';
import { FULL_COURT_ACTIVE_RUN_KEY } from './full-court-active-run.ts';
import { FullCourtController } from './full-court-controller.svelte.ts';
import {
  fullCourtWatchedReplayOutcome,
  fullCourtWatchedReplaySummary,
} from './full-court-gamecast.ts';
import { fullCourtNextUserFixture } from './full-court-season-presenter.ts';
import type { FullCourtWorkerRunner } from './full-court-worker-runner.ts';
import { fullCourtWorkerRequestSchema } from './full-court-worker-protocol.ts';
import {
  openTestDatabasePair,
  resetIndexedDb,
  restoreIndexedDb,
} from '../../../../../../packages/persistence/src/testing/repo-test-support.ts';

const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

function installTestEnvironment(): void {
  resetIndexedDb();
  Dexie.dependencies.indexedDB = globalThis.indexedDB;
  Dexie.dependencies.IDBKeyRange = globalThis.IDBKeyRange;
  installLocalStorage();
}

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

afterEach(() => {
  restoreIndexedDb();
  if (originalLocalStorage === undefined) {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  } else {
    (globalThis as { localStorage?: Storage }).localStorage = originalLocalStorage;
  }
});

function repositoriesFor(db: HoopRushDatabase): Persistence {
  return {
    db,
    challengeRepository: new DexieChallengeRepository(db),
    fixedFiveRepository: new DexieFixedFiveRepository(db),
    havocRepository: new DexieHavocRepository(db),
    draftDuelRepository: new DexieDraftDuelRepository(db),
    havocMultiplayerRepository: new DexieHavocMultiplayerRepository(db),
    capRushRepository: new DexieCapRushRepository(db),
    capRushMultiplayerRepository: new DexieCapRushMultiplayerRepository(db),
    fullCourtDraftRepository: new DexieFullCourtDraftRepository(db),
    fullCourtSeasonRepository: createFullCourtSeasonRepository(db),
    fullCourtPlayoffRepository: createFullCourtPlayoffRepository(db),
    fullCourtBlueprintRepository: createFullCourtBlueprintRepository(db),
    fullCourtCoachingRepository: createFullCourtCoachingRepository(db),
    fullCourtHistoryRepository: createFullCourtHistoryRepository(db),
    fullCourtWatchedReplayRepository: createFullCourtWatchedReplayRepository(db),
    fullCourtNextGamePlanRepository: createFullCourtNextGamePlanRepository(db),
    profileRepository: new DexieProfileRepository(db),
  };
}

async function seedCompletedDraft(db: HoopRushDatabase) {
  const field: CapRushLeagueField[] = CAP_RUSH_FRANCHISE_ALIGNMENT.map(({ franchiseId }) => ({
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
  const repository = new DexieFullCourtDraftRepository(db);
  const runId = idSchema.parse('full-court-controller-replay-run');
  await submitFullCourtDraftCommand(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse('fc-create'),
      runId,
      runSeed: seedSchema.parse('a'.repeat(32)),
      variant: 'standard',
      catalog: catalogSource,
      money: { ...FULL_COURT_DEFAULT_MONEY, capLineDollars: 0, firstApronDollars: 0 },
    }),
    { repository, index },
  );
  let draft = await repository.load(runId);
  if (draft === null) throw new Error('Missing created draft');
  const poolIds =
    draft.pool?.playerVersionIds ??
    base.candidates
      .filter((player) => player.positions.primary === 'PG')
      .map((player) => player.playerVersionId);
  if (poolIds.length < 6) throw new Error('Full Court controller test needs a six-player pool');
  for (const [pickIndex, playerVersionId] of poolIds.slice(0, 6).entries()) {
    await submitFullCourtDraftCommand(
      {
        command: 'pick-full-court-player',
        commandId: commandIdSchema.parse(`fc-pick-${String(pickIndex)}-${String(draft.revision)}`),
        runId: draft.runId,
        expectedRevision: draft.revision,
        playerVersionId,
      },
      { repository, index },
    );
    draft = await repository.load(runId);
    if (draft === null) throw new Error('Missing draft after pick');
  }
  await submitFullCourtDraftCommand(
    {
      command: 'finish-full-court-draft',
      commandId: commandIdSchema.parse('fc-finish'),
      runId: draft.runId,
      expectedRevision: draft.revision,
    },
    { repository, index },
  );
  draft = await repository.load(runId);
  if (draft === null) throw new Error('Missing finished draft');

  localStorage.setItem(FULL_COURT_ACTIVE_RUN_KEY, runId);
  const assets = {
    catalog,
    catalogSource,
    catalogAssetHash: '0'.repeat(64),
    field,
    profile: DEFAULT_ERA_SIM_PROFILE,
  };
  const lock = lockFullCourtRegularSeason(buildFullCourtRegularSeason({ ...assets, draft }));
  return { runId, draft, assets, lock };
}

async function seedPlayoffReadyDraft(
  db: HoopRushDatabase,
  mode: 'mid-seed' | 'miss-playoffs' = 'mid-seed',
): Promise<Awaited<ReturnType<typeof seedCompletedDraft>>> {
  const seeded = await seedCompletedDraft(db);
  const { lock } = seeded;
  const userTeamId = lock.season.userTeamId;
  const seasonRepo = createFullCourtSeasonRepository(db);
  const initial = createFullCourtSeasonCheckpoint(lock);
  await seasonRepo.create(initial);
  const slot82Health = { ...initial.healthByTeam };
  const allScores: FullCourtSeasonScore[] = [];
  for (const fixture of lock.season.games) {
    if (fixture.slot === CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) {
      for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
        slot82Health[teamId] = {
          teamId,
          version: FULL_COURT_HEALTH_VERSION,
          throughDay: fixture.dayOffset,
          players: {},
        };
      }
    }
    const userInGame = fixture.homeTeamId === userTeamId || fixture.awayTeamId === userTeamId;
    const homeWins =
      mode === 'miss-playoffs'
        ? userInGame
          ? fixture.homeTeamId !== userTeamId
          : fixture.homeTeamId < fixture.awayTeamId
        : userInGame
          ? fixture.slot % 4 !== 0
            ? fixture.homeTeamId === userTeamId
            : fixture.awayTeamId === userTeamId
          : fixture.homeTeamId < fixture.awayTeamId;
    allScores.push({
      ...fixture,
      outcome: {
        kind: 'played',
        homePoints: homeWins ? 100 : 90,
        awayPoints: homeWins ? 90 : 100,
      },
    });
  }
  await db.fullCourtSeasonCheckpoints.put({
    saveSchemaVersion: 1,
    runId: lock.season.runId,
    checkpoint: {
      schemaVersion: 1,
      runId: lock.season.runId,
      lockDigest: lock.digest,
      completedThroughSlot: CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
      healthByTeam: slot82Health,
    },
  });
  await db.fullCourtSeasonScores.bulkPut(
    allScores.map((score) => ({
      saveSchemaVersion: 1,
      runId: lock.season.runId,
      gameId: score.gameId,
      score,
    })),
  );
  return seeded;
}

describe('FullCourtController durable watched replay', () => {
  test('persists watched regular-season replay across refresh and quick sims without replacing latest live report', async () => {
    installTestEnvironment();
    const { first, second } = openTestDatabasePair('fc-controller-reload');
    const simulateSlotMock = mock<FullCourtWorkerRunner['simulateSlot']>(
      (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
        ),
    );
    const simulateGameMock = mock<FullCourtWorkerRunner['simulateGame']>(
      (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
        ),
    );
    const createWorker = (): FullCourtWorkerRunner => ({
      simulateSlot: (lock, checkpoint, options) => simulateSlotMock(lock, checkpoint, options),
      simulateGame: (lock, checkpoint, options) => simulateGameMock(lock, checkpoint, options),
      simulatePractice: (lock, input) =>
        Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
      dispose: () => {},
    });

    try {
      const { runId, assets } = await seedCompletedDraft(first);
      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
        createWorker,
      });
      await controller.load();
      expect(controller.error).toBeNull();
      expect(controller.savedReplay).toBeNull();
      expect(controller.latestGame).toBeNull();

      // Watch game 1 (record: true).
      await controller.advance(1, false, true);
      expect(controller.season?.checkpoint.completedThroughSlot).toBe(1);
      expect(controller.latestGame?.tape?.length).toBeGreaterThan(0);
      expect(controller.savedReplay?.identity.slot).toBe(1);
      expect(controller.savedReplay?.identity.gameSeed).toBe(controller.latestGame?.result.seed);
      const watchedGameOne = controller.savedReplay;
      if (watchedGameOne === null) throw new Error('Expected savedReplay after watching game 1');
      expect(simulateSlotMock).toHaveBeenCalledTimes(1);

      // Quick-sim game 2 (record: false): latestGame updates to game 2 summary, savedReplay stays game 1.
      await controller.advance(1, false, false);
      expect(controller.season?.checkpoint.completedThroughSlot).toBe(2);
      expect(controller.latestGame?.tape).toBeNull();
      expect(controller.latestGame?.result.seed).not.toBe(watchedGameOne.identity.gameSeed);
      expect(controller.savedReplay).toEqual(watchedGameOne);

      // Forfeit slot 3 (simulated as user forfeit): no replay write, savedReplay remains game 1.
      const prevCalls = simulateSlotMock.mock.calls.length;
      simulateSlotMock.mockImplementationOnce((lock, checkpoint) => {
        const normal = simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), {
          record: false,
        });
        if (normal.kind !== 'simulated') throw new Error('Expected simulated slot');
        return Promise.resolve({
          ...normal,
          scores: normal.scores.map((score) =>
            score.homeTeamId === lock.season.userTeamId ||
            score.awayTeamId === lock.season.userTeamId
              ? { ...score, outcome: { kind: 'forfeit', losingSides: ['home'] } }
              : score,
          ),
          userGame: {
            kind: 'forfeit',
            sides: ['home'],
            winner: 'away',
            health: normal.userGame.health,
          },
        });
      });
      await controller.advance(1, true, true);
      expect(controller.season?.checkpoint.completedThroughSlot).toBe(3);
      expect(controller.latestGame).toBeNull();
      expect(controller.savedReplay).toEqual(watchedGameOne);
      expect(simulateSlotMock).toHaveBeenCalledTimes(prevCalls + 1);

      // Simulate browser refresh: close DB, open second connection, fresh controller.
      const callsBeforeRefresh = simulateSlotMock.mock.calls.length;
      controller.dispose();
      first.close();

      const reloaded = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(second),
        createWorker,
      });
      await reloaded.load();
      expect(reloaded.season?.checkpoint.completedThroughSlot).toBe(3);
      expect(reloaded.latestGame).toBeNull();
      expect(reloaded.savedReplay).toEqual(watchedGameOne);
      // Opening saved replay uses stored evidence only and rolls zero possessions.
      if (reloaded.savedReplay === null) throw new Error('Expected reloaded savedReplay');
      const rehydrated = fullCourtWatchedReplayOutcome(reloaded.savedReplay);
      const summary = fullCourtWatchedReplaySummary(reloaded.savedReplay);
      expect(summary.gameLabel).toBe('Game 1');
      expect(rehydrated.result).toEqual(watchedGameOne.result);
      expect(rehydrated.tape).toEqual(watchedGameOne.tape);
      expect(simulateSlotMock).toHaveBeenCalledTimes(callsBeforeRefresh);
      expect(simulateGameMock).toHaveBeenCalledTimes(0);

      // Confirm runId stayed consistent.
      expect(reloaded.season?.lock.season.runId).toBe(runId);
      reloaded.dispose();
    } finally {
      first.close();
      second.close();
    }
  });

  test('persists watched playoff replay across refresh', async () => {
    installTestEnvironment();
    const { first, second } = openTestDatabasePair('fc-controller-playoffs-reload');
    const simulateSlotMock = mock<FullCourtWorkerRunner['simulateSlot']>(
      (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
        ),
    );
    const simulateGameMock = mock<FullCourtWorkerRunner['simulateGame']>(
      (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
        ),
    );
    const createWorker = (): FullCourtWorkerRunner => ({
      simulateSlot: (lock, checkpoint, options) => simulateSlotMock(lock, checkpoint, options),
      simulateGame: (lock, checkpoint, options) => simulateGameMock(lock, checkpoint, options),
      simulatePractice: (lock, input) =>
        Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
      dispose: () => {},
    });

    try {
      const { runId, assets, lock } = await seedCompletedDraft(first);
      const seasonRepo = createFullCourtSeasonRepository(first);
      const initial = createFullCourtSeasonCheckpoint(lock);
      await seasonRepo.create(initial);
      const slot82Health = { ...initial.healthByTeam };
      const allScores: FullCourtSeasonScore[] = [];
      for (const fixture of lock.season.games) {
        if (fixture.slot === CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) {
          for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
            slot82Health[teamId] = {
              teamId,
              version: FULL_COURT_HEALTH_VERSION,
              throughDay: fixture.dayOffset,
              players: {},
            };
          }
        }
        const homeWins = fixture.awayTeamId !== lock.season.userTeamId;
        allScores.push({
          ...fixture,
          outcome: {
            kind: 'played',
            homePoints: homeWins ? 100 : 90,
            awayPoints: homeWins ? 90 : 100,
          },
        });
      }
      // Write completed regular season directly into Dexie stores to enter playoffs cleanly.
      await first.fullCourtSeasonCheckpoints.put({
        saveSchemaVersion: 1,
        runId: lock.season.runId,
        checkpoint: {
          schemaVersion: 1,
          runId: lock.season.runId,
          lockDigest: lock.digest,
          completedThroughSlot: CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
          healthByTeam: slot82Health,
        },
      });
      await first.fullCourtSeasonScores.bulkPut(
        allScores.map((score) => ({
          saveSchemaVersion: 1,
          runId: lock.season.runId,
          gameId: score.gameId,
          score,
        })),
      );

      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
        createWorker,
      });
      await controller.load();
      await controller.startPlayoffs();
      expect(controller.playoffs).not.toBeNull();

      // Watching the next user game advances intervening AI games, then records only that game.
      const gamesBeforeWatch = controller.playoffs?.checkpoint.games.length ?? 0;
      await controller.advance(1, false, true);
      expect(controller.playoffs?.checkpoint.games.length).toBeGreaterThan(gamesBeforeWatch);
      expect(controller.savedReplay?.identity.phase).toBe('playoff');
      expect(controller.savedReplay?.identity.runId).toBe(runId);
      const watchedPlayoff = controller.savedReplay;
      if (watchedPlayoff === null) throw new Error('Expected playoff savedReplay');
      const gameCalls = simulateGameMock.mock.calls.length;

      // Refresh and verify playoff savedReplay survives without re-simulating.
      controller.dispose();
      first.close();

      const reloaded = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(second),
        createWorker,
      });
      await reloaded.load();
      expect(reloaded.playoffs?.checkpoint.games.length).toBe(
        controller.playoffs?.checkpoint.games.length,
      );
      expect(reloaded.savedReplay).toEqual(watchedPlayoff);
      expect(simulateGameMock).toHaveBeenCalledTimes(gameCalls);
      reloaded.dispose();
    } finally {
      first.close();
      second.close();
    }
  });

  test('targets and persists postseason opponent film for the user series even when AI games sit ahead in the bracket', async () => {
    installTestEnvironment();
    const { first, second } = openTestDatabasePair('fc-controller-playoff-film');
    const createWorker = (): FullCourtWorkerRunner => ({
      simulateSlot: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
        ),
      simulateGame: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
        ),
      simulatePractice: (lock, input) =>
        Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
      dispose: () => {},
    });

    try {
      const { assets, lock } = await seedCompletedDraft(first);
      const seasonRepo = createFullCourtSeasonRepository(first);
      const initial = createFullCourtSeasonCheckpoint(lock);
      await seasonRepo.create(initial);
      const slot82Health = { ...initial.healthByTeam };
      const allScores: FullCourtSeasonScore[] = [];
      for (const fixture of lock.season.games) {
        if (fixture.slot === CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) {
          for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
            slot82Health[teamId] = {
              teamId,
              version: FULL_COURT_HEALTH_VERSION,
              throughDay: fixture.dayOffset,
              players: {},
            };
          }
        }
        // User loses just enough to land in a non-slot-0 first-round series so AI games come first.
        const userInGame =
          fixture.homeTeamId === lock.season.userTeamId ||
          fixture.awayTeamId === lock.season.userTeamId;
        const homeWins = userInGame
          ? fixture.slot % 4 !== 0
            ? fixture.homeTeamId === lock.season.userTeamId
            : fixture.awayTeamId === lock.season.userTeamId
          : fixture.homeTeamId < fixture.awayTeamId;
        allScores.push({
          ...fixture,
          outcome: {
            kind: 'played',
            homePoints: homeWins ? 100 : 90,
            awayPoints: homeWins ? 90 : 100,
          },
        });
      }
      await first.fullCourtSeasonCheckpoints.put({
        saveSchemaVersion: 1,
        runId: lock.season.runId,
        checkpoint: {
          schemaVersion: 1,
          runId: lock.season.runId,
          lockDigest: lock.digest,
          completedThroughSlot: CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
          healthByTeam: slot82Health,
        },
      });
      await first.fullCourtSeasonScores.bulkPut(
        allScores.map((score) => ({
          saveSchemaVersion: 1,
          runId: lock.season.runId,
          gameId: score.gameId,
          score,
        })),
      );

      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
        createWorker,
      });
      await controller.load();
      await controller.startPlayoffs();
      const preview = controller.nextPlayoffPreview();
      const target = controller.nextFilmTarget();
      if (preview === null || target === null) {
        throw new Error('Expected active playoff preview and film target');
      }
      expect(target).toEqual({
        kind: 'opponent-film',
        gameId: preview.gameId,
        opponentTeamId: preview.opponentTeamId,
      });

      await controller.purchaseReport(target);
      expect(
        controller.draft?.reports?.some(
          (report) =>
            report.target.kind === 'opponent-film' &&
            report.target.gameId === target.gameId &&
            report.target.opponentTeamId === target.opponentTeamId,
        ),
      ).toBe(true);

      controller.dispose();
      first.close();

      const reloaded = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(second),
        createWorker,
      });
      await reloaded.load();
      expect(reloaded.nextFilmTarget()).toEqual(target);
      expect(
        reloaded.draft?.reports?.some(
          (report) =>
            report.target.kind === 'opponent-film' &&
            report.target.gameId === target.gameId &&
            report.target.opponentTeamId === target.opponentTeamId,
        ),
      ).toBe(true);
      reloaded.dispose();
    } finally {
      first.close();
      second.close();
    }
  });

  test('pins voluntary rest to the next user game and clears it after that committed slot', async () => {
    installTestEnvironment();
    const { first } = openTestDatabasePair('fc-controller-rest');
    const calls: (readonly string[] | undefined)[] = [];
    const createWorker = (): FullCourtWorkerRunner => ({
      simulateSlot: (lock, checkpoint, options) => {
        calls.push(options?.restingPlayerIds);
        return Promise.resolve(
          simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
        );
      },
      simulateGame: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
        ),
      simulatePractice: (lock, input) =>
        Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
      dispose: () => {},
    });

    try {
      const { assets } = await seedCompletedDraft(first);
      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
        createWorker,
      });
      await controller.load();
      const season = controller.season;
      if (season === null) throw new Error('Expected an open season');
      const fixture = fullCourtNextUserFixture(season.lock, season.checkpoint, null);
      const team = season.lock.season.teams.find(
        (entry) => entry.teamId === season.lock.season.userTeamId,
      );
      const bench = team?.roster.at(-1);
      if (fixture === null || bench === undefined) throw new Error('Missing rest fixture');

      controller.setRestingPlayers(team?.roster.slice(0, 2).map((player) => player.playerId) ?? []);
      expect(controller.restingPlayerIds).toEqual([]);
      expect(controller.error).toContain('fewer than five');

      controller.setRestingPlayers([bench.playerId]);
      expect(controller.restingForGameId).toBe(fixture.gameId);
      await controller.advance(2);

      expect(controller.season?.checkpoint.completedThroughSlot).toBe(2);
      expect(calls).toEqual([[bench.playerId], undefined]);
      expect(controller.restingPlayerIds).toEqual([]);
      expect(controller.restingForGameId).toBeNull();
      controller.dispose();
    } finally {
      first.close();
    }
  });

  test('keeps rest pending through AI-only playoff games and consumes it on the user game', async () => {
    installTestEnvironment();
    const { first } = openTestDatabasePair('fc-controller-rest-playoffs');
    const calls: (readonly string[] | undefined)[] = [];
    const createWorker = (): FullCourtWorkerRunner => ({
      simulateSlot: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
        ),
      simulateGame: (lock, checkpoint, options) => {
        calls.push(options?.restingPlayerIds);
        return Promise.resolve(
          simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
        );
      },
      simulatePractice: (lock, input) =>
        Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
      dispose: () => {},
    });

    try {
      const { assets, lock } = await seedCompletedDraft(first);
      const seasonRepo = createFullCourtSeasonRepository(first);
      const initial = createFullCourtSeasonCheckpoint(lock);
      await seasonRepo.create(initial);
      const slot82Health = { ...initial.healthByTeam };
      const allScores: FullCourtSeasonScore[] = [];
      for (const fixture of lock.season.games) {
        if (fixture.slot === CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) {
          for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
            slot82Health[teamId] = {
              teamId,
              version: FULL_COURT_HEALTH_VERSION,
              throughDay: fixture.dayOffset,
              players: {},
            };
          }
        }
        const userInGame =
          fixture.homeTeamId === lock.season.userTeamId ||
          fixture.awayTeamId === lock.season.userTeamId;
        const homeWins = userInGame
          ? fixture.slot % 4 !== 0
            ? fixture.homeTeamId === lock.season.userTeamId
            : fixture.awayTeamId === lock.season.userTeamId
          : fixture.homeTeamId < fixture.awayTeamId;
        allScores.push({
          ...fixture,
          outcome: {
            kind: 'played',
            homePoints: homeWins ? 100 : 90,
            awayPoints: homeWins ? 90 : 100,
          },
        });
      }
      await first.fullCourtSeasonCheckpoints.put({
        saveSchemaVersion: 1,
        runId: lock.season.runId,
        checkpoint: {
          schemaVersion: 1,
          runId: lock.season.runId,
          lockDigest: lock.digest,
          completedThroughSlot: CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
          healthByTeam: slot82Health,
        },
      });
      await first.fullCourtSeasonScores.bulkPut(
        allScores.map((score) => ({
          saveSchemaVersion: 1,
          runId: lock.season.runId,
          gameId: score.gameId,
          score,
        })),
      );

      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
        createWorker,
      });
      await controller.load();
      await controller.startPlayoffs();
      const preview = controller.nextPlayoffPreview();
      const team = controller.season?.lock.season.teams.find(
        (entry) => entry.teamId === controller.season?.lock.season.userTeamId,
      );
      const bench = team?.roster.at(-1);
      if (preview === null || bench === undefined) throw new Error('Missing playoff rest fixture');

      controller.setRestingPlayers([bench.playerId]);
      expect(controller.restingForGameId).toBe(preview.gameId);
      const callsBefore = calls.length;
      await controller.advance(1);
      const playoffCalls = calls.slice(callsBefore);
      expect(playoffCalls.slice(0, -1).every((resting) => resting === undefined)).toBe(true);
      expect(playoffCalls.at(-1)).toEqual([bench.playerId]);
      expect(controller.restingPlayerIds).toEqual([]);
      expect(controller.restingForGameId).toBeNull();
      controller.dispose();
    } finally {
      first.close();
    }
  });

  test('persists portable scoring roles through controller.saveBlueprint without player IDs', async () => {
    installTestEnvironment();
    const { first, second } = openTestDatabasePair('fc-controller-blueprint');
    try {
      const { assets } = await seedCompletedDraft(first);
      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
      });
      await controller.load();
      const team = controller.season?.lock.season.teams.find(
        (entry) => entry.teamId === controller.season?.lock.season.userTeamId,
      );
      if (team === undefined) throw new Error('Expected user team');

      const saved = await controller.saveBlueprint(
        '  Pace & Roles  ',
        { pace: 'fast', offense: 'ball-movement', defense: 'pressure' },
        {
          hierarchy: {
            primary: { kind: 'starter-slot', slot: 0, preferredPositions: ['PG'] },
            secondary: { kind: 'bench-slot', benchIndex: 0, preferredPositions: ['PG'] },
          },
        },
      );
      expect(saved.name).toBe('Pace & Roles');
      expect(saved.hierarchy).toEqual({
        primary: { kind: 'starter-slot', slot: 0, preferredPositions: ['PG'] },
        secondary: { kind: 'bench-slot', benchIndex: 0, preferredPositions: ['PG'] },
      });
      for (const player of team.roster) {
        expect(JSON.stringify(saved)).not.toContain(player.playerId);
      }

      controller.dispose();
      first.close();

      const reloaded = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(second),
      });
      expect(await reloaded.listBlueprints()).toEqual([saved]);
      reloaded.dispose();
    } finally {
      first.close();
      second.close();
    }
  });

  test('passes saved named units through simulation and reloads them', async () => {
    installTestEnvironment();
    const { first, second } = openTestDatabasePair('fc-controller-units');
    const captured: Array<Parameters<FullCourtWorkerRunner['simulateSlot']>[2]> = [];
    const simulateSlotMock = mock<FullCourtWorkerRunner['simulateSlot']>(
      (lock, checkpoint, options) => {
        captured.push(options);
        return Promise.resolve(
          simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
        );
      },
    );
    const simulateGameMock = mock<FullCourtWorkerRunner['simulateGame']>(
      (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
        ),
    );
    const createWorker = (): FullCourtWorkerRunner => ({
      simulateSlot: (lock, checkpoint, options) => simulateSlotMock(lock, checkpoint, options),
      simulateGame: (lock, checkpoint, options) => simulateGameMock(lock, checkpoint, options),
      simulatePractice: (lock, input) =>
        Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
      dispose: () => {},
    });

    try {
      const { assets } = await seedCompletedDraft(first);
      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
        createWorker,
      });
      await controller.load();
      const team = controller.season?.lock.season.teams.find(
        (entry) => entry.teamId === controller.season?.lock.season.userTeamId,
      );
      if (team === undefined) throw new Error('Expected user team');
      const unit = {
        name: 'Opening Five',
        playerIds: team.roster.slice(0, 5).map((player) => player.playerId),
      };
      expect(
        await controller.saveCoaching({
          ...FULL_COURT_DEFAULT_COACHING_PLAN,
          interfaceLevel: 'mastermind',
          units: [unit],
        }),
      ).toBe(true);

      await controller.advance(1);
      expect(captured[0]?.rotation?.units).toEqual([unit]);

      controller.dispose();
      first.close();

      const reloaded = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(second),
        createWorker,
      });
      await reloaded.load();
      expect(reloaded.season?.coaching.units).toEqual([unit]);
      reloaded.dispose();
    } finally {
      first.close();
      second.close();
    }
  });

  test('persists the training camp purchase and reproduces the same practice report', async () => {
    installTestEnvironment();
    const { first, second } = openTestDatabasePair('fc-controller-training-camp');
    const createWorker = (): FullCourtWorkerRunner => ({
      simulateSlot: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
        ),
      simulateGame: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
        ),
      simulatePractice: (lock, input) =>
        Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
      dispose: () => {},
    });

    try {
      const { assets, lock } = await seedCompletedDraft(first);
      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
        createWorker,
      });
      await controller.load();
      const checkpointBefore = JSON.stringify(controller.season?.checkpoint ?? null);
      expect(controller.season?.checkpoint.completedThroughSlot).toBe(0);

      await controller.purchaseReport({ kind: 'training-camp' });
      const camp = controller.draft?.reports?.find((report) => report.kind === 'training-camp');
      if (camp === undefined) throw new Error('Expected a persisted training camp purchase');
      expect(camp.priceDollars).toBe(10_000_000);
      expect(controller.draft?.spending.filter((entry) => entry.kind === 'scouting')).toHaveLength(
        1,
      );

      await controller.runPractice();
      const report = controller.practice;
      if (report === null) throw new Error('Expected a practice report');
      expect(report.seed).toBe(fullCourtTrainingCampSeed(lock.season.runSeed, camp.reportId));
      const fixture = lock.season.games.find(
        (game) =>
          game.slot === 1 &&
          (game.homeTeamId === lock.season.userTeamId ||
            game.awayTeamId === lock.season.userTeamId),
      );
      if (fixture === undefined) throw new Error('Missing the opening fixture');
      expect(report.seed).not.toBe(
        havocInstanceSeed(lock.season.runSeed, 'full-court-regular-game-v1', fixture.gameId),
      );
      expect(JSON.stringify(controller.season?.checkpoint ?? null)).toBe(checkpointBefore);
      expect(controller.season?.scores).toHaveLength(0);
      expect(controller.latestGame).toBeNull();
      expect(controller.savedReplay).toBeNull();

      await controller.runPractice();
      expect(controller.practice).toEqual(report);

      controller.dispose();
      first.close();

      const reloaded = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(second),
        createWorker,
      });
      await reloaded.load();
      expect(
        reloaded.draft?.reports?.some(
          (entry) => entry.kind === 'training-camp' && entry.reportId === camp.reportId,
        ),
      ).toBe(true);
      expect(reloaded.draft?.spending.filter((entry) => entry.kind === 'scouting')).toHaveLength(1);
      expect(reloaded.practice).toBeNull();
      await reloaded.runPractice();
      expect(reloaded.practice).toEqual(report);
      reloaded.dispose();
    } finally {
      first.close();
      second.close();
    }
  });

  test('restores the next-game plan, clears it after the user game, and skips AI-only playoff games ahead', async () => {
    installTestEnvironment();
    const { first } = openTestDatabasePair('fc-controller-matchups');
    const slotCalls: Array<Parameters<FullCourtWorkerRunner['simulateSlot']>[2]> = [];
    const playoffCalls: Array<Parameters<FullCourtWorkerRunner['simulateGame']>[2]> = [];
    const createWorker = (): FullCourtWorkerRunner => ({
      simulateSlot: (lock, checkpoint, options) => {
        slotCalls.push(options);
        return Promise.resolve(
          simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
        );
      },
      simulateGame: (lock, checkpoint, options) => {
        playoffCalls.push(options);
        return Promise.resolve(
          simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
        );
      },
      simulatePractice: (lock, input) =>
        Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
      dispose: () => {},
    });

    try {
      const { assets, lock } = await seedCompletedDraft(first);
      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
        createWorker,
      });
      await controller.load();

      const userTeam = lock.season.teams.find((team) => team.teamId === lock.season.userTeamId);
      const slot1Fixture = lock.season.games.find(
        (game) =>
          game.slot === 1 &&
          (game.homeTeamId === lock.season.userTeamId ||
            game.awayTeamId === lock.season.userTeamId),
      );
      if (userTeam === undefined || slot1Fixture === undefined) {
        throw new Error('Missing opening fixture');
      }
      const slot1OpponentId =
        slot1Fixture.homeTeamId === userTeam.teamId
          ? slot1Fixture.awayTeamId
          : slot1Fixture.homeTeamId;
      const slot1Opponent = lock.season.teams.find((team) => team.teamId === slot1OpponentId);
      if (slot1Opponent === undefined) throw new Error('Missing opening opponent');
      const opp0 = slot1Opponent.roster[0];
      const opp1 = slot1Opponent.roster[1];
      const usr0 = userTeam.roster[0];
      const usr1 = userTeam.roster[1];
      const usr2 = userTeam.roster[2];
      if (!opp0 || !opp1 || !usr0 || !usr1 || !usr2) {
        throw new Error('Missing test roster players');
      }

      expect(
        controller.setDefensiveMatchups([
          { opponentPlayerId: 'not-on-opponent', defenderPlayerId: usr0.playerId },
        ]),
      ).toBe(false);
      expect(controller.error).toContain('opponent roster');

      expect(
        controller.setDefensiveMatchups([
          {
            opponentPlayerId: opp0.playerId,
            defenderPlayerId: usr2.playerId,
          },
          {
            opponentPlayerId: opp1.playerId,
            defenderPlayerId: usr2.playerId,
          },
        ]),
      ).toBe(false);
      expect(controller.error).toContain('at most one assigned opponent');

      const assignment = {
        opponentPlayerId: opp0.playerId,
        defenderPlayerId: usr2.playerId,
      };
      expect(controller.setDefensiveMatchups([assignment])).toBe(true);
      expect(controller.defensiveMatchupsForGameId).toBe(slot1Fixture.gameId);
      expect(controller.defensiveMatchupsOpponentId).toBe(slot1OpponentId);
      const restingPlayer = userTeam.roster.at(-1);
      if (restingPlayer === undefined) throw new Error('Missing test bench player');
      controller.setRestingPlayers([restingPlayer.playerId]);
      await controller.load();
      expect(controller.defensiveMatchupAssignments).toEqual([assignment]);
      expect(controller.restingPlayerIds).toEqual([restingPlayer.playerId]);
      expect(controller.restingForGameId).toBe(slot1Fixture.gameId);

      const checkpoint = controller.season?.checkpoint;
      if (checkpoint === undefined) throw new Error('Missing season checkpoint');
      const protocolCheck = fullCourtWorkerRequestSchema.safeParse({
        schemaVersion: 1,
        type: 'full-court-simulate-slot',
        requestId: 'req-matchup-1',
        runId: lock.season.runId,
        lockDigest: lock.digest,
        checkpoint,
        options: {
          defensiveMatchups: {
            gameId: slot1Fixture.gameId,
            opponentTeamId: slot1OpponentId,
            assignments: [assignment],
          },
        },
      });
      expect(protocolCheck.success).toBe(true);

      await controller.advance(2);
      expect(slotCalls[0]?.defensiveMatchups).toEqual({
        gameId: slot1Fixture.gameId,
        opponentTeamId: slot1OpponentId,
        assignments: [assignment],
      });
      expect(slotCalls[1]?.defensiveMatchups).toBeUndefined();
      expect(controller.defensiveMatchupAssignments).toEqual([]);
      expect(controller.defensiveMatchupsForGameId).toBeNull();
      expect(slotCalls[0]?.restingPlayerIds).toEqual([restingPlayer.playerId]);
      expect(
        await repositoriesFor(first).fullCourtNextGamePlanRepository.load(lock.season.runId),
      ).toBeNull();

      // Jump to completed regular season and start playoffs to test AI-only games ahead.
      const seasonRepo = createFullCourtSeasonRepository(first);
      const initial = createFullCourtSeasonCheckpoint(lock);
      const slot82Health = { ...initial.healthByTeam };
      const allScores: FullCourtSeasonScore[] = [];
      for (const fixture of lock.season.games) {
        if (fixture.slot === CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) {
          for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
            slot82Health[teamId] = {
              teamId,
              version: FULL_COURT_HEALTH_VERSION,
              throughDay: fixture.dayOffset,
              players: {},
            };
          }
        }
        const userInGame =
          fixture.homeTeamId === lock.season.userTeamId ||
          fixture.awayTeamId === lock.season.userTeamId;
        const homeWins = userInGame
          ? fixture.slot % 4 !== 0
            ? fixture.homeTeamId === lock.season.userTeamId
            : fixture.awayTeamId === lock.season.userTeamId
          : fixture.homeTeamId < fixture.awayTeamId;
        allScores.push({
          ...fixture,
          outcome: {
            kind: 'played',
            homePoints: homeWins ? 100 : 90,
            awayPoints: homeWins ? 90 : 100,
          },
        });
      }
      await first.fullCourtSeasonCheckpoints.put({
        saveSchemaVersion: 1,
        runId: lock.season.runId,
        checkpoint: {
          schemaVersion: 1,
          runId: lock.season.runId,
          lockDigest: lock.digest,
          completedThroughSlot: CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
          healthByTeam: slot82Health,
        },
      });
      await first.fullCourtSeasonScores.bulkPut(
        allScores.map((score) => ({
          saveSchemaVersion: 1,
          runId: lock.season.runId,
          gameId: score.gameId,
          score,
        })),
      );
      await seasonRepo.load(lock.season.runId);
      await controller.load();
      await controller.startPlayoffs();

      const preview = controller.nextPlayoffPreview();
      if (preview === null) throw new Error('Missing playoff preview');
      const playoffOpp = lock.season.teams.find((team) => team.teamId === preview.opponentTeamId);
      const playoffOpp0 = playoffOpp?.roster[0];
      if (playoffOpp0 === undefined) throw new Error('Missing playoff opponent starter');
      const playoffAssignment = {
        opponentPlayerId: playoffOpp0.playerId,
        defenderPlayerId: usr1.playerId,
      };
      expect(controller.setDefensiveMatchups([playoffAssignment])).toBe(true);
      expect(controller.defensiveMatchupsForGameId).toBe(preview.gameId);

      const playoffCallsBefore = playoffCalls.length;
      await controller.advance(1);
      const userAdvanceCalls = playoffCalls.slice(playoffCallsBefore);
      expect(
        userAdvanceCalls.slice(0, -1).every((options) => options?.defensiveMatchups === undefined),
      ).toBe(true);
      expect(userAdvanceCalls.at(-1)?.defensiveMatchups).toEqual({
        gameId: preview.gameId,
        opponentTeamId: preview.opponentTeamId,
        assignments: [playoffAssignment],
      });
      expect(controller.defensiveMatchupAssignments).toEqual([]);
      expect(controller.defensiveMatchupsForGameId).toBeNull();
      controller.dispose();
    } finally {
      first.close();
    }
  });
});

test('keeps a stale tab from paying for training camp after another tab commits the opener', async () => {
  installTestEnvironment();
  const { first, second } = openTestDatabasePair('fc-purchase-stale-tab');
  const createWorker = (): FullCourtWorkerRunner => ({
    simulateSlot: (lock, checkpoint, options) =>
      Promise.resolve(
        simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
      ),
    simulateGame: (lock, checkpoint, options) =>
      Promise.resolve(
        simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
      ),
    simulatePractice: (lock, input) =>
      Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
    dispose: () => {},
  });
  try {
    const { assets, lock } = await seedCompletedDraft(first);
    const stale = new FullCourtController({
      loadAssets: () => Promise.resolve(assets),
      loadHealthProfiles: () => Promise.resolve(null),
      repositories: repositoriesFor(first),
      createWorker,
    });
    const live = new FullCourtController({
      loadAssets: () => Promise.resolve(assets),
      loadHealthProfiles: () => Promise.resolve(null),
      repositories: repositoriesFor(second),
      createWorker,
    });
    await stale.load();
    await live.load();
    expect(stale.season?.checkpoint.completedThroughSlot).toBe(0);
    const staleFilm = stale.nextFilmTarget();
    if (staleFilm === null) throw new Error('Expected the opening film target');

    const scoutId =
      stale.draft?.pool?.playerVersionIds[0] ?? assets.catalog.candidates[0]?.playerVersionId;
    if (scoutId === undefined) throw new Error('Missing draft pool candidate');
    await stale.purchaseReport({
      kind: 'player-scouting',
      playerVersionId: scoutId,
    });
    expect(stale.error).toBeNull();

    await live.advance(1);
    expect(live.season?.checkpoint.completedThroughSlot).toBe(1);

    await stale.purchaseReport({ kind: 'training-camp' });
    expect(stale.error).toBe('Training camp closes before the first regular-season game.');
    expect(stale.draft?.reports?.some((report) => report.kind === 'training-camp') ?? false).toBe(
      false,
    );

    await stale.purchaseReport(staleFilm);
    expect(stale.error).toBe('Film study is available for your next game.');

    const durable = await repositoriesFor(second).fullCourtDraftRepository.load(lock.season.runId);
    if (durable === null) throw new Error('Missing durable draft');
    expect(
      durable.spending.filter((entry) => entry.kind === 'scouting').map((entry) => entry.dollars),
    ).toEqual([fullCourtReportPriceDollars('player-scouting')]);
    expect(durable.reports?.some((report) => report.kind === 'training-camp') ?? false).toBe(false);
    expect(
      (await repositoriesFor(second).fullCourtSeasonRepository.load(lock.season.runId))
        ?.completedThroughSlot,
    ).toBe(1);

    await stale.runPractice();
    expect(stale.error).toBe('Training camp practice closes before the first regular-season game.');
    expect(stale.practice).toBeNull();

    // Every run perk is bought before the opener, so lineup fit closes with camp and film.
    await stale.purchaseReport({ kind: 'lineup-fit' });
    expect(stale.error).toBe('Roster fit closes before the first regular-season game.');
    expect(
      (await repositoriesFor(second).fullCourtDraftRepository.load(lock.season.runId))?.spending
        .filter((entry) => entry.kind === 'scouting')
        .map((entry) => entry.dollars),
    ).toEqual([fullCourtReportPriceDollars('player-scouting')]);
    stale.dispose();
    live.dispose();
  } finally {
    first.close();
    second.close();
  }
});

test('opens a practice report bought by another tab and refuses a new one after the opener', async () => {
  installTestEnvironment();
  const { first, second } = openTestDatabasePair('fc-practice-durable');
  const createWorker = (): FullCourtWorkerRunner => ({
    simulateSlot: (lock, checkpoint, options) =>
      Promise.resolve(
        simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
      ),
    simulateGame: (lock, checkpoint, options) =>
      Promise.resolve(
        simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
      ),
    simulatePractice: (lock, input) =>
      Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
    dispose: () => {},
  });
  try {
    const { assets, lock } = await seedCompletedDraft(first);
    const firstTab = new FullCourtController({
      loadAssets: () => Promise.resolve(assets),
      loadHealthProfiles: () => Promise.resolve(null),
      repositories: repositoriesFor(first),
      createWorker,
    });
    const secondTab = new FullCourtController({
      loadAssets: () => Promise.resolve(assets),
      loadHealthProfiles: () => Promise.resolve(null),
      repositories: repositoriesFor(second),
      createWorker,
    });
    await firstTab.load();
    await secondTab.load();
    await secondTab.purchaseReport({ kind: 'training-camp' });
    expect(secondTab.error).toBeNull();
    expect(
      firstTab.draft?.reports?.some((report) => report.kind === 'training-camp') ?? false,
    ).toBe(false);

    await firstTab.runPractice();
    expect(firstTab.error).toBeNull();
    const camp = firstTab.draft?.reports?.find((report) => report.kind === 'training-camp');
    if (camp === undefined) throw new Error('Expected the durable training camp report');
    expect(firstTab.practice?.seed).toBe(
      fullCourtTrainingCampSeed(lock.season.runSeed, camp.reportId),
    );

    await secondTab.advance(1);
    const opened = firstTab.practice;
    await firstTab.runPractice();
    expect(firstTab.error).toBe(
      'Training camp practice closes before the first regular-season game.',
    );
    expect(firstTab.practice).toEqual(opened);
    firstTab.dispose();
    secondTab.dispose();
  } finally {
    first.close();
    second.close();
  }
});

describe('FullCourtController decision-aware simulation stops', () => {
  test('pauses a regular-season batch at the next scheduled review', async () => {
    installTestEnvironment();
    const { first } = openTestDatabasePair('fc-controller-review-stop');
    const createWorker = (): FullCourtWorkerRunner => ({
      simulateSlot: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
        ),
      simulateGame: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
        ),
      simulatePractice: (lock, input) =>
        Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
      dispose: () => {},
    });
    try {
      const { assets, lock } = await seedCompletedDraft(first);
      const healthByTeam: FullCourtSeasonCheckpoint['healthByTeam'] = {};
      for (const fixture of lock.season.games.filter((game) => game.slot === 19)) {
        for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
          healthByTeam[teamId] = {
            teamId,
            version: FULL_COURT_HEALTH_VERSION,
            throughDay: fixture.dayOffset,
            players: {},
          };
        }
      }
      await first.fullCourtSeasonCheckpoints.put({
        saveSchemaVersion: 1,
        runId: lock.season.runId,
        checkpoint: {
          schemaVersion: 1,
          runId: lock.season.runId,
          lockDigest: lock.digest,
          completedThroughSlot: 19,
          healthByTeam,
        },
      });

      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
        createWorker,
      });
      await controller.load();
      expect(controller.season?.checkpoint.completedThroughSlot).toBe(19);

      await controller.advance(25, false, false, { stopAtReview: true });
      expect(controller.season?.checkpoint.completedThroughSlot).toBe(20);
      expect(controller.notice?.stop).toEqual({ kind: 'review', slot: 20 });
      expect(controller.notice?.title).toContain('Scheduled review');
      controller.dispose();
    } finally {
      first.close();
    }
  });

  test('pauses a regular-season batch after the first actionable user injury', async () => {
    installTestEnvironment();
    const { first } = openTestDatabasePair('fc-controller-injury-stop');
    let injected = false;
    const createWorker = (): FullCourtWorkerRunner => ({
      simulateSlot: (lock, checkpoint, options) => {
        const outcome = simulateFullCourtSeasonSlot(
          lock,
          checkpoint,
          createEngineContext(),
          options,
        );
        if (injected || outcome.kind !== 'simulated' || outcome.userGame.kind !== 'played') {
          return Promise.resolve(outcome);
        }
        const userTeamId = lock.season.userTeamId;
        const userTeam = lock.season.teams.find((team) => team.teamId === userTeamId);
        const player = userTeam?.roster[0];
        const userHealth = outcome.checkpoint.healthByTeam[userTeamId];
        if (player === undefined || userHealth === undefined) {
          throw new Error('Missing injury test inputs');
        }
        const nextFixture = lock.season.games.find(
          (game) =>
            game.slot === outcome.checkpoint.completedThroughSlot + 1 &&
            (game.homeTeamId === userTeamId || game.awayTeamId === userTeamId),
        );
        const availableFromDay = (nextFixture?.dayOffset ?? userHealth.throughDay) + 5;
        const injury: FullCourtInjuryEvent = {
          teamId: userTeamId,
          playerId: player.playerId,
          playerVersionId: player.playerVersionId ?? 'test-version',
          cohortId: 'test-cohort',
          onsetDay: userHealth.throughDay,
          gamesMissed: 3,
          availableFromDay,
          projected: false,
        };
        injected = true;
        return Promise.resolve({
          ...outcome,
          userGame: { ...outcome.userGame, injuries: [injury] },
          checkpoint: {
            ...outcome.checkpoint,
            healthByTeam: {
              ...outcome.checkpoint.healthByTeam,
              [userTeamId]: {
                ...userHealth,
                players: {
                  ...userHealth.players,
                  [player.playerId]: { loadBasisPoints: 0, availableFromDay },
                },
              },
            },
          },
        });
      },
      simulateGame: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
        ),
      simulatePractice: (lock, input) =>
        Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
      dispose: () => {},
    });
    try {
      const { assets, lock } = await seedCompletedDraft(first);
      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
        createWorker,
      });
      await controller.load();
      const userTeam = lock.season.teams.find((team) => team.teamId === lock.season.userTeamId);
      const player = userTeam?.roster[0];
      if (player === undefined) throw new Error('Missing user player');

      await controller.advance(5, false, false, { stopAtInjury: true });
      expect(controller.season?.checkpoint.completedThroughSlot).toBe(1);
      expect(controller.notice?.stop).toMatchObject({
        kind: 'injury',
        slot: 1,
        playerIds: [player.playerId],
      });
      expect(controller.notice?.message).toContain('Out until day');

      await controller.advance(2);
      expect(controller.season?.checkpoint.completedThroughSlot).toBe(3);
      controller.dispose();
    } finally {
      first.close();
    }
  });

  test('playoff sims count user games and advance intervening AI games', async () => {
    installTestEnvironment();
    const { first } = openTestDatabasePair('fc-controller-playoff-user-games');
    const createWorker = (): FullCourtWorkerRunner => ({
      simulateSlot: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
        ),
      simulateGame: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
        ),
      simulatePractice: (lock, input) =>
        Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
      dispose: () => {},
    });
    try {
      const { assets, lock } = await seedPlayoffReadyDraft(first);
      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
        createWorker,
      });
      await controller.load();
      await controller.startPlayoffs();
      expect(controller.playoffs?.checkpoint.games.length).toBe(0);

      await controller.advance(2);
      const games = controller.playoffs?.checkpoint.games ?? [];
      const userGames = games.filter(
        (game) =>
          game.homeTeamId === lock.season.userTeamId || game.awayTeamId === lock.season.userTeamId,
      );
      expect(userGames).toHaveLength(2);
      expect(games.length).toBeGreaterThan(userGames.length);
      const stopKind = controller.notice?.stop.kind;
      expect(stopKind === 'game-limit' || stopKind === 'opponent-adjustment').toBe(true);
      expect(controller.latestGame?.tape).toBeNull();
      controller.dispose();
    } finally {
      first.close();
    }
  });

  test('returns control at series end and resolves the next opponent before its first game', async () => {
    installTestEnvironment();
    const { first } = openTestDatabasePair('fc-controller-playoff-series-stop');
    const createWorker = (): FullCourtWorkerRunner => ({
      simulateSlot: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
        ),
      simulateGame: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
        ),
      simulatePractice: (lock, input) =>
        Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
      dispose: () => {},
    });
    try {
      const { assets, lock } = await seedPlayoffReadyDraft(first);
      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
        createWorker,
      });
      await controller.load();
      await controller.startPlayoffs();

      for (let attempt = 0; attempt < 4; attempt++) {
        await controller.advance(7);
        if (controller.notice?.stop.kind === 'series-complete') break;
      }
      const stop = controller.notice?.stop;
      expect(stop?.kind).toBe('series-complete');
      if (stop?.kind !== 'series-complete') return;

      const userTeamId = lock.season.userTeamId;
      const userGamesAfterSeries = (controller.playoffs?.checkpoint.games ?? []).filter(
        (game) => game.homeTeamId === userTeamId || game.awayTeamId === userTeamId,
      ).length;
      const gamesAfterSeries = controller.playoffs?.checkpoint.games.length ?? 0;

      await controller.advance(1);
      const gamesAfterAdvance = controller.playoffs?.checkpoint.games ?? [];
      const userGamesAfterAdvance = gamesAfterAdvance.filter(
        (game) => game.homeTeamId === userTeamId || game.awayTeamId === userTeamId,
      ).length;
      if (stop.won) {
        expect(controller.notice?.stop.kind).toBe('opponent-change');
        expect(userGamesAfterAdvance).toBe(userGamesAfterSeries);
      } else {
        expect(gamesAfterAdvance.length).toBeGreaterThan(gamesAfterSeries);
        expect(userGamesAfterAdvance).toBe(userGamesAfterSeries);
      }
      controller.dispose();
    } finally {
      first.close();
    }
  });

  test('batch-finishes AI-only bracket games after the user misses the playoffs', async () => {
    installTestEnvironment();
    const { first } = openTestDatabasePair('fc-controller-playoff-eliminated');
    const createWorker = (): FullCourtWorkerRunner => ({
      simulateSlot: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
        ),
      simulateGame: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
        ),
      simulatePractice: (lock, input) =>
        Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
      dispose: () => {},
    });
    try {
      const { assets, lock } = await seedPlayoffReadyDraft(first, 'miss-playoffs');
      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
        createWorker,
      });
      await controller.load();
      await controller.startPlayoffs();
      expect(controller.playoffs?.view.userOutcome.status).toBe('not-qualified');

      const before = controller.playoffs?.checkpoint.games.length ?? 0;
      await controller.advance(5);
      const games = controller.playoffs?.checkpoint.games ?? [];
      expect(games.length - before).toBe(5);
      expect(
        games.every(
          (game) =>
            game.homeTeamId !== lock.season.userTeamId &&
            game.awayTeamId !== lock.season.userTeamId,
        ),
      ).toBe(true);
      expect(controller.notice?.stop.kind).toBe('game-limit');
      expect(controller.latestGame).toBeNull();
      controller.dispose();
    } finally {
      first.close();
    }
  });
});

describe('FullCourtController abandoned runs', () => {
  test('abandonRun clears the active save and returns to draft setup', async () => {
    installTestEnvironment();
    const { first, second } = openTestDatabasePair('fc-controller-abandon-run');
    const createWorker = (): FullCourtWorkerRunner => ({
      simulateSlot: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtSeasonSlot(lock, checkpoint, createEngineContext(), options),
        ),
      simulateGame: (lock, checkpoint, options) =>
        Promise.resolve(
          simulateFullCourtPlayoffGame(lock, checkpoint, createEngineContext(), options),
        ),
      simulatePractice: (lock, input) =>
        Promise.resolve(simulateFullCourtTrainingCamp(lock.season, input, createEngineContext())),
      dispose: () => {},
    });
    try {
      const { runId, assets } = await seedCompletedDraft(first);
      const controller = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(first),
        createWorker,
      });
      await controller.load();
      await controller.advance(1);
      expect(controller.error).toBeNull();
      expect(controller.season?.checkpoint.completedThroughSlot).toBe(1);
      expect(localStorage.getItem(FULL_COURT_ACTIVE_RUN_KEY)).toBe(runId);

      await controller.abandonRun();
      expect(controller.error).toBeNull();
      expect(controller.draft).toBeNull();
      expect(controller.season).toBeNull();
      expect(controller.playoffs).toBeNull();
      expect(controller.latestGame).toBeNull();
      expect(localStorage.getItem(FULL_COURT_ACTIVE_RUN_KEY)).toBeNull();
      controller.dispose();

      const reloaded = new FullCourtController({
        loadAssets: () => Promise.resolve(assets),
        loadHealthProfiles: () => Promise.resolve(null),
        repositories: repositoriesFor(second),
        createWorker,
      });
      await reloaded.load();
      expect(reloaded.draft).toBeNull();
      expect(reloaded.season).toBeNull();
      reloaded.dispose();
    } finally {
      first.close();
      second.close();
    }
  });
});
