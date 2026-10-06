import {
  blockIndexForRound,
  blockRoundRange,
  buildEmptyCampaignState,
  buildEmptyChallengeState,
  commandIdSchema,
  humanTeamOf,
  isLiveSeasonRunVersions,
  normalizeEvolutionState,
  normalizeSponsorGearState,
  seasonAcceptedBlockSchema,
  seasonCampaignStateSchema,
  seasonCommandResultDigest,
  seasonFreeAgencyStateSchema,
  seasonFrontOfficeIdSchema,
  seasonHealthStateSchema,
  seasonObjectiveStateSchema,
  seasonRunSchema,
  seasonScheduleSchema,
  SEASON_FRONT_OFFICE_VERSION,
  SEASON_HEALTH_VERSION,
  SEASON_OBJECTIVE_CATALOG,
  SEASON_OBJECTIVE_VERSION,
  SEASON_RUN_SAVE_SCHEMA_VERSION,
  type SeasonAcceptedBlock,
  type SeasonActiveRunIndex,
  type SeasonCampaignState,
  type SeasonGameSummary,
  type SeasonInvalidRosterInterruption,
  type SeasonPendingBlockCandidate,
  type SeasonRetainedGameDetail,
  type SeasonRoster,
  type SeasonRun,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import { seasonBlockGameCount } from '@hoop-rush/engine';
import {
  SEASON_RUN_RECORD_ID,
  seasonRunCheckpointDeltaSchema,
  seasonRunCursorSchema,
  seasonRunPlayerSliceEntrySchema,
  storedEvolutionOf,
  storedSeasonAcceptedBlockRowSchema,
  storedSeasonActiveRunIndexSchema,
  storedSeasonDetailRowSchema,
  storedSeasonPendingBlockRowSchema,
  storedSeasonPlayerSliceRowSchema,
  storedSeasonRunRecordSchema,
  storedSeasonSummaryRowSchema,
  type SeasonRunPlayerSliceEntry,
  type StoredSeasonRunRecord,
} from '../schemas/season-run-record.ts';
import {
  SEASON_DRAFT_RECORD_ID,
  storedSeasonDraftSchema,
  type StoredSeasonDraft,
} from '../schemas/season-draft-record.ts';
import type { SeasonRunEngineSeam } from '../season/engine-seam-types.ts';
import { auditSeasonRunState } from '../season/audit.ts';
import {
  normalizeSeasonFreeAgencyState,
  normalizeSeasonInfluenceState,
  normalizeSeasonRunForPersistence,
  normalizeSeasonTransactions,
} from '../season/normalize-mutable-state.ts';
import type { HoopRushDatabase } from './dexie.ts';
import {
  assertCommandNotDuplicated,
  assertCommandStateCurrent,
  assertDenseCommandLogOrdinals,
  buildCommandLogEntry,
  loadCommandLogEntries,
  putCommandLogEntry,
  recordedCommandIdsFromCursor,
} from './season-command-log.ts';
import {
  SeasonPendingBlockRejectedError,
  SeasonRunCommandRunMismatchError,
  type CommitSeasonBlockInput,
  type SeasonRunCommandApplication,
  type SeasonRunSnapshot,
} from './season-run.ts';
import {
  SeasonRunLoadError,
  SEASON_RUN_SCOPED_TABLES,
  byGameId,
  byRevision,
  deleteRunRows,
  errorMessage,
  hasUnsupportedSaveSchema,
  topUpPlayerAggregates,
  unsupportedRulesVersionError,
  unsupportedSaveVersionError,
} from './season-run-shared.ts';
export class SeasonRunOps {
  private readonly db: HoopRushDatabase;
  private readonly schedule: SeasonSchedule | null;
  private readonly seam: SeasonRunEngineSeam;
  constructor(db: HoopRushDatabase, schedule: SeasonSchedule | null, seam: SeasonRunEngineSeam) {
    this.db = db;
    this.schedule = schedule;
    this.seam = seam;
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
        'SEASON_RUN_SCHEDULE_UNAVAILABLE',
      );
    }
    return this.loadActiveRunWithSchedule(this.schedule);
  }
  async loadActiveRunWithSchedule(schedule: SeasonSchedule): Promise<SeasonRunSnapshot | null> {
    seasonScheduleSchema.parse(schedule);
    const checkpoint = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (checkpoint === undefined) return null;
    if (hasUnsupportedSaveSchema(checkpoint)) {
      throw unsupportedSaveVersionError(checkpoint);
    }
    return this.loadValidated(checkpoint, schedule);
  }
  private async loadValidated(
    checkpoint: unknown,
    schedule: SeasonSchedule,
  ): Promise<SeasonRunSnapshot> {
    let probe: StoredSeasonRunRecord;
    try {
      probe = storedSeasonRunRecordSchema.parse(checkpoint);
    } catch (error) {
      throw new SeasonRunLoadError(
        ['stored Season Run checkpoint failed schema validation'],
        `corrupt Season Run checkpoint: ${errorMessage(error)}`,
        'SEASON_RUN_CHECKPOINT_SCHEMA_INVALID',
      );
    }
    if (!isLiveSeasonRunVersions(probe.run.versions)) {
      throw unsupportedRulesVersionError();
    }
    const snapshot = await this.db.transaction(
      'r',
      [
        this.db.seasonRuns,
        this.db.seasonRunSummaries,
        this.db.seasonRunDetails,
        this.db.seasonRunBlocks,
        this.db.seasonRunIndex,
        this.db.seasonPendingBlocks,
      ],
      async () => {
        const freshCheckpoint = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
        const active: unknown = freshCheckpoint ?? checkpoint;
        const activeRun = (active as { run?: { runId?: unknown } }).run;
        const activeRunId =
          typeof activeRun?.runId === 'string' ? activeRun.runId : probe.run.runId;
        const [summaryRows, detailRows, blockRows, indexRow, pendingRow] = await Promise.all([
          this.db.seasonRunSummaries.where('runId').equals(activeRunId).toArray(),
          this.db.seasonRunDetails.where('runId').equals(activeRunId).toArray(),
          this.db.seasonRunBlocks.where('runId').equals(activeRunId).toArray(),
          this.db.seasonRunIndex.get(SEASON_RUN_RECORD_ID),
          this.db.seasonPendingBlocks.get(activeRunId),
        ]);
        return { active, summaryRows, detailRows, blockRows, indexRow, pendingRow };
      },
    );
    let stored: StoredSeasonRunRecord;
    try {
      stored = storedSeasonRunRecordSchema.parse(snapshot.active);
    } catch (error) {
      throw new SeasonRunLoadError(
        ['stored Season Run checkpoint failed schema validation'],
        `corrupt Season Run checkpoint: ${errorMessage(error)}`,
        'SEASON_RUN_CHECKPOINT_SCHEMA_INVALID',
      );
    }
    if (!isLiveSeasonRunVersions(stored.run.versions)) {
      throw unsupportedRulesVersionError();
    }
    const failures: string[] = [];
    const runId = stored.run.runId;
    const { summaryRows, detailRows, blockRows, indexRow, pendingRow } = snapshot;
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
      throw new SeasonRunLoadError(failures, undefined, 'SEASON_RUN_STATE_VALIDATION_FAILED');
    }
    const games = this.seam.reconstructSeasonGames(schedule, summaries);
    const run = seasonRunSchema.parse({
      ...stored.run,
      games,
      standings: stored.standings,
      cursor: { schemaVersion: 1, completedRounds: stored.completedRounds },
      health: stored.health,
      transactions: stored.transactions,
      influence: stored.influence,
      trade: stored.trade,
      objectives: stored.objectives,
      challenges: stored.challenges ?? buildEmptyChallengeState(),
      campaign: stored.campaign ?? buildEmptyCampaignState(),
      checkpointState: stored.checkpointState,
      evolution: storedEvolutionOf(stored),
      sponsors: stored.run.sponsors,
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
    const preflight: unknown = await this.db.seasonRuns.get(SEASON_RUN_RECORD_ID);
    if (preflight !== undefined && hasUnsupportedSaveSchema(preflight)) {
      throw unsupportedSaveVersionError(preflight);
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
          (
            checkpoint as {
              saveSchemaVersion?: unknown;
            }
          ).saveSchemaVersion !== SEASON_RUN_SAVE_SCHEMA_VERSION
        ) {
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
        if (this.seam.seasonRotationSetDigest(input.rotations) !== input.rotationDigest) {
          throw new Error(
            'commitSeasonBlock: rotation digest does not match the submitted rotations',
          );
        }
        if (input.completedRounds < cursor.completedRounds) {
          throw new Error('commitSeasonBlock: completedRounds regression');
        }
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
        const { fromRound, toRound } = blockRoundRange(blockIndex);
        if (input.completedRounds !== toRound) {
          throw new Error(
            `commitSeasonBlock: completedRounds ${String(input.completedRounds)} is not the block end ` +
              `${String(toRound)} for block ${String(blockIndex)}`,
          );
        }
        const expectedSummaries = seasonBlockGameCount(blockIndex);
        if (input.summaries.length !== expectedSummaries) {
          throw new Error(
            `commitSeasonBlock: block ${String(blockIndex)} must carry exactly ${String(expectedSummaries)} ` +
              `summaries (got ${String(input.summaries.length)})`,
          );
        }
        const committedGameIds = new Set<string>();
        for (const summary of input.summaries) {
          if (committedGameIds.has(summary.gameId)) {
            throw new Error(
              `commitSeasonBlock: block ${String(blockIndex)} carries duplicate game ${summary.gameId}`,
            );
          }
          committedGameIds.add(summary.gameId);
          if (summary.round < fromRound || summary.round > toRound) {
            throw new Error(
              `commitSeasonBlock: game ${summary.gameId} round ${String(summary.round)} is outside block ${String(blockIndex)}`,
            );
          }
        }
        for (const detail of input.retainedDetails) {
          if (!committedGameIds.has(detail.gameId)) {
            throw new Error(
              `commitSeasonBlock: retained detail ${detail.gameId} has no committed summary in block ${String(blockIndex)}`,
            );
          }
        }
        if (
          input.recap.runId !== input.runId ||
          input.recap.blockIndex !== blockIndex ||
          input.recap.completedRounds !== input.completedRounds
        ) {
          throw new Error(
            `commitSeasonBlock: recap does not describe block ${String(blockIndex)} at round ${String(input.completedRounds)}`,
          );
        }
        await this.db.seasonRunSummaries
          .where('[runId+blockIndex]')
          .equals([input.runId, blockIndex])
          .delete();
        await this.db.seasonRunDetails
          .where('runId')
          .equals(input.runId)
          .and((row) => blockIndexForRound(row.round) === blockIndex)
          .delete();
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
        const window = input.window;
        const existingCampaign = (
          checkpoint as {
            campaign?: unknown;
          }
        ).campaign;
        const existingChallenges = (
          checkpoint as {
            challenges?: unknown;
          }
        ).challenges;
        const existingObjectives = (
          checkpoint as {
            objectives?: unknown;
          }
        ).objectives;
        const existingEvolution = (
          checkpoint as {
            evolution?: unknown;
          }
        ).evolution;
        const existingSponsors = (
          checkpoint as {
            sponsors?: unknown;
          }
        ).sponsors;
        const mutableState = {
          health: window !== null ? window.health : input.health,
          transactions: normalizeSeasonTransactions(
            window !== null ? window.transactions : input.transactions,
          ),
          influence: normalizeSeasonInfluenceState(
            window !== null ? window.influence : input.influence,
          ),
          trade: window !== null ? window.trade : input.trade,
          objectives:
            input.objectives !== undefined
              ? input.objectives
              : existingObjectives !== undefined
                ? (existingObjectives as SeasonRun['objectives'])
                : undefined,
          challenges:
            input.challenges !== undefined
              ? input.challenges
              : existingChallenges !== undefined
                ? (existingChallenges as SeasonRun['challenges'])
                : undefined,
          campaign:
            input.campaign !== undefined
              ? input.campaign
              : existingCampaign !== undefined
                ? (existingCampaign as SeasonCampaignState | null)
                : null,
          checkpointState: input.checkpointState,
          evolution:
            input.evolution !== undefined
              ? normalizeEvolutionState(input.evolution)
              : normalizeEvolutionState(existingEvolution),
          sponsors:
            input.sponsors !== undefined
              ? normalizeSponsorGearState(input.sponsors)
              : (existingSponsors as
                  import('@hoop-rush/data-contracts').SeasonSponsorGearState | undefined),
          stateRevision: input.stateRevision,
          stateDigest: input.stateDigest,
        };
        const delta = seasonRunCheckpointDeltaSchema.parse({
          completedRounds: input.completedRounds,
          revision: input.revision,
          lastCommandId: input.commandId,
          lastRotationDigest: input.rotationDigest,
          lastCheckpointDigest: input.checkpointDigest,
          standings: input.standings,
          teamAggregates: input.teamAggregates,
          playerAggregates: topUpPlayerAggregates(
            input.playerAggregates,
            window !== null ? window.rosters : (cursor.run.rosters as SeasonRoster[]),
          ),
          recap: input.recap,
          effects: window !== null ? window.effects : input.effects,
          updatedAtIso,
          ...mutableState,
          run: {
            rosters: window !== null ? window.rosters : (cursor.run.rosters as never),
            ownership: window !== null ? window.ownership : (cursor.run.ownership as never),
            rotations: window !== null ? window.rotations : input.rotations,
            freeAgency: seasonFreeAgencyStateSchema.parse(
              normalizeSeasonFreeAgencyState(input.freeAgency),
            ),
            evolution: mutableState.evolution,
            sponsors: mutableState.sponsors,
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
        (
          checkpoint as {
            saveSchemaVersion?: unknown;
          }
        ).saveSchemaVersion !== SEASON_RUN_SAVE_SCHEMA_VERSION
      ) {
        throw new SeasonPendingBlockRejectedError('the active checkpoint is not current');
      }
      const cursor = seasonRunCursorSchema.parse(checkpoint);
      if (cursor.run.runId !== pending.runId) {
        throw new SeasonPendingBlockRejectedError(
          `runId ${pending.runId} does not match the active checkpoint`,
        );
      }
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
          `cursor stateDigest ${cursor.stateDigest} does not match pending ${pending.expectedStateDigest}`,
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
  async loadPendingInterruption(runId: string): Promise<SeasonInvalidRosterInterruption | null> {
    const row = await this.db.seasonPendingBlocks.get(runId);
    if (row === undefined) return null;
    const parsed = storedSeasonPendingBlockRowSchema.parse(row);
    if (parsed.block.runId !== runId || parsed.interruption.runId !== runId) {
      throw new SeasonRunLoadError(
        ['pending block row runId does not match its key'],
        'corrupt stored Season Run pending block row',
      );
    }
    return parsed.interruption;
  }
  async discardPendingBlock(runId: string): Promise<void> {
    await this.db.seasonPendingBlocks.delete(runId);
  }
  async applySeasonRunCommand(input: SeasonRunCommandApplication): Promise<void> {
    const command = input.command;
    await this.db.transaction(
      'rw',
      this.db.seasonRuns,
      this.db.seasonPendingBlocks,
      this.db.seasonCommandLog,
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
        if (cursor.run.runId !== input.runId || command.runId !== input.runId) {
          throw new SeasonRunCommandRunMismatchError(input.runId);
        }
        if (input.run.runId !== input.runId) {
          throw new SeasonRunCommandRunMismatchError(input.runId);
        }
        assertCommandStateCurrent(cursor, command);
        const logEntries = await loadCommandLogEntries(this.db.seasonCommandLog, input.runId);
        assertCommandNotDuplicated(
          recordedCommandIdsFromCursor(cursor),
          logEntries,
          command.commandId,
        );
        assertDenseCommandLogOrdinals(
          logEntries,
          (index) =>
            new SeasonRunLoadError(
              ['command log ordinals are not dense from 0 (gap at ordinal ' + String(index) + ')'],
              'Season Run command log state is inconsistent',
            ),
        );
        const effectsForDigest = input.effects ?? checkpoint.effects;
        const run = normalizeSeasonRunForPersistence(input.run, effectsForDigest);
        const delta = seasonRunCheckpointDeltaSchema.parse({
          completedRounds: cursor.completedRounds,
          revision: cursor.revision,
          lastCommandId: cursor.lastCommandId,
          lastRotationDigest: checkpoint.lastRotationDigest,
          lastCheckpointDigest: checkpoint.lastCheckpointDigest,
          standings: checkpoint.standings,
          teamAggregates: checkpoint.teamAggregates,
          playerAggregates: topUpPlayerAggregates(checkpoint.playerAggregates, run.rosters),
          recap: checkpoint.recap,
          effects: effectsForDigest,
          updatedAtIso: new Date().toISOString(),
          health: run.health,
          transactions: run.transactions,
          influence: run.influence,
          trade: run.trade,
          objectives: run.objectives,
          challenges: run.challenges,
          campaign: run.campaign ?? null,
          evolution: normalizeEvolutionState(run.evolution),
          sponsors: normalizeSponsorGearState(run.sponsors),
          checkpointState: run.checkpointState,
          stateRevision: run.stateRevision,
          stateDigest: run.stateDigest,
          run: {
            rosters: run.rosters,
            ownership: run.ownership,
            rotations: run.rotations,
            freeAgency: run.freeAgency,
            evolution: normalizeEvolutionState(run.evolution),
            sponsors: run.sponsors,
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
        const ordinal = logEntries.length;
        const entry = buildCommandLogEntry({
          runId: input.runId,
          ordinal,
          command,
          preStateRevision: command.expectedStateRevision,
          preStateDigest: command.expectedStateDigest,
          postStateRevision: run.stateRevision,
          postStateDigest: run.stateDigest,
          resultDigest:
            input.resultDigest ??
            seasonCommandResultDigest({
              commandId: command.commandId,
              gameIds: input.relatedGameIds ?? [],
              summaryDigests: [],
            }),
          previousEntries: logEntries,
          relatedGameIds: input.relatedGameIds ?? [],
          transactionIds: input.transactionIds ?? [],
          ...(input.actor ? { actor: input.actor } : {}),
        });
        await putCommandLogEntry(this.db.seasonCommandLog, entry);
        if (input.pending === null) {
          await this.db.seasonPendingBlocks.delete(input.runId);
        } else {
          const existingPending = await this.db.seasonPendingBlocks.get(input.runId);
          if (existingPending === undefined) {
            throw new SeasonRunLoadError(
              ['a command produced a pending candidate without a prior pending row'],
              'Season Run pending block state is inconsistent',
            );
          }
          const interruption = input.pendingInterruption ?? {
            ...storedSeasonPendingBlockRowSchema.parse(existingPending).interruption,
            nextGameId: input.pending.nextGameId,
          };
          await this.db.seasonPendingBlocks.put({
            runId: input.runId,
            block: input.pending,
            interruption,
            updatedAtIso: new Date().toISOString(),
          });
        }
      },
    );
  }
  async promoteSeasonDraftToRun(
    draft: StoredSeasonDraft,
    run: SeasonRun,
    playerSlice?: SeasonRunPlayerSliceEntry[],
  ): Promise<void> {
    const validatedDraft = storedSeasonDraftSchema.parse(draft);
    const validatedRun = seasonRunSchema.parse(run);
    const { games: _games, ...runWithoutGames } = validatedRun;
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
    const challenges = validatedRun.challenges ?? buildEmptyChallengeState();
    const campaign = seasonCampaignStateSchema.parse(buildEmptyCampaignState());
    const draftFrontOffice =
      (
        validatedDraft.draft as {
          frontOffice?: {
            executiveId: unknown;
            version: unknown;
            selectedByCommandId: unknown;
          } | null;
        }
      ).frontOffice ?? null;
    const baseEvolution = normalizeEvolutionState(
      (validatedRun as { evolution?: unknown }).evolution,
    );
    let evolution = baseEvolution;
    if (draftFrontOffice !== null) {
      const parsedDraftExecutive = seasonFrontOfficeIdSchema.safeParse(
        draftFrontOffice.executiveId,
      );
      const parsedCommandId = commandIdSchema.safeParse(draftFrontOffice.selectedByCommandId);
      if (!parsedDraftExecutive.success || !parsedCommandId.success) {
        throw new Error(
          'promoteSeasonDraftToRun: draft frontOffice is malformed and cannot be promoted',
        );
      }
      evolution = {
        ...baseEvolution,
        frontOffice: {
          executiveId: parsedDraftExecutive.data,
          version: SEASON_FRONT_OFFICE_VERSION,
          selectedByCommandId: parsedCommandId.data,
          selectedAtStateRevision: 0,
        },
      };
    }
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
      challenges,
      campaign,
      evolution,
      sponsors: validatedRun.sponsors ?? null,
      rosters: validatedRun.rosters,
      ownership: validatedRun.ownership,
      rotations: validatedRun.rotations,
      effects: this.seam.zeroSeasonEffectsState(validatedRun.rosters),
      freeAgency: validatedRun.freeAgency,
      authority: validatedRun.authority,
    });
    const checkpointRow = storedSeasonRunRecordSchema.parse({
      recordId: SEASON_RUN_RECORD_ID,
      saveSchemaVersion: SEASON_RUN_SAVE_SCHEMA_VERSION,
      run: { ...runWithoutGames, evolution },
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
      challenges,
      campaign,
      evolution,
      sponsors: validatedRun.sponsors,
      checkpointState: null,
      stateRevision: 0,
      stateDigest,
    });
    const humanFranchiseId = humanTeamOf(validatedRun.league)?.franchiseId;
    if (humanFranchiseId === undefined) {
      throw new Error('promoteSeasonDraftToRun: the run league has no human franchise');
    }
    const authorityKind = validatedRun.authority.kind;
    const participantFranchiseIds =
      authorityKind === 'season-multiplayer'
        ? [validatedRun.authority.p1.franchiseId, validatedRun.authority.p2.franchiseId]
        : humanFranchiseId
          ? [humanFranchiseId]
          : [];
    const indexRow = storedSeasonActiveRunIndexSchema.parse({
      recordId: SEASON_RUN_RECORD_ID,
      index: {
        runId: validatedRun.runId,
        rootSeed: validatedRun.rootSeed,
        humanFranchiseId,
        participantFranchiseIds:
          participantFranchiseIds.length > 0 ? [...participantFranchiseIds] : undefined,
        authorityKind,
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
          if (hasUnsupportedSaveSchema(existing)) {
            throw unsupportedSaveVersionError(existing);
          }
          const existingParsed = storedSeasonRunRecordSchema.safeParse(existing);
          const existingRunId = existingParsed.success
            ? existingParsed.data.run.runId
            : typeof (
                  existing as {
                    run?: {
                      runId?: unknown;
                    };
                  }
                ).run?.runId === 'string'
              ? (
                  existing as {
                    run: {
                      runId: string;
                    };
                  }
                ).run.runId
              : null;
          if (existingRunId !== null && existingRunId !== validatedRun.runId) {
            await deleteRunRows(this.db, existingRunId);
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
          : typeof (
                checkpoint as {
                  run?: {
                    runId?: unknown;
                  };
                }
              ).run?.runId === 'string'
            ? (
                checkpoint as {
                  run: {
                    runId: string;
                  };
                }
              ).run.runId
            : null;
        if (storedRunId !== null && storedRunId !== runId) {
          throw new Error('clearSeasonRun: runId does not match the active checkpoint');
        }
      }
      await this.db.seasonRuns.delete(SEASON_RUN_RECORD_ID);
      await this.db.seasonRunIndex.delete(SEASON_RUN_RECORD_ID);
      await deleteRunRows(this.db, runId);
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
          const rawRunId = (
            checkpoint as {
              run?: {
                runId?: unknown;
              };
            }
          ).run?.runId;
          if (typeof rawRunId === 'string') runIds.add(rawRunId);
        }
      }
      await this.db.seasonRuns.delete(SEASON_RUN_RECORD_ID);
      await this.db.seasonRunIndex.delete(SEASON_RUN_RECORD_ID);
      if (runIds.size === 0) {
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
        await deleteRunRows(this.db, runId);
      }
    });
  }
}
