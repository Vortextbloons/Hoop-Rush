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
  SeasonGameSummary,
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
  SeasonDeclareFreeAgentInterestCommand,
  SeasonDeclareFreeAgentInterestResult,
  SeasonSkipFreeAgentMarketCommand,
  SeasonSkipFreeAgentMarketResult,
  SeasonResolveFreeAgentMarketCommand,
  SeasonResolveFreeAgentMarketResult,
  SeasonFreeAgencyIndex,
  SeasonRosterTargets,
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
import { deriveSeasonAwards } from './awards.ts';
import { seasonRunStateDigest } from './state-digest.ts';
import {
  applySeasonTrade,
  seasonEconomyRunOf,
  seasonTradeCatalogFactsOf,
  generatedExtraOfferForSpend,
  type SeasonEconomyRun,
} from './trades.ts';
import {
  FreeAgencyValidationRejection,
  applyFreeAgencyDeclaration,
  applyFreeAgencySkip,
  resolveSeasonFreeAgencyWindow,
} from './free-agency.ts';
import { seasonTransactionEntry } from './transactions.ts';

export interface SeasonRunCommandContext {
  run: SeasonRun;

  pending: SeasonPendingBlockCandidate | null;
  humanFranchiseId: string | null;

  catalog?: SeasonDraftCatalog;

  effects?: SeasonEffectsState;

  rankings?: SeasonPostseasonRankingsFn;

  profile?: EraSimulationProfile;

  postseasonGameResolver?: SeasonPostseasonGameResolver;

  regularSeasonSummaries?: readonly SeasonGameSummary[];

  freeAgencyIndex?: SeasonFreeAgencyIndex;

  freeAgencyTargets?: SeasonRosterTargets;
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
  | { command: 'fast-forward-postseason'; result: SeasonFastForwardPostseasonResult }
  | { command: 'declare-free-agent-interest'; result: SeasonDeclareFreeAgentInterestResult }
  | { command: 'skip-free-agent-market'; result: SeasonSkipFreeAgentMarketResult }
  | { command: 'resolve-free-agent-market'; result: SeasonResolveFreeAgentMarketResult };

export interface SeasonRunCommandOutput {
  result: SeasonRunCommandResult;
  run: SeasonRun;
  pending: SeasonPendingBlockCandidate | null;

  postseasonSummaries?: SeasonPostseasonSummary[];
}

export class SeasonRunCommandNotImplementedError extends Error {
  readonly command: string;
  constructor(command: string) {
    super(`season run command handler not implemented yet: ${command}`);
    this.name = 'SeasonRunCommandNotImplementedError';
    this.command = command;
  }
}

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
  | 'fast-forward-postseason'
  | 'declare-free-agent-interest'
  | 'skip-free-agent-market'
  | 'resolve-free-agent-market';

function economyRunOf(context: SeasonRunCommandContext): SeasonEconomyRun {
  return seasonEconomyRunOf(context.run, context.effects);
}

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
    freeAgency: run.freeAgency,
  };
}

function advanceRunState(run: SeasonEconomyRun): SeasonRun {
  const next = { ...run, stateRevision: run.stateRevision + 1, stateDigest: '' };
  return { ...next, stateDigest: seasonRunStateDigest(runStateDigestFactsOf(next)) };
}

function deriveAwardsIfNeeded(
  run: SeasonEconomyRun,
  context: SeasonRunCommandContext,
  stage: SeasonRunStage,
): SeasonEconomyRun {
  if (run.awards !== null || (stage !== 'playoffs' && stage !== 'completed')) return run;
  const summaries = context.regularSeasonSummaries ?? [];
  if (summaries.length === 0) return run;
  return {
    ...run,
    awards: deriveSeasonAwards({
      runId: run.runId,
      rosters: run.rosters,
      summaries: [...summaries],
    }),
  };
}

function commandAlreadyRecorded(run: SeasonRun, commandId: string): boolean {
  if (run.checkpointState !== null && run.checkpointState.commandId === commandId) return true;
  if (run.influence.ledger.some((entry) => entry.commandId === commandId)) return true;
  if (run.transactions.some((entry) => entry.commandId === commandId)) return true;
  for (const selection of Object.values(run.objectives.selections)) {
    if (selection.selectedByCommandId === commandId) return true;
  }
  return false;
}

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

          almanacDigest: POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER,
          finalizedAtStateRevision: run.stateRevision + 1,
        }
      : null;
  const withAwards = deriveAwardsIfNeeded(current, context, stage);
  const nextRun = advanceRunState({ ...withAwards, stage, completion });
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
  const withAwards = deriveAwardsIfNeeded(current, context, stage);
  const nextRun = advanceRunState({ ...withAwards, stage, completion });
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
  const withAwards = deriveAwardsIfNeeded(current, context, 'completed');
  const nextRun = advanceRunState({ ...withAwards, stage: 'completed', completion });
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

export class SeasonFreeAgencyFactsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeasonFreeAgencyFactsError';
  }
}

function freeAgencyRejectionTo(error: FreeAgencyValidationRejection): SeasonRunCommandRejection {
  return error.rejection as SeasonRunCommandRejection;
}

function rejectedFreeAgency(
  command:
    | SeasonDeclareFreeAgentInterestCommand
    | SeasonSkipFreeAgentMarketCommand
    | SeasonResolveFreeAgentMarketCommand,
  rejection: SeasonRunCommandRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return {
    result: {
      command: command.command as DispatchableCommandKind,
      result: { status: 'rejected', commandId: command.commandId, rejection },
    } as SeasonRunCommandResult,
    run,
    pending: null,
  };
}

function handleDeclareFreeAgentInterest(
  command: SeasonDeclareFreeAgentInterestCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (run.freeAgency.windows.every((window) => window.windowIndex !== command.windowIndex)) {
    return rejectedFreeAgency(
      command,
      {
        code: 'free-agency-window-not-open',
        franchiseId: command.franchiseId,
        windowIndex: command.windowIndex,
      },
      run,
    );
  }
  let nextFreeAgency;
  try {
    nextFreeAgency = applyFreeAgencyDeclaration(
      run,
      command.windowIndex,
      command.franchiseId,
      command.commandId,
      command.targets,
    );
  } catch (error) {
    if (error instanceof FreeAgencyValidationRejection) {
      return rejectedFreeAgency(command, freeAgencyRejectionTo(error), run);
    }
    throw error;
  }
  const next = advanceRunState({ ...run, freeAgency: nextFreeAgency });
  return {
    result: {
      command: 'declare-free-agent-interest',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        franchiseId: command.franchiseId,
        windowIndex: command.windowIndex,
        declaration: command.targets,
      },
    },
    run: next,
    pending: null,
  };
}

function handleSkipFreeAgentMarket(
  command: SeasonSkipFreeAgentMarketCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (run.freeAgency.windows.every((window) => window.windowIndex !== command.windowIndex)) {
    return rejectedFreeAgency(
      command,
      {
        code: 'free-agency-window-not-open',
        franchiseId: command.franchiseId,
        windowIndex: command.windowIndex,
      },
      run,
    );
  }
  let nextFreeAgency;
  try {
    nextFreeAgency = applyFreeAgencySkip(
      run,
      command.windowIndex,
      command.franchiseId,
      command.commandId,
    );
  } catch (error) {
    if (error instanceof FreeAgencyValidationRejection) {
      return rejectedFreeAgency(command, freeAgencyRejectionTo(error), run);
    }
    throw error;
  }
  const next = advanceRunState({ ...run, freeAgency: nextFreeAgency });
  return {
    result: {
      command: 'skip-free-agent-market',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        franchiseId: command.franchiseId,
        windowIndex: command.windowIndex,
      },
    },
    run: next,
    pending: null,
  };
}

function handleResolveFreeAgentMarket(
  command: SeasonResolveFreeAgentMarketCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (context.catalog === undefined || context.freeAgencyIndex === undefined) {
    throw new SeasonFreeAgencyFactsError(
      'resolve-free-agent-market requires the packaged catalog and free-agency index; the command layer supplies them',
    );
  }
  let resolution;
  try {
    resolution = resolveSeasonFreeAgencyWindow(
      {
        run: context.run,
        effects: context.effects as SeasonEffectsState,
        catalog: context.catalog,
        index: context.freeAgencyIndex,
        targets: context.freeAgencyTargets,
        humanFranchiseId: context.humanFranchiseId,
      },
      command.windowIndex,
      command.commandId,
    );
  } catch (error) {
    if (error instanceof FreeAgencyValidationRejection) {
      return rejectedFreeAgency(command, freeAgencyRejectionTo(error), run);
    }
    throw error;
  }
  const next = advanceRunState({
    ...run,
    freeAgency: resolution.freeAgency,
    rosters: resolution.rosters,
    ownership: resolution.ownership,
    influence: resolution.influence,
    transactions: resolution.transactions,
    effects: resolution.effects,
  });
  const humanSigned = resolution.signings.some(
    (signing) => signing.franchiseId === context.humanFranchiseId,
  );
  return {
    result: {
      command: 'resolve-free-agent-market',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        windowIndex: command.windowIndex,
        traces: resolution.traces.map((trace) => ({
          seedPath: trace.seedPath,
          resolution: trace.resolution,
          signingFranchiseId: trace.signingFranchiseId,
          signedPlayerVersionId: trace.signedPlayerVersionId,
        })),
        signings: resolution.signings,
        humanSigned,
      },
    },
    run: next,
    pending: null,
  };
}

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
    case 'declare-free-agent-interest':
      return handleDeclareFreeAgentInterest(command, context);
    case 'skip-free-agent-market':
      return handleSkipFreeAgentMarket(command, context);
    case 'resolve-free-agent-market':
      return handleResolveFreeAgentMarket(command, context);
  }
}
