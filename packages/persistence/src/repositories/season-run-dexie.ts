import {
  blockIndexForRound,
  humanTeamOf,
  seasonAcceptedBlockSchema,
  seasonAlmanacSchema,
  seasonCheckpointDigestSchema,
  seasonCommandLogDigest,
  seasonCommandLogEntrySchema,
  seasonCommandLogSchema,
  seasonPostseasonSummarySchema,
  seasonReplayExportDigest,
  seasonReplayExportSchema,
  seasonRunCommandSchema,
  seasonRunSchema,
  seasonScheduleSchema,
  SEASON_COMMAND_LOG_VERSION,
  SEASON_OBJECTIVE_CATALOG,
  SEASON_OBJECTIVE_VERSION,
  seasonObjectiveStateSchema,
  SEASON_HEALTH_VERSION,
  seasonHealthStateSchema,
  SEASON_RUN_SAVE_SCHEMA_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  type SeasonAcceptedBlock,
  type SeasonActiveRunIndex,
  type SeasonCommandLog,
  type SeasonGameSummary,
  type SeasonInvalidRosterInterruption,
  type SeasonPendingBlockCandidate,
  type SeasonPostseasonSummary,
  type SeasonReplayExport,
  type SeasonRetainedGameDetail,
  type SeasonRun,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import {
  SEASON_RUN_RECORD_ID,
  seasonRunCheckpointDeltaSchema,
  seasonRunCursorSchema,
  seasonRunPlayerSliceEntrySchema,
  storedSeasonAcceptedBlockRowSchema,
  storedSeasonActiveRunIndexSchema,
  storedSeasonAlmanacRowSchema,
  storedSeasonCommandLogRowSchema,
  storedSeasonCompletedIndexSchema,
  storedSeasonCompletedRunRowSchema,
  storedSeasonDetailRowSchema,
  storedSeasonPendingBlockRowSchema,
  storedSeasonPlayerSliceRowSchema,
  storedSeasonPostseasonDetailRowSchema,
  storedSeasonPostseasonSummaryRowSchema,
  storedSeasonRunRecordSchema,
  storedSeasonSummaryRowSchema,
  seasonCompletedSeasonSchema,
  seasonPostseasonDetailSchema,
  type SeasonCompletedRunIndexEntry,
  type SeasonCompletedSeason,
  type SeasonPostseasonDetail,
  type SeasonRunPlayerSliceEntry,
  type StoredSeasonRunRecord,
} from '../schemas/season-run-record.ts';
import type { Table } from 'dexie';
import {
  SEASON_DRAFT_RECORD_ID,
  storedSeasonDraftSchema,
  type StoredSeasonDraft,
} from '../schemas/season-draft-record.ts';
import type { SeasonRunEngineSeam } from '../season/engine-seam-types.ts';
import { auditSeasonRunState } from '../season/audit.ts';
import { seasonRunEngineSeam } from '../season/engine-seam.ts';
import { HoopRushDatabase } from './dexie.ts';
import {
  SeasonPendingBlockRejectedError,
  SeasonRunCommandDuplicateError,
  SeasonRunCommandRunMismatchError,
  SeasonRunCommandStaleStateError,
  type CommitSeasonBlockInput,
  type SeasonRunCommandApplication,
  type SeasonRunIncompatibleInfo,
  type SeasonRunRepository,
  type SeasonRunSnapshot,
} from './season-run.ts';
import {
  SeasonPostseasonIntegrityError,
  type CommitPostseasonAdvancementInput,
  type PromoteChampionInput,
  type SeasonPostseasonRepository,
} from './season-postseason.ts';

/**
 * Concrete IndexedDB Season Run repository (spec/2.0/07 persistence,
 * spec/2.0/10 M2.3, M2.4, M2.5). The active run lives in the dedicated
 * v6/v7 tables, isolated from the Challenge and Classic stores:
 *
 * - `seasonRuns`          — single checkpoint row (snapshot minus the 1,230
 *   scheduled games, plus cursor facts, standings, aggregates, recap, the
 *   M2.4 effects state, and the M2.5 mutable run state).
 * - `seasonRunSummaries`  — one compact summary per completed league game.
 * - `seasonRunDetails`    — one retained detail per human-team game.
 * - `seasonRunBlocks`     — one accepted block per commit (append-only).
 * - `seasonRunIndex`      — single lightweight active-run index row.
 * - `seasonPendingBlocks` (v7) — one interrupted-block pending candidate per
 *   run, keyed by runId.
 *
 * `commitSeasonBlock` writes everything in ONE Dexie transaction: either
 * every row commits or none does, so no partial block can ever be accepted.
 * Revision regressions, duplicate command ids, and stale expected state facts
 * are rejected inside the transaction, and any pending-block row for the run
 * is deleted with it. Reads validate every record through the stored schemas
 * and run the reconciliation audit; corrupt or half-applied state throws a
 * typed `SeasonRunLoadError`.
 *
 * ## Legacy rows (stored save schemas v1, v2, v3)
 *
 * Pre-v4 rows are detected with a typed `SeasonRunIncompatibleError` and
 * NEVER deleted automatically: they cannot enter the current simulator, the
 * UI shows the explicit "Season rules changed" discard-and-restart screen,
 * and deletion happens only through `clearSeasonRun(runId)` after user
 * confirmation. A row corrupt beyond identification throws `SeasonRunLoadError`.
 *
 * ## Schedule supply
 *
 * The repository never fetches static assets: games are reassembled from the
 * schedule artifact plus the stored summaries via `reconstructSeasonGames`, so
 * reload needs the schedule. Pass it to the constructor or call
 * `loadActiveRunWithSchedule(schedule)`; `loadActiveRun()` throws a typed error
 * when none was supplied.
 */

/** Typed error for reload validation failures; never returns corrupt state. */
export class SeasonRunLoadError extends Error {
  readonly failures: readonly string[];

  constructor(failures: readonly string[], message?: string) {
    super(
      message ??
        `Season Run reload validation failed (${String(failures.length)} failure(s)): ` +
          failures.join('; '),
    );
    this.name = 'SeasonRunLoadError';
    this.failures = failures;
  }
}

/**
 * Every table that holds run-scoped Season Run rows (performance pass).
 * Lifecycle deletions route through `deleteRunRows` inside a transaction over
 * exactly this set, so no teardown can leave orphaned rows.
 */
function SEASON_RUN_SCOPED_TABLES(db: HoopRushDatabase): Table<unknown>[] {
  return [
    db.seasonRuns,
    db.seasonRunSummaries,
    db.seasonRunDetails,
    db.seasonRunBlocks,
    db.seasonRunIndex,
    db.seasonPendingBlocks,
    db.seasonPostseasonSummaries,
    db.seasonPostseasonDetails,
    db.seasonCommandLog,
    db.seasonAlmanacs,
    db.seasonCompletedRuns,
    db.seasonCompletedIndex,
    db.seasonRunPlayerSlices,
  ] as Table<unknown>[];
}

/** True when the raw row carries a saveSchemaVersion outside the current family. */
function isDevelopmentRow(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) return false;
  const version = (row as { saveSchemaVersion?: unknown }).saveSchemaVersion;
  return typeof version === 'number' && version !== SEASON_RUN_SAVE_SCHEMA_VERSION;
}

/**
 * M2.5 typed legacy-run detection (schema-4/schema-5/schema-6 runs under older
 * Season rules). The stored row is preserved byte-for-byte; callers surface
 * the info through the discard-and-restart screen and delete only after the
 * user confirms via `clearSeasonRun(runId)`.
 */
export class SeasonRunIncompatibleError extends Error {
  readonly info: SeasonRunIncompatibleInfo;

  constructor(info: SeasonRunIncompatibleInfo) {
    super(
      `stored Season Run was made under older rules (schema ${String(info.storedRunSchemaVersion)}); ` +
        `it cannot continue and must be discarded explicitly`,
    );
    this.name = 'SeasonRunIncompatibleError';
    this.info = info;
  }
}

/** Type guard for the typed legacy-run error. */
export function isSeasonRunIncompatibleError(error: unknown): error is SeasonRunIncompatibleError {
  return error instanceof SeasonRunIncompatibleError;
}

/** Lenient pre-read of a stored row's identity facts for legacy detection. */
function incompatibleInfoOf(row: unknown): SeasonRunIncompatibleInfo | null {
  if (typeof row !== 'object' || row === null) return null;
  const record = row as {
    saveSchemaVersion?: unknown;
    run?: { runId?: unknown; versions?: { runSchemaVersion?: unknown } };
  };
  const saveVersion = record.saveSchemaVersion;
  if (typeof saveVersion !== 'number' || saveVersion === SEASON_RUN_SAVE_SCHEMA_VERSION) {
    return null;
  }
  const runSchemaVersion =
    typeof record.run?.versions?.runSchemaVersion === 'number'
      ? record.run.versions.runSchemaVersion
      : SEASON_RUN_SCHEMA_VERSION - 1;
  return {
    storedSaveSchemaVersion: SEASON_RUN_SAVE_SCHEMA_VERSION,
    storedRunSchemaVersion: runSchemaVersion,
    runId: typeof record.run?.runId === 'string' ? record.run.runId : 'unknown-legacy-run',
  };
}

interface SeasonRunRepositoryOptions {
  /** Schedule artifact for game reconstruction; required by loadActiveRun(). */
  schedule?: SeasonSchedule;
  /** Audit seam; production binding is the pure engine helpers. */
  seam?: SeasonRunEngineSeam;
}

function byGameId<T extends { gameId: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
}

function byRevision<T extends { revision: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.revision - b.revision);
}

export class DexieSeasonRunRepository implements SeasonRunRepository, SeasonPostseasonRepository {
  private readonly db: HoopRushDatabase;
  private readonly schedule: SeasonSchedule | null;
  private readonly seam: SeasonRunEngineSeam;

  constructor(
    db: HoopRushDatabase = new HoopRushDatabase(),
    options: SeasonRunRepositoryOptions = {},
  ) {
    this.db = db;
    this.schedule = options.schedule ?? null;
    this.seam = options.seam ?? seasonRunEngineSeam;
  }

  async loadActiveRunIndex(): Promise<SeasonActiveRunIndex | null> {
    const row = await this.db.seasonRunIndex.get(SEASON_RUN_RECORD_ID);
    if (row === undefined) return null;
    return storedSeasonActiveRunIndexSchema.parse(row).index;
  }

  async loadActiveRun(): Promise<SeasonRunSnapshot | null> {
    if (this.schedule === null) {
      throw new SeasonRunLoadError(
        [
          'loadActiveRun requires the schedule artifact for game reconstruction; ' +
            'pass it to the DexieSeasonRunRepository constructor or call ' +
            'loadActiveRunWithSchedule(schedule)',
        ],
        'Season Run schedule not supplied',
      );
    }
    return this.loadActiveRunWithSchedule(this.schedule);
  }

  /**
   * Full validated snapshot; resumes at the last accepted boundary. The
   * caller supplies the schedule artifact (the repository cannot fetch static
   * assets); every stored row is validated and the reconciliation audit runs
   * before anything is returned.
   */
  async loadActiveRunWithSchedule(schedule: SeasonSchedule): Promise<SeasonRunSnapshot | null> {
    seasonScheduleSchema.parse(schedule);
    const checkpoint = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (checkpoint === undefined) return null;
    if (isDevelopmentRow(checkpoint)) {
      // Legacy rows are preserved; the caller decides the recovery flow.
      const info = incompatibleInfoOf(checkpoint);
      if (info !== null) {
        throw new SeasonRunIncompatibleError(info);
      }
      throw new SeasonRunLoadError(
        ['stored Season Run checkpoint failed schema validation'],
        'stored Season Run checkpoint is unidentifiable',
      );
    }
    try {
      return await this.loadValidated(checkpoint, schedule);
    } catch (error) {
      if (
        error instanceof SeasonRunLoadError &&
        ((await this.repairLegacyRotationLockDivergence(error.failures)) ||
          (await this.repairLegacyCommittedStateDigest(error.failures)))
      ) {
        const repaired = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
        if (repaired === undefined) {
          throw new SeasonRunLoadError(['the repaired Season Run checkpoint disappeared']);
        }
        // Recovery never bypasses validation: the complete schema parse and
        // reconciliation audit must accept the atomically repaired rows.
        return this.loadValidated(repaired, schedule);
      }
      throw error;
    }
  }

  /**
   * Repairs one known pre-fix corruption signature from rotation edits: the
   * commit stored the submitted rotation set but retained the previous
   * accepted lock/checkpoint identity and a state digest over that old set.
   *
   * Deliberately fail-closed. Runs only when the reload audit reports
   * rotation-lock/state-digest divergence, there is no interrupted candidate,
   * and all three old identity facts agree. The stored rotations are the only
   * recoverable authoritative set, so recovery promotes their digest to the
   * last accepted block and recomputes the state-chain digest.
   */
  private async repairLegacyRotationLockDivergence(failures: readonly string[]): Promise<boolean> {
    const rotationFailure = failures.some((failure) =>
      /^stored rotations digest [0-9a-f]{32} does not match the last accepted lock [0-9a-f]{32}$/.test(
        failure,
      ),
    );
    const stateDigestFailure = failures.includes(
      'stored stateDigest does not recompute over the stored mutable state',
    );
    const allowed = failures.every(
      (failure) =>
        /^stored rotations digest [0-9a-f]{32} does not match the last accepted lock [0-9a-f]{32}$/.test(
          failure,
        ) ||
        failure === 'stored stateDigest does not recompute over the stored mutable state' ||
        failure ===
          'run.effects diverged from the last checkpoint effects without a trade window ' +
            '(last block stateDigest does not recompute over the stored facts)',
    );
    if (!rotationFailure || !stateDigestFailure || !allowed) return false;

    return this.db.transaction(
      'rw',
      [this.db.seasonRuns, this.db.seasonRunBlocks, this.db.seasonPendingBlocks],
      async () => {
        const rawCheckpoint = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
        if (rawCheckpoint === undefined) return false;
        const parsedCheckpoint = storedSeasonRunRecordSchema.safeParse(rawCheckpoint);
        if (!parsedCheckpoint.success) return false;
        const stored = parsedCheckpoint.data;
        if (stored.revision === 0 || stored.checkpointState === null) return false;
        if ((await this.db.seasonPendingBlocks.get(stored.run.runId)) !== undefined) return false;

        const rawBlock = await this.db.seasonRunBlocks.get([stored.run.runId, stored.revision - 1]);
        if (rawBlock === undefined) return false;
        const parsedBlock = storedSeasonAcceptedBlockRowSchema.safeParse(rawBlock);
        if (!parsedBlock.success) return false;
        const last = parsedBlock.data.block;
        const oldDigest = last.rotationDigest;
        const lockedDigest = this.seam.seasonRotationSetDigest(stored.run.rotations);
        if (lockedDigest === oldDigest) return false;
        if (
          stored.lastRotationDigest !== oldDigest ||
          stored.checkpointState.rotationDigest !== oldDigest ||
          stored.checkpointState.commandId !== last.commandId ||
          stored.checkpointState.checkpointDigest !== last.checkpointDigest
        ) {
          return false;
        }

        const checkpointState = {
          ...stored.checkpointState,
          rotationDigest: lockedDigest,
        };
        const stateDigest = this.seam.seasonRunStateDigest({
          stateRevision: stored.stateRevision,
          stage: stored.run.stage,
          postseason: stored.run.postseason,
          awards: stored.run.awards,
          completion: stored.run.completion,
          checkpointState,
          health: stored.health,
          influence: stored.influence,
          transactions: stored.transactions,
          trade: stored.trade,
          objectives: stored.objectives,
          rosters: stored.run.rosters,
          ownership: stored.run.ownership,
          rotations: stored.run.rotations,
          effects: stored.effects,
        });
        const block = seasonAcceptedBlockSchema.parse({
          ...last,
          rotationDigest: lockedDigest,
          ...(stored.stateRevision === last.stateRevision ? { stateDigest } : {}),
        });
        const updatedAtIso = new Date().toISOString();
        const repairedCheckpoint = storedSeasonRunRecordSchema.parse({
          ...stored,
          lastRotationDigest: lockedDigest,
          checkpointState,
          stateDigest,
          updatedAtIso,
        });
        const repairedBlock = storedSeasonAcceptedBlockRowSchema.parse({
          ...parsedBlock.data,
          block,
          updatedAtIso,
        });
        await this.db.seasonRuns.put(repairedCheckpoint);
        await this.db.seasonRunBlocks.put(repairedBlock);
        return true;
      },
    );
  }

  /**
   * Repairs the second pre-fix rotation signature: all lock identity facts
   * already describe the submitted rotations, but both the checkpoint and
   * accepted-block rows carry a digest computed over the old set. Matching
   * bad digests in both atomically written rows distinguishes this from
   * isolated row tampering, which remains a hard load failure.
   */
  private async repairLegacyCommittedStateDigest(failures: readonly string[]): Promise<boolean> {
    const digestFailure = 'stored stateDigest does not recompute over the stored mutable state';
    const effectsFailure =
      'run.effects diverged from the last checkpoint effects without a trade window ' +
      '(last block stateDigest does not recompute over the stored facts)';
    if (
      !failures.includes(digestFailure) ||
      !failures.every((failure) => failure === digestFailure || failure === effectsFailure)
    ) {
      return false;
    }

    return this.db.transaction(
      'rw',
      [this.db.seasonRuns, this.db.seasonRunBlocks, this.db.seasonPendingBlocks],
      async () => {
        const rawCheckpoint = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
        if (rawCheckpoint === undefined) return false;
        const parsedCheckpoint = storedSeasonRunRecordSchema.safeParse(rawCheckpoint);
        if (!parsedCheckpoint.success) return false;
        const stored = parsedCheckpoint.data;
        if (stored.revision === 0 || stored.checkpointState === null) return false;
        if ((await this.db.seasonPendingBlocks.get(stored.run.runId)) !== undefined) return false;

        const rawBlock = await this.db.seasonRunBlocks.get([stored.run.runId, stored.revision - 1]);
        if (rawBlock === undefined) return false;
        const parsedBlock = storedSeasonAcceptedBlockRowSchema.safeParse(rawBlock);
        if (!parsedBlock.success) return false;
        const last = parsedBlock.data.block;
        if (
          last.stateRevision !== stored.stateRevision ||
          last.stateDigest !== stored.stateDigest ||
          last.commandId !== stored.checkpointState.commandId ||
          last.rotationDigest !== stored.checkpointState.rotationDigest ||
          last.checkpointDigest !== stored.checkpointState.checkpointDigest
        ) {
          return false;
        }

        const stateDigest = this.seam.seasonRunStateDigest({
          stateRevision: stored.stateRevision,
          stage: stored.run.stage,
          postseason: stored.run.postseason,
          awards: stored.run.awards,
          completion: stored.run.completion,
          checkpointState: stored.checkpointState,
          health: stored.health,
          influence: stored.influence,
          transactions: stored.transactions,
          trade: stored.trade,
          objectives: stored.objectives,
          rosters: stored.run.rosters,
          ownership: stored.run.ownership,
          rotations: stored.run.rotations,
          effects: stored.effects,
        });
        if (stateDigest === stored.stateDigest) return false;

        const updatedAtIso = new Date().toISOString();
        await this.db.seasonRuns.put(
          storedSeasonRunRecordSchema.parse({ ...stored, stateDigest, updatedAtIso }),
        );
        await this.db.seasonRunBlocks.put(
          storedSeasonAcceptedBlockRowSchema.parse({
            ...parsedBlock.data,
            block: { ...last, stateDigest },
            updatedAtIso,
          }),
        );
        return true;
      },
    );
  }

  /**
   * THE single run-scoped deletion path (performance pass). Every Season Run
   * table carries rows keyed by runId; lifecycle callers (quit, force-clear,
   * corrupt-save recovery, replacement-run promotion, completed-run
   * deletion) all route through here so no orphaned row can survive a run
   * teardown. Must be invoked inside a 'rw' transaction that includes every
   * table in `SEASON_RUN_SCOPED_TABLES`.
   */
  private async deleteRunRows(runId: string): Promise<void> {
    await this.db.seasonRunSummaries.where('runId').equals(runId).delete();
    await this.db.seasonRunDetails.where('runId').equals(runId).delete();
    await this.db.seasonRunBlocks.where('runId').equals(runId).delete();
    await this.db.seasonPendingBlocks.delete(runId);
    await this.db.seasonPostseasonSummaries.where('runId').equals(runId).delete();
    await this.db.seasonPostseasonDetails.where('runId').equals(runId).delete();
    await this.db.seasonCommandLog.where('runId').equals(runId).delete();
    await this.db.seasonAlmanacs.delete(runId);
    await this.db.seasonCompletedRuns.delete(runId);
    await this.db.seasonCompletedIndex.delete(runId);
    await this.db.seasonRunPlayerSlices.delete(runId);
  }

  /** Deletes the checkpoint row, the index row, and every run row of a development checkpoint. */
  private async clearDevelopmentRow(): Promise<void> {
    await this.db.transaction('rw', SEASON_RUN_SCOPED_TABLES(this.db), async () => {
      const checkpoint = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
      if (checkpoint === undefined) return;
      await this.db.seasonRuns.delete(SEASON_RUN_RECORD_ID);
      await this.db.seasonRunIndex.delete(SEASON_RUN_RECORD_ID);
      const runId = (checkpoint as { run?: { runId?: unknown } }).run?.runId;
      if (typeof runId === 'string') {
        await this.deleteRunRows(runId);
      }
    });
  }

  private async loadValidated(
    checkpoint: unknown,
    schedule: SeasonSchedule,
  ): Promise<SeasonRunSnapshot> {
    let stored: StoredSeasonRunRecord;
    try {
      stored = storedSeasonRunRecordSchema.parse(checkpoint);
    } catch (error) {
      const info = incompatibleInfoOf(checkpoint);
      if (info !== null) {
        throw new SeasonRunIncompatibleError(info);
      }
      throw new SeasonRunLoadError(
        ['stored Season Run checkpoint failed schema validation'],
        `corrupt Season Run checkpoint: ${errorMessage(error)}`,
      );
    }
    const failures: string[] = [];
    const runId = stored.run.runId;

    const [summaryRows, detailRows, blockRows, indexRow, pendingRow] = await Promise.all([
      this.db.seasonRunSummaries.where('runId').equals(runId).toArray(),
      this.db.seasonRunDetails.where('runId').equals(runId).toArray(),
      this.db.seasonRunBlocks.where('runId').equals(runId).toArray(),
      this.db.seasonRunIndex.get(SEASON_RUN_RECORD_ID),
      this.db.seasonPendingBlocks.get(runId),
    ]);

    const summaries: SeasonGameSummary[] = [];
    for (const row of summaryRows) {
      try {
        const parsed = storedSeasonSummaryRowSchema.parse(row);
        if (parsed.gameId !== parsed.summary.gameId || parsed.round !== parsed.summary.round) {
          failures.push(`summary row ${row.gameId} identity does not match its summary facts`);
          continue;
        }
        summaries.push(parsed.summary);
      } catch (error) {
        failures.push(`corrupt summary row ${row.gameId}: ${errorMessage(error)}`);
      }
    }
    const retainedDetails: SeasonRetainedGameDetail[] = [];
    for (const row of detailRows) {
      try {
        const parsed = storedSeasonDetailRowSchema.parse(row);
        if (parsed.gameId !== parsed.detail.gameId || parsed.round !== parsed.detail.round) {
          failures.push(
            `retained detail row ${row.gameId} identity does not match its detail facts`,
          );
          continue;
        }
        retainedDetails.push(parsed.detail);
      } catch (error) {
        failures.push(`corrupt retained detail row ${row.gameId}: ${errorMessage(error)}`);
      }
    }
    const acceptedBlocks: SeasonAcceptedBlock[] = [];
    for (const row of blockRows) {
      try {
        const parsed = storedSeasonAcceptedBlockRowSchema.parse(row);
        if (
          parsed.blockIndex !== parsed.block.blockIndex ||
          parsed.block.blockIndex !== parsed.block.revision - 1
        ) {
          failures.push(
            `accepted-block row ${String(row.blockIndex)} does not match its block facts`,
          );
          continue;
        }
        acceptedBlocks.push(parsed.block);
      } catch (error) {
        failures.push(
          `corrupt accepted-block row ${String(row.blockIndex)}: ${errorMessage(error)}`,
        );
      }
    }

    let activeIndex: SeasonActiveRunIndex | null = null;
    if (indexRow === undefined) {
      failures.push('active-run index row is missing');
    } else {
      try {
        activeIndex = storedSeasonActiveRunIndexSchema.parse(indexRow).index;
        if (activeIndex.runId !== runId) {
          failures.push(
            `active-run index runId ${activeIndex.runId} does not match the checkpoint`,
          );
        }
      } catch (error) {
        failures.push(`corrupt active-run index row: ${errorMessage(error)}`);
      }
    }

    // M2.5: the interrupted-block pending row participates in the reload audit.
    let pending: SeasonPendingBlockCandidate | null = null;
    if (pendingRow !== undefined) {
      try {
        const parsed = storedSeasonPendingBlockRowSchema.parse(pendingRow);
        if (parsed.block.runId !== runId || parsed.interruption.runId !== runId) {
          failures.push('pending block row runId does not match the checkpoint');
        } else {
          pending = parsed.block;
        }
      } catch (error) {
        failures.push(`corrupt pending block row: ${errorMessage(error)}`);
      }
    }

    if (failures.length === 0) {
      const humanFranchiseId = humanTeamOf(stored.run.league)?.franchiseId;
      if (humanFranchiseId === undefined) {
        failures.push('the run league contains no human-controlled franchise');
      } else {
        failures.push(
          ...auditSeasonRunState(
            {
              league: stored.run.league,
              rosters: stored.run.rosters,
              schedule,
              humanFranchiseId,
              stored,
              summaries,
              retainedDetails,
              acceptedBlocks,
              pending,
            },
            this.seam,
          ),
        );
      }
    }

    if (failures.length > 0) {
      throw new SeasonRunLoadError(failures);
    }

    const games = this.seam.reconstructSeasonGames(schedule, summaries);
    const run = seasonRunSchema.parse({
      ...stored.run,
      games,
      standings: stored.standings,
      cursor: { schemaVersion: 1, completedRounds: stored.completedRounds },
      // The row-level M2.5 mutable state is authoritative on reload; the
      // snapshot's promotion-time values are overridden (mirror of the
      // standings/cursor override above).
      health: stored.health,
      transactions: stored.transactions,
      influence: stored.influence,
      trade: stored.trade,
      objectives: stored.objectives,
      checkpointState: stored.checkpointState,
      stateRevision: stored.stateRevision,
      stateDigest: stored.stateDigest,
    });
    return {
      run,
      summaries: byGameId(summaries),
      retainedDetails: byGameId(retainedDetails),
      acceptedBlocks: byRevision(acceptedBlocks),
      effects: stored.effects,
    };
  }

  async loadBlockSummaries(runId: string, blockIndex: number): Promise<SeasonGameSummary[]> {
    // Performance pass: the [runId+blockIndex] composite index serves this
    // exact query; the old blockIndex-only scan walked every run's rows.
    const rows = await this.db.seasonRunSummaries
      .where('[runId+blockIndex]')
      .equals([runId, blockIndex])
      .toArray();
    return byGameId(
      rows.map((row) => {
        try {
          return storedSeasonSummaryRowSchema.parse(row).summary;
        } catch (error) {
          throw new SeasonRunLoadError(
            [`corrupt summary row ${row.gameId}: ${errorMessage(error)}`],
            'corrupt stored Season Run summary row',
          );
        }
      }),
    );
  }

  async loadRetainedDetails(runId: string): Promise<SeasonRetainedGameDetail[]> {
    const rows = await this.db.seasonRunDetails.where('runId').equals(runId).toArray();
    return byGameId(
      rows.map((row) => {
        try {
          return storedSeasonDetailRowSchema.parse(row).detail;
        } catch (error) {
          throw new SeasonRunLoadError(
            [`corrupt retained detail row ${row.gameId}: ${errorMessage(error)}`],
            'corrupt stored Season Run detail row',
          );
        }
      }),
    );
  }

  async loadBlockHistory(runId: string): Promise<SeasonAcceptedBlock[]> {
    const rows = await this.db.seasonRunBlocks.where('runId').equals(runId).toArray();
    return byRevision(
      rows.map((row) => {
        try {
          return storedSeasonAcceptedBlockRowSchema.parse(row).block;
        } catch (error) {
          throw new SeasonRunLoadError(
            [`corrupt accepted-block row ${String(row.blockIndex)}: ${errorMessage(error)}`],
            'corrupt stored Season Run block row',
          );
        }
      }),
    );
  }

  async commitSeasonBlock(input: CommitSeasonBlockInput): Promise<void> {
    const blockIndex = input.revision - 1;
    if (blockIndex < 0 || blockIndex > 8) {
      throw new Error(
        `commitSeasonBlock: revision ${String(input.revision)} is not a valid block boundary`,
      );
    }
    // Legacy rows (save schema v1-v4) are never migrated or auto-cleared: a
    // commit against one must fail rather than silently rewrite old rules.
    // Dexie types the row as the current schema, so the raw value is probed
    // at runtime (legacy rows predate the v5 literal).
    const preflight: unknown = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (preflight !== undefined && isDevelopmentRow(preflight)) {
      const info = incompatibleInfoOf(preflight);
      throw new SeasonRunIncompatibleError(
        info ?? {
          storedSaveSchemaVersion: SEASON_RUN_SAVE_SCHEMA_VERSION,
          storedRunSchemaVersion: SEASON_RUN_SCHEMA_VERSION - 1,
          runId: 'unknown-legacy-run',
        },
      );
    }
    await this.db.transaction(
      'rw',
      [
        this.db.seasonRuns,
        this.db.seasonRunSummaries,
        this.db.seasonRunDetails,
        this.db.seasonRunBlocks,
        this.db.seasonRunIndex,
        this.db.seasonPendingBlocks,
      ],
      async () => {
        const checkpoint = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
        if (checkpoint === undefined) {
          throw new Error('commitSeasonBlock: no active run checkpoint to advance');
        }
        if (
          (checkpoint as { saveSchemaVersion?: unknown }).saveSchemaVersion !==
          SEASON_RUN_SAVE_SCHEMA_VERSION
        ) {
          // Unreachable after the preflight auto-clear; defensive.
          throw new Error('commitSeasonBlock: no active run checkpoint to advance');
        }
        const cursor = seasonRunCursorSchema.parse(checkpoint);
        if (cursor.run.runId !== input.runId) {
          throw new Error('commitSeasonBlock: runId does not match the active checkpoint');
        }
        if (cursor.revision !== input.revision - 1) {
          throw new Error(
            `commitSeasonBlock: revision regression (stored ${String(cursor.revision)}, ` +
              `expected ${String(input.revision - 1)})`,
          );
        }
        if (cursor.lastCommandId === input.commandId) {
          throw new Error(`commitSeasonBlock: duplicate commandId ${input.commandId}`);
        }
        if (input.completedRounds < cursor.completedRounds) {
          throw new Error('commitSeasonBlock: completedRounds regression');
        }
        // M2.5: the submission asserted the pre-block run state facts; a
        // stale candidate is rejected inside the transaction.
        if (cursor.stateRevision !== input.expectedStateRevision) {
          throw new Error(
            `commitSeasonBlock: stale expectedStateRevision ${String(input.expectedStateRevision)} ` +
              `(stored ${String(cursor.stateRevision)})`,
          );
        }
        if (cursor.stateDigest !== input.expectedStateDigest) {
          throw new Error('commitSeasonBlock: stale expectedStateDigest');
        }
        if (input.stateRevision <= cursor.stateRevision) {
          throw new Error(
            `commitSeasonBlock: stateRevision does not advance (stored ${String(cursor.stateRevision)}, ` +
              `commit ${String(input.stateRevision)})`,
          );
        }

        // Block summaries replace the block's prior rows; a legal commit only
        // ever appends (the revision guard above), so this is defensive.
        await this.db.seasonRunSummaries
          .where('[runId+blockIndex]')
          .equals([input.runId, blockIndex])
          .delete();
        await this.db.seasonRunDetails
          .where('runId')
          .equals(input.runId)
          .and((row) => blockIndexForRound(row.round) === blockIndex)
          .delete();
        // M2.5: delete any pending-block row in the SAME transaction (the
        // interrupted work for this block is now moot).
        await this.db.seasonPendingBlocks.delete(input.runId);

        const updatedAtIso = new Date().toISOString();
        await this.db.seasonRunSummaries.bulkPut(
          input.summaries.map((summary) =>
            storedSeasonSummaryRowSchema.parse({
              runId: input.runId,
              gameId: summary.gameId,
              blockIndex,
              round: summary.round,
              summary,
              updatedAtIso,
            }),
          ),
        );
        await this.db.seasonRunDetails.bulkPut(
          input.retainedDetails.map((detail) =>
            storedSeasonDetailRowSchema.parse({
              runId: input.runId,
              gameId: detail.gameId,
              round: detail.round,
              detail,
              updatedAtIso,
            }),
          ),
        );
        const acceptedBlock = seasonAcceptedBlockSchema.parse({
          runId: input.runId,
          blockIndex,
          completedRounds: input.completedRounds,
          revision: input.revision,
          commandId: input.commandId,
          rotationDigest: input.rotationDigest,
          checkpointDigest: input.checkpointDigest,
          summaryCount: input.summaries.length,
          stateRevision: input.stateRevision,
          stateDigest: input.stateDigest,
        });
        await this.db.seasonRunBlocks.put({
          runId: input.runId,
          blockIndex,
          block: acceptedBlock,
          updatedAtIso,
        });

        const humanFranchiseId = humanTeamOf(cursor.run.league)?.franchiseId;
        if (humanFranchiseId === undefined) {
          throw new Error('commitSeasonBlock: the run league has no human franchise');
        }
        const humanRow = input.standings.rows.find((row) => row.franchiseId === humanFranchiseId);
        if (humanRow === undefined) {
          throw new Error('commitSeasonBlock: standings miss the human franchise');
        }

        // M2.5: when the engine produced a trade-window open, the window's
        // mutated rosters/ownership/rotations/effects/trade/influence/
        // transactions replace the block's own (AI activity folds on top).
        // The commit's stateRevision/stateDigest already include the window
        // and are computed over the WINDOW health, so the stored health must
        // be the window's or the reload audit's digest recomputation fails
        // (regression fix).
        const window = input.window;
        const mutableState = {
          health: window !== null ? window.health : input.health,
          transactions: window !== null ? window.transactions : input.transactions,
          influence: window !== null ? window.influence : input.influence,
          trade: window !== null ? window.trade : input.trade,
          objectives: input.objectives,
          checkpointState: input.checkpointState,
          stateRevision: window !== null ? window.stateRevision : input.stateRevision,
          stateDigest: window !== null ? window.stateDigest : input.stateDigest,
        };

        const delta = seasonRunCheckpointDeltaSchema.parse({
          completedRounds: input.completedRounds,
          revision: input.revision,
          lastCommandId: input.commandId,
          lastRotationDigest: input.rotationDigest,
          lastCheckpointDigest: input.checkpointDigest,
          standings: input.standings,
          teamAggregates: input.teamAggregates,
          playerAggregates: input.playerAggregates,
          recap: input.recap,
          effects: window !== null ? window.effects : input.effects,
          updatedAtIso,
          ...mutableState,
          run: {
            rosters: window !== null ? window.rosters : (cursor.run.rosters as never),
            ownership: window !== null ? window.ownership : (cursor.run.ownership as never),
            rotations: window !== null ? window.rotations : input.rotations,
          },
        });
        await this.db.seasonRuns.put({
          ...checkpoint,
          ...delta,
          // The snapshot portion is promotion-immutable except the locked
          // rotations and any window-mutated rosters/ownership, rewritten as
          // a full `run` slice.
          run: {
            ...checkpoint.run,
            ...delta.run,
          },
        });

        const indexRow = await this.db.seasonRunIndex.get(SEASON_RUN_RECORD_ID);
        if (indexRow !== undefined) {
          const index = storedSeasonActiveRunIndexSchema.parse(indexRow).index;
          await this.db.seasonRunIndex.put({
            recordId: SEASON_RUN_RECORD_ID,
            index: {
              ...index,
              completedRounds: input.completedRounds,
              revision: input.revision,
              humanWins: humanRow.wins,
              humanLosses: humanRow.losses,
              updatedAtIso,
            },
          });
        }
      },
    );
  }

  async savePendingBlock(
    pending: SeasonPendingBlockCandidate,
    interruption: SeasonInvalidRosterInterruption,
  ): Promise<void> {
    const row = storedSeasonPendingBlockRowSchema.parse({
      runId: pending.runId,
      block: pending,
      interruption,
      updatedAtIso: new Date().toISOString(),
    });
    await this.db.transaction('rw', this.db.seasonRuns, this.db.seasonPendingBlocks, async () => {
      const checkpoint = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
      if (checkpoint === undefined) {
        throw new SeasonPendingBlockRejectedError('no active run checkpoint exists');
      }
      if (
        (checkpoint as { saveSchemaVersion?: unknown }).saveSchemaVersion !==
        SEASON_RUN_SAVE_SCHEMA_VERSION
      ) {
        throw new SeasonPendingBlockRejectedError('the active checkpoint is not current');
      }
      const cursor = seasonRunCursorSchema.parse(checkpoint);
      if (cursor.run.runId !== pending.runId) {
        throw new SeasonPendingBlockRejectedError(
          `runId ${pending.runId} does not match the active checkpoint`,
        );
      }
      // The cursor must not have advanced past the pending's block: the
      // pending was assembled for the current boundary, so a committed
      // block (or an applied command) makes it stale.
      if (cursor.revision !== pending.expectedRevision) {
        throw new SeasonPendingBlockRejectedError(
          `cursor revision ${String(cursor.revision)} does not match the pending's expectedRevision ${String(pending.expectedRevision)}`,
        );
      }
      if (cursor.stateRevision !== pending.expectedStateRevision) {
        throw new SeasonPendingBlockRejectedError(
          `cursor stateRevision ${String(cursor.stateRevision)} does not match the pending's expectedStateRevision ${String(pending.expectedStateRevision)}`,
        );
      }
      if (cursor.stateDigest !== pending.expectedStateDigest) {
        throw new SeasonPendingBlockRejectedError(
          'cursor stateDigest does not match the pending candidate',
        );
      }
      if (pending.blockIndex !== cursor.revision) {
        throw new SeasonPendingBlockRejectedError(
          `pending blockIndex ${String(pending.blockIndex)} is not the next uncommitted block ${String(cursor.revision)}`,
        );
      }
      await this.db.seasonPendingBlocks.put(row);
    });
  }

  async loadPendingBlock(runId: string): Promise<SeasonPendingBlockCandidate | null> {
    const row = await this.db.seasonPendingBlocks.get(runId);
    if (row === undefined) return null;
    const parsed = storedSeasonPendingBlockRowSchema.parse(row);
    if (parsed.block.runId !== runId || parsed.interruption.runId !== runId) {
      throw new SeasonRunLoadError(
        ['pending block row runId does not match its key'],
        'corrupt stored Season Run pending block row',
      );
    }
    return parsed.block;
  }

  async discardPendingBlock(runId: string): Promise<void> {
    await this.db.seasonPendingBlocks.delete(runId);
  }

  async applySeasonRunCommand(input: SeasonRunCommandApplication): Promise<void> {
    const command = input.command;
    await this.db.transaction('rw', this.db.seasonRuns, this.db.seasonPendingBlocks, async () => {
      const checkpoint = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
      if (checkpoint === undefined) {
        throw new SeasonRunCommandRunMismatchError(input.runId);
      }
      if (
        (checkpoint as { saveSchemaVersion?: unknown }).saveSchemaVersion !==
        SEASON_RUN_SAVE_SCHEMA_VERSION
      ) {
        throw new SeasonRunCommandRunMismatchError(input.runId);
      }
      const cursor = seasonRunCursorSchema.parse(checkpoint);
      if (cursor.run.runId !== input.runId || command.runId !== input.runId) {
        throw new SeasonRunCommandRunMismatchError(input.runId);
      }
      if (input.run.runId !== input.runId) {
        throw new SeasonRunCommandRunMismatchError(input.runId);
      }
      // The command asserted the run state facts it was assembled against; a
      // stale command is rejected (the engine recomputes the digest).
      if (cursor.stateRevision !== command.expectedStateRevision) {
        throw new SeasonRunCommandStaleStateError(
          command.commandId,
          command.expectedStateRevision,
          cursor.stateRevision,
        );
      }
      if (cursor.stateDigest !== command.expectedStateDigest) {
        throw new SeasonRunCommandStaleStateError(
          command.commandId,
          command.expectedStateRevision,
          cursor.stateRevision,
        );
      }
      // Bounded commandId dedupe against the recorded command history.
      const commandId = command.commandId;
      const recorded: string[] = [];
      if (cursor.lastCommandId !== null) recorded.push(cursor.lastCommandId);
      if (cursor.checkpointState !== null) recorded.push(cursor.checkpointState.commandId);
      for (const entry of cursor.transactions) {
        if (entry.commandId !== null) recorded.push(entry.commandId);
      }
      for (const entry of cursor.influence.ledger) {
        if (entry.commandId !== null) recorded.push(entry.commandId);
      }
      for (const selection of Object.values(cursor.objectives.selections)) {
        recorded.push(selection.selectedByCommandId);
      }
      if (recorded.includes(commandId)) {
        throw new SeasonRunCommandDuplicateError(commandId);
      }

      // Store the engine-produced mutable run state: the snapshot's
      // rosters/ownership/rotations slices are rewritten (trades move
      // players); standings/aggregates/recap never change between blocks.
      const delta = seasonRunCheckpointDeltaSchema.parse({
        completedRounds: cursor.completedRounds,
        revision: cursor.revision,
        lastCommandId: cursor.lastCommandId,
        lastRotationDigest: checkpoint.lastRotationDigest,
        lastCheckpointDigest: checkpoint.lastCheckpointDigest,
        standings: checkpoint.standings,
        teamAggregates: checkpoint.teamAggregates,
        playerAggregates: checkpoint.playerAggregates,
        recap: checkpoint.recap,
        effects: input.effects ?? checkpoint.effects,
        updatedAtIso: new Date().toISOString(),
        health: input.run.health,
        transactions: input.run.transactions,
        influence: input.run.influence,
        trade: input.run.trade,
        objectives: input.run.objectives,
        checkpointState: input.run.checkpointState,
        stateRevision: input.run.stateRevision,
        stateDigest: input.run.stateDigest,
        run: {
          rosters: input.run.rosters,
          ownership: input.run.ownership,
          rotations: input.run.rotations,
        },
      });
      await this.db.seasonRuns.put({
        ...checkpoint,
        ...delta,
        run: {
          ...checkpoint.run,
          ...delta.run,
        },
      });
      if (input.pending === null) {
        await this.db.seasonPendingBlocks.delete(input.runId);
      } else {
        // A pending can only be produced by resume/forfeit commands, which
        // require an existing pending row. Preserve the recorded interruption
        // facts, advancing `nextGameId` to the pending's current value.
        const existingPending = await this.db.seasonPendingBlocks.get(input.runId);
        if (existingPending === undefined) {
          throw new SeasonRunLoadError(
            ['a command produced a pending candidate without a prior pending row'],
            'Season Run pending block state is inconsistent',
          );
        }
        await this.db.seasonPendingBlocks.put({
          runId: input.runId,
          block: input.pending,
          interruption: {
            ...existingPending.interruption,
            nextGameId: input.pending.nextGameId,
          },
          updatedAtIso: new Date().toISOString(),
        });
      }
    });
  }

  async promoteSeasonDraftToRun(
    draft: StoredSeasonDraft,
    run: SeasonRun,
    playerSlice?: SeasonRunPlayerSliceEntry[],
  ): Promise<void> {
    const validatedDraft = storedSeasonDraftSchema.parse(draft);
    const validatedRun = seasonRunSchema.parse(run);
    const { games: _games, ...runWithoutGames } = validatedRun;
    // M2.5 initial mutable run state: empty health, empty transaction log,
    // initial Influence (+2 per franchise), null trade, fixed objective
    // catalog with no selections, null checkpoint state, stateRevision 0
    // with the canonical digest over the initial facts.
    const health = seasonHealthStateSchema.parse({
      schemaVersion: 1,
      healthVersion: SEASON_HEALTH_VERSION,
      injuries: [],
    });
    const influence = this.seam.createInitialSeasonInfluenceState(
      validatedRun.league.teams.map((team) => team.franchiseId),
    );
    const objectives = seasonObjectiveStateSchema.parse({
      schemaVersion: 1,
      objectiveVersion: SEASON_OBJECTIVE_VERSION,
      catalog: [...SEASON_OBJECTIVE_CATALOG],
      selections: {},
    });
    const stateDigest = this.seam.seasonRunStateDigest({
      stateRevision: 0,
      stage: validatedRun.stage,
      postseason: validatedRun.postseason,
      awards: validatedRun.awards,
      completion: validatedRun.completion,
      checkpointState: null,
      health,
      influence,
      transactions: [],
      trade: null,
      objectives,
      rosters: validatedRun.rosters,
      ownership: validatedRun.ownership,
      rotations: validatedRun.rotations,
      effects: this.seam.zeroSeasonEffectsState(validatedRun.rosters),
    });
    const checkpointRow = storedSeasonRunRecordSchema.parse({
      recordId: SEASON_RUN_RECORD_ID,
      saveSchemaVersion: SEASON_RUN_SAVE_SCHEMA_VERSION,
      run: runWithoutGames,
      completedRounds: 0,
      revision: 0,
      lastCommandId: null,
      lastRotationDigest: null,
      lastCheckpointDigest: null,
      standings: this.seam.reduceSeasonStandings(validatedRun.league, []),
      teamAggregates: this.seam.foldSeasonTeamAggregates(validatedRun.league, []),
      playerAggregates: this.seam.foldSeasonPlayerAggregates(validatedRun.rosters, []),
      recap: null,
      effects: this.seam.zeroSeasonEffectsState(validatedRun.rosters),
      health,
      transactions: [],
      influence,
      trade: null,
      objectives,
      checkpointState: null,
      stateRevision: 0,
      stateDigest,
    });
    const humanFranchiseId = humanTeamOf(validatedRun.league)?.franchiseId;
    if (humanFranchiseId === undefined) {
      throw new Error('promoteSeasonDraftToRun: the run league has no human franchise');
    }
    const indexRow = storedSeasonActiveRunIndexSchema.parse({
      recordId: SEASON_RUN_RECORD_ID,
      index: {
        runId: validatedRun.runId,
        rootSeed: validatedRun.rootSeed,
        humanFranchiseId,
        completedRounds: 0,
        revision: 0,
        humanWins: 0,
        humanLosses: 0,
        updatedAtIso: new Date().toISOString(),
      },
    });
    await this.db.transaction(
      'rw',
      [...SEASON_RUN_SCOPED_TABLES(this.db), this.db.seasonDrafts],
      async () => {
        const storedDraft = await this.db.seasonDrafts.get(SEASON_DRAFT_RECORD_ID);
        if (storedDraft !== undefined && storedDraft.draft.runId !== validatedDraft.draft.runId) {
          throw new Error('promoteSeasonDraftToRun: stored draft runId does not match');
        }
        const existing = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
        if (existing !== undefined) {
          // Legacy rows (save schema v1-v4) are never overwritten or migrated
          // by a promotion; they can only be discarded explicitly.
          if (isDevelopmentRow(existing)) {
            const info = incompatibleInfoOf(existing);
            throw new SeasonRunIncompatibleError(
              info ?? {
                storedSaveSchemaVersion: SEASON_RUN_SAVE_SCHEMA_VERSION,
                storedRunSchemaVersion: SEASON_RUN_SCHEMA_VERSION - 1,
                runId: 'unknown-legacy-run',
              },
            );
          }
          const existingParsed = storedSeasonRunRecordSchema.safeParse(existing);
          const existingRunId = existingParsed.success
            ? existingParsed.data.run.runId
            : typeof (existing as { run?: { runId?: unknown } }).run?.runId === 'string'
              ? (existing as { run: { runId: string } }).run.runId
              : null;
          // Replacement-run promotion: every row of the superseded run goes
          // through the shared deletion path so no orphaned row survives.
          if (existingRunId !== null && existingRunId !== validatedRun.runId) {
            await this.deleteRunRows(existingRunId);
          }
        }
        await this.db.seasonRuns.put(checkpointRow);
        await this.db.seasonRunIndex.put(indexRow);
        if (playerSlice !== undefined && playerSlice.length > 0) {
          await this.db.seasonRunPlayerSlices.put(
            storedSeasonPlayerSliceRowSchema.parse({
              runId: validatedRun.runId,
              players: playerSlice.map((entry) => seasonRunPlayerSliceEntrySchema.parse(entry)),
              updatedAtIso: new Date().toISOString(),
            }),
          );
        }
        await this.db.seasonDrafts.delete(SEASON_DRAFT_RECORD_ID);
      },
    );
  }

  async loadSeasonRunPlayerSlice(runId: string): Promise<SeasonRunPlayerSliceEntry[] | null> {
    const row = await this.db.seasonRunPlayerSlices.get(runId);
    if (row === undefined) return null;
    const parsed = storedSeasonPlayerSliceRowSchema.parse(row);
    if (parsed.runId !== runId) {
      throw new SeasonRunLoadError(
        ['player slice row runId does not match its key'],
        'corrupt stored Season Run player slice row',
      );
    }
    return parsed.players;
  }

  async upsertSeasonRunPlayerSlice(
    runId: string,
    entries: SeasonRunPlayerSliceEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.db.transaction('rw', this.db.seasonRunPlayerSlices, async () => {
      const existing = await this.db.seasonRunPlayerSlices.get(runId);
      const byVersion = new Map<string, SeasonRunPlayerSliceEntry>(
        (existing?.players ?? []).map((entry) => [entry.playerVersionId, entry]),
      );
      for (const entry of entries) {
        const parsed = seasonRunPlayerSliceEntrySchema.parse(entry);
        byVersion.set(parsed.playerVersionId, parsed);
      }
      await this.db.seasonRunPlayerSlices.put(
        storedSeasonPlayerSliceRowSchema.parse({
          runId,
          players: [...byVersion.values()],
          updatedAtIso: new Date().toISOString(),
        }),
      );
    });
  }

  async clearSeasonRun(runId: string): Promise<void> {
    await this.db.transaction('rw', SEASON_RUN_SCOPED_TABLES(this.db), async () => {
      const checkpoint = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
      if (checkpoint !== undefined) {
        const parsed = storedSeasonRunRecordSchema.safeParse(checkpoint);
        const storedRunId = parsed.success
          ? parsed.data.run.runId
          : typeof (checkpoint as { run?: { runId?: unknown } }).run?.runId === 'string'
            ? (checkpoint as { run: { runId: string } }).run.runId
            : null;
        if (storedRunId !== null && storedRunId !== runId) {
          throw new Error('clearSeasonRun: runId does not match the active checkpoint');
        }
      }
      await this.db.seasonRuns.delete(SEASON_RUN_RECORD_ID);
      await this.db.seasonRunIndex.delete(SEASON_RUN_RECORD_ID);
      await this.deleteRunRows(runId);
    });
  }

  async forceClearActiveSeasonRun(): Promise<void> {
    await this.db.transaction('rw', SEASON_RUN_SCOPED_TABLES(this.db), async () => {
      const runIds = new Set<string>();
      const indexRow = await this.db.seasonRunIndex.get(SEASON_RUN_RECORD_ID);
      if (indexRow !== undefined) {
        const parsedIndex = storedSeasonActiveRunIndexSchema.safeParse(indexRow);
        if (parsedIndex.success) {
          runIds.add(parsedIndex.data.index.runId);
        }
      }
      const checkpoint = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
      if (checkpoint !== undefined) {
        const parsedCheckpoint = storedSeasonRunRecordSchema.safeParse(checkpoint);
        if (parsedCheckpoint.success) {
          runIds.add(parsedCheckpoint.data.run.runId);
        } else {
          const rawRunId = (checkpoint as { run?: { runId?: unknown } }).run?.runId;
          if (typeof rawRunId === 'string') runIds.add(rawRunId);
        }
      }
      await this.db.seasonRuns.delete(SEASON_RUN_RECORD_ID);
      await this.db.seasonRunIndex.delete(SEASON_RUN_RECORD_ID);
      if (runIds.size === 0) {
        // Unidentifiable active state: wipe every run-scoped table so no
        // partial rows can leak into a later run.
        await this.db.seasonRunSummaries.clear();
        await this.db.seasonRunDetails.clear();
        await this.db.seasonRunBlocks.clear();
        await this.db.seasonPendingBlocks.clear();
        await this.db.seasonPostseasonSummaries.clear();
        await this.db.seasonPostseasonDetails.clear();
        await this.db.seasonCommandLog.clear();
        await this.db.seasonAlmanacs.clear();
        await this.db.seasonCompletedRuns.clear();
        await this.db.seasonCompletedIndex.clear();
        await this.db.seasonRunPlayerSlices.clear();
        return;
      }
      for (const runId of runIds) {
        await this.deleteRunRows(runId);
      }
    });
  }

  // -------------------------------------------------------------------------
  // M2.6 postseason-foundations repository (SeasonPostseasonRepository).
  // -------------------------------------------------------------------------

  async commitPostseasonAdvancement(input: CommitPostseasonAdvancementInput): Promise<void> {
    const validatedRun = seasonRunSchema.parse(input.run);
    const command = seasonRunCommandSchema.parse(input.command);
    const summaries = input.summaries.map((summary) =>
      seasonPostseasonSummarySchema.parse(summary),
    );
    const details = (input.details ?? []).map((detail) =>
      seasonPostseasonDetailSchema.parse(detail),
    );
    if (validatedRun.runId !== input.runId || command.runId !== input.runId) {
      throw new SeasonRunCommandRunMismatchError(input.runId);
    }
    for (const summary of summaries) {
      if (summary.runId !== input.runId) {
        throw new SeasonRunCommandRunMismatchError(input.runId);
      }
    }
    for (const detail of details) {
      if (detail.runId !== input.runId) {
        throw new SeasonRunCommandRunMismatchError(input.runId);
      }
    }
    await this.db.transaction(
      'rw',
      [
        this.db.seasonRuns,
        this.db.seasonPostseasonSummaries,
        this.db.seasonPostseasonDetails,
        this.db.seasonCommandLog,
        this.db.seasonPendingBlocks,
      ],
      async () => {
        const checkpoint = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
        if (checkpoint === undefined) {
          throw new SeasonRunCommandRunMismatchError(input.runId);
        }
        if (
          (checkpoint as { saveSchemaVersion?: unknown }).saveSchemaVersion !==
          SEASON_RUN_SAVE_SCHEMA_VERSION
        ) {
          throw new SeasonRunCommandRunMismatchError(input.runId);
        }
        const cursor = seasonRunCursorSchema.parse(checkpoint);
        if (cursor.run.runId !== input.runId) {
          throw new SeasonRunCommandRunMismatchError(input.runId);
        }
        if (
          cursor.stateRevision !== command.expectedStateRevision ||
          cursor.stateDigest !== command.expectedStateDigest
        ) {
          throw new SeasonRunCommandStaleStateError(
            command.commandId,
            command.expectedStateRevision,
            cursor.stateRevision,
          );
        }
        const existingLogRows = await this.db.seasonCommandLog
          .where('runId')
          .equals(input.runId)
          .toArray();
        const recordedCommandIds = new Set<string>();
        if (cursor.lastCommandId !== null) recordedCommandIds.add(cursor.lastCommandId);
        if (cursor.checkpointState !== null) {
          recordedCommandIds.add(cursor.checkpointState.commandId);
        }
        for (const entry of cursor.transactions) {
          if (entry.commandId !== null) recordedCommandIds.add(entry.commandId);
        }
        for (const entry of cursor.influence.ledger) {
          if (entry.commandId !== null) recordedCommandIds.add(entry.commandId);
        }
        for (const selection of Object.values(cursor.objectives.selections)) {
          recordedCommandIds.add(selection.selectedByCommandId);
        }
        for (const row of existingLogRows) {
          const parsed = storedSeasonCommandLogRowSchema.safeParse(row);
          if (parsed.success) recordedCommandIds.add(parsed.data.entry.command.commandId);
        }
        if (recordedCommandIds.has(command.commandId)) {
          throw new SeasonRunCommandDuplicateError(command.commandId);
        }
        if (validatedRun.stateRevision !== command.expectedStateRevision + 1) {
          throw new SeasonPostseasonIntegrityError(
            `advancement ${command.commandId} must advance the state revision by exactly one`,
          );
        }

        const entries = existingLogRows
          .map((row) => storedSeasonCommandLogRowSchema.parse(row).entry)
          .sort((a, b) => a.ordinal - b.ordinal);
        // The append-only log must stay dense from ordinal 0: a gap (missing
        // row or row/entry ordinal disagreement) would make the next ordinal
        // ambiguous, so it is rejected rather than appended over.
        for (let index = 0; index < entries.length; index += 1) {
          if (entries[index]?.ordinal !== index) {
            throw new SeasonPostseasonIntegrityError(
              `command log ordinals are not dense from 0 (gap at ordinal ${String(index)})`,
            );
          }
        }
        const ordinal = entries.length;
        const entry = seasonCommandLogEntrySchema.parse({
          runId: input.runId,
          ordinal,
          command,
          preStateRevision: command.expectedStateRevision,
          preStateDigest: command.expectedStateDigest,
          postStateRevision: validatedRun.stateRevision,
          postStateDigest: validatedRun.stateDigest,
          resultDigest: seasonCheckpointDigestSchema.parse(input.resultDigest),
          previousLogDigest: seasonCommandLogDigest(entries),
          relatedGameIds: [...input.relatedGameIds].sort(),
          transactionIds: [...input.transactionIds].sort(),
        });

        const delta = seasonRunCheckpointDeltaSchema.parse({
          completedRounds: cursor.completedRounds,
          revision: cursor.revision,
          lastCommandId: cursor.lastCommandId,
          lastRotationDigest: checkpoint.lastRotationDigest,
          lastCheckpointDigest: checkpoint.lastCheckpointDigest,
          standings: checkpoint.standings,
          teamAggregates: checkpoint.teamAggregates,
          playerAggregates: checkpoint.playerAggregates,
          recap: checkpoint.recap,
          effects: checkpoint.effects,
          updatedAtIso: new Date().toISOString(),
          health: validatedRun.health,
          transactions: validatedRun.transactions,
          influence: validatedRun.influence,
          trade: validatedRun.trade,
          objectives: validatedRun.objectives,
          checkpointState: validatedRun.checkpointState,
          stateRevision: validatedRun.stateRevision,
          stateDigest: validatedRun.stateDigest,
          run: {
            rosters: validatedRun.rosters,
            ownership: validatedRun.ownership,
            rotations: validatedRun.rotations,
            stage: validatedRun.stage,
            postseason: validatedRun.postseason,
            awards: validatedRun.awards,
            completion: validatedRun.completion,
          },
        });
        await this.db.seasonRuns.put({
          ...checkpoint,
          ...delta,
          run: {
            ...checkpoint.run,
            ...delta.run,
          },
        });
        await this.db.seasonCommandLog.put({
          runId: input.runId,
          ordinal,
          entry,
          updatedAtIso: new Date().toISOString(),
        });
        if (summaries.length > 0) {
          await this.db.seasonPostseasonSummaries.bulkPut(
            summaries.map((summary) => ({
              runId: input.runId,
              gameId: summary.gameId,
              phase: summary.phase,
              summary,
              updatedAtIso: new Date().toISOString(),
            })),
          );
        }
        if (details.length > 0) {
          await this.db.seasonPostseasonDetails.bulkPut(
            details.map((detail) => ({
              runId: input.runId,
              gameId: detail.gameId,
              phase: detail.phase,
              detail,
              updatedAtIso: new Date().toISOString(),
            })),
          );
        }
      },
    );
  }

  async loadPostseasonSummaries(runId: string): Promise<SeasonPostseasonSummary[]> {
    const rows = await this.db.seasonPostseasonSummaries.where('runId').equals(runId).toArray();
    const summaries: SeasonPostseasonSummary[] = [];
    for (const row of rows) {
      const parsed = storedSeasonPostseasonSummaryRowSchema.parse(row);
      if (parsed.gameId !== parsed.summary.gameId) {
        throw new SeasonRunLoadError(
          [`postseason summary row ${row.gameId} identity does not match its facts`],
          'corrupt stored Season Run postseason summary row',
        );
      }
      summaries.push(parsed.summary);
    }
    return summaries.sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
  }

  async loadPostseasonSummary(
    runId: string,
    gameId: string,
  ): Promise<SeasonPostseasonSummary | null> {
    const row = await this.db.seasonPostseasonSummaries.get([runId, gameId]);
    if (row === undefined) return null;
    const parsed = storedSeasonPostseasonSummaryRowSchema.parse(row);
    if (parsed.gameId !== parsed.summary.gameId) {
      throw new SeasonRunLoadError(
        [`postseason summary row ${row.gameId} identity does not match its facts`],
        'corrupt stored Season Run postseason summary row',
      );
    }
    return parsed.summary;
  }

  async loadPostseasonDetails(runId: string): Promise<SeasonPostseasonDetail[]> {
    const rows = await this.db.seasonPostseasonDetails.where('runId').equals(runId).toArray();
    const details: SeasonPostseasonDetail[] = [];
    for (const row of rows) {
      const parsed = storedSeasonPostseasonDetailRowSchema.parse(row);
      if (parsed.gameId !== parsed.detail.gameId || parsed.phase !== parsed.detail.phase) {
        throw new SeasonRunLoadError(
          [`postseason detail row ${row.gameId} identity does not match its facts`],
          'corrupt stored Season Run postseason detail row',
        );
      }
      details.push(parsed.detail);
    }
    return details.sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
  }

  async loadCommandLog(runId: string): Promise<SeasonCommandLog | null> {
    const rows = await this.db.seasonCommandLog.where('runId').equals(runId).toArray();
    if (rows.length === 0) return null;
    const entries = rows
      .map((row) => {
        const parsed = storedSeasonCommandLogRowSchema.parse(row);
        if (parsed.ordinal !== parsed.entry.ordinal) {
          throw new SeasonRunLoadError(
            [`command log row ${String(row.ordinal)} does not match its entry facts`],
            'corrupt stored Season Run command log row',
          );
        }
        return parsed.entry;
      })
      .sort((a, b) => a.ordinal - b.ordinal);
    return seasonCommandLogSchema.parse({
      schemaVersion: 1,
      commandLogVersion: SEASON_COMMAND_LOG_VERSION,
      runId,
      entries,
    });
  }

  async promoteChampionToCompleted(input: PromoteChampionInput): Promise<void> {
    const validatedRun = seasonRunSchema.parse(input.run);
    const almanac = seasonAlmanacSchema.parse(input.almanac);
    const commandLog = seasonCommandLogSchema.parse(input.commandLog);
    const postseasonSummaries = input.postseasonSummaries.map((summary) =>
      seasonPostseasonSummarySchema.parse(summary),
    );
    if (validatedRun.runId !== input.runId || almanac.runId !== input.runId) {
      throw new SeasonRunCommandRunMismatchError(input.runId);
    }
    if (validatedRun.stage !== 'completed') {
      throw new SeasonPostseasonIntegrityError(
        `cannot promote a run in stage ${validatedRun.stage}`,
      );
    }
    const completion = validatedRun.completion;
    if (completion === null) {
      throw new SeasonPostseasonIntegrityError('a completed run must carry completion state');
    }
    if (
      completion.championFranchiseId !== validatedRun.postseason.championFranchiseId ||
      completion.championFranchiseId !== almanac.championFranchiseId
    ) {
      throw new SeasonPostseasonIntegrityError(
        'the run, its completion state, and the almanac must name the same champion',
      );
    }
    if (almanac.commandLogDigest !== seasonCommandLogDigest(commandLog.entries)) {
      throw new SeasonPostseasonIntegrityError('the almanac command-log digest does not reconcile');
    }
    if (commandLog.entries.length === 0) {
      throw new SeasonPostseasonIntegrityError(
        'a completed run must finalize a non-empty command log',
      );
    }
    if (completion.almanacDigest !== almanac.digest) {
      throw new SeasonPostseasonIntegrityError(
        'the run completion almanac digest does not match the almanac',
      );
    }
    const humanFranchiseId = humanTeamOf(validatedRun.league)?.franchiseId;
    if (humanFranchiseId === undefined) {
      throw new SeasonPostseasonIntegrityError('the run league contains no human franchise');
    }
    for (const summary of postseasonSummaries) {
      if (summary.runId !== input.runId) {
        throw new SeasonRunCommandRunMismatchError(input.runId);
      }
    }

    await this.db.transaction(
      'rw',
      [
        this.db.seasonRuns,
        this.db.seasonRunIndex,
        this.db.seasonPendingBlocks,
        this.db.seasonRunSummaries,
        this.db.seasonRunDetails,
        this.db.seasonRunBlocks,
        this.db.seasonPostseasonSummaries,
        this.db.seasonCommandLog,
        this.db.seasonAlmanacs,
        this.db.seasonCompletedRuns,
        this.db.seasonCompletedIndex,
      ],
      async () => {
        const checkpoint = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
        if (checkpoint === undefined) {
          throw new SeasonRunCommandRunMismatchError(input.runId);
        }
        const parsedCheckpoint = storedSeasonRunRecordSchema.safeParse(checkpoint);
        const storedRunId = parsedCheckpoint.success
          ? parsedCheckpoint.data.run.runId
          : (checkpoint as { run?: { runId?: unknown } }).run?.runId;
        if (typeof storedRunId !== 'string' || storedRunId !== input.runId) {
          throw new SeasonRunCommandRunMismatchError(input.runId);
        }

        // Freeze the final postseason summary set in completed history: the
        // rows already exist from advancement commits; promotion re-validates
        // the provided set against them (integrity, not a rewrite).
        const storedPostseasonRows = await this.db.seasonPostseasonSummaries
          .where('runId')
          .equals(input.runId)
          .toArray();
        const storedGameIds = new Set(
          storedPostseasonRows.map(
            (row) => storedSeasonPostseasonSummaryRowSchema.parse(row).gameId,
          ),
        );
        const providedGameIds = new Set(postseasonSummaries.map((summary) => summary.gameId));
        if (storedGameIds.size !== providedGameIds.size) {
          throw new SeasonPostseasonIntegrityError(
            'the frozen postseason summary set does not match the stored summaries',
          );
        }
        for (const gameId of providedGameIds) {
          if (!storedGameIds.has(gameId)) {
            throw new SeasonPostseasonIntegrityError(
              `postseason summary ${gameId} is missing from the stored set`,
            );
          }
        }
        const { games: _games, ...runWithoutGames } = validatedRun;
        await this.db.seasonCompletedRuns.put({
          runId: input.runId,
          run: runWithoutGames,
          updatedAtIso: new Date().toISOString(),
        });
        await this.db.seasonAlmanacs.put({
          runId: input.runId,
          almanac,
          updatedAtIso: new Date().toISOString(),
        });
        if (commandLog.entries.length > 0) {
          await this.db.seasonCommandLog.bulkPut(
            commandLog.entries.map((entry) => ({
              runId: input.runId,
              ordinal: entry.ordinal,
              entry,
              updatedAtIso: new Date().toISOString(),
            })),
          );
        }
        await this.db.seasonCompletedIndex.put({
          recordId: input.runId,
          runId: input.runId,
          rootSeed: validatedRun.rootSeed,
          humanFranchiseId,
          championFranchiseId: completion.championFranchiseId,
          almanacDigest: almanac.digest,
          commandLogDigest: almanac.commandLogDigest,
          completedAtIso: new Date().toISOString(),
        });
        // Remove the active-run pointer (and its pending candidate) in the
        // SAME transaction as the completed-history registration.
        await this.db.seasonRuns.delete(SEASON_RUN_RECORD_ID);
        await this.db.seasonRunIndex.delete(SEASON_RUN_RECORD_ID);
        await this.db.seasonPendingBlocks.delete(input.runId);
      },
    );
  }

  async loadCompletedSeason(runId: string): Promise<SeasonCompletedSeason | null> {
    const schedule = this.schedule;
    if (schedule === null) {
      throw new SeasonRunLoadError(
        [
          'loadCompletedSeason requires the schedule artifact for game reconstruction; ' +
            'pass it to the DexieSeasonRunRepository constructor',
        ],
        'Season Run schedule not supplied',
      );
    }
    const [completedRow, almanacRow, indexRow] = await Promise.all([
      this.db.seasonCompletedRuns.get(runId),
      this.db.seasonAlmanacs.get(runId),
      this.db.seasonCompletedIndex.get(runId),
    ]);
    if (completedRow === undefined || almanacRow === undefined || indexRow === undefined) {
      return null;
    }
    const completed = storedSeasonCompletedRunRowSchema.parse(completedRow);
    const almanac = storedSeasonAlmanacRowSchema.parse(almanacRow).almanac;
    const index = storedSeasonCompletedIndexSchema.parse(indexRow);
    if (index.runId !== runId || almanac.runId !== runId) {
      throw new SeasonRunLoadError(
        ['completed-season rows disagree about the runId'],
        'corrupt stored completed Season Run',
      );
    }
    const summaryRows = await this.db.seasonRunSummaries.where('runId').equals(runId).toArray();
    const summaries = summaryRows
      .map((row) => storedSeasonSummaryRowSchema.parse(row).summary)
      .sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
    const postseasonSummaries = await this.loadPostseasonSummaries(runId);
    const commandLog = await this.loadCommandLog(runId);
    if (commandLog === null) {
      throw new SeasonRunLoadError(
        ['completed season has no command log'],
        'corrupt stored completed Season Run',
      );
    }
    if (
      commandLog.entries.length === 0 ||
      almanac.commandLogDigest !== seasonCommandLogDigest(commandLog.entries)
    ) {
      throw new SeasonRunLoadError(
        ['completed season command log does not reconcile with the almanac'],
        'corrupt stored completed Season Run',
      );
    }
    const games = this.seam.reconstructSeasonGames(schedule, summaries);
    return seasonCompletedSeasonSchema.parse({
      run: { ...completed.run, games },
      almanac,
      commandLog,
      summaries,
      postseasonSummaries,
    });
  }

  async deleteCompletedSeason(runId: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.seasonRunSummaries,
        this.db.seasonRunDetails,
        this.db.seasonRunBlocks,
        this.db.seasonPendingBlocks,
        this.db.seasonPostseasonSummaries,
        this.db.seasonPostseasonDetails,
        this.db.seasonCommandLog,
        this.db.seasonAlmanacs,
        this.db.seasonCompletedRuns,
        this.db.seasonCompletedIndex,
        this.db.seasonRunPlayerSlices,
      ],
      async () => {
        await this.deleteRunRows(runId);
      },
    );
  }

  async listCompletedSeasonRuns(): Promise<SeasonCompletedRunIndexEntry[]> {
    const rows = await this.db.seasonCompletedIndex.orderBy('completedAtIso').reverse().toArray();
    return rows.map((row) => storedSeasonCompletedIndexSchema.parse(row));
  }

  async buildReplayExport(runId: string, gameId: string): Promise<SeasonReplayExport | null> {
    const summary = await this.loadPostseasonSummary(runId, gameId);
    if (summary === null) return null;
    const facts = {
      schemaVersion: 1,
      replayExportVersion: 'replay-export-v1',
      runId,
      gameId,
      summary,
    };
    const digest = seasonReplayExportDigest(facts as SeasonReplayExport);
    return seasonReplayExportSchema.parse({ ...facts, digest });
  }
}

/**
 * Convenience load for callers that hold the schedule artifact: validates
 * every stored row, audits aggregate reconciliation, and reassembles the
 * snapshot through the engine helper. The repository cannot fetch static
 * assets, so the schedule is an explicit input.
 */
export function loadActiveRunWithSchedule(
  schedule: SeasonSchedule,
  db: HoopRushDatabase = new HoopRushDatabase(),
): Promise<SeasonRunSnapshot | null> {
  return new DexieSeasonRunRepository(db, { schedule }).loadActiveRun();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
