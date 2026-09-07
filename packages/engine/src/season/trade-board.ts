import {
  SEASON_INFLUENCE_FLOOR,
  SEASON_TRADE_PACKAGE_MAX,
  franchiseIdSchema,
  seasonNamespaceSeed,
  type SeasonDraftCatalog,
  type SeasonRun,
  type SeasonTradeNegotiation,
  type SeasonTradeProposal,
  type SeasonTradeState,
  type SeasonTradeWindowState,
} from '@hoop-rush/data-contracts';
import {
  fillTradeBackfill,
  seasonTradeBestValue,
  seasonTradeCatalogFactsOf,
  seasonTradePackageRatio,
  seasonTradePackageValue,
  seasonTradePlayerValue,
  tradeAssetEligibilityOf,
  TRADE_BAND_1V1,
  TRADE_BAND_DEFAULT,
  TRADE_CONSOLIDATION_BEST_MIN_RATIO,
} from './trades.ts';
export const TRADE_INQUIRY_BASE = 3;
export const TRADE_INQUIRY_MAX = 5;
export const TRADE_EXCHANGE_MAX = 3;
export const TRADE_CASH_MAX_PER_PROPOSAL = 2;
export const TRADE_CASH_MAX_PER_WINDOW = 3;
export const TRADE_CASH_PCT_PER_POINT = 8;
export const TRADE_CASH_PCT_MAX = 16;
export const TRADE_MIN_TALENT_RATIO = 800;
function boardSeed(rootSeed: string, windowIndex: number, ...keys: string[]): string {
  return seasonNamespaceSeed(rootSeed, 'trades', 'window', String(windowIndex), ...keys);
}
function fingerprintOf(outgoing: readonly string[], incoming: readonly string[]): string {
  const o = [...outgoing].sort().join(',');
  const i = [...incoming].sort().join(',');
  return `${o}|${i}`;
}
export type TradeProposalEvaluation =
  | {
      ok: true;
      proposal: SeasonTradeProposal;
    }
  | {
      ok: false;
      code: import('@hoop-rush/data-contracts').SeasonRunCommandRejection['code'];
      reason: string;
    };
export function evaluateTradeProposal(input: {
  run: SeasonRun;
  windowIndex: number;
  toFranchiseId: string;
  outgoingPlayerVersionIds: readonly string[];
  incomingPlayerVersionIds: readonly string[];
  influenceAmount: number;
  influenceFromSender: string | null;
  catalog: SeasonDraftCatalog;
  rootSeed: string;
}): TradeProposalEvaluation {
  const {
    run,
    windowIndex,
    toFranchiseId,
    outgoingPlayerVersionIds,
    incomingPlayerVersionIds,
    influenceAmount,
    influenceFromSender,
    catalog,
    rootSeed,
  } = input;
  const win = run.trade?.windows.find((w) => w.windowIndex === windowIndex);
  if (!win || win.status !== 'open') {
    return { ok: false, code: 'window-not-open', reason: 'window not open' };
  }
  if (
    outgoingPlayerVersionIds.length < 1 ||
    outgoingPlayerVersionIds.length > SEASON_TRADE_PACKAGE_MAX ||
    incomingPlayerVersionIds.length < 1 ||
    incomingPlayerVersionIds.length > SEASON_TRADE_PACKAGE_MAX
  ) {
    return {
      ok: false,
      code: 'roster-illegal',
      reason: `package must be 1-${String(SEASON_TRADE_PACKAGE_MAX)} per side`,
    };
  }
  const all = [...outgoingPlayerVersionIds, ...incomingPlayerVersionIds];
  if (new Set(all).size !== all.length) {
    return { ok: false, code: 'roster-illegal', reason: 'distinct player ids required' };
  }
  if (influenceAmount < 0 || influenceAmount > 2) {
    return { ok: false, code: 'trade-cash-cap', reason: 'Influence 0-2' };
  }
  if (influenceAmount > 0 && influenceFromSender === null) {
    return { ok: false, code: 'trade-cash-cap', reason: 'Influence requires sender' };
  }
  if (influenceAmount === 0 && influenceFromSender !== null) {
    return { ok: false, code: 'trade-cash-cap', reason: 'Sender without amount' };
  }
  if (
    influenceFromSender !== null &&
    influenceFromSender !==
      run.league.teams.find((t) => t.franchiseId === toFranchiseId)?.franchiseId &&
    influenceFromSender !==
      run.league.teams.find(
        (t) =>
          t.franchiseId ===
          run.league.teams.find((x) => x.franchiseId === toFranchiseId)?.franchiseId,
      )?.franchiseId
  ) {
  }
  if (outgoingPlayerVersionIds.length === 0 && incomingPlayerVersionIds.length === 0) {
    return { ok: false, code: 'roster-illegal', reason: 'Influence cannot be only asset' };
  }
  const catalogFacts = seasonTradeCatalogFactsOf(catalog);
  const humanFranchiseId =
    run.league.teams.find((t) => t.control === 'human')?.franchiseId ??
    run.league.teams[0]?.franchiseId ??
    '';
  const fromFranchiseId = humanFranchiseId;
  const fromRoster = run.rosters.find((r) => r.franchiseId === fromFranchiseId);
  const toRoster = run.rosters.find((r) => r.franchiseId === toFranchiseId);
  if (!fromRoster || !toRoster) {
    return { ok: false, code: 'roster-illegal', reason: 'unknown franchise' };
  }
  const fromIds = new Set(fromRoster.players.map((p) => p.playerVersionId));
  const toIds = new Set(toRoster.players.map((p) => p.playerVersionId));
  for (const id of outgoingPlayerVersionIds)
    if (!fromIds.has(id))
      return { ok: false, code: 'ownership-conflict', reason: `${id} not on ${fromFranchiseId}` };
  for (const id of incomingPlayerVersionIds)
    if (!toIds.has(id))
      return { ok: false, code: 'ownership-conflict', reason: `${id} not on ${toFranchiseId}` };
  const fromAfterRaw = [
    ...fromRoster.players
      .filter((p) => !outgoingPlayerVersionIds.includes(p.playerVersionId))
      .map((p) => p.playerVersionId),
    ...incomingPlayerVersionIds,
  ];
  const toAfterRaw = [
    ...toRoster.players
      .filter((p) => !incomingPlayerVersionIds.includes(p.playerVersionId))
      .map((p) => p.playerVersionId),
    ...outgoingPlayerVersionIds,
  ];
  const filled = fillTradeBackfill({
    catalog,
    run: run as unknown as import('./trades.ts').SeasonEconomyRun,
    toFranchiseId,
    fromFranchiseId,
    toIds: toAfterRaw,
    fromIds: fromAfterRaw,
    seed: boardSeed(
      rootSeed,
      windowIndex,
      'proposal-backfill',
      fingerprintOf(outgoingPlayerVersionIds, incomingPlayerVersionIds),
    ),
  });
  if (filled === null) {
    return { ok: false, code: 'roster-illegal', reason: 'resulting roster 10-15' };
  }
  const fromAfter = filled.fromIdsFilled;
  const toAfter = filled.toIdsFilled;
  const checkRoster = (ids: readonly string[]) => {
    if (ids.length < 10 || ids.length > 15) return false;
    if (new Set(ids).size !== ids.length) return false;
    return true;
  };
  if (!checkRoster(fromAfter) || !checkRoster(toAfter)) {
    return { ok: false, code: 'roster-illegal', reason: 'resulting roster 10-15' };
  }
  const boardProfile = win.boardProfiles?.find((p) => p.franchiseId === toFranchiseId);
  if (boardProfile) {
    for (const id of incomingPlayerVersionIds) {
      const eligibility = tradeAssetEligibilityOf({
        playerVersionId: id,
        fromFranchiseId: toFranchiseId,
        protectedIds: boardProfile.protectedPlayerIds,
        available: true,
      });
      if (eligibility.status === 'protected') {
        return { ok: false, code: 'trade-protected-player', reason: `${id} protected` };
      }
    }
    for (const id of [...outgoingPlayerVersionIds, ...incomingPlayerVersionIds]) {
      const injuries = run.health.injuries.filter(
        (inj) =>
          inj.playerVersionId === id &&
          inj.missedGamesRemaining > 0 &&
          inj.sameGameReturned !== true,
      );
      if (injuries.length > 0) {
        const hasMajor = injuries.some(
          (inj) => inj.severity === 'major' || inj.severity === 'season-ending',
        );
        const eligibility = tradeAssetEligibilityOf({
          playerVersionId: id,
          protectedIds: [],
          available: false,
          hasBlockingInjury: hasMajor,
        });
        if (eligibility.status === 'availability-risk')
          return { ok: false, code: 'trade-availability-risk', reason: `${id} injured` };
      }
    }
  }
  const fromAfterValues = fromAfter.map((id) =>
    seasonTradePlayerValue(id, {
      run: run as unknown as import('./trades.ts').SeasonEconomyRun,
      catalogFacts,
      receivingFranchiseId: fromFranchiseId,
    }),
  );
  const toAfterValues = toAfter.map((id) =>
    seasonTradePlayerValue(id, {
      run: run as unknown as import('./trades.ts').SeasonEconomyRun,
      catalogFacts,
      receivingFranchiseId: toFranchiseId,
    }),
  );
  const fromTotal = fromAfterValues.reduce((a, b) => a + b, 0);
  const toTotal = toAfterValues.reduce((a, b) => a + b, 0);
  const outgoingValues = outgoingPlayerVersionIds.map((id) =>
    seasonTradePlayerValue(id, {
      run: run as unknown as import('./trades.ts').SeasonEconomyRun,
      catalogFacts,
      receivingFranchiseId: fromFranchiseId,
    }),
  );
  const incomingValues = incomingPlayerVersionIds.map((id) =>
    seasonTradePlayerValue(id, {
      run: run as unknown as import('./trades.ts').SeasonEconomyRun,
      catalogFacts,
      receivingFranchiseId: toFranchiseId,
    }),
  );
  const outPackage = seasonTradePackageValue(outgoingValues);
  const inPackage = seasonTradePackageValue(incomingValues);
  const rawRatio = outPackage > 0 ? Math.round((1000 * inPackage) / outPackage) : 0;
  const outBest = seasonTradeBestValue(outgoingValues);
  const inBest = seasonTradeBestValue(incomingValues);
  const is1v1 = outgoingPlayerVersionIds.length === 1 && incomingPlayerVersionIds.length === 1;
  const band = is1v1 ? TRADE_BAND_1V1 : TRADE_BAND_DEFAULT;
  let adjusted = rawRatio;
  if (influenceAmount > 0) {
    const pct = Math.min(influenceAmount * TRADE_CASH_PCT_PER_POINT, TRADE_CASH_PCT_MAX);
    if (influenceFromSender === fromFranchiseId) {
      adjusted = Math.round(rawRatio * (1 + pct / 100));
    } else if (influenceFromSender === toFranchiseId) {
      adjusted = Math.round(rawRatio * (1 - pct / 100));
    }
    if (influenceAmount > TRADE_CASH_MAX_PER_PROPOSAL) {
      return { ok: false, code: 'trade-cash-cap', reason: 'cash >2 per proposal' };
    }
    if (influenceAmount > 0) {
      if (influenceFromSender === null) {
        throw new Error('trade proposal with Influence amount requires a sender');
      }
      const senderFid = franchiseIdSchema.parse(influenceFromSender);
      const senderWindows = run.influence.windows[senderFid] ?? [];
      const senderWin = senderWindows.find((w) => w.windowIndex === windowIndex);
      const sent = senderWin?.tradeCashSent ?? 0;
      if (sent + influenceAmount > TRADE_CASH_MAX_PER_WINDOW) {
        return {
          ok: false,
          code: 'trade-cash-cap',
          reason: `per-window cap ${String(TRADE_CASH_MAX_PER_WINDOW)}`,
        };
      }
      const senderBalance = run.influence.balances[senderFid] ?? 0;
      if (senderBalance - influenceAmount < SEASON_INFLUENCE_FLOOR) {
        return { ok: false, code: 'insufficient-balance', reason: 'balance' };
      }
    }
  }
  const finalRatio = adjusted;
  const isOverpay = finalRatio < band.lower;
  if (!isOverpay) {
    if (finalRatio > band.upper) {
      return {
        ok: false,
        code: 'trade-wrong-fit',
        reason: `ratio ${String(finalRatio)} outside band`,
      };
    }
    if (
      finalRatio > 1000 &&
      outgoingPlayerVersionIds.length > incomingPlayerVersionIds.length &&
      outBest > 0 &&
      inBest > 0
    ) {
      const bestRatio = Math.round((1000 * outBest) / inBest);
      const minBest = Math.round((inBest * TRADE_CONSOLIDATION_BEST_MIN_RATIO) / 1000);
      if (outBest < minBest) {
        return {
          ok: false,
          code: 'trade-wrong-fit',
          reason: `best-player gap ${String(bestRatio)} consolidating quantity for quality`,
        };
      }
    }
  }
  const fingerprint = fingerprintOf(outgoingPlayerVersionIds, incomingPlayerVersionIds);
  const proposal: SeasonTradeProposal = {
    proposalId: `prop-${boardSeed(rootSeed, windowIndex, 'proposal', fingerprint).slice(0, 32)}`,
    windowIndex,
    fromFranchiseId: franchiseIdSchema.parse(fromFranchiseId),
    toFranchiseId: franchiseIdSchema.parse(toFranchiseId),
    outgoingPlayerVersionIds: [...outgoingPlayerVersionIds],
    incomingPlayerVersionIds: [...incomingPlayerVersionIds],
    influenceFromSender:
      influenceFromSender === null ? null : franchiseIdSchema.parse(influenceFromSender),
    influenceAmount,
    fingerprint,
    consequenceFacts: {
      fromAfterSize: fromAfter.length,
      toAfterSize: toAfter.length,
      backfillFrom: filled.fromIdsFilled.filter((id) => !fromAfterRaw.includes(id)),
      backfillTo: filled.toIdsFilled.filter((id) => !toAfterRaw.includes(id)),
      rawRatio,
      adjustedRatio: finalRatio,
      fromTotal,
      toTotal,
      outPackage,
      inPackage,
      outBest,
      inBest,
      isOverpay,
      overpayPct: isOverpay ? Math.round(1000 / Math.max(1, finalRatio)) - 100 : 0,
      giftValue: isOverpay ? Math.round((outPackage - inPackage) * 100) / 100 : 0,
    },
    seedPath: ['trades', 'window', String(windowIndex), 'proposal', fingerprint],
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
  };
  return { ok: true, proposal };
}
export function openTradeInquiry(
  run: SeasonRun,
  windowIndex: number,
  toFranchiseId: string,
):
  | {
      inquiryId: string;
      run: SeasonRun;
    }
  | {
      error: string;
    } {
  const win = run.trade?.windows.find((w) => w.windowIndex === windowIndex);
  if (!win || win.status !== 'open') return { error: 'window-not-open' };
  if (win.activeInquiryId) return { error: 'trade-active-negotiation' };
  const allowance = win.inquiryAllowance ?? TRADE_INQUIRY_BASE;
  const used = win.negotiations?.length ?? 0;
  if (used >= allowance) return { error: 'trade-inquiry-cap' };
  const inquiryId = `inq-${boardSeed(run.rootSeed, windowIndex, 'inquiry', toFranchiseId, String(win.negotiations?.length ?? 0)).slice(0, 32)}`;
  const negotiation: SeasonTradeNegotiation = {
    inquiryId,
    windowIndex,
    fromFranchiseId: franchiseIdSchema.parse(
      run.league.teams.find((t) => t.control === 'human')?.franchiseId ?? '',
    ),
    toFranchiseId: franchiseIdSchema.parse(toFranchiseId),
    status: 'draft',
    exchangeCount: 0,
    exchanges: [],
    rejectedPlayerVersionIds: [],
    expressedInterests: [],
    latestRequestedChange: null,
    finalReason: null,
    activeProposalId: null,
  };
  const nextWin: SeasonTradeWindowState = {
    ...win,
    activeInquiryId: inquiryId,
    negotiations: [...(win.negotiations ?? []), negotiation],
  };
  const trade = run.trade;
  if (!trade) {
    throw new Error('trade inquiry requires an open trade window');
  }
  const nextTrade: SeasonTradeState = {
    ...trade,
    windows: trade.windows.map((w) => (w.windowIndex === windowIndex ? nextWin : w)),
  };
  return { inquiryId, run: { ...run, trade: nextTrade } };
}
