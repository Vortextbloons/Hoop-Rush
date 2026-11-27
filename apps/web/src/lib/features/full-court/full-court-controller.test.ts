import '../../../../../../packages/persistence/src/test-setup.ts';
import { afterEach, describe, expect, mock, test } from 'bun:test';
import Dexie from 'dexie';
import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  FULL_COURT_DEFAULT_MONEY,
  FULL_COURT_HEALTH_VERSION,
  commandIdSchema,
  franchiseIdSchema,
  fullCourtCreateDraftCommandSchema,
  idSchema,
  playerVersionId,
  seedSchema,
  type FullCourtSeasonScore,
  type SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import { submitFullCourtDraftCommand } from '@hoop-rush/application/full-court';
import {
  buildFullCourtRegularSeason,
  createEngineContext,
  createFullCourtSeasonCheckpoint,
  fullCourtDraftIndexOf,
  lockFullCourtRegularSeason,
  simulateFullCourtPlayoffGame,
  simulateFullCourtSeasonSlot,
  type CapRushLeagueField,
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
  for (const candidate of base.candidates.filter((player) => player.positions.primary === 'PG')) {
    await submitFullCourtDraftCommand(
      {
        command: 'pick-full-court-player',
        commandId: commandIdSchema.parse(`fc-pick-${String(draft.revision)}`),
        runId: draft.runId,
        expectedRevision: draft.revision,
        playerVersionId: candidate.playerVersionId,
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

      // AI-only playoff games do not write a watched replay even if record=true.
      while (controller.playoffs?.view.nextGame?.userSide === null) {
        await controller.advance(1, false, true);
        expect(controller.savedReplay).toBeNull();
      }

      // Watch opening user playoff game.
      await controller.advance(1, false, true);
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
      while (controller.playoffs?.view.nextGame?.userSide === null) {
        await controller.advance(1);
      }
      expect(calls.every((resting) => resting === undefined)).toBe(true);
      expect(controller.restingForGameId).toBe(preview.gameId);

      await controller.advance(1);
      expect(calls.at(-1)).toEqual([bench.playerId]);
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
});
