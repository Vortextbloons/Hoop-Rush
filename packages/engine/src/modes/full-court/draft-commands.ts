import type {
  CommandId,
  FullCourtCommand,
  FullCourtCommandResult,
  FullCourtCreateDraftCommand,
  FullCourtDraftPick,
  FullCourtDraftState,
  FullCourtFinishDraftCommand,
  FullCourtPickPlayerCommand,
  FullCourtPurchaseReportCommand,
  FullCourtRemovePlayerCommand,
  FullCourtReportTarget,
  FullCourtSpendingEntry,
} from '@hoop-rush/data-contracts';
import {
  FULL_COURT_DEFAULT_MONEY,
  FULL_COURT_DRAFT_SCHEMA_VERSION,
  FULL_COURT_MAX_REPORTS,
  FULL_COURT_MAX_ROSTER_SIZE,
  FULL_COURT_MIN_ROSTER_SIZE,
  FULL_COURT_OPPONENT_VERSION,
  canonicalJson,
  fullCourtCreateDraftCommandSchema,
  fullCourtDraftStateSchema,
  fullCourtReportPriceDollars,
  fullCourtReportTargetKey,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import { assertCapRushCatalogSourceMatches } from '../cap-rush/catalog.ts';
import {
  fullCourtAssessPick,
  fullCourtAssessPurchase,
  type FullCourtPickAssessment,
} from './draft-economy.ts';
import {
  fullCourtMinimumCompletionDollars,
  fullCourtPlayerOf,
  fullCourtPoolPlayerOf,
  fullCourtSalaryDollarsOf,
  type FullCourtCatalogIndex,
} from './draft-catalog.ts';
import { createFullCourtDraftPool } from './draft-pool.ts';
import { drawFullCourtRoundOffer } from './draft-offer.ts';
import {
  acceptFullCourtCommand,
  rejectFullCourtCommand,
  validateFullCourtRunAndRevision,
  type FullCourtCommandEnvironment,
  type FullCourtCommandOutcome,
} from './draft-outcome.ts';
function salaryEntryIdOf(runId: string, playerVersionId: string): string {
  return `fcs-${seasonDigestHex(canonicalJson({ runId, playerVersionId }))}`;
}

function reportEntryIdOf(runId: string, target: FullCourtReportTarget): string {
  return `fcs-${seasonDigestHex(
    canonicalJson({ runId, report: fullCourtReportTargetKey(target) }),
  )}`;
}

function salariesOf(
  state: FullCourtDraftState,
  picks: readonly FullCourtDraftPick[],
  commandId: CommandId,
): FullCourtSpendingEntry[] {
  const previous = new Map(
    state.spending
      .filter((entry) => entry.kind === 'salary' && entry.playerVersionId !== undefined)
      .map((entry) => [entry.playerVersionId, entry] as const),
  );
  const salaries = picks.map((pick) => {
    const playerVersionId = pick.player.playerVersionId;
    const entry = previous.get(playerVersionId);
    return {
      entryId: salaryEntryIdOf(state.runId, playerVersionId),
      kind: 'salary' as const,
      dollars: pick.salaryDollars,
      commandId: entry?.commandId ?? commandId,
      playerVersionId,
    };
  });
  return [...state.spending.filter((entry) => entry.kind !== 'salary'), ...salaries];
}

export interface CreateFullCourtDraftOptions {
  /** Defaults to `'seeded'` for new runs; `'open'` preserves legacy open-catalog fixtures. */
  readonly pool?: 'seeded' | 'open';
}

export function createFullCourtDraftState(
  command: FullCourtCreateDraftCommand,
  index: FullCourtCatalogIndex,
  options: CreateFullCourtDraftOptions = {},
): FullCourtDraftState {
  const parsed = fullCourtCreateDraftCommandSchema.parse(command);
  assertCapRushCatalogSourceMatches(index.catalog.source, parsed.catalog);
  const money = parsed.money ?? FULL_COURT_DEFAULT_MONEY;
  const pool =
    options.pool === 'open'
      ? undefined
      : createFullCourtDraftPool({ runSeed: parsed.runSeed, index, money });
  const minimumPayroll = fullCourtMinimumCompletionDollars(
    index,
    new Set(),
    FULL_COURT_MIN_ROSTER_SIZE,
    pool,
  );
  if (
    minimumPayroll === null ||
    minimumPayroll > Math.min(money.hardLimitDollars, money.startingWarChestDollars)
  ) {
    throw new Error('The Full Court catalog and budget cannot fill a legal six-player roster');
  }
  const initialBase = {
    schemaVersion: FULL_COURT_DRAFT_SCHEMA_VERSION,
    runId: parsed.runId,
    revision: 1,
    runSeed: parsed.runSeed,
    variant: parsed.variant,
    catalog: parsed.catalog,
    money,
    opponentVersion: FULL_COURT_OPPONENT_VERSION,
    ...(pool === undefined ? {} : { pool }),
    stage: 'drafting' as const,
    picks: [],
    spending: [],
  };
  const offer =
    options.pool === 'open'
      ? undefined
      : drawFullCourtRoundOffer({ index, state: initialBase, round: 0 });
  return fullCourtDraftStateSchema.parse({
    ...initialBase,
    ...(offer === undefined ? {} : { offer }),
  });
}

function rejectPick(
  state: FullCourtDraftState,
  command: FullCourtPickPlayerCommand,
  playerName: string,
  assessment: Extract<FullCourtPickAssessment, { legal: false }>,
): FullCourtCommandOutcome {
  switch (assessment.reason) {
    case 'phase-mismatch':
      return rejectFullCourtCommand(
        state,
        command,
        'phase-mismatch',
        'the roster is already confirmed',
      );
    case 'roster-full':
      return rejectFullCourtCommand(
        state,
        command,
        'roster-full',
        `a full court roster holds at most ${String(FULL_COURT_MAX_ROSTER_SIZE)} players`,
      );
    case 'duplicate-player':
      return rejectFullCourtCommand(
        state,
        command,
        'duplicate-player',
        `${playerName} is already on the roster`,
      );
    case 'hard-limit':
      return rejectFullCourtCommand(
        state,
        command,
        'budget-rejected',
        `signing ${playerName} would push payroll past the $${String(state.money.hardLimitDollars)} hard limit`,
      );
    case 'completion':
      return rejectFullCourtCommand(
        state,
        command,
        'budget-rejected',
        `signing ${playerName} leaves no payroll room for the cheapest legal completion`,
      );
    case 'cash':
      return rejectFullCourtCommand(
        state,
        command,
        'budget-rejected',
        assessment.warChestAfterPick < 0
          ? `the War Chest cannot afford to sign ${playerName}`
          : `signing ${playerName} leaves too little in the War Chest to complete the roster`,
      );
  }
}

function withoutOffer(state: FullCourtDraftState): Omit<FullCourtDraftState, 'offer'> {
  const copy = { ...state };
  delete copy.offer;
  return copy;
}

function applyPickPlayer(
  state: FullCourtDraftState,
  command: FullCourtPickPlayerCommand,
  environment: FullCourtCommandEnvironment,
): FullCourtCommandOutcome {
  const mismatch = validateFullCourtRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.spending.some((entry) => entry.commandId === command.commandId)) {
    return rejectFullCourtCommand(
      state,
      command,
      'command-conflict',
      `command ${command.commandId} already charged the War Chest`,
    );
  }
  const player =
    state.offer?.cards.find((card) => card.player.playerVersionId === command.playerVersionId)
      ?.player ?? fullCourtPoolPlayerOf(environment.index, state, command.playerVersionId);
  if (player === null) {
    const inCatalog = fullCourtPlayerOf(environment.index, command.playerVersionId) !== null;
    return rejectFullCourtCommand(
      state,
      command,
      'player-unavailable',
      inCatalog
        ? `player version ${command.playerVersionId} is not in this draft pool`
        : `player version ${command.playerVersionId} is not in the loaded catalog`,
    );
  }
  const salaryDollars = fullCourtSalaryDollarsOf(player);
  const assessment = fullCourtAssessPick({
    index: environment.index,
    state,
    playerId: player.playerId,
    salaryDollars,
  });
  if (!assessment.legal) return rejectPick(state, command, player.displayName, assessment);
  const picks: FullCourtDraftPick[] = [
    ...state.picks,
    { pickOrdinal: state.picks.length, player, salaryDollars },
  ];
  const spending = salariesOf(state, picks, command.commandId);
  const nextOffer =
    state.offer === undefined || picks.length >= FULL_COURT_MAX_ROSTER_SIZE
      ? undefined
      : drawFullCourtRoundOffer({
          index: environment.index,
          state: { ...state, picks, spending },
          round: picks.length,
        });
  const nextState = fullCourtDraftStateSchema.parse({
    ...withoutOffer(state),
    revision: state.revision + 1,
    picks,
    spending,
    ...(nextOffer === undefined ? {} : { offer: nextOffer }),
  });
  return acceptFullCourtCommand(state, command, nextState);
}

function applyRemovePlayer(
  state: FullCourtDraftState,
  command: FullCourtRemovePlayerCommand,
  environment: FullCourtCommandEnvironment,
): FullCourtCommandOutcome {
  const mismatch = validateFullCourtRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'drafting') {
    return rejectFullCourtCommand(
      state,
      command,
      'phase-mismatch',
      'the roster is confirmed; roster membership is fixed for the run',
    );
  }
  if (!state.picks.some((pick) => pick.player.playerVersionId === command.playerVersionId)) {
    return rejectFullCourtCommand(
      state,
      command,
      'player-not-rostered',
      `player version ${command.playerVersionId} is not on the roster`,
    );
  }
  const picks = state.picks
    .filter((pick) => pick.player.playerVersionId !== command.playerVersionId)
    .map((pick, pickOrdinal) => ({ ...pick, pickOrdinal }));
  const spending = salariesOf(state, picks, command.commandId);
  const nextOffer =
    state.offer === undefined
      ? undefined
      : drawFullCourtRoundOffer({
          index: environment.index,
          state: { ...state, picks, spending },
          round: picks.length,
        });
  const nextState = fullCourtDraftStateSchema.parse({
    ...withoutOffer(state),
    revision: state.revision + 1,
    picks,
    spending,
    ...(nextOffer === undefined ? {} : { offer: nextOffer }),
  });
  return acceptFullCourtCommand(state, command, nextState);
}

function applyFinishDraft(
  state: FullCourtDraftState,
  command: FullCourtFinishDraftCommand,
  environment: FullCourtCommandEnvironment,
): FullCourtCommandOutcome {
  const mismatch = validateFullCourtRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.stage !== 'drafting') {
    return rejectFullCourtCommand(
      state,
      command,
      'phase-mismatch',
      'the roster is already confirmed',
    );
  }
  if (state.picks.length < FULL_COURT_MIN_ROSTER_SIZE) {
    return rejectFullCourtCommand(
      state,
      command,
      'roster-too-small',
      `finishing requires at least ${String(FULL_COURT_MIN_ROSTER_SIZE)} picks (have ${String(state.picks.length)})`,
    );
  }
  const nextState = fullCourtDraftStateSchema.parse({
    ...withoutOffer(state),
    revision: state.revision + 1,
    stage: 'complete',
  });
  return acceptFullCourtCommand(state, command, nextState);
}

function applyPurchaseReport(
  state: FullCourtDraftState,
  command: FullCourtPurchaseReportCommand,
  environment: FullCourtCommandEnvironment,
): FullCourtCommandOutcome {
  const mismatch = validateFullCourtRunAndRevision(state, command, environment);
  if (mismatch !== null) return mismatch;
  if (state.spending.some((entry) => entry.commandId === command.commandId)) {
    return rejectFullCourtCommand(
      state,
      command,
      'command-conflict',
      `command ${command.commandId} already charged the War Chest`,
    );
  }
  const targetKey = fullCourtReportTargetKey(command.target);
  if (
    (state.reports ?? []).some((report) => fullCourtReportTargetKey(report.target) === targetKey)
  ) {
    return rejectFullCourtCommand(
      state,
      command,
      'report-owned',
      `this run already bought ${command.target.kind} for that target`,
    );
  }
  if ((state.reports?.length ?? 0) >= FULL_COURT_MAX_REPORTS) {
    return rejectFullCourtCommand(
      state,
      command,
      'report-unavailable',
      'this run has reached its scouting report limit',
    );
  }
  if (command.target.kind === 'player-scouting') {
    // A run-wide report has no single player to validate; legacy per-player
    // purchases still have to point at a version in this draft.
    const targetVersionId = command.target.playerVersionId;
    if (targetVersionId !== undefined) {
      const inOffer =
        state.offer?.cards.some((card) => card.player.playerVersionId === targetVersionId) === true;
      if (!inOffer && fullCourtPoolPlayerOf(environment.index, state, targetVersionId) === null) {
        const inCatalog = fullCourtPlayerOf(environment.index, targetVersionId) !== null;
        return rejectFullCourtCommand(
          state,
          command,
          'player-unavailable',
          inCatalog
            ? `player version ${targetVersionId} is not in this draft pool`
            : `player version ${targetVersionId} is not in the loaded catalog`,
        );
      }
    }
  }
  const priceDollars = fullCourtReportPriceDollars(command.target.kind);
  const assessment = fullCourtAssessPurchase({
    index: environment.index,
    state,
    priceDollars,
  });
  if (!assessment.legal) {
    return rejectFullCourtCommand(
      state,
      command,
      'budget-rejected',
      assessment.reason === 'completion'
        ? 'the catalog cannot complete a legal roster after this purchase'
        : assessment.minimumCompletionDollars === null
          ? `the War Chest cannot afford this ${command.target.kind} report`
          : `the War Chest cannot cover this report and the cheapest legal completion ($${String(
              assessment.minimumCompletionDollars,
            )} reserve)`,
    );
  }
  const reportId = reportEntryIdOf(state.runId, command.target);
  const nextState = fullCourtDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    spending: [
      ...state.spending,
      {
        entryId: reportId,
        kind: 'scouting' as const,
        dollars: priceDollars,
        commandId: command.commandId,
      },
    ],
    reports: [
      ...(state.reports ?? []),
      {
        reportId,
        kind: command.target.kind,
        target: command.target,
        priceDollars,
        commandId: command.commandId,
        purchasedRevision: state.revision + 1,
      },
    ],
  });
  return acceptFullCourtCommand(state, command, nextState);
}

/**
 * Durable facts the draft itself cannot know. `completedThroughSlot` is null
 * until the regular-season checkpoint exists, so an old save without one stays
 * purchasable.
 */
export interface FullCourtPurchasePhase {
  readonly completedThroughSlot: number | null;
  readonly postseasonStarted: boolean;
  readonly playedGameIds: ReadonlySet<string>;
}

/**
 * War Room reads are bought for the phase they cover. Training camp closes once
 * any regular-season game is committed and film closes once its fixture is
 * committed (playoff games included). A stale tab re-checks these durable facts
 * at the purchase write boundary so it cannot charge for a closed phase.
 */
export function fullCourtPurchasePhaseRejection(
  state: FullCourtDraftState,
  command: FullCourtPurchaseReportCommand,
  phase: FullCourtPurchasePhase,
): FullCourtCommandResult | null {
  const reject = (message: string): FullCourtCommandResult =>
    rejectFullCourtCommand(state, command, 'report-unavailable', message).result;
  if (command.target.kind === 'training-camp' || command.target.kind === 'lineup-fit') {
    if (phase.postseasonStarted || (phase.completedThroughSlot ?? 0) > 0) {
      return reject(
        command.target.kind === 'training-camp'
          ? 'Training camp closes before the first regular-season game.'
          : 'Roster fit closes before the first regular-season game.',
      );
    }
    return null;
  }
  if (command.target.kind === 'opponent-film') {
    if (command.target.gameId === undefined) {
      if (phase.postseasonStarted || (phase.completedThroughSlot ?? 0) > 0) {
        return reject('League opponent film closes before the first regular-season game.');
      }
      return null;
    }
    if (phase.playedGameIds.has(command.target.gameId)) {
      return reject('Film study is available for your next game.');
    }
  }
  return null;
}

export function applyFullCourtCommand(
  state: FullCourtDraftState,
  command: FullCourtCommand,
  environment: FullCourtCommandEnvironment,
): FullCourtCommandOutcome {
  if (command.command === 'create-full-court-draft') {
    return rejectFullCourtCommand(
      state,
      command,
      'phase-mismatch',
      'a full court draft already exists for this run',
    );
  }
  return applyFullCourtDraftCommand(state, command, environment);
}

export function applyFullCourtDraftCommand(
  state: FullCourtDraftState,
  command: Exclude<FullCourtCommand, FullCourtCreateDraftCommand>,
  environment: FullCourtCommandEnvironment,
): FullCourtCommandOutcome {
  switch (command.command) {
    case 'pick-full-court-player':
      return applyPickPlayer(state, command, environment);
    case 'remove-full-court-player':
      return applyRemovePlayer(state, command, environment);
    case 'finish-full-court-draft':
      return applyFinishDraft(state, command, environment);
    case 'purchase-full-court-report':
      return applyPurchaseReport(state, command, environment);
  }
}
