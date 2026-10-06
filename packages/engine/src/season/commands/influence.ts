import type {
  SeasonAlreadyRehabbedRejection,
  SeasonAlreadySpentRejection,
  SeasonEvolutionState,
  SeasonInjuryNotActiveRejection,
  SeasonInsufficientBalanceRejection,
  SeasonNoWindowRejection,
  SeasonSelectCourtInnovationCommand,
  SeasonSelectFrontOfficeCommand,
  SeasonSpendInfluenceCommand,
  SeasonWindowNotOpenRejection,
} from '@hoop-rush/data-contracts';
import {
  SEASON_COURT_INNOVATION_CATALOG,
  SEASON_COURT_INNOVATION_VERSION,
  SEASON_FRONT_OFFICE_CATALOG,
  SEASON_FRONT_OFFICE_VERSION,
  franchiseIdSchema,
  normalizeEvolutionState,
} from '@hoop-rush/data-contracts';
import { rehabPriceOf } from '../evolution.ts';
import { SEASON_INFLUENCE_FLOOR, applySeasonInfluenceSpend } from '../influence.ts';
import { applyRiskyRehabOutcome, rollSeasonRehabOutcome } from '../injuries.ts';
import { generatedExtraOfferForSpend } from '../trades.ts';
import { seasonTransactionEntry } from '../transactions.ts';
import {
  SeasonRunCommandNotImplementedError,
  acceptedCommand,
  advanceRunState,
  baseValidation,
  economyRunOf,
  rejectedCommand,
  type SeasonRunCommandContext,
  type SeasonRunCommandOutput,
} from './shared.ts';
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
export function handleSpendInfluence(
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
    return rejectedCommand(command, rejection, run);
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
      return rejectedCommand(command, rejection, run);
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
      return rejectedCommand(command, rejection, run);
    }
    const balance = run.influence.balances[command.franchiseId] ?? 0;
    if (balance + -1 < SEASON_INFLUENCE_FLOOR) {
      return rejectedCommand(command, insufficientBalanceOf(command.franchiseId, balance, -1), run);
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
    return acceptedCommand(
      command,
      {
        franchiseId: command.franchiseId,
        purpose: 'extra-trade-offer',
        ledgerEntry: result.entry,
        generatedOffer,
      },
      next,
      null,
    );
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
    return rejectedCommand(command, rejection, run);
  }
  if (run.influence.rehabs[injuryId] !== undefined) {
    const rejection: SeasonAlreadyRehabbedRejection = { code: 'already-rehabbed', injuryId };
    return rejectedCommand(command, rejection, run);
  }
  const balance = run.influence.balances[command.franchiseId] ?? 0;
  const rehabCost = rehabPriceOf(
    normalizeEvolutionState((run as { evolution?: unknown }).evolution).frontOffice?.executiveId ??
      null,
  );
  if (balance + -rehabCost < SEASON_INFLUENCE_FLOOR) {
    return rejectedCommand(
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
  return acceptedCommand(
    command,
    {
      franchiseId: command.franchiseId,
      purpose: 'risky-rehab',
      ledgerEntry: result.entry,
      generatedOffer: null,
    },
    next,
    null,
  );
}
export function handleSelectFrontOffice(
  command: SeasonSelectFrontOfficeCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  const evo = normalizeEvolutionState((run as unknown as { evolution?: unknown }).evolution);
  if (evo.frontOffice !== null) {
    return rejectedCommand(command, { code: 'front-office-already-selected' }, run);
  }
  if (run.cursor.completedRounds !== 0) {
    return rejectedCommand(
      command,
      { code: 'front-office-too-late', completedRounds: run.cursor.completedRounds },
      run,
    );
  }
  if (!SEASON_FRONT_OFFICE_CATALOG.some((entry) => entry.id === command.executiveId)) {
    return rejectedCommand(
      command,
      {
        code: 'front-office-invalid',
        executiveId: String((command as { executiveId?: unknown }).executiveId),
      },
      run,
    );
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
  return acceptedCommand(
    command,
    {
      executiveId: command.executiveId,
    },
    next,
    null,
  );
}
export function handleSelectCourtInnovation(
  command: SeasonSelectCourtInnovationCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  const evo = normalizeEvolutionState((run as unknown as { evolution?: unknown }).evolution);
  if (!evo.discovery) {
    return rejectedCommand(command, { code: 'innovation-not-discovered' }, run);
  }
  const humanFid =
    context.humanFranchiseId ??
    run.league.teams.find((t) => t.control === 'human')?.franchiseId ??
    null;
  if (
    humanFid !== null &&
    (evo.selections as unknown as Record<string, unknown>)[humanFid] !== undefined
  ) {
    return rejectedCommand(command, { code: 'innovation-already-selected' }, run);
  }
  if (!SEASON_COURT_INNOVATION_CATALOG.some((entry) => entry.id === command.innovationId)) {
    return rejectedCommand(
      command,
      {
        code: 'innovation-invalid',
        innovationId: String((command as { innovationId?: unknown }).innovationId),
      },
      run,
    );
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
  return acceptedCommand(
    command,
    {
      innovationId: command.innovationId,
    },
    next,
    null,
  );
}
