import type {
  EraSimulationProfile,
  SeasonAcceptTradeOfferCommand,
  SeasonAcceptTradeOfferRejection,
  SeasonAcceptTradeOfferResult,
  SeasonAdvancePostseasonCommand,
  SeasonAdvancePostseasonRejection,
  SeasonAdvancePostseasonResult,
  SeasonAlreadyRehabbedRejection,
  SeasonAlreadySpentRejection,
  SeasonBlockMismatchRejection,
  SeasonDeclineTradeOfferCommand,
  SeasonDeclineTradeOfferRejection,
  SeasonDeclineTradeOfferResult,
  SeasonDraftCatalog,
  SeasonDuplicateCommandRejection,
  SeasonEffectsState,
  SeasonFastForwardPostseasonCommand,
  SeasonFastForwardPostseasonRejection,
  SeasonFastForwardPostseasonResult,
  SeasonForfeitInterruptedGameCommand,
  SeasonForfeitInterruptedGameRejection,
  SeasonForfeitInterruptedGameResult,
  SeasonGameMismatchRejection,
  SeasonInjuryNotActiveRejection,
  SeasonInsufficientBalanceRejection,
  SeasonInsufficientRehabResourcesRejection,
  SeasonInvalidRotationRejection,
  SeasonInvalidStageRejection,
  SeasonNoPendingBlockRejection,
  SeasonNotAtBoundaryRejection,
  SeasonNoWindowRejection,
  SeasonObjectiveAlreadySelectedRejection,
  SeasonObjectiveNotOfferedRejection,
  SeasonOfferNotOpenRejection,
  SeasonOfferUnknownRejection,
  SeasonPendingBlockCandidate,
  SeasonPostseasonState,
  SeasonPostseasonSummary,
  Position,
  SeasonResumeSeasonBlockCommand,
  SeasonResumeSeasonBlockRejection,
  SeasonResumeSeasonBlockResult,
  SeasonRotationDigestMismatchRejection,
  SeasonRun,
  SeasonRunCommand,
  SeasonRunCommandRejection,
  SeasonRunMismatchRejection,
  SeasonRunStage,
  SeasonSelectBlockObjectiveCommand,
  SeasonSelectBlockObjectiveRejection,
  SeasonSelectBlockObjectiveResult,
  SeasonSpectatePostseasonGameCommand,
  SeasonSpectatePostseasonGameRejection,
  SeasonSpectatePostseasonGameResult,
  SeasonSpendInfluenceCommand,
  SeasonSpendInfluenceRejection,
  SeasonSpendInfluenceResult,
  SeasonStaleStateRejection,
  SeasonStartPostseasonCommand,
  SeasonStartPostseasonRejection,
  SeasonStartPostseasonResult,
  SeasonSubmitPostseasonRotationCommand,
  SeasonSubmitPostseasonRotationRejection,
  SeasonSubmitPostseasonRotationResult,
  SeasonUnavailablePlayerRejection,
  SeasonWindowNotOpenRejection,
  SeasonWrongGameRejection,
} from '@hoop-rush/data-contracts';
import { SEASON_ROUND_COUNT, playInGameIdOf } from '@hoop-rush/data-contracts';
import { expandSeasonRunRosters } from './block.ts';
import {
  advancePendingAfterForfeit,
  seasonForfeitSummaryForGame,
  seasonFranchiseLegalFiveFacts,
} from './health.ts';
import { seasonNextBlockIndex } from './block.ts';
import {
  applyRiskyRehabOutcome,
  rollSeasonRehabOutcome,
  seasonPlayerAvailable,
} from './injuries.ts';
import { applySeasonInfluenceSpend, SEASON_INFLUENCE_FLOOR } from './influence.ts';
import { seasonObjectiveChoicesForBlock } from './objectives.ts';
import {
  POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER,
  SEASON_POSTSEASON_RISKY_REHAB_COST,
  SeasonPostseasonContextError,
  SeasonPostseasonInvariantError,
  rollPostseasonRehabOutcome,
  seasonPostseasonApplyGameResult,
  seasonPostseasonHumanEliminated,
  seasonPostseasonHumanPlaysGame,
  seasonPostseasonNextGame,
  seasonPostseasonSetRankings,
  seasonPostseasonStageOf,
  seasonPostseasonUpcomingGames,
  simulateSeasonPostseasonGame,
  type SeasonPostseasonGameResolver,
  type SeasonPostseasonRankingsFn,
  type SeasonPostseasonRankingsInput,
} from './postseason.ts';
import { rankSeasonPostseason } from './tiebreakers.ts';
import {
  legalFiveExists,
  validateSeasonRoster,
  type SeasonRosterMemberInput,
} from './roster-rules.ts';
import { validateSeasonRotation, seasonRotationSetDigest } from './rotation.ts';
import { seasonRunStateDigest } from './state-digest.ts';
import {
  applySeasonTrade,
  seasonEconomyRunOf,
  seasonTradeCatalogFactsOf,
  generatedExtraOfferForSpend,
  type SeasonEconomyRun,
} from './trades.ts';
import { seasonTransactionEntry } from './transactions.ts';

/**
 * M2.5 typed run command handlers (engine side, pure, spec/2.0/07 M2.5 §8).
 * Every handler validates, in fixed order: run identity (run-mismatch),
 * commandId uniqueness against the run's recorded history, the expected
 * state revision/digest (stale-state), and its deterministic preconditions,
 * then returns either the typed rejection or the accepted result plus the
 * mutated run/pending the persistence layer stores atomically.
 *
 * CommandId duplicate scope (documented): a commandId is a duplicate when it
 * appears in the run's recorded history — the accepted checkpoint
 * (`checkpointState.commandId`), any influence ledger entry's commandId, any
 * transaction entry's commandId, or any recorded objective selection's
 * `selectedByCommandId`. The persistence repository additionally guards
 * against races; this check covers every recorded command-scoped fact in the
 * snapshot.
 *
 * Stale-state facts: the handler compares the command's expected
 * revision/digest against the run's stored `stateRevision`/`stateDigest`.
 * The stored digest is verified by the load audit (recomputed via
 * `seasonRunStateDigest` at reload), so a fresh stored chain is equivalent
 * to a recomputed one; every accepted command recomputes the next digest
 * with `seasonRunStateDigest` over the mutated state.
 *
 * Accepted commands bump `stateRevision` by exactly one and recompute
 * `stateDigest`. `resume-season-block` performs no mutation (execution flows
 * through the block runner); rejected commands return the run/pending
 * unchanged.
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

export interface SeasonRunCommandContext {
  run: SeasonRun;
  /** Interrupted-block candidate (resume/forfeit commands only). */
  pending: SeasonPendingBlockCandidate | null;
  humanFranchiseId: string | null;
  /**
   * Packaged draft catalog (player positions + ratings). Required by the
   * trade-application and extra-offer paths (a missing catalog throws
   * `SeasonTradeFactsError` rather than recording an unvalidated trade).
   */
  catalog?: SeasonDraftCatalog;
  /**
   * The run's effects state (the persistence record keeps it beside the
   * snapshot; the state digest covers it and trade application mutates it).
   * Required for every accepted command.
   */
  effects?: SeasonEffectsState;
  /**
   * M2.6: the regular-season rankings seam for `start-postseason` (Track A's
   * tiebreaker pipeline feeds it at integration). A missing seam on the
   * start command throws `SeasonPostseasonContextError`.
   */
  rankings?: SeasonPostseasonRankingsFn;
  /**
   * M2.6: the era simulation profile for postseason games (the command layer
   * mirrors the block pipeline's profile carrier). Required by the four
   * simulating handlers; a missing profile throws `SeasonPostseasonContextError`.
   */
  profile?: EraSimulationProfile;
  /**
   * M2.6: the per-game simulation seam (documented test/CLI stub target).
   * Defaults to the real Season game controller.
   */
  postseasonGameResolver?: SeasonPostseasonGameResolver;
}

export type SeasonRunCommandResult =
  | { command: 'select-block-objective'; result: SeasonSelectBlockObjectiveResult }
  | { command: 'spend-influence'; result: SeasonSpendInfluenceResult }
  | { command: 'accept-trade-offer'; result: SeasonAcceptTradeOfferResult }
  | { command: 'decline-trade-offer'; result: SeasonDeclineTradeOfferResult }
  | { command: 'resume-season-block'; result: SeasonResumeSeasonBlockResult }
  | { command: 'forfeit-interrupted-game'; result: SeasonForfeitInterruptedGameResult }
  | { command: 'start-postseason'; result: SeasonStartPostseasonResult }
  | { command: 'advance-postseason'; result: SeasonAdvancePostseasonResult }
  | { command: 'submit-postseason-rotation'; result: SeasonSubmitPostseasonRotationResult }
  | { command: 'spectate-postseason-game'; result: SeasonSpectatePostseasonGameResult }
  | { command: 'fast-forward-postseason'; result: SeasonFastForwardPostseasonResult };

export interface SeasonRunCommandOutput {
  result: SeasonRunCommandResult;
  run: SeasonRun;
  pending: SeasonPendingBlockCandidate | null;
  /**
   * M2.6: the postseason summaries the command's accepted advance produced
   * (in play order). The run snapshot does not retain compact postseason
   * summaries (they persist as separate rows beside the run), so the engine
   * carries them on the output for the commit side.
   */
  postseasonSummaries?: SeasonPostseasonSummary[];
}

/** Marker error for unimplemented handlers (kept for compatibility). */
export class SeasonRunCommandNotImplementedError extends Error {
  readonly command: string;
  constructor(command: string) {
    super(`season run command handler not implemented yet: ${command}`);
    this.name = 'SeasonRunCommandNotImplementedError';
    this.command = command;
  }
}

/** The six command kinds this dispatch handles (submit-season-block excluded). */
type DispatchableCommandKind =
  | 'select-block-objective'
  | 'spend-influence'
  | 'accept-trade-offer'
  | 'decline-trade-offer'
  | 'resume-season-block'
  | 'forfeit-interrupted-game'
  | 'start-postseason'
  | 'advance-postseason'
  | 'submit-postseason-rotation'
  | 'spectate-postseason-game'
  | 'fast-forward-postseason';

/**
 * The engine-facing run view for this dispatch: the command layer supplies
 * the effects state (the persistence record keeps it beside the snapshot)
 * via the context, so accepted commands can recompute the state digest and
 * trade application can mutate chemistry. The mutated run returned to the
 * caller carries the effects state alongside the snapshot (extra property at
 * runtime; the persistence layer reads it with its record shape).
 */
function economyRunOf(context: SeasonRunCommandContext): SeasonEconomyRun {
  return seasonEconomyRunOf(context.run, context.effects);
}

/** The run state facts the digest covers (frozen scope, self-excluded). */
function runStateDigestFactsOf(run: SeasonEconomyRun): Parameters<typeof seasonRunStateDigest>[0] {
  return {
    stateRevision: run.stateRevision,
    stage: run.stage,
    postseason: run.postseason,
    awards: run.awards,
    completion: run.completion,
    checkpointState: run.checkpointState,
    health: run.health,
    influence: run.influence,
    transactions: run.transactions,
    trade: run.trade,
    objectives: run.objectives,
    rosters: run.rosters,
    ownership: run.ownership,
    rotations: run.rotations,
    effects: run.effects,
  };
}

/** The mutated run with stateRevision + 1 and the recomputed stateDigest. */
function advanceRunState(run: SeasonEconomyRun): SeasonRun {
  const next = { ...run, stateRevision: run.stateRevision + 1, stateDigest: '' };
  return { ...next, stateDigest: seasonRunStateDigest(runStateDigestFactsOf(next)) };
}

/**
 * True when the commandId appears anywhere in the run's recorded history:
 * the accepted checkpoint (`checkpointState.commandId`), any influence
 * ledger entry's commandId, any transaction entry's commandId, or any
 * recorded objective selection's `selectedByCommandId`. M2.6 postseason
 * commands record commandIds in the snapshot only through the influence
 * ledger (submit-with-rehab) and transactions; the authoritative accepted-
 * command log lives beside the run (command-log-v1, persistence side), so
 * the persistence repository additionally guards full duplicates. The
 * persistence repository additionally guards against races; this check
 * covers every recorded command-scoped fact in the snapshot.
 */
function commandAlreadyRecorded(run: SeasonRun, commandId: string): boolean {
  if (run.checkpointState !== null && run.checkpointState.commandId === commandId) return true;
  if (run.influence.ledger.some((entry) => entry.commandId === commandId)) return true;
  if (run.transactions.some((entry) => entry.commandId === commandId)) return true;
  for (const selection of Object.values(run.objectives.selections)) {
    if (selection.selectedByCommandId === commandId) return true;
  }
  return false;
}

/**
 * The fixed base validation (run identity, duplicate command, stale state)
 * shared by every handler. Returns the typed rejection output or null. The
 * returned output carries the context pending unchanged (resume/forfeit
 * handlers re-attach it; other handlers pass null). The three base
 * rejections belong to every command's rejection union, so the envelope is
 * narrowed per command by construction (the assertion is a narrowing cast).
 */
function baseValidation(
  command: SeasonRunCommand,
  run: SeasonRun,
  pending: SeasonPendingBlockCandidate | null,
): SeasonRunCommandOutput | null {
  const commandKind = command.command as DispatchableCommandKind;
  const rejectedWith = (rejection: SeasonRunCommandRejection): SeasonRunCommandOutput => ({
    result: {
      command: commandKind,
      result: { status: 'rejected', commandId: command.commandId, rejection },
    } as SeasonRunCommandResult,
    run,
    pending,
  });
  if (command.runId !== run.runId) {
    const rejection: SeasonRunMismatchRejection = {
      code: 'run-mismatch',
      expectedRunId: run.runId,
    };
    return rejectedWith(rejection);
  }
  if (commandAlreadyRecorded(run, command.commandId)) {
    const rejection: SeasonDuplicateCommandRejection = {
      code: 'duplicate-command',
      commandId: command.commandId,
    };
    return rejectedWith(rejection);
  }
  if (
    run.stateRevision !== command.expectedStateRevision ||
    run.stateDigest !== command.expectedStateDigest
  ) {
    const rejection: SeasonStaleStateRejection = {
      code: 'stale-state',
      expectedStateRevision: command.expectedStateRevision,
      expectedStateDigest: command.expectedStateDigest,
      currentStateRevision: run.stateRevision,
      currentStateDigest: run.stateDigest,
    };
    return rejectedWith(rejection);
  }
  return null;
}

function rejectedSelect(
  command: SeasonSelectBlockObjectiveCommand,
  rejection: SeasonSelectBlockObjectiveRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return {
    result: {
      command: 'select-block-objective',
      result: { status: 'rejected', commandId: command.commandId, rejection },
    },
    run,
    pending: null,
  };
}

function handleSelectBlockObjective(
  command: SeasonSelectBlockObjectiveCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null);
  if (base !== null) return base;
  const run = economyRunOf(context);

  const currentBlockIndex = seasonNextBlockIndex(run.cursor.completedRounds);
  if (
    currentBlockIndex === null ||
    currentBlockIndex >= 8 ||
    command.blockIndex !== currentBlockIndex
  ) {
    const rejection: SeasonNotAtBoundaryRejection = {
      code: 'not-at-boundary',
      blockIndex: command.blockIndex,
      nextUnselectedBlockIndex: currentBlockIndex ?? 7,
    };
    return rejectedSelect(command, rejection, run);
  }
  const offered = seasonObjectiveChoicesForBlock(run.rootSeed, command.blockIndex);
  if (!offered.includes(command.objectiveId)) {
    const rejection: SeasonObjectiveNotOfferedRejection = {
      code: 'objective-not-offered',
      blockIndex: command.blockIndex,
      objectiveId: command.objectiveId,
      offeredObjectiveIds: offered,
    };
    return rejectedSelect(command, rejection, run);
  }
  if (run.objectives.selections[command.blockIndex] !== undefined) {
    const rejection: SeasonObjectiveAlreadySelectedRejection = {
      code: 'objective-already-selected',
      blockIndex: command.blockIndex,
      objectiveId: command.objectiveId,
    };
    return rejectedSelect(command, rejection, run);
  }

  const next = advanceRunState({
    ...run,
    objectives: {
      ...run.objectives,
      selections: {
        ...run.objectives.selections,
        [command.blockIndex]: {
          objectiveId: command.objectiveId,
          selectedByCommandId: command.commandId,
          success: null,
        },
      },
    },
  });
  return {
    result: {
      command: 'select-block-objective',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        blockIndex: command.blockIndex,
        objectiveId: command.objectiveId,
      },
    },
    run: next,
    pending: null,
  };
}

function rejectedSpend(
  command: SeasonSpendInfluenceCommand,
  rejection: SeasonSpendInfluenceRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return {
    result: {
      command: 'spend-influence',
      result: { status: 'rejected', commandId: command.commandId, rejection },
    },
    run,
    pending: null,
  };
}

function insufficientBalanceOf(
  franchiseId: string,
  balance: number,
  requestedDelta: number,
): SeasonInsufficientBalanceRejection {
  return {
    code: 'insufficient-balance',
    franchiseId,
    balance,
    requestedDelta,
    floor: SEASON_INFLUENCE_FLOOR,
  };
}

function handleSpendInfluence(
  command: SeasonSpendInfluenceCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null);
  if (base !== null) return base;
  const run = economyRunOf(context);

  // The round-60 deadline: after the final window (windowIndex 2) closed,
  // no Influence may be spent at all.
  const finalWindow = run.trade?.windows.find((window) => window.windowIndex === 2);
  if (finalWindow !== undefined && finalWindow.status === 'closed') {
    const rejection: SeasonNoWindowRejection = {
      code: 'no-window',
      franchiseId: command.franchiseId,
    };
    return rejectedSpend(command, rejection, run);
  }

  if (command.purpose === 'extra-trade-offer') {
    const windowIndex = command.windowIndex;
    if (windowIndex === undefined) {
      throw new SeasonRunCommandNotImplementedError('spend-influence without windowIndex');
    }
    const window = run.trade?.windows.find((entry) => entry.windowIndex === windowIndex);
    if (window === undefined || window.status !== 'open') {
      const rejection: SeasonWindowNotOpenRejection = {
        code: 'window-not-open',
        franchiseId: command.franchiseId,
        windowIndex,
      };
      return rejectedSpend(command, rejection, run);
    }
    const spent = (run.influence.windows[command.franchiseId] ?? []).some(
      (entry) => entry.windowIndex === windowIndex && entry.extraOfferSpent,
    );
    if (spent) {
      const rejection: SeasonAlreadySpentRejection = {
        code: 'already-spent',
        franchiseId: command.franchiseId,
        windowIndex,
      };
      return rejectedSpend(command, rejection, run);
    }
    const balance = run.influence.balances[command.franchiseId] ?? 0;
    if (balance < -2) {
      return rejectedSpend(command, insufficientBalanceOf(command.franchiseId, balance, -1), run);
    }

    const generatedOffer = generatedExtraOfferForSpend(
      run.rootSeed,
      run,
      windowIndex,
      command.franchiseId,
      context.catalog,
    );
    const result = applySeasonInfluenceSpend({
      influence: run.influence,
      franchiseId: command.franchiseId,
      source: 'extra-trade-offer',
      requestedDelta: -1,
      blockIndex: window.blockIndex,
      commandId: command.commandId,
      explanation: `Spent 1 Influence on an extra trade offer (window ${String(windowIndex)})`,
      windowIndex,
    });
    const trade = run.trade;
    if (trade === null) {
      throw new SeasonRunCommandNotImplementedError('spend-influence without trade state');
    }
    const nextTrade = {
      ...trade,
      windows: trade.windows.map((entry) =>
        entry.windowIndex === windowIndex
          ? { ...entry, offers: [...entry.offers, generatedOffer] }
          : entry,
      ),
    };
    const transaction = seasonTransactionEntry({
      transactionId: `txn-${command.commandId}`,
      commandId: command.commandId,
      franchiseId: command.franchiseId,
      type: 'influence-spend',
      blockIndex: window.blockIndex,
      appliedAtStateRevision: run.stateRevision + 1,
      payload: {
        purpose: 'extra-trade-offer',
        windowIndex,
        generatedOfferId: generatedOffer.offerId,
      },
      explanation: `Spent 1 Influence on an extra trade offer (window ${String(windowIndex)})`,
    });
    const next = advanceRunState({
      ...run,
      influence: result.influence,
      trade: nextTrade,
      transactions: [...run.transactions, transaction],
    });
    return {
      result: {
        command: 'spend-influence',
        result: {
          status: 'accepted',
          commandId: command.commandId,
          franchiseId: command.franchiseId,
          purpose: 'extra-trade-offer',
          ledgerEntry: result.entry,
          generatedOffer,
        },
      },
      run: next,
      pending: null,
    };
  }

  const injuryId = command.injuryId;
  if (injuryId === undefined) {
    throw new SeasonRunCommandNotImplementedError('spend-influence without injuryId');
  }
  const injury = run.health.injuries.find((entry) => entry.injuryId === injuryId);
  const active =
    injury !== undefined &&
    injury.franchiseId === command.franchiseId &&
    injury.sameGameReturned !== true &&
    injury.missedGamesRemaining > 0;
  if (injury === undefined || !active) {
    const rejection: SeasonInjuryNotActiveRejection = { code: 'injury-not-active', injuryId };
    return rejectedSpend(command, rejection, run);
  }
  if (run.influence.rehabs[injuryId] !== undefined) {
    const rejection: SeasonAlreadyRehabbedRejection = { code: 'already-rehabbed', injuryId };
    return rejectedSpend(command, rejection, run);
  }
  const balance = run.influence.balances[command.franchiseId] ?? 0;
  if (balance < -1) {
    return rejectedSpend(command, insufficientBalanceOf(command.franchiseId, balance, -2), run);
  }

  const outcome = rollSeasonRehabOutcome(run.rootSeed, injuryId);
  const health = applyRiskyRehabOutcome(run.health, injuryId, outcome);
  const result = applySeasonInfluenceSpend({
    influence: run.influence,
    franchiseId: command.franchiseId,
    source: 'risky-rehab',
    requestedDelta: -2,
    blockIndex: null,
    commandId: command.commandId,
    explanation: `Spent 2 Influence on risky rehab for ${injuryId} (${outcome})`,
    injuryId,
    rehabOutcome: outcome,
  });
  const transaction = seasonTransactionEntry({
    transactionId: `txn-${command.commandId}`,
    commandId: command.commandId,
    franchiseId: command.franchiseId,
    type: 'influence-spend',
    blockIndex: null,
    appliedAtStateRevision: run.stateRevision + 1,
    payload: { purpose: 'risky-rehab', injuryId, outcome },
    explanation: `Spent 2 Influence on risky rehab for ${injuryId} (${outcome})`,
  });
  const next = advanceRunState({
    ...run,
    health,
    influence: result.influence,
    transactions: [...run.transactions, transaction],
  });
  return {
    result: {
      command: 'spend-influence',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        franchiseId: command.franchiseId,
        purpose: 'risky-rehab',
        ledgerEntry: result.entry,
        generatedOffer: null,
      },
    },
    run: next,
    pending: null,
  };
}

function rejectedAccept(
  command: SeasonAcceptTradeOfferCommand,
  rejection: SeasonAcceptTradeOfferRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return {
    result: {
      command: 'accept-trade-offer',
      result: { status: 'rejected', commandId: command.commandId, rejection },
    },
    run,
    pending: null,
  };
}

function handleAcceptTradeOffer(
  command: SeasonAcceptTradeOfferCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null);
  if (base !== null) return base;
  const run = economyRunOf(context);

  const window = run.trade?.windows.find((entry) => entry.windowIndex === command.windowIndex);
  const offer = window?.offers.find((entry) => entry.offerId === command.offerId);
  if (window === undefined || offer === undefined) {
    const rejection: SeasonOfferUnknownRejection = {
      code: 'offer-unknown',
      windowIndex: command.windowIndex,
      offerId: command.offerId,
    };
    return rejectedAccept(command, rejection, run);
  }
  if (window.status !== 'open') {
    const rejection: SeasonWindowNotOpenRejection = {
      code: 'window-not-open',
      franchiseId: null,
      windowIndex: command.windowIndex,
    };
    return rejectedAccept(command, rejection, run);
  }
  if (offer.status !== 'open') {
    const rejection: SeasonOfferNotOpenRejection = {
      code: 'offer-not-open',
      windowIndex: command.windowIndex,
      offerId: command.offerId,
    };
    return rejectedAccept(command, rejection, run);
  }

  // Ownership conflict pre-check: every moved version must sit on exactly
  // the roster the offer states (and nowhere else).
  const conflictIds: string[] = [];
  const rosterById = new Map(
    run.rosters.flatMap((roster) =>
      roster.players.map((player) => [player.playerVersionId, roster.franchiseId]),
    ),
  );
  const ownershipById = new Map(
    run.ownership.map((row) => [row.playerVersionId, row.ownerFranchiseId]),
  );
  for (const id of offer.outgoingPlayerVersionIds) {
    if (rosterById.get(id) !== offer.toFranchiseId || ownershipById.get(id) !== offer.toFranchiseId)
      conflictIds.push(id);
  }
  for (const id of offer.incomingPlayerVersionIds) {
    if (
      rosterById.get(id) !== offer.fromFranchiseId ||
      ownershipById.get(id) !== offer.fromFranchiseId
    )
      conflictIds.push(id);
  }
  if (conflictIds.length > 0) {
    const rejection: SeasonAcceptTradeOfferRejection = {
      code: 'ownership-conflict',
      windowIndex: command.windowIndex,
      offerId: command.offerId,
      playerVersionIds: conflictIds,
    };
    return rejectedAccept(command, rejection, run);
  }

  // Roster-illegal pre-check: both resulting rosters must keep the full
  // ten-player legality contract (catalog positions; absent a catalog, the
  // offer's generation-time legality proof holds because the run is
  // unchanged since the window opened — validated by stale-state).
  if (context.catalog !== undefined) {
    const facts = seasonTradeCatalogFactsOf(context.catalog);
    const rosterIdsOf = (franchiseId: string): string[] =>
      run.rosters
        .find((roster) => roster.franchiseId === franchiseId)
        ?.players.map((player) => player.playerVersionId) ?? [];
    const reasons: string[] = [];
    for (const [franchiseId, removed, added] of [
      [offer.toFranchiseId, offer.outgoingPlayerVersionIds, offer.incomingPlayerVersionIds],
      [offer.fromFranchiseId, offer.incomingPlayerVersionIds, offer.outgoingPlayerVersionIds],
    ] as const) {
      const after = [...rosterIdsOf(franchiseId).filter((id) => !removed.includes(id)), ...added];
      const members: SeasonRosterMemberInput[] = after.map((playerVersionId) => ({
        playerVersionId,
        playable: facts.playable.get(playerVersionId) ?? [],
      }));
      for (const reason of validateSeasonRoster(members)) reasons.push(`${franchiseId}: ${reason}`);
    }
    if (reasons.length > 0) {
      const rejection: SeasonAcceptTradeOfferRejection = {
        code: 'roster-illegal',
        windowIndex: command.windowIndex,
        offerId: command.offerId,
        reasons,
      };
      return rejectedAccept(command, rejection, run);
    }
  }

  const applied = applySeasonTrade(run, offer, context.catalog, { commandId: command.commandId });
  const next = advanceRunState(applied.run);
  return {
    result: {
      command: 'accept-trade-offer',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        trade: { ...offer, status: 'accepted' as const },
        rosterChanges: applied.rosterChanges,
      },
    },
    run: next,
    pending: null,
  };
}

function rejectedDecline(
  command: SeasonDeclineTradeOfferCommand,
  rejection: SeasonDeclineTradeOfferRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return {
    result: {
      command: 'decline-trade-offer',
      result: { status: 'rejected', commandId: command.commandId, rejection },
    },
    run,
    pending: null,
  };
}

function handleDeclineTradeOffer(
  command: SeasonDeclineTradeOfferCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null);
  if (base !== null) return base;
  const run = economyRunOf(context);

  const trade = run.trade;
  const window = trade?.windows.find((entry) => entry.windowIndex === command.windowIndex);
  const offer = window?.offers.find((entry) => entry.offerId === command.offerId);
  if (trade === null || window === undefined || offer === undefined) {
    const rejection: SeasonOfferUnknownRejection = {
      code: 'offer-unknown',
      windowIndex: command.windowIndex,
      offerId: command.offerId,
    };
    return rejectedDecline(command, rejection, run);
  }
  if (window.status !== 'open') {
    const rejection: SeasonWindowNotOpenRejection = {
      code: 'window-not-open',
      franchiseId: null,
      windowIndex: command.windowIndex,
    };
    return rejectedDecline(command, rejection, run);
  }
  if (offer.status !== 'open') {
    const rejection: SeasonOfferNotOpenRejection = {
      code: 'offer-not-open',
      windowIndex: command.windowIndex,
      offerId: command.offerId,
    };
    return rejectedDecline(command, rejection, run);
  }

  const next = advanceRunState({
    ...run,
    trade: {
      ...trade,
      windows: trade.windows.map((entry) =>
        entry.windowIndex === command.windowIndex
          ? {
              ...entry,
              offers: entry.offers.map((recorded) =>
                recorded.offerId === command.offerId
                  ? { ...recorded, status: 'declined' as const }
                  : recorded,
              ),
            }
          : entry,
      ),
    },
  });
  return {
    result: {
      command: 'decline-trade-offer',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        windowIndex: command.windowIndex,
        offerId: command.offerId,
      },
    },
    run: next,
    pending: null,
  };
}

function rejectedResume(
  command: SeasonResumeSeasonBlockCommand,
  rejection: SeasonResumeSeasonBlockRejection,
  run: SeasonRun,
  pending: SeasonPendingBlockCandidate | null,
): SeasonRunCommandOutput {
  return {
    result: {
      command: 'resume-season-block',
      result: { status: 'rejected', commandId: command.commandId, rejection },
    },
    run,
    pending,
  };
}

function handleResumeSeasonBlock(
  command: SeasonResumeSeasonBlockCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const { run, pending } = context;
  const base = baseValidation(command, run, pending);
  if (base !== null) return base;

  if (pending === null) {
    const rejection: SeasonNoPendingBlockRejection = {
      code: 'no-pending-block',
      blockIndex: command.blockIndex,
    };
    return rejectedResume(command, rejection, run, pending);
  }
  if (pending.blockIndex !== command.blockIndex) {
    const rejection: SeasonBlockMismatchRejection = {
      code: 'block-mismatch',
      blockIndex: command.blockIndex,
      pendingBlockIndex: pending.blockIndex,
    };
    return rejectedResume(command, rejection, run, pending);
  }
  if (pending.rotationDigest !== command.rotationDigest) {
    const rejection: SeasonRotationDigestMismatchRejection = {
      code: 'rotation-digest-mismatch',
      rotationDigest: command.rotationDigest,
      pendingRotationDigest: pending.rotationDigest,
    };
    return rejectedResume(command, rejection, run, pending);
  }

  // No run mutation: the resume executes through the block runner.
  return {
    result: {
      command: 'resume-season-block',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        blockIndex: pending.blockIndex,
        nextGameId: pending.nextGameId,
      },
    },
    run,
    pending,
  };
}

function rejectedForfeit(
  command: SeasonForfeitInterruptedGameCommand,
  rejection: SeasonForfeitInterruptedGameRejection,
  run: SeasonRun,
  pending: SeasonPendingBlockCandidate | null,
): SeasonRunCommandOutput {
  return {
    result: {
      command: 'forfeit-interrupted-game',
      result: { status: 'rejected', commandId: command.commandId, rejection },
    },
    run,
    pending,
  };
}

function handleForfeitInterruptedGame(
  command: SeasonForfeitInterruptedGameCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const { run, pending, humanFranchiseId } = context;
  const base = baseValidation(command, run, pending);
  if (base !== null) return base;
  const economyRun = economyRunOf(context);

  if (pending === null) {
    const rejection: SeasonNoPendingBlockRejection = {
      code: 'no-pending-block',
      blockIndex: command.blockIndex,
    };
    return rejectedForfeit(command, rejection, run, pending);
  }
  if (pending.blockIndex !== command.blockIndex) {
    const rejection: SeasonBlockMismatchRejection = {
      code: 'block-mismatch',
      blockIndex: command.blockIndex,
      pendingBlockIndex: pending.blockIndex,
    };
    return rejectedForfeit(command, rejection, run, pending);
  }
  if (pending.nextGameId !== command.nextGameId) {
    const rejection: SeasonGameMismatchRejection = {
      code: 'game-mismatch',
      nextGameId: command.nextGameId,
      pendingNextGameId: pending.nextGameId,
    };
    return rejectedForfeit(command, rejection, run, pending);
  }
  if (humanFranchiseId === null) {
    throw new SeasonRunCommandNotImplementedError(
      'forfeit-interrupted-game requires a human franchise (the pending block only exists for human runs)',
    );
  }

  const forfeitedGameId = command.nextGameId;
  const summary = seasonForfeitSummaryForGame(run, forfeitedGameId, humanFranchiseId);
  const nextPending = advancePendingAfterForfeit(
    { ...pending, summaries: [...pending.summaries, summary] },
    forfeitedGameId,
  );
  const next = advanceRunState(economyRun);
  return {
    result: {
      command: 'forfeit-interrupted-game',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        blockIndex: nextPending.blockIndex,
        forfeitedGameId,
        nextGameId: nextPending.nextGameId,
      },
    },
    run: next,
    pending: nextPending,
  };
}

/** The stage the postseason command handlers require to run. */
const REQUIRED_POSTSEASON_STAGE: SeasonRunStage = 'play-in';

function postseasonInvalidStageRejection(run: SeasonRun): SeasonInvalidStageRejection {
  return {
    code: 'invalid-stage',
    requiredStage: REQUIRED_POSTSEASON_STAGE,
    currentStage: run.stage,
  };
}

function rejectedStart(
  command: SeasonStartPostseasonCommand,
  rejection: SeasonStartPostseasonRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return {
    result: {
      command: 'start-postseason',
      result: { status: 'rejected', commandId: command.commandId, rejection },
    },
    run,
    pending: null,
  };
}

/**
 * M2.6 `start-postseason` (spec/2.0/02 playoffs): moves a completed regular
 * season into the `play-in` stage by recording the rankings seam output
 * (Track A's tiebreaker pipeline supplies the ordered top ten; the machine
 * records no tiebreak resolutions itself). Requires the `regular-season`
 * stage with all 82 rounds accepted.
 */
function handleStartPostseason(
  command: SeasonStartPostseasonCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (run.stage !== 'regular-season' || run.cursor.completedRounds < SEASON_ROUND_COUNT) {
    const rejection: SeasonInvalidStageRejection = {
      code: 'invalid-stage',
      requiredStage: 'regular-season',
      currentStage: run.stage,
    };
    return rejectedStart(command, rejection, run);
  }
  let postseason: SeasonPostseasonState;
  try {
    const rankings =
      context.rankings ??
      ((input: SeasonPostseasonRankingsInput) => {
        const ranked = rankSeasonPostseason(input.league, input.standings, input.seed);
        return { east: ranked.east.topTen, west: ranked.west.topTen };
      });
    const rankingResult = rankings({
      league: run.league,
      standings: run.standings,
      seed: run.rootSeed,
    });
    postseason = seasonPostseasonSetRankings(run.postseason, run.league, rankingResult);
  } catch (error) {
    if (error instanceof SeasonPostseasonInvariantError) {
      return rejectedStart(command, { code: 'integrity-failure', reason: error.message }, run);
    }
    throw error;
  }
  const next = advanceRunState({ ...run, stage: 'play-in', postseason });
  return {
    result: {
      command: 'start-postseason',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        stage: 'play-in',
        postseasonSeed: postseason.seed,
        nextGameId: playInGameIdOf('east', 'seven-eight'),
      },
    },
    run: next,
    pending: null,
  };
}

function rejectedAdvance(
  command: SeasonAdvancePostseasonCommand,
  rejection: SeasonAdvancePostseasonRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return {
    result: {
      command: 'advance-postseason',
      result: { status: 'rejected', commandId: command.commandId, rejection },
    },
    run,
    pending: null,
  };
}

/**
 * M2.6 `advance-postseason`: simulates the next playable game (or the
 * optional target) and continues through AI-only games until a human
 * rotation is required (every human game waits for a fresh submission), the
 * tournament ends with a champion, or the target game is reached. A target
 * that cannot materialize (a game beyond a series' clinch point) runs the
 * advance to its natural end. Accepted results carry the advanced game ids,
 * the next decision, and the summaries for the commit side.
 */
function handleAdvancePostseason(
  command: SeasonAdvancePostseasonCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (run.stage === 'regular-season' || run.stage === 'completed') {
    return rejectedAdvance(command, postseasonInvalidStageRejection(run), run);
  }
  if (context.catalog === undefined || context.profile === undefined) {
    throw new SeasonPostseasonContextError(
      'advance-postseason requires the draft catalog and era profile (context.catalog, context.profile)',
    );
  }
  const expanded = expandSeasonRunRosters(run, context.catalog);
  const positions = new Map<string, readonly Position[]>();
  for (const player of expanded.values()) {
    positions.set(player.playerVersionId, player.positions);
  }
  const target = command.targetGameId;
  if (target !== undefined) {
    const upcoming = seasonPostseasonUpcomingGames(run.postseason);
    if (!upcoming.includes(target)) {
      const next = seasonPostseasonNextGame(run.postseason);
      if (next.kind === 'integrity-failure') {
        return rejectedAdvance(command, { code: 'integrity-failure', reason: next.reason }, run);
      }
      if (next.kind === 'complete') {
        return rejectedAdvance(
          command,
          { code: 'integrity-failure', reason: 'the postseason is complete' },
          run,
        );
      }
      return rejectedAdvance(
        command,
        { code: 'wrong-game', targetGameId: target, nextGameId: next.gameId },
        run,
      );
    }
  }
  const humanFranchiseId = context.humanFranchiseId;
  let current = run;
  const advanced: string[] = [];
  const summaries: SeasonPostseasonSummary[] = [];
  let humanWait: string | null = null;
  let integrityReason: string | null = null;
  for (;;) {
    const decision = seasonPostseasonNextGame(current.postseason);
    if (decision.kind === 'integrity-failure') {
      integrityReason = decision.reason;
      break;
    }
    if (decision.kind === 'complete') break;
    const gameId = decision.gameId;
    if (
      humanFranchiseId !== null &&
      seasonPostseasonHumanPlaysGame(current.postseason, gameId, humanFranchiseId)
    ) {
      // The human rotation decision (documented): the human's saved rotation
      // carries over between games; the advance stops at a human game only
      // when the rotation cannot play — no legal five from the available
      // players, or planned minutes on an unavailable player. The human then
      // repairs (submit a rotation resting the injured player at zero
      // minutes), rehabilitates (postseason risky rehab), or — once a
      // forfeit command exists — forfeits.
      const humanRotation = current.rotations.find(
        (rotation) => rotation.franchiseId === humanFranchiseId,
      );
      const minutesOnUnavailable = (humanRotation?.targetMinutes ?? []).some(
        (entry) =>
          entry.minutes > 0 && !seasonPlayerAvailable(current.health, entry.playerVersionId),
      );
      const legalFacts = seasonFranchiseLegalFiveFacts(
        current,
        humanFranchiseId,
        current.health,
        positions,
      );
      if (minutesOnUnavailable || !legalFacts.legal) {
        humanWait = gameId;
        break;
      }
    }
    const outcome = simulateSeasonPostseasonGame(
      {
        run: current,
        effects: current.effects,
        expanded,
        catalog: context.catalog,
        profile: context.profile,
        gameId,
        humanFranchiseId,
      },
      { resolver: context.postseasonGameResolver },
    );
    if (outcome.kind === 'integrity-failure') {
      integrityReason = outcome.reason;
      break;
    }
    current = {
      ...current,
      postseason: seasonPostseasonApplyGameResult(
        current.postseason,
        outcome.facts,
        current.league,
        current.standings,
      ),
      health: outcome.nextHealth,
      effects: outcome.nextEffects,
    };
    advanced.push(gameId);
    summaries.push(outcome.summary);
    if (target !== undefined && gameId === target) break;
  }
  if (integrityReason !== null) {
    return rejectedAdvance(command, { code: 'integrity-failure', reason: integrityReason }, run);
  }
  const stage = seasonPostseasonStageOf(current.postseason);
  const completion =
    stage === 'completed'
      ? {
          championFranchiseId: current.postseason.championFranchiseId as string,
          // LEAD DECISION (documented): the promotion replaces the zero
          // digest when the almanac persists; the run schema only requires
          // the 32-hex shape here.
          almanacDigest: POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER,
          finalizedAtStateRevision: run.stateRevision + 1,
        }
      : null;
  const nextRun = advanceRunState({ ...current, stage, completion });
  const after = seasonPostseasonNextGame(nextRun.postseason);
  const nextGameIdAfter = after.kind === 'game' ? after.gameId : null;
  const humanNext =
    nextGameIdAfter !== null &&
    humanFranchiseId !== null &&
    seasonPostseasonHumanPlaysGame(nextRun.postseason, nextGameIdAfter, humanFranchiseId);
  const nextDecision = humanWait !== null || humanNext ? 'rotation' : 'none';
  return {
    result: {
      command: 'advance-postseason',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        stage,
        advancedGameIds: advanced,
        nextDecision,
        nextGameId: humanWait ?? (humanNext ? nextGameIdAfter : null),
        aiNextGameId: nextDecision === 'rotation' ? null : nextGameIdAfter,
      },
    },
    run: nextRun,
    pending: null,
    postseasonSummaries: summaries,
  };
}

function rejectedSubmit(
  command: SeasonSubmitPostseasonRotationCommand,
  rejection: SeasonSubmitPostseasonRotationRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return {
    result: {
      command: 'submit-postseason-rotation',
      result: { status: 'rejected', commandId: command.commandId, rejection },
    },
    run,
    pending: null,
  };
}

/**
 * M2.6 `submit-postseason-rotation`: locks the human rotation for the target
 * game (which must be the run's current next game and involve the human),
 * validates rotation legality, availability, and the optional risky-rehab
 * spend (the only postseason Influence use; the seeded outcome applies
 * `applyRiskyRehabOutcome` semantics and is recorded on the ledger and
 * transaction log). The recorded rotation replaces the human's saved
 * rotation, so it persists between games until the next submission.
 */
function handleSubmitPostseasonRotation(
  command: SeasonSubmitPostseasonRotationCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (run.stage === 'regular-season' || run.stage === 'completed') {
    return rejectedSubmit(command, postseasonInvalidStageRejection(run), run);
  }
  const next = seasonPostseasonNextGame(run.postseason);
  if (next.kind === 'integrity-failure') {
    return rejectedSubmit(command, { code: 'integrity-failure', reason: next.reason }, run);
  }
  if (next.kind === 'complete') {
    return rejectedSubmit(
      command,
      { code: 'integrity-failure', reason: 'the postseason is complete' },
      run,
    );
  }
  if (command.targetGameId !== next.gameId) {
    const rejection: SeasonWrongGameRejection = {
      code: 'wrong-game',
      targetGameId: command.targetGameId,
      nextGameId: next.gameId,
    };
    return rejectedSubmit(command, rejection, run);
  }
  const humanFranchiseId = context.humanFranchiseId;
  if (humanFranchiseId === null) {
    throw new SeasonRunCommandNotImplementedError(
      'submit-postseason-rotation requires a human franchise (the command layer supplies it)',
    );
  }
  if (!seasonPostseasonHumanPlaysGame(run.postseason, command.targetGameId, humanFranchiseId)) {
    const rejection: SeasonWrongGameRejection = {
      code: 'wrong-game',
      targetGameId: command.targetGameId,
      nextGameId: next.gameId,
    };
    return rejectedSubmit(command, rejection, run);
  }
  const payload = command.rotation;
  if (payload.franchiseId !== humanFranchiseId) {
    const rejection: SeasonInvalidRotationRejection = {
      code: 'invalid-rotation',
      franchiseId: payload.franchiseId,
      reasons: [
        `rotation targets ${payload.franchiseId} but the human franchise is ${humanFranchiseId}`,
      ],
    };
    return rejectedSubmit(command, rejection, run);
  }
  if (context.catalog === undefined) {
    throw new SeasonPostseasonContextError(
      'submit-postseason-rotation requires the draft catalog (context.catalog)',
    );
  }
  const humanRoster = run.rosters.find((roster) => roster.franchiseId === humanFranchiseId);
  const memberPlayable = new Map<string, readonly Position[]>();
  for (const player of humanRoster?.players ?? []) {
    const candidate = context.catalog.candidates.find(
      (entry) => entry.playerVersionId === player.playerVersionId,
    );
    memberPlayable.set(player.playerVersionId, candidate?.positions.playable ?? []);
  }
  const rotationFailures = validateSeasonRotation(payload.rotation, memberPlayable);
  if (rotationFailures.length > 0) {
    return rejectedSubmit(
      command,
      { code: 'invalid-rotation', franchiseId: payload.franchiseId, reasons: rotationFailures },
      run,
    );
  }
  const rostered = new Set((humanRoster?.players ?? []).map((player) => player.playerVersionId));
  for (const playerVersionId of [
    ...payload.rotation.starters,
    ...payload.rotation.benchOrder,
    ...payload.rotation.closingFive,
  ]) {
    if (!rostered.has(playerVersionId)) {
      const rejection: SeasonUnavailablePlayerRejection = {
        code: 'unavailable-player',
        playerVersionId,
        reason: 'not-on-roster',
      };
      return rejectedSubmit(command, rejection, run);
    }
  }
  // Availability contract (documented): a rotation may list an injured player
  // only at zero minutes (rest); a player with planned minutes must be able
  // to play, and the rotation must be able to field a legal five from the
  // available players — otherwise the human must repair, rehabilitate, or
  // (future command) forfeit.
  for (const entry of payload.rotation.targetMinutes) {
    if (entry.minutes > 0 && !seasonPlayerAvailable(run.health, entry.playerVersionId)) {
      const rejection: SeasonUnavailablePlayerRejection = {
        code: 'unavailable-player',
        playerVersionId: entry.playerVersionId,
        reason: 'injured',
      };
      return rejectedSubmit(command, rejection, run);
    }
  }
  {
    const availableMembers: SeasonRosterMemberInput[] = [];
    for (const player of humanRoster?.players ?? []) {
      const playable = memberPlayable.get(player.playerVersionId);
      if (playable === undefined || playable.length === 0) continue;
      if (seasonPlayerAvailable(run.health, player.playerVersionId)) {
        availableMembers.push({ playerVersionId: player.playerVersionId, playable });
      }
    }
    if (!legalFiveExists(availableMembers)) {
      return rejectedSubmit(
        command,
        {
          code: 'invalid-rotation',
          franchiseId: payload.franchiseId,
          reasons: [
            `only ${String(availableMembers.length)} players available; the rotation cannot field a legal five`,
          ],
        },
        run,
      );
    }
  }
  let health = run.health;
  let influence = run.influence;
  let transactions = run.transactions;
  const rehabInjuryId = payload.riskyRehabInjuryId;
  if (rehabInjuryId !== undefined) {
    const injury = run.health.injuries.find((entry) => entry.injuryId === rehabInjuryId);
    // Rejection mapping (documented, flagged for the lead): the M2.6 submit
    // union has no injury-not-active / already-rehabbed codes, so an invalid
    // rehab reference rejects with integrity-failure and a precise reason.
    const active =
      injury !== undefined &&
      injury.franchiseId === humanFranchiseId &&
      injury.sameGameReturned !== true &&
      injury.missedGamesRemaining > 0;
    if (injury === undefined || !active) {
      return rejectedSubmit(
        command,
        {
          code: 'integrity-failure',
          reason: `risky-rehab injury ${rehabInjuryId} is not an active injury of ${humanFranchiseId}`,
        },
        run,
      );
    }
    if (run.influence.rehabs[rehabInjuryId] !== undefined) {
      return rejectedSubmit(
        command,
        { code: 'integrity-failure', reason: `injury ${rehabInjuryId} was already rehabilitated` },
        run,
      );
    }
    const balance = run.influence.balances[humanFranchiseId] ?? 0;
    if (balance < SEASON_INFLUENCE_FLOOR + SEASON_POSTSEASON_RISKY_REHAB_COST) {
      const rejection: SeasonInsufficientRehabResourcesRejection = {
        code: 'insufficient-rehab-resources',
        franchiseId: humanFranchiseId,
        balance,
        required: SEASON_POSTSEASON_RISKY_REHAB_COST,
      };
      return rejectedSubmit(command, rejection, run);
    }
    const outcome = rollPostseasonRehabOutcome(run.rootSeed, rehabInjuryId);
    health = applyRiskyRehabOutcome(health, rehabInjuryId, outcome);
    const spend = applySeasonInfluenceSpend({
      influence,
      franchiseId: humanFranchiseId,
      source: 'risky-rehab',
      requestedDelta: -SEASON_POSTSEASON_RISKY_REHAB_COST,
      blockIndex: null,
      commandId: command.commandId,
      explanation: `Spent ${String(SEASON_POSTSEASON_RISKY_REHAB_COST)} Influence on postseason risky rehab for ${rehabInjuryId} (${outcome})`,
      injuryId: rehabInjuryId,
      rehabOutcome: outcome,
    });
    influence = spend.influence;
    transactions = [
      ...transactions,
      seasonTransactionEntry({
        transactionId: `txn-${command.commandId}`,
        commandId: command.commandId,
        franchiseId: humanFranchiseId,
        type: 'influence-spend',
        blockIndex: null,
        appliedAtStateRevision: run.stateRevision + 1,
        payload: { purpose: 'risky-rehab', injuryId: rehabInjuryId, outcome },
        explanation: `Spent ${String(SEASON_POSTSEASON_RISKY_REHAB_COST)} Influence on postseason risky rehab for ${rehabInjuryId} (${outcome})`,
      }),
    ];
  }
  const rotations = run.rotations.map((rotation) =>
    rotation.franchiseId === humanFranchiseId ? payload.rotation : rotation,
  );
  const nextRun = advanceRunState({ ...run, rotations, health, influence, transactions });
  return {
    result: {
      command: 'submit-postseason-rotation',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        targetGameId: command.targetGameId,
        franchiseId: payload.franchiseId,
        rotationDigest: seasonRotationSetDigest([payload.rotation]),
      },
    },
    run: nextRun,
    pending: null,
  };
}

function rejectedSpectate(
  command: SeasonSpectatePostseasonGameCommand,
  rejection: SeasonSpectatePostseasonGameRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return {
    result: {
      command: 'spectate-postseason-game',
      result: { status: 'rejected', commandId: command.commandId, rejection },
    },
    run,
    pending: null,
  };
}

/**
 * M2.6 `spectate-postseason-game`: simulates exactly the named game with the
 * fixed AI rotations. The target must be the run's current next game and
 * must not involve the human franchise (the human plays their own games
 * through advance + submit); the primary use case is spectating after
 * elimination. Accepted results reuse the advance result shape.
 */
function handleSpectatePostseasonGame(
  command: SeasonSpectatePostseasonGameCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (run.stage === 'regular-season' || run.stage === 'completed') {
    return rejectedSpectate(command, postseasonInvalidStageRejection(run), run);
  }
  if (context.catalog === undefined || context.profile === undefined) {
    throw new SeasonPostseasonContextError(
      'spectate-postseason-game requires the draft catalog and era profile (context.catalog, context.profile)',
    );
  }
  const decision = seasonPostseasonNextGame(run.postseason);
  if (decision.kind === 'integrity-failure') {
    return rejectedSpectate(command, { code: 'integrity-failure', reason: decision.reason }, run);
  }
  if (decision.kind === 'complete') {
    return rejectedSpectate(
      command,
      { code: 'integrity-failure', reason: 'the postseason is complete' },
      run,
    );
  }
  if (command.targetGameId !== decision.gameId) {
    const rejection: SeasonWrongGameRejection = {
      code: 'wrong-game',
      targetGameId: command.targetGameId,
      nextGameId: decision.gameId,
    };
    return rejectedSpectate(command, rejection, run);
  }
  const humanFranchiseId = context.humanFranchiseId;
  if (
    humanFranchiseId !== null &&
    seasonPostseasonHumanPlaysGame(run.postseason, command.targetGameId, humanFranchiseId)
  ) {
    const rejection: SeasonWrongGameRejection = {
      code: 'wrong-game',
      targetGameId: command.targetGameId,
      nextGameId: decision.gameId,
    };
    return rejectedSpectate(command, rejection, run);
  }
  const expanded = expandSeasonRunRosters(run, context.catalog);
  const outcome = simulateSeasonPostseasonGame(
    {
      run,
      effects: run.effects,
      expanded,
      catalog: context.catalog,
      profile: context.profile,
      gameId: command.targetGameId,
      humanFranchiseId,
    },
    { resolver: context.postseasonGameResolver },
  );
  if (outcome.kind === 'integrity-failure') {
    return rejectedSpectate(command, { code: 'integrity-failure', reason: outcome.reason }, run);
  }
  const current = {
    ...run,
    postseason: seasonPostseasonApplyGameResult(
      run.postseason,
      outcome.facts,
      run.league,
      run.standings,
    ),
    health: outcome.nextHealth,
    effects: outcome.nextEffects,
  };
  const stage = seasonPostseasonStageOf(current.postseason);
  const completion =
    stage === 'completed'
      ? {
          championFranchiseId: current.postseason.championFranchiseId as string,
          almanacDigest: POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER,
          finalizedAtStateRevision: run.stateRevision + 1,
        }
      : null;
  const nextRun = advanceRunState({ ...current, stage, completion });
  const after = seasonPostseasonNextGame(nextRun.postseason);
  const nextGameIdAfter = after.kind === 'game' ? after.gameId : null;
  const humanNext =
    nextGameIdAfter !== null &&
    humanFranchiseId !== null &&
    seasonPostseasonHumanPlaysGame(nextRun.postseason, nextGameIdAfter, humanFranchiseId);
  return {
    result: {
      command: 'spectate-postseason-game',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        stage,
        advancedGameIds: [command.targetGameId],
        nextDecision: humanNext ? 'rotation' : 'none',
        nextGameId: humanNext ? nextGameIdAfter : null,
        aiNextGameId: humanNext ? null : nextGameIdAfter,
      },
    },
    run: nextRun,
    pending: null,
    postseasonSummaries: [outcome.summary],
  };
}

function rejectedFastForward(
  command: SeasonFastForwardPostseasonCommand,
  rejection: SeasonFastForwardPostseasonRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return {
    result: {
      command: 'fast-forward-postseason',
      result: { status: 'rejected', commandId: command.commandId, rejection },
    },
    run,
    pending: null,
  };
}

/**
 * M2.6 `fast-forward-postseason`: simulates every remaining game with the
 * fixed AI rotations through the champion and completes the run. Requires
 * the human franchise to be eliminated (an active human would be skipping
 * lineup decisions; the union has no better code, so the rejection is
 * integrity-failure — flagged for the lead). The optional target is
 * validated as an upcoming game; the accepted result is always stage
 * `completed` with the champion.
 */
function handleFastForwardPostseason(
  command: SeasonFastForwardPostseasonCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (run.stage === 'regular-season' || run.stage === 'completed') {
    return rejectedFastForward(command, postseasonInvalidStageRejection(run), run);
  }
  if (command.targetGameId !== undefined) {
    const upcoming = seasonPostseasonUpcomingGames(run.postseason);
    if (!upcoming.includes(command.targetGameId)) {
      return rejectedFastForward(
        command,
        {
          code: 'integrity-failure',
          reason: `fast-forward target ${command.targetGameId} is not an upcoming postseason game`,
        },
        run,
      );
    }
  }
  const humanFranchiseId = context.humanFranchiseId;
  if (
    humanFranchiseId !== null &&
    !seasonPostseasonHumanEliminated(run.postseason, humanFranchiseId)
  ) {
    return rejectedFastForward(
      command,
      {
        code: 'integrity-failure',
        reason: `the human franchise ${humanFranchiseId} still has postseason decisions; fast-forward requires elimination`,
      },
      run,
    );
  }
  if (context.catalog === undefined || context.profile === undefined) {
    throw new SeasonPostseasonContextError(
      'fast-forward-postseason requires the draft catalog and era profile (context.catalog, context.profile)',
    );
  }
  const expanded = expandSeasonRunRosters(run, context.catalog);
  let current = run;
  const summaries: SeasonPostseasonSummary[] = [];
  let integrityReason: string | null = null;
  for (;;) {
    const decision = seasonPostseasonNextGame(current.postseason);
    if (decision.kind === 'integrity-failure') {
      integrityReason = decision.reason;
      break;
    }
    if (decision.kind === 'complete') break;
    const outcome = simulateSeasonPostseasonGame(
      {
        run: current,
        effects: current.effects,
        expanded,
        catalog: context.catalog,
        profile: context.profile,
        gameId: decision.gameId,
        humanFranchiseId,
      },
      { resolver: context.postseasonGameResolver },
    );
    if (outcome.kind === 'integrity-failure') {
      integrityReason = outcome.reason;
      break;
    }
    current = {
      ...current,
      postseason: seasonPostseasonApplyGameResult(
        current.postseason,
        outcome.facts,
        current.league,
        current.standings,
      ),
      health: outcome.nextHealth,
      effects: outcome.nextEffects,
    };
    summaries.push(outcome.summary);
  }
  if (integrityReason !== null) {
    return rejectedFastForward(
      command,
      { code: 'integrity-failure', reason: integrityReason },
      run,
    );
  }
  const championFranchiseId = current.postseason.championFranchiseId;
  if (championFranchiseId === null) {
    return rejectedFastForward(
      command,
      { code: 'integrity-failure', reason: 'the tournament finished without a champion' },
      run,
    );
  }
  const completion = {
    championFranchiseId,
    almanacDigest: POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER,
    finalizedAtStateRevision: run.stateRevision + 1,
  };
  const nextRun = advanceRunState({ ...current, stage: 'completed', completion });
  return {
    result: {
      command: 'fast-forward-postseason',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        stage: 'completed',
        championFranchiseId,
      },
    },
    run: nextRun,
    pending: null,
    postseasonSummaries: summaries,
  };
}

/**
 * The typed run command dispatch (spec/2.0/07 M2.5 §8): validates run
 * identity, commandId uniqueness, and the expected state revision/digest,
 * then dispatches to the per-command handler. Returns the typed result plus
 * the mutated run/pending to persist atomically.
 */
export function handleSeasonRunCommand(
  command: SeasonRunCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  switch (command.command) {
    case 'select-block-objective':
      return handleSelectBlockObjective(command, context);
    case 'spend-influence':
      return handleSpendInfluence(command, context);
    case 'accept-trade-offer':
      return handleAcceptTradeOffer(command, context);
    case 'decline-trade-offer':
      return handleDeclineTradeOffer(command, context);
    case 'resume-season-block':
      return handleResumeSeasonBlock(command, context);
    case 'forfeit-interrupted-game':
      return handleForfeitInterruptedGame(command, context);
    case 'start-postseason':
      return handleStartPostseason(command, context);
    case 'advance-postseason':
      return handleAdvancePostseason(command, context);
    case 'submit-postseason-rotation':
      return handleSubmitPostseasonRotation(command, context);
    case 'spectate-postseason-game':
      return handleSpectatePostseasonGame(command, context);
    case 'fast-forward-postseason':
      return handleFastForwardPostseason(command, context);
    case 'submit-season-block':
      throw new SeasonRunCommandNotImplementedError(
        'submit-season-block is handled by the block pipeline, not the run command dispatch',
      );
  }
}
