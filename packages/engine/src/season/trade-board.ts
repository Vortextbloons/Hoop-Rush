import {
  SEASON_INFLUENCE_FLOOR,
  SEASON_TRADE_PACKAGE_MAX,
  franchiseIdSchema,
  normalizeSponsorGearState,
  type SeasonDraftCatalog,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonRoster,
  type SeasonRotation,
  type SeasonRun,
  type SeasonTradeBoardTeamProfile,
  type SeasonTradeNeed,
  type SeasonTradeNegotiation,
  type SeasonTradePriority,
  type SeasonTradeProposal,
  type SeasonTradeState,
  type SeasonTradeValueTrend,
  type SeasonTradeWindowState,
  type SeasonTransactionEntry,
} from '@hoop-rush/data-contracts';
import { createRng, shuffle } from '../sim/rng.ts';
import { applyRiskyRehabOutcome, rollSeasonRehabOutcome } from './injuries.ts';
import { applySeasonInfluenceSpend } from './influence.ts';
import { seasonTransactionEntry } from './transactions.ts';
import {
  aiFranchiseIdsOf,
  canPlayGroup,
  fillTradeBackfill,
  fingerprintOf,
  rankedBySeed,
  rosterPlayerVersionIdsOf,
  seasonTradeBestValue,
  seasonTradeCatalogFactsOf,
  seasonTradePackageValue,
  seasonTradePlayerValue,
  seedInt,
  tradeAssetEligibilityOf,
  tradeSeed,
  TRADE_VALUE_BAND,
  TRADE_CONSOLIDATION_BEST_MIN_RATIO,
  type SeasonEconomyRun,
  type SeasonTradeCatalogFacts,
} from './trade-valuation.ts';
import type { SlotGroup } from '../domain/positions.ts';

const AI_EXTRA_OFFER_WILLINGNESS_PERCENT = 25;
const AI_REHAB_WILLINGNESS_PERCENT = 30;
export interface AiSpendResult {
  health: SeasonHealthState;
  influence: SeasonInfluenceState;
  transactions: SeasonTransactionEntry[];
}
export function applyAiInfluenceSpends(
  run: SeasonRun,
  rootSeed: string,
  windowIndex: number,
  blockIndex: number,
  humanFranchiseId: string,
): AiSpendResult {
  let health = run.health;
  let influence = run.influence;
  const transactions: SeasonTransactionEntry[] = [];
  const appliedAtStateRevision = run.stateRevision + 1;
  const ai = aiFranchiseIdsOf(run, humanFranchiseId);
  for (const franchiseId of ai) {
    const extraSeed = tradeSeed(
      rootSeed,
      'window',
      String(windowIndex),
      'ai-spend',
      franchiseId,
      'extra-offer',
    );
    const wantExtra = seedInt(extraSeed, 100) < AI_EXTRA_OFFER_WILLINGNESS_PERCENT;
    const fid = franchiseIdSchema.parse(franchiseId);
    const spentExtra = (influence.windows[fid] ?? []).some(
      (window) => window.windowIndex === windowIndex && window.extraOfferSpent,
    );
    const balance = influence.balances[fid] ?? 0;
    if (wantExtra && !spentExtra && balance >= 1) {
      const commandId = `ai-window-${String(windowIndex)}-${franchiseId}-extra-offer`;
      const result = applySeasonInfluenceSpend({
        influence,
        franchiseId,
        source: 'extra-trade-offer',
        requestedDelta: -1,
        blockIndex,
        commandId,
        explanation: `AI ${franchiseId} spent 1 Influence on an extra trade offer (window ${String(windowIndex)})`,
        windowIndex,
      });
      influence = result.influence;
      transactions.push(
        seasonTransactionEntry({
          transactionId: `txn-${commandId}`,
          commandId,
          franchiseId,
          type: 'influence-spend',
          blockIndex,
          appliedAtStateRevision,
          payload: { purpose: 'extra-trade-offer', windowIndex },
          explanation: `AI ${franchiseId} spent 1 Influence on an extra trade offer`,
        }),
      );
    }
    const activeInjuries = health.injuries
      .filter(
        (injury) =>
          injury.franchiseId === franchiseId &&
          injury.sameGameReturned !== true &&
          injury.missedGamesRemaining > 0,
      )
      .sort((x, y) => (x.injuryId < y.injuryId ? -1 : 1));
    if (activeInjuries.length > 0) {
      const pick = rankedBySeed(
        activeInjuries,
        (injury) =>
          tradeSeed(
            rootSeed,
            'window',
            String(windowIndex),
            'ai-spend',
            franchiseId,
            'rehab',
            injury.injuryId,
          ),
        (injury) => injury.injuryId,
      )[0];
      const rehabSeed = tradeSeed(
        rootSeed,
        'window',
        String(windowIndex),
        'ai-spend',
        franchiseId,
        'rehab',
      );
      const wantRehab = seedInt(rehabSeed, 100) < AI_REHAB_WILLINGNESS_PERCENT;
      const currentBalance = influence.balances[franchiseIdSchema.parse(franchiseId)] ?? 0;
      if (
        pick !== undefined &&
        wantRehab &&
        influence.rehabs[pick.injuryId] === undefined &&
        currentBalance >= 2
      ) {
        const outcome = rollSeasonRehabOutcome(rootSeed, pick.injuryId);
        health = applyRiskyRehabOutcome(health, pick.injuryId, outcome);
        const commandId = `ai-window-${String(windowIndex)}-${franchiseId}-risky-rehab`;
        const result = applySeasonInfluenceSpend({
          influence,
          franchiseId,
          source: 'risky-rehab',
          requestedDelta: -2,
          blockIndex,
          commandId,
          explanation: `AI ${franchiseId} risky rehab for ${pick.injuryId} (${outcome})`,
          injuryId: pick.injuryId,
          rehabOutcome: outcome,
        });
        influence = result.influence;
        transactions.push(
          seasonTransactionEntry({
            transactionId: `txn-${commandId}`,
            commandId,
            franchiseId,
            type: 'influence-spend',
            blockIndex,
            appliedAtStateRevision,
            payload: { purpose: 'risky-rehab', injuryId: pick.injuryId, outcome },
            explanation: `AI ${franchiseId} risky rehab for ${pick.injuryId} (${outcome})`,
          }),
        );
      }
    }
  }
  return { health, influence, transactions };
}

export const TRADE_INQUIRY_BASE = 3;
export const TRADE_INQUIRY_MAX = 5;
export const TRADE_EXCHANGE_MAX = 3;
export const TRADE_CASH_MAX_PER_PROPOSAL = 2;
export const TRADE_CASH_MAX_PER_WINDOW = 3;
export const TRADE_CASH_PCT_PER_POINT = 8;
export const TRADE_CASH_PCT_MAX = 16;
function boardSeed(rootSeed: string, windowIndex: number, ...keys: string[]): string {
  return tradeSeed(rootSeed, 'window', String(windowIndex), ...keys);
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
  if (outgoingPlayerVersionIds.length === 0 && incomingPlayerVersionIds.length === 0) {
    return { ok: false, code: 'roster-illegal', reason: 'Influence cannot be only asset' };
  }
  const catalogFacts = seasonTradeCatalogFactsOf(
    catalog,
    normalizeSponsorGearState(run.sponsors).players.slots,
  );
  const humanFranchiseId =
    run.league.teams.find((t) => t.control === 'human')?.franchiseId ??
    run.league.teams[0]?.franchiseId ??
    '';
  const fromFranchiseId = humanFranchiseId;
  if (
    influenceFromSender !== null &&
    influenceFromSender !== fromFranchiseId &&
    influenceFromSender !== toFranchiseId
  ) {
    return {
      ok: false,
      code: 'trade-cash-cap',
      reason: 'Influence sender must be one of the two trade franchises',
    };
  }
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
    run: run as SeasonEconomyRun,
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
  if (!legalRosterSize(fromAfter) || !legalRosterSize(toAfter)) {
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
  const economy = run as SeasonEconomyRun;
  const fromAfterValues = fromAfter.map((id) =>
    seasonTradePlayerValue(id, {
      run: economy,
      catalogFacts,
      receivingFranchiseId: fromFranchiseId,
    }),
  );
  const toAfterValues = toAfter.map((id) =>
    seasonTradePlayerValue(id, {
      run: economy,
      catalogFacts,
      receivingFranchiseId: toFranchiseId,
    }),
  );
  const fromTotal = fromAfterValues.reduce((a, b) => a + b, 0);
  const toTotal = toAfterValues.reduce((a, b) => a + b, 0);
  const outgoingValues = outgoingPlayerVersionIds.map((id) =>
    seasonTradePlayerValue(id, {
      run: economy,
      catalogFacts,
      receivingFranchiseId: fromFranchiseId,
    }),
  );
  const incomingValues = incomingPlayerVersionIds.map((id) =>
    seasonTradePlayerValue(id, {
      run: economy,
      catalogFacts,
      receivingFranchiseId: toFranchiseId,
    }),
  );
  const outPackage = seasonTradePackageValue(outgoingValues);
  const inPackage = seasonTradePackageValue(incomingValues);
  const rawRatio = outPackage > 0 ? Math.round((1000 * inPackage) / outPackage) : 0;
  const outBest = seasonTradeBestValue(outgoingValues);
  const inBest = seasonTradeBestValue(incomingValues);
  const band = TRADE_VALUE_BAND;
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
function legalRosterSize(ids: readonly string[]): boolean {
  if (ids.length < 10 || ids.length > 15) return false;
  return new Set(ids).size === ids.length;
}
const TRADE_BOARD_PROFILE_COUNT = 8;
const TRADE_BOARD_NEEDS: readonly SeasonTradeNeed[] = [
  'ball-handling',
  'shooting',
  'perimeter-defense',
  'interior-defense',
  'rebounding',
  'availability',
  'rotation-talent',
  'depth',
];
const TRADE_BOARD_PRIORITIES: readonly SeasonTradePriority[] = [
  'talent',
  'fit',
  'availability',
  'depth',
  'influence',
];
const TRADE_BOARD_TRENDS = ['rising', 'stable', 'falling'] as const;
const TRADE_BOARD_COMPETITOR_INTERESTS = ['low', 'possible', 'strong', 'preferred-fit'] as const;
export interface TradeBoardProfilesInput {
  run: SeasonRun;
  rootSeed: string;
  windowIndex: number;
  humanFranchiseId: string;
  catalogFacts: SeasonTradeCatalogFacts;
}
export function generateTradeBoardProfiles(input: TradeBoardProfilesInput): {
  boardProfiles: SeasonTradeBoardTeamProfile[];
  canonicalTeamOrder: SeasonTradeWindowState['canonicalTeamOrder'];
  valueTrends: SeasonTradeValueTrend[];
} {
  const { run, rootSeed, windowIndex, humanFranchiseId, catalogFacts } = input;
  const aiIds = aiFranchiseIdsOf(run, humanFranchiseId);
  const boardRng = createRng(tradeSeed(rootSeed, 'window', String(windowIndex), 'board'));
  const selected = shuffle(aiIds, boardRng).slice(0, TRADE_BOARD_PROFILE_COUNT);
  const rosterByFranchise = new Map<string, SeasonRoster>(
    run.rosters.map((roster) => [roster.franchiseId, roster]),
  );
  const rotationByFranchise = new Map<string, SeasonRotation>(
    run.rotations.map((rotation) => [rotation.franchiseId, rotation]),
  );
  const boardProfiles: SeasonTradeBoardTeamProfile[] = [];
  for (const franchiseId of selected) {
    const teamRng = createRng(
      tradeSeed(rootSeed, 'window', String(windowIndex), 'board', franchiseId),
    );
    const rosterIds = rosterPlayerVersionIdsOf(run, franchiseId);
    const rosterSet = new Set(rosterIds);
    const rotation = rotationByFranchise.get(franchiseId);
    let listed: string[] = [];
    let discussable: string[] = [];
    let protectedIds: string[] = [];
    if (rotation !== undefined) {
      const starters = rotation.starters.filter((id) => rosterSet.has(id));
      const bench = rotation.benchOrder.filter((id) => rosterSet.has(id));
      protectedIds = starters.slice(0, 5);
      listed = bench.slice(0, 1);
      discussable = bench.slice(1, 3);
    }
    if (listed.length === 0 || protectedIds.length === 0) {
      const roster = rosterByFranchise.get(franchiseId);
      const ordered = roster?.players.map((player) => player.playerVersionId) ?? rosterIds;
      if (protectedIds.length === 0) protectedIds = ordered.slice(0, 5);
      if (listed.length === 0) listed = ordered.slice(5, 6);
      if (discussable.length === 0) discussable = ordered.slice(6, 8);
    }
    listed = listed.filter((id) => !protectedIds.includes(id)).slice(0, 1);
    discussable = discussable
      .filter((id) => !protectedIds.includes(id) && !listed.includes(id))
      .slice(0, 2);
    const groupDepth: Record<SlotGroup, number> = { G: 0, F: 0, C: 0 };
    for (const id of rosterIds) {
      const playable = catalogFacts.playable.get(id);
      if (playable === undefined) continue;
      for (const group of ['G', 'F', 'C'] as const) {
        if (canPlayGroup(playable, group)) groupDepth[group] += 1;
      }
    }
    const thinnest: SlotGroup =
      groupDepth.G <= groupDepth.F && groupDepth.G <= groupDepth.C
        ? 'G'
        : groupDepth.C <= groupDepth.F
          ? 'C'
          : 'F';
    const thinCandidates: SeasonTradeNeed[] =
      thinnest === 'G'
        ? ['ball-handling', 'shooting']
        : thinnest === 'C'
          ? ['interior-defense', 'rebounding']
          : ['perimeter-defense', 'shooting'];
    const needs: SeasonTradeNeed[] = [teamRng.pick(thinCandidates)];
    const hasInjury = run.health.injuries.some(
      (injury) =>
        injury.franchiseId === franchiseId &&
        injury.sameGameReturned !== true &&
        injury.missedGamesRemaining > 0,
    );
    const firstNeed = needs[0];
    if (hasInjury && firstNeed !== 'availability' && teamRng.chance(0.5)) {
      needs.push('availability');
    } else if (teamRng.chance(0.6)) {
      const remaining = TRADE_BOARD_NEEDS.filter((need) => !needs.includes(need));
      if (remaining.length > 0) needs.push(teamRng.pick(remaining));
    }
    const priority: SeasonTradePriority = needs.includes('availability')
      ? teamRng.chance(0.5)
        ? 'availability'
        : teamRng.pick(TRADE_BOARD_PRIORITIES)
      : teamRng.pick(TRADE_BOARD_PRIORITIES);
    const rationale =
      `${franchiseId} seeks ${needs.join(' + ')}; ` +
      `listening on ${listed[0] ?? 'bench depth'} with ${priority} priority.`;
    const hardConstraints = ['Protected players unavailable'];
    let competitorInterest: SeasonTradeBoardTeamProfile['competitorInterest'];
    const listedId = listed[0];
    if (listedId !== undefined && teamRng.chance(0.35)) {
      competitorInterest = {
        [listedId]: teamRng.pick([...TRADE_BOARD_COMPETITOR_INTERESTS]),
      };
    }
    boardProfiles.push({
      franchiseId: franchiseIdSchema.parse(franchiseId),
      needs,
      priority,
      listedPlayerIds: listed,
      discussablePlayerIds: discussable,
      protectedPlayerIds: protectedIds,
      hardConstraints,
      rationale,
      ...(competitorInterest === undefined ? {} : { competitorInterest }),
    });
  }
  const canonicalTeamOrder = selected.map((id) => franchiseIdSchema.parse(id));
  const humanRosterIds = (() => {
    try {
      return rosterPlayerVersionIdsOf(run, humanFranchiseId);
    } catch {
      return [];
    }
  })();
  const valueTrends: SeasonTradeValueTrend[] = humanRosterIds.slice(0, 6).map((playerVersionId) => {
    const trend = createRng(
      tradeSeed(rootSeed, 'window', String(windowIndex), 'board', 'trend', playerVersionId),
    ).pick([...TRADE_BOARD_TRENDS]);
    return {
      playerVersionId,
      trend,
      basis: `Board estimate holds ${playerVersionId} ${trend} this window.`,
    };
  });
  return { boardProfiles, canonicalTeamOrder, valueTrends };
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
