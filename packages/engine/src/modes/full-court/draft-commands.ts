import type {
  CommandId,
  FullCourtCommand,
  FullCourtCreateDraftCommand,
  FullCourtDraftPick,
  FullCourtDraftState,
  FullCourtFinishDraftCommand,
  FullCourtPickPlayerCommand,
  FullCourtRemovePlayerCommand,
  FullCourtSpendingEntry,
} from '@hoop-rush/data-contracts';
import {
  FULL_COURT_DEFAULT_MONEY,
  FULL_COURT_DRAFT_SCHEMA_VERSION,
  FULL_COURT_MAX_ROSTER_SIZE,
  FULL_COURT_MIN_ROSTER_SIZE,
  canonicalJson,
  fullCourtCreateDraftCommandSchema,
  fullCourtDraftStateSchema,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import { assertCapRushCatalogSourceMatches } from '../cap-rush/catalog.ts';
import { fullCourtAssessPick, type FullCourtPickAssessment } from './draft-economy.ts';
import {
  fullCourtMinimumCompletionDollars,
  fullCourtPlayerOf,
  fullCourtSalaryDollarsOf,
  type FullCourtCatalogIndex,
} from './draft-catalog.ts';
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

export function createFullCourtDraftState(
  command: FullCourtCreateDraftCommand,
  index: FullCourtCatalogIndex,
): FullCourtDraftState {
  const parsed = fullCourtCreateDraftCommandSchema.parse(command);
  assertCapRushCatalogSourceMatches(index.catalog.source, parsed.catalog);
  const money = parsed.money ?? FULL_COURT_DEFAULT_MONEY;
  const minimumPayroll = fullCourtMinimumCompletionDollars(
    index,
    new Set(),
    FULL_COURT_MIN_ROSTER_SIZE,
  );
  if (
    minimumPayroll === null ||
    minimumPayroll > Math.min(money.hardLimitDollars, money.startingWarChestDollars)
  ) {
    throw new Error('The Full Court catalog and budget cannot fill a legal six-player roster');
  }
  return fullCourtDraftStateSchema.parse({
    schemaVersion: FULL_COURT_DRAFT_SCHEMA_VERSION,
    runId: parsed.runId,
    revision: 1,
    runSeed: parsed.runSeed,
    variant: parsed.variant,
    catalog: parsed.catalog,
    money,
    stage: 'drafting',
    picks: [],
    spending: [],
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
  const player = fullCourtPlayerOf(environment.index, command.playerVersionId);
  if (player === null) {
    return rejectFullCourtCommand(
      state,
      command,
      'player-unavailable',
      `player version ${command.playerVersionId} is not in the loaded catalog`,
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
  const nextState = fullCourtDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    picks,
    spending: salariesOf(state, picks, command.commandId),
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
  const nextState = fullCourtDraftStateSchema.parse({
    ...state,
    revision: state.revision + 1,
    picks,
    spending: salariesOf(state, picks, command.commandId),
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
    ...state,
    revision: state.revision + 1,
    stage: 'complete',
  });
  return acceptFullCourtCommand(state, command, nextState);
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
  }
}
