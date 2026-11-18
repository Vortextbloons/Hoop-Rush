import type {
  CapRushCommand,
  CapRushCommandResult,
  CapRushDraftState,
  CapRushHistoryEntry,
  CapRushLeagueAggregate,
  CapRushLeagueGame,
  CapRushLeagueResult,
  CapRushLockedInputs,
  CapRushPlayback,
  CapRushReport,
  CapRushStoredGame,
  CapRushStoredPlayoffGame,
  CommandId,
  Id,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_LEGACY_SAVE_SCHEMA_VERSION,
  CAP_RUSH_SAVE_SCHEMA_VERSION,
  CAP_RUSH_SALARY_CURVE_VERSION,
  canonicalJson,
  capRushCommandResultSchema,
  capRushCommandSchema,
  capRushConferenceStandingsEntries,
  capRushDraftStateSchema,
  capRushLeagueGameSchema,
  capRushLeagueResultOf,
  capRushReportSchema,
  capRushStoredGameSchema,
  capRushStoredPlayoffGameSchema,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import {
  auditHavocBattleGame,
  capRushAchievementFactsFromReport,
  capRushEmptyLeagueAggregate,
  capRushFoldLeagueAggregate,
  evaluateCapRushAchievements,
  havocBattleGameInputDigest,
  soloToBattleResult,
  capRushStateDigest,
} from '@hoop-rush/engine';
import {
  CAP_RUSH_ACTIVE_DRAFT_RECORD_ID,
  capRushPlaybackGameKey,
  storedCapRushCommandRowSchema,
  storedCapRushDraftProgressEnvelopeRowSchema,
  storedCapRushDraftProgressRowSchema,
  storedCapRushGameRowSchema,
  storedCapRushHistoryRowSchema,
  storedCapRushLeagueAggregateRowSchema,
  storedCapRushLeagueGameResultRowSchema,
  storedCapRushLeagueGameRowSchema,
  storedCapRushLeagueScoreRowSchema,
  storedCapRushLegacyDraftRowSchema,
  storedCapRushLockedInputsRowSchema,
  storedCapRushPlaybackCursorRowSchema,
  storedCapRushPlaybackEvidenceRowSchema,
  storedCapRushPlayoffGameRowSchema,
  storedCapRushReportRowSchema,
  type CapRushStoredLockedInputsRef,
  type StoredCapRushDraftProgressRow,
} from '../schemas/cap-rush-record.ts';
import { HoopRushDatabase } from './dexie.ts';
import { DexieProfileRepository } from './profile.ts';
import { classifyCommandReplay, readStoredCommand } from './save-envelope.ts';
import {
  canonicalEquals,
  commandReceiptMatches,
  getParsedRecord,
  listCompletedHistory,
  parseOptionalRecord,
  parseRecord,
  saveSchemaVersionOf,
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

function readableSaveSchemaVersionOf(
  row: unknown,
): typeof CAP_RUSH_LEGACY_SAVE_SCHEMA_VERSION | typeof CAP_RUSH_SAVE_SCHEMA_VERSION {
  const version = saveSchemaVersionOf(row);
  if (version !== CAP_RUSH_LEGACY_SAVE_SCHEMA_VERSION && version !== CAP_RUSH_SAVE_SCHEMA_VERSION) {
    throw unsupported(
      `stored save schema ${version === null ? 'unknown' : String(version)} does not match current ${String(CAP_RUSH_SAVE_SCHEMA_VERSION)}`,
    );
  }
  return version;
}

function parseStored<T>(schema: ParseableSchema<T>, row: unknown, label: string): T {
  readableSaveSchemaVersionOf(row);
  return parseRecord(schema, row, label, malformed);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw malformed(message);
}

interface ActiveDraftEnvelope {
  readonly runId: string;
  readonly revision: number;
  readonly createdAtIso: string;
  readonly lockedDigest: string | null;
  /** Version-3 rows carry the immutably locked subtree inline. */
  readonly legacyLocked: CapRushLockedInputs | null;
}

const CAP_RUSH_LOCKED_INPUTS_DIGEST_PREFIX = 'cap-rush-locked-inputs-v1';

function capRushLockedInputsDigest(locked: CapRushLockedInputs): string {
  return seasonDigestHex(`${CAP_RUSH_LOCKED_INPUTS_DIGEST_PREFIX}\u0000${canonicalJson(locked)}`);
}

/**
 * Returns the stable format problems that older Cap Rush saves report as
 * unsupported rather than malformed. Applied to the inline version-3 draft
 * before parsing and to the hydrated version-4 draft after parsing.
 */
function assertSupportedDraftFormat(
  draft: unknown,
  options: { lockedIsReference?: boolean } = {},
): void {
  if (typeof draft !== 'object' || draft === null) return;
  const value = draft as Record<string, unknown>;
  const postseason = value.postseason;
  if (
    typeof postseason === 'object' &&
    postseason !== null &&
    'version' in postseason &&
    postseason.version === 'cap-rush-postseason-v1'
  ) {
    throw unsupported('active cap rush draft uses an unsupported postseason format');
  }
  const locked = value.locked;
  if (
    value.postseasonEligible === true &&
    options.lockedIsReference !== true &&
    typeof locked === 'object' &&
    locked !== null &&
    !('leagueSchedule' in locked)
  ) {
    throw unsupported('active cap rush draft uses an unsupported league format');
  }
  const versionSet = value.versionSet;
  if (typeof versionSet === 'object' && versionSet !== null) {
    if (
      'salaryCurveVersion' in versionSet &&
      typeof versionSet.salaryCurveVersion === 'string' &&
      versionSet.salaryCurveVersion !== CAP_RUSH_SALARY_CURVE_VERSION
    ) {
      throw unsupported('active cap rush draft uses an unsupported salary curve version');
    }
    if (
      'rulesVersion' in versionSet &&
      typeof versionSet.rulesVersion === 'string' &&
      versionSet.rulesVersion !== CAP_RUSH_RULES_VERSION
    ) {
      throw unsupported('active cap rush draft uses an unsupported rules version');
    }
  }
}

export class DexieCapRushRepository {
  private readonly db: HoopRushDatabase;
  constructor(db: HoopRushDatabase) {
    this.db = db;
  }

  async loadActiveDraft(): Promise<CapRushDraftState | null> {
    return this.db.transaction('r', [this.db.capRushActive, this.db.capRushLockedInputs], () =>
      this.readActiveDraft(),
    );
  }

  private async readActiveDraft(): Promise<CapRushDraftState | null> {
    const row: unknown = await this.db.capRushActive.get(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
    if (row === undefined) return null;
    const version = readableSaveSchemaVersionOf(row);
    if (version === CAP_RUSH_LEGACY_SAVE_SCHEMA_VERSION) {
      // Version 3 stores the whole draft, locked inputs included, inline. It is
      // read-only compatible: the next accepted command rewrites it as version 4.
      if (typeof row === 'object' && row !== null && 'draft' in row) {
        assertSupportedDraftFormat((row as { draft?: unknown }).draft);
      }
      const parsed = parseStored(storedCapRushLegacyDraftRowSchema, row, 'active cap rush draft');
      if (capRushStateDigest(parsed.draft) !== parsed.stateDigest) {
        throw malformed('active cap rush draft digest does not match its state');
      }
      return parsed.draft;
    }
    if (typeof row === 'object' && row !== null && 'draft' in row) {
      // Version literals inside the draft would fail parsing as "malformed";
      // report the same stale-version cases as unsupported before that.
      // The reference cannot answer the league-format check; the hydrated draft
      // below is checked again with the full locked subtree available.
      assertSupportedDraftFormat((row as { draft?: unknown }).draft, {
        lockedIsReference: true,
      });
    }
    const parsed = parseStored(
      storedCapRushDraftProgressRowSchema,
      row,
      'active cap rush draft progress',
    );
    const draft = await this.hydrateDraft(parsed);
    if (capRushStateDigest(draft) !== parsed.stateDigest) {
      throw malformed('active cap rush draft digest does not match its state');
    }
    return draft;
  }

  private async hydrateDraft(parsed: StoredCapRushDraftProgressRow): Promise<CapRushDraftState> {
    const reference = parsed.draft.locked;
    if (reference === null) {
      return parseRecord(capRushDraftStateSchema, parsed.draft, 'active cap rush draft', malformed);
    }
    const stored = await getParsedRecord(this.db.capRushLockedInputs, parsed.runId, (row) =>
      parseStored(
        storedCapRushLockedInputsRowSchema,
        row,
        `cap rush locked inputs ${parsed.runId}`,
      ),
    );
    if (stored === null) throw malformed('stored cap rush locked inputs are missing');
    if (
      stored.runId !== reference.runId ||
      stored.digest !== reference.digest ||
      stored.digest !== this.digestOfLockedInputs(stored.locked)
    ) {
      throw malformed('stored cap rush locked inputs do not match the saved draft');
    }
    const draft = { ...parsed.draft, locked: stored.locked };
    assertSupportedDraftFormat(draft);
    return parseRecord(capRushDraftStateSchema, draft, 'active cap rush draft', malformed);
  }

  private readonly lockedDigests = new WeakMap<object, string>();

  /**
   * Locked inputs never change once a season starts, so their canonical digest
   * is cached per frozen object. The engine carries the same object through
   * every command, making repeat commits O(1) instead of re-serializing ~1 MB.
   */
  private digestOfLockedInputs(locked: CapRushLockedInputs): string {
    const cached = this.lockedDigests.get(locked);
    if (cached !== undefined) return cached;
    const digest = capRushLockedInputsDigest(locked);
    this.lockedDigests.set(locked, digest);
    return digest;
  }

  private async readActiveDraftEnvelope(): Promise<ActiveDraftEnvelope | null> {
    const row: unknown = await this.db.capRushActive.get(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
    if (row === undefined) return null;
    const version = readableSaveSchemaVersionOf(row);
    if (version === CAP_RUSH_LEGACY_SAVE_SCHEMA_VERSION) {
      const parsed = parseStored(storedCapRushLegacyDraftRowSchema, row, 'active cap rush draft');
      if (capRushStateDigest(parsed.draft) !== parsed.stateDigest) {
        throw malformed('active cap rush draft digest does not match its state');
      }
      return {
        runId: parsed.runId,
        revision: parsed.revision,
        createdAtIso: parsed.createdAtIso,
        lockedDigest:
          parsed.draft.locked === null ? null : this.digestOfLockedInputs(parsed.draft.locked),
        legacyLocked: parsed.draft.locked,
      };
    }
    const parsed = parseStored(
      storedCapRushDraftProgressEnvelopeRowSchema,
      row,
      'active cap rush draft progress',
    );
    return {
      runId: parsed.runId,
      revision: parsed.revision,
      createdAtIso: parsed.createdAtIso,
      lockedDigest: parsed.draft.locked?.digest ?? null,
      legacyLocked: null,
    };
  }

  /**
   * Writes the immutable locked inputs on the first lock and keeps their
   * reference from then on. Version-3 saves migrate their inline subtree here
   * on the first accepted command. A changed lock is rejected rather than
   * silently replacing the inputs a season was simulated with.
   */
  private async writeLockedInputsOnce(
    state: CapRushDraftState,
    active: ActiveDraftEnvelope | null,
    updatedAtIso: string,
  ): Promise<CapRushStoredLockedInputsRef | null> {
    const locked = state.locked;
    if (locked === null) {
      invariant(
        active === null || active.lockedDigest === null,
        'a locked cap rush run cannot drop its locked inputs',
      );
      return null;
    }
    const digest = this.digestOfLockedInputs(locked);
    if (active !== null && active.lockedDigest !== null) {
      invariant(
        active.lockedDigest === digest,
        'locked inputs changed after the lineup was locked',
      );
      if (active.legacyLocked === null) {
        return { runId: state.runId, digest };
      }
    }
    await this.db.capRushLockedInputs.put(
      storedCapRushLockedInputsRowSchema.parse({
        saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
        runId: state.runId,
        digest,
        locked,
        updatedAtIso,
      }),
    );
    return { runId: state.runId, digest };
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
    // Validate the domain state on write. The frozen locked subtree passes the
    // immutable check in O(1), so this no longer re-parses ~1 MB per command.
    const state = capRushDraftStateSchema.parse(input.outcome.state);
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
      const acceptedIds =
        command.command === 'accept-cap-rush-league-games'
          ? command.leagueGameIds
          : (command.leagueGameIds ?? []);
      const slot =
        command.command === 'accept-cap-rush-league-games' ? command.slot : command.cursor;
      invariant(
        acceptedIds.length === leagueGames.length,
        'accept command does not describe the stored league games',
      );
      for (const leagueGame of leagueGames) {
        invariant(
          acceptedIds.includes(leagueGame.gameId),
          'stored league game is missing from the accept command',
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
      // The adapter validates the result again, and the committed receipt already
      // proves this payload matches the stored state. Compute the battle input
      // digest once and hand it to the audit instead of hashing twice.
      const inputDigest = havocBattleGameInputDigest(playback.input);
      const audit = auditHavocBattleGame(
        playback.input,
        soloToBattleResult(broadcastResult, broadcastResult.humanSide, inputDigest),
        playback.tape,
        { inputDigest, resultValidated: true },
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

    const championship =
      report?.postseason && state.postseason?.championTeamId === state.locked?.human.teamId
        ? state.locked
        : null;
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
        this.db.capRushLeagueResults,
        this.db.capRushLockedInputs,
        this.db.capRushLeagueAggregates,
        this.db.capRushHistory,
        this.db.capRushReports,
        ...(championship
          ? [
              this.db.profileBindings,
              this.db.profileGames,
              this.db.profiles,
              this.db.archivedProfiles,
            ]
          : []),
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
            commandReceiptMatches(incoming, row.command) && row.result.status === result.status,
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
        const active = await this.readActiveDraftEnvelope();
        let createdAtIso = now;
        if (active !== null) {
          if (active.revision !== result.revisionBefore) {
            throw new CapRushStaleRevisionError(
              result.commandId,
              result.revisionBefore,
              active.revision,
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
          const lockedRef = await this.writeLockedInputsOnce(state, active, now);
          await this.db.capRushActive.put(
            storedCapRushDraftProgressRowSchema.parse({
              saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
              recordId: CAP_RUSH_ACTIVE_DRAFT_RECORD_ID,
              runId: state.runId,
              revision: state.revision,
              stateDigest: result.stateDigest,
              // The locked subtree lives in `capRushLockedInputs` from here on.
              draft: { ...state, locked: lockedRef },
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
            // Keep a compact score row beside every full box so schedule and
            // standings reads never deserialize the box-score table.
            await this.db.capRushLeagueResults.bulkPut(
              leagueGames.map((leagueGame) =>
                storedCapRushLeagueScoreRowSchema.parse({
                  saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
                  runId: result.runId,
                  gameId: leagueGame.gameId,
                  result: capRushLeagueResultOf(leagueGame),
                  updatedAtIso: now,
                }),
              ),
            );
            // Fold the same commit into the compact aggregate so summary views
            // never need to load these boxes again.
            const existingAggregate =
              (await this.readLeagueAggregate(result.runId)) ?? capRushEmptyLeagueAggregate();
            await this.db.capRushLeagueAggregates.put(
              storedCapRushLeagueAggregateRowSchema.parse({
                saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
                runId: result.runId,
                aggregate: capRushFoldLeagueAggregate(existingAggregate, leagueGames),
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
            if (championship) {
              const bindingId = `cap-rush:${state.runId}`;
              if (await this.db.profileBindings.get(bindingId)) {
                await new DexieProfileRepository(this.db).awardAchievements(
                  bindingId,
                  'championship',
                  evaluateCapRushAchievements(
                    capRushAchievementFactsFromReport(report, championship.human.starters),
                  ),
                );
              }
            }
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
        this.db.capRushLeagueResults,
        this.db.capRushLockedInputs,
        this.db.capRushLeagueAggregates,
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
          await this.db.capRushLeagueResults.where('runId').equals(runId).delete();
          await this.db.capRushLockedInputs.delete(runId as Id);
          await this.db.capRushLeagueAggregates.delete(runId as Id);
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

  /**
   * Compact league results for schedules, standings and records.
   *
   * This reads only the keys and scores the views need. Full box scores stay
   * in the league-game table and load through {@link readLeagueGame} when a
   * caller actually opens one.
   */
  async listLeagueResults(runId: string): Promise<CapRushLeagueResult[]> {
    const tables = [this.db.capRushLeagueGames, this.db.capRushLeagueResults];
    const scores = await this.db.transaction('r', tables, async () => {
      const scoreRows = this.db.capRushLeagueResults.where('runId').equals(runId);
      const [scoreCount, gameCount] = await Promise.all([
        scoreRows.count(),
        this.db.capRushLeagueGames.where('runId').equals(runId).count(),
      ]);
      return scoreCount === gameCount ? scoreRows.toArray() : null;
    });
    if (scores !== null) {
      return scores
        .map(
          (row) =>
            parseStored(storedCapRushLeagueScoreRowSchema, row, `cap rush league score ${runId}`)
              .result,
        )
        .sort((left, right) => left.slot - right.slot || left.gameId.localeCompare(right.gameId));
    }
    // Saves written before score rows existed still resume: project the full
    // boxes once and cache the projection in the same transaction so a
    // concurrent abandon cannot leave orphan score rows behind.
    return this.db.transaction('rw', tables, async () => {
      const rows = await this.db.capRushLeagueGames.where('runId').equals(runId).toArray();
      const results = rows
        .map((row) =>
          parseStored(
            storedCapRushLeagueGameResultRowSchema,
            row,
            `cap rush league result ${runId}`,
          ),
        )
        .map((row) => row.game)
        .sort((left, right) => left.slot - right.slot || left.gameId.localeCompare(right.gameId));
      if (results.length > 0) {
        const updatedAtIso = new Date().toISOString();
        await this.db.capRushLeagueResults.bulkPut(
          results.map((result) =>
            storedCapRushLeagueScoreRowSchema.parse({
              saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
              runId,
              gameId: result.gameId,
              result,
              updatedAtIso,
            }),
          ),
        );
      }
      return results;
    });
  }

  async readLeagueGame(runId: string, gameId: string): Promise<CapRushLeagueGame | null> {
    const stored = await getParsedRecord(
      this.db.capRushLeagueGames,
      [runId, gameId] as [string, string],
      (row) => parseStored(storedCapRushLeagueGameRowSchema, row, `cap rush league game ${gameId}`),
    );
    return stored?.game ?? null;
  }

  async readLeagueAggregate(runId: string): Promise<CapRushLeagueAggregate | null> {
    const row: unknown = await this.db.capRushLeagueAggregates.get(asRunId(runId));
    if (row === undefined) return null;
    return parseStored(
      storedCapRushLeagueAggregateRowSchema,
      row,
      `cap rush league aggregate ${runId}`,
    ).aggregate;
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
  | 'listLeagueResults'
  | 'readLeagueGame'
  | 'readLeagueAggregate'
  | 'listHistory'
  | 'readReport'
  | 'updatePlayback'
  | 'clearActiveDraft'
>;
