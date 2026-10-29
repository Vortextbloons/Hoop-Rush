import type {
  CapRushCommand,
  CapRushCommandResult,
  CapRushDraftState,
  CapRushHistoryEntry,
  CapRushReport,
  CapRushStoredGame,
  CommandId,
  Id,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_SAVE_SCHEMA_VERSION,
  canonicalJson,
  capRushCommandResultSchema,
  capRushCommandSchema,
  capRushReportSchema,
  capRushStoredGameSchema,
} from '@hoop-rush/data-contracts';
import { capRushStateDigest } from '@hoop-rush/engine';
import {
  CAP_RUSH_ACTIVE_DRAFT_RECORD_ID,
  storedCapRushCommandRowSchema,
  storedCapRushDraftRowSchema,
  storedCapRushGameRowSchema,
  storedCapRushHistoryRowSchema,
  storedCapRushReportRowSchema,
} from '../schemas/cap-rush-record.ts';
import { HoopRushDatabase } from './dexie.ts';
import {
  assertSaveSchemaVersion,
  commandReceiptMatches,
  listCompletedHistory,
  parseRecord,
  scopedNumericRows,
} from './support.ts';

export interface CapRushApplyOutcomeInput {
  readonly outcome: {
    readonly state: CapRushDraftState;
    readonly result: CapRushCommandResult;
  };
  readonly command: CapRushCommand;
  readonly game?: CapRushStoredGame;
  readonly report?: CapRushReport;
}

export interface CapRushCompletedRun {
  readonly entry: CapRushHistoryEntry;
  readonly report: CapRushReport | null;
}

export interface CapRushRepository {
  loadActiveDraft(): Promise<CapRushDraftState | null>;
  loadCommandResult(commandId: string): Promise<CapRushCommandResult | null>;
  applyOutcome(input: CapRushApplyOutcomeInput): Promise<CapRushCommandResult>;
  clearActiveDraft(): Promise<void>;
}
export class CapRushLoadError extends Error {
  readonly code: 'unsupported' | 'malformed';
  readonly diagnostics: readonly string[];
  constructor(code: 'unsupported' | 'malformed', diagnostics: readonly string[]) {
    super(`cap rush draft could not be loaded: ${diagnostics.join('; ')}`);
    this.name = 'CapRushLoadError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export class CapRushCommandConflictError extends Error {
  readonly commandId: string;
  constructor(commandId: string) {
    super(`cap rush command ${commandId} was reused with a different payload`);
    this.name = 'CapRushCommandConflictError';
    this.commandId = commandId;
  }
}

export class CapRushStaleRevisionError extends Error {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;
  constructor(commandId: string, expectedRevision: number, actualRevision: number) {
    super(
      `cap rush command ${commandId} expected revision ${String(expectedRevision)} but the stored draft is at ${String(actualRevision)}`,
    );
    this.name = 'CapRushStaleRevisionError';
    this.commandId = commandId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class CapRushActiveDraftExistsError extends Error {
  readonly activeRunId: string;
  readonly requestedRunId: string;
  constructor(activeRunId: string, requestedRunId: string) {
    super(`cap rush run ${requestedRunId} cannot start while ${activeRunId} is active`);
    this.name = 'CapRushActiveDraftExistsError';
    this.activeRunId = activeRunId;
    this.requestedRunId = requestedRunId;
  }
}

function malformed(message: string): CapRushLoadError {
  return new CapRushLoadError('malformed', [message]);
}

function unsupported(message: string): CapRushLoadError {
  return new CapRushLoadError('unsupported', [message]);
}

function asRunId(runId: string): Id {
  return runId as Id;
}

export class DexieCapRushRepository implements CapRushRepository {
  private readonly db: HoopRushDatabase;
  constructor(db: HoopRushDatabase) {
    this.db = db;
  }

  async loadActiveDraft(): Promise<CapRushDraftState | null> {
    const row: unknown = await this.db.capRushActive.get(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
    if (row === undefined) return null;
    assertSaveSchemaVersion(row, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
    const parsed = parseRecord(
      storedCapRushDraftRowSchema,
      row,
      'active cap rush draft',
      malformed,
    );
    if (capRushStateDigest(parsed.draft) !== parsed.stateDigest) {
      throw malformed('active cap rush draft digest does not match its state');
    }
    return parsed.draft;
  }

  async loadCommandResult(commandId: string): Promise<CapRushCommandResult | null> {
    const row: unknown = await this.db.capRushCommands.get(commandId as CommandId);
    if (row === undefined) return null;
    assertSaveSchemaVersion(row, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
    return parseRecord(
      storedCapRushCommandRowSchema,
      row,
      `cap rush command ${commandId}`,
      malformed,
    ).result;
  }

  async applyOutcome(input: CapRushApplyOutcomeInput): Promise<CapRushCommandResult> {
    const result = capRushCommandResultSchema.parse(input.outcome.result);
    const command = capRushCommandSchema.parse(input.command);
    const state = input.outcome.state;
    if (command.commandId !== result.commandId || command.runId !== result.runId) {
      throw malformed('cap rush command envelope does not match the outcome receipt');
    }
    if (state.runId !== result.runId) {
      throw malformed('cap rush outcome state belongs to another run');
    }
    if (capRushStateDigest(state) !== result.stateDigest) {
      throw malformed('cap rush outcome state digest does not match the receipt');
    }
    const accepted = result.status === 'accepted';
    if (accepted) {
      if (result.revisionAfter <= result.revisionBefore) {
        throw malformed('accepted cap rush commands must advance the draft revision');
      }
      if (state.revision !== result.revisionAfter) {
        throw malformed('accepted cap rush state revision does not match the receipt');
      }
    } else if (
      result.revisionAfter !== result.revisionBefore ||
      state.revision !== result.revisionBefore
    ) {
      throw malformed('rejected cap rush commands must not change the draft revision');
    }
    const game =
      input.game === undefined
        ? null
        : parseRecord(capRushStoredGameSchema, input.game, 'accepted cap rush game', malformed);
    const report =
      input.report === undefined
        ? null
        : parseRecord(capRushReportSchema, input.report, 'cap rush season report', malformed);
    if (!accepted && (game !== null || report !== null)) {
      throw malformed('rejected cap rush commands cannot carry stored artifacts');
    }
    if (game !== null) {
      if (command.command !== 'accept-cap-rush-game') {
        throw malformed('stored cap rush games require an accept command');
      }
      if (
        command.cursor !== game.gameNumber ||
        canonicalJson(command.summary) !== canonicalJson(game.summary)
      ) {
        throw malformed('accept command does not describe the stored game');
      }
      if (
        game.summary.inputDigest !== command.inputDigest ||
        game.summary.resultDigest !== command.resultDigest
      ) {
        throw malformed('stored game digests do not match the accept command');
      }
      if (canonicalJson(state.season.games[game.gameNumber - 1]) !== canonicalJson(game.summary)) {
        throw malformed('stored game is missing from the accepted season state');
      }
    }
    if (report !== null) {
      if (command.command !== 'finalize-cap-rush-season') {
        throw malformed('a cap rush season report requires the finalize command');
      }
      if (report.runId !== result.runId) {
        throw malformed('cap rush season report belongs to another run');
      }
      if (state.season.completedAt === null) {
        throw malformed('a cap rush season report requires a completed season');
      }
      if (
        canonicalJson(report.aggregate) !== canonicalJson(state.season.aggregate) ||
        canonicalJson(report.apronTriggers) !== canonicalJson(state.season.apronTriggers) ||
        canonicalJson(report.games) !== canonicalJson(state.season.games)
      ) {
        throw malformed('cap rush season report does not match the accepted season state');
      }
      if (
        state.locked === null ||
        report.variant !== state.locked.variant ||
        report.payrollDollars !== state.locked.payrollDollars ||
        report.payrollStatus !== state.locked.payrollStatus
      ) {
        throw malformed('cap rush season report does not match the locked inputs');
      }
    }

    return this.db.transaction(
      'rw',
      [
        this.db.capRushActive,
        this.db.capRushCommands,
        this.db.capRushGames,
        this.db.capRushHistory,
        this.db.capRushReports,
      ],
      async () => {
        const existingCommandRow: unknown = await this.db.capRushCommands.get(result.commandId);
        if (existingCommandRow !== undefined) {
          assertSaveSchemaVersion(existingCommandRow, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
          const existing = parseRecord(
            storedCapRushCommandRowSchema,
            existingCommandRow,
            `cap rush command ${result.commandId}`,
            malformed,
          );
          if (
            commandReceiptMatches(command, existing.command) &&
            existing.result.status === result.status
          ) {
            return existing.result;
          }
          throw new CapRushCommandConflictError(result.commandId);
        }

        const now = new Date().toISOString();
        const activeRow: unknown = await this.db.capRushActive.get(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
        let createdAtIso = now;
        if (activeRow !== undefined) {
          assertSaveSchemaVersion(activeRow, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
          const active = parseRecord(
            storedCapRushDraftRowSchema,
            activeRow,
            'active cap rush draft',
            malformed,
          );
          if (active.draft.revision !== result.revisionBefore) {
            throw new CapRushStaleRevisionError(
              result.commandId,
              result.revisionBefore,
              active.draft.revision,
            );
          }
          if (active.runId !== result.runId) {
            throw new CapRushActiveDraftExistsError(active.runId, result.runId);
          }
          createdAtIso = active.createdAtIso;
        }

        if (accepted) {
          if (activeRow === undefined && result.revisionBefore !== 0) {
            throw new CapRushStaleRevisionError(result.commandId, result.revisionBefore, 0);
          }
          await this.db.capRushActive.put(
            storedCapRushDraftRowSchema.parse({
              saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
              recordId: CAP_RUSH_ACTIVE_DRAFT_RECORD_ID,
              runId: state.runId,
              revision: state.revision,
              stateDigest: capRushStateDigest(state),
              draft: state,
              createdAtIso,
              updatedAtIso: now,
            }),
          );
          if (game !== null) {
            await this.db.capRushGames.put(
              storedCapRushGameRowSchema.parse({
                saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
                runId: result.runId,
                gameNumber: game.gameNumber,
                game,
                updatedAtIso: now,
              }),
            );
          }
          if (report !== null) {
            await this.db.capRushReports.put(
              storedCapRushReportRowSchema.parse({
                saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
                runId: result.runId,
                report,
                updatedAtIso: now,
              }),
            );
            await this.putHistory(state);
          }
        }

        await this.db.capRushCommands.put(
          storedCapRushCommandRowSchema.parse({
            saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
            commandId: result.commandId,
            runId: result.runId,
            command,
            result,
            updatedAtIso: now,
          }),
        );
        return result;
      },
    );
  }

  async clearActiveDraft(): Promise<void> {
    await this.db.transaction('rw', [this.db.capRushActive, this.db.capRushCommands], async () => {
      const row: unknown = await this.db.capRushActive.get(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
      await this.db.capRushActive.delete(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
      if (row === undefined) return;
      const runId =
        typeof row === 'object' && row !== null && 'runId' in row
          ? (row as { runId?: unknown }).runId
          : undefined;
      if (typeof runId === 'string') {
        await this.db.capRushCommands.where('runId').equals(runId).delete();
      }
    });
  }

  async listRunGames(runId: string): Promise<CapRushStoredGame[]> {
    const rows = await scopedNumericRows(this.db.capRushGames, '[runId+gameNumber]', runId);
    return rows
      .map((row) => {
        assertSaveSchemaVersion(row, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
        return parseRecord(storedCapRushGameRowSchema, row, `cap rush game ${runId}`, malformed);
      })
      .sort((left, right) => left.gameNumber - right.gameNumber)
      .map((row) => row.game);
  }

  async readRunGame(runId: string, gameNumber: number): Promise<CapRushStoredGame | null> {
    const row: unknown = await this.db.capRushGames.get([runId, gameNumber]);
    if (row === undefined) return null;
    assertSaveSchemaVersion(row, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
    return parseRecord(
      storedCapRushGameRowSchema,
      row,
      `cap rush game ${runId}/${String(gameNumber)}`,
      malformed,
    ).game;
  }

  async listHistory(): Promise<CapRushHistoryEntry[]> {
    const rows = await listCompletedHistory(this.db.capRushHistory, 'completedAtIso');
    return rows.map((row) => this.historyEntryOf(row, 'cap rush history'));
  }

  async readReport(runId: string): Promise<CapRushReport | null> {
    const row: unknown = await this.db.capRushReports.get(asRunId(runId));
    if (row === undefined) return null;
    assertSaveSchemaVersion(row, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
    return parseRecord(storedCapRushReportRowSchema, row, `cap rush report ${runId}`, malformed)
      .report;
  }

  async readCompletedRun(runId: string): Promise<CapRushCompletedRun | null> {
    const row: unknown = await this.db.capRushHistory.get(asRunId(runId));
    if (row === undefined) return null;
    return {
      entry: this.historyEntryOf(row, `cap rush history ${runId}`),
      report: await this.readReport(runId),
    };
  }

  private historyEntryOf(row: unknown, label: string): CapRushHistoryEntry {
    assertSaveSchemaVersion(row, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
    const parsed = parseRecord(storedCapRushHistoryRowSchema, row, label, malformed);
    return {
      runId: parsed.runId,
      variant: parsed.variant,
      payrollStatus: parsed.payrollStatus,
      payrollDollars: parsed.payrollDollars,
      wins: parsed.wins,
      losses: parsed.losses,
      perfectSeason: parsed.perfectSeason,
      completedAtIso: parsed.completedAtIso,
    };
  }

  private async putHistory(state: CapRushDraftState): Promise<void> {
    const completedAtIso = state.season.completedAt;
    if (completedAtIso === null) {
      throw malformed('an incomplete cap rush season cannot be written to history');
    }
    if (state.locked === null) {
      throw malformed('a completed cap rush run requires locked inputs');
    }
    const aggregate = state.season.aggregate;
    await this.db.capRushHistory.put(
      storedCapRushHistoryRowSchema.parse({
        saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
        runId: state.runId,
        variant: state.locked.variant,
        payrollStatus: state.locked.payrollStatus,
        payrollDollars: state.locked.payrollDollars,
        wins: aggregate.wins,
        losses: aggregate.losses,
        perfectSeason: aggregate.perfectSeason,
        completedAtIso,
      }),
    );
  }
}
