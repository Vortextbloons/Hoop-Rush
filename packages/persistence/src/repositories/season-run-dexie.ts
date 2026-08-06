import {
  blockIndexForRound,
  seasonAcceptedBlockSchema,
  seasonRunSchema,
  seasonScheduleSchema,
  type SeasonAcceptedBlock,
  type SeasonActiveRunIndex,
  type SeasonGameSummary,
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
import type {
  CommitSeasonBlockInput,
  SeasonRunIncompatibleInfo,
  SeasonRunRepository,
  SeasonRunSnapshot,
} from './season-run.ts';

/**
 * Concrete IndexedDB Season Run repository (spec/2.0/07 persistence,
 * spec/2.0/10 M2.3, M2.4). The active Season Run lives in the dedicated v6
 * tables, isolated from the Challenge and Classic stores:
 *
 * - `seasonRuns`      — single checkpoint row at 'season-run' (snapshot
 *   minus the 1,230 scheduled game records, plus cursor facts, standings,
 *   aggregates, recap, and the M2.4 effects state).
 * - `seasonRunSummaries` — one compact summary per completed league game.
 * - `seasonRunDetails`   — one retained detail per human-team game.
 * - `seasonRunBlocks`    — one accepted block per commit (append-only).
 * - `seasonRunIndex`     — single lightweight active-run index row.
 *
 * `commitSeasonBlock` commits summaries, retained details, aggregates,
 * standings, cursor, revision, command id, recap, the M2.4 effects state,
 * and digests in ONE Dexie transaction: either every row commits or none
 * does, so no partial block can ever be accepted. Revision regressions and
 * duplicate command ids are rejected inside the transaction. Reads validate
 * every record through the stored schemas and run the aggregate + effects
 * reconciliation audit; corrupt or half-applied state throws a typed
 * `SeasonRunLoadError` instead of entering app state.
 *
 * ## Legacy rows (stored save schemas v1 and v2)
 *
 * Pre-v3 rows (schema-4 and schema-5 runs made under older Season rules)
 * are detected with a typed `SeasonRunIncompatibleError` and NEVER deleted
 * automatically: they cannot enter the current simulator, the UI shows the
 * explicit "Season rules changed" discard-and-restart screen, and deletion
 * happens only through `clearSeasonRun(runId)` after user confirmation. A
 * row that is corrupt beyond identification (no valid `saveSchemaVersion`)
 * still throws `SeasonRunLoadError` so corruption never enters app state.
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
  return typeof version === 'number' && version !== 3;
}

/**
 * M2.4 typed legacy-run detection (schema-4/schema-5 runs made under older
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
  if (typeof saveVersion !== 'number' || saveVersion === 3) return null;
  const runSchemaVersion =
    typeof record.run?.versions?.runSchemaVersion === 'number'
      ? record.run.versions.runSchemaVersion
      : 4;
  return {
    storedSaveSchemaVersion: saveVersion as 1,
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
      this.db.seasonRuns,
      this.db.seasonRunSummaries,
      this.db.seasonRunDetails,
      this.db.seasonRunBlocks,
      this.db.seasonRunIndex,
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

    const summaryRows = await this.db.seasonRunSummaries.where('runId').equals(runId).toArray();
    const detailRows = await this.db.seasonRunDetails.where('runId').equals(runId).toArray();
    const blockRows = await this.db.seasonRunBlocks.where('runId').equals(runId).toArray();

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

    const indexRow = await this.db.seasonRunIndex.get(SEASON_RUN_RECORD_ID);
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

    if (failures.length === 0) {
      const humanFranchiseId = stored.run.league.teams.find(
        (team) => team.control === 'human',
      )?.franchiseId;
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
    // Legacy rows (save schema v1/v2) are never migrated or auto-cleared: a
    // commit against one must fail rather than silently rewrite old rules.
    // Dexie types the row as the current schema, so the raw value is read
    // as unknown and probed at runtime (legacy rows predate the v3 literal).
    const preflight: unknown = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (preflight !== undefined && isDevelopmentRow(preflight)) {
      const info = incompatibleInfoOf(preflight);
      throw new SeasonRunIncompatibleError(
        info ?? {
          storedSaveSchemaVersion: 1,
          storedRunSchemaVersion: 4,
          runId: 'unknown-legacy-run',
        },
      );
    }
    await this.db.transaction(
      'rw',
      this.db.seasonRuns,
      this.db.seasonRunSummaries,
      this.db.seasonRunDetails,
      this.db.seasonRunBlocks,
      this.db.seasonRunIndex,
      async () => {
        const checkpoint = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
        if (checkpoint === undefined) {
          throw new Error('commitSeasonBlock: no active run checkpoint to advance');
        }
        if ((checkpoint as { saveSchemaVersion?: unknown }).saveSchemaVersion !== 3) {
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
        });
        await this.db.seasonRunBlocks.put({
          runId: input.runId,
          blockIndex,
          block: acceptedBlock,
          updatedAtIso,
        });

        const humanFranchiseId = cursor.run.league.teams.find(
          (team) => team.control === 'human',
        )?.franchiseId;
        if (humanFranchiseId === undefined) {
          throw new Error('commitSeasonBlock: the run league has no human franchise');
        }
        const humanRow = input.standings.rows.find((row) => row.franchiseId === humanFranchiseId);
        if (humanRow === undefined) {
          throw new Error('commitSeasonBlock: standings miss the human franchise');
        }

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
          effects: input.effects,
          updatedAtIso,
          run: { rotations: input.rotations },
        });
        await this.db.seasonRuns.put({
          ...checkpoint,
          ...delta,
          // The snapshot portion is promotion-immutable except the locked
          // rotations, which the commit rewrites as a full `run` slice.
          run: {
            ...checkpoint.run,
            rotations: delta.run.rotations,
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

  async promoteSeasonDraftToRun(draft: StoredSeasonDraft, run: SeasonRun): Promise<void> {
    const validatedDraft = storedSeasonDraftSchema.parse(draft);
    const validatedRun = seasonRunSchema.parse(run);
    const { games: _games, ...runWithoutGames } = validatedRun;
    const checkpointRow = storedSeasonRunRecordSchema.parse({
      recordId: SEASON_RUN_RECORD_ID,
      saveSchemaVersion: 3,
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
    });
    const humanFranchiseId = validatedRun.league.teams.find(
      (team) => team.control === 'human',
    )?.franchiseId;
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
      ],
      async () => {
        const storedDraft = await this.db.seasonDrafts.get(SEASON_DRAFT_RECORD_ID);
        if (storedDraft !== undefined && storedDraft.draft.runId !== validatedDraft.draft.runId) {
          throw new Error('promoteSeasonDraftToRun: stored draft runId does not match');
        }
        const existing = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
        if (existing !== undefined) {
          // Legacy rows (save schema v1/v2) are never overwritten or
          // migrated by a promotion: they can only be discarded explicitly.
          if (isDevelopmentRow(existing)) {
            const info = incompatibleInfoOf(existing);
            throw new SeasonRunIncompatibleError(
              info ?? {
                storedSaveSchemaVersion: 1,
                storedRunSchemaVersion: 4,
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
      this.db.seasonRuns,
      this.db.seasonRunSummaries,
      this.db.seasonRunDetails,
      this.db.seasonRunBlocks,
      this.db.seasonRunIndex,
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
