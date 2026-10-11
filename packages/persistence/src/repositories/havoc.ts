import type { Table } from 'dexie';
import { z } from 'zod';
import {
  HAVOC_GAME_COUNT,
  HAVOC_SAVE_SCHEMA_VERSION,
  canonicalJson,
  havocCommandResultSchema,
  havocCommandSchema,
  havocComparisonSchema,
  havocGameResultSchema,
  havocGameTapeSchema,
  havocReportSchema,
  havocRunStateSchema,
  seasonDigestHex,
  type CommandId,
  type HavocCommand,
  type HavocCommandResult,
  type HavocComparison,
  type HavocGameResult,
  type HavocGameTape,
  type HavocReport,
  type HavocRunState,
  type HavocVariant,
  type Id,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_ACTIVE_RECORD_ID,
  havocDigestTextSchema,
  storedHavocActiveRunSchema,
  storedHavocCommandRowSchema,
  storedHavocCompletedRunSchema,
  storedHavocGameRowSchema,
  storedHavocHistoryRowSchema,
  storedHavocRetainedTapeSchema,
  type StoredHavocActiveRun,
  type StoredHavocCompletedRun,
} from '../schemas/havoc-record.ts';
import { HoopRushDatabase } from './dexie.ts';

export interface HavocCommandOutcome {
  readonly state: HavocRunState;
  readonly result: HavocCommandResult;
}

export interface HavocApplyOutcomeInput {
  outcome: HavocCommandOutcome;
  game?: {
    result: HavocGameResult;
    inputDigest: string;
    resultDigest: string;
  };
  tape?: {
    tape: HavocGameTape;
    tapeDigest: string;
    selectedRank?: number;
  };
  comparison?: HavocComparison;
  report?: HavocReport;
  command?: HavocCommand;
}

export interface HavocHistoryEntry {
  runId: string;
  createdAtIso: string;
  updatedAtIso: string;
  havocWins: number;
  havocLosses: number;
  perfectSeason: boolean;
  comparisonStatus: 'not-started' | 'running' | 'complete' | 'unsupported';
  completionState: 'season' | 'comparison' | 'complete' | 'abandoned';
}

export interface HavocRepository {
  loadActiveRun(): Promise<HavocRunState | null>;
  loadCommandResult(commandId: string): Promise<HavocCommandResult | null>;
  applyOutcome(input: HavocApplyOutcomeInput): Promise<HavocCommandResult>;
  listRunGames(runId: string, variant: HavocVariant): Promise<HavocGameResult[]>;
  readRunGame(
    runId: string,
    variant: HavocVariant,
    gameNumber: number,
  ): Promise<{ result: HavocGameResult; resultDigest: string } | null>;
  readRetainedTape(runId: string, gameNumber: number): Promise<HavocGameTape | null>;
  writeRetainedTape(
    runId: string,
    gameNumber: number,
    tape: HavocGameTape,
    tapeDigest: string,
    selectedRank: number,
  ): Promise<void>;
  readComparison(runId: string): Promise<HavocComparison | null>;
  readReport(runId: string): Promise<HavocReport | null>;
  listHistory(): Promise<HavocHistoryEntry[]>;
  readCompletedRun(
    runId: string,
  ): Promise<{ state: HavocRunState; report: HavocReport | null } | null>;
}

export type HavocLoadFailureCode = 'corrupt' | 'unsupported';

export class HavocLoadError extends Error {
  readonly code: HavocLoadFailureCode;
  readonly diagnostics: readonly string[];
  constructor(code: HavocLoadFailureCode, diagnostics: readonly string[]) {
    super(`havoc load ${code}: ${diagnostics.join('; ')}`);
    this.name = 'HavocLoadError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export class HavocOutcomeIntegrityError extends Error {
  readonly diagnostics: readonly string[];
  constructor(diagnostics: readonly string[]) {
    super(`havoc outcome rejected: ${diagnostics.join('; ')}`);
    this.name = 'HavocOutcomeIntegrityError';
    this.diagnostics = diagnostics;
  }
}

export class HavocCommandConflictError extends Error {
  readonly commandId: string;
  constructor(commandId: string) {
    super(`havoc command ${commandId} was reused with a different payload`);
    this.name = 'HavocCommandConflictError';
    this.commandId = commandId;
  }
}

export class HavocStaleRevisionError extends Error {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;
  constructor(commandId: string, expectedRevision: number, actualRevision: number) {
    super(
      `havoc command ${commandId} expected revision ${String(expectedRevision)} but the stored run is at ${String(actualRevision)}`,
    );
    this.name = 'HavocStaleRevisionError';
    this.commandId = commandId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class HavocActiveRunExistsError extends Error {
  readonly activeRunId: string | null;
  readonly requestedRunId: string;
  constructor(activeRunId: string | null, requestedRunId: string) {
    super(
      `havoc run ${requestedRunId} cannot start while ${activeRunId ?? 'another run'} is active`,
    );
    this.name = 'HavocActiveRunExistsError';
    this.activeRunId = activeRunId;
    this.requestedRunId = requestedRunId;
  }
}

export class HavocRunNotFoundError extends Error {
  readonly runId: string;
  constructor(runId: string) {
    super(`havoc run ${runId} is neither active nor completed`);
    this.name = 'HavocRunNotFoundError';
    this.runId = runId;
  }
}

interface ParsedOutcomeState {
  state: HavocRunState;
  draftAbandoned: boolean;
}

interface ParsedGameArtifact {
  result: HavocGameResult;
  inputDigest: string;
  resultDigest: string;
}

interface ParsedTapeArtifact {
  tape: HavocGameTape;
  tapeDigest: string;
  selectedRank: number | null;
}

function HAVOC_SCOPED_TABLES(db: HoopRushDatabase): Table<unknown>[] {
  return [
    db.havocActiveRuns,
    db.havocCommands,
    db.havocGames,
    db.havocRetainedTapes,
    db.havocCompletedRuns,
    db.havocHistory,
  ] as Table<unknown>[];
}

function assertStoredSaveVersion(row: unknown, label: string): void {
  const version =
    typeof row === 'object' && row !== null
      ? (row as { saveSchemaVersion?: unknown }).saveSchemaVersion
      : undefined;
  if (version !== HAVOC_SAVE_SCHEMA_VERSION) {
    throw new HavocLoadError('unsupported', [
      `${label}: stored save schema ${typeof version === 'number' ? String(version) : 'unknown'} does not match ${String(HAVOC_SAVE_SCHEMA_VERSION)}`,
    ]);
  }
}

function parseStored<T>(schema: z.ZodType<T>, row: unknown, label: string): T {
  assertStoredSaveVersion(row, label);
  const parsed = schema.safeParse(row);
  if (!parsed.success) {
    throw new HavocLoadError('corrupt', [`${label}: ${parsed.error.message}`]);
  }
  return parsed.data;
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HavocOutcomeIntegrityError([`${label}: ${parsed.error.message}`]);
  }
  return parsed.data;
}

function integrityError(message: string): HavocOutcomeIntegrityError {
  return new HavocOutcomeIntegrityError([message]);
}

function asCommandId(commandId: string): CommandId {
  return commandId as CommandId;
}

function asRunId(runId: string): Id {
  return runId as Id;
}

function parseOutcomeState(rawState: unknown, command: HavocCommand | null): ParsedOutcomeState {
  const direct = havocRunStateSchema.safeParse(rawState);
  if (direct.success) return { state: direct.data, draftAbandoned: false };
  const abandonedDraft =
    typeof rawState === 'object' &&
    rawState !== null &&
    (rawState as { phase?: unknown }).phase === 'draft' &&
    (rawState as { completionState?: unknown }).completionState === 'abandoned' &&
    (command === null || command.command === 'abandon-havoc-run');
  if (abandonedDraft) {
    const relaxed = havocRunStateSchema.safeParse({ ...rawState, completionState: 'draft' });
    if (relaxed.success) return { state: relaxed.data, draftAbandoned: true };
  }
  throw new HavocOutcomeIntegrityError([`outcome state: ${direct.error.message}`]);
}

function parseGameArtifact(artifact: {
  result: HavocGameResult;
  inputDigest: string;
  resultDigest: string;
}): ParsedGameArtifact {
  const result = parseInput(havocGameResultSchema, artifact.result, 'game result');
  const inputDigest = parseInput(havocDigestTextSchema, artifact.inputDigest, 'game input digest');
  const resultDigest = parseInput(
    havocDigestTextSchema,
    artifact.resultDigest,
    'game result digest',
  );
  if (result.inputDigest !== inputDigest) {
    throw integrityError('game artifact input digest does not match the game result');
  }
  return { result, inputDigest, resultDigest };
}

function parseTapeArtifact(artifact: {
  tape: HavocGameTape;
  tapeDigest: string;
  selectedRank?: number;
}): ParsedTapeArtifact {
  const tape = parseInput(havocGameTapeSchema, artifact.tape, 'retained tape');
  const tapeDigest = parseInput(havocDigestTextSchema, artifact.tapeDigest, 'tape digest');
  const selectedRank =
    artifact.selectedRank === undefined
      ? null
      : parseInput(z.number().int().nonnegative(), artifact.selectedRank, 'tape selected rank');
  return { tape, tapeDigest, selectedRank };
}

function assertCommandArtifacts(
  command: HavocCommand,
  game: ParsedGameArtifact | null,
  tape: ParsedTapeArtifact | null,
  comparison: HavocComparison | null,
  report: HavocReport | null,
): void {
  if (command.command === 'accept-havoc-game' || command.command === 'accept-havoc-normal-game') {
    const expectedVariant = command.command === 'accept-havoc-game' ? 'havoc' : 'normal';
    if (game !== null) {
      if (game.result.variant !== expectedVariant) {
        throw integrityError('game result variant does not match the accept command');
      }
      const summary = command.summary;
      const humanScore =
        game.result.humanSide === 'home' ? game.result.home.points : game.result.away.points;
      const opponentScore =
        game.result.humanSide === 'home' ? game.result.away.points : game.result.home.points;
      if (
        summary.gameNumber !== game.result.gameNumber ||
        summary.variant !== game.result.variant ||
        summary.seed !== game.result.seed ||
        summary.humanSide !== game.result.humanSide ||
        summary.resultDigest !== game.resultDigest ||
        summary.inputDigest !== game.inputDigest ||
        summary.humanScore !== humanScore ||
        summary.opponentScore !== opponentScore
      ) {
        throw integrityError('accept command summary does not match the game artifact');
      }
    }
    if (comparison !== null || report !== null) {
      throw integrityError(
        'comparison and report artifacts require a complete-havoc-comparison command',
      );
    }
    return;
  }
  if (command.command === 'complete-havoc-comparison') {
    if (game !== null || tape !== null) {
      throw integrityError('game and tape artifacts require an accept command');
    }
    if (comparison !== null && canonicalJson(command.mvp) !== canonicalJson(comparison.mvp)) {
      throw integrityError('complete command mvp does not match the comparison mvp');
    }
    return;
  }
  if (game !== null || tape !== null || comparison !== null || report !== null) {
    throw integrityError('outcome artifacts do not match the command kind');
  }
}

export class DexieHavocRepository implements HavocRepository {
  private readonly db: HoopRushDatabase;
  constructor(db: HoopRushDatabase = new HoopRushDatabase()) {
    this.db = db;
  }

  async loadActiveRun(): Promise<HavocRunState | null> {
    const row: unknown = await this.db.havocActiveRuns.get(HAVOC_ACTIVE_RECORD_ID);
    if (row === undefined) return null;
    return parseStored(storedHavocActiveRunSchema, row, 'active run').state;
  }

  async loadCommandResult(commandId: string): Promise<HavocCommandResult | null> {
    const row: unknown = await this.db.havocCommands.get(asCommandId(commandId));
    if (row === undefined) return null;
    return parseStored(storedHavocCommandRowSchema, row, `command ${commandId}`).result;
  }

  async applyOutcome(input: HavocApplyOutcomeInput): Promise<HavocCommandResult> {
    const result = parseInput(havocCommandResultSchema, input.outcome.result, 'outcome result');
    const command =
      input.command === undefined
        ? null
        : parseInput(havocCommandSchema, input.command, 'outcome command');
    const parsedState = parseOutcomeState(input.outcome.state, command);
    const state = parsedState.state;
    if (
      command !== null &&
      (command.commandId !== result.commandId || command.runId !== result.runId)
    ) {
      throw integrityError('command envelope does not match the outcome result');
    }
    if (state.runId !== result.runId) {
      throw integrityError('outcome state run id does not match the outcome result');
    }
    const accepted = result.status === 'accepted';
    if (accepted) {
      if (result.revisionAfter <= result.revisionBefore) {
        throw integrityError('accepted commands must advance the run revision');
      }
      if (state.revision !== result.revisionAfter) {
        throw integrityError('accepted outcome state revision does not match the outcome result');
      }
    } else {
      if (result.revisionAfter !== result.revisionBefore) {
        throw integrityError('rejected commands must not change the run revision');
      }
      if (state.revision !== result.revisionBefore) {
        throw integrityError('rejected outcome state revision does not match the outcome result');
      }
    }
    const game = input.game === undefined ? null : parseGameArtifact(input.game);
    const tape = input.tape === undefined ? null : parseTapeArtifact(input.tape);
    const comparison =
      input.comparison === undefined
        ? null
        : parseInput(havocComparisonSchema, input.comparison, 'comparison');
    const report =
      input.report === undefined ? null : parseInput(havocReportSchema, input.report, 'report');
    if (!accepted && (game !== null || tape !== null || comparison !== null || report !== null)) {
      throw integrityError('rejected outcomes cannot carry persisted artifacts');
    }
    if (comparison !== null && comparison.runId !== result.runId) {
      throw integrityError('comparison belongs to another run');
    }
    if (report !== null && report.runId !== result.runId) {
      throw integrityError('report belongs to another run');
    }
    if (game !== null && tape !== null) {
      if (
        tape.tape.gameNumber !== game.result.gameNumber ||
        tape.tape.variant !== game.result.variant
      ) {
        throw integrityError('retained tape does not match the game artifact');
      }
    }
    if (command !== null) {
      assertCommandArtifacts(command, game, tape, comparison, report);
    }
    const outcomeDigest = seasonDigestHex(canonicalJson(result));
    const acceptedState = accepted ? state : null;

    return this.db.transaction('rw', HAVOC_SCOPED_TABLES(this.db), async () => {
      const now = new Date().toISOString();
      const existingRow: unknown = await this.db.havocCommands.get(result.commandId);
      if (existingRow !== undefined) {
        const existing = parseStored(
          storedHavocCommandRowSchema,
          existingRow,
          `command ${result.commandId}`,
        );
        if (command !== null && existing.command !== null) {
          if (canonicalJson(command) === canonicalJson(existing.command)) return existing.result;
          throw new HavocCommandConflictError(result.commandId);
        }
        if (
          existing.outcomeDigest === outcomeDigest ||
          canonicalJson(existing.result) === canonicalJson(result)
        ) {
          return existing.result;
        }
        throw new HavocCommandConflictError(result.commandId);
      }

      const activeRow: unknown = await this.db.havocActiveRuns.get(HAVOC_ACTIVE_RECORD_ID);
      const active =
        activeRow === undefined
          ? null
          : parseStored<StoredHavocActiveRun>(storedHavocActiveRunSchema, activeRow, 'active run');
      const completedRow: unknown = await this.db.havocCompletedRuns.get(result.runId);
      const completed =
        completedRow === undefined
          ? null
          : parseStored<StoredHavocCompletedRun>(
              storedHavocCompletedRunSchema,
              completedRow,
              `completed run ${result.runId}`,
            );

      const createShaped =
        command !== null ? command.command === 'create-havoc-draft' : result.revisionBefore === 0;
      let targetActive = false;
      let targetCompleted: StoredHavocCompletedRun | null = null;
      if (createShaped) {
        if (active !== null || completed !== null) {
          throw new HavocActiveRunExistsError(
            active?.runId ?? completed?.runId ?? null,
            result.runId,
          );
        }
        if (result.revisionBefore !== 0) {
          throw integrityError('create commands must start at revision zero');
        }
        if (state.phase !== 'draft') {
          throw integrityError('create commands must produce a draft-phase run');
        }
        targetActive = true;
      } else if (active !== null && active.runId === result.runId) {
        if (result.revisionBefore !== active.state.revision) {
          throw new HavocStaleRevisionError(
            result.commandId,
            result.revisionBefore,
            active.state.revision,
          );
        }
        targetActive = true;
      } else if (completed !== null) {
        if (result.revisionBefore !== completed.state.revision) {
          throw new HavocStaleRevisionError(
            result.commandId,
            result.revisionBefore,
            completed.state.revision,
          );
        }
        targetCompleted = completed;
      } else {
        throw new HavocRunNotFoundError(result.runId);
      }

      const archiveSnapshot =
        acceptedState !== null &&
        !parsedState.draftAbandoned &&
        (acceptedState.completionState === 'complete' ||
          acceptedState.completionState === 'abandoned' ||
          acceptedState.havocCursor === HAVOC_GAME_COUNT);
      const hasArtifacts = comparison !== null || report !== null;
      if (acceptedState !== null && hasArtifacts && !archiveSnapshot && targetCompleted === null) {
        throw integrityError('comparison and report artifacts require a completed run');
      }
      if (targetActive && archiveSnapshot && completed !== null) {
        throw integrityError('active run already has a completed snapshot');
      }

      if (acceptedState !== null) {
        if (parsedState.draftAbandoned) {
          await this.db.havocActiveRuns.delete(HAVOC_ACTIVE_RECORD_ID);
        } else if (targetCompleted !== null) {
          const nextRow = parseInput(
            storedHavocCompletedRunSchema,
            {
              saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
              runId: result.runId,
              state: acceptedState,
              comparison: comparison ?? targetCompleted.comparison ?? report?.comparison ?? null,
              report: report ?? targetCompleted.report,
              createdAtIso: targetCompleted.createdAtIso,
              archivedAtIso: targetCompleted.archivedAtIso,
              updatedAtIso: now,
            },
            `completed run ${result.runId}`,
          );
          await this.db.havocCompletedRuns.put(nextRow);
        } else if (archiveSnapshot) {
          const createdAtIso = active === null ? now : active.createdAtIso;
          const archived = parseInput(
            storedHavocCompletedRunSchema,
            {
              saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
              runId: result.runId,
              state: acceptedState,
              comparison: comparison ?? report?.comparison ?? null,
              report,
              createdAtIso,
              archivedAtIso: now,
              updatedAtIso: now,
            },
            `completed run ${result.runId}`,
          );
          await this.db.havocCompletedRuns.put(archived);
          await this.db.havocActiveRuns.delete(HAVOC_ACTIVE_RECORD_ID);
        } else {
          const activeRowValue = parseInput(
            storedHavocActiveRunSchema,
            {
              saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
              recordId: HAVOC_ACTIVE_RECORD_ID,
              runId: result.runId,
              revision: result.revisionAfter,
              stateDigest: result.stateDigest,
              state: acceptedState,
              createdAtIso: active === null ? now : active.createdAtIso,
              updatedAtIso: now,
            },
            'active run',
          );
          await this.db.havocActiveRuns.put(activeRowValue);
        }

        if (game !== null) {
          const gameRow = parseInput(
            storedHavocGameRowSchema,
            {
              saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
              runId: result.runId,
              variant: game.result.variant,
              gameNumber: game.result.gameNumber,
              result: game.result,
              inputDigest: game.inputDigest,
              resultDigest: game.resultDigest,
              updatedAtIso: now,
            },
            `game ${String(game.result.gameNumber)}`,
          );
          await this.db.havocGames.put(gameRow);
        }
        if (tape !== null) {
          const tapeRow = parseInput(
            storedHavocRetainedTapeSchema,
            {
              saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
              runId: result.runId,
              gameNumber: tape.tape.gameNumber,
              tape: tape.tape,
              tapeDigest: tape.tapeDigest,
              selectedRank: tape.selectedRank,
              updatedAtIso: now,
            },
            `retained tape ${String(tape.tape.gameNumber)}`,
          );
          await this.db.havocRetainedTapes.put(tapeRow);
        }
        if (archiveSnapshot || targetCompleted !== null) {
          const historyState = acceptedState;
          await this.putHistory(
            historyState,
            targetCompleted === null
              ? active === null
                ? now
                : active.createdAtIso
              : targetCompleted.createdAtIso,
            now,
          );
        }
      }

      const commandRow = parseInput(
        storedHavocCommandRowSchema,
        {
          saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
          commandId: result.commandId,
          runId: result.runId,
          command,
          result,
          outcomeDigest,
          updatedAtIso: now,
        },
        `command ${result.commandId}`,
      );
      await this.db.havocCommands.put(commandRow);
      return result;
    });
  }

  async listRunGames(runId: string, variant: HavocVariant): Promise<HavocGameResult[]> {
    const rows = await this.db.havocGames
      .where('[runId+variant+gameNumber]')
      .between([runId, variant, 0], [runId, variant, Number.MAX_SAFE_INTEGER])
      .toArray();
    return rows
      .sort((a, b) => a.gameNumber - b.gameNumber)
      .map(
        (row) =>
          parseStored(storedHavocGameRowSchema, row, `game ${String(row.gameNumber)}`).result,
      );
  }

  async readRunGame(
    runId: string,
    variant: HavocVariant,
    gameNumber: number,
  ): Promise<{ result: HavocGameResult; resultDigest: string } | null> {
    const row: unknown = await this.db.havocGames.get([runId, variant, gameNumber]);
    if (row === undefined) return null;
    const parsed = parseStored(
      storedHavocGameRowSchema,
      row,
      `game ${runId}/${variant}/${String(gameNumber)}`,
    );
    return { result: parsed.result, resultDigest: parsed.resultDigest };
  }

  async readRetainedTape(runId: string, gameNumber: number): Promise<HavocGameTape | null> {
    const row: unknown = await this.db.havocRetainedTapes.get([runId, gameNumber]);
    if (row === undefined) return null;
    return parseStored(
      storedHavocRetainedTapeSchema,
      row,
      `retained tape ${runId}/${String(gameNumber)}`,
    ).tape;
  }

  async writeRetainedTape(
    runId: string,
    gameNumber: number,
    tape: HavocGameTape,
    tapeDigest: string,
    selectedRank: number,
  ): Promise<void> {
    const validatedTape = parseInput(havocGameTapeSchema, tape, 'retained tape');
    const validatedDigest = parseInput(havocDigestTextSchema, tapeDigest, 'tape digest');
    const validatedRank = parseInput(
      z.number().int().nonnegative(),
      selectedRank,
      'tape selected rank',
    );
    const row = parseInput(
      storedHavocRetainedTapeSchema,
      {
        saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
        runId,
        gameNumber,
        tape: validatedTape,
        tapeDigest: validatedDigest,
        selectedRank: validatedRank,
        updatedAtIso: new Date().toISOString(),
      },
      `retained tape ${runId}/${String(gameNumber)}`,
    );
    await this.db.havocRetainedTapes.put(row);
  }

  async readComparison(runId: string): Promise<HavocComparison | null> {
    const row: unknown = await this.db.havocCompletedRuns.get(asRunId(runId));
    if (row === undefined) return null;
    const parsed = parseStored(storedHavocCompletedRunSchema, row, `completed run ${runId}`);
    return parsed.comparison ?? parsed.report?.comparison ?? null;
  }

  async readReport(runId: string): Promise<HavocReport | null> {
    const row: unknown = await this.db.havocCompletedRuns.get(asRunId(runId));
    if (row === undefined) return null;
    return parseStored(storedHavocCompletedRunSchema, row, `completed run ${runId}`).report;
  }

  async listHistory(): Promise<HavocHistoryEntry[]> {
    const rows = await this.db.havocHistory.orderBy('updatedAtIso').reverse().toArray();
    return rows.map((row) => {
      const parsed = parseStored(storedHavocHistoryRowSchema, row, `history ${row.runId}`);
      return {
        runId: parsed.runId,
        createdAtIso: parsed.createdAtIso,
        updatedAtIso: parsed.updatedAtIso,
        havocWins: parsed.havocWins,
        havocLosses: parsed.havocLosses,
        perfectSeason: parsed.perfectSeason,
        comparisonStatus: parsed.comparisonStatus,
        completionState: parsed.completionState,
      };
    });
  }

  async readCompletedRun(
    runId: string,
  ): Promise<{ state: HavocRunState; report: HavocReport | null } | null> {
    const row: unknown = await this.db.havocCompletedRuns.get(asRunId(runId));
    if (row === undefined) return null;
    const parsed = parseStored(storedHavocCompletedRunSchema, row, `completed run ${runId}`);
    return { state: parsed.state, report: parsed.report };
  }

  private async putHistory(
    state: HavocRunState,
    createdAtIso: string,
    updatedAtIso: string,
  ): Promise<void> {
    if (state.completionState === 'draft') {
      throw new HavocOutcomeIntegrityError(['draft-phase runs cannot be written to history']);
    }
    const row = parseInput(
      storedHavocHistoryRowSchema,
      {
        saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
        runId: state.runId,
        createdAtIso,
        updatedAtIso,
        havocWins: state.havocAggregate.wins,
        havocLosses: state.havocAggregate.losses,
        perfectSeason: state.perfectSeason,
        comparisonStatus: state.comparisonStatus,
        completionState: state.completionState,
      },
      `history ${state.runId}`,
    );
    const existingRow: unknown = await this.db.havocHistory.get(state.runId);
    if (existingRow !== undefined) {
      parseStored(storedHavocHistoryRowSchema, existingRow, `history ${state.runId}`);
    }
    await this.db.havocHistory.put(row);
  }
}

export type HavocRepositoryImpl = DexieHavocRepository;
