import type {
  EraSimulationProfile,
  SeasonAcceptTradeOfferResult,
  SeasonAdvancePostseasonResult,
  SeasonApplySponsorResult,
  SeasonBuySponsorResult,
  SeasonDeclareFreeAgentInterestResult,
  SeasonDeclineTradeOfferResult,
  SeasonDraftCatalog,
  SeasonDuplicateCommandRejection,
  SeasonEffectsState,
  SeasonEvolveGmCampaignCommand,
  SeasonEvolveGmCampaignResult,
  SeasonEvolutionState,
  SeasonFastForwardPostseasonResult,
  SeasonForfeitInterruptedGameResult,
  SeasonFreeAgencyIndex,
  SeasonGameSummary,
  SeasonLegacyRunCommand,
  SeasonOpenTradeInquiryResult,
  SeasonParticipantId,
  SeasonPendingBlockCandidate,
  SeasonPostseasonSummary,
  SeasonPurchaseTradeInquiryResult,
  SeasonResolveFreeAgentMarketResult,
  SeasonRespondToTradeCounterResult,
  SeasonResumeSeasonBlockResult,
  SeasonRosterTargets,
  SeasonRun,
  SeasonRunAuthority,
  SeasonRunCommand,
  SeasonRunCommandRejection,
  SeasonRunMismatchRejection,
  SeasonRunStage,
  SeasonSelectBlockObjectiveCommand,
  SeasonSelectBlockObjectiveResult,
  SeasonSelectCampaignOpportunityCommand,
  SeasonSelectCampaignOpportunityResult,
  SeasonSelectCourtInnovationResult,
  SeasonSelectFrontOfficeResult,
  SeasonSelectGmIdentityCommand,
  SeasonSelectGmIdentityResult,
  SeasonSkipFreeAgentMarketResult,
  SeasonSpendInfluenceResult,
  SeasonSpectatePostseasonGameResult,
  SeasonStaleStateRejection,
  SeasonStartPostseasonResult,
  SeasonSubmitPostseasonRotationResult,
  SeasonSubmitTradeProposalResult,
  SeasonWalkAwayFromTradeResult,
} from '@hoop-rush/data-contracts';
import { authorityForFranchise, franchiseForParticipant } from '@hoop-rush/data-contracts';
import { deriveSeasonAwards } from '../awards.ts';
import type { SeasonPostseasonGameResolver, SeasonPostseasonRankingsFn } from '../postseason.ts';
import { seasonRunStateDigest, seasonRunStateDigestFactsOf } from '../state-digest.ts';
import type { SeasonEconomyRun } from '../trades.ts';
import { seasonEconomyRunOf } from '../trade-valuation.ts';
export interface SeasonRunCommandContext {
  run: SeasonRun;
  pending: SeasonPendingBlockCandidate | null;
  humanFranchiseId: string | null;
  authority?: SeasonRunAuthority;
  actorParticipantId?: SeasonParticipantId | null;
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
    }
  | {
      command: 'select-court-innovation';
      result: SeasonSelectCourtInnovationResult;
    };
export interface SeasonRunCommandOutput {
  result: SeasonRunCommandResult;
  run: SeasonRun;
  pending: SeasonPendingBlockCandidate | null;
  postseasonSummaries?: SeasonPostseasonSummary[];
}
export type SeasonRunCommandInput = SeasonRunCommand | SeasonLegacyRunCommand;
export class SeasonRunCommandNotImplementedError extends Error {
  readonly command: string;
  constructor(command: string) {
    super(`season run command handler not implemented yet: ${command}`);
    this.name = 'SeasonRunCommandNotImplementedError';
    this.command = command;
  }
}
type AcceptedCommandPayloads = {
  [K in SeasonRunCommandResult['command']]: Omit<
    Extract<Extract<SeasonRunCommandResult, { command: K }>['result'], { status: 'accepted' }>,
    'status' | 'commandId'
  >;
};
export function acceptedCommand<C extends SeasonRunCommandResult['command']>(
  command: { command: C; commandId: string },
  payload: AcceptedCommandPayloads[C],
  run: SeasonRun,
  pending: SeasonPendingBlockCandidate | null,
  postseasonSummaries?: SeasonPostseasonSummary[],
): SeasonRunCommandOutput {
  const output: SeasonRunCommandOutput = {
    result: {
      command: command.command,
      result: { status: 'accepted', commandId: command.commandId, ...payload },
    } as unknown as SeasonRunCommandResult,
    run,
    pending,
  };
  if (postseasonSummaries !== undefined) {
    output.postseasonSummaries = postseasonSummaries;
  }
  return output;
}
export function economyRunOf(context: SeasonRunCommandContext): SeasonEconomyRun {
  return seasonEconomyRunOf(context.run, context.effects);
}
export function runStateDigestFactsOf(
  run: SeasonEconomyRun,
): Parameters<typeof seasonRunStateDigest>[0] {
  return seasonRunStateDigestFactsOf(run, run.effects);
}
export function authorityOfContext(
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
export function advanceRunState(run: SeasonEconomyRun): SeasonRun {
  const next = { ...run, stateRevision: run.stateRevision + 1, stateDigest: '' };
  return { ...next, stateDigest: seasonRunStateDigest(runStateDigestFactsOf(next)) };
}
export function deriveAwardsIfNeeded(
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
export function commandAlreadyRecorded(run: SeasonRun, commandId: string): boolean {
  if (run.checkpointState !== null && run.checkpointState.commandId === commandId) return true;
  if (run.influence.ledger.some((entry) => entry.commandId === commandId)) return true;
  if (run.transactions.some((entry) => entry.commandId === commandId)) return true;
  for (const selection of Object.values(run.objectives.selections)) {
    if (selection.selectedByCommandId === commandId) return true;
  }
  const evo = (run as { evolution?: SeasonEvolutionState | null }).evolution;
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
export function baseValidation(
  command: SeasonRunCommandInput,
  run: SeasonRun,
  pending: SeasonPendingBlockCandidate | null,
  context?: SeasonRunCommandContext,
): SeasonRunCommandOutput | null {
  if (command.command === 'submit-season-block') {
    throw new SeasonRunCommandNotImplementedError(
      'submit-season-block is handled by the block pipeline, not the run command dispatch',
    );
  }
  if (command.runId !== run.runId) {
    const rejection: SeasonRunMismatchRejection = {
      code: 'run-mismatch',
      expectedRunId: run.runId,
    };
    return rejectedCommand(command, rejection, run, pending);
  }
  if (commandAlreadyRecorded(run, command.commandId)) {
    const rejection: SeasonDuplicateCommandRejection = {
      code: 'duplicate-command',
      commandId: command.commandId,
    };
    return rejectedCommand(command, rejection, run, pending);
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
    return rejectedCommand(command, rejection, run, pending);
  }
  const authority = authorityOfContext(context, run);
  const actorPid = context?.actorParticipantId ?? null;
  const actorFid = context?.actorFranchiseId ?? null;
  if (authority !== null) {
    if (authority.kind === 'season-multiplayer') {
      if (actorPid !== null) {
        const expectedFid = franchiseForParticipant(authority, actorPid);
        if (expectedFid === null || (actorFid !== null && expectedFid !== actorFid)) {
          return rejectedCommand(
            command,
            {
              code: 'run-mismatch',
              expectedRunId: run.runId,
            },
            run,
            pending,
          );
        }
      } else if (actorFid !== null) {
        const pid = authorityForFranchise(authority, actorFid);
        if (pid === null) {
          return rejectedCommand(
            command,
            {
              code: 'run-mismatch',
              expectedRunId: run.runId,
            },
            run,
            pending,
          );
        }
      }
      const directFid =
        'franchiseId' in command && typeof command.franchiseId === 'string'
          ? command.franchiseId
          : undefined;
      if (directFid !== undefined && actorFid !== null && directFid !== actorFid) {
        return rejectedCommand(
          command,
          {
            code: 'run-mismatch',
            expectedRunId: run.runId,
          },
          run,
          pending,
        );
      }
    } else {
      if (
        actorFid !== null &&
        authority.soloFranchiseId !== null &&
        actorFid !== authority.soloFranchiseId
      ) {
        return rejectedCommand(
          command,
          {
            code: 'run-mismatch',
            expectedRunId: run.runId,
          },
          run,
          pending,
        );
      }
      const directFid =
        'franchiseId' in command && typeof command.franchiseId === 'string'
          ? command.franchiseId
          : undefined;
      if (directFid !== undefined && actorFid !== null && directFid !== actorFid) {
        return rejectedCommand(
          command,
          {
            code: 'run-mismatch',
            expectedRunId: run.runId,
          },
          run,
          pending,
        );
      }
    }
  } else if (context?.actorFranchiseId) {
    const targetFranchiseId =
      'franchiseId' in command && typeof command.franchiseId === 'string'
        ? command.franchiseId
        : null;
    if (targetFranchiseId !== null && targetFranchiseId !== context.actorFranchiseId) {
      return rejectedCommand(
        command,
        {
          code: 'run-mismatch',
          expectedRunId: run.runId,
        },
        run,
        pending,
      );
    }
  }
  return null;
}
export function rejectedCommand(
  command: SeasonRunCommandInput,
  rejection: SeasonRunCommandRejection,
  run: SeasonRun,
  pending: SeasonPendingBlockCandidate | null = null,
): SeasonRunCommandOutput {
  return {
    result: {
      command: command.command,
      result: { status: 'rejected', commandId: command.commandId, rejection },
    } as SeasonRunCommandResult,
    run,
    pending,
  };
}
export type RetiredSeasonRunCommand =
  | SeasonSelectBlockObjectiveCommand
  | SeasonSelectGmIdentityCommand
  | SeasonSelectCampaignOpportunityCommand
  | SeasonEvolveGmCampaignCommand;
export function handleRetiredSeasonCommand(
  command: RetiredSeasonRunCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const pending = command.command === 'select-block-objective' ? null : context.pending;
  const base = baseValidation(command, context.run, pending, context);
  if (base !== null) return base;
  return rejectedCommand(command, { code: 'retired' }, economyRunOf(context));
}
