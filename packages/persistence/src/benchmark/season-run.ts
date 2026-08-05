import {
  type SeasonBlockRecap,
  type SeasonGameSummary,
  type SeasonLeague,
  type SeasonPlayerAggregate,
  type SeasonRetainedGameDetail,
  type SeasonRoster,
  type SeasonRotation,
  type SeasonRun,
  type SeasonSchedule,
  type SeasonStandings,
  type SeasonTeamAggregate,
} from '@hoop-rush/data-contracts';
import type { SeasonRunEngineSeam } from '../season/engine-seam-types.ts';
import { seasonRunEngineSeam } from '../season/engine-seam.ts';
import { HoopRushDatabase } from '../repositories/dexie.ts';
import { DexieSeasonRunRepository } from '../repositories/season-run-dexie.ts';
import {
  buildFixtureFullSeasonSummaries,
  buildFixtureRecap,
  buildFixtureRetainedDetail,
  buildFixtureRun,
  buildFixtureSchedule,
  buildFixtureStoredDraft,
  buildStubSeasonEngineSeam,
  fixtureSeedFromString,
} from '../testing/season-run-fixture.ts';

/**
 * Storage and timing benchmark for the Season Run persistence layer
 * (spec/2.0/10 M2.3, spec/2.0/12 performance framework). Builds a synthetic
 * full-season dataset — 1,230 compact summaries, 82 retained details, nine
 * accepted blocks — commits it through `commitSeasonBlock` (one transaction
 * per block), reloads it through the validated snapshot path, and reports
 * p95 commit and reload times plus the serialized byte size of every stored
 * row. The engine math is provided through the `SeasonRunEngineSeam`, so the
 * harness measures the repository mechanics with the pure helpers behind it;
 * tests and CI run the stub seam, and the `season benchmark persistence` CLI
 * command runs the production engine seam.
 *
 * Frozen budgets (documented; asserted in the cheap test suite):
 * - commit p95 <= 300 ms per block transaction
 * - reload p95 <= 1,000 ms per full validated load
 * - active-run storage <= 25 MB (serialized rows)
 */
export const SEASON_RUN_BUDGET_COMMIT_P95_MS = 300;
export const SEASON_RUN_BUDGET_RELOAD_P95_MS = 1000;
export const SEASON_RUN_BUDGET_STORAGE_BYTES = 25 * 1024 * 1024;

export interface SeasonRunPersistenceBenchmarkReport {
  dataset: {
    summaries: number;
    retainedDetails: number;
    acceptedBlocks: number;
  };
  commit: {
    samples: number;
    p95Ms: number;
    meanMs: number;
  };
  reload: {
    samples: number;
    p95Ms: number;
    meanMs: number;
  };
  storage: {
    totalBytes: number;
    budgetBytes: number;
    perTable: Record<string, number>;
  };
  budgets: {
    commitP95Ms: number;
    reloadP95Ms: number;
    storageBytes: number;
  };
}

export interface SeasonRunPersistenceBenchmarkOptions {
  /** Full-season commit+reload samples; each commits all nine blocks. */
  samples?: number;
  /** Engine seam; defaults to the production binding. */
  seam?: SeasonRunEngineSeam;
  seed?: string;
  /**
   * Builds the database for one sample. The default creates a fresh
   * `HoopRushDatabase`; fake-indexeddb-based tests pass a wrapper that
   * installs a fresh `IDBFactory` per sample (a shared factory degrades
   * transactions for every database after the first, an artifact of the
   * test substrate, not of the repository).
   */
  createDatabase?: () => HoopRushDatabase;
}

interface BlockDataset {
  blockIndex: number;
  completedRounds: number;
  summaries: SeasonGameSummary[];
  retainedDetails: SeasonRetainedGameDetail[];
  standings: SeasonStandings;
  teamAggregates: SeasonTeamAggregate[];
  playerAggregates: SeasonPlayerAggregate[];
  recap: SeasonBlockRecap;
  rotationDigest: string;
  checkpointDigest: string;
  /** The 30 rotations locked by this block commit. */
  rotations: SeasonRotation[];
}

function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? sorted[sorted.length - 1] ?? 0;
}

function mean(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

function digestOf(seed: string, blockIndex: number): string {
  return fixtureSeedFromString(`${seed}:digest:${String(blockIndex)}`);
}

/** Builds the synthetic full-season dataset and its nine block commits. */
export function buildFullSeasonDataset(input: {
  seed?: string;
  runId?: string;
  seam?: SeasonRunEngineSeam;
}): {
  run: SeasonRun;
  schedule: SeasonSchedule;
  league: SeasonLeague;
  rosters: SeasonRoster[];
  humanFranchiseId: string;
  blocks: BlockDataset[];
} {
  const seed = input.seed ?? fixtureSeedFromString('persistence-benchmark');
  const runId = input.runId ?? 'benchmark-season-run';
  const schedule = buildFixtureSchedule(seed);
  const run = buildFixtureRun({ seed, runId, schedule });
  const { league, rosters } = run;
  const humanFranchiseId =
    league.teams.find((team) => team.control === 'human')?.franchiseId ?? 'lakers';
  const allSummaries = buildFixtureFullSeasonSummaries({ runId, schedule, rosters });
  const allDetails = allSummaries
    .filter(
      (summary) =>
        summary.homeFranchiseId === humanFranchiseId ||
        summary.awayFranchiseId === humanFranchiseId,
    )
    .map((summary) => buildFixtureRetainedDetail({ runId, summary, rosters }));

  const byBlock = (blockIndex: number) => {
    const fromRound = blockIndex * 10 + 1;
    const toRound = blockIndex === 8 ? 82 : (blockIndex + 1) * 10;
    const summaries = allSummaries.filter(
      (summary) => summary.round >= fromRound && summary.round <= toRound,
    );
    return { blockIndex, fromRound, toRound, summaries };
  };

  const blocks: BlockDataset[] = [];
  let standings: SeasonStandings = {
    schemaVersion: 1,
    standingsVersion: run.versions.standingsVersion,
    rows: league.teams.map((team) => ({
      franchiseId: team.franchiseId,
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
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
      headToHead: league.teams
        .filter((other) => other.franchiseId !== team.franchiseId)
        .map((other) => ({ franchiseId: other.franchiseId, wins: 0, losses: 0 })),
    })),
  };
  const seam = input.seam ?? seasonRunEngineSeam;
  let teamAggregates: SeasonTeamAggregate[] = [];
  let playerAggregates: SeasonPlayerAggregate[] = [];
  let cumulativeCount = 0;
  for (let blockIndex = 0; blockIndex < 9; blockIndex += 1) {
    const { summaries } = byBlock(blockIndex);
    cumulativeCount += summaries.length;
    const completedRounds = blockIndex === 8 ? 82 : (blockIndex + 1) * 10;
    // Standings and aggregates at this boundary are CUMULATIVE over every
    // game played so far, so the reload audit (which folds the complete
    // stored summary set) reconciles exactly.
    const cumulativeSummaries = allSummaries.slice(0, cumulativeCount);
    const playedGames = seam
      .reconstructSeasonGames(schedule, cumulativeSummaries)
      .filter((game) => game.status !== 'scheduled');
    standings = seam.reduceSeasonStandings(league, playedGames);
    teamAggregates = seam.foldSeasonTeamAggregates(league, cumulativeSummaries);
    playerAggregates = seam.foldSeasonPlayerAggregates(rosters, cumulativeSummaries);
    blocks.push({
      blockIndex,
      completedRounds,
      summaries,
      retainedDetails: allDetails.filter(
        (detail) => blockIndexOfRound(detail.round) === blockIndex,
      ),
      standings,
      teamAggregates,
      playerAggregates,
      recap: buildFixtureRecap({ runId, blockIndex, completedRounds }),
      rotationDigest: seam.seasonRotationSetDigest(run.rotations),
      checkpointDigest: digestOf(seed, blockIndex),
      rotations: run.rotations,
    });
  }
  return { run, schedule, league, rosters, humanFranchiseId, blocks };
}

function blockIndexOfRound(round: number): number {
  return Math.min(8, Math.floor((round - 1) / 10));
}

async function storedBytes(
  db: HoopRushDatabase,
): Promise<{ total: number; perTable: Record<string, number> }> {
  const encoder = new TextEncoder();
  const perTable: Record<string, number> = {};
  const tables: Array<[Promise<unknown[]>, string]> = [
    [db.seasonRuns.toArray(), 'seasonRuns'],
    [db.seasonRunSummaries.toArray(), 'seasonRunSummaries'],
    [db.seasonRunDetails.toArray(), 'seasonRunDetails'],
    [db.seasonRunBlocks.toArray(), 'seasonRunBlocks'],
    [db.seasonRunIndex.toArray(), 'seasonRunIndex'],
  ];
  let total = 0;
  for (const [rowsPromise, name] of tables) {
    const rows = await rowsPromise;
    let bytes = 0;
    for (const row of rows) {
      bytes += encoder.encode(JSON.stringify(row)).byteLength;
    }
    perTable[name] = bytes;
    total += bytes;
  }
  return { total, perTable };
}

/**
 * Runs the full-season persistence benchmark. Each sample creates one fresh
 * database, promotes a synthetic draft, commits all nine blocks (timing every
 * transaction), reloads the validated snapshot (timed), then the final
 * sample's stored rows are measured in bytes.
 */
export async function benchmarkSeasonRunPersistence(
  options: SeasonRunPersistenceBenchmarkOptions = {},
): Promise<SeasonRunPersistenceBenchmarkReport> {
  const samples = options.samples ?? 3;
  const seam = options.seam ?? seasonRunEngineSeam;
  const { run, schedule, blocks } = buildFullSeasonDataset({
    seed: options.seed,
    seam,
  });

  const commitTimes: number[] = [];
  const reloadTimes: number[] = [];
  let storage: { total: number; perTable: Record<string, number> } = { total: 0, perTable: {} };

  for (let sample = 0; sample < samples; sample += 1) {
    // `HoopRushDatabase` owns the fixed 'hoop-rush-saves' name; samples are
    // isolated by the database factory (tests install a fresh fake-indexeddb
    // factory per sample; the CLI runs one measurement per process).
    const db = (options.createDatabase ?? (() => new HoopRushDatabase()))();
    const repository = new DexieSeasonRunRepository(db, { schedule, seam });
    await repository.promoteSeasonDraftToRun(buildFixtureStoredDraft(run), run);
    for (const block of blocks) {
      const started = performance.now();
      await repository.commitSeasonBlock({
        runId: run.runId,
        revision: block.blockIndex + 1,
        commandId: `command-${String(block.blockIndex)}`,
        rotationDigest: block.rotationDigest,
        checkpointDigest: block.checkpointDigest,
        completedRounds: block.completedRounds,
        standings: block.standings,
        teamAggregates: block.teamAggregates,
        playerAggregates: block.playerAggregates,
        summaries: block.summaries,
        retainedDetails: block.retainedDetails,
        recap: block.recap,
        rotations: block.rotations,
      });
      commitTimes.push(performance.now() - started);
    }
    const reloadStarted = performance.now();
    const snapshot = await repository.loadActiveRun();
    reloadTimes.push(performance.now() - reloadStarted);
    if (snapshot === null) {
      throw new Error('benchmark: reload returned no active run');
    }
    if (snapshot.run.games.length !== 1230) {
      throw new Error(`benchmark: reconstructed ${String(snapshot.run.games.length)} games`);
    }
    if (sample === samples - 1) {
      storage = await storedBytes(db);
    }
    db.close();
  }

  return {
    dataset: {
      summaries: blocks.reduce((sum, block) => sum + block.summaries.length, 0),
      retainedDetails: blocks.reduce((sum, block) => sum + block.retainedDetails.length, 0),
      acceptedBlocks: blocks.length,
    },
    commit: {
      samples: commitTimes.length,
      p95Ms: percentile(commitTimes, 95),
      meanMs: mean(commitTimes),
    },
    reload: {
      samples: reloadTimes.length,
      p95Ms: percentile(reloadTimes, 95),
      meanMs: mean(reloadTimes),
    },
    storage: {
      totalBytes: storage.total,
      budgetBytes: SEASON_RUN_BUDGET_STORAGE_BYTES,
      perTable: storage.perTable,
    },
    budgets: {
      commitP95Ms: SEASON_RUN_BUDGET_COMMIT_P95_MS,
      reloadP95Ms: SEASON_RUN_BUDGET_RELOAD_P95_MS,
      storageBytes: SEASON_RUN_BUDGET_STORAGE_BYTES,
    },
  };
}

/** Builds the benchmark dataset using the stub seam (test/CI use). */
export function buildStubSeamBenchmarkDataset(): ReturnType<typeof buildFullSeasonDataset> {
  return buildFullSeasonDataset({ seam: buildStubSeasonEngineSeam() });
}

/** Number of summaries in one regular block (150) and the final block (30). */
export const SEASON_SUMMARIES_PER_BLOCK = 150;
export const SEASON_SUMMARIES_FINAL_BLOCK = 30;
