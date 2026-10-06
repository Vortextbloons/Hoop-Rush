import type {
  SeasonDeclareFreeAgentInterestCommand,
  SeasonResolveFreeAgentMarketCommand,
  SeasonRunCommandRejection,
  SeasonSkipFreeAgentMarketCommand,
} from '@hoop-rush/data-contracts';
import { seasonRunCommandRejectionSchema } from '@hoop-rush/data-contracts';
import {
  FreeAgencyValidationRejection,
  applyFreeAgencyDeclaration,
  applyFreeAgencySkip,
  resolveSeasonFreeAgencyWindow,
} from '../free-agency.ts';
import {
  acceptedCommand,
  advanceRunState,
  baseValidation,
  economyRunOf,
  rejectedCommand,
  type SeasonRunCommandContext,
  type SeasonRunCommandOutput,
} from './shared.ts';
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
export function handleDeclareFreeAgentInterest(
  command: SeasonDeclareFreeAgentInterestCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (run.freeAgency.windows.every((window) => window.windowIndex !== command.windowIndex)) {
    return rejectedCommand(
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
      return rejectedCommand(command, freeAgencyRejectionTo(error), run);
    }
    throw error;
  }
  const next = advanceRunState({ ...run, freeAgency: nextFreeAgency });
  return acceptedCommand(
    command,
    {
      franchiseId: command.franchiseId,
      windowIndex: command.windowIndex,
      declaration: command.targets,
    },
    next,
    null,
  );
}
export function handleSkipFreeAgentMarket(
  command: SeasonSkipFreeAgentMarketCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, null, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  if (run.freeAgency.windows.every((window) => window.windowIndex !== command.windowIndex)) {
    return rejectedCommand(
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
      return rejectedCommand(command, freeAgencyRejectionTo(error), run);
    }
    throw error;
  }
  const next = advanceRunState({ ...run, freeAgency: nextFreeAgency });
  return acceptedCommand(
    command,
    {
      franchiseId: command.franchiseId,
      windowIndex: command.windowIndex,
    },
    next,
    null,
  );
}
export function handleResolveFreeAgentMarket(
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
      return rejectedCommand(command, freeAgencyRejectionTo(error), run);
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
  return acceptedCommand(
    command,
    {
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
    next,
    null,
  );
}
