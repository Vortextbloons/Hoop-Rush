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
  SeasonSelectFrontOfficeCommand,
  SeasonSelectFrontOfficeResult,
  SeasonSelectCourtInnovationCommand,
  SeasonSelectCourtInnovationResult,
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
  SeasonNoWindowRejection,
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
  SeasonLegacyRunCommand,
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
  SeasonSelectGmIdentityCommand,
  SeasonSelectGmIdentityRejection,
  SeasonSelectGmIdentityResult,
  SeasonSelectCampaignOpportunityCommand,
  SeasonSelectCampaignOpportunityRejection,
  SeasonSelectCampaignOpportunityResult,
  SeasonEvolveGmCampaignCommand,
  SeasonEvolveGmCampaignRejection,
  SeasonEvolveGmCampaignResult,
  SeasonOpenTradeInquiryCommand,
  SeasonOpenTradeInquiryRejection,
  SeasonOpenTradeInquiryResult,
  SeasonPendingBlockRejection,
  SeasonSubmitTradeProposalCommand,
  SeasonSubmitTradeProposalRejection,
  SeasonSubmitTradeProposalResult,
  SeasonRespondToTradeCounterCommand,
  SeasonRespondToTradeCounterRejection,
  SeasonRespondToTradeCounterResult,
  SeasonTradeNegotiationConflictRejection,
  SeasonTradeNegotiationIllegalRejection,
  SeasonWalkAwayFromTradeCommand,
  SeasonWalkAwayFromTradeRejection,
  SeasonWalkAwayFromTradeResult,
  SeasonPurchaseTradeInquiryCommand,
  SeasonPurchaseTradeInquiryRejection,
  SeasonPurchaseTradeInquiryResult,
  SeasonBuySponsorCommand,
  SeasonBuySponsorRejection,
  SeasonBuySponsorResult,
  SeasonApplySponsorCommand,
  SeasonApplySponsorRejection,
  SeasonApplySponsorResult,
  SeasonCampaignAlreadySelectedRejection,
  SeasonCampaignOpportunityNotOfferedRejection,
  SeasonTradeActiveNegotiationRejection,
  SeasonTradeInquiryCapRejection,
} from '@hoop-rush/data-contracts';
import {
  SEASON_ROUND_COUNT,
  franchiseForParticipant,
  authorityForFranchise,
  franchiseIdSchema,
  playInGameIdOf,
  seasonRunCommandRejectionSchema,
  type SeasonRunAuthority,
} from '@hoop-rush/data-contracts';
import { assertNever } from '../sim/assert-never.ts';
import { expandSeasonRunRosters, seasonNextBlockIndex } from './block.ts';
import {
  advancePendingAfterForfeit,
  seasonForfeitSummaryForGame,
  seasonFranchiseLegalFiveFacts,
} from './health.ts';
import {
  applyRiskyRehabOutcome,
  rollSeasonRehabOutcome,
  seasonPlayerAvailable,
} from './injuries.ts';
import { applySeasonInfluenceSpend, SEASON_INFLUENCE_FLOOR } from './influence.ts';
import {
  POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER,
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
import { legalFiveExists, type SeasonRosterMemberInput } from './roster-rules.ts';
import { validateSeasonRotation, seasonRotationSetDigest } from './rotation.ts';
import { deriveSeasonAwards } from './awards.ts';
import { seasonRunStateDigest } from './state-digest.ts';
import { seasonRunStateDigestFactsOf } from './state-digest.ts';
import {
  applySeasonTrade,
  fillTradeBackfill,
  seasonEconomyRunOf,
  seasonTradeCatalogFactsOf,
  seasonTradePlayerHealthFacts,
  generatedExtraOfferForSpend,
  tradeOfferBackfillSeed,
  tradeRosterLegalityReasons,
  type SeasonEconomyRun,
} from './trades.ts';
import { normalizeCampaignState } from './campaign.ts';
import { normalizeEvolutionState } from '@hoop-rush/data-contracts';
import {
  SEASON_COURT_INNOVATION_CATALOG,
  SEASON_COURT_INNOVATION_VERSION,
  SEASON_FRONT_OFFICE_CATALOG,
  SEASON_FRONT_OFFICE_VERSION,
  type SeasonEvolutionState,
} from '@hoop-rush/data-contracts';
import { evaluateTradeProposal, openTradeInquiry } from './trade-board.ts';
import { rehabPriceOf, purchasedInquiryCostOf, baseInquiryAllowanceOf } from './evolution.ts';
import {
  FreeAgencyValidationRejection,
  applyFreeAgencyDeclaration,
  applyFreeAgencySkip,
  resolveSeasonFreeAgencyWindow,
} from './free-agency.ts';
import { seasonTransactionEntry } from './transactions.ts';
import {
  SEASON_SPONSOR_SLOTS,
  normalizeSponsorGearState,
  sponsorGearEntryOf,
} from '@hoop-rush/data-contracts';
export interface SeasonRunCommandContext {
  run: SeasonRun;
  pending: SeasonPendingBlockCandidate | null;
  humanFranchiseId: string | null;
  authority?: import('@hoop-rush/data-contracts').SeasonRunAuthority;
  actorParticipantId?: import('@hoop-rush/data-contracts').SeasonParticipantId | null;
  actorFranchiseId?: string | null;
  participantFranchiseIds?: readonly string[];
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
  | {
      command: 'select-block-objective';
      result: SeasonSelectBlockObjectiveResult;
    }
  | {
      command: 'spend-influence';
      result: SeasonSpendInfluenceResult;
    }
  | {
      command: 'accept-trade-offer';
      result: SeasonAcceptTradeOfferResult;
    }
  | {
      command: 'decline-trade-offer';
      result: SeasonDeclineTradeOfferResult;
    }
  | {
      command: 'resume-season-block';
      result: SeasonResumeSeasonBlockResult;
    }
  | {
      command: 'forfeit-interrupted-game';
      result: SeasonForfeitInterruptedGameResult;
    }
  | {
      command: 'start-postseason';
      result: SeasonStartPostseasonResult;
    }
  | {
      command: 'advance-postseason';
      result: SeasonAdvancePostseasonResult;
    }
  | {
      command: 'submit-postseason-rotation';
      result: SeasonSubmitPostseasonRotationResult;
    }
  | {
      command: 'spectate-postseason-game';
      result: SeasonSpectatePostseasonGameResult;
    }
  | {
      command: 'fast-forward-postseason';
      result: SeasonFastForwardPostseasonResult;
    }
  | {
      command: 'declare-free-agent-interest';
      result: SeasonDeclareFreeAgentInterestResult;
    }
  | {
      command: 'skip-free-agent-market';
      result: SeasonSkipFreeAgentMarketResult;
    }
  | {
      command: 'resolve-free-agent-market';
      result: SeasonResolveFreeAgentMarketResult;
    }
  | {
      command: 'select-gm-identity';
      result: SeasonSelectGmIdentityResult;
    }
  | {
      command: 'select-campaign-opportunity';
      result: SeasonSelectCampaignOpportunityResult;
    }
  | {
      command: 'evolve-gm-campaign';
      result: SeasonEvolveGmCampaignResult;
    }
  | {
      command: 'open-trade-inquiry';
      result: SeasonOpenTradeInquiryResult;
    }
  | {
      command: 'submit-trade-proposal';
      result: SeasonSubmitTradeProposalResult;
    }
  | {
      command: 'respond-to-trade-counter';
      result: SeasonRespondToTradeCounterResult;
    }
  | {
      command: 'walk-away-from-trade';
      result: SeasonWalkAwayFromTradeResult;
    }
  | {
      command: 'purchase-trade-inquiry';
      result: SeasonPurchaseTradeInquiryResult;
    }
  | {
      command: 'purchase-trade-inquiry';
      result: SeasonPurchaseTradeInquiryResult;
    }
  | {
      command: 'buy-sponsor';
      result: SeasonBuySponsorResult;
    }
  | {
      command: 'apply-sponsor';
      result: SeasonApplySponsorResult;
    }
  | {
      command: 'select-front-office';
      result: SeasonSelectFrontOfficeResult;
    };
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
function economyRunOf(context: SeasonRunCommandContext): SeasonEconomyRun {
  return seasonEconomyRunOf(context.run, context.effects);
}
function runStateDigestFactsOf(run: SeasonEconomyRun): Parameters<typeof seasonRunStateDigest>[0] {
  return seasonRunStateDigestFactsOf(run, run.effects);
}
function authorityOfContext(
  context: SeasonRunCommandContext | undefined,
  run: SeasonRun,
): SeasonRunAuthority | null {
  if (context?.authority) return context.authority;
  const runAuthority = (
    run as {
      authority?: SeasonRunAuthority;
    }
  ).authority;
  if (runAuthority) return runAuthority;
  return null;
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
  const evo = (
    run as { evolution?: import('@hoop-rush/data-contracts').SeasonEvolutionState | null }
  ).evolution;
  if (evo?.frontOffice?.selectedByCommandId === commandId) return true;
  if (evo && Object.values(evo.selections).some((s) => s.selectedByCommandId === commandId))
    return true;
  const sponsors = run.sponsors;
  if (sponsors?.vault.items.some((item) => item.acquiredByCommandId === commandId)) return true;
  if (
    Object.values(sponsors?.players.slots ?? {}).some(
      (slots) =>
        slots.shoe?.appliedByCommandId === commandId ||
        slots.apparel?.appliedByCommandId === commandId ||
        slots.fuel?.appliedByCommandId === commandId,
    )
  ) {
    return true;
  }
  return false;
}
function baseValidation(
  command: SeasonRunCommand | SeasonLegacyRunCommand,
  run: SeasonRun,
  pending: SeasonPendingBlockCandidate | null,
  context?: SeasonRunCommandContext,
): SeasonRunCommandOutput | null {
  if (command.command === 'submit-season-block') {
    throw new SeasonRunCommandNotImplementedError(
      'submit-season-block is handled by the block pipeline, not the run command dispatch',
    );
  }
  const commandKind = command.command;
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
  const authority = authorityOfContext(context, run);
  const actorPid = context?.actorParticipantId ?? null;
  const actorFid = context?.actorFranchiseId ?? null;
  if (authority !== null) {
    if (authority.kind === 'season-multiplayer') {
      if (actorPid !== null) {
        const expectedFid = franchiseForParticipant(authority, actorPid);
        if (expectedFid === null || (actorFid !== null && expectedFid !== actorFid)) {
          return rejectedWith({
            code: 'run-mismatch',
            expectedRunId: run.runId,
          });
        }
      } else if (actorFid !== null) {
        const pid = authorityForFranchise(authority, actorFid);
        if (pid === null) {
          return rejectedWith({
            code: 'run-mismatch',
            expectedRunId: run.runId,
          });
        }
      }
      const directFid =
        'franchiseId' in command && typeof command.franchiseId === 'string'
          ? command.franchiseId
          : undefined;
      if (directFid !== undefined && actorFid !== null && directFid !== actorFid) {
        return rejectedWith({
          code: 'run-mismatch',
          expectedRunId: run.runId,
        });
      }
    } else {
      if (
        actorFid !== null &&
        authority.soloFranchiseId !== null &&
        actorFid !== authority.soloFranchiseId
      ) {
        return rejectedWith({
          code: 'run-mismatch',
          expectedRunId: run.runId,
        });
      }
      const directFid =
        'franchiseId' in command && typeof command.franchiseId === 'string'
          ? command.franchiseId
          : undefined;
      if (directFid !== undefined && actorFid !== null && directFid !== actorFid) {
        return rejectedWith({
          code: 'run-mismatch',
          expectedRunId: run.runId,
        });
      }
    }
  } else if (context?.actorFranchiseId) {
    const targetFranchiseId =
      'franchiseId' in command && typeof command.franchiseId === 'string'
        ? command.franchiseId
        : null;
    if (targetFranchiseId !== null && targetFranchiseId !== context.actorFranchiseId) {
      return rejectedWith({
        code: 'run-mismatch',
        expectedRunId: run.runId,
      });
    }
  }
  return null;
}
function rejectedCommand(
  commandKind: SeasonRunCommand['command'],
  commandId: string,
  rejection: SeasonRunCommandRejection,
  run: SeasonRun,
  pending: SeasonPendingBlockCandidate | null = null,
): SeasonRunCommandOutput {
  return {
    result: {
      command: commandKind,
      result: { status: 'rejected', commandId, rejection },
    } as SeasonRunCommandResult,
    run,
    pending,
  };
}
function rejectedSelect(
  command: SeasonSelectBlockObjectiveCommand,
  rejection: SeasonSelectBlockObjectiveRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return rejectedCommand('select-block-objective', command.commandId, rejection, run);
}
function handleSelectBlockObjective(
  command: SeasonSelectBlockObjectiveCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  return rejectedSelect(command, { code: 'retired' }, run);
}
function rejectedSelectGmIdentity(
  command: SeasonSelectGmIdentityCommand,
  rejection: SeasonSelectGmIdentityRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return rejectedCommand('select-gm-identity', command.commandId, rejection, run);
}
function rejectedSelectCampaignOpportunity(
  command: SeasonSelectCampaignOpportunityCommand,
  rejection: SeasonSelectCampaignOpportunityRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return rejectedCommand('select-campaign-opportunity', command.commandId, rejection, run);
}
function rejectedEvolveGmCampaign(
  command: SeasonEvolveGmCampaignCommand,
  rejection: SeasonEvolveGmCampaignRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return rejectedCommand('evolve-gm-campaign', command.commandId, rejection, run);
}
function rejectedOpenTradeInquiry(
  command: SeasonOpenTradeInquiryCommand,
  rejection: SeasonOpenTradeInquiryRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return rejectedCommand('open-trade-inquiry', command.commandId, rejection, run);
}
function rejectedSubmitTradeProposal(
  command: SeasonSubmitTradeProposalCommand,
  rejection: SeasonSubmitTradeProposalRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return rejectedCommand('submit-trade-proposal', command.commandId, rejection, run);
}
function rejectedRespondToTradeCounter(
  command: SeasonRespondToTradeCounterCommand,
  rejection: SeasonRespondToTradeCounterRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return rejectedCommand('respond-to-trade-counter', command.commandId, rejection, run);
}
function rejectedWalkAwayFromTrade(
  command: SeasonWalkAwayFromTradeCommand,
  rejection: SeasonWalkAwayFromTradeRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return rejectedCommand('walk-away-from-trade', command.commandId, rejection, run);
}
function rejectedPurchaseTradeInquiry(
  command: SeasonPurchaseTradeInquiryCommand,
  rejection: SeasonPurchaseTradeInquiryRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return rejectedCommand('purchase-trade-inquiry', command.commandId, rejection, run);
}
function rejectedBuySponsor(
  command: SeasonBuySponsorCommand,
  rejection: SeasonBuySponsorRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return rejectedCommand('buy-sponsor', command.commandId, rejection, run);
}
function rejectedApplySponsor(
  command: SeasonApplySponsorCommand,
  rejection: SeasonApplySponsorRejection,
  run: SeasonRun,
): SeasonRunCommandOutput {
  return rejectedCommand('apply-sponsor', command.commandId, rejection, run);
}
function sponsorHumanFranchiseId(run: SeasonEconomyRun, context: SeasonRunCommandContext): string {
  return (
    context.humanFranchiseId ??
    run.league.teams.find((t) => t.control === 'human')?.franchiseId ??
    ''
  );
}
function handleBuySponsor(
  command: SeasonBuySponsorCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  const humanFid = franchiseIdSchema.parse(sponsorHumanFranchiseId(run, context));
  const sponsors = normalizeSponsorGearState(run.sponsors);
  const currentBlock = seasonNextBlockIndex(run.cursor.completedRounds);
  const board = sponsors.boards.boards.find((entry) => entry.blockIndex === currentBlock);
  const offer = board?.offers.find((candidate) => candidate.instanceId === command.instanceId);
  if (board === undefined || offer === undefined) {
    const stale = sponsors.boards.boards
      .flatMap((entry) => entry.offers)
      .find((candidate) => candidate.instanceId === command.instanceId);
    if (stale !== undefined) {
      return rejectedBuySponsor(
        command,
        {
          code: 'sponsor-expired',
          instanceId: command.instanceId,
          blockIndex: stale.blockIndex,
        },
        run,
      );
    }
    return rejectedBuySponsor(
      command,
      { code: 'sponsor-not-offered', instanceId: command.instanceId, blockIndex: currentBlock },
      run,
    );
  }
  const owned =
    sponsors.vault.items.some((item) => item.instanceId === command.instanceId) ||
    Object.values(sponsors.players.slots).some(
      (slots) =>
        slots.shoe?.instanceId === command.instanceId ||
        slots.apparel?.instanceId === command.instanceId ||
        slots.fuel?.instanceId === command.instanceId,
    );
  if (board.purchasedInstanceIds.includes(command.instanceId) || owned) {
    return rejectedBuySponsor(
      command,
      {
        code: 'sponsor-already-purchased',
        instanceId: command.instanceId,
        blockIndex: board.blockIndex,
      },
      run,
    );
  }
  const balance = run.influence.balances[humanFid] ?? 0;
  if (balance - offer.price < SEASON_INFLUENCE_FLOOR) {
    return rejectedBuySponsor(
      command,
      {
        code: 'insufficient-balance',
        franchiseId: humanFid,
        balance,
        requestedDelta: -offer.price,
        floor: SEASON_INFLUENCE_FLOOR,
      },
      run,
    );
  }
  const spend = applySeasonInfluenceSpend({
    influence: run.influence,
    franchiseId: humanFid,
    source: 'sponsor-purchase',
    requestedDelta: -offer.price,
    blockIndex: board.blockIndex,
    commandId: command.commandId,
    explanation: `Sponsor ${offer.brandFamily} ${offer.tier} (${offer.slot})`,
  });
  const nextSponsors = {
    ...sponsors,
    vault: {
      ...sponsors.vault,
      items: [
        ...sponsors.vault.items,
        {
          instanceId: offer.instanceId,
          entryId: offer.entryId,
          acquiredBlock: board.blockIndex,
          acquiredByCommandId: command.commandId,
        },
      ],
    },
    boards: {
      ...sponsors.boards,
      boards: sponsors.boards.boards.map((entry) =>
        entry.blockIndex === board.blockIndex
          ? { ...entry, purchasedInstanceIds: [...entry.purchasedInstanceIds, offer.instanceId] }
          : entry,
      ),
    },
  };
  const nextRunBase = {
    ...run,
    sponsors: nextSponsors,
    influence: spend.influence,
    transactions: [
      ...run.transactions,
      seasonTransactionEntry({
        transactionId: `txn-sponsor-purchase-${command.commandId}`,
        commandId: command.commandId,
        franchiseId: humanFid,
        type: 'sponsor-purchase',
        blockIndex: board.blockIndex,
        appliedAtStateRevision: run.stateRevision + 1,
        payload: { instanceId: offer.instanceId, entryId: offer.entryId, price: offer.price },
        explanation: `Sponsor purchase ${offer.brandFamily} ${offer.tier} (${offer.slot})`,
      }),
    ],
  };
  const next = advanceRunState(nextRunBase);
  return {
    result: {
      command: 'buy-sponsor',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        instanceId: offer.instanceId,
        entryId: offer.entryId,
        price: offer.price,
      },
    },
    run: next,
    pending: null,
  };
}
function handleApplySponsor(
  command: SeasonApplySponsorCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  const humanFid = franchiseIdSchema.parse(sponsorHumanFranchiseId(run, context));
  const sponsors = normalizeSponsorGearState(run.sponsors);
  const vaultIndex = sponsors.vault.items.findIndex(
    (item) => item.instanceId === command.instanceId,
  );
  if (vaultIndex === -1) {
    return rejectedApplySponsor(
      command,
      { code: 'sponsor-not-owned', instanceId: command.instanceId },
      run,
    );
  }
  const vaultItem = sponsors.vault.items[vaultIndex];
  if (vaultItem === undefined) {
    return rejectedApplySponsor(
      command,
      { code: 'sponsor-not-owned', instanceId: command.instanceId },
      run,
    );
  }
  const entry = sponsorGearEntryOf(vaultItem.entryId);
  if (entry.slot !== command.slot) {
    return rejectedApplySponsor(
      command,
      {
        code: 'sponsor-slot-mismatch',
        instanceId: command.instanceId,
        expectedSlot: entry.slot,
        slot: command.slot,
      },
      run,
    );
  }
  const owner = run.ownership.find(
    (row) => row.playerVersionId === command.playerVersionId,
  )?.ownerFranchiseId;
  if (owner !== humanFid) {
    return rejectedApplySponsor(
      command,
      { code: 'sponsor-not-on-roster', playerVersionId: command.playerVersionId },
      run,
    );
  }
  const slots = sponsors.players.slots[command.playerVersionId] ?? {
    shoe: null,
    apparel: null,
    fuel: null,
  };
  if (slots[command.slot] !== null) {
    return rejectedApplySponsor(
      command,
      {
        code: 'sponsor-slot-occupied',
        playerVersionId: command.playerVersionId,
        slot: command.slot,
      },
      run,
    );
  }
  for (const slot of SEASON_SPONSOR_SLOTS) {
    if (slots[slot]?.brandFamily === entry.brandFamily) {
      return rejectedApplySponsor(
        command,
        {
          code: 'sponsor-brand-duplicate',
          playerVersionId: command.playerVersionId,
          brandFamily: entry.brandFamily,
        },
        run,
      );
    }
  }
  const offer = sponsors.boards.boards
    .flatMap((board) => board.offers)
    .find((candidate) => candidate.instanceId === command.instanceId);
  if (offer === undefined) {
    throw new Error(`sponsor vault item ${command.instanceId} has no dealt offer`);
  }
  const currentBlock = seasonNextBlockIndex(run.cursor.completedRounds);
  const nextSponsors = {
    ...sponsors,
    vault: {
      ...sponsors.vault,
      items: sponsors.vault.items.filter((_, index) => index !== vaultIndex),
    },
    players: {
      ...sponsors.players,
      slots: {
        ...sponsors.players.slots,
        [command.playerVersionId]: {
          ...slots,
          [command.slot]: {
            instanceId: offer.instanceId,
            entryId: offer.entryId,
            brandFamily: offer.brandFamily,
            slot: command.slot,
            tier: offer.tier,
            boosts: offer.boosts,
            appliedBlock: currentBlock ?? 8,
            appliedByCommandId: command.commandId,
          },
        },
      },
    },
  };
  const next = advanceRunState({ ...run, sponsors: nextSponsors });
  return {
    result: {
      command: 'apply-sponsor',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        instanceId: offer.instanceId,
        playerVersionId: command.playerVersionId,
        slot: command.slot,
      },
    },
    run: next,
    pending: null,
  };
}
function handleSelectGmIdentity(
  command: SeasonSelectGmIdentityCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const economy = economyRunOf(context);
  const run = economy;
  return rejectedSelectGmIdentity(command, { code: 'retired' }, run);
}
function handleSelectCampaignOpportunity(
  command: SeasonSelectCampaignOpportunityCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const economy = economyRunOf(context);
  const run = economy;
  return rejectedSelectCampaignOpportunity(command, { code: 'retired' }, run);
}
function handleEvolveGmCampaign(
  command: SeasonEvolveGmCampaignCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const economy = economyRunOf(context);
  const run = economy;
  return rejectedEvolveGmCampaign(command, { code: 'retired' }, run);
}
function pendingBlockRejectionOf(
  context: SeasonRunCommandContext,
): SeasonPendingBlockRejection | null {
  if (context.pending === null) return null;
  return { code: 'pending-block', blockIndex: context.pending.blockIndex };
}
function resolveNegotiationPackage(negotiation: {
  activeProposalOutgoing?: readonly string[];
  activeProposalIncoming?: readonly string[];
  exchanges: readonly {
    proposalFingerprint: string | null;
  }[];
}): { outgoing: string[]; incoming: string[] } | null {
  const outgoing = negotiation.activeProposalOutgoing;
  const incoming = negotiation.activeProposalIncoming;
  if (outgoing !== undefined && incoming !== undefined) {
    return { outgoing: [...outgoing], incoming: [...incoming] };
  }
  for (let index = negotiation.exchanges.length - 1; index >= 0; index -= 1) {
    const fingerprint = negotiation.exchanges[index]?.proposalFingerprint ?? null;
    if (fingerprint === null) continue;
    const separator = fingerprint.indexOf('|');
    if (separator < 0) continue;
    const left = fingerprint.slice(0, separator).trim();
    const right = fingerprint.slice(separator + 1).trim();
    const parse = (part: string): string[] =>
      part.length === 0
        ? []
        : part
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0);
    const parsedOutgoing = parse(left);
    const parsedIncoming = parse(right);
    if (parsedOutgoing.length === 0 || parsedIncoming.length === 0) continue;
    return { outgoing: parsedOutgoing, incoming: parsedIncoming };
  }
  return null;
}
function handleOpenTradeInquiry(
  command: SeasonOpenTradeInquiryCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const pendingRejection = pendingBlockRejectionOf(context);
  const economy = economyRunOf(context);
  const run = economy;
  if (pendingRejection !== null) {
    return rejectedCommand(
      'open-trade-inquiry',
      command.commandId,
      pendingRejection,
      run,
      context.pending,
    );
  }
  if (
    !run.trade ||
    !run.trade.windows.some((w) => w.windowIndex === command.windowIndex && w.status === 'open')
  ) {
    const rejection: SeasonWindowNotOpenRejection = {
      code: 'window-not-open',
      franchiseId: command.toFranchiseId,
      windowIndex: command.windowIndex,
    };
    return rejectedOpenTradeInquiry(command, rejection, run);
  }
  const win = run.trade.windows.find((w) => w.windowIndex === command.windowIndex);
  if (win === undefined) {
    throw new Error(`trade window ${String(command.windowIndex)} missing after validation`);
  }
  if (win.activeInquiryId) {
    const rejection: SeasonTradeActiveNegotiationRejection = {
      code: 'trade-active-negotiation',
      windowIndex: command.windowIndex,
      activeInquiryId: win.activeInquiryId,
    };
    return rejectedOpenTradeInquiry(command, rejection, run);
  }
  const allowance =
    win.inquiryAllowance ??
    baseInquiryAllowanceOf(
      normalizeEvolutionState((run as { evolution?: unknown }).evolution).frontOffice
        ?.executiveId ?? null,
    );
  const used = win.negotiations?.length ?? 0;
  if (used >= allowance) {
    const rejection: SeasonTradeInquiryCapRejection = {
      code: 'trade-inquiry-cap',
      windowIndex: command.windowIndex,
      inquiriesUsed: used,
      allowance,
    };
    return rejectedOpenTradeInquiry(command, rejection, run);
  }
  const result = openTradeInquiry(run, command.windowIndex, command.toFranchiseId);
  if ('error' in result) {
    throw new Error(
      `open-trade-inquiry failed after validation: ${result.error} window ${String(command.windowIndex)}`,
    );
  }
  const next = advanceRunState({
    ...result.run,
    effects: economy.effects,
  });
  return {
    result: {
      command: 'open-trade-inquiry',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        windowIndex: command.windowIndex,
        inquiryId: result.inquiryId,
      },
    },
    run: next,
    pending: null,
  };
}
function handleSubmitTradeProposal(
  command: SeasonSubmitTradeProposalCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const economy = economyRunOf(context);
  const run = economy;
  const submitPending = pendingBlockRejectionOf(context);
  if (submitPending !== null) {
    return rejectedCommand(
      'submit-trade-proposal',
      command.commandId,
      submitPending,
      run,
      context.pending,
    );
  }
  if (!context.catalog) {
    return rejectedSubmitTradeProposal(
      command,
      {
        code: 'window-not-open',
        franchiseId: null,
        windowIndex: command.windowIndex,
      },
      run,
    );
  }
  const win = run.trade?.windows.find((w) => w.windowIndex === command.windowIndex);
  if (!win || win.status !== 'open') {
    return rejectedSubmitTradeProposal(
      command,
      {
        code: 'window-not-open',
        franchiseId: command.toFranchiseId,
        windowIndex: command.windowIndex,
      },
      run,
    );
  }
  if (
    win.activeInquiryId &&
    win.negotiations?.some((n) => n.inquiryId === win.activeInquiryId && n.status === 'active')
  ) {
  }
  const evalResult = evaluateTradeProposal({
    run,
    windowIndex: command.windowIndex,
    toFranchiseId: command.toFranchiseId,
    outgoingPlayerVersionIds: command.outgoingPlayerVersionIds,
    incomingPlayerVersionIds: command.incomingPlayerVersionIds,
    influenceAmount: command.influenceAmount,
    influenceFromSender: command.influenceFromSender,
    catalog: context.catalog,
    rootSeed: run.rootSeed,
  });
  if (!evalResult.ok) {
    const reason = evalResult.reason;
    switch (evalResult.code) {
      case 'trade-wrong-fit':
        return rejectedSubmitTradeProposal(command, { code: 'trade-wrong-fit', reason }, run);
      case 'trade-insufficient-talent':
        return rejectedSubmitTradeProposal(
          command,
          { code: 'trade-insufficient-talent', reason },
          run,
        );
      case 'window-not-open':
        return rejectedSubmitTradeProposal(
          command,
          {
            code: 'window-not-open',
            franchiseId: command.toFranchiseId,
            windowIndex: command.windowIndex,
          },
          run,
        );
      default:
        return rejectedSubmitTradeProposal(command, { code: 'trade-wrong-fit', reason }, run);
    }
  }
  const fingerprint = evalResult.proposal.fingerprint;
  const duplicate = win.negotiations?.some((n) =>
    n.exchanges.some((e) => e.proposalFingerprint === fingerprint),
  );
  if (duplicate) {
    return rejectedSubmitTradeProposal(
      command,
      {
        code: 'trade-duplicate-proposal',
        fingerprint,
      },
      run,
    );
  }
  const isNewInquiry = !win.activeInquiryId;
  const allowance =
    win.inquiryAllowance ??
    baseInquiryAllowanceOf(
      normalizeEvolutionState((run as { evolution?: unknown }).evolution).frontOffice
        ?.executiveId ?? null,
    );
  const used = win.negotiations?.length ?? 0;
  if (isNewInquiry && used >= allowance) {
    return rejectedSubmitTradeProposal(
      command,
      {
        code: 'trade-inquiry-cap',
        windowIndex: command.windowIndex,
        inquiriesUsed: used,
        allowance,
      },
      run,
    );
  }
  let nextWin: import('@hoop-rush/data-contracts').SeasonTradeWindowState = { ...win };
  let inquiryId = win.activeInquiryId;
  if (!inquiryId) {
    const opened = openTradeInquiry(run, command.windowIndex, command.toFranchiseId);
    if ('error' in opened) {
      throw new Error(
        `submit-trade-proposal open inquiry failed after validation: ${opened.error} window ${String(command.windowIndex)}`,
      );
    }
    inquiryId = opened.inquiryId;
    const openedTrade = opened.run.trade;
    if (!openedTrade) {
      throw new Error('trade inquiry result missing trade state');
    }
    const openedWin = openedTrade.windows.find((w) => w.windowIndex === command.windowIndex);
    if (openedWin === undefined) {
      throw new Error(`trade window ${String(command.windowIndex)} missing after inquiry open`);
    }
    nextWin = openedWin;
  }
  const existingForUpdate = nextWin.negotiations?.find((n) => n.inquiryId === inquiryId) ?? null;
  let nextNegotiations: import('@hoop-rush/data-contracts').SeasonTradeNegotiation[];
  const consequenceFacts = evalResult.proposal.consequenceFacts as {
    isOverpay?: boolean;
    rawRatio?: number;
    adjustedRatio?: number;
  };
  const isOverpayGift = consequenceFacts.isOverpay === true;
  const giftNote = isOverpayGift
    ? `Overpay gift ${String(consequenceFacts.rawRatio ?? '')}→${String(consequenceFacts.adjustedRatio ?? '')}`
    : null;
  if (existingForUpdate) {
    if (existingForUpdate.exchangeCount >= 3) {
      return rejectedSubmitTradeProposal(
        command,
        {
          code: 'trade-exchange-limit',
          windowIndex: command.windowIndex,
          inquiryId,
          exchangeCount: existingForUpdate.exchangeCount,
        },
        run,
      );
    }
    const nextIdx = existingForUpdate.exchangeCount + 1;
    const updated: import('@hoop-rush/data-contracts').SeasonTradeNegotiation = {
      ...existingForUpdate,
      status: 'active',
      exchangeCount: nextIdx,
      exchanges: [
        ...existingForUpdate.exchanges,
        {
          exchangeIndex: nextIdx,
          kind: nextIdx === 1 ? 'human-proposal' : 'human-revision',
          proposalId: evalResult.proposal.proposalId,
          proposalFingerprint: fingerprint,
          responseCause: null,
          atStateRevision: run.stateRevision,
        },
      ],
      activeProposalId: evalResult.proposal.proposalId,
      activeProposalOutgoing: [...command.outgoingPlayerVersionIds],
      activeProposalIncoming: [...command.incomingPlayerVersionIds],
      latestRequestedChange: giftNote ?? existingForUpdate.latestRequestedChange,
      expressedInterests:
        giftNote !== null
          ? [...existingForUpdate.expressedInterests, giftNote]
          : existingForUpdate.expressedInterests,
    };
    nextNegotiations = (nextWin.negotiations ?? []).map((n) =>
      n.inquiryId === inquiryId ? updated : n,
    );
  } else {
    const newNegotiation: import('@hoop-rush/data-contracts').SeasonTradeNegotiation = {
      inquiryId: inquiryId,
      windowIndex: command.windowIndex,
      fromFranchiseId: franchiseIdSchema.parse(
        context.humanFranchiseId ??
          run.league.teams.find((t) => t.control === 'human')?.franchiseId ??
          '',
      ),
      toFranchiseId: command.toFranchiseId,
      status: 'active',
      exchangeCount: 1,
      exchanges: [
        {
          exchangeIndex: 1,
          kind: 'human-proposal',
          proposalId: evalResult.proposal.proposalId,
          proposalFingerprint: fingerprint,
          responseCause: null,
          atStateRevision: run.stateRevision,
        },
      ],
      rejectedPlayerVersionIds: [],
      expressedInterests: giftNote !== null ? [giftNote] : [],
      latestRequestedChange: giftNote,
      finalReason: null,
      activeProposalId: evalResult.proposal.proposalId,
      activeProposalOutgoing: [...command.outgoingPlayerVersionIds],
      activeProposalIncoming: [...command.incomingPlayerVersionIds],
    };
    nextNegotiations = [...(nextWin.negotiations ?? []), newNegotiation];
  }
  nextWin = {
    ...nextWin,
    activeInquiryId: inquiryId,
    negotiations: nextNegotiations,
  };
  let nextInfluence = run.influence;
  const nextTransactions = [...run.transactions];
  if (evalResult.proposal.influenceAmount > 0 && evalResult.proposal.influenceFromSender) {
    const sender = evalResult.proposal.influenceFromSender;
    const amount = evalResult.proposal.influenceAmount;
    const senderBalance = nextInfluence.balances[sender] ?? 0;
    if (senderBalance - amount < SEASON_INFLUENCE_FLOOR) {
      return rejectedSubmitTradeProposal(
        command,
        {
          code: 'insufficient-balance',
          franchiseId: sender,
          balance: senderBalance,
          requestedDelta: -amount,
          floor: SEASON_INFLUENCE_FLOOR,
        },
        run,
      );
    }
    const sent =
      (run.influence.windows[sender] ?? []).find((w) => w.windowIndex === command.windowIndex)
        ?.tradeCashSent ?? 0;
    if (sent + amount > 3) {
      return rejectedSubmitTradeProposal(
        command,
        {
          code: 'trade-cash-cap',
          franchiseId: sender,
          windowIndex: command.windowIndex,
          sent,
          requested: amount,
        },
        run,
      );
    }
    const spendResult = applySeasonInfluenceSpend({
      influence: nextInfluence,
      franchiseId: sender,
      source: 'trade-cash-sent',
      requestedDelta: -amount,
      blockIndex: null,
      commandId: command.commandId,
      explanation: `Trade cash sent ${String(amount)} from ${sender} to ${command.toFranchiseId}`,
    });
    nextInfluence = spendResult.influence;
    const creditTo =
      sender === (context.humanFranchiseId ?? '')
        ? command.toFranchiseId
        : (context.humanFranchiseId ?? '');
    if (creditTo) {
      const creditResult = applySeasonInfluenceSpend({
        influence: nextInfluence,
        franchiseId: creditTo,
        source: 'trade-cash-received',
        requestedDelta: amount,
        blockIndex: null,
        commandId: command.commandId,
        explanation: `Trade cash received ${String(amount)} by ${creditTo}`,
      });
      nextInfluence = creditResult.influence;
    }
    const updateWindowCash = (
      franchiseId: string,
      field: 'tradeCashSent' | 'tradeCashReceived',
      delta: number,
    ) => {
      const fid = franchiseIdSchema.parse(franchiseId);
      const wins = nextInfluence.windows[fid] ?? [];
      const idx = wins.findIndex((w) => w.windowIndex === command.windowIndex);
      if (idx >= 0) {
        const w = wins[idx];
        if (w === undefined) {
          throw new Error('influence window missing after index check');
        }
        const updated = {
          ...w,
          [field]: (w[field] ?? 0) + delta,
        };
        nextInfluence = {
          ...nextInfluence,
          windows: {
            ...nextInfluence.windows,
            [fid]: [...wins.slice(0, idx), updated, ...wins.slice(idx + 1)],
          },
        };
      } else {
        const nw: import('@hoop-rush/data-contracts').SeasonInfluenceWindowState =
          field === 'tradeCashSent'
            ? { windowIndex: command.windowIndex, tradeCashSent: delta }
            : { windowIndex: command.windowIndex, tradeCashReceived: delta };
        nextInfluence = {
          ...nextInfluence,
          windows: { ...nextInfluence.windows, [fid]: [...wins, nw] },
        };
      }
    };
    updateWindowCash(sender, 'tradeCashSent', amount);
    if (creditTo) updateWindowCash(creditTo, 'tradeCashReceived', amount);
    nextTransactions.push(
      seasonTransactionEntry({
        transactionId: `txn-trade-cash-sent-${command.commandId}`,
        commandId: command.commandId,
        franchiseId: sender,
        type: 'trade-cash-sent',
        blockIndex: null,
        appliedAtStateRevision: run.stateRevision + 1,
        payload: { amount, toFranchiseId: command.toFranchiseId },
        explanation: `Trade cash sent ${String(amount)}`,
      }),
    );
    if (creditTo) {
      nextTransactions.push(
        seasonTransactionEntry({
          transactionId: `txn-trade-cash-received-${command.commandId}`,
          commandId: command.commandId,
          franchiseId: creditTo,
          type: 'trade-cash-received',
          blockIndex: null,
          appliedAtStateRevision: run.stateRevision + 1,
          payload: { amount, fromFranchiseId: sender },
          explanation: `Trade cash received ${String(amount)}`,
        }),
      );
    }
  }
  const tradeState = run.trade;
  if (!tradeState) {
    throw new Error('trade command requires an open trade window');
  }
  const nextTrade: import('@hoop-rush/data-contracts').SeasonTradeState = {
    ...tradeState,
    windows: tradeState.windows.map((w) => (w.windowIndex === command.windowIndex ? nextWin : w)),
  };
  const nextRunBase = {
    ...run,
    trade: nextTrade,
    influence: nextInfluence,
    transactions: nextTransactions,
  };
  const next = advanceRunState(nextRunBase);
  return {
    result: {
      command: 'submit-trade-proposal',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        windowIndex: command.windowIndex,
        inquiryId: inquiryId,
        proposalId: evalResult.proposal.proposalId,
        isOverpay: isOverpayGift,
        rawRatio: consequenceFacts.rawRatio,
        adjustedRatio: consequenceFacts.adjustedRatio,
      },
    },
    run: next,
    pending: null,
  };
}
function handleRespondToTradeCounter(
  command: SeasonRespondToTradeCounterCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const economy = economyRunOf(context);
  const run = economy;
  const respondPending = pendingBlockRejectionOf(context);
  if (respondPending !== null) {
    return rejectedCommand(
      'respond-to-trade-counter',
      command.commandId,
      respondPending,
      run,
      context.pending,
    );
  }
  const win = run.trade?.windows.find((w) => w.windowIndex === command.windowIndex);
  if (!win) {
    return rejectedRespondToTradeCounter(
      command,
      {
        code: 'window-not-open',
        franchiseId: null,
        windowIndex: command.windowIndex,
      },
      run,
    );
  }
  const negotiation = win.negotiations?.find((n) => n.inquiryId === command.inquiryId);
  if (!negotiation) {
    return rejectedRespondToTradeCounter(
      command,
      {
        code: 'trade-negotiations-closed',
        windowIndex: command.windowIndex,
      },
      run,
    );
  }
  if (negotiation.exchangeCount >= 3) {
    return rejectedRespondToTradeCounter(
      command,
      {
        code: 'trade-exchange-limit',
        windowIndex: command.windowIndex,
        inquiryId: command.inquiryId,
        exchangeCount: negotiation.exchangeCount,
      },
      run,
    );
  }
  if (
    negotiation.status === 'accepted' ||
    negotiation.status === 'declined' ||
    negotiation.status === 'walked-away' ||
    negotiation.status === 'expired'
  ) {
    return rejectedRespondToTradeCounter(
      command,
      {
        code: 'trade-negotiations-closed',
        windowIndex: command.windowIndex,
      },
      run,
    );
  }
  if (!command.accept) {
    const declinedNegotiation: import('@hoop-rush/data-contracts').SeasonTradeNegotiation = {
      ...negotiation,
      status: 'declined',
      exchangeCount: negotiation.exchangeCount + 1,
      exchanges: [
        ...negotiation.exchanges,
        {
          exchangeIndex: negotiation.exchangeCount + 1,
          kind: 'ai-final',
          proposalId: null,
          proposalFingerprint: null,
          responseCause: 'close-needs-more-value',
          atStateRevision: run.stateRevision,
        },
      ],
      finalReason: 'close-needs-more-value',
      activeProposalId: null,
    };
    const declinedWin: import('@hoop-rush/data-contracts').SeasonTradeWindowState = {
      ...win,
      activeInquiryId: null,
      negotiations: (win.negotiations ?? []).map((n) =>
        n.inquiryId === command.inquiryId ? declinedNegotiation : n,
      ),
    };
    const declinedTradeState = run.trade;
    if (!declinedTradeState) {
      throw new Error('trade command requires an open trade window');
    }
    const declinedTrade: import('@hoop-rush/data-contracts').SeasonTradeState = {
      ...declinedTradeState,
      windows: declinedTradeState.windows.map((w) =>
        w.windowIndex === command.windowIndex ? declinedWin : w,
      ),
    };
    const declinedNext = advanceRunState({ ...run, trade: declinedTrade });
    return {
      result: {
        command: 'respond-to-trade-counter',
        result: {
          status: 'accepted',
          commandId: command.commandId,
          windowIndex: command.windowIndex,
          inquiryId: command.inquiryId,
        },
      },
      run: declinedNext,
      pending: null,
    };
  }
  const agreed = resolveNegotiationPackage(negotiation);
  if (agreed === null) {
    return rejectedRespondToTradeCounter(
      command,
      {
        code: 'trade-negotiations-closed',
        windowIndex: command.windowIndex,
      },
      run,
    );
  }
  const humanFranchiseId = negotiation.fromFranchiseId;
  const partnerFranchiseId = negotiation.toFranchiseId;
  const rosterById = new Map(
    run.rosters.flatMap((roster) =>
      roster.players.map((player) => [player.playerVersionId, roster.franchiseId]),
    ),
  );
  const ownershipById = new Map(
    run.ownership.map((row) => [row.playerVersionId, row.ownerFranchiseId]),
  );
  const conflictIds: string[] = [];
  for (const id of agreed.outgoing) {
    if (rosterById.get(id) !== humanFranchiseId || ownershipById.get(id) !== humanFranchiseId)
      conflictIds.push(id);
  }
  for (const id of agreed.incoming) {
    if (rosterById.get(id) !== partnerFranchiseId || ownershipById.get(id) !== partnerFranchiseId)
      conflictIds.push(id);
  }
  if (conflictIds.length > 0) {
    const rejection: SeasonTradeNegotiationConflictRejection = {
      code: 'trade-negotiation-conflict',
      windowIndex: command.windowIndex,
      inquiryId: command.inquiryId,
      playerVersionIds: conflictIds,
    };
    return rejectedRespondToTradeCounter(command, rejection, run);
  }
  if (context.catalog !== undefined) {
    const facts = seasonTradeCatalogFactsOf(context.catalog);
    const rosterIdsOf = (franchiseId: string): string[] =>
      run.rosters
        .find((roster) => roster.franchiseId === franchiseId)
        ?.players.map((player) => player.playerVersionId) ?? [];
    const seedPath = [
      'trades',
      'window',
      String(command.windowIndex),
      'negotiation',
      command.inquiryId,
    ];
    const filled = fillTradeBackfill({
      catalog: context.catalog,
      run,
      toFranchiseId: humanFranchiseId,
      fromFranchiseId: partnerFranchiseId,
      toIds: [
        ...rosterIdsOf(humanFranchiseId).filter((id) => !agreed.outgoing.includes(id)),
        ...agreed.incoming,
      ],
      fromIds: [
        ...rosterIdsOf(partnerFranchiseId).filter((id) => !agreed.incoming.includes(id)),
        ...agreed.outgoing,
      ],
      seed: tradeOfferBackfillSeed(run.rootSeed, seedPath),
    });
    const reasons: string[] = [];
    if (filled === null) {
      reasons.push('trade leaves a roster below ten players with no backfill available');
    } else {
      for (const [franchiseId, after] of [
        [humanFranchiseId, filled.toIdsFilled],
        [partnerFranchiseId, filled.fromIdsFilled],
      ] as const) {
        for (const reason of tradeRosterLegalityReasons(after, facts)) {
          reasons.push(`${franchiseId}: ${reason}`);
        }
      }
    }
    if (reasons.length > 0) {
      const rejection: SeasonTradeNegotiationIllegalRejection = {
        code: 'trade-negotiation-illegal',
        windowIndex: command.windowIndex,
        inquiryId: command.inquiryId,
        reasons,
      };
      return rejectedRespondToTradeCounter(command, rejection, run);
    }
  } else {
    const rejection: SeasonTradeNegotiationIllegalRejection = {
      code: 'trade-negotiation-illegal',
      windowIndex: command.windowIndex,
      inquiryId: command.inquiryId,
      reasons: ['the draft catalog is unavailable so the final rosters cannot be checked'],
    };
    return rejectedRespondToTradeCounter(command, rejection, run);
  }
  const syntheticOffer: import('@hoop-rush/data-contracts').SeasonTradeOffer = {
    offerId: (negotiation.activeProposalId ?? `prop-${'0'.repeat(32)}`).replace(/^prop-/, 'off-'),
    windowIndex: command.windowIndex,
    seedPath: ['trades', 'window', String(command.windowIndex), 'negotiation', command.inquiryId],
    toFranchiseId: franchiseIdSchema.parse(humanFranchiseId),
    fromFranchiseId: franchiseIdSchema.parse(partnerFranchiseId),
    outgoingPlayerVersionIds: agreed.outgoing,
    incomingPlayerVersionIds: agreed.incoming,
    outgoingHealth: agreed.outgoing.map((id) => seasonTradePlayerHealthFacts(run.health, id)),
    incomingHealth: agreed.incoming.map((id) => seasonTradePlayerHealthFacts(run.health, id)),
    valueBand: { ratioBasisPoints: 1000, band: '80-120', qualified: true },
    roleFit: { outgoingRoles: [], incomingRoles: [], notes: `negotiation ${command.inquiryId}` },
    rosterNeedFacts: {
      outgoingDepth: 0,
      incomingDepth: 0,
      notes: `negotiation ${command.inquiryId}`,
    },
    projectedRotationChanges: `negotiation ${command.inquiryId} accepted`,
    projectedChemistryDisruption: { removedPairs: 0, newPairs: 0 },
    status: 'accepted',
  };
  const applied = applySeasonTrade(run, syntheticOffer, context.catalog, {
    commandId: command.commandId,
  });
  const acceptedNegotiation: import('@hoop-rush/data-contracts').SeasonTradeNegotiation = {
    ...negotiation,
    status: 'accepted',
    exchangeCount: negotiation.exchangeCount + 1,
    exchanges: [
      ...negotiation.exchanges,
      {
        exchangeIndex: negotiation.exchangeCount + 1,
        kind: 'ai-final',
        proposalId: null,
        proposalFingerprint: null,
        responseCause: 'acceptable',
        atStateRevision: run.stateRevision,
      },
    ],
    finalReason: 'acceptable',
    activeProposalId: null,
  };
  const appliedWin: import('@hoop-rush/data-contracts').SeasonTradeWindowState = {
    ...win,
    activeInquiryId: null,
    negotiations: (win.negotiations ?? []).map((n) =>
      n.inquiryId === command.inquiryId ? acceptedNegotiation : n,
    ),
  };
  const appliedTradeState = applied.run.trade;
  if (!appliedTradeState) {
    throw new Error('trade command requires an open trade window');
  }
  const appliedTrade: import('@hoop-rush/data-contracts').SeasonTradeState = {
    ...appliedTradeState,
    windows: appliedTradeState.windows.map((w) =>
      w.windowIndex === command.windowIndex ? appliedWin : w,
    ),
  };
  const next = advanceRunState({ ...applied.run, trade: appliedTrade });
  return {
    result: {
      command: 'respond-to-trade-counter',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        windowIndex: command.windowIndex,
        inquiryId: command.inquiryId,
        rosterChanges: applied.rosterChanges,
      },
    },
    run: next,
    pending: null,
  };
}
function handleWalkAwayFromTrade(
  command: SeasonWalkAwayFromTradeCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const economy = economyRunOf(context);
  const run = economy;
  const walkAwayPending = pendingBlockRejectionOf(context);
  if (walkAwayPending !== null) {
    return rejectedCommand(
      'walk-away-from-trade',
      command.commandId,
      walkAwayPending,
      run,
      context.pending,
    );
  }
  const win = run.trade?.windows.find((w) => w.windowIndex === command.windowIndex);
  if (!win) {
    return rejectedWalkAwayFromTrade(
      command,
      {
        code: 'window-not-open',
        franchiseId: null,
        windowIndex: command.windowIndex,
      },
      run,
    );
  }
  const negotiation = win.negotiations?.find((n) => n.inquiryId === command.inquiryId);
  if (!negotiation) {
    return rejectedWalkAwayFromTrade(
      command,
      {
        code: 'window-not-open',
        franchiseId: null,
        windowIndex: command.windowIndex,
      },
      run,
    );
  }
  const nextNegotiation: import('@hoop-rush/data-contracts').SeasonTradeNegotiation = {
    ...negotiation,
    status: 'walked-away',
    finalReason: 'negotiations-closed',
    activeProposalId: null,
  };
  const nextWin: import('@hoop-rush/data-contracts').SeasonTradeWindowState = {
    ...win,
    activeInquiryId: null,
    negotiations: (win.negotiations ?? []).map((n) =>
      n.inquiryId === command.inquiryId ? nextNegotiation : n,
    ),
  };
  const tradeState = run.trade;
  if (!tradeState) {
    throw new Error('trade command requires an open trade window');
  }
  const nextTrade: import('@hoop-rush/data-contracts').SeasonTradeState = {
    ...tradeState,
    windows: tradeState.windows.map((w) => (w.windowIndex === command.windowIndex ? nextWin : w)),
  };
  const next = advanceRunState({ ...run, trade: nextTrade });
  return {
    result: {
      command: 'walk-away-from-trade',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        windowIndex: command.windowIndex,
        inquiryId: command.inquiryId,
      },
    },
    run: next,
    pending: null,
  };
}
function handlePurchaseTradeInquiry(
  command: SeasonPurchaseTradeInquiryCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const economy = economyRunOf(context);
  const run = economy;
  const purchasePending = pendingBlockRejectionOf(context);
  if (purchasePending !== null) {
    return rejectedCommand(
      'purchase-trade-inquiry',
      command.commandId,
      purchasePending,
      run,
      context.pending,
    );
  }
  const win = run.trade?.windows.find((w) => w.windowIndex === command.windowIndex);
  if (!win || win.status !== 'open') {
    return rejectedPurchaseTradeInquiry(
      command,
      {
        code: 'window-not-open',
        franchiseId: null,
        windowIndex: command.windowIndex,
      },
      run,
    );
  }
  if (win.purchasedInquiryUsed) {
    return rejectedPurchaseTradeInquiry(
      command,
      {
        code: 'already-spent',
        franchiseId: franchiseIdSchema.parse(context.humanFranchiseId ?? ''),
        windowIndex: command.windowIndex,
      },
      run,
    );
  }
  const allowance =
    win.inquiryAllowance ??
    baseInquiryAllowanceOf(
      normalizeEvolutionState((run as { evolution?: unknown }).evolution).frontOffice
        ?.executiveId ?? null,
    );
  if (allowance >= 5) {
    return rejectedPurchaseTradeInquiry(
      command,
      {
        code: 'trade-inquiry-cap',
        windowIndex: command.windowIndex,
        inquiriesUsed: win.negotiations?.length ?? 0,
        allowance,
      },
      run,
    );
  }
  const human =
    context.humanFranchiseId ??
    run.league.teams.find((t) => t.control === 'human')?.franchiseId ??
    '';
  const humanFid = franchiseIdSchema.parse(human);
  const evoExec =
    normalizeEvolutionState((run as { evolution?: unknown }).evolution).frontOffice?.executiveId ??
    null;
  const purchaseCost = purchasedInquiryCostOf(evoExec);
  const balance = run.influence.balances[humanFid] ?? 0;
  if (balance - purchaseCost < SEASON_INFLUENCE_FLOOR) {
    return rejectedPurchaseTradeInquiry(
      command,
      {
        code: 'insufficient-balance',
        franchiseId: humanFid,
        balance,
        requestedDelta: -purchaseCost,
        floor: SEASON_INFLUENCE_FLOOR,
      },
      run,
    );
  }
  const spend = applySeasonInfluenceSpend({
    influence: run.influence,
    franchiseId: humanFid,
    source: 'trade-inquiry-purchase',
    requestedDelta: -purchaseCost,
    blockIndex: null,
    commandId: command.commandId,
    explanation: `Purchase trade inquiry window ${String(command.windowIndex)}`,
  });
  const nextWin: import('@hoop-rush/data-contracts').SeasonTradeWindowState = {
    ...win,
    inquiryAllowance: allowance + 1,
    purchasedInquiryUsed: true,
  };
  const tradeState = run.trade;
  if (!tradeState) {
    throw new Error('trade command requires an open trade window');
  }
  const nextTrade: import('@hoop-rush/data-contracts').SeasonTradeState = {
    ...tradeState,
    windows: tradeState.windows.map((w) => (w.windowIndex === command.windowIndex ? nextWin : w)),
  };
  const nextRunBase = {
    ...run,
    trade: nextTrade,
    influence: spend.influence,
    transactions: [
      ...run.transactions,
      seasonTransactionEntry({
        transactionId: `txn-trade-inquiry-purchase-${command.commandId}`,
        commandId: command.commandId,
        franchiseId: human,
        type: 'trade-inquiry-purchase',
        blockIndex: null,
        appliedAtStateRevision: run.stateRevision + 1,
        payload: { windowIndex: command.windowIndex },
        explanation: `Purchased trade inquiry for window ${String(command.windowIndex)}`,
      }),
    ],
  };
  const next = advanceRunState(nextRunBase);
  return {
    result: {
      command: 'purchase-trade-inquiry',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        windowIndex: command.windowIndex,
      },
    },
    run: next,
    pending: null,
  };
}
function handleSelectFrontOffice(
  command: SeasonSelectFrontOfficeCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  const evo = normalizeEvolutionState((run as unknown as { evolution?: unknown }).evolution);
  if (evo.frontOffice !== null) {
    return {
      result: {
        command: 'select-front-office',
        result: {
          status: 'rejected',
          commandId: command.commandId,
          rejection: { code: 'front-office-already-selected' },
        },
      },
      run,
      pending: null,
    };
  }
  if (run.cursor.completedRounds !== 0) {
    return {
      result: {
        command: 'select-front-office',
        result: {
          status: 'rejected',
          commandId: command.commandId,
          rejection: { code: 'front-office-too-late', completedRounds: run.cursor.completedRounds },
        },
      },
      run,
      pending: null,
    };
  }
  if (!SEASON_FRONT_OFFICE_CATALOG.some((entry) => entry.id === command.executiveId)) {
    return {
      result: {
        command: 'select-front-office',
        result: {
          status: 'rejected',
          commandId: command.commandId,
          rejection: {
            code: 'front-office-invalid',
            executiveId: String((command as { executiveId?: unknown }).executiveId),
          },
        },
      },
      run,
      pending: null,
    };
  }
  const nextEvo: SeasonEvolutionState = {
    ...evo,
    frontOffice: {
      executiveId: command.executiveId,
      version: SEASON_FRONT_OFFICE_VERSION,
      selectedByCommandId: command.commandId,
      selectedAtStateRevision: run.stateRevision + 1,
    },
  };
  const next = advanceRunState({ ...run, evolution: nextEvo });
  return {
    result: {
      command: 'select-front-office',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        executiveId: command.executiveId,
      },
    },
    run: next,
    pending: null,
  };
}
function handleSelectCourtInnovation(
  command: SeasonSelectCourtInnovationCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  const evo = normalizeEvolutionState((run as unknown as { evolution?: unknown }).evolution);
  if (!evo.discovery) {
    return {
      result: {
        command: 'select-court-innovation',
        result: {
          status: 'rejected',
          commandId: command.commandId,
          rejection: { code: 'innovation-not-discovered' },
        },
      },
      run,
      pending: null,
    };
  }
  const humanFid =
    context.humanFranchiseId ??
    run.league.teams.find((t) => t.control === 'human')?.franchiseId ??
    null;
  if (
    humanFid !== null &&
    (evo.selections as unknown as Record<string, unknown>)[humanFid] !== undefined
  ) {
    return {
      result: {
        command: 'select-court-innovation',
        result: {
          status: 'rejected',
          commandId: command.commandId,
          rejection: { code: 'innovation-already-selected' },
        },
      },
      run,
      pending: null,
    };
  }
  if (!SEASON_COURT_INNOVATION_CATALOG.some((entry) => entry.id === command.innovationId)) {
    return {
      result: {
        command: 'select-court-innovation',
        result: {
          status: 'rejected',
          commandId: command.commandId,
          rejection: {
            code: 'innovation-invalid',
            innovationId: String((command as { innovationId?: unknown }).innovationId),
          },
        },
      },
      run,
      pending: null,
    };
  }
  const targetFid =
    humanFid ?? Object.keys(evo.selections)[0] ?? run.league.teams[0]?.franchiseId ?? 'unknown';
  const nextEvo: SeasonEvolutionState = {
    ...evo,
    selections: {
      ...evo.selections,
      [targetFid]: {
        franchiseId: targetFid as never,
        innovationId: command.innovationId,
        version: SEASON_COURT_INNOVATION_VERSION,
        selectedByCommandId: command.commandId,
        aiSelected: false,
        inputDigest: null,
      },
    },
  };
  const next = advanceRunState({ ...run, evolution: nextEvo });
  return {
    result: {
      command: 'select-court-innovation',
      result: {
        status: 'accepted',
        commandId: command.commandId,
        innovationId: command.innovationId,
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
    franchiseId: franchiseIdSchema.parse(franchiseId),
    balance,
    requestedDelta,
    floor: SEASON_INFLUENCE_FLOOR,
  };
}
function handleSpendInfluence(
  command: SeasonSpendInfluenceCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null, context);
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
    if (balance + -1 < SEASON_INFLUENCE_FLOOR) {
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
  const rehabCost = rehabPriceOf(
    normalizeEvolutionState((run as { evolution?: unknown }).evolution).frontOffice?.executiveId ??
      null,
  );
  if (balance + -rehabCost < SEASON_INFLUENCE_FLOOR) {
    return rejectedSpend(
      command,
      insufficientBalanceOf(command.franchiseId, balance, -rehabCost),
      run,
    );
  }
  const outcome = rollSeasonRehabOutcome(run.rootSeed, injuryId);
  const health = applyRiskyRehabOutcome(run.health, injuryId, outcome);
  const result = applySeasonInfluenceSpend({
    influence: run.influence,
    franchiseId: command.franchiseId,
    source: 'risky-rehab',
    requestedDelta: -rehabCost,
    blockIndex: null,
    commandId: command.commandId,
    explanation: `Spent ${String(rehabCost)} Influence on risky rehab for ${injuryId} (${outcome})`,
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
    explanation: `Spent ${String(rehabCost)} Influence on risky rehab for ${injuryId} (${outcome})`,
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
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  const acceptPending = pendingBlockRejectionOf(context);
  if (acceptPending !== null) {
    return rejectedCommand(
      'accept-trade-offer',
      command.commandId,
      acceptPending,
      run,
      context.pending,
    );
  }
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
    const filled = fillTradeBackfill({
      catalog: context.catalog,
      run,
      toFranchiseId: offer.toFranchiseId,
      fromFranchiseId: offer.fromFranchiseId,
      toIds: [
        ...rosterIdsOf(offer.toFranchiseId).filter(
          (id) => !offer.outgoingPlayerVersionIds.includes(id),
        ),
        ...offer.incomingPlayerVersionIds,
      ],
      fromIds: [
        ...rosterIdsOf(offer.fromFranchiseId).filter(
          (id) => !offer.incomingPlayerVersionIds.includes(id),
        ),
        ...offer.outgoingPlayerVersionIds,
      ],
      seed: tradeOfferBackfillSeed(run.rootSeed, offer.seedPath),
    });
    const reasons: string[] = [];
    if (filled === null) {
      reasons.push('trade leaves a roster below ten players with no backfill available');
    } else {
      for (const [franchiseId, after] of [
        [offer.toFranchiseId, filled.toIdsFilled],
        [offer.fromFranchiseId, filled.fromIdsFilled],
      ] as const) {
        for (const reason of tradeRosterLegalityReasons(after, facts)) {
          reasons.push(`${franchiseId}: ${reason}`);
        }
      }
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
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  const declinePending = pendingBlockRejectionOf(context);
  if (declinePending !== null) {
    return rejectedCommand(
      'decline-trade-offer',
      command.commandId,
      declinePending,
      run,
      context.pending,
    );
  }
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
  const base = baseValidation(command, run, pending, context);
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
  const base = baseValidation(command, run, pending, context);
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
  const base = baseValidation(command, context.run, null, context);
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
  const base = baseValidation(command, context.run, null, context);
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
  const championFranchiseId = current.postseason.championFranchiseId;
  if (stage === 'completed' && championFranchiseId === null) {
    throw new Error(`postseason completed without champion for ${command.commandId}`);
  }
  const completion =
    stage === 'completed' && championFranchiseId !== null
      ? {
          championFranchiseId,
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
  const base = baseValidation(command, context.run, null, context);
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
    const humanFidRehab = franchiseIdSchema.parse(humanFranchiseId);
    const balance = run.influence.balances[humanFidRehab] ?? 0;
    const postseasonRehabCost = rehabPriceOf(
      normalizeEvolutionState((run as { evolution?: unknown }).evolution).frontOffice
        ?.executiveId ?? null,
    );
    if (balance < SEASON_INFLUENCE_FLOOR + postseasonRehabCost) {
      const rejection: SeasonInsufficientRehabResourcesRejection = {
        code: 'insufficient-rehab-resources',
        franchiseId: humanFidRehab,
        balance,
        required: postseasonRehabCost,
      };
      return rejectedSubmit(command, rejection, run);
    }
    const outcome = rollPostseasonRehabOutcome(run.rootSeed, rehabInjuryId);
    health = applyRiskyRehabOutcome(health, rehabInjuryId, outcome);
    const spend = applySeasonInfluenceSpend({
      influence,
      franchiseId: humanFranchiseId,
      source: 'risky-rehab',
      requestedDelta: -postseasonRehabCost,
      blockIndex: null,
      commandId: command.commandId,
      explanation: `Spent ${String(postseasonRehabCost)} Influence on postseason risky rehab for ${rehabInjuryId} (${outcome})`,
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
        explanation: `Spent ${String(postseasonRehabCost)} Influence on postseason risky rehab for ${rehabInjuryId} (${outcome})`,
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
  const base = baseValidation(command, context.run, null, context);
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
  const championFranchiseId = current.postseason.championFranchiseId;
  if (stage === 'completed' && championFranchiseId === null) {
    throw new Error(`postseason completed without champion for ${command.commandId}`);
  }
  const completion =
    stage === 'completed' && championFranchiseId !== null
      ? {
          championFranchiseId,
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
  const base = baseValidation(command, context.run, null, context);
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
  const parsed = seasonRunCommandRejectionSchema.safeParse(error.rejection);
  if (!parsed.success) {
    throw new Error(
      `invalid free-agency rejection ${error.rejection.code}: ${parsed.error.message}`,
    );
  }
  return parsed.data;
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
      command: command.command,
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
  const base = baseValidation(command, context.run, null, context);
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
  const base = baseValidation(command, context.run, null, context);
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
  const base = baseValidation(command, context.run, null, context);
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
        effects: run.effects,
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
  command: SeasonRunCommand | SeasonLegacyRunCommand,
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
    case 'select-gm-identity':
      return handleSelectGmIdentity(command, context);
    case 'select-campaign-opportunity':
      return handleSelectCampaignOpportunity(command, context);
    case 'evolve-gm-campaign':
      return handleEvolveGmCampaign(command, context);
    case 'open-trade-inquiry':
      return handleOpenTradeInquiry(command, context);
    case 'submit-trade-proposal':
      return handleSubmitTradeProposal(command, context);
    case 'respond-to-trade-counter':
      return handleRespondToTradeCounter(command, context);
    case 'walk-away-from-trade':
      return handleWalkAwayFromTrade(command, context);
    case 'purchase-trade-inquiry':
      return handlePurchaseTradeInquiry(command, context);
    case 'buy-sponsor':
      return handleBuySponsor(command, context);
    case 'apply-sponsor':
      return handleApplySponsor(command, context);
    case 'select-front-office':
      return handleSelectFrontOffice(command, context);
    case 'select-court-innovation':
      return handleSelectCourtInnovation(command, context);
    default: {
      const exhaustive: never = command;
      return assertNever(
        exhaustive,
        `unknown season run command ${JSON.stringify(command).slice(0, 128)}`,
      );
    }
  }
}
