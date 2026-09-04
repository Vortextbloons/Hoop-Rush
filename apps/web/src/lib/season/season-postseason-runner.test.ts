import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEASON_COMMAND_LOG_VERSION,
  SEASON_DRAFT_CATALOG_V3,
  SEASON_DURABILITY_VERSION,
  SEASON_ROUND_COUNT,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_STAMINA_VERSION,
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  PLAYER_VERSION_ID_VERSION,
  canonicalJson,
  seasonAlmanacDigest,
  seasonCommandLogDigest,
  seasonDigestHex,
  seasonPostseasonSummarySchema,
  seasonPostseasonWorkerStartRequestSchema,
  seasonPostseasonWorkerCancelRequestSchema,
  type Position,
  type SeasonActiveRunIndex,
  type SeasonCommandLog,
  type SeasonCommandLogEntry,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGameSimulationInput,
  type SeasonGameSimulationResult,
  type SeasonGameSideResult,
  type SeasonInjuryRecord,
  type SeasonPostseasonSummary,
  type SeasonRun,
  type SeasonRunCommand,
  type SeasonStandings,
} from '@hoop-rush/data-contracts';
import {
  eraIdSchema,
  commandIdSchema,
  franchiseIdSchema,
  idSchema,
  seedSchema,
  seasonGameIdSchema,
} from '@hoop-rush/data-contracts';
import {
  handleSeasonRunCommand,
  seasonRunStateDigest,
  seasonPostseasonNextGame,
  seasonPostseasonHumanEliminated,
  zeroSeasonGameTransition,
  type SeasonPostseasonGameResolver,
} from '@hoop-rush/engine';
import {
  buildEraSimulationProfile,
  buildSeasonLeague,
  buildSeasonRunFixture,
} from '@hoop-rush/test-fixtures';
import { generateSeasonSchedule } from '@hoop-rush/engine';
import {
  SeasonRunCommandDuplicateError,
  SeasonRunCommandRunMismatchError,
  SeasonRunCommandStaleStateError,
  type CommitPostseasonAdvancementInput,
  type PromoteChampionInput,
  type SeasonCompletedSeason,
  type SeasonCompletedRunIndexEntry,
  type SeasonRunRepository,
  type SeasonRunSnapshot,
} from '@hoop-rush/persistence';
import {
  createSeasonPostseasonRunner,
  promoteSeasonChampion,
  SEASON_POSTSEASON_CHUNK_MAX_GAMES,
  type SeasonPostseasonEvent,
  type SeasonPostseasonRunner,
} from './season-postseason-runner';
import { createSeasonPostseasonEngineSimulator } from './fake-season-postseason-runner';
const SEED = seedSchema.parse('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
const HUMAN = franchiseIdSchema.parse('lakers');
interface TeamSpec {
  w: number;
  l: number;
  h2h?: Record<string, number>;
}
function standingsSpec(): Record<string, TeamSpec> {
  const league = buildSeasonLeague({}, { humanFranchiseId: HUMAN });
  const spec: Record<string, TeamSpec> = {};
  const east = league.teams.filter((team) => team.conference === 'east');
  east.forEach((team, index) => {
    const w = 62 - index;
    spec[team.franchiseId] = { w, l: 82 - w };
  });
  const west = league.teams.filter((team) => team.conference === 'west');
  let above = 0;
  let below = 0;
  west.forEach((team) => {
    if (team.franchiseId === HUMAN || team.franchiseId === 'clippers') {
      spec[team.franchiseId] = { w: 40, l: 42 };
    } else if (above < 6) {
      const w = 52 + above;
      spec[team.franchiseId] = { w, l: 82 - w };
      above += 1;
    } else {
      const w = 30 - below;
      spec[team.franchiseId] = { w, l: 82 - w };
      below += 1;
    }
  });
  spec[HUMAN] = { w: 40, l: 42, h2h: { clippers: 1 } };
  spec.clippers = { w: 40, l: 42, h2h: { [HUMAN]: 3 } };
  return spec;
}
function standingsOf(spec: Record<string, TeamSpec>): SeasonStandings {
  const league = buildSeasonLeague({}, { humanFranchiseId: HUMAN });
  const teamIds = league.teams.map((team) => team.franchiseId);
  return {
    schemaVersion: 1,
    standingsVersion: 'standings-v1',
    rows: teamIds.map((franchiseId) => {
      const teamSpec = spec[franchiseId] ?? { w: 0, l: 0 };
      return {
        franchiseId,
        wins: teamSpec.w,
        losses: teamSpec.l,
        gamesPlayed: teamSpec.w + teamSpec.l,
        homeWins: 0,
        homeLosses: 0,
        awayWins: 0,
        awayLosses: 0,
        conferenceWins: 0,
        conferenceLosses: 0,
        divisionWins: 0,
        divisionLosses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        headToHead: teamIds
          .filter((other) => other !== franchiseId)
          .map((other) => ({
            franchiseId: other,
            wins: teamSpec.h2h?.[other] ?? 0,
            losses: spec[other]?.h2h?.[franchiseId] ?? 0,
          })),
      };
    }),
  };
}
const SLOT_POSITIONS: ReadonlyArray<readonly Position[]> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF', 'C'],
  ['C'],
];
function catalogOf(run: SeasonRun): SeasonDraftCatalog {
  const candidates: SeasonDraftCandidate[] = run.rosters.flatMap((roster) =>
    roster.players.map((player, slot) => {
      const playable = SLOT_POSITIONS[slot];
      if (playable === undefined) throw new Error(`no position pattern for slot ${String(slot)}`);
      const primary = playable[0];
      if (primary === undefined) throw new Error(`no primary position for slot ${String(slot)}`);
      return {
        playerVersionId: player.playerVersionId,
        playerId: player.playerId,
        franchiseId: roster.franchiseId,
        eraId: player.eraId,
        seasonKey: player.seasonKey,
        displayName: player.displayName,
        playerExternalId: '101',
        positions: {
          primary,
          secondary: playable.slice(1),
          playable: [...playable],
          normalizationVersion: 'position-v3',
        },
        heightInches: 79,
        weightLbs: 215,
        summaryRatings: { overallRating: 90, offenseRating: 92, defenseRating: 84 },
        detailedRatings: { ...SIMULATION_RATINGS },
        tendencies: { ...SIMULATION_TENDENCIES },
        stamina: { rating: 70, historicalMpg: 30, derivationVersion: SEASON_STAMINA_VERSION },
        durability: { rating: 70, derivationVersion: SEASON_DURABILITY_VERSION },
      };
    }),
  );
  const pools = run.rosters.map((roster) => ({
    franchiseId: roster.franchiseId,
    eraId: eraIdSchema.parse('1990s'),
    playerVersionIds: roster.players.map((player) => player.playerVersionId),
  }));
  return {
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_V3,
    dataVersion: 'data-v1',
    ratingsVersion: 'ratings-v1',
    positionNormalizationVersion: 'position-v3',
    playerVersionIdVersion: PLAYER_VERSION_ID_VERSION,
    staminaVersion: SEASON_STAMINA_VERSION,
    durabilityVersion: SEASON_DURABILITY_VERSION,
    pools,
    candidates,
  };
}
function zeroEffects(run: SeasonRun): SeasonEffectsState {
  const playerStates = run.rosters.flatMap((roster) =>
    roster.players.map((player) => ({
      playerVersionId: player.playerVersionId,
      fatigueBasisPoints: 0,
      recentLoadBasisPoints: 0,
      lastCompletedRound: 0,
    })),
  );
  const pairStates: SeasonEffectsState['pairStates'] = [];
  for (const roster of run.rosters) {
    const ids = roster.players.map((player) => player.playerVersionId).sort();
    for (let i = 0; i < ids.length; i += 1) {
      const a = ids[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < ids.length; j += 1) {
        const b = ids[j];
        if (b === undefined) continue;
        pairStates.push({ a, b, sharedPossessions: 0 });
      }
    }
  }
  return {
    schemaVersion: 2,
    playerStates,
    inactivePlayerStates: [],
    pairStates,
    archivedPairs: [],
  };
}
function runAtPostseasonBoundary(): SeasonRun {
  const league = buildSeasonLeague({}, { humanFranchiseId: HUMAN });
  const schedule = generateSeasonSchedule({ league, seed: SEED });
  const base = buildSeasonRunFixture({ schedule, league, seed: SEED, humanFranchiseId: HUMAN });
  const effects = zeroEffects(base);
  const run: SeasonRun = {
    ...base,
    cursor: { ...base.cursor, completedRounds: SEASON_ROUND_COUNT },
    standings: standingsOf(standingsSpec()),
    stateRevision: 0,
    stateDigest: seasonRunStateDigest({
      stateRevision: 0,
      stage: 'regular-season',
      postseason: base.postseason,
      awards: null,
      completion: null,
      checkpointState: null,
      health: base.health,
      influence: base.influence,
      transactions: [],
      trade: null,
      objectives: base.objectives,
      rosters: base.rosters,
      ownership: base.ownership,
      rotations: base.rotations,
      effects,
      freeAgency: base.freeAgency,
    }),
  };
  return run;
}
function withHumanStarterInjury(run: SeasonRun): SeasonRun {
  const humanRotation = run.rotations.find((rotation) => rotation.franchiseId === HUMAN);
  const starter = humanRotation?.starters[0];
  if (starter === undefined) throw new Error('fixture run has no human rotation starter');
  const injury: SeasonInjuryRecord = {
    injuryId: 'inj-0123456789abcdef0123456789abcdef',
    playerVersionId: starter,
    franchiseId: HUMAN,
    gameId: seasonGameIdSchema.parse('s000001'),
    type: 'soft-tissue',
    severity: 'moderate',
    occurredBeforeHalftime: false,
    sameGameReturn: false,
    sameGameReturned: null,
    missedGamesTotal: 4,
    missedGamesRemaining: 2,
    actualReturnRound: null,
    seasonEnding: false,
    rehabModifier: 0 as const,
    recurrenceWindowRoundsRemaining: 0,
    seedPath: ['test', 'postseason', 'runner', 'injury'],
  };
  return { ...run, health: { ...run.health, injuries: [...run.health.injuries, injury] } };
}
function forcedCompletedResult(
  gameInput: SeasonGameSimulationInput,
  homeScore: number,
  awayScore: number,
): {
  result: SeasonGameSimulationResult;
} {
  const homeWon = homeScore > awayScore;
  const sideOf = (side: 'home' | 'away', score: number): SeasonGameSideResult => {
    const team = side === 'home' ? gameInput.home : gameInput.away;
    const fgm = Math.floor(score / 2);
    const ftm = score % 2;
    return {
      teamId: team.teamId,
      displayName: team.displayName,
      franchiseId: team.franchiseId,
      score,
      periodScores: [score],
      box: {
        points: score,
        fieldGoals: { made: fgm, attempted: fgm },
        threes: { made: 0, attempted: 0 },
        freeThrows: { made: ftm, attempted: ftm },
        rebounds: { total: 0, offensive: 0, defensive: 0, team: 0 },
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        possessions: 60,
        diagnostics: {
          assistedFieldGoals: 0,
          unassistedFieldGoals: fgm,
          reboundOpportunities: 0,
          contestedShots: 0,
        },
      },
      players: team.players.map((player, index) => ({
        playerVersionId: player.playerVersionId,
        playerId: player.playerId,
        seconds: 1440,
        minutes: 24,
        points: index === 0 ? score : 0,
        fieldGoals: { made: index === 0 ? fgm : 0, attempted: index === 0 ? fgm : 0 },
        threes: { made: 0, attempted: 0 },
        freeThrows: { made: index === 0 ? ftm : 0, attempted: index === 0 ? ftm : 0 },
        rebounds: { total: 0, offensive: 0, defensive: 0 },
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        diagnostics: {
          usage: 0,
          shotZones: [],
          assistOpportunities: 0,
          offensiveReboundChances: 0,
          defensiveReboundChances: 0,
          contestedShots: 0,
        },
      })),
      shotZones: [],
      returns: [],
    };
  };
  return {
    result: {
      schemaVersion: 1,
      outcome: 'completed',
      seed: gameInput.seed,
      gameNumber: gameInput.gameNumber,
      dataVersion: gameInput.dataVersion,
      engineVersion: 'engine-v1',
      profileVersion: gameInput.profile.profileVersion,
      winner: homeWon ? 'home' : 'away',
      overtimePeriods: 0,
      home: sideOf('home', homeScore),
      away: sideOf('away', awayScore),
      substitutions: [],
      unitStints: [],
      deviations: [],
      foulOuts: [],
      removals: [],
    },
  };
}
function humanLosesResolver(): SeasonPostseasonGameResolver {
  return ({ gameInput, pregameEffects }) => {
    const home = gameInput.home.franchiseId;
    const away = gameInput.away.franchiseId;
    const humanIsHome = home === HUMAN;
    const humanIsAway = away === HUMAN;
    const winner = humanIsHome ? 'away' : humanIsAway ? 'home' : 'home';
    return {
      ...forcedCompletedResult(
        gameInput,
        winner === 'home' ? 110 : 90,
        winner === 'home' ? 90 : 110,
      ),
      transition: zeroSeasonGameTransition(pregameEffects),
    };
  };
}
function contextOf(
  run: SeasonRun,
  effects: SeasonEffectsState,
  catalog: SeasonDraftCatalog,
  profile: ReturnType<typeof buildEraSimulationProfile>,
  resolver: SeasonPostseasonGameResolver,
): Parameters<typeof handleSeasonRunCommand>[1] {
  return {
    run,
    pending: null,
    humanFranchiseId: HUMAN,
    effects,
    catalog,
    profile,
    postseasonGameResolver: resolver,
  };
}
function commandOf(
  run: SeasonRun,
  command: 'start-postseason' | 'advance-postseason',
  commandId: string,
  extra: Record<string, unknown> = {},
): SeasonRunCommand {
  return {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    commandId: commandIdSchema.parse(commandId),
    runId: run.runId,
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
    command,
    ...extra,
  };
}
class FakePostseasonRepository implements SeasonRunRepository {
  active: SeasonRunSnapshot | null = null;
  commandIds = new Set<string>();
  logEntries: SeasonCommandLogEntry[] = [];
  summaries: SeasonPostseasonSummary[] = [];
  completed: SeasonCompletedSeason | null = null;
  completedIndex: SeasonCompletedRunIndexEntry[] = [];
  failNextCommitWith: Error | null = null;
  commitPostseasonAdvancement(input: CommitPostseasonAdvancementInput): Promise<void> {
    if (this.failNextCommitWith !== null) {
      const error = this.failNextCommitWith;
      this.failNextCommitWith = null;
      return Promise.reject(error);
    }
    if (this.active === null || this.active.run.runId !== input.runId) {
      return Promise.reject(new SeasonRunCommandRunMismatchError(input.runId));
    }
    const current = this.active.run;
    if (
      current.stateRevision !== input.command.expectedStateRevision ||
      current.stateDigest !== input.command.expectedStateDigest
    ) {
      return Promise.reject(
        new SeasonRunCommandStaleStateError(
          input.command.commandId,
          input.command.expectedStateRevision,
          current.stateRevision,
        ),
      );
    }
    if (this.commandIds.has(input.command.commandId)) {
      return Promise.reject(new SeasonRunCommandDuplicateError(input.command.commandId));
    }
    if (input.run.stateRevision !== input.command.expectedStateRevision + 1) {
      return Promise.reject(
        new Error('advancement must advance the state revision by exactly one'),
      );
    }
    const ordinal = this.logEntries.length;
    this.commandIds.add(input.command.commandId);
    this.logEntries.push({
      runId: input.runId,
      ordinal,
      command: input.command,
      preStateRevision: input.preStateRevision,
      preStateDigest: input.preStateDigest,
      postStateRevision: input.run.stateRevision,
      postStateDigest: input.run.stateDigest,
      resultDigest: input.resultDigest,
      previousLogDigest: seasonCommandLogDigest(this.logEntries.slice(0, ordinal)),
      relatedGameIds: [...input.relatedGameIds].sort(),
      transactionIds: [...input.transactionIds].sort().map((id) => idSchema.parse(id)),
    });
    this.summaries.push(...input.summaries);
    const effects =
      (
        input.run as SeasonRun & {
          effects?: SeasonEffectsState;
        }
      ).effects ?? this.active.effects;
    this.active = { ...this.active, run: input.run, effects };
    return Promise.resolve();
  }
  loadActiveRun(): Promise<SeasonRunSnapshot | null> {
    return Promise.resolve(this.active);
  }
  loadActiveRunIndex(): Promise<SeasonActiveRunIndex | null> {
    if (this.active === null) return Promise.resolve(null);
    return Promise.resolve({
      runId: this.active.run.runId,
      rootSeed: this.active.run.rootSeed,
      humanFranchiseId: HUMAN,
      completedRounds: this.active.run.cursor.completedRounds,
      revision: 0,
      humanWins: 0,
      humanLosses: 0,
      updatedAtIso: '2026-01-01T00:00:00.000Z',
    });
  }
  loadCommandLog(): Promise<SeasonCommandLog | null> {
    if (this.active === null) return Promise.resolve(null);
    return Promise.resolve({
      schemaVersion: 1,
      commandLogVersion: SEASON_COMMAND_LOG_VERSION,
      runId: this.active.run.runId,
      entries: [...this.logEntries],
    });
  }
  loadPostseasonSummaries(): Promise<SeasonPostseasonSummary[]> {
    return Promise.resolve([...this.summaries]);
  }
  loadPostseasonSummary(runId: string, gameId: string): Promise<SeasonPostseasonSummary | null> {
    const summary = this.summaries.find((entry) => entry.gameId === gameId);
    return Promise.resolve(summary ?? null);
  }
  loadPostseasonDetails(): Promise<never[]> {
    return Promise.resolve([]);
  }
  promoteChampionToCompleted(input: PromoteChampionInput): Promise<void> {
    if (input.run.stage !== 'completed' || input.run.completion === null) {
      return Promise.reject(new Error('cannot promote an active run'));
    }
    if (
      input.run.postseason.championFranchiseId !== input.almanac.championFranchiseId ||
      input.run.completion.championFranchiseId !== input.almanac.championFranchiseId
    ) {
      return Promise.reject(new Error('the run and almanac must name the same champion'));
    }
    if (input.almanac.commandLogDigest !== seasonCommandLogDigest(input.commandLog.entries)) {
      return Promise.reject(new Error('the almanac command-log digest does not reconcile'));
    }
    if (input.run.completion.almanacDigest !== input.almanac.digest) {
      return Promise.reject(new Error('the completion almanac digest does not match the almanac'));
    }
    if (this.active === null || this.active.run.runId !== input.runId) {
      return Promise.reject(new Error('no active run to promote'));
    }
    this.completed = {
      run: input.run,
      almanac: input.almanac,
      commandLog: input.commandLog,
      summaries: [],
      postseasonSummaries: input.postseasonSummaries,
    };
    this.completedIndex = [
      {
        recordId: input.runId,
        runId: input.runId,
        rootSeed: input.run.rootSeed,
        humanFranchiseId: HUMAN,
        championFranchiseId: input.almanac.championFranchiseId,
        almanacDigest: input.almanac.digest,
        commandLogDigest: input.almanac.commandLogDigest,
        completedAtIso: '2026-01-01T00:00:00.000Z',
      },
    ];
    this.active = null;
    return Promise.resolve();
  }
  loadCompletedSeason(runId: string): Promise<SeasonCompletedSeason | null> {
    if (this.completed === null || this.completed.run.runId !== runId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.completed);
  }
  listCompletedSeasonRuns(): Promise<SeasonCompletedRunIndexEntry[]> {
    return Promise.resolve([...this.completedIndex]);
  }
  deleteCompletedSeason(): Promise<void> {
    this.completed = null;
    this.completedIndex = [];
    return Promise.resolve();
  }
  buildReplayExport(): Promise<null> {
    return Promise.resolve(null);
  }
  loadBlockSummaries(): Promise<never[]> {
    return Promise.resolve([]);
  }
  loadRetainedDetails(): Promise<never[]> {
    return Promise.resolve([]);
  }
  loadBlockHistory(): Promise<never[]> {
    return Promise.resolve([]);
  }
  commitSeasonBlock(): Promise<void> {
    return Promise.resolve();
  }
  promoteSeasonDraftToRun(): Promise<void> {
    return Promise.resolve();
  }
  clearSeasonRun(): Promise<void> {
    return Promise.resolve();
  }
  forceClearActiveSeasonRun(): Promise<void> {
    this.active = null;
    return Promise.resolve();
  }
  savePendingBlock(): Promise<void> {
    return Promise.resolve();
  }
  loadPendingBlock(): Promise<null> {
    return Promise.resolve(null);
  }
  discardPendingBlock(): Promise<void> {
    return Promise.resolve();
  }
  applySeasonRunCommand(): Promise<void> {
    return Promise.resolve();
  }
  loadSeasonRunPlayerSlice(): Promise<null> {
    return Promise.resolve(null);
  }
  upsertSeasonRunPlayerSlice(): Promise<void> {
    return Promise.resolve();
  }
}
interface RunnerFixture {
  repo: FakePostseasonRepository;
  runner: SeasonPostseasonRunner;
  catalog: ReturnType<typeof catalogOf>;
  profile: ReturnType<typeof buildEraSimulationProfile>;
  effects: SeasonEffectsState;
  resolver: SeasonPostseasonGameResolver;
}
function makeRunner(
  repo: FakePostseasonRepository,
  catalog: SeasonDraftCatalog,
  profile: ReturnType<typeof buildEraSimulationProfile>,
  resolver: SeasonPostseasonGameResolver,
): SeasonPostseasonRunner {
  return createSeasonPostseasonRunner({
    repository: repo,
    artifacts: () =>
      Promise.resolve({
        catalogUrl: 'https://example.test/season/draft-catalog.json',
        catalogHash: '0'.repeat(64),
        profileUrl: 'https://example.test/season/era-sim.json',
        profileHash: '0'.repeat(64),
      }),
    simulate: createSeasonPostseasonEngineSimulator({ catalog, profile, resolver }),
  });
}
async function startPostseason(
  repo: FakePostseasonRepository,
  run: SeasonRun,
  fixture: Pick<RunnerFixture, 'catalog' | 'profile' | 'effects' | 'resolver'>,
): Promise<SeasonRun> {
  const command = commandOf(run, 'start-postseason', 'xt-start-1');
  const output = handleSeasonRunCommand(
    command,
    contextOf(run, fixture.effects, fixture.catalog, fixture.profile, fixture.resolver),
  );
  const envelope = output.result;
  if (envelope.command !== 'start-postseason' || envelope.result.status !== 'accepted') {
    throw new Error(`start rejected: ${JSON.stringify(envelope)}`);
  }
  await repo.commitPostseasonAdvancement({
    runId: output.run.runId,
    run: output.run,
    summaries: [],
    command,
    preStateRevision: command.expectedStateRevision,
    preStateDigest: command.expectedStateDigest,
    resultDigest: seasonDigestHex(
      canonicalJson({ commandId: command.commandId, gameIds: [], summaryDigests: [] }),
    ),
    relatedGameIds: [],
    transactionIds: [],
  });
  return output.run;
}
async function advanceUntilEliminated(
  repo: FakePostseasonRepository,
  run: SeasonRun,
  fixture: Pick<RunnerFixture, 'catalog' | 'profile' | 'effects' | 'resolver'>,
): Promise<SeasonRun> {
  let current = run;
  let guard = 0;
  while (!seasonPostseasonHumanEliminated(current.postseason, HUMAN) && guard < 40) {
    guard += 1;
    const decision = seasonPostseasonNextGame(current.postseason);
    if (decision.kind !== 'game') throw new Error(`unexpected decision: ${decision.kind}`);
    const command = commandOf(current, 'advance-postseason', `xt-elim-${String(guard)}`, {
      targetGameId: decision.gameId,
    });
    const output = handleSeasonRunCommand(
      command,
      contextOf(current, fixture.effects, fixture.catalog, fixture.profile, fixture.resolver),
    );
    const envelope = output.result;
    if (envelope.command !== 'advance-postseason' || envelope.result.status !== 'accepted') {
      throw new Error(`advance rejected: ${JSON.stringify(envelope)}`);
    }
    const summaries = output.postseasonSummaries ?? [];
    await repo.commitPostseasonAdvancement({
      runId: current.runId,
      run: output.run,
      summaries,
      command,
      preStateRevision: command.expectedStateRevision,
      preStateDigest: command.expectedStateDigest,
      resultDigest: seasonDigestHex(
        canonicalJson({
          commandId: command.commandId,
          gameIds: [...envelope.result.advancedGameIds].sort(),
          summaryDigests: summaries.map((summary) => summary.resultDigest).sort(),
        }),
      ),
      relatedGameIds: [...envelope.result.advancedGameIds],
      transactionIds: [],
    });
    current = output.run;
  }
  if (!seasonPostseasonHumanEliminated(current.postseason, HUMAN)) {
    throw new Error('the human was not eliminated by the setup loop');
  }
  return current;
}
function collectUntil(
  runner: SeasonPostseasonRunner,
  terminal: SeasonPostseasonEvent['type'],
): Promise<SeasonPostseasonEvent[]> {
  const events: SeasonPostseasonEvent[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(
        new Error(`timed out waiting for ${terminal}; got ${events.map((e) => e.type).join(', ')}`),
      );
    }, 20000);
    const unsubscribe = runner.subscribe((event) => {
      events.push(event);
      if (event.type === terminal) {
        clearTimeout(timer);
        unsubscribe();
        resolve(events);
      }
    });
  });
}
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
function setActiveRun(repo: FakePostseasonRepository, run: SeasonRun): void {
  const current = repo.active;
  if (current === null) throw new Error('no active snapshot to replace');
  repo.active = { ...current, run };
}
describe('season postseason runner (M2.6 orchestration)', () => {
  let fixture: RunnerFixture;
  beforeEach(() => {
    const run = runAtPostseasonBoundary();
    const catalog = catalogOf(run);
    const profile = buildEraSimulationProfile();
    const effects = zeroEffects(run);
    const resolver = humanLosesResolver();
    const repo = new FakePostseasonRepository();
    repo.active = {
      run,
      summaries: [],
      retainedDetails: [],
      acceptedBlocks: [],
      effects,
    };
    const runner = makeRunner(repo, catalog, profile, resolver);
    fixture = { repo, runner, catalog, profile, effects, resolver };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('advances one game per atomic commit until a human rotation decision', async () => {
    const { repo, runner } = fixture;
    const started = await startPostseason(repo, runAtPostseasonBoundary(), fixture);
    setActiveRun(repo, withHumanStarterInjury(started));
    const done = collectUntil(runner, 'complete');
    runner.advancePostseason({
      runId: started.runId,
      commandId: commandIdSchema.parse('adv-session-1'),
      humanFranchiseId: HUMAN,
    });
    const terminal = await done;
    const committed = terminal.filter((event) => event.type === 'committed');
    expect(committed.length).toBe(3);
    for (const event of committed) {
      expect(event.gameIds).toHaveLength(1);
    }
    expect(terminal.some((event) => event.type === 'started')).toBe(true);
    expect(terminal.some((event) => event.type === 'error')).toBe(false);
    const complete = terminal[terminal.length - 1];
    expect(complete?.type).toBe('complete');
    if (complete?.type !== 'complete') return;
    expect(complete.nextDecision).toBe('rotation');
    expect(complete.nextGameId).toBe('pi-west-seven-eight');
    expect(complete.promoted).toBe(false);
    expect(complete.snapshot?.run.postseason.playIn.west.ranking).not.toBeNull();
    expect(repo.active?.run.stateRevision).toBe(complete.snapshot?.run.stateRevision);
    for (const summary of repo.summaries) {
      expect(() => seasonPostseasonSummarySchema.parse(summary)).not.toThrow();
    }
  });
  it('emits progress events in order around each commit', async () => {
    const { repo, runner } = fixture;
    const started = await startPostseason(repo, runAtPostseasonBoundary(), fixture);
    const events: SeasonPostseasonEvent[] = [];
    const unsub = runner.subscribe((event) => events.push(event));
    const done = collectUntil(runner, 'complete');
    runner.advancePostseason({
      runId: started.runId,
      commandId: commandIdSchema.parse('adv-session-2'),
      humanFranchiseId: HUMAN,
    });
    await done;
    unsub();
    const types = events.map((event) => event.type);
    expect(types[0]).toBe('started');
    expect(types[types.length - 1]).toBe('complete');
    const firstCommitted = types.indexOf('committed');
    const lastCommitted = types.lastIndexOf('committed');
    expect(firstCommitted).toBeGreaterThanOrEqual(1);
    expect(lastCommitted).toBeLessThan(types.length - 1);
    const progressed = events.filter((event) => event.type === 'progress');
    expect(progressed.length).toBeGreaterThanOrEqual(1);
    const committed = events.filter((event) => event.type === 'committed');
    expect(committed.length).toBe(types.filter((type) => type === 'committed').length);
  });
  it('cancels between games and retains committed chunks', async () => {
    const { repo, runner } = fixture;
    const started = await startPostseason(repo, runAtPostseasonBoundary(), fixture);
    const events: SeasonPostseasonEvent[] = [];
    const unsub = runner.subscribe((event) => events.push(event));
    const requestId = runner.advancePostseason({
      runId: started.runId,
      commandId: commandIdSchema.parse('adv-session-cancel'),
      humanFranchiseId: HUMAN,
    });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve();
      }, 15000);
      const unsubscribe = runner.subscribe((event) => {
        if (event.type === 'committed') {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });
    });
    const committedBefore = repo.commandIds.size;
    runner.cancel(requestId);
    await flush();
    for (let i = 0; i < 20; i += 1) {
      await flush();
    }
    unsub();
    expect(events.some((event) => event.type === 'cancelled')).toBe(true);
    expect(repo.commandIds.size).toBe(committedBefore);
    expect(repo.summaries.length).toBe(1);
    expect(events.filter((event) => event.type === 'complete')).toHaveLength(0);
  });
  it('cancels mid-chunk and discards the uncommitted chunk', async () => {
    const { repo, runner } = fixture;
    const started = await startPostseason(repo, runAtPostseasonBoundary(), fixture);
    const eliminated = await advanceUntilEliminated(repo, started, fixture);
    setActiveRun(repo, eliminated);
    const committedBefore = repo.commandIds.size;
    const events: SeasonPostseasonEvent[] = [];
    const unsub = runner.subscribe((event) => events.push(event));
    const requestId = runner.fastForwardPostseason({
      runId: eliminated.runId,
      commandId: commandIdSchema.parse('ff-cancel-chunk'),
      humanFranchiseId: HUMAN,
    });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve();
      }, 15000);
      const unsubscribe = runner.subscribe((event) => {
        if (event.type === 'started') {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });
    });
    runner.cancel(requestId);
    await flush();
    for (let i = 0; i < 30; i += 1) {
      await flush();
    }
    unsub();
    expect(events.some((event) => event.type === 'cancelled')).toBe(true);
    expect(repo.commandIds.size).toBe(committedBefore);
    expect(events.some((event) => event.type === 'complete')).toBe(false);
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });
  it('retries idempotently when the first command id was already committed', async () => {
    const { repo, runner } = fixture;
    const started = await startPostseason(repo, runAtPostseasonBoundary(), fixture);
    const firstGame = seasonPostseasonNextGame(started.postseason);
    if (firstGame.kind !== 'game') throw new Error('expected a first game');
    const first = commandOf(started, 'advance-postseason', 'adv-session-retry', {
      targetGameId: firstGame.gameId,
    });
    const output = handleSeasonRunCommand(
      first,
      contextOf(started, fixture.effects, fixture.catalog, fixture.profile, fixture.resolver),
    );
    const envelope = output.result;
    if (envelope.command !== 'advance-postseason' || envelope.result.status !== 'accepted') {
      throw new Error(`setup advance rejected: ${JSON.stringify(envelope)}`);
    }
    const summaries = output.postseasonSummaries ?? [];
    await repo.commitPostseasonAdvancement({
      runId: started.runId,
      run: output.run,
      summaries,
      command: first,
      preStateRevision: first.expectedStateRevision,
      preStateDigest: first.expectedStateDigest,
      resultDigest: seasonDigestHex(
        canonicalJson({
          commandId: first.commandId,
          gameIds: [...envelope.result.advancedGameIds].sort(),
          summaryDigests: summaries.map((summary) => summary.resultDigest).sort(),
        }),
      ),
      relatedGameIds: [...envelope.result.advancedGameIds],
      transactionIds: [],
    });
    const done = collectUntil(runner, 'complete');
    runner.advancePostseason({
      runId: started.runId,
      commandId: commandIdSchema.parse('adv-session-retry'),
      humanFranchiseId: HUMAN,
    });
    const terminal = await done;
    expect(terminal.some((event) => event.type === 'error')).toBe(false);
    const committed = terminal.filter((event) => event.type === 'committed');
    expect(committed.length).toBeGreaterThanOrEqual(2);
    const complete = terminal[terminal.length - 1];
    expect(complete?.type).toBe('complete');
    if (complete?.type !== 'complete') return;
    expect(complete.nextDecision).toBe('rotation');
    expect(complete.nextGameId).toBe('pi-west-seven-eight');
  });
  it('stops with a typed error when the run moved (stale-state race)', async () => {
    const { repo, runner } = fixture;
    const started = await startPostseason(repo, runAtPostseasonBoundary(), fixture);
    const events: SeasonPostseasonEvent[] = [];
    const unsub = runner.subscribe((event) => events.push(event));
    const done = collectUntil(runner, 'error');
    runner.advancePostseason({
      runId: started.runId,
      commandId: commandIdSchema.parse('adv-session-stale'),
      humanFranchiseId: HUMAN,
    });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve();
      }, 15000);
      const unsubscribe = runner.subscribe((event) => {
        if (event.type === 'committed') {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });
    });
    repo.failNextCommitWith = new SeasonRunCommandStaleStateError('adv-session-stale', 0, 5);
    await done;
    unsub();
    const error = events.find((event) => event.type === 'error');
    expect(error?.type).toBe('error');
    if (error?.type !== 'error') return;
    expect(error.code).toBe('internal');
    expect(error.message).toContain('run moved');
    expect(repo.commandIds.size).toBe(2);
    expect(repo.summaries.length).toBe(1);
  });
  it('stops when the active run was replaced (cross-tab mutation)', async () => {
    const { repo, runner } = fixture;
    const started = await startPostseason(repo, runAtPostseasonBoundary(), fixture);
    const events: SeasonPostseasonEvent[] = [];
    const unsub = runner.subscribe((event) => events.push(event));
    const done = collectUntil(runner, 'error');
    runner.advancePostseason({
      runId: started.runId,
      commandId: commandIdSchema.parse('adv-session-xtab'),
      humanFranchiseId: HUMAN,
    });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve();
      }, 15000);
      const unsubscribe = runner.subscribe((event) => {
        if (event.type === 'committed') {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });
    });
    repo.failNextCommitWith = new SeasonRunCommandRunMismatchError('other-run');
    await done;
    unsub();
    const error = events.find((event) => event.type === 'error');
    expect(error?.type).toBe('error');
    if (error?.type !== 'error') return;
    expect(error.message).toContain('run moved');
  });
  it('resumes from the accepted state after a reload between games', async () => {
    const { repo } = fixture;
    const started = await startPostseason(repo, runAtPostseasonBoundary(), fixture);
    const first = makeRunner(repo, fixture.catalog, fixture.profile, fixture.resolver);
    const done1 = collectUntil(first, 'committed');
    first.advancePostseason({
      runId: started.runId,
      commandId: commandIdSchema.parse('adv-session-reload-1'),
      humanFranchiseId: HUMAN,
    });
    await done1;
    first.terminate();
    const second = makeRunner(repo, fixture.catalog, fixture.profile, fixture.resolver);
    const done2 = collectUntil(second, 'complete');
    second.advancePostseason({
      runId: started.runId,
      commandId: commandIdSchema.parse('adv-session-reload-2'),
      humanFranchiseId: HUMAN,
    });
    const terminal = await done2;
    second.terminate();
    const committed = terminal.filter((event) => event.type === 'committed');
    expect(committed.length).toBeGreaterThanOrEqual(1);
    const complete = terminal[terminal.length - 1];
    expect(complete?.type).toBe('complete');
    if (complete?.type !== 'complete') return;
    expect(complete.nextDecision).toBe('rotation');
    expect(repo.summaries[0]?.gameId).toBe('pi-east-seven-eight');
    expect(
      repo.summaries.filter((summary) => summary.gameId === 'pi-east-seven-eight'),
    ).toHaveLength(1);
  });
  it('fast-forwards an eliminated run in chunks of at most eight games per commit', async () => {
    const { repo, runner } = fixture;
    const started = await startPostseason(repo, runAtPostseasonBoundary(), fixture);
    const eliminated = await advanceUntilEliminated(repo, started, fixture);
    setActiveRun(repo, eliminated);
    const committedBefore = repo.commandIds.size;
    const done = collectUntil(runner, 'complete');
    runner.fastForwardPostseason({
      runId: eliminated.runId,
      commandId: commandIdSchema.parse('ff-session-1'),
      humanFranchiseId: HUMAN,
    });
    const events = await done;
    const committed = events.filter((event) => event.type === 'committed');
    expect(committed.length).toBeGreaterThanOrEqual(1);
    for (const event of committed) {
      expect(event.gameIds.length).toBeLessThanOrEqual(SEASON_POSTSEASON_CHUNK_MAX_GAMES);
      expect(event.gameIds.length).toBeGreaterThan(0);
    }
    const complete = events[events.length - 1];
    expect(complete?.type).toBe('complete');
    if (complete?.type !== 'complete') return;
    expect(complete.stage).toBe('completed');
    expect(complete.promoted).toBe(true);
    expect(complete.snapshot).toBeNull();
    expect(repo.active).toBeNull();
    expect(repo.commandIds.size).toBeGreaterThan(committedBefore);
  });
  it('promotes the champion atomically with reconciling almanac digests', async () => {
    const { repo, runner } = fixture;
    const started = await startPostseason(repo, runAtPostseasonBoundary(), fixture);
    const eliminated = await advanceUntilEliminated(repo, started, fixture);
    setActiveRun(repo, eliminated);
    const done = collectUntil(runner, 'complete');
    runner.fastForwardPostseason({
      runId: eliminated.runId,
      commandId: commandIdSchema.parse('ff-promote'),
      humanFranchiseId: HUMAN,
    });
    const events = await done;
    const complete = events[events.length - 1];
    expect(complete?.type).toBe('complete');
    if (complete?.type !== 'complete') return;
    expect(complete.promoted).toBe(true);
    expect(repo.active).toBeNull();
    expect(await repo.loadActiveRunIndex()).toBeNull();
    const completed = await repo.loadCompletedSeason(eliminated.runId);
    expect(completed).not.toBeNull();
    if (completed === null) return;
    expect(completed.run.stage).toBe('completed');
    expect(completed.run.completion?.championFranchiseId).toBe(
      completed.almanac.championFranchiseId,
    );
    expect(completed.run.completion?.championFranchiseId).toBe(
      completed.run.postseason.championFranchiseId,
    );
    const facts = {
      schemaVersion: 1 as const,
      almanacVersion: 'almanac-v1' as const,
      runId: completed.almanac.runId,
      rootSeed: completed.almanac.rootSeed,
      championFranchiseId: completed.almanac.championFranchiseId,
      postseasonDigest: completed.almanac.postseasonDigest,
      commandLogDigest: completed.almanac.commandLogDigest,
      awardsDigest: completed.almanac.awardsDigest,
      tradeGradesDigest: completed.almanac.tradeGradesDigest,
      digest: completed.almanac.digest,
    };
    expect(seasonAlmanacDigest(facts)).toBe(completed.almanac.digest);
    expect(completed.almanac.commandLogDigest).toBe(
      seasonCommandLogDigest(completed.commandLog.entries),
    );
    expect(completed.almanac.postseasonDigest).toBe(
      seasonDigestHex(canonicalJson(completed.run.postseason)),
    );
    expect(completed.almanac.awardsDigest).toBe(
      seasonDigestHex(canonicalJson(completed.run.awards)),
    );
    expect(completed.commandLog.entries.length).toBeGreaterThan(1);
    for (let index = 0; index < completed.commandLog.entries.length; index += 1) {
      expect(completed.commandLog.entries[index]?.ordinal).toBe(index);
    }
    expect(
      (await repo.listCompletedSeasonRuns()).some((entry) => entry.runId === eliminated.runId),
    ).toBe(true);
    for (const summary of repo.summaries) {
      expect(() => seasonPostseasonSummarySchema.parse(summary)).not.toThrow();
    }
  });
  it('promoteSeasonChampion builds the almanac exactly like the cross-track flow', async () => {
    const { repo } = fixture;
    const started = await startPostseason(repo, runAtPostseasonBoundary(), fixture);
    const eliminated = await advanceUntilEliminated(repo, started, fixture);
    let current = eliminated;
    let guard = 0;
    while (current.stage !== 'completed' && guard < 200) {
      guard += 1;
      const decision = seasonPostseasonNextGame(current.postseason);
      if (decision.kind !== 'game') throw new Error(`unexpected decision: ${decision.kind}`);
      const command = commandOf(current, 'advance-postseason', `xt-promote-${String(guard)}`, {
        targetGameId: decision.gameId,
      });
      const output = handleSeasonRunCommand(
        command,
        contextOf(current, fixture.effects, fixture.catalog, fixture.profile, fixture.resolver),
      );
      const envelope = output.result;
      if (envelope.command !== 'advance-postseason' || envelope.result.status !== 'accepted') {
        throw new Error(`advance rejected: ${JSON.stringify(envelope)}`);
      }
      const summaries = output.postseasonSummaries ?? [];
      await repo.commitPostseasonAdvancement({
        runId: current.runId,
        run: output.run,
        summaries,
        command,
        preStateRevision: command.expectedStateRevision,
        preStateDigest: command.expectedStateDigest,
        resultDigest: seasonDigestHex(
          canonicalJson({
            commandId: command.commandId,
            gameIds: [...envelope.result.advancedGameIds].sort(),
            summaryDigests: summaries.map((summary) => summary.resultDigest).sort(),
          }),
        ),
        relatedGameIds: [...envelope.result.advancedGameIds],
        transactionIds: [],
      });
      current = output.run;
    }
    expect(current.stage).toBe('completed');
    const committedSnapshot = repo.active;
    if (committedSnapshot === null) throw new Error('expected a committed snapshot');
    const almanac = await promoteSeasonChampion(repo, current, committedSnapshot);
    expect(almanac.runId).toBe(current.runId);
    expect(almanac.rootSeed).toBe(current.rootSeed);
    expect(almanac.championFranchiseId).toBe(current.postseason.championFranchiseId);
    expect(almanac.postseasonDigest).toBe(seasonDigestHex(canonicalJson(current.postseason)));
    expect(almanac.commandLogDigest).toBe(seasonCommandLogDigest(repo.logEntries));
    expect(repo.completed?.run.completion?.almanacDigest).toBe(almanac.digest);
    expect(repo.completed?.run.stateDigest).toBe(current.stateDigest);
    expect(await repo.loadActiveRun()).toBeNull();
  });
  it('rejects a fast-forward of a human with remaining postseason decisions', async () => {
    const { repo, runner } = fixture;
    const started = await startPostseason(repo, runAtPostseasonBoundary(), fixture);
    const done = collectUntil(runner, 'error');
    runner.fastForwardPostseason({
      runId: started.runId,
      commandId: commandIdSchema.parse('ff-active-human'),
      humanFranchiseId: HUMAN,
    });
    const terminal = await done;
    const error = terminal.find((event) => event.type === 'error');
    expect(error?.type).toBe('error');
    if (error?.type !== 'error') return;
    expect(error.message).toContain('still has postseason decisions');
    expect(repo.commandIds.size).toBe(1);
  });
  it('routes worker messages through the frozen wire and drops invalid envelopes', async () => {
    const { repo } = fixture;
    const started = await startPostseason(repo, runAtPostseasonBoundary(), fixture);
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    const runner = createSeasonPostseasonRunner({
      repository: repo,
      artifacts: () =>
        Promise.resolve({
          catalogUrl: 'https://example.test/season/draft-catalog.json',
          catalogHash: '0'.repeat(64),
          profileUrl: 'https://example.test/season/era-sim.json',
          profileHash: '0'.repeat(64),
        }),
      workerUrl: 'fake-season-postseason-worker.ts',
    });
    try {
      const events: SeasonPostseasonEvent[] = [];
      const unsub = runner.subscribe((event) => events.push(event));
      const requestId = runner.advancePostseason({
        runId: started.runId,
        commandId: commandIdSchema.parse('adv-wire-1'),
        humanFranchiseId: HUMAN,
      });
      await flush();
      for (let i = 0; i < 10; i += 1) await flush();
      const worker = FakeWorker.instances[0];
      expect(worker).toBeDefined();
      const raw = worker?.posted[0];
      expect(raw).toBeDefined();
      const request = seasonPostseasonWorkerStartRequestSchema.parse(raw);
      expect(request.schemaVersion).toBe(1);
      expect(request.type).toBe('season-postseason-start');
      expect(request.runId).toBe(started.runId);
      expect(request.commandId).toBe('adv-wire-1');
      worker?.emit({ schemaVersion: 1, type: 'season-block-progress' });
      worker?.emit({ schemaVersion: 5, type: 'season-postseason-complete', requestId });
      await flush();
      expect(events.some((event) => event.type === 'progress')).toBe(false);
      runner.cancel(requestId);
      await flush();
      const cancelRaw = worker?.posted[1];
      expect(cancelRaw).toBeDefined();
      const cancel = seasonPostseasonWorkerCancelRequestSchema.parse(cancelRaw);
      expect(cancel.schemaVersion).toBe(1);
      expect(cancel.requestId).toBe(request.requestId);
      expect(events.some((event) => event.type === 'cancelled')).toBe(true);
      unsub();
    } finally {
      runner.terminate();
      vi.unstubAllGlobals();
    }
  });
});
class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: unknown[] = [];
  private listeners: Array<(event: MessageEvent<unknown>) => void> = [];
  constructor(public url: string) {
    FakeWorker.instances.push(this);
  }
  postMessage(data: unknown): void {
    this.posted.push(data);
  }
  addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void {
    if (type === 'message') this.listeners.push(listener);
  }
  removeEventListener(): void {}
  emit(data: unknown): void {
    for (const listener of [...this.listeners]) listener({ data } as MessageEvent<unknown>);
  }
  terminate(): void {}
}
