import {
  blockIndexForRound,
  humanTeamOf,
  seasonAcceptedBlockSchema,
  seasonRunSchema,
  seasonScheduleSchema,
  SEASON_OBJECTIVE_CATALOG,
  SEASON_OBJECTIVE_VERSION,
  seasonObjectiveStateSchema,
  SEASON_HEALTH_VERSION,
  seasonHealthStateSchema,
  type SeasonAcceptedBlock,
  type SeasonActiveRunIndex,
  type SeasonGameSummary,
  type SeasonInvalidRosterInterruption,
  type SeasonPendingBlockCandidate,
  type SeasonRetainedGameDetail,
  type SeasonRun,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import {
  SEASON_RUN_RECORD_ID,
  seasonRunCheckpointDeltaSchema,
  seasonRunCursorSchema,
  storedSeasonAcceptedBlockRowSchema,
  storedSeasonActiveRunIndexSchema,
  storedSeasonDetailRowSchema,
  storedSeasonPendingBlockRowSchema,
  storedSeasonRunRecordSchema,
  storedSeasonSummaryRowSchema,
  type StoredSeasonRunRecord,
} from '../schemas/season-run-record.ts';
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

/**
 * Concrete IndexedDB Season Run repository (spec/2.0/07 persistence,
 * spec/2.0/10 M2.3, M2.4, M2.5). The active Season Run lives in the
 * dedicated v6/v7 tables, isolated from the Challenge and Classic stores:
 *
 * - `seasonRuns`      — single checkpoint row at 'season-run' (snapshot
 *   minus the 1,230 scheduled game records, plus cursor facts, standings,
 *   aggregates, recap, the M2.4 effects state, and the M2.5 mutable run
 *   state: health, transactions, influence, trade, objectives,
 *   checkpointState, stateRevision, stateDigest).
 * - `seasonRunSummaries` — one compact summary per completed league game.
 * - `seasonRunDetails`   — one retained detail per human-team game.
 * - `seasonRunBlocks`    — one accepted block per commit (append-only).
 * - `seasonRunIndex`     — single lightweight active-run index row.
 * - `seasonPendingBlocks` (v7) — one interrupted-block pending candidate
 *   per run, keyed by runId.
 *
 * `commitSeasonBlock` commits summaries, retained details, aggregates,
 * standings, cursor, revision, command id, recap, the M2.4 effects state,
 * the M2.5 mutable run state, an opened trade window's mutated
 * rosters/ownership/rotations/effects, and digests in ONE Dexie
 * transaction: either every row commits or none does, so no partial block
 * can ever be accepted. Revision regressions, duplicate command ids, and
 * stale expected state facts are rejected inside the transaction, and any
 * pending-block row for the run is deleted with it. Reads validate every
 * record through the stored schemas and run the aggregate + effects +
 * health/influence/transaction/state-chain/trade/pending reconciliation
 * audit; corrupt or half-applied state throws a typed `SeasonRunLoadError`
 * instead of entering app state.
 *
 * ## Legacy rows (stored save schemas v1, v2, and v3)
 *
 * Pre-v4 rows (schema-4, schema-5, and schema-6 runs made under older
 * Season rules) are detected with a typed `SeasonRunIncompatibleError` and
 * NEVER deleted automatically: they cannot enter the current simulator, the
 * UI shows the explicit "Season rules changed" discard-and-restart screen,
 * and deletion happens only through `clearSeasonRun(runId)` after user
 * confirmation. A row that is corrupt beyond identification (no valid
 * `saveSchemaVersion`) still throws `SeasonRunLoadError` so corruption
 * never enters app state.
 *
 * ## Schedule supply
 *
 * The repository never fetches static assets: `SeasonGame` records are
 * reassembled from the schedule artifact plus the stored summaries via the
 * engine helper `reconstructSeasonGames`, so reload needs the schedule. Pass
 * it to the constructor (used by `loadActiveRun()`) or call
 * `loadActiveRunWithSchedule(schedule)`; the exported convenience function of
 * the same name does the full load for callers that have the artifact at
 * hand. `loadActiveRun()` throws a typed error when no schedule was supplied.
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

/** True when the raw row carries a saveSchemaVersion outside the current family. */
function isDevelopmentRow(row: unknown): boolean {
  if (typeof row !== 'object' || row === null) return false;
  const version = (row as { saveSchemaVersion?: unknown }).saveSchemaVersion;
  return typeof version === 'number' && version !== 4;
}

/**
 * M2.5 typed legacy-run detection (schema-4/schema-5/schema-6 runs made
 * under older Season rules). The stored row is preserved byte-for-byte;
 * callers surface the info through the discard-and-restart screen and delete
 * only after the user confirms via `clearSeasonRun(runId)`.
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
  if (typeof saveVersion !== 'number' || saveVersion === 4) return null;
  const runSchemaVersion =
    typeof record.run?.versions?.runSchemaVersion === 'number'
      ? record.run.versions.runSchemaVersion
      : 7;
  return {
    storedSaveSchemaVersion: 4,
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

export class DexieSeasonRunRepository implements SeasonRunRepository {
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
   * caller supplies the schedule artifact (the repository cannot fetch
   * static assets); every stored row is validated and the aggregate +
   * effects reconciliation audit runs before anything is returned. A
   * stored development row (save-schema v1/v2) is auto-cleared and reported
   * as null.
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
    return this.loadValidated(checkpoint, schedule);
  }

  /** Deletes the checkpoint row, the index row, and every run row of a development checkpoint. */
  private async clearDevelopmentRow(): Promise<void> {
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
        if (checkpoint === undefined) return;
        await this.db.seasonRuns.delete(SEASON_RUN_RECORD_ID);
        await this.db.seasonRunIndex.delete(SEASON_RUN_RECORD_ID);
        const runId = (checkpoint as { run?: { runId?: unknown } }).run?.runId;
        if (typeof runId === 'string') {
          await this.db.seasonRunSummaries.where('runId').equals(runId).delete();
          await this.db.seasonRunDetails.where('runId').equals(runId).delete();
          await this.db.seasonRunBlocks.where('runId').equals(runId).delete();
          await this.db.seasonPendingBlocks.delete(runId);
        }
      },
    );
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

    // M2.5: the interrupted-block pending row participates in the reload
    // audit (a pending row for a committed blockIndex is an error).
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
    const rows = await this.db.seasonRunSummaries
      .where('blockIndex')
      .equals(blockIndex)
      .and((row) => row.runId === runId)
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
    // Legacy rows (save schema v1-v3) are never migrated or auto-cleared: a
    // commit against one must fail rather than silently rewrite old rules.
    // Dexie types the row as the current schema, so the raw value is read
    // as unknown and probed at runtime (legacy rows predate the v4 literal).
    const preflight: unknown = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (preflight !== undefined && isDevelopmentRow(preflight)) {
      const info = incompatibleInfoOf(preflight);
      throw new SeasonRunIncompatibleError(
        info ?? {
          storedSaveSchemaVersion: 4,
          storedRunSchemaVersion: 7,
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
        if ((checkpoint as { saveSchemaVersion?: unknown }).saveSchemaVersion !== 4) {
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
        // stale candidate (a command or another block advanced the state
        // chain after assembly) is rejected inside the transaction.
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
          .where('blockIndex')
          .equals(blockIndex)
          .and((row) => row.runId === input.runId)
          .delete();
        await this.db.seasonRunDetails
          .where('runId')
          .equals(input.runId)
          .and((row) => blockIndexForRound(row.round) === blockIndex)
          .delete();
        // M2.5: the commit deletes any pending-block row for the run in the
        // SAME transaction (interrupted work for this block is now moot).
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

        // M2.5: when the engine produced a trade-window open for this
        // commit, the window's mutated rosters/ownership/rotations/effects/
        // trade/influence/transactions replace the block's own (the window
        // folds AI trades/spends on top of the post-block state). The
        // commit's stateRevision/stateDigest already include the window.
        const window = input.window;
        const mutableState = {
          health: input.health,
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
          // rotations and any window-mutated rosters/ownership, which the
          // commit rewrites as a full `run` slice.
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
      if ((checkpoint as { saveSchemaVersion?: unknown }).saveSchemaVersion !== 4) {
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
      if ((checkpoint as { saveSchemaVersion?: unknown }).saveSchemaVersion !== 4) {
        throw new SeasonRunCommandRunMismatchError(input.runId);
      }
      const cursor = seasonRunCursorSchema.parse(checkpoint);
      if (cursor.run.runId !== input.runId || command.runId !== input.runId) {
        throw new SeasonRunCommandRunMismatchError(input.runId);
      }
      if (input.run.runId !== input.runId) {
        throw new SeasonRunCommandRunMismatchError(input.runId);
      }
      // The command asserted the run state facts it was assembled against;
      // a stale command is rejected (the engine recomputes the digest).
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
      // Bounded commandId dedupe against the recorded command history:
      // the last accepted block's command, the checkpoint command, the
      // transaction log, the Influence ledger, and objective selections.
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

      // Store the engine-produced mutable run state. The snapshot's
      // rosters/ownership/rotations slices are rewritten (trades move
      // players); the row-level mutable columns take the engine's run.
      // Standings/aggregates/recap never change between blocks; the
      // current row values are preserved through the delta parse.
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
        // require an existing pending row (the typed command rejections
        // enforce it). Preserve the recorded interruption facts, advancing
        // `nextGameId` to the pending's current value.
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

  async promoteSeasonDraftToRun(draft: StoredSeasonDraft, run: SeasonRun): Promise<void> {
    const validatedDraft = storedSeasonDraftSchema.parse(draft);
    const validatedRun = seasonRunSchema.parse(run);
    const { games: _games, ...runWithoutGames } = validatedRun;
    // M2.5 initial mutable run state: empty health, empty transaction log,
    // the engine's initial Influence state (+2 per franchise), null trade
    // state, the fixed objective catalog with no selections, a null
    // checkpoint state, and stateRevision 0 with the canonical digest over
    // the initial facts.
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
      saveSchemaVersion: 4,
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
      [
        this.db.seasonRuns,
        this.db.seasonRunSummaries,
        this.db.seasonRunDetails,
        this.db.seasonRunBlocks,
        this.db.seasonRunIndex,
        this.db.seasonDrafts,
        this.db.seasonPendingBlocks,
      ],
      async () => {
        const storedDraft = await this.db.seasonDrafts.get(SEASON_DRAFT_RECORD_ID);
        if (storedDraft !== undefined && storedDraft.draft.runId !== validatedDraft.draft.runId) {
          throw new Error('promoteSeasonDraftToRun: stored draft runId does not match');
        }
        const existing = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
        if (existing !== undefined) {
          // Legacy rows (save schema v1-v3) are never overwritten or
          // migrated by a promotion: they can only be discarded explicitly.
          if (isDevelopmentRow(existing)) {
            const info = incompatibleInfoOf(existing);
            throw new SeasonRunIncompatibleError(
              info ?? {
                storedSaveSchemaVersion: 4,
                storedRunSchemaVersion: 7,
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
          if (existingRunId !== null && existingRunId !== validatedRun.runId) {
            await this.db.seasonRunSummaries.where('runId').equals(existingRunId).delete();
            await this.db.seasonRunDetails.where('runId').equals(existingRunId).delete();
            await this.db.seasonRunBlocks.where('runId').equals(existingRunId).delete();
            await this.db.seasonPendingBlocks.delete(existingRunId);
          }
        }
        await this.db.seasonRuns.put(checkpointRow);
        await this.db.seasonRunIndex.put(indexRow);
        await this.db.seasonDrafts.delete(SEASON_DRAFT_RECORD_ID);
      },
    );
  }

  async clearSeasonRun(runId: string): Promise<void> {
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
        await this.db.seasonRunSummaries.where('runId').equals(runId).delete();
        await this.db.seasonRunDetails.where('runId').equals(runId).delete();
        await this.db.seasonRunBlocks.where('runId').equals(runId).delete();
        await this.db.seasonPendingBlocks.delete(runId);
      },
    );
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
