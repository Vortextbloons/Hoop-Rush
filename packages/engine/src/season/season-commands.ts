import type {
  SeasonAcceptTradeOfferCommand,
  SeasonAcceptTradeOfferRejection,
  SeasonAcceptTradeOfferResult,
  SeasonAlreadyRehabbedRejection,
  SeasonAlreadySpentRejection,
  SeasonBlockMismatchRejection,
  SeasonDeclineTradeOfferCommand,
  SeasonDeclineTradeOfferRejection,
  SeasonDeclineTradeOfferResult,
  SeasonDraftCatalog,
  SeasonDuplicateCommandRejection,
  SeasonEffectsState,
  SeasonForfeitInterruptedGameCommand,
  SeasonForfeitInterruptedGameRejection,
  SeasonForfeitInterruptedGameResult,
  SeasonGameMismatchRejection,
  SeasonInjuryNotActiveRejection,
  SeasonInsufficientBalanceRejection,
  SeasonNoPendingBlockRejection,
  SeasonNotAtBoundaryRejection,
  SeasonNoWindowRejection,
  SeasonObjectiveAlreadySelectedRejection,
  SeasonObjectiveNotOfferedRejection,
  SeasonOfferNotOpenRejection,
  SeasonOfferUnknownRejection,
  SeasonPendingBlockCandidate,
  SeasonResumeSeasonBlockCommand,
  SeasonResumeSeasonBlockRejection,
  SeasonResumeSeasonBlockResult,
  SeasonRotationDigestMismatchRejection,
  SeasonRun,
  SeasonRunCommand,
  SeasonRunCommandRejection,
  SeasonRunMismatchRejection,
  SeasonSelectBlockObjectiveCommand,
  SeasonSelectBlockObjectiveRejection,
  SeasonSelectBlockObjectiveResult,
  SeasonSpendInfluenceCommand,
  SeasonSpendInfluenceRejection,
  SeasonSpendInfluenceResult,
  SeasonStaleStateRejection,
  SeasonWindowNotOpenRejection,
} from '@hoop-rush/data-contracts';
import { advancePendingAfterForfeit, seasonForfeitSummaryForGame } from './health.ts';
import { seasonNextBlockIndex } from './block.ts';
import { applyRiskyRehabOutcome, rollSeasonRehabOutcome } from './injuries.ts';
import { applySeasonInfluenceSpend, SEASON_INFLUENCE_FLOOR } from './influence.ts';
import { seasonObjectiveChoicesForBlock } from './objectives.ts';
import { validateSeasonRoster, type SeasonRosterMemberInput } from './roster-rules.ts';
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
}

export type SeasonRunCommandResult =
  | { command: 'select-block-objective'; result: SeasonSelectBlockObjectiveResult }
  | { command: 'spend-influence'; result: SeasonSpendInfluenceResult }
  | { command: 'accept-trade-offer'; result: SeasonAcceptTradeOfferResult }
  | { command: 'decline-trade-offer'; result: SeasonDeclineTradeOfferResult }
  | { command: 'resume-season-block'; result: SeasonResumeSeasonBlockResult }
  | { command: 'forfeit-interrupted-game'; result: SeasonForfeitInterruptedGameResult };

export interface SeasonRunCommandOutput {
  result: SeasonRunCommandResult;
  run: SeasonRun;
  pending: SeasonPendingBlockCandidate | null;
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
  | 'forfeit-interrupted-game';

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
 * recorded objective selection's `selectedByCommandId`. The persistence
 * repository additionally guards against races; this check covers every
 * recorded command-scoped fact in the snapshot.
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
    case 'submit-season-block':
      throw new SeasonRunCommandNotImplementedError(
        'submit-season-block is handled by the block pipeline, not the run command dispatch',
      );
  }
}
