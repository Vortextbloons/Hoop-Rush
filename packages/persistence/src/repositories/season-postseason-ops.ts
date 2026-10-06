import {
  humanTeamOf,
  normalizeEvolutionState,
  seasonAlmanacSchema,
  seasonCommandLogDigest,
  seasonCommandLogSchema,
  seasonEffectsStateSchema,
  seasonPostseasonSummarySchema,
  seasonRunCommandSchema,
  seasonRunSchema,
  SEASON_COMMAND_LOG_VERSION,
  SEASON_RUN_SAVE_SCHEMA_VERSION,
  type SeasonCommandLog,
  type SeasonPostseasonSummary,
} from '@hoop-rush/data-contracts';
import { seasonRunEngineSeam } from '../season/engine-seam.ts';
import { normalizeSeasonRunForPersistence } from '../season/normalize-mutable-state.ts';
import {
  SEASON_RUN_RECORD_ID,
  seasonPostseasonDetailSchema,
  seasonRunCheckpointDeltaSchema,
  seasonRunCursorSchema,
  storedSeasonCommandLogRowSchema,
  storedSeasonPostseasonDetailRowSchema,
  storedSeasonPostseasonSummaryRowSchema,
  storedSeasonRunRecordSchema,
  type SeasonPostseasonDetail,
} from '../schemas/season-run-record.ts';
import type { SeasonRunEngineSeam } from '../season/engine-seam-types.ts';
import type { HoopRushDatabase } from './dexie.ts';
import {
  assertCommandNotDuplicatedAgainstStoredRows,
  assertCommandStateCurrent,
  assertDenseCommandLogOrdinals,
  buildCommandLogEntry,
  parseCommandLogEntries,
  putCommandLogEntry,
  recordedCommandIdsFromCursor,
} from './season-command-log.ts';
import {
  SeasonPostseasonIntegrityError,
  type CommitPostseasonAdvancementInput,
  type PromoteChampionInput,
} from './season-postseason.ts';
import { SeasonRunCommandRunMismatchError, SeasonRunCommandStaleStateError } from './season-run.ts';
import { SeasonRunLoadError } from './season-run-shared.ts';
export class SeasonPostseasonOps {
  private readonly db: HoopRushDatabase;
  private readonly seam: SeasonRunEngineSeam;
  constructor(db: HoopRushDatabase, seam: SeasonRunEngineSeam) {
    this.db = db;
    this.seam = seam;
  }
  async commitPostseasonAdvancement(input: CommitPostseasonAdvancementInput): Promise<void> {
    const validatedRun = seasonRunSchema.parse(
      normalizeSeasonRunForPersistence(
        input.run,
        input.effects ?? seasonRunEngineSeam.zeroSeasonEffectsState(input.run.rosters),
      ),
    );
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
          (
            checkpoint as {
              saveSchemaVersion?: unknown;
            }
          ).saveSchemaVersion !== SEASON_RUN_SAVE_SCHEMA_VERSION
        ) {
          throw new SeasonRunCommandRunMismatchError(input.runId);
        }
        const cursor = seasonRunCursorSchema.parse(checkpoint);
        if (cursor.run.runId !== input.runId) {
          throw new SeasonRunCommandRunMismatchError(input.runId);
        }
        assertCommandStateCurrent(cursor, command);
        const existingLogRows = await this.db.seasonCommandLog
          .where('runId')
          .equals(input.runId)
          .toArray();
        assertCommandNotDuplicatedAgainstStoredRows(
          recordedCommandIdsFromCursor(cursor, { includeEvolution: false }),
          existingLogRows,
          command.commandId,
        );
        if (validatedRun.stateRevision !== command.expectedStateRevision + 1) {
          throw new SeasonPostseasonIntegrityError(
            `advancement ${command.commandId} must advance the state revision by exactly one`,
          );
        }
        const logEntries = parseCommandLogEntries(existingLogRows);
        assertDenseCommandLogOrdinals(
          logEntries,
          (index) =>
            new SeasonPostseasonIntegrityError(
              `command log ordinals are not dense from 0 (gap at ordinal ${String(index)})`,
            ),
        );
        const ordinal = logEntries.length;
        const entry = buildCommandLogEntry({
          runId: input.runId,
          ordinal,
          command,
          preStateRevision: command.expectedStateRevision,
          preStateDigest: command.expectedStateDigest,
          postStateRevision: validatedRun.stateRevision,
          postStateDigest: validatedRun.stateDigest,
          resultDigest: input.resultDigest,
          previousEntries: logEntries,
          relatedGameIds: input.relatedGameIds,
          transactionIds: input.transactionIds,
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
          effects:
            input.effects !== undefined
              ? seasonEffectsStateSchema.parse(input.effects)
              : checkpoint.effects,
          updatedAtIso: new Date().toISOString(),
          health: validatedRun.health,
          transactions: validatedRun.transactions,
          influence: validatedRun.influence,
          trade: validatedRun.trade,
          objectives: validatedRun.objectives,
          campaign: validatedRun.campaign ?? null,
          evolution: normalizeEvolutionState(validatedRun.evolution),
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
            freeAgency: validatedRun.freeAgency,
            evolution: normalizeEvolutionState(validatedRun.evolution),
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
        await putCommandLogEntry(this.db.seasonCommandLog, entry);
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
          : (
              checkpoint as {
                run?: {
                  runId?: unknown;
                };
              }
            ).run?.runId;
        if (typeof storedRunId !== 'string' || storedRunId !== input.runId) {
          throw new SeasonRunCommandRunMismatchError(input.runId);
        }
        let cursor;
        try {
          cursor = seasonRunCursorSchema.parse(checkpoint);
        } catch {
          throw new SeasonPostseasonIntegrityError(
            'the stored run checkpoint cannot be read for champion promotion',
          );
        }
        if (
          cursor.stateRevision !== input.expectedStateRevision ||
          cursor.stateDigest !== input.expectedStateDigest ||
          cursor.revision !== input.expectedRevision
        ) {
          throw new SeasonRunCommandStaleStateError(
            input.runId,
            input.expectedStateRevision,
            cursor.stateRevision,
          );
        }
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
        await this.db.seasonRuns.delete(SEASON_RUN_RECORD_ID);
        await this.db.seasonRunIndex.delete(SEASON_RUN_RECORD_ID);
        await this.db.seasonPendingBlocks.delete(input.runId);
      },
    );
  }
}
