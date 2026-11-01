import type { Table } from 'dexie';
import { z } from 'zod';
import {
  HAVOC_GAME_COUNT,
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_REPORT_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_COMPARISON_VERSION,
  HAVOC_SAVE_SCHEMA_VERSION,
  HAVOC_SEED_DERIVATION_VERSION,
  HavocLoadError,
  canonicalJson,
  canonicalHavocLockedInputs,
  freezeHavocLockedInputs,
  havocCommandResultSchema,
  havocCommandSchema,
  havocComparisonSchema,
  havocGameResultSchema,
  havocGameTapeSchema,
  havocReportSchema,
  havocRunStateSchema,
  havocRunProgressSchema,
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
  storedHavocLockedInputsSchema,
  type StoredHavocState,
  storedHavocCommandRowSchema,
  storedHavocCompletedRunSchema,
  storedHavocGameRowSchema,
  storedHavocHistoryRowSchema,
  storedHavocRetainedTapeSchema,
  type StoredHavocActiveRun,
  type StoredHavocCompletedRun,
  type StoredHavocHistoryRow,
} from '../schemas/havoc-record.ts';
import { HoopRushDatabase } from './dexie.ts';
import { DexieProfileRepository } from './profile.ts';
import {
  classifyCommandReplay,
  commandEnvelopeMatches,
  readStoredCommand,
} from './save-envelope.ts';
import {
  assertSaveSchemaVersion,
  canonicalEquals,
  commandReceiptMatches,
  getParsedRecord,
  listCompletedHistory,
  parseOptionalRecord,
  parseRecord,
  revisionMatches,
} from './support.ts';

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

export type HavocHistoryEntry = Omit<StoredHavocHistoryRow, 'saveSchemaVersion' | 'runId'> & {
  runId: string;
};

export type { HavocLoadFailureCode } from '@hoop-rush/data-contracts';

export { HavocLoadError };

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
    db.havocLockedInputs,
    db.havocCommands,
    db.havocGames,
    db.havocRetainedTapes,
    db.havocCompletedRuns,
    db.havocHistory,
    db.profileBindings,
    db.profileGames,
    db.profiles,
    db.archivedProfiles,
  ] as Table<unknown>[];
}

function collectHavocVersionStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (
      value.startsWith('havoc-rules-') ||
      value.startsWith('havoc-mutations-') ||
      value.startsWith('havoc-seeds-') ||
      value.startsWith('havoc-comparison-') ||
      value.startsWith('havoc-report-')
    ) {
      out.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectHavocVersionStrings(entry, out);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) collectHavocVersionStrings(entry, out);
  }
}

function parseStored<T>(schema: z.ZodType<T>, row: unknown, label: string): T {
  assertSaveSchemaVersion(
    row,
    HAVOC_SAVE_SCHEMA_VERSION,
    (message) => new HavocLoadError('unsupported', [`${label}: ${message}`]),
  );
  const parsed = schema.safeParse(row);
  if (!parsed.success) {
    const seen: string[] = [];
    collectHavocVersionStrings(row, seen);
    const current = new Set([
      HAVOC_RULES_VERSION,
      HAVOC_MUTATION_CATALOG_VERSION,
      HAVOC_SEED_DERIVATION_VERSION,
      HAVOC_COMPARISON_VERSION,
      HAVOC_REPORT_VERSION,
    ]);
    const stale = [...new Set(seen)].filter((version) => !current.has(version));
    if (stale.length > 0) {
      throw new HavocLoadError('unsupported', [
        `${label}: stored version ${stale.join(', ')} does not match current ${HAVOC_RULES_VERSION}/${HAVOC_MUTATION_CATALOG_VERSION}; a balance patch changed scoring so older runs cannot be replayed — discard the stale active run to start fresh (${parsed.error.message})`,
      ]);
    }
    throw new HavocLoadError('corrupt', [`${label}: ${parsed.error.message}`]);
  }
  return parsed.data;
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  return parseRecord(
    schema,
    value,
    label,
    (diagnostic) => new HavocOutcomeIntegrityError([diagnostic]),
  );
}

function integrityError(message: string): HavocOutcomeIntegrityError {
  return new HavocOutcomeIntegrityError([message]);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw integrityError(message);
}

function asCommandId(commandId: string): CommandId {
  return commandId as CommandId;
}

function asRunId(runId: string): Id {
  return runId as Id;
}

function parseOutcomeState(
  rawState: HavocRunState,
  command: HavocCommand | null,
  accepted: boolean,
): ParsedOutcomeState {
  const direct = accepted
    ? havocRunProgressSchema.safeParse(rawState)
    : havocRunStateSchema.safeParse(rawState);
  if (direct.success) {
    const draftAbandoned =
      direct.data.phase === 'draft' &&
      direct.data.completionState === 'abandoned' &&
      (command === null || command.command === 'abandon-havoc-run');
    return { state: { ...direct.data, locked: rawState.locked }, draftAbandoned };
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
  invariant(
    result.inputDigest === inputDigest,
    'game artifact input digest does not match the game result',
  );
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
      invariant(
        game.result.variant === expectedVariant,
        'game result variant does not match the accept command',
      );
      const summary = command.summary;
      const humanScore =
        game.result.humanSide === 'home' ? game.result.home.points : game.result.away.points;
      const opponentScore =
        game.result.humanSide === 'home' ? game.result.away.points : game.result.home.points;
      invariant(
        summary.gameNumber === game.result.gameNumber &&
          summary.variant === game.result.variant &&
          summary.seed === game.result.seed &&
          summary.humanSide === game.result.humanSide &&
          summary.resultDigest === game.resultDigest &&
          summary.inputDigest === game.inputDigest &&
          summary.humanScore === humanScore &&
          summary.opponentScore === opponentScore,
        'accept command summary does not match the game artifact',
      );
    }
    invariant(
      comparison === null && report === null,
      'comparison and report artifacts require a complete-havoc-comparison command',
    );
    return;
  }
  if (command.command === 'complete-havoc-comparison') {
    invariant(game === null && tape === null, 'game and tape artifacts require an accept command');
    invariant(
      comparison === null || canonicalEquals(command.mvp, comparison.mvp),
      'complete command mvp does not match the comparison mvp',
    );
    return;
  }
  invariant(
    game === null && tape === null && comparison === null && report === null,
    'outcome artifacts do not match the command kind',
  );
}

export class DexieHavocRepository {
  private readonly db: HoopRushDatabase;
  constructor(db: HoopRushDatabase) {
    this.db = db;
  }

  async loadActiveRun(): Promise<HavocRunState | null> {
    const stored = await getParsedRecord(this.db.havocActiveRuns, HAVOC_ACTIVE_RECORD_ID, (row) =>
      parseStored(storedHavocActiveRunSchema, row, 'active run'),
    );
    return stored === null ? null : this.hydrateState(stored.state);
  }

  async clearActiveRun(): Promise<void> {
    await this.db.havocActiveRuns.delete(HAVOC_ACTIVE_RECORD_ID);
  }

  async loadCommandResult(commandId: string): Promise<HavocCommandResult | null> {
    const stored = await getParsedRecord(this.db.havocCommands, asCommandId(commandId), (row) =>
      parseStored(storedHavocCommandRowSchema, row, `command ${commandId}`),
    );
    return stored?.result ?? null;
  }

  async applyOutcome(input: HavocApplyOutcomeInput): Promise<HavocCommandResult> {
    const result = parseInput(havocCommandResultSchema, input.outcome.result, 'outcome result');
    const command =
      input.command === undefined
        ? null
        : parseInput(havocCommandSchema, input.command, 'outcome command');
    const parsedState = parseOutcomeState(
      input.outcome.state,
      command,
      result.status === 'accepted',
    );
    const state = parsedState.state;
    invariant(
      command === null ||
        (command.commandId === result.commandId && command.runId === result.runId),
      'command envelope does not match the outcome result',
    );
    invariant(
      state.runId === result.runId,
      'outcome state run id does not match the outcome result',
    );
    const accepted = result.status === 'accepted';
    if (accepted) {
      invariant(
        result.revisionAfter > result.revisionBefore,
        'accepted commands must advance the run revision',
      );
      invariant(
        state.revision === result.revisionAfter,
        'accepted outcome state revision does not match the outcome result',
      );
    } else {
      invariant(
        result.revisionAfter === result.revisionBefore,
        'rejected commands must not change the run revision',
      );
      invariant(
        state.revision === result.revisionBefore,
        'rejected outcome state revision does not match the outcome result',
      );
    }
    const game = input.game === undefined ? null : parseGameArtifact(input.game);
    const tape = input.tape === undefined ? null : parseTapeArtifact(input.tape);
    const comparison = parseOptionalRecord(
      havocComparisonSchema,
      input.comparison,
      'comparison',
      (diagnostic) => new HavocOutcomeIntegrityError([diagnostic]),
    );
    const report = parseOptionalRecord(
      havocReportSchema,
      input.report,
      'report',
      (diagnostic) => new HavocOutcomeIntegrityError([diagnostic]),
    );
    invariant(
      accepted || (game === null && tape === null && comparison === null && report === null),
      'rejected outcomes cannot carry persisted artifacts',
    );
    invariant(
      comparison === null || comparison.runId === result.runId,
      'comparison belongs to another run',
    );
    invariant(report === null || report.runId === result.runId, 'report belongs to another run');
    invariant(
      game === null ||
        tape === null ||
        (tape.tape.gameNumber === game.result.gameNumber &&
          tape.tape.variant === game.result.variant),
      'retained tape does not match the game artifact',
    );
    if (command !== null) {
      assertCommandArtifacts(command, game, tape, comparison, report);
    }
    const outcomeDigest = seasonDigestHex(canonicalJson(result));
    const acceptedState = accepted ? state : null;

    return this.db.transaction('rw', HAVOC_SCOPED_TABLES(this.db), async () => {
      const now = new Date().toISOString();
      const existing = await readStoredCommand({
        table: this.db.havocCommands,
        commandId: result.commandId,
        parse: (row) =>
          parseStored(storedHavocCommandRowSchema, row, `command ${result.commandId}`),
      });
      const replay = classifyCommandReplay({
        stored: existing,
        incoming: { command, result, outcomeDigest },
        resultOf: (row) => row.result,
        /*
         * Havoc replays on either a matching command envelope or a matching
         * outcome digest. The digest arm covers commands replayed without a
         * command payload, which Cap Rush has no equivalent for.
         */
        matches: (row, incoming) => {
          if (incoming.command !== null && row.command !== null) {
            return commandEnvelopeMatches(incoming.command, row.command);
          }
          return (
            row.outcomeDigest === incoming.outcomeDigest ||
            commandReceiptMatches(row.result, incoming.result)
          );
        },
      });
      if (replay.kind === 'replayed') return replay.result;
      if (replay.kind === 'conflict') throw new HavocCommandConflictError(result.commandId);

      const active = await getParsedRecord(this.db.havocActiveRuns, HAVOC_ACTIVE_RECORD_ID, (row) =>
        parseStored<StoredHavocActiveRun>(storedHavocActiveRunSchema, row, 'active run'),
      );
      const completed = await getParsedRecord(this.db.havocCompletedRuns, result.runId, (row) =>
        parseStored<StoredHavocCompletedRun>(
          storedHavocCompletedRunSchema,
          row,
          `completed run ${result.runId}`,
        ),
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
        invariant(result.revisionBefore === 0, 'create commands must start at revision zero');
        invariant(state.phase === 'draft', 'create commands must produce a draft-phase run');
        targetActive = true;
      } else if (active !== null && active.runId === result.runId) {
        if (!revisionMatches(active.state, result.revisionBefore)) {
          throw new HavocStaleRevisionError(
            result.commandId,
            result.revisionBefore,
            active.state.revision,
          );
        }
        targetActive = true;
      } else if (completed !== null) {
        if (!revisionMatches(completed.state, result.revisionBefore)) {
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
      invariant(
        acceptedState === null || !hasArtifacts || archiveSnapshot || targetCompleted !== null,
        'comparison and report artifacts require a completed run',
      );
      invariant(
        !(targetActive && archiveSnapshot && completed !== null),
        'active run already has a completed snapshot',
      );

      if (acceptedState !== null) {
        const previousLocked = (targetCompleted ?? active)?.state.locked;
        const storedState = await this.storeState(acceptedState, previousLocked);
        if (parsedState.draftAbandoned) {
          await this.db.havocActiveRuns.delete(HAVOC_ACTIVE_RECORD_ID);
        } else if (targetCompleted !== null || archiveSnapshot) {
          const completedRow = parseInput(
            storedHavocCompletedRunSchema,
            {
              saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
              runId: result.runId,
              state: storedState,
              comparison: comparison ?? targetCompleted?.comparison ?? report?.comparison ?? null,
              report: report ?? targetCompleted?.report ?? null,
              createdAtIso: targetCompleted?.createdAtIso ?? active?.createdAtIso ?? now,
              archivedAtIso: targetCompleted?.archivedAtIso ?? now,
              updatedAtIso: now,
            },
            `completed run ${result.runId}`,
          );
          await this.db.havocCompletedRuns.put(completedRow);
          if (targetCompleted === null) {
            await this.db.havocActiveRuns.delete(HAVOC_ACTIVE_RECORD_ID);
          }
        } else {
          const activeRowValue = parseInput(
            storedHavocActiveRunSchema,
            {
              saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
              recordId: HAVOC_ACTIVE_RECORD_ID,
              runId: result.runId,
              revision: result.revisionAfter,
              stateDigest: result.stateDigest,
              state: storedState,
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
          const bindingId = `havoc:${result.runId}`;
          if (game.result.variant === 'havoc' && (await this.db.profileBindings.get(bindingId))) {
            const side = game.result.humanSide;
            await new DexieProfileRepository(this.db).recordGame(
              bindingId,
              String(game.result.gameNumber),
              {
                won: game.result.winner === side,
                multiplayer: false,
                players: game.result[side].participants,
              },
            );
          }
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
          await this.putHistory(
            acceptedState,
            targetCompleted?.createdAtIso ?? active?.createdAtIso ?? now,
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
    const parsed = await getParsedRecord(this.db.havocGames, [runId, variant, gameNumber], (row) =>
      parseStored(storedHavocGameRowSchema, row, `game ${runId}/${variant}/${String(gameNumber)}`),
    );
    return parsed === null ? null : { result: parsed.result, resultDigest: parsed.resultDigest };
  }

  async readRetainedTape(runId: string, gameNumber: number): Promise<HavocGameTape | null> {
    const stored = await getParsedRecord(this.db.havocRetainedTapes, [runId, gameNumber], (row) =>
      parseStored(
        storedHavocRetainedTapeSchema,
        row,
        `retained tape ${runId}/${String(gameNumber)}`,
      ),
    );
    return stored?.tape ?? null;
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
    const parsed = await getParsedRecord(this.db.havocCompletedRuns, asRunId(runId), (row) =>
      parseStored(storedHavocCompletedRunSchema, row, `completed run ${runId}`),
    );
    return parsed?.comparison ?? parsed?.report?.comparison ?? null;
  }

  async readReport(runId: string): Promise<HavocReport | null> {
    const stored = await getParsedRecord(this.db.havocCompletedRuns, asRunId(runId), (row) =>
      parseStored(storedHavocCompletedRunSchema, row, `completed run ${runId}`),
    );
    return stored?.report ?? null;
  }

  async listHistory(): Promise<HavocHistoryEntry[]> {
    const rows = await listCompletedHistory(this.db.havocHistory, 'updatedAtIso');
    return rows.map((row) => {
      const { saveSchemaVersion: _saveSchemaVersion, ...entry } = parseStored(
        storedHavocHistoryRowSchema,
        row,
        `history ${row.runId}`,
      );
      return entry;
    });
  }

  async readCompletedRun(
    runId: string,
  ): Promise<{ state: HavocRunState; report: HavocReport | null } | null> {
    const parsed = await getParsedRecord(this.db.havocCompletedRuns, asRunId(runId), (row) =>
      parseStored(storedHavocCompletedRunSchema, row, `completed run ${runId}`),
    );
    return parsed === null
      ? null
      : { state: await this.hydrateState(parsed.state), report: parsed.report };
  }

  private async storeState(
    state: HavocRunState,
    previousLocked: StoredHavocState['locked'] | undefined,
  ): Promise<StoredHavocState> {
    const hasSnapshot =
      previousLocked !== undefined && previousLocked !== null && 'digest' in previousLocked;
    state = hasSnapshot ? state : parseInput(havocRunStateSchema, state, 'outcome state');
    if (state.locked === null) return { ...state, locked: null };
    const digest = seasonDigestHex(canonicalHavocLockedInputs(state.locked));
    if (hasSnapshot) {
      invariant(
        previousLocked.runId === state.runId && previousLocked.digest === digest,
        'locked inputs changed after the lineup was locked',
      );
    } else {
      const row = parseInput(
        storedHavocLockedInputsSchema,
        {
          saveSchemaVersion: HAVOC_SAVE_SCHEMA_VERSION,
          runId: state.runId,
          digest,
          locked: state.locked,
        },
        'locked inputs',
      );
      await this.db.havocLockedInputs.put(row);
    }
    return { ...state, locked: { runId: state.runId, digest } };
  }

  private async hydrateState(state: StoredHavocState): Promise<HavocRunState> {
    if (state.locked === null) {
      const hydrated = havocRunStateSchema.parse(state);
      if (hydrated.locked !== null) freezeHavocLockedInputs(hydrated.locked);
      return hydrated;
    }
    const raw = await getParsedRecord(this.db.havocLockedInputs, asRunId(state.runId), (stored) =>
      parseStored(storedHavocLockedInputsSchema, stored, 'locked inputs'),
    );
    if (raw === null) throw new HavocLoadError('corrupt', ['locked inputs are missing']);
    if (
      raw.runId !== state.locked.runId ||
      raw.digest !== state.locked.digest ||
      raw.digest !== seasonDigestHex(canonicalJson(raw.locked))
    ) {
      throw new HavocLoadError('corrupt', ['locked inputs digest does not match the saved run']);
    }
    const hydrated = havocRunStateSchema.parse({ ...state, locked: raw.locked });
    if (hydrated.locked !== null) freezeHavocLockedInputs(hydrated.locked);
    return hydrated;
  }

  private async putHistory(
    state: HavocRunState,
    createdAtIso: string,
    updatedAtIso: string,
  ): Promise<void> {
    invariant(state.completionState !== 'draft', 'draft-phase runs cannot be written to history');
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
    await getParsedRecord(this.db.havocHistory, state.runId, (stored) =>
      parseStored(storedHavocHistoryRowSchema, stored, `history ${state.runId}`),
    );
    await this.db.havocHistory.put(row);
  }
}

export type HavocRepository = Pick<
  DexieHavocRepository,
  | 'loadActiveRun'
  | 'clearActiveRun'
  | 'loadCommandResult'
  | 'applyOutcome'
  | 'listRunGames'
  | 'readRunGame'
  | 'readRetainedTape'
  | 'writeRetainedTape'
  | 'readComparison'
  | 'readReport'
  | 'listHistory'
  | 'readCompletedRun'
>;
