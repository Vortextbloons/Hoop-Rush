import type {
  CapRushCommand,
  CapRushCommandResult,
  CapRushDraftState,
  CapRushHistoryEntry,
  CapRushLeagueGame,
  CapRushPlayback,
  CapRushReport,
  CapRushStoredGame,
  CapRushStoredPlayoffGame,
  CommandId,
  Id,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_SAVE_SCHEMA_VERSION,
  CAP_RUSH_SALARY_CURVE_VERSION,
  canonicalJson,
  capRushCommandResultSchema,
  capRushCommandSchema,
  capRushConferenceStandingsEntries,
  capRushLeagueGameSchema,
  capRushReportSchema,
  capRushStoredGameSchema,
  capRushStoredPlayoffGameSchema,
  isConferencePostseason,
} from '@hoop-rush/data-contracts';
import {
  auditHavocBattleGame,
  havocBattleGameInputDigest,
  soloToBattleResult,
  capRushStateDigest,
} from '@hoop-rush/engine';
import {
  CAP_RUSH_ACTIVE_DRAFT_RECORD_ID,
  capRushPlaybackGameKey,
  storedCapRushCommandRowSchema,
  storedCapRushDraftRowSchema,
  storedCapRushGameRowSchema,
  storedCapRushHistoryRowSchema,
  storedCapRushLeagueGameRowSchema,
  storedCapRushPlaybackCursorRowSchema,
  storedCapRushPlaybackEvidenceRowSchema,
  storedCapRushPlayoffGameRowSchema,
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
  readonly playoffGame?: CapRushStoredPlayoffGame;
  readonly leagueGames?: readonly CapRushLeagueGame[];
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
  listPlayoffGames(runId: string): Promise<CapRushStoredPlayoffGame[]>;
  listLeagueGames(runId: string): Promise<CapRushLeagueGame[]>;
  updatePlayback(
    runId: string,
    game: number | string,
    cursor: number,
    resolved: boolean,
  ): Promise<void>;
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

export function capRushReportCommandError(input: {
  readonly command: CapRushCommand;
  readonly report: CapRushReport;
}): string | null {
  if (
    input.command.command !== 'finalize-cap-rush-season' &&
    input.command.command !== 'finalize-cap-rush-postseason'
  ) {
    return 'a cap rush report requires a finalize command';
  }
  if (input.command.command === 'finalize-cap-rush-postseason') {
    return input.report.postseason === undefined
      ? 'a postseason finalize report requires its bracket'
      : null;
  }
  return input.report.postseason === undefined
    ? null
    : 'a regular-season report cannot carry a postseason bracket';
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
    if (typeof row === 'object' && row !== null && 'draft' in row) {
      const draft = row.draft;
      if (typeof draft === 'object' && draft !== null && 'versionSet' in draft) {
        const versionSet = draft.versionSet;
        if (
          typeof versionSet === 'object' &&
          versionSet !== null &&
          'salaryCurveVersion' in versionSet &&
          typeof versionSet.salaryCurveVersion === 'string' &&
          versionSet.salaryCurveVersion !== CAP_RUSH_SALARY_CURVE_VERSION
        ) {
          throw unsupported('active cap rush draft uses an unsupported salary curve version');
        }
      }
    }
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
    const playoffGame =
      input.playoffGame === undefined
        ? null
        : parseRecord(
            capRushStoredPlayoffGameSchema,
            input.playoffGame,
            'accepted cap rush playoff game',
            malformed,
          );
    const report =
      input.report === undefined
        ? null
        : parseRecord(capRushReportSchema, input.report, 'cap rush season report', malformed);
    const leagueGames = (input.leagueGames ?? []).map((game) =>
      parseRecord(capRushLeagueGameSchema, game, 'accepted cap rush league game', malformed),
    );
    if (!accepted && (game !== null || playoffGame !== null || report !== null)) {
      throw malformed('rejected cap rush commands cannot carry stored artifacts');
    }
    if (!accepted && leagueGames.length > 0) {
      throw malformed('rejected cap rush commands cannot carry league games');
    }
    if (leagueGames.length > 0) {
      if (
        command.command !== 'accept-cap-rush-game' &&
        command.command !== 'accept-cap-rush-league-games'
      ) {
        throw malformed('stored league games require an accept command');
      }
      const acceptedGames =
        command.command === 'accept-cap-rush-league-games'
          ? command.leagueGames
          : (command.leagueGames ?? []);
      const slot =
        command.command === 'accept-cap-rush-league-games' ? command.slot : command.cursor;
      if (acceptedGames.length !== leagueGames.length) {
        throw malformed('accept command does not describe the stored league games');
      }
      for (const leagueGame of leagueGames) {
        const commandGame = acceptedGames.find((entry) => entry.gameId === leagueGame.gameId);
        if (commandGame === undefined || canonicalJson(commandGame) !== canonicalJson(leagueGame)) {
          throw malformed('stored league game does not match the accept command');
        }
        if (leagueGame.slot !== slot) {
          throw malformed('stored league game belongs to another slot');
        }
      }
    }
    if (playoffGame !== null) {
      if (command.command !== 'accept-cap-rush-playoff-game') {
        throw malformed('stored playoff games require a playoff accept command');
      }
      if (canonicalJson(command.game) !== canonicalJson(playoffGame.summary)) {
        throw malformed('playoff accept command does not describe the stored game');
      }
      if (canonicalJson(command.audit) !== canonicalJson(playoffGame.audit)) {
        throw malformed('stored playoff audit does not match the accept command');
      }
      if (canonicalJson(command.result) !== canonicalJson(playoffGame.result)) {
        throw malformed('stored playoff result does not match the accept command');
      }
      const acceptedGame = state.postseason?.series
        .flatMap((series) => series.games)
        .find((entry) => entry.gameId === playoffGame.summary.gameId);
      if (acceptedGame === undefined) {
        throw malformed('stored playoff game is missing from the accepted postseason');
      }
      if (canonicalJson(acceptedGame) !== canonicalJson(playoffGame.summary)) {
        throw malformed('stored playoff game disagrees with the postseason state');
      }
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
    const broadcastGame = game ?? playoffGame;
    if (broadcastGame?.playback !== undefined) {
      const playback = broadcastGame.playback;
      if (broadcastGame.result === null || playback.cursor !== 0)
        throw malformed('a new broadcast requires an initial cursor and user result');
      const audit = auditHavocBattleGame(
        playback.input,
        soloToBattleResult(
          broadcastGame.result,
          broadcastGame.result.humanSide,
          havocBattleGameInputDigest(playback.input),
        ),
        playback.tape,
      );
      if (!audit.ok)
        throw malformed('the recorded broadcast does not reconcile with the accepted result');
    }
    if (report !== null) {
      const reportCommandError = capRushReportCommandError({ command, report });
      if (reportCommandError !== null) {
        throw malformed(reportCommandError);
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
      if (report.postseason !== undefined) {
        const postseason = state.postseason;
        if (
          postseason === undefined ||
          postseason.phase !== 'complete' ||
          postseason.standings === null ||
          postseason.championTeamId !== report.postseason.championTeamId ||
          postseason.finalsMvp === null ||
          canonicalJson(postseason.finalsMvp) !== canonicalJson(report.postseason.finalsMvp) ||
          canonicalJson(postseason.series) !== canonicalJson(report.postseason.series) ||
          canonicalJson(postseason.standings) !== canonicalJson(report.postseason.standings)
        ) {
          throw malformed('cap rush postseason report does not match the accepted bracket');
        }
      }
    }

    const outcome = await this.db.transaction(
      'rw',
      [
        this.db.capRushActive,
        this.db.capRushCommands,
        this.db.capRushGames,
        this.db.capRushPlaybackEvidence,
        this.db.capRushPlaybackCursors,
        this.db.capRushPlayoffGames,
        this.db.capRushLeagueGames,
        this.db.capRushHistory,
        this.db.capRushReports,
      ],
      async (): Promise<CapRushCommandResult | null> => {
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

        const pendingPlayback = await this.db.capRushPlaybackEvidence
          .where('runId')
          .equals(result.runId)
          .count();
        if (command.command !== 'accept-cap-rush-league-games' && pendingPlayback > 0) {
          return null;
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
              stateDigest: result.stateDigest,
              draft: state,
              createdAtIso,
              updatedAtIso: now,
            }),
          );
          if (game !== null) {
            const { playback, ...storedGame } = game;
            await this.db.capRushGames.put(
              storedCapRushGameRowSchema.parse({
                saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
                runId: result.runId,
                gameNumber: game.gameNumber,
                game: storedGame,
                updatedAtIso: now,
              }),
            );
            if (playback !== undefined) {
              await this.putPlayback(
                result.runId,
                capRushPlaybackGameKey(game.gameNumber),
                playback,
                now,
              );
            }
          }
          if (playoffGame !== null) {
            const { playback, ...storedGame } = playoffGame;
            await this.db.capRushPlayoffGames.put(
              storedCapRushPlayoffGameRowSchema.parse({
                saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
                runId: result.runId,
                gameId: playoffGame.gameId,
                game: storedGame,
                updatedAtIso: now,
              }),
            );
            if (playback !== undefined) {
              await this.putPlayback(
                result.runId,
                capRushPlaybackGameKey(playoffGame.gameId),
                playback,
                now,
              );
            }
          }
          if (leagueGames.length > 0) {
            await this.db.capRushLeagueGames.bulkPut(
              leagueGames.map((leagueGame) =>
                storedCapRushLeagueGameRowSchema.parse({
                  saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
                  runId: result.runId,
                  gameId: leagueGame.gameId,
                  game: leagueGame,
                  updatedAtIso: now,
                }),
              ),
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
    if (outcome === null) {
      throw malformed('finish the pending broadcast before advancing the run');
    }
    return outcome;
  }

  async updatePlayback(
    runId: string,
    game: number | string,
    cursor: number,
    resolved: boolean,
  ): Promise<void> {
    const gameKey = capRushPlaybackGameKey(game);
    const outcome = await this.db.transaction(
      'rw',
      [this.db.capRushPlaybackCursors, this.db.capRushPlaybackEvidence],
      async (): Promise<'missing' | 'unfinished' | 'ok'> => {
        const row: unknown = await this.db.capRushPlaybackCursors.get([runId, gameKey]);
        if (row === undefined) {
          const evidence = await this.db.capRushPlaybackEvidence.get([runId, gameKey]);
          return evidence === undefined ? 'ok' : 'missing';
        }
        const parsed = parseRecord(
          storedCapRushPlaybackCursorRowSchema,
          row,
          `cap rush playback cursor ${runId}/${gameKey}`,
          malformed,
        );
        if (cursor < parsed.cursor) return 'ok';
        if (resolved && cursor !== parsed.total) return 'unfinished';
        if (resolved) {
          await this.db.capRushPlaybackCursors.delete([runId, gameKey]);
          await this.db.capRushPlaybackEvidence.delete([runId, gameKey]);
          return 'ok';
        }
        if (cursor !== parsed.cursor) {
          await this.db.capRushPlaybackCursors.put(
            storedCapRushPlaybackCursorRowSchema.parse({
              ...parsed,
              cursor,
              updatedAtIso: new Date().toISOString(),
            }),
          );
        }
        return 'ok';
      },
    );
    if (outcome === 'missing') throw malformed('the broadcast game is missing');
    if (outcome === 'unfinished') {
      throw malformed('the broadcast must reach its final event before it can resolve');
    }
  }

  private async putPlayback(
    runId: string,
    gameKey: string,
    playback: CapRushPlayback,
    updatedAtIso: string,
  ): Promise<void> {
    await this.db.capRushPlaybackEvidence.put(
      storedCapRushPlaybackEvidenceRowSchema.parse({
        saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
        runId,
        gameKey,
        playback: { ...playback, cursor: 0 },
        updatedAtIso,
      }),
    );
    await this.db.capRushPlaybackCursors.put(
      storedCapRushPlaybackCursorRowSchema.parse({
        saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
        runId,
        gameKey,
        cursor: playback.cursor,
        total: playback.tape.events.length + playback.tape.scoring.length,
        updatedAtIso,
      }),
    );
  }

  private async pendingPlaybackOf(runId: string): Promise<Map<string, CapRushPlayback>> {
    return this.db.transaction(
      'r',
      [this.db.capRushPlaybackEvidence, this.db.capRushPlaybackCursors],
      async () => {
        const pending = new Map<string, CapRushPlayback>();
        const evidenceRows = await this.db.capRushPlaybackEvidence
          .where('runId')
          .equals(runId)
          .toArray();
        if (evidenceRows.length === 0) return pending;
        const cursorRows = await this.db.capRushPlaybackCursors
          .where('runId')
          .equals(runId)
          .toArray();
        const cursors = new Map<string, number>();
        for (const row of cursorRows) {
          const parsed = parseRecord(
            storedCapRushPlaybackCursorRowSchema,
            row,
            `cap rush playback cursor ${runId}`,
            malformed,
          );
          cursors.set(parsed.gameKey, parsed.cursor);
        }
        for (const row of evidenceRows) {
          const parsed = parseRecord(
            storedCapRushPlaybackEvidenceRowSchema,
            row,
            `cap rush playback evidence ${runId}`,
            malformed,
          );
          const cursor = cursors.get(parsed.gameKey);
          if (cursor === undefined) throw malformed('the broadcast cursor is missing');
          pending.set(parsed.gameKey, { ...parsed.playback, cursor });
        }
        return pending;
      },
    );
  }

  async clearActiveDraft(): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.capRushActive,
        this.db.capRushCommands,
        this.db.capRushPlaybackCursors,
        this.db.capRushPlaybackEvidence,
        this.db.capRushPlayoffGames,
        this.db.capRushLeagueGames,
      ],
      async () => {
        const row: unknown = await this.db.capRushActive.get(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
        await this.db.capRushActive.delete(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
        if (row === undefined) return;
        const runId =
          typeof row === 'object' && row !== null && 'runId' in row
            ? (row as { runId?: unknown }).runId
            : undefined;
        if (typeof runId === 'string') {
          await this.db.capRushCommands.where('runId').equals(runId).delete();
          await this.db.capRushPlaybackCursors.where('runId').equals(runId).delete();
          await this.db.capRushPlaybackEvidence.where('runId').equals(runId).delete();
          await this.db.capRushPlayoffGames.where('runId').equals(runId).delete();
          await this.db.capRushLeagueGames.where('runId').equals(runId).delete();
        }
      },
    );
  }

  async listRunGames(runId: string): Promise<CapRushStoredGame[]> {
    const rows = await scopedNumericRows(this.db.capRushGames, '[runId+gameNumber]', runId);
    const pending = await this.pendingPlaybackOf(runId);
    return rows
      .map((row) => {
        assertSaveSchemaVersion(row, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
        return parseRecord(storedCapRushGameRowSchema, row, `cap rush game ${runId}`, malformed);
      })
      .sort((left, right) => left.gameNumber - right.gameNumber)
      .map((row) => this.gameWithPlayback(row.game, pending, row.game.gameNumber));
  }

  async listPlayoffGames(runId: string): Promise<CapRushStoredPlayoffGame[]> {
    const rows = await this.db.capRushPlayoffGames.where('runId').equals(runId).toArray();
    const pending = await this.pendingPlaybackOf(runId);
    return rows
      .map((row) => {
        assertSaveSchemaVersion(row, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
        return parseRecord(
          storedCapRushPlayoffGameRowSchema,
          row,
          `cap rush playoff game ${runId}`,
          malformed,
        );
      })
      .map((row) => this.gameWithPlayback(row.game, pending, row.game.gameId))
      .sort((left, right) => left.gameId.localeCompare(right.gameId));
  }

  private gameWithPlayback<T extends CapRushStoredGame | CapRushStoredPlayoffGame>(
    game: T,
    pending: Map<string, CapRushPlayback>,
    gameId: number | string,
  ): T {
    const playback = pending.get(capRushPlaybackGameKey(gameId));
    return playback === undefined ? game : { ...game, playback };
  }

  async listLeagueGames(runId: string): Promise<CapRushLeagueGame[]> {
    const rows = await this.db.capRushLeagueGames.where('runId').equals(runId).toArray();
    return rows
      .map((row) => {
        assertSaveSchemaVersion(row, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
        return parseRecord(
          storedCapRushLeagueGameRowSchema,
          row,
          `cap rush league game ${runId}`,
          malformed,
        );
      })
      .map((row) => row.game)
      .sort((left, right) => left.slot - right.slot || left.gameId.localeCompare(right.gameId));
  }

  async readRunGame(runId: string, gameNumber: number): Promise<CapRushStoredGame | null> {
    const row: unknown = await this.db.capRushGames.get([runId, gameNumber]);
    if (row === undefined) return null;
    assertSaveSchemaVersion(row, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
    const game = parseRecord(
      storedCapRushGameRowSchema,
      row,
      `cap rush game ${runId}/${String(gameNumber)}`,
      malformed,
    ).game;
    const pending = await this.pendingPlaybackOf(runId);
    return this.gameWithPlayback(game, pending, gameNumber);
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
      ...(parsed.franchise === undefined ? {} : { franchise: parsed.franchise }),
      ...(parsed.postseason === undefined ? {} : { postseason: parsed.postseason }),
    };
  }

  private async putHistory(state: CapRushDraftState): Promise<void> {
    if (state.locked === null) {
      throw malformed('a completed cap rush run requires locked inputs');
    }
    const postseason = state.postseason;
    const completedAtIso =
      postseason?.phase === 'complete' ? postseason.completedAt : state.season.completedAt;
    if (completedAtIso === null) {
      throw malformed('an incomplete cap rush season cannot be written to history');
    }
    const aggregate = state.season.aggregate;
    const historyPostseason =
      postseason?.phase === 'complete' &&
      postseason.standings !== null &&
      postseason.championTeamId !== null &&
      postseason.userOutcome.status !== 'pending'
        ? (() => {
            if (isConferencePostseason(postseason)) {
              const entries = capRushConferenceStandingsEntries(postseason.standings);
              const champion = entries.find((entry) => entry.teamId === postseason.championTeamId);
              const user = entries.find((entry) => entry.teamId === state.locked?.human.teamId);
              if (champion === undefined) {
                throw malformed('a completed postseason champion is missing from the standings');
              }
              return {
                championTeamId: champion.teamId,
                championName: champion.displayName,
                isUserChampion: champion.teamId === state.locked.human.teamId,
                userStatus: postseason.userOutcome.status,
                userRound: postseason.userOutcome.round,
                seed: user?.seed ?? null,
                conference: user?.conference ?? champion.conference,
              };
            }
            const champion = postseason.standings.entries.find(
              (entry) => entry.teamId === postseason.championTeamId,
            );
            const user = postseason.standings.entries.find(
              (entry) => entry.teamId === state.locked?.human.teamId,
            );
            if (champion === undefined) {
              throw malformed('a completed postseason champion is missing from the standings');
            }
            return {
              championTeamId: champion.teamId,
              championName: champion.displayName,
              isUserChampion: champion.teamId === state.locked.human.teamId,
              userStatus: postseason.userOutcome.status,
              userRound: postseason.userOutcome.round,
              seed: user?.seed ?? null,
            };
          })()
        : undefined;
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
        ...(state.locked.franchise === undefined ? {} : { franchise: state.locked.franchise }),
        ...(historyPostseason === undefined ? {} : { postseason: historyPostseason }),
      }),
    );
  }
}
