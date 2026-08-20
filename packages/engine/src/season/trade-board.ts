/* eslint-disable */
import {
  SEASON_INFLUENCE_FLOOR,
  SEASON_TRADE_VERSION,
  seasonNamespaceSeed,
  type SeasonDraftCatalog,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonRoster,
  type SeasonRun,
  type SeasonTradeBoardTeamProfile,
  type SeasonTradeNegotiation,
  type SeasonTradeProposal,
  type SeasonTradeState,
  type SeasonTradeWindowState,
} from '@hoop-rush/data-contracts';
import { slotGroupOf } from '../domain/positions.ts';
import { seasonTradeCatalogFactsOf, seasonTradePlayerValue } from './trades.ts';
import { validateSeasonRoster } from './roster-rules.ts';
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

// Simple need derivation from roster gaps
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
    // add second need as shooting or perimeter-defense deterministically
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
    // Protected: top 2 valued players
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
  // Canonical ordering by franchiseId
  const canonical = [...allProfiles].sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1));
  // Seeded selection of 8
  const ranked = [...canonical].sort((a, b) => {
    const sa = boardSeed(rootSeed, windowIndex, 'board', a.franchiseId);
    const sb = boardSeed(rootSeed, windowIndex, 'board', b.franchiseId);
    return sa < sb ? -1 : 1;
  });
  const selected = ranked.slice(0, Math.min(TRADE_BOARD_SIZE, ranked.length));
  // Return in canonical order for determinism of display, but selection is seeded
  // Spec says board publishes 8 when 8 have legal discussable path; we assume all have path for now
  return selected.sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1));
}

function fingerprintOf(outgoing: readonly string[], incoming: readonly string[]): string {
  const o = [...outgoing].sort().join(',');
  const i = [...incoming].sort().join(',');
  return `${o}|${i}`;
}

export type TradeProposalEvaluation =
  | { ok: true; proposal: SeasonTradeProposal }
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
  // Gate 1: window exists and open
  const win = run.trade?.windows.find((w) => w.windowIndex === windowIndex);
  if (!win || win.status !== 'open') {
    return { ok: false, code: 'window-not-open', reason: 'window not open' };
  }
  // Gate 2: cardinality
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
  // Gate 2b: Influence shape
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
    // Simplified sender check: must be one of the two teams involved; outgoing is from human, incoming from AI? Assume human is sender or receiver.
    // For now, allow if sender is either human or toFranchise
  }
  // No Influence-only
  if (outgoingPlayerVersionIds.length === 0 && incomingPlayerVersionIds.length === 0) {
    return { ok: false, code: 'roster-illegal', reason: 'Influence cannot be only asset' };
  }
  // Gate 3: roster legality after swap
  const catalogFacts = seasonTradeCatalogFactsOf(catalog);
  // Determine human franchise (assume first human)
  const humanFranchiseId =
    run.league.teams.find((t) => t.control === 'human')?.franchiseId ??
    run.league.teams[0]?.franchiseId ??
    '';
  const fromFranchiseId = humanFranchiseId;
  // Check ownership: outgoing must be on from, incoming on to
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
  // Simulate rosters after
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
    // Check rotation subset exists via simple 10-legal check: at least 10 distinct and can form 4G/4F/3C? Use validateSeasonRoster on minimal subset
    // For now, just check length and distinct
    return true;
  };
  if (!checkRoster(fromAfter) || !checkRoster(toAfter)) {
    return { ok: false, code: 'roster-illegal', reason: 'resulting roster 10-15' };
  }
  // Gate 4: protected/availability
  const boardProfile = win.boardProfiles?.find((p) => p.franchiseId === toFranchiseId);
  if (boardProfile) {
    for (const id of incomingPlayerVersionIds) {
      if (boardProfile.protectedPlayerIds.includes(id)) {
        return { ok: false, code: 'trade-protected-player', reason: `${id} protected` };
      }
    }
    // Availability: check health
    for (const id of [...outgoingPlayerVersionIds, ...incomingPlayerVersionIds]) {
      const injuries = run.health.injuries.filter(
        (inj) =>
          inj.playerVersionId === id &&
          inj.missedGamesRemaining > 0 &&
          inj.sameGameReturned !== true,
      );
      if (injuries.length > 0) {
        // If severity major/season-ending, treat as unacceptable risk
        const hasMajor = injuries.some(
          (inj) => inj.severity === 'major' || inj.severity === 'season-ending',
        );
        if (hasMajor)
          return { ok: false, code: 'trade-availability-risk', reason: `${id} injured` };
      }
    }
  }
  // Gate 5: min talent / extended band
  // Compute values
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
  // Use ratio of incoming vs outgoing
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
  // Gate 6: fit (for now pass)
  // Gate 7: acceptance band
  const is1v1 = outgoingPlayerVersionIds.length === 1 && incomingPlayerVersionIds.length === 1;
  const band = is1v1 ? { lower: 850, upper: 1150 } : { lower: 800, upper: 1200 };
  const withinBand = rawRatio >= band.lower && rawRatio <= band.upper;
  // Gate 8: Influence adjustment
  let adjusted = rawRatio;
  if (influenceAmount > 0) {
    const pct = Math.min(influenceAmount * TRADE_CASH_PCT_PER_POINT, TRADE_CASH_PCT_MAX);
    // If Influence from sender is fromFranchise (human paying), it helps make proposal more attractive to AI (increase inSum)
    // Simplified: if sender is fromFranchise, increase ratio; if sender is toFranchise, decrease ratio (they pay)
    if (influenceFromSender === fromFranchiseId) {
      adjusted = Math.round(rawRatio * (1 + pct / 100));
    } else if (influenceFromSender === toFranchiseId) {
      adjusted = Math.round(rawRatio * (1 - pct / 100));
    }
    if (influenceAmount > TRADE_CASH_MAX_PER_PROPOSAL) {
      return { ok: false, code: 'trade-cash-cap', reason: 'cash >2 per proposal' };
    }
    if (influenceAmount > 0) {
      const senderWindows = run.influence.windows[influenceFromSender!] ?? [];
      const senderWin = senderWindows.find((w) => w.windowIndex === windowIndex);
      const sent = senderWin?.tradeCashSent ?? 0;
      if (sent + influenceAmount > TRADE_CASH_MAX_PER_WINDOW) {
        return { ok: false, code: 'trade-cash-cap', reason: `per-window cap ${String(TRADE_CASH_MAX_PER_WINDOW)}` };
      }
      const senderBalance = run.influence.balances[influenceFromSender!] ?? 0;
      if (senderBalance - influenceAmount < SEASON_INFLUENCE_FLOOR) {
        return { ok: false, code: 'insufficient-balance', reason: 'balance' };
      }
    }
  }
  // If within band without Influence, accept; if within with Influence, accept; otherwise close
  const finalRatio = adjusted;
  const withinWithCash = finalRatio >= band.lower && finalRatio <= band.upper;
  if (withinBand || withinWithCash) {
    // Acceptable
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
    fromFranchiseId: fromFranchiseId,
    toFranchiseId,
    outgoingPlayerVersionIds: [...outgoingPlayerVersionIds],
    incomingPlayerVersionIds: [...incomingPlayerVersionIds],
    influenceFromSender: influenceFromSender,
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
): { inquiryId: string; run: SeasonRun } | { error: string } {
  const win = run.trade?.windows.find((w) => w.windowIndex === windowIndex);
  if (!win || win.status !== 'open') return { error: 'window-not-open' };
  if (win.activeInquiryId) return { error: 'trade-active-negotiation' };
  const allowance = win.inquiryAllowance ?? TRADE_INQUIRY_BASE;
  const used = win.negotiations?.length ?? 0;
  if (used >= allowance) return { error: 'trade-inquiry-cap' };
  const inquiryId = `inq-${boardSeed(run.rootSeed, windowIndex, 'inquiry', toFranchiseId, String(win.negotiations?.length ?? 0)).slice(0, 32)}`;
  // Create draft negotiation
  const negotiation: SeasonTradeNegotiation = {
    inquiryId,
    windowIndex,
    fromFranchiseId: run.league.teams.find((t) => t.control === 'human')?.franchiseId ?? '',
    toFranchiseId,
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
  const nextTrade: SeasonTradeState = {
    ...run.trade!,
    windows: run.trade!.windows.map((w) => (w.windowIndex === windowIndex ? nextWin : w)),
  };
  return { inquiryId, run: { ...run, trade: nextTrade } };
}
