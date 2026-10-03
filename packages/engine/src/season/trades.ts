import {
  SEASON_TRADE_PACKAGE_MAX,
  SEASON_TRADE_VERSION,
  franchiseIdSchema,
  type Position,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonRoster,
  type SeasonRotation,
  type SeasonRun,
  type SeasonTradeOffer,
  type SeasonTradeRosterChange,
  type SeasonTradeState,
  type SeasonTransactionEntry,
} from '@hoop-rush/data-contracts';
import { slotGroupOf, type SlotGroup } from '../domain/positions.ts';
import { canonicalPlayerPairs } from './chemistry.ts';
import { reconcileSeasonEffects } from './effects.ts';
import { buildMinimalRotation, validateSeasonRotation } from './rotation.ts';
import { type SeasonRosterMemberInput } from './roster-rules.ts';
import { seasonRunStateDigest, seasonRunStateDigestFactsOf } from './state-digest.ts';
import { seasonTransactionEntry } from './transactions.ts';
import { applyAiInfluenceSpends, generateTradeBoardProfiles } from './trade-board.ts';
import {
  aiFranchiseIdsOf,
  coverageDepthOf,
  fillTradeBackfill,
  kindOrderStartingAt,
  packageKindOf,
  packageSizesOf,
  pickDistinct,
  rankedBySeed,
  ratioMutuallyWithinBand,
  rosterIsLegal,
  rosterPlayerVersionIdsOf,
  seasonEconomyRunOf,
  seasonTradeCatalogFactsOf,
  seasonTradePackageRatio,
  seasonTradePlayerHealthFacts,
  seasonTradePlayerValue,
  seasonTradeValueBandFor,
  seedInt,
  slotGroupsOf,
  sponsorSlotsOf,
  swappedRosterIds,
  tradeOfferBackfillSeed,
  tradeRosterLegalityReasons,
  tradeSeed,
  TRADE_VALUE_BAND,
  SeasonTradeFactsError,
  SeasonTradeInvariantError,
  type SeasonEconomyRun,
  type SeasonTradeCatalogFacts,
  type SeasonTradePackageKind,
} from './trade-valuation.ts';
export { seasonEconomyRunOf, type SeasonEconomyRun } from './trade-valuation.ts';
export type { TradeBackfillFill, TradeBackfillSelection } from './trade-valuation.ts';
export { selectTradeBackfill } from './trade-valuation.ts';
export const WINDOW_BLOCK_INDEX_TO_INDEX: Readonly<Record<number, number>> = {
  2: 0,
  4: 1,
  5: 2,
};
const AI_TRADE_TARGET_RANGE = 2;
const AI_TRADE_ATTEMPT_BUDGET = 40;
const AI_TRADE_SEASON_CAP = 12;
const OFFER_PROBE_BUDGET = 7;
export interface SeasonWindowOpenResult {
  trade: SeasonTradeState;
  influence: SeasonInfluenceState;
  transactions: SeasonTransactionEntry[];
  rosters: SeasonRoster[];
  ownership: SeasonRun['ownership'];
  rotations: SeasonRotation[];
  effects: SeasonEffectsState;
  health: SeasonHealthState;
  stateRevision: number;
  stateDigest: string;
}
export interface SeasonOpenTradeWindowInput {
  run: SeasonRun;
  blockIndex: number;
  rootSeed: string;
  humanFranchiseId: string | null;
  participantFranchiseIds?: readonly string[];
  catalog?: SeasonDraftCatalog;
  effects?: SeasonEffectsState;
}
interface OfferGenerationContext {
  run: SeasonEconomyRun;
  rootSeed: string;
  windowIndex: number;
  humanFranchiseId: string;
  catalog: SeasonDraftCatalog;
  catalogFacts: SeasonTradeCatalogFacts;
}
interface OfferCandidate {
  aiFranchiseId: string;
  kind: SeasonTradePackageKind;
  outgoing: string[];
  incoming: string[];
  rawRatio: number;
}
export interface TradeOfferRecordInput {
  run: SeasonEconomyRun;
  catalogFacts: SeasonTradeCatalogFacts;
  windowIndex: number;
  seedPath: string[];
  offerId: string;
  toFranchiseId: string;
  fromFranchiseId: string;
  outgoing: readonly string[];
  incoming: readonly string[];
  kind: SeasonTradePackageKind;
  receivingFranchiseId: string;
  candidateRosterIds: readonly string[];
  toAfterIds: readonly string[];
  fromAfterIds: readonly string[];
  beforeIds: readonly string[];
  afterIds: readonly string[];
  roleNotes: string;
  needNotes: string;
  rotationText: string;
  status: SeasonTradeOffer['status'];
}
export function buildTradeOfferRecord(input: TradeOfferRecordInput): SeasonTradeOffer {
  const outgoingValues = input.outgoing.map((id) =>
    seasonTradePlayerValue(id, {
      run: input.run,
      catalogFacts: input.catalogFacts,
      receivingFranchiseId: input.receivingFranchiseId,
      candidateRosterIds: input.candidateRosterIds,
    }),
  );
  const incomingValues = input.incoming.map((id) =>
    seasonTradePlayerValue(id, {
      run: input.run,
      catalogFacts: input.catalogFacts,
      receivingFranchiseId: input.receivingFranchiseId,
      candidateRosterIds: input.candidateRosterIds,
    }),
  );
  return {
    offerId: input.offerId,
    windowIndex: input.windowIndex,
    seedPath: [...input.seedPath],
    toFranchiseId: franchiseIdSchema.parse(input.toFranchiseId),
    fromFranchiseId: franchiseIdSchema.parse(input.fromFranchiseId),
    outgoingPlayerVersionIds: [...input.outgoing],
    incomingPlayerVersionIds: [...input.incoming],
    outgoingHealth: input.outgoing.map((id) => seasonTradePlayerHealthFacts(input.run.health, id)),
    incomingHealth: input.incoming.map((id) => seasonTradePlayerHealthFacts(input.run.health, id)),
    valueBand: seasonTradeValueBandFor({
      kind: input.kind,
      outgoingValues,
      incomingValues,
    }),
    roleFit: {
      outgoingRoles: input.outgoing.map((id) => slotGroupsOf(input.catalogFacts, id).join('/')),
      incomingRoles: input.incoming.map((id) => slotGroupsOf(input.catalogFacts, id).join('/')),
      notes: input.roleNotes,
    },
    rosterNeedFacts: {
      outgoingDepth: coverageDepthOf(input.fromAfterIds, input.outgoing, input.catalogFacts),
      incomingDepth: coverageDepthOf(input.toAfterIds, input.incoming, input.catalogFacts),
      notes: input.needNotes,
    },
    projectedRotationChanges: input.rotationText,
    projectedChemistryDisruption: {
      removedPairs: canonicalPlayerPairs(input.beforeIds).filter(
        ([a, b]) => input.outgoing.includes(a) || input.outgoing.includes(b),
      ).length,
      newPairs: canonicalPlayerPairs(input.afterIds).filter(
        ([a, b]) => input.incoming.includes(a) || input.incoming.includes(b),
      ).length,
    },
    status: input.status,
  };
}
function humanOfferCandidate(
  context: OfferGenerationContext,
  seedPath: string[],
  aiFranchiseId: string,
  kind: SeasonTradePackageKind,
  probeIndex: number,
): OfferCandidate | null {
  const { run, rootSeed, humanFranchiseId, catalogFacts } = context;
  const sizes = packageSizesOf(kind);
  const humanRosterIds = rosterPlayerVersionIdsOf(run, humanFranchiseId);
  const aiRosterIds = rosterPlayerVersionIdsOf(run, aiFranchiseId);
  const outgoing = pickDistinct(
    humanRosterIds,
    (id) => tradeSeed(rootSeed, ...seedPath, 'outgoing', String(probeIndex), id),
    (id) => id,
    sizes.outgoing,
  );
  const incoming = pickDistinct(
    aiRosterIds,
    (id) => tradeSeed(rootSeed, ...seedPath, 'incoming', String(probeIndex), id),
    (id) => id,
    sizes.incoming,
  );
  const humanAfter = swappedRosterIds(humanRosterIds, outgoing, incoming);
  const aiAfter = swappedRosterIds(aiRosterIds, incoming, outgoing);
  const filled = fillTradeBackfill({
    catalog: context.catalog,
    run,
    toFranchiseId: humanFranchiseId,
    fromFranchiseId: aiFranchiseId,
    toIds: humanAfter,
    fromIds: aiAfter,
    seed: tradeSeed(rootSeed, ...seedPath, 'backfill'),
  });
  if (filled === null) return null;
  if (
    !rosterIsLegal(filled.toIdsFilled, catalogFacts) ||
    !rosterIsLegal(filled.fromIdsFilled, catalogFacts)
  ) {
    return null;
  }
  const outgoingValues = outgoing.map((id) =>
    seasonTradePlayerValue(id, {
      run,
      catalogFacts,
      receivingFranchiseId: humanFranchiseId,
      candidateRosterIds: filled.toIdsFilled,
    }),
  );
  const incomingValues = incoming.map((id) =>
    seasonTradePlayerValue(id, {
      run,
      catalogFacts,
      receivingFranchiseId: humanFranchiseId,
      candidateRosterIds: filled.toIdsFilled,
    }),
  );
  const rawRatio = seasonTradePackageRatio({ outgoingValues, incomingValues });
  return { aiFranchiseId, kind, outgoing, incoming, rawRatio };
}
function rankedAiFranchises(
  context: OfferGenerationContext,
  seedPath: string[],
  usedFranchiseIds: readonly string[],
): string[] {
  const ai = aiFranchiseIdsOf(context.run, context.humanFranchiseId);
  return rankedBySeed(
    ai.filter((franchiseId) => !usedFranchiseIds.includes(franchiseId)),
    (id) => tradeSeed(context.rootSeed, ...seedPath, 'franchise', id),
    (id) => id,
  );
}
export function generateHumanTradeOffer(
  context: OfferGenerationContext,
  seedPath: string[],
  usedFranchiseIds: readonly string[],
): SeasonTradeOffer | null {
  const { rootSeed } = context;
  const drawnKind = packageKindOf(tradeSeed(rootSeed, ...seedPath, 'size'));
  const kinds = kindOrderStartingAt(drawnKind);
  const franchises = rankedAiFranchises(context, seedPath, usedFranchiseIds);
  for (const aiFranchiseId of franchises) {
    let best: OfferCandidate | null = null;
    for (const kind of kinds) {
      for (let probe = 0; probe < OFFER_PROBE_BUDGET; probe += 1) {
        const candidate = humanOfferCandidate(context, seedPath, aiFranchiseId, kind, probe);
        if (candidate === null) continue;
        const inRange =
          candidate.rawRatio >= TRADE_VALUE_BAND.lower &&
          candidate.rawRatio <= TRADE_VALUE_BAND.upper;
        if (inRange) {
          best = candidate;
          break;
        }
        if (best === null || Math.abs(candidate.rawRatio - 1000) < Math.abs(best.rawRatio - 1000)) {
          best = candidate;
        }
      }
      if (best !== null) break;
    }
    if (best !== null) {
      return assembleHumanOffer(context, seedPath, best);
    }
  }
  return null;
}
function assembleHumanOffer(
  context: OfferGenerationContext,
  seedPath: string[],
  candidate: OfferCandidate,
): SeasonTradeOffer {
  const { run, windowIndex, humanFranchiseId, catalogFacts } = context;
  const offerId = `off-${tradeSeed(run.rootSeed, ...seedPath)}`;
  const humanRosterIds = rosterPlayerVersionIdsOf(run, humanFranchiseId);
  const aiRosterIds = rosterPlayerVersionIdsOf(run, candidate.aiFranchiseId);
  const humanAfter = swappedRosterIds(humanRosterIds, candidate.outgoing, candidate.incoming);
  const aiAfter = swappedRosterIds(aiRosterIds, candidate.incoming, candidate.outgoing);
  const rotation = run.rotations.find((entry) => entry.franchiseId === humanFranchiseId);
  const minutesById = new Map(
    (rotation?.targetMinutes ?? []).map((entry) => [entry.playerVersionId, entry.minutes]),
  );
  const outgoingFacts = candidate.outgoing
    .map((id) => `${id} (${String(minutesById.get(id) ?? 0)} min)`)
    .join(', ');
  const incomingFacts = candidate.incoming
    .map((id) => `${id} (${String(minutesById.get(id) ?? 16)} min)`)
    .join(', ');
  const incomingDepth = coverageDepthOf(humanAfter, candidate.incoming, catalogFacts);
  const outgoingDepth = coverageDepthOf(aiAfter, candidate.outgoing, catalogFacts);
  return buildTradeOfferRecord({
    run,
    catalogFacts,
    windowIndex,
    seedPath,
    offerId,
    toFranchiseId: humanFranchiseId,
    fromFranchiseId: candidate.aiFranchiseId,
    outgoing: candidate.outgoing,
    incoming: candidate.incoming,
    kind: candidate.kind,
    receivingFranchiseId: humanFranchiseId,
    candidateRosterIds: humanAfter,
    toAfterIds: humanAfter,
    fromAfterIds: aiAfter,
    beforeIds: humanRosterIds,
    afterIds: humanAfter,
    roleNotes: `${humanFranchiseId} sends ${candidate.outgoing.join(', ')}; ${candidate.aiFranchiseId} sends ${candidate.incoming.join(', ')}`,
    needNotes: `${humanFranchiseId} post-swap depth at the incoming primary group: ${String(incomingDepth)}; ${candidate.aiFranchiseId} post-swap depth at the outgoing primary group: ${String(outgoingDepth)}`,
    rotationText: [
      `${outgoingFacts} leave the ${humanFranchiseId} rotation`,
      `${incomingFacts} join by splitting the replaced players' target minutes`,
      'a side dealt below ten auto-signs replacement depth to ten',
      'starters/bench/closing five rebuilt deterministically by matchStartingFive',
    ].join('; '),
    status: 'open',
  });
}
export function generatedExtraOfferForSpend(
  rootSeed: string,
  run: SeasonEconomyRun,
  windowIndex: number,
  humanFranchiseId: string,
  catalog?: SeasonDraftCatalog,
): SeasonTradeOffer {
  if (catalog === undefined) {
    throw new SeasonTradeFactsError(
      'generatedExtraOfferForSpend requires the packaged catalog (player positions + ratings)',
    );
  }
  const context: OfferGenerationContext = {
    run,
    rootSeed,
    windowIndex,
    humanFranchiseId,
    catalog,
    catalogFacts: seasonTradeCatalogFactsOf(catalog, sponsorSlotsOf(run)),
  };
  const seedPath = ['window', String(windowIndex), 'extra-offer'];
  const priorOffers = (
    run.trade?.windows.find((window) => window.windowIndex === windowIndex)?.offers ?? []
  )
    .filter((offer) => offer.toFranchiseId === humanFranchiseId)
    .map((offer) => offer.fromFranchiseId);
  const offer = generateHumanTradeOffer(context, seedPath, priorOffers);
  if (offer === null) {
    throw new SeasonTradeInvariantError('extra-offer generation produced no legal candidate');
  }
  return offer;
}
function aiTradeCandidate(
  run: SeasonEconomyRun,
  context: OfferGenerationContext,
  attempt: number,
  usedPairs: ReadonlySet<string>,
  protectedPlayers: ReadonlySet<string>,
): {
  a: string;
  b: string;
  kind: SeasonTradePackageKind;
  outgoing: string[];
  incoming: string[];
  rawRatio: number;
} | null {
  const { rootSeed, windowIndex, catalogFacts } = context;
  const ai = aiFranchiseIdsOf(run, context.humanFranchiseId);
  const basePath = ['window', String(windowIndex), 'ai', String(attempt)];
  const a = rankedBySeed(
    ai,
    (id) => tradeSeed(rootSeed, ...basePath, 'a', id),
    (id) => id,
  )[0];
  if (a === undefined) return null;
  const b = rankedBySeed(
    ai.filter((id) => id !== a),
    (id) => tradeSeed(rootSeed, ...basePath, 'b', id),
    (id) => id,
  )[0];
  if (b === undefined) return null;
  const pairKey = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
  if (usedPairs.has(pairKey)) return null;
  const kind = packageKindOf(tradeSeed(rootSeed, ...basePath, 'size'));
  const rosterA = rosterPlayerVersionIdsOf(run, a);
  const rosterB = rosterPlayerVersionIdsOf(run, b);
  const evenKinds = kindOrderStartingAt(kind).filter((probeKind) => {
    const sizes = packageSizesOf(probeKind);
    return sizes.outgoing === sizes.incoming;
  });
  for (const probeKind of evenKinds) {
    const probeSizes = packageSizesOf(probeKind);
    const outgoing = pickDistinct(
      rosterA,
      (id) => tradeSeed(rootSeed, ...basePath, 'outgoing', id),
      (id) => id,
      probeSizes.outgoing,
    );
    const incoming = pickDistinct(
      rosterB,
      (id) => tradeSeed(rootSeed, ...basePath, 'incoming', id),
      (id) => id,
      probeSizes.incoming,
    );
    if (
      outgoing.some((id) => protectedPlayers.has(id)) ||
      incoming.some((id) => protectedPlayers.has(id))
    ) {
      continue;
    }
    const aAfter = swappedRosterIds(rosterA, outgoing, incoming);
    const bAfter = swappedRosterIds(rosterB, incoming, outgoing);
    const filled = fillTradeBackfill({
      catalog: context.catalog,
      run,
      toFranchiseId: b,
      fromFranchiseId: a,
      toIds: bAfter,
      fromIds: aAfter,
      seed: tradeSeed(rootSeed, ...basePath, 'backfill'),
    });
    if (filled === null) continue;
    if (
      !rosterIsLegal(filled.toIdsFilled, catalogFacts) ||
      !rosterIsLegal(filled.fromIdsFilled, catalogFacts)
    ) {
      continue;
    }
    const incomingValues = outgoing.map((id) =>
      seasonTradePlayerValue(id, {
        run,
        catalogFacts,
        receivingFranchiseId: b,
        candidateRosterIds: filled.toIdsFilled,
      }),
    );
    const outgoingValues = incoming.map((id) =>
      seasonTradePlayerValue(id, {
        run,
        catalogFacts,
        receivingFranchiseId: b,
        candidateRosterIds: filled.toIdsFilled,
      }),
    );
    const rawRatio = seasonTradePackageRatio({ outgoingValues, incomingValues });
    if (!ratioMutuallyWithinBand(rawRatio, probeKind)) continue;
    return { a, b, kind: probeKind, outgoing, incoming, rawRatio };
  }
  return null;
}
function assembleAiOffer(
  run: SeasonEconomyRun,
  context: OfferGenerationContext,
  candidate: {
    a: string;
    b: string;
    kind: SeasonTradePackageKind;
    outgoing: string[];
    incoming: string[];
  },
  attempt: number,
): SeasonTradeOffer {
  const { rootSeed, windowIndex, catalogFacts } = context;
  const seedPath = ['window', String(windowIndex), 'ai', String(attempt)];
  const offerId = `off-${tradeSeed(rootSeed, ...seedPath)}`;
  const rosterA = rosterPlayerVersionIdsOf(run, candidate.a);
  const rosterB = rosterPlayerVersionIdsOf(run, candidate.b);
  const bAfter = swappedRosterIds(rosterB, candidate.incoming, candidate.outgoing);
  const aAfter = swappedRosterIds(rosterA, candidate.outgoing, candidate.incoming);
  const outgoingDepth = coverageDepthOf(aAfter, candidate.incoming, catalogFacts);
  const incomingDepth = coverageDepthOf(bAfter, candidate.outgoing, catalogFacts);
  return buildTradeOfferRecord({
    run,
    catalogFacts,
    windowIndex,
    seedPath,
    offerId,
    toFranchiseId: candidate.b,
    fromFranchiseId: candidate.a,
    outgoing: candidate.incoming,
    incoming: candidate.outgoing,
    kind: candidate.kind,
    receivingFranchiseId: candidate.b,
    candidateRosterIds: bAfter,
    toAfterIds: bAfter,
    fromAfterIds: aAfter,
    beforeIds: rosterB,
    afterIds: bAfter,
    roleNotes: `${candidate.b} sends ${candidate.incoming.join(', ')} to ${candidate.a} for ${candidate.outgoing.join(', ')}`,
    needNotes: `${candidate.a} post-swap depth at the moved group: ${String(outgoingDepth)}; ${candidate.b} post-swap depth: ${String(incomingDepth)}`,
    rotationText: `AI-to-AI: ${candidate.a} and ${candidate.b} rotations rebuilt deterministically; vacated minutes split across joiners; short sides auto-sign depth to ten`,
    status: 'accepted',
  });
}
function priorAiTradeCount(run: SeasonRun, humanFranchiseId: string): number {
  let count = 0;
  for (const window of run.trade?.windows ?? []) {
    for (const offer of window.offers) {
      if (
        offer.toFranchiseId !== humanFranchiseId &&
        offer.fromFranchiseId !== humanFranchiseId &&
        offer.status === 'accepted'
      ) {
        count += 1;
      }
    }
  }
  return count;
}
function applyAiTrades(
  run: SeasonEconomyRun,
  rootSeed: string,
  windowIndex: number,
  catalog: SeasonDraftCatalog,
  humanFranchiseId: string,
  appliedAtStateRevision: number,
  protectedPlayers: ReadonlySet<string>,
): {
  run: SeasonEconomyRun;
  offers: SeasonTradeOffer[];
  transactions: SeasonTransactionEntry[];
} {
  const context: OfferGenerationContext = {
    run,
    rootSeed,
    windowIndex,
    humanFranchiseId,
    catalog,
    catalogFacts: seasonTradeCatalogFactsOf(catalog, sponsorSlotsOf(run)),
  };
  const target =
    3 +
    seedInt(tradeSeed(rootSeed, 'window', String(windowIndex), 'ai-target'), AI_TRADE_TARGET_RANGE);
  const seasonCap = Math.max(0, AI_TRADE_SEASON_CAP - priorAiTradeCount(run, humanFranchiseId));
  const budget = Math.min(target, seasonCap);
  const usedPairs = new Set<string>();
  const offers: SeasonTradeOffer[] = [];
  let working = run;
  let recorded = 0;
  let attempted = 0;
  while (recorded < budget && attempted < AI_TRADE_ATTEMPT_BUDGET) {
    const candidate = aiTradeCandidate(working, context, attempted, usedPairs, protectedPlayers);
    if (candidate !== null) {
      const offer = assembleAiOffer(working, context, candidate, attempted);
      const applied = applySeasonTrade(working, offer, catalog, {
        commandId: `ai-trade-${String(windowIndex)}-${String(recorded)}`,
        appliedAtStateRevision,
      });
      working = applied.run;
      offers.push(offer);
      usedPairs.add(
        candidate.a < candidate.b
          ? `${candidate.a}\u0000${candidate.b}`
          : `${candidate.b}\u0000${candidate.a}`,
      );
      recorded += 1;
    }
    attempted += 1;
  }
  return { run: working, offers, transactions: working.transactions };
}
export function openSeasonTradeWindow(
  input: SeasonOpenTradeWindowInput,
): SeasonWindowOpenResult | null {
  const { run, blockIndex, rootSeed, humanFranchiseId, catalog } = input;
  const windowIndex = WINDOW_BLOCK_INDEX_TO_INDEX[blockIndex];
  if (windowIndex === undefined || humanFranchiseId === null) return null;
  if (
    run.trade !== null &&
    run.trade.windows.some((window) => window.windowIndex === windowIndex)
  ) {
    return null;
  }
  if (catalog === undefined) {
    throw new SeasonTradeFactsError(
      'openSeasonTradeWindow requires the packaged catalog (player positions + ratings); the block runner supplies it',
    );
  }
  const economyRun = seasonEconomyRunOf(run, input.effects);
  const appliedAtStateRevision = run.stateRevision + 1;
  const context: OfferGenerationContext = {
    run: economyRun,
    rootSeed,
    windowIndex,
    humanFranchiseId,
    catalog,
    catalogFacts: seasonTradeCatalogFactsOf(catalog, sponsorSlotsOf(economyRun)),
  };
  const offers: SeasonTradeOffer[] = [];
  const usedFranchiseIds: string[] = [];
  for (let n = 0; n < 3; n += 1) {
    const seedPath = ['window', String(windowIndex), 'offer', String(n)];
    const offer = generateHumanTradeOffer(context, seedPath, usedFranchiseIds);
    if (offer !== null) {
      offers.push(offer);
      usedFranchiseIds.push(offer.fromFranchiseId);
    }
  }
  const spends = applyAiInfluenceSpends(
    economyRun,
    rootSeed,
    windowIndex,
    blockIndex,
    humanFranchiseId,
  );
  let working: SeasonEconomyRun = {
    ...economyRun,
    health: spends.health,
    influence: spends.influence,
  };
  const protectedPlayers = new Set<string>();
  for (const offer of offers) {
    for (const id of [...offer.outgoingPlayerVersionIds, ...offer.incomingPlayerVersionIds]) {
      protectedPlayers.add(id);
    }
  }
  const aiTrades = applyAiTrades(
    working,
    rootSeed,
    windowIndex,
    catalog,
    humanFranchiseId,
    appliedAtStateRevision,
    protectedPlayers,
  );
  working = aiTrades.run;
  offers.push(...aiTrades.offers);
  const board = generateTradeBoardProfiles({
    run: working,
    rootSeed,
    windowIndex,
    humanFranchiseId,
    catalogFacts: seasonTradeCatalogFactsOf(catalog, sponsorSlotsOf(working)),
  });
  const trade: SeasonTradeState = {
    schemaVersion: 1,
    tradeVersion: SEASON_TRADE_VERSION,
    windows: [
      ...(run.trade?.windows ?? []),
      {
        windowIndex,
        blockIndex,
        status: 'open',
        offers,
        boardProfiles: board.boardProfiles,
        canonicalTeamOrder: board.canonicalTeamOrder,
        inquiryAllowance: 3,
        activeInquiryId: null,
        negotiations: [],
        valueTrends: board.valueTrends,
      },
    ],
  };
  const priorTransactionCount = run.transactions.length;
  const next: SeasonEconomyRun = {
    ...working,
    trade,
    transactions: [
      ...run.transactions,
      ...spends.transactions,
      ...aiTrades.transactions.slice(priorTransactionCount),
    ],
    stateRevision: run.stateRevision + 1,
    stateDigest: '',
  };
  const stateDigest = seasonRunStateDigest(seasonRunStateDigestFactsOf(next, next.effects));
  return {
    trade,
    influence: next.influence,
    transactions: next.transactions,
    rosters: next.rosters,
    ownership: next.ownership,
    rotations: next.rotations,
    effects: next.effects,
    health: next.health,
    stateRevision: next.stateRevision,
    stateDigest,
  };
}
export interface SeasonTradeApplicationOptions {
  commandId?: string | null;
  appliedAtStateRevision?: number;
}
export interface SeasonTradeApplicationResult {
  run: SeasonEconomyRun;
  rosterChanges: SeasonTradeRosterChange[];
}
export function applySeasonTrade(
  run: SeasonEconomyRun,
  offer: SeasonTradeOffer,
  catalog?: SeasonDraftCatalog,
  options: SeasonTradeApplicationOptions = {},
): SeasonTradeApplicationResult {
  if (catalog === undefined) {
    throw new SeasonTradeFactsError(
      'applySeasonTrade requires the packaged catalog (player positions + ratings); the command layer supplies it',
    );
  }
  const facts = seasonTradeCatalogFactsOf(catalog, sponsorSlotsOf(run));
  const { toFranchiseId, fromFranchiseId } = offer;
  if (toFranchiseId === fromFranchiseId) {
    throw new SeasonTradeInvariantError('a trade must involve two distinct franchises');
  }
  const outgoing = offer.outgoingPlayerVersionIds;
  const incoming = offer.incomingPlayerVersionIds;
  if (
    outgoing.length === 0 ||
    outgoing.length > SEASON_TRADE_PACKAGE_MAX ||
    incoming.length === 0 ||
    incoming.length > SEASON_TRADE_PACKAGE_MAX
  ) {
    throw new SeasonTradeInvariantError(
      `a trade must move one to ${String(SEASON_TRADE_PACKAGE_MAX)} players on each side`,
    );
  }
  const rosterEntriesByFranchise = new Map(
    run.rosters.map((roster) => [roster.franchiseId, roster]),
  );
  const toRoster = rosterEntriesByFranchise.get(toFranchiseId);
  const fromRoster = rosterEntriesByFranchise.get(fromFranchiseId);
  if (toRoster === undefined || fromRoster === undefined) {
    throw new SeasonTradeInvariantError('a trade references an unknown franchise');
  }
  const toIds = new Set(toRoster.players.map((player) => player.playerVersionId));
  const fromIds = new Set(fromRoster.players.map((player) => player.playerVersionId));
  for (const id of outgoing) {
    if (!toIds.has(id)) {
      throw new SeasonTradeInvariantError(`${id} is not on the ${toFranchiseId} roster`);
    }
  }
  for (const id of incoming) {
    if (!fromIds.has(id)) {
      throw new SeasonTradeInvariantError(`${id} is not on the ${fromFranchiseId} roster`);
    }
  }
  const ownershipByVersion = new Map(
    run.ownership.map((row) => [row.playerVersionId, row.ownerFranchiseId]),
  );
  const moved = [...outgoing, ...incoming];
  for (const id of moved) {
    const expectedOwner = outgoing.includes(id) ? toFranchiseId : fromFranchiseId;
    if (ownershipByVersion.get(id) !== expectedOwner) {
      throw new SeasonTradeInvariantError(
        `ownership conflict: ${id} is owned by ${String(ownershipByVersion.get(id))}, offer expects ${expectedOwner}`,
      );
    }
  }
  const toEntriesRaw = [
    ...toRoster.players.filter((player) => !outgoing.includes(player.playerVersionId)),
    ...fromRoster.players.filter((player) => incoming.includes(player.playerVersionId)),
  ];
  const fromEntriesRaw = [
    ...fromRoster.players.filter((player) => !incoming.includes(player.playerVersionId)),
    ...toRoster.players.filter((player) => outgoing.includes(player.playerVersionId)),
  ];
  const backfill = fillTradeBackfill({
    catalog,
    run,
    toFranchiseId,
    fromFranchiseId,
    toIds: toEntriesRaw.map((player) => player.playerVersionId),
    fromIds: fromEntriesRaw.map((player) => player.playerVersionId),
    seed: tradeOfferBackfillSeed(run.rootSeed, offer.seedPath),
  });
  if (backfill === null) {
    throw new SeasonTradeInvariantError(
      'trade leaves a roster below ten players with no backfill available',
    );
  }
  const toEntries = [...toEntriesRaw, ...backfill.toBackfill];
  const fromEntries = [...fromEntriesRaw, ...backfill.fromBackfill];
  const toBackfillIds = backfill.toBackfill.map((player) => player.playerVersionId);
  const fromBackfillIds = backfill.fromBackfill.map((player) => player.playerVersionId);
  const toIdsAfter = toEntries.map((player) => player.playerVersionId);
  const fromIdsAfter = fromEntries.map((player) => player.playerVersionId);
  const legalityFailures = [
    ...tradeRosterLegalityReasons(toIdsAfter, facts).map((reason) => `${toFranchiseId}: ${reason}`),
    ...tradeRosterLegalityReasons(fromIdsAfter, facts).map(
      (reason) => `${fromFranchiseId}: ${reason}`,
    ),
  ];
  if (legalityFailures.length > 0) {
    throw new SeasonTradeInvariantError(
      `traded rosters fail legality: ${legalityFailures.join('; ')}`,
    );
  }
  const ownership = [
    ...run.ownership.map((row) =>
      moved.includes(row.playerVersionId)
        ? {
            ...row,
            ownerFranchiseId: outgoing.includes(row.playerVersionId)
              ? fromFranchiseId
              : toFranchiseId,
          }
        : row,
    ),
    ...toBackfillIds.map((playerVersionId) => ({
      playerVersionId,
      ownerFranchiseId: toFranchiseId,
    })),
    ...fromBackfillIds.map((playerVersionId) => ({
      playerVersionId,
      ownerFranchiseId: fromFranchiseId,
    })),
  ];
  const rotations = run.rotations.map((rotation) => {
    if (rotation.franchiseId === toFranchiseId) {
      return repairRotationAfterTrade(rotation, facts, toIdsAfter, outgoing);
    }
    if (rotation.franchiseId === fromFranchiseId) {
      return repairRotationAfterTrade(rotation, facts, fromIdsAfter, incoming);
    }
    return rotation;
  });
  const rotationMembersBefore = new Set([
    ...(run.rotations.find((rotation) => rotation.franchiseId === toFranchiseId)?.starters ?? []),
    ...(run.rotations.find((rotation) => rotation.franchiseId === toFranchiseId)?.benchOrder ?? []),
    ...(run.rotations.find((rotation) => rotation.franchiseId === fromFranchiseId)?.starters ?? []),
    ...(run.rotations.find((rotation) => rotation.franchiseId === fromFranchiseId)?.benchOrder ??
      []),
  ]);
  const movedSet = new Set(moved);
  const activeMoved = moved.some((id) => rotationMembersBefore.has(id));
  const backfilled = toBackfillIds.length > 0 || fromBackfillIds.length > 0;
  let effects: SeasonEffectsState = run.effects;
  if (activeMoved || backfilled) {
    const nextRosters = run.rosters.map((roster) =>
      roster.franchiseId === toFranchiseId
        ? { ...roster, players: toEntries }
        : roster.franchiseId === fromFranchiseId
          ? { ...roster, players: fromEntries }
          : roster,
    );
    effects = reconcileSeasonEffects({
      previous: run.effects,
      rosters: nextRosters,
      rotations,
    });
    effects = {
      ...effects,
      archivedPairs: effects.archivedPairs.filter(
        (pair) => !movedSet.has(pair.a) && !movedSet.has(pair.b),
      ),
    };
  }
  const health: SeasonHealthState = {
    ...run.health,
    injuries: run.health.injuries.map((injury) =>
      moved.includes(injury.playerVersionId)
        ? {
            ...injury,
            franchiseId: outgoing.includes(injury.playerVersionId)
              ? fromFranchiseId
              : toFranchiseId,
          }
        : injury,
    ),
  };
  const windowBlockIndex =
    run.trade?.windows.find((window) => window.windowIndex === offer.windowIndex)?.blockIndex ??
    null;
  const entry = seasonTransactionEntry({
    transactionId: `txn-trade-${offer.offerId}`,
    commandId: options.commandId ?? null,
    franchiseId: null,
    type: 'trade',
    blockIndex: windowBlockIndex,
    appliedAtStateRevision: options.appliedAtStateRevision ?? run.stateRevision + 1,
    payload: {
      toFranchiseId,
      fromFranchiseId,
      outgoingPlayerVersionIds: outgoing,
      incomingPlayerVersionIds: incoming,
      backfillToPlayerVersionIds: toBackfillIds,
      backfillFromPlayerVersionIds: fromBackfillIds,
      offerId: offer.offerId,
      seedPath: offer.seedPath,
    },
    explanation: backfilled
      ? `Trade: ${toFranchiseId} receives ${incoming.join(', ')} for ${outgoing.join(', ')} (backfill: ${[...toBackfillIds, ...fromBackfillIds].join(', ')})`
      : `Trade: ${toFranchiseId} receives ${incoming.join(', ')} for ${outgoing.join(', ')}`,
  });
  let trade = run.trade;
  if (trade !== null) {
    trade = {
      ...trade,
      windows: trade.windows.map((window) =>
        window.windowIndex === offer.windowIndex
          ? {
              ...window,
              offers: window.offers.map((recorded) =>
                recorded.offerId === offer.offerId
                  ? { ...recorded, status: 'accepted' as const }
                  : recorded,
              ),
            }
          : window,
      ),
    };
  }
  const next: SeasonEconomyRun = {
    ...run,
    rosters: run.rosters.map((roster) =>
      roster.franchiseId === toFranchiseId
        ? { ...roster, players: toEntries }
        : roster.franchiseId === fromFranchiseId
          ? { ...roster, players: fromEntries }
          : roster,
    ),
    ownership,
    rotations,
    effects,
    health,
    transactions: [...run.transactions, entry],
    trade,
  };
  return {
    run: next,
    rosterChanges: [
      {
        franchiseId: toFranchiseId,
        added: [...incoming, ...toBackfillIds],
        removed: [...outgoing],
      },
      {
        franchiseId: fromFranchiseId,
        added: [...outgoing, ...fromBackfillIds],
        removed: [...incoming],
      },
    ],
  };
}
function repairRotationAfterTrade(
  oldRotation: SeasonRotation,
  facts: SeasonTradeCatalogFacts,
  newRosterIds: readonly string[],
  movedOut: readonly string[],
): SeasonRotation {
  const members: SeasonRosterMemberInput[] = newRosterIds.map((playerVersionId) => ({
    playerVersionId,
    playable: facts.playable.get(playerVersionId) ?? [],
  }));
  const rotationIds = new Set([...oldRotation.starters, ...oldRotation.benchOrder]);
  const retained: SeasonRosterMemberInput[] = members.filter((member) =>
    rotationIds.has(member.playerVersionId),
  );
  const rotationMembers = [
    ...retained,
    ...members
      .filter((member) => !rotationIds.has(member.playerVersionId))
      .sort((a, b) => {
        const groupsOf = (member: SeasonRosterMemberInput) => {
          const groups = new Set<SlotGroup>();
          for (const position of member.playable) groups.add(slotGroupOf(position));
          return (['G', 'F', 'C'] as const).filter((group) => groups.has(group)).length;
        };
        const groupsA = groupsOf(a);
        const groupsB = groupsOf(b);
        if (groupsA !== groupsB) return groupsB - groupsA;
        return a.playerVersionId < b.playerVersionId ? -1 : 1;
      }),
  ].slice(0, 10);
  if (rotationMembers.length !== 10) {
    throw new SeasonTradeInvariantError(
      `rotation repair for ${oldRotation.franchiseId} could not select ten members`,
    );
  }
  const base = buildMinimalRotation({
    franchiseId: oldRotation.franchiseId,
    members: rotationMembers,
  });
  const minutesById = new Map(
    oldRotation.targetMinutes.map((entry) => [entry.playerVersionId, entry.minutes]),
  );
  const vacated = movedOut.reduce((sum, id) => sum + (minutesById.get(id) ?? 0), 0);
  const rotationMemberIds = rotationMembers.map((member) => member.playerVersionId);
  const retainedIds = new Set(retained.map((member) => member.playerVersionId));
  const newFaceIds = rotationMemberIds.filter((id) => !retainedIds.has(id));
  const recipientIds = newFaceIds.length > 0 ? newFaceIds : [];
  const shares = splitMinutesEvenly(vacated, recipientIds.length);
  const shareById = new Map(recipientIds.map((id, index) => [id, shares[index] ?? 0]));
  const targetMinutes = rotationMemberIds.map((playerVersionId) => {
    const share = shareById.get(playerVersionId);
    if (share !== undefined) return { playerVersionId, minutes: share };
    return { playerVersionId, minutes: minutesById.get(playerVersionId) ?? 16 };
  });
  const rotation: SeasonRotation = { ...base, targetMinutes };
  const memberPlayable = new Map<string, readonly Position[]>();
  for (const playerVersionId of rotationMemberIds) {
    const playable = facts.playable.get(playerVersionId);
    if (playable !== undefined) memberPlayable.set(playerVersionId, playable);
  }
  const failures = validateSeasonRotation(rotation, memberPlayable);
  if (failures.length > 0) {
    throw new SeasonTradeInvariantError(
      `rotation repair for ${oldRotation.franchiseId} failed: ${failures.join('; ')}`,
    );
  }
  return rotation;
}
function splitMinutesEvenly(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}
