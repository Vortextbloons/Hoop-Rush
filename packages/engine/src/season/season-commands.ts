import {
  SeasonRunCommandNotImplementedError,
  type SeasonRunCommandContext,
  type SeasonRunCommandInput,
  type SeasonRunCommandOutput,
  type SeasonRunCommandResult,
} from './commands/shared.ts';
import { handleRetiredSeasonCommand } from './commands/retired.ts';
import { handleApplySponsor, handleBuySponsor } from './commands/sponsors.ts';
import {
  handleAcceptTradeOffer,
  handleDeclineTradeOffer,
  handleOpenTradeInquiry,
  handlePurchaseTradeInquiry,
  handleRespondToTradeCounter,
  handleSubmitTradeProposal,
  handleWalkAwayFromTrade,
} from './commands/trades.ts';
import {
  handleSelectCourtInnovation,
  handleSelectFrontOffice,
  handleSpendInfluence,
} from './commands/influence.ts';
import {
  handleDeclareFreeAgentInterest,
  handleResolveFreeAgentMarket,
  handleSkipFreeAgentMarket,
} from './commands/free-agency.ts';
import {
  handleAdvancePostseason,
  handleFastForwardPostseason,
  handleSpectatePostseasonGame,
  handleStartPostseason,
  handleSubmitPostseasonRotation,
} from './commands/postseason.ts';
import { handleForfeitInterruptedGame, handleResumeSeasonBlock } from './commands/blocks.ts';
export { SeasonRunCommandNotImplementedError };
export type { SeasonRunCommandContext, SeasonRunCommandResult, SeasonRunCommandOutput };
export { SeasonFreeAgencyFactsError } from './commands/free-agency.ts';
function dispatchSeasonRunCommand(
  command: SeasonRunCommandInput,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  switch (command.command) {
    case 'select-block-objective':
    case 'select-gm-identity':
    case 'select-campaign-opportunity':
    case 'evolve-gm-campaign':
      return handleRetiredSeasonCommand(command, context);
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
      throw new Error(`unhandled season run command: ${JSON.stringify(exhaustive)}`);
    }
  }
}
export function handleSeasonRunCommand(
  command: SeasonRunCommandInput,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  return dispatchSeasonRunCommand(command, context);
}
