import type {
  SeasonAcceptTradeOfferCommand,
  SeasonAcceptTradeOfferRejection,
  SeasonDeclineTradeOfferCommand,
  SeasonOfferNotOpenRejection,
  SeasonOfferUnknownRejection,
  SeasonOpenTradeInquiryCommand,
  SeasonPendingBlockRejection,
  SeasonPurchaseTradeInquiryCommand,
  SeasonRespondToTradeCounterCommand,
  SeasonSubmitTradeProposalCommand,
  SeasonTradeActiveNegotiationRejection,
  SeasonTradeInquiryCapRejection,
  SeasonTradeNegotiationConflictRejection,
  SeasonTradeNegotiationIllegalRejection,
  SeasonWalkAwayFromTradeCommand,
  SeasonWindowNotOpenRejection,
} from '@hoop-rush/data-contracts';
import {
  franchiseIdSchema,
  normalizeEvolutionState,
  normalizeSponsorGearState,
} from '@hoop-rush/data-contracts';
import { baseInquiryAllowanceOf, purchasedInquiryCostOf } from '../evolution.ts';
import { SEASON_INFLUENCE_FLOOR, applySeasonInfluenceSpend } from '../influence.ts';
import { evaluateTradeProposal, openTradeInquiry } from '../trade-board.ts';
import {
  fillTradeBackfill,
  seasonTradeCatalogFactsOf,
  tradeOfferBackfillSeed,
  tradeRosterLegalityReasons,
} from '../trade-valuation.ts';
import { applySeasonTrade, buildTradeOfferRecord } from '../trades.ts';
import { seasonTransactionEntry } from '../transactions.ts';
import {
  acceptedCommand,
  advanceRunState,
  baseValidation,
  economyRunOf,
  rejectedCommand,
  type SeasonRunCommandContext,
  type SeasonRunCommandOutput,
} from './shared.ts';
export function pendingBlockRejectionOf(
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
export function handleOpenTradeInquiry(
  command: SeasonOpenTradeInquiryCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const pendingRejection = pendingBlockRejectionOf(context);
  const economy = economyRunOf(context);
  const run = economy;
  if (pendingRejection !== null) {
    return rejectedCommand(command, pendingRejection, run, context.pending);
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
    return rejectedCommand(command, rejection, run);
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
    return rejectedCommand(command, rejection, run);
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
    return rejectedCommand(command, rejection, run);
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
  return acceptedCommand(
    command,
    {
      windowIndex: command.windowIndex,
      inquiryId: result.inquiryId,
    },
    next,
    null,
  );
}
export function handleSubmitTradeProposal(
  command: SeasonSubmitTradeProposalCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const economy = economyRunOf(context);
  const run = economy;
  const submitPending = pendingBlockRejectionOf(context);
  if (submitPending !== null) {
    return rejectedCommand(command, submitPending, run, context.pending);
  }
  const humanFranchiseId =
    context.humanFranchiseId ??
    run.league.teams.find((team) => team.control === 'human')?.franchiseId ??
    null;
  if (command.influenceAmount > 0 && command.influenceFromSender === null) {
    return rejectedCommand(
      command,
      { code: 'trade-wrong-fit', reason: 'Influence amount requires a sender' },
      run,
    );
  }
  if (command.influenceAmount === 0 && command.influenceFromSender !== null) {
    return rejectedCommand(
      command,
      { code: 'trade-wrong-fit', reason: 'Influence sender requires an amount' },
      run,
    );
  }
  if (
    command.influenceFromSender !== null &&
    command.influenceFromSender !== command.toFranchiseId &&
    (humanFranchiseId === null || command.influenceFromSender !== humanFranchiseId)
  ) {
    return rejectedCommand(
      command,
      {
        code: 'trade-wrong-fit',
        reason: 'Influence sender must be one of the two trade franchises',
      },
      run,
    );
  }
  if (!context.catalog) {
    return rejectedCommand(
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
    return rejectedCommand(
      command,
      {
        code: 'window-not-open',
        franchiseId: command.toFranchiseId,
        windowIndex: command.windowIndex,
      },
      run,
    );
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
        return rejectedCommand(command, { code: 'trade-wrong-fit', reason }, run);
      case 'trade-insufficient-talent':
        return rejectedCommand(command, { code: 'trade-insufficient-talent', reason }, run);
      case 'window-not-open':
        return rejectedCommand(
          command,
          {
            code: 'window-not-open',
            franchiseId: command.toFranchiseId,
            windowIndex: command.windowIndex,
          },
          run,
        );
      default:
        return rejectedCommand(command, { code: 'trade-wrong-fit', reason }, run);
    }
  }
  const fingerprint = evalResult.proposal.fingerprint;
  const duplicate = win.negotiations?.some((n) =>
    n.exchanges.some((e) => e.proposalFingerprint === fingerprint),
  );
  if (duplicate) {
    return rejectedCommand(
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
    return rejectedCommand(
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
      return rejectedCommand(
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
      return rejectedCommand(
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
      return rejectedCommand(
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
  return acceptedCommand(
    command,
    {
      windowIndex: command.windowIndex,
      inquiryId: inquiryId,
      proposalId: evalResult.proposal.proposalId,
      isOverpay: isOverpayGift,
      rawRatio: consequenceFacts.rawRatio,
      adjustedRatio: consequenceFacts.adjustedRatio,
    },
    next,
    null,
  );
}
export function handleRespondToTradeCounter(
  command: SeasonRespondToTradeCounterCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const economy = economyRunOf(context);
  const run = economy;
  const respondPending = pendingBlockRejectionOf(context);
  if (respondPending !== null) {
    return rejectedCommand(command, respondPending, run, context.pending);
  }
  const win = run.trade?.windows.find((w) => w.windowIndex === command.windowIndex);
  if (!win) {
    return rejectedCommand(
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
    return rejectedCommand(
      command,
      {
        code: 'trade-negotiations-closed',
        windowIndex: command.windowIndex,
      },
      run,
    );
  }
  if (negotiation.exchangeCount >= 3) {
    return rejectedCommand(
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
    return rejectedCommand(
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
    return acceptedCommand(
      command,
      {
        windowIndex: command.windowIndex,
        inquiryId: command.inquiryId,
      },
      declinedNext,
      null,
    );
  }
  const agreed = resolveNegotiationPackage(negotiation);
  if (agreed === null) {
    return rejectedCommand(
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
    return rejectedCommand(command, rejection, run);
  }
  if (context.catalog !== undefined) {
    const facts = seasonTradeCatalogFactsOf(
      context.catalog,
      normalizeSponsorGearState(run.sponsors).players.slots,
    );
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
      return rejectedCommand(command, rejection, run);
    }
  } else {
    const rejection: SeasonTradeNegotiationIllegalRejection = {
      code: 'trade-negotiation-illegal',
      windowIndex: command.windowIndex,
      inquiryId: command.inquiryId,
      reasons: ['the draft catalog is unavailable so the final rosters cannot be checked'],
    };
    return rejectedCommand(command, rejection, run);
  }
  const negotiationFacts = seasonTradeCatalogFactsOf(
    context.catalog,
    normalizeSponsorGearState(run.sponsors).players.slots,
  );
  const humanRosterIdsForOffer =
    run.rosters
      .find((roster) => roster.franchiseId === humanFranchiseId)
      ?.players.map((player) => player.playerVersionId) ?? [];
  const partnerRosterIdsForOffer =
    run.rosters
      .find((roster) => roster.franchiseId === partnerFranchiseId)
      ?.players.map((player) => player.playerVersionId) ?? [];
  const humanAfterIds = [
    ...humanRosterIdsForOffer.filter((id) => !agreed.outgoing.includes(id)),
    ...agreed.incoming,
  ];
  const partnerAfterIds = [
    ...partnerRosterIdsForOffer.filter((id) => !agreed.incoming.includes(id)),
    ...agreed.outgoing,
  ];
  const negotiationKind =
    agreed.outgoing.length === 1 && agreed.incoming.length === 1
      ? ('1-1' as const)
      : agreed.outgoing.length === 2 && agreed.incoming.length === 2
        ? ('2-2' as const)
        : agreed.outgoing.length === 1 && agreed.incoming.length === 2
          ? ('1-2' as const)
          : agreed.outgoing.length === 2 && agreed.incoming.length === 1
            ? ('2-1' as const)
            : ('2-2' as const);
  const syntheticOffer = buildTradeOfferRecord({
    run,
    catalogFacts: negotiationFacts,
    windowIndex: command.windowIndex,
    seedPath: ['trades', 'window', String(command.windowIndex), 'negotiation', command.inquiryId],
    offerId: (negotiation.activeProposalId ?? `prop-${'0'.repeat(32)}`).replace(/^prop-/, 'off-'),
    toFranchiseId: humanFranchiseId,
    fromFranchiseId: partnerFranchiseId,
    outgoing: agreed.outgoing,
    incoming: agreed.incoming,
    kind: negotiationKind,
    receivingFranchiseId: humanFranchiseId,
    candidateRosterIds: humanAfterIds,
    toAfterIds: humanAfterIds,
    fromAfterIds: partnerAfterIds,
    beforeIds: humanRosterIdsForOffer,
    afterIds: humanAfterIds,
    roleNotes: `negotiation ${command.inquiryId} agreed ${agreed.outgoing.join(', ')} for ${agreed.incoming.join(', ')}`,
    needNotes: `negotiation ${command.inquiryId} post-swap depth`,
    rotationText: `negotiation ${command.inquiryId} accepted ${agreed.outgoing.join(', ')} for ${agreed.incoming.join(', ')}; rotations rebuilt deterministically`,
    status: 'accepted',
  });
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
  return acceptedCommand(
    command,
    {
      windowIndex: command.windowIndex,
      inquiryId: command.inquiryId,
      rosterChanges: applied.rosterChanges,
    },
    next,
    null,
  );
}
export function handleWalkAwayFromTrade(
  command: SeasonWalkAwayFromTradeCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const economy = economyRunOf(context);
  const run = economy;
  const walkAwayPending = pendingBlockRejectionOf(context);
  if (walkAwayPending !== null) {
    return rejectedCommand(command, walkAwayPending, run, context.pending);
  }
  const win = run.trade?.windows.find((w) => w.windowIndex === command.windowIndex);
  if (!win) {
    return rejectedCommand(
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
    return rejectedCommand(
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
  return acceptedCommand(
    command,
    {
      windowIndex: command.windowIndex,
      inquiryId: command.inquiryId,
    },
    next,
    null,
  );
}
export function handlePurchaseTradeInquiry(
  command: SeasonPurchaseTradeInquiryCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const economy = economyRunOf(context);
  const run = economy;
  const purchasePending = pendingBlockRejectionOf(context);
  if (purchasePending !== null) {
    return rejectedCommand(command, purchasePending, run, context.pending);
  }
  const win = run.trade?.windows.find((w) => w.windowIndex === command.windowIndex);
  if (!win || win.status !== 'open') {
    return rejectedCommand(
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
    return rejectedCommand(
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
    return rejectedCommand(
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
    return rejectedCommand(
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
  return acceptedCommand(
    command,
    {
      windowIndex: command.windowIndex,
    },
    next,
    null,
  );
}
export function handleAcceptTradeOffer(
  command: SeasonAcceptTradeOfferCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  const acceptPending = pendingBlockRejectionOf(context);
  if (acceptPending !== null) {
    return rejectedCommand(command, acceptPending, run, context.pending);
  }
  const window = run.trade?.windows.find((entry) => entry.windowIndex === command.windowIndex);
  const offer = window?.offers.find((entry) => entry.offerId === command.offerId);
  if (window === undefined || offer === undefined) {
    const rejection: SeasonOfferUnknownRejection = {
      code: 'offer-unknown',
      windowIndex: command.windowIndex,
      offerId: command.offerId,
    };
    return rejectedCommand(command, rejection, run);
  }
  if (window.status !== 'open') {
    const rejection: SeasonWindowNotOpenRejection = {
      code: 'window-not-open',
      franchiseId: null,
      windowIndex: command.windowIndex,
    };
    return rejectedCommand(command, rejection, run);
  }
  if (offer.status !== 'open') {
    const rejection: SeasonOfferNotOpenRejection = {
      code: 'offer-not-open',
      windowIndex: command.windowIndex,
      offerId: command.offerId,
    };
    return rejectedCommand(command, rejection, run);
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
    return rejectedCommand(command, rejection, run);
  }
  if (context.catalog !== undefined) {
    const facts = seasonTradeCatalogFactsOf(
      context.catalog,
      normalizeSponsorGearState(run.sponsors).players.slots,
    );
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
      return rejectedCommand(command, rejection, run);
    }
  }
  const applied = applySeasonTrade(run, offer, context.catalog, { commandId: command.commandId });
  const next = advanceRunState(applied.run);
  return acceptedCommand(
    command,
    {
      trade: { ...offer, status: 'accepted' as const },
      rosterChanges: applied.rosterChanges,
    },
    next,
    null,
  );
}
export function handleDeclineTradeOffer(
  command: SeasonDeclineTradeOfferCommand,
  context: SeasonRunCommandContext,
): SeasonRunCommandOutput {
  const base = baseValidation(command, context.run, context.pending, context);
  if (base !== null) return base;
  const run = economyRunOf(context);
  const declinePending = pendingBlockRejectionOf(context);
  if (declinePending !== null) {
    return rejectedCommand(command, declinePending, run, context.pending);
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
    return rejectedCommand(command, rejection, run);
  }
  if (window.status !== 'open') {
    const rejection: SeasonWindowNotOpenRejection = {
      code: 'window-not-open',
      franchiseId: null,
      windowIndex: command.windowIndex,
    };
    return rejectedCommand(command, rejection, run);
  }
  if (offer.status !== 'open') {
    const rejection: SeasonOfferNotOpenRejection = {
      code: 'offer-not-open',
      windowIndex: command.windowIndex,
      offerId: command.offerId,
    };
    return rejectedCommand(command, rejection, run);
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
  return acceptedCommand(
    command,
    {
      windowIndex: command.windowIndex,
      offerId: command.offerId,
    },
    next,
    null,
  );
}
