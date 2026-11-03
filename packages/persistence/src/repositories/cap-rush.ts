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
  capRushCommandResultSchema,
  capRushCommandSchema,
  capRushConferenceStandingsEntries,
  capRushLeagueGameSchema,
  capRushReportSchema,
  capRushStoredGameSchema,
  capRushStoredPlayoffGameSchema,
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
  classifyCommandReplay,
  commandEnvelopeMatches,
  readStoredCommand,
} from './save-envelope.ts';
import {
  assertSaveSchemaVersion,
  canonicalEquals,
  getParsedRecord,
  listCompletedHistory,
  parseOptionalRecord,
  parseRecord,
  scopedNumericRows,
  type ParseableSchema,
} from './support.ts';
import type { CapRushApplyOutcomeInput } from '@hoop-rush/data-contracts';
import { CAP_RUSH_RULES_VERSION } from '@hoop-rush/data-contracts';

export type { CapRushApplyOutcomeInput } from '@hoop-rush/data-contracts';

export interface CapRushCompletedRun {
  readonly entry: CapRushHistoryEntry;
  readonly report: CapRushReport | null;
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

function parseStored<T>(schema: ParseableSchema<T>, row: unknown, label: string): T {
  assertSaveSchemaVersion(row, CAP_RUSH_SAVE_SCHEMA_VERSION, unsupported);
  return parseRecord(schema, row, label, malformed);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw malformed(message);
}

export class DexieCapRushRepository {
  private readonly db: HoopRushDatabase;
  constructor(db: HoopRushDatabase) {
    this.db = db;
  }

  async loadActiveDraft(): Promise<CapRushDraftState | null> {
    const row: unknown = await this.db.capRushActive.get(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
    if (row === undefined) return null;
    if (typeof row === 'object' && row !== null && 'draft' in row) {
      const draft = row.draft;
      if (typeof draft === 'object' && draft !== null && 'postseason' in draft) {
        const postseason = draft.postseason;
        if (
          typeof postseason === 'object' &&
          postseason !== null &&
          'version' in postseason &&
          postseason.version === 'cap-rush-postseason-v1'
        ) {
          throw unsupported('active cap rush draft uses an unsupported postseason format');
        }
      }
      if (
        typeof draft === 'object' &&
        draft !== null &&
        'postseasonEligible' in draft &&
        draft.postseasonEligible === true &&
        'locked' in draft &&
        typeof draft.locked === 'object' &&
        draft.locked !== null &&
        !('leagueSchedule' in draft.locked)
      ) {
        throw unsupported('active cap rush draft uses an unsupported league format');
      }
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
        if (
          typeof versionSet === 'object' &&
          versionSet !== null &&
          'rulesVersion' in versionSet &&
          typeof versionSet.rulesVersion === 'string' &&
          versionSet.rulesVersion !== CAP_RUSH_RULES_VERSION
        ) {
          throw unsupported('active cap rush draft uses an unsupported rules version');
        }
      }
    }
    const parsed = parseStored(storedCapRushDraftRowSchema, row, 'active cap rush draft');
    if (capRushStateDigest(parsed.draft) !== parsed.stateDigest) {
      throw malformed('active cap rush draft digest does not match its state');
    }
    return parsed.draft;
  }

  async loadCommandResult(commandId: string): Promise<CapRushCommandResult | null> {
    const stored = await getParsedRecord(this.db.capRushCommands, commandId as CommandId, (row) =>
      parseStored(storedCapRushCommandRowSchema, row, `cap rush command ${commandId}`),
    );
    return stored?.result ?? null;
  }

  async applyOutcome(input: CapRushApplyOutcomeInput): Promise<CapRushCommandResult> {
    const result = capRushCommandResultSchema.parse(input.outcome.result);
    invariant(
      input.expectedRevision === result.revisionBefore,
      'commit expected revision does not match the outcome receipt',
    );
    const command = capRushCommandSchema.parse(input.command);
    const state = input.outcome.state;
    invariant(
      command.commandId === result.commandId && command.runId === result.runId,
      'cap rush command envelope does not match the outcome receipt',
    );
    invariant(state.runId === result.runId, 'cap rush outcome state belongs to another run');
    invariant(
      capRushStateDigest(state) === result.stateDigest,
      'cap rush outcome state digest does not match the receipt',
    );
    const accepted = result.status === 'accepted';
    if (accepted) {
      invariant(
        result.revisionAfter > result.revisionBefore,
        'accepted cap rush commands must advance the draft revision',
      );
      invariant(
        state.revision === result.revisionAfter,
        'accepted cap rush state revision does not match the receipt',
      );
    } else {
      invariant(
        result.revisionAfter === result.revisionBefore && state.revision === result.revisionBefore,
        'rejected cap rush commands must not change the draft revision',
      );
    }
    const game = parseOptionalRecord(
      capRushStoredGameSchema,
      input.game,
      'accepted cap rush game',
      malformed,
    );
    const playoffGame = parseOptionalRecord(
      capRushStoredPlayoffGameSchema,
      input.playoffGame,
      'accepted cap rush playoff game',
      malformed,
    );
    const report = parseOptionalRecord(
      capRushReportSchema,
      input.report,
      'cap rush season report',
      malformed,
    );
    const leagueGames = (input.leagueGames ?? []).map((game) =>
      parseRecord(capRushLeagueGameSchema, game, 'accepted cap rush league game', malformed),
    );
    invariant(
      accepted || (game === null && playoffGame === null && report === null),
      'rejected cap rush commands cannot carry stored artifacts',
    );
    invariant(
      accepted || leagueGames.length === 0,
      'rejected cap rush commands cannot carry league games',
    );
    if (leagueGames.length > 0) {
      invariant(
        command.command === 'accept-cap-rush-game' ||
          command.command === 'accept-cap-rush-league-games',
        'stored league games require an accept command',
      );
      const acceptedGames =
        command.command === 'accept-cap-rush-league-games'
          ? command.leagueGames
          : (command.leagueGames ?? []);
      const slot =
        command.command === 'accept-cap-rush-league-games' ? command.slot : command.cursor;
      invariant(
        acceptedGames.length === leagueGames.length,
        'accept command does not describe the stored league games',
      );
      for (const leagueGame of leagueGames) {
        const commandGame = acceptedGames.find((entry) => entry.gameId === leagueGame.gameId);
        invariant(
          commandGame !== undefined && canonicalEquals(commandGame, leagueGame),
          'stored league game does not match the accept command',
        );
        invariant(leagueGame.slot === slot, 'stored league game belongs to another slot');
      }
    }
    if (playoffGame !== null) {
      invariant(
        command.command === 'accept-cap-rush-playoff-game',
        'stored playoff games require a playoff accept command',
      );
      invariant(
        canonicalEquals(command.game, playoffGame.summary),
        'playoff accept command does not describe the stored game',
      );
      invariant(
        canonicalEquals(command.audit, playoffGame.audit),
        'stored playoff audit does not match the accept command',
      );
      invariant(
        canonicalEquals(command.result, playoffGame.result),
        'stored playoff result does not match the accept command',
      );
      const acceptedGame = state.postseason?.series
        .flatMap((series) => series.games)
        .find((entry) => entry.gameId === playoffGame.summary.gameId);
      invariant(
        acceptedGame !== undefined,
        'stored playoff game is missing from the accepted postseason',
      );
      invariant(
        canonicalEquals(acceptedGame, playoffGame.summary),
        'stored playoff game disagrees with the postseason state',
      );
    }
    if (game !== null) {
      invariant(
        command.command === 'accept-cap-rush-game',
        'stored cap rush games require an accept command',
      );
      invariant(
        command.cursor === game.gameNumber && canonicalEquals(command.summary, game.summary),
        'accept command does not describe the stored game',
      );
      invariant(
        game.summary.inputDigest === command.inputDigest &&
          game.summary.resultDigest === command.resultDigest,
        'stored game digests do not match the accept command',
      );
      invariant(
        canonicalEquals(state.season.games[game.gameNumber - 1], game.summary),
        'stored game is missing from the accepted season state',
      );
    }
    const broadcastGame = game ?? playoffGame;
    if (broadcastGame?.playback !== undefined) {
      const playback = broadcastGame.playback;
      const broadcastResult = broadcastGame.result;
      invariant(
        broadcastResult !== null && playback.cursor === 0,
        'a new broadcast requires an initial cursor and user result',
      );
      const audit = auditHavocBattleGame(
        playback.input,
        soloToBattleResult(
          broadcastResult,
          broadcastResult.humanSide,
          havocBattleGameInputDigest(playback.input),
        ),
        playback.tape,
      );
      invariant(audit.ok, 'the recorded broadcast does not reconcile with the accepted result');
    }
    if (report !== null) {
      const reportCommandError = capRushReportCommandError({ command, report });
      if (reportCommandError !== null) throw malformed(reportCommandError);
      invariant(report.runId === result.runId, 'cap rush season report belongs to another run');
      invariant(
        state.season.completedAt !== null,
        'a cap rush season report requires a completed season',
      );
      invariant(
        canonicalEquals(report.aggregate, state.season.aggregate) &&
          canonicalEquals(report.apronTriggers, state.season.apronTriggers) &&
          canonicalEquals(report.games, state.season.games),
        'cap rush season report does not match the accepted season state',
      );
      const locked = state.locked;
      invariant(
        locked !== null &&
          report.variant === locked.variant &&
          report.payrollDollars === locked.payrollDollars &&
          report.payrollStatus === locked.payrollStatus,
        'cap rush season report does not match the locked inputs',
      );
      if (report.postseason !== undefined) {
        const postseason = state.postseason;
        invariant(
          postseason !== undefined &&
            postseason.phase === 'complete' &&
            postseason.standings !== null &&
            postseason.championTeamId === report.postseason.championTeamId &&
            postseason.finalsMvp !== null &&
            canonicalEquals(postseason.finalsMvp, report.postseason.finalsMvp) &&
            canonicalEquals(postseason.series, report.postseason.series) &&
            canonicalEquals(postseason.standings, report.postseason.standings),
          'cap rush postseason report does not match the accepted bracket',
        );
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
        const existing = await readStoredCommand({
          table: this.db.capRushCommands,
          commandId: result.commandId,
          parse: (row) =>
            parseStored(storedCapRushCommandRowSchema, row, `cap rush command ${result.commandId}`),
        });
        const replay = classifyCommandReplay({
          stored: existing,
          incoming: command,
          resultOf: (row) => row.result,
          // Cap Rush replays only when both the command and the result status match.
          matches: (row, incoming) =>
            commandEnvelopeMatches(incoming, row.command) && row.result.status === result.status,
        });
        if (replay.kind === 'replayed') return replay.result;
        if (replay.kind === 'conflict') throw new CapRushCommandConflictError(result.commandId);

        const pendingPlayback = await this.db.capRushPlaybackEvidence
          .where('runId')
          .equals(result.runId)
          .count();
        if (command.command !== 'accept-cap-rush-league-games' && pendingPlayback > 0) {
          return null;
        }

        const now = new Date().toISOString();
        const active = await getParsedRecord(
          this.db.capRushActive,
          CAP_RUSH_ACTIVE_DRAFT_RECORD_ID,
          (row) => parseStored(storedCapRushDraftRowSchema, row, 'active cap rush draft'),
        );
        let createdAtIso = now;
        if (active !== null) {
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
          if (active === null && result.revisionBefore !== 0) {
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
        const parsed = parseStored(
          storedCapRushPlaybackCursorRowSchema,
          row,
          `cap rush playback cursor ${runId}/${gameKey}`,
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
          const parsed = parseStored(
            storedCapRushPlaybackCursorRowSchema,
            row,
            `cap rush playback cursor ${runId}`,
          );
          cursors.set(parsed.gameKey, parsed.cursor);
        }
        for (const row of evidenceRows) {
          const parsed = parseStored(
            storedCapRushPlaybackEvidenceRowSchema,
            row,
            `cap rush playback evidence ${runId}`,
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
          typeof row === 'object' && row !== null ? (row as { runId?: unknown }).runId : undefined;
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
      .map((row) => parseStored(storedCapRushGameRowSchema, row, `cap rush game ${runId}`))
      .sort((left, right) => left.gameNumber - right.gameNumber)
      .map((row) => this.gameWithPlayback(row.game, pending, row.game.gameNumber));
  }

  async listPlayoffGames(runId: string): Promise<CapRushStoredPlayoffGame[]> {
    const rows = await this.db.capRushPlayoffGames.where('runId').equals(runId).toArray();
    const pending = await this.pendingPlaybackOf(runId);
    return rows
      .map((row) =>
        parseStored(storedCapRushPlayoffGameRowSchema, row, `cap rush playoff game ${runId}`),
      )
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
      .map((row) =>
        parseStored(storedCapRushLeagueGameRowSchema, row, `cap rush league game ${runId}`),
      )
      .map((row) => row.game)
      .sort((left, right) => left.slot - right.slot || left.gameId.localeCompare(right.gameId));
  }

  async readRunGame(runId: string, gameNumber: number): Promise<CapRushStoredGame | null> {
    const stored = await getParsedRecord(this.db.capRushGames, [runId, gameNumber], (row) =>
      parseStored(storedCapRushGameRowSchema, row, `cap rush game ${runId}/${String(gameNumber)}`),
    );
    if (stored === null) return null;
    const pending = await this.pendingPlaybackOf(runId);
    return this.gameWithPlayback(stored.game, pending, gameNumber);
  }

  async listHistory(): Promise<CapRushHistoryEntry[]> {
    const rows = await listCompletedHistory(this.db.capRushHistory, 'completedAtIso');
    return rows.map((row) => this.historyEntryOf(row, 'cap rush history'));
  }

  async readReport(runId: string): Promise<CapRushReport | null> {
    const stored = await getParsedRecord(this.db.capRushReports, asRunId(runId), (row) =>
      parseStored(storedCapRushReportRowSchema, row, `cap rush report ${runId}`),
    );
    return stored?.report ?? null;
  }

  async readCompletedRun(runId: string): Promise<CapRushCompletedRun | null> {
    const entry = await getParsedRecord(this.db.capRushHistory, asRunId(runId), (row) =>
      this.historyEntryOf(row, `cap rush history ${runId}`),
    );
    if (entry === null) return null;
    return { entry, report: await this.readReport(runId) };
  }

  private historyEntryOf(row: unknown, label: string): CapRushHistoryEntry {
    const { saveSchemaVersion: _saveSchemaVersion, ...entry } = parseStored(
      storedCapRushHistoryRowSchema,
      row,
      label,
    );
    return entry;
  }

  private async putHistory(state: CapRushDraftState): Promise<void> {
    const locked = state.locked;
    invariant(locked !== null, 'a completed cap rush run requires locked inputs');
    const postseason = state.postseason;
    const completedAtIso =
      postseason?.phase === 'complete' ? postseason.completedAt : state.season.completedAt;
    invariant(
      completedAtIso !== null,
      'an incomplete cap rush season cannot be written to history',
    );
    const aggregate = state.season.aggregate;
    const historyPostseason =
      postseason?.phase === 'complete' &&
      postseason.standings !== null &&
      postseason.championTeamId !== null &&
      postseason.userOutcome.status !== 'pending'
        ? (() => {
            const entries = capRushConferenceStandingsEntries(postseason.standings);
            const champion = entries.find((entry) => entry.teamId === postseason.championTeamId);
            const user = entries.find((entry) => entry.teamId === locked.human.teamId);
            invariant(
              champion !== undefined,
              'a completed postseason champion is missing from the standings',
            );
            const conference =
              'conference' in champion
                ? user !== undefined && 'conference' in user
                  ? user.conference
                  : champion.conference
                : undefined;
            return {
              championTeamId: champion.teamId,
              championName: champion.displayName,
              isUserChampion: champion.teamId === locked.human.teamId,
              userStatus: postseason.userOutcome.status,
              userRound: postseason.userOutcome.round,
              seed: user?.seed ?? null,
              ...(conference === undefined ? {} : { conference }),
            };
          })()
        : undefined;
    await this.db.capRushHistory.put(
      storedCapRushHistoryRowSchema.parse({
        saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
        runId: state.runId,
        variant: locked.variant,
        payrollStatus: locked.payrollStatus,
        payrollDollars: locked.payrollDollars,
        wins: aggregate.wins,
        losses: aggregate.losses,
        perfectSeason: aggregate.perfectSeason,
        completedAtIso,
        ...(locked.franchise === undefined ? {} : { franchise: locked.franchise }),
        ...(historyPostseason === undefined ? {} : { postseason: historyPostseason }),
      }),
    );
  }
}

export type CapRushRepository = Pick<
  DexieCapRushRepository,
  | 'loadActiveDraft'
  | 'loadCommandResult'
  | 'applyOutcome'
  | 'listRunGames'
  | 'listPlayoffGames'
  | 'listLeagueGames'
  | 'listHistory'
  | 'readReport'
  | 'updatePlayback'
  | 'clearActiveDraft'
>;
