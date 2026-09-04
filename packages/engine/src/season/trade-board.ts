import {
  SEASON_INFLUENCE_FLOOR,
  franchiseIdSchema,
  seasonNamespaceSeed,
  type SeasonDraftCatalog,
  type SeasonRun,
  type SeasonTradeBoardTeamProfile,
  type SeasonTradeNegotiation,
  type SeasonTradeProposal,
  type SeasonTradeState,
  type SeasonTradeWindowState,
} from '@hoop-rush/data-contracts';
import { slotGroupOf } from '../domain/positions.ts';
import { seasonTradeCatalogFactsOf, seasonTradePlayerValue } from './trades.ts';
import { drawHexInt } from './season-seeds.ts';
export const TRADE_BOARD_SIZE = 8;
export const TRADE_INQUIRY_BASE = 3;
export const TRADE_INQUIRY_MAX = 5;
export const TRADE_EXCHANGE_MAX = 3;
export const TRADE_CASH_MAX_PER_PROPOSAL = 2;
export const TRADE_CASH_MAX_PER_WINDOW = 2;
export const TRADE_CASH_PCT_PER_POINT = 5;
export const TRADE_CASH_PCT_MAX = 10;
export const TRADE_MIN_TALENT_RATIO = 800;
export const TRADE_EXTENDED_RATIO = 750;
function deriveNeeds(
  rosterIds: readonly string[],
  catalog: ReturnType<typeof seasonTradeCatalogFactsOf>,
): import('@hoop-rush/data-contracts').SeasonTradeNeed[] {
  const counts: Record<string, number> = { G: 0, F: 0, C: 0 };
  for (const id of rosterIds) {
    const playable = catalog.playable.get(id);
    if (!playable) continue;
    for (const pos of playable) {
      const g = slotGroupOf(pos);
      counts[g] = (counts[g] ?? 0) + 1;
    }
  }
  const needs: import('@hoop-rush/data-contracts').SeasonTradeNeed[] = [];
  if ((counts['G'] ?? 0) < 4) needs.push('ball-handling');
  if ((counts['F'] ?? 0) < 4) needs.push('rebounding');
  if ((counts['C'] ?? 0) < 3) needs.push('interior-defense');
  if (needs.length === 0) needs.push('depth');
  if (needs.length === 1) {
    needs.push('shooting');
  }
  return needs.slice(0, 2);
}
function boardSeed(rootSeed: string, windowIndex: number, ...keys: string[]): string {
  return seasonNamespaceSeed(rootSeed, 'trades', 'window', String(windowIndex), ...keys);
}
export function generateTradeBoardProfiles(input: {
  run: SeasonRun;
  windowIndex: number;
  rootSeed: string;
  catalog: SeasonDraftCatalog;
  humanFranchiseId: string;
}): SeasonTradeBoardTeamProfile[] {
  const { run, windowIndex, rootSeed, catalog, humanFranchiseId } = input;
  const catalogFacts = seasonTradeCatalogFactsOf(catalog);
  const allProfiles: SeasonTradeBoardTeamProfile[] = [];
  for (const team of run.league.teams) {
    if (team.franchiseId === humanFranchiseId) continue;
    const roster = run.rosters.find((r) => r.franchiseId === team.franchiseId);
    if (!roster) continue;
    const rosterIds = roster.players.map((p) => p.playerVersionId);
    const needs = deriveNeeds(rosterIds, catalogFacts);
    const prioritySeed = boardSeed(rootSeed, windowIndex, 'priority', team.franchiseId);
    const priorities: import('@hoop-rush/data-contracts').SeasonTradePriority[] = [
      'talent',
      'fit',
      'availability',
      'depth',
      'influence',
    ];
    const priority = priorities[
      drawHexInt(prioritySeed) % priorities.length
    ] as import('@hoop-rush/data-contracts').SeasonTradePriority;
    const valued = [...rosterIds].sort((a, b) => {
      const va = seasonTradePlayerValue(a, {
        run: run as unknown as import('./trades.ts').SeasonEconomyRun,
        catalogFacts,
        receivingFranchiseId: team.franchiseId,
      });
      const vb = seasonTradePlayerValue(b, {
        run: run as unknown as import('./trades.ts').SeasonEconomyRun,
        catalogFacts,
        receivingFranchiseId: team.franchiseId,
      });
      return vb - va;
    });
    const protectedIds = valued.slice(0, 2);
    const discussable = valued.slice(2, 6);
    const listed = valued.slice(2, 4);
    allProfiles.push({
      franchiseId: team.franchiseId,
      needs,
      priority,
      listedPlayerIds: listed,
      discussablePlayerIds: discussable,
      protectedPlayerIds: protectedIds,
      hardConstraints: [`Roster must stay 10-15`, `Protected: ${protectedIds.join(',')}`],
      rationale: `Needs ${needs.join('/')} based on roster gaps; priority ${priority}`,
      competitorInterest: undefined,
    });
  }
  const canonical = [...allProfiles].sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1));
  const ranked = [...canonical].sort((a, b) => {
    const sa = boardSeed(rootSeed, windowIndex, 'board', a.franchiseId);
    const sb = boardSeed(rootSeed, windowIndex, 'board', b.franchiseId);
    return sa < sb ? -1 : 1;
  });
  const selected = ranked.slice(0, Math.min(TRADE_BOARD_SIZE, ranked.length));
  return selected.sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1));
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
    outgoingPlayerVersionIds.length > 2 ||
    incomingPlayerVersionIds.length < 1 ||
    incomingPlayerVersionIds.length > 2
  ) {
    return { ok: false, code: 'roster-illegal', reason: 'package must be 1-2 per side' };
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
  const fromAfter = [
    ...fromRoster.players
      .filter((p) => !outgoingPlayerVersionIds.includes(p.playerVersionId))
      .map((p) => p.playerVersionId),
    ...incomingPlayerVersionIds,
  ];
  const toAfter = [
    ...toRoster.players
      .filter((p) => !incomingPlayerVersionIds.includes(p.playerVersionId))
      .map((p) => p.playerVersionId),
    ...outgoingPlayerVersionIds,
  ];
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
      if (boardProfile.protectedPlayerIds.includes(id)) {
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
        if (hasMajor)
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
  const outSum = outgoingValues.reduce((a, b) => a + b, 0);
  const inSum = incomingValues.reduce((a, b) => a + b, 0);
  const rawRatio = outSum > 0 ? Math.round((1000 * inSum) / outSum) : 0;
  if (rawRatio < TRADE_MIN_TALENT_RATIO) {
    return {
      ok: false,
      code: 'trade-insufficient-talent',
      reason: `ratio ${String(rawRatio)} < 800`,
    };
  }
  if (rawRatio < TRADE_EXTENDED_RATIO) {
    return { ok: false, code: 'trade-insufficient-talent', reason: `extended band` };
  }
  const is1v1 = outgoingPlayerVersionIds.length === 1 && incomingPlayerVersionIds.length === 1;
  const band = is1v1 ? { lower: 850, upper: 1150 } : { lower: 800, upper: 1200 };
  const withinBand = rawRatio >= band.lower && rawRatio <= band.upper;
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
  const withinWithCash = finalRatio >= band.lower && finalRatio <= band.upper;
  if (withinBand || withinWithCash) {
  } else {
    return {
      ok: false,
      code: 'trade-wrong-fit',
      reason: `ratio ${String(finalRatio)} outside band`,
    };
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
      rawRatio,
      adjustedRatio: finalRatio,
      fromTotal,
      toTotal,
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
  if (trade === null || trade === undefined) {
    throw new Error('trade inquiry requires an open trade window');
  }
  const nextTrade: SeasonTradeState = {
    ...trade,
    windows: trade.windows.map((w) => (w.windowIndex === windowIndex ? nextWin : w)),
  };
  return { inquiryId, run: { ...run, trade: nextTrade } };
}
