import {
  SEASON_SEED_NAMESPACES,
  SEASON_TRADE_VERSION,
  franchiseIdSchema,
  seasonNamespaceSeed,
  type Position,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonRoster,
  type SeasonRotation,
  type SeasonRun,
  type SeasonTradeBoardTeamProfile,
  type SeasonTradeNeed,
  type SeasonTradeOffer,
  type SeasonTradeOfferValueBand,
  type SeasonTradePriority,
  type SeasonTradeRosterChange,
  type SeasonTradeState,
  type SeasonTradeValueTrend,
  type SeasonTradeWindowState,
  type SeasonTransactionEntry,
  type SimulationRatings,
} from '@hoop-rush/data-contracts';
import { slotGroupOf, type SlotGroup } from '../domain/positions.ts';
import { createRng, shuffle } from '../sim/rng.ts';
import { canonicalPlayerPairs } from './chemistry.ts';
import { reconcileSeasonEffects } from './effects.ts';
import { applyRiskyRehabOutcome, rollSeasonRehabOutcome } from './injuries.ts';
import { applySeasonInfluenceSpend } from './influence.ts';
import { buildMinimalRotation, validateSeasonRotation } from './rotation.ts';
import { validateSeasonRoster, type SeasonRosterMemberInput } from './roster-rules.ts';
import { SEASON_ROSTER_MAX_SIZE, SEASON_ROSTER_MIN_SIZE } from '@hoop-rush/data-contracts';
import { drawHexInt } from './season-seeds.ts';
import { seasonRunStateDigest } from './state-digest.ts';
import { seasonTransactionEntry } from './transactions.ts';
export const WINDOW_BLOCK_INDEX_TO_INDEX: Readonly<Record<number, number>> = {
  2: 0,
  4: 1,
  5: 2,
};
export const TRADE_BAND_1V1 = { lower: 850, upper: 1150 } as const;
export const TRADE_BAND_DEFAULT = { lower: 800, upper: 1200 } as const;
const RATIO_SCHEMA_BOUNDS = { lower: 800, upper: 1200 } as const;
export type SeasonTradePackageKind = '1-1' | '2-2' | '1-2' | '2-1';
function packageKindOf(seed: string): SeasonTradePackageKind {
  const draw = seedInt(seed, 100);
  if (draw < 40) return '1-1';
  if (draw < 70) return '2-2';
  if (draw < 85) return '1-2';
  return '2-1';
}
export function packageSizesOf(kind: SeasonTradePackageKind): {
  outgoing: number;
  incoming: number;
} {
  if (kind === '1-1') return { outgoing: 1, incoming: 1 };
  if (kind === '2-2') return { outgoing: 2, incoming: 2 };
  if (kind === '1-2') return { outgoing: 1, incoming: 2 };
  return { outgoing: 2, incoming: 1 };
}
const VALUE_OFFENSE_WEIGHT = 0.45;
const VALUE_DEFENSE_WEIGHT = 0.4;
const VALUE_PHYSICAL_WEIGHT = 0.15;
const VALUE_UNAVAILABLE_FACTOR = 0.7;
const VALUE_WORKLOAD_MAX_PENALTY = 0.15;
const VALUE_ROLE_FIT_BONUS_PER_SHORTAGE = 0.02;
const VALUE_ROLE_FIT_NEUTRAL_DEPTH = 3;
const AI_EXTRA_OFFER_WILLINGNESS_PERCENT = 25;
const AI_REHAB_WILLINGNESS_PERCENT = 30;
const AI_TRADE_TARGET_RANGE = 4;
const AI_TRADE_ATTEMPT_BUDGET = 40;
const AI_TRADE_SEASON_CAP = 15;
const OFFER_PROBE_BUDGET = 7;
export class SeasonTradeFactsError extends Error {
  constructor(message: string) {
    super(`season trades: ${message}`);
    this.name = 'SeasonTradeFactsError';
  }
}
export class SeasonTradeInvariantError extends Error {
  constructor(message: string) {
    super(`season trades invariant: ${message}`);
    this.name = 'SeasonTradeInvariantError';
  }
}
export type SeasonEconomyRun = SeasonRun & {
  effects: SeasonEffectsState;
};
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
export interface SeasonTradeCatalogFacts {
  playable: ReadonlyMap<string, readonly Position[]>;
  ratings: ReadonlyMap<string, SimulationRatings>;
  primary: ReadonlyMap<string, Position>;
}
export function seasonTradeCatalogFactsOf(catalog: SeasonDraftCatalog): SeasonTradeCatalogFacts {
  const playable = new Map<string, readonly Position[]>();
  const ratings = new Map<string, SimulationRatings>();
  const primary = new Map<string, Position>();
  for (const candidate of catalog.candidates) {
    playable.set(candidate.playerVersionId, candidate.positions.playable);
    ratings.set(candidate.playerVersionId, candidate.detailedRatings);
    primary.set(candidate.playerVersionId, candidate.positions.primary);
  }
  return { playable, ratings, primary };
}
export interface SeasonTradePlayerHealthFacts {
  available: boolean;
  activeInjuryIds: string[];
}
export function seasonTradePlayerHealthFacts(
  health: SeasonHealthState,
  playerVersionId: string,
): SeasonTradePlayerHealthFacts {
  const activeInjuryIds = health.injuries
    .filter(
      (injury) =>
        injury.playerVersionId === playerVersionId &&
        injury.sameGameReturned !== true &&
        injury.missedGamesRemaining > 0,
    )
    .map((injury) => injury.injuryId);
  return { available: activeInjuryIds.length === 0, activeInjuryIds };
}
export function seasonEconomyRunOf(run: SeasonRun, effects?: SeasonEffectsState): SeasonEconomyRun {
  if (effects !== undefined) return { ...run, effects };
  if ('effects' in run && run.effects !== undefined) {
    return run as SeasonEconomyRun;
  }
  throw new SeasonTradeFactsError(
    'the effects state is required (the persistence record keeps it beside the run snapshot)',
  );
}
export interface SeasonTradeValueContext {
  run: SeasonEconomyRun;
  catalogFacts: SeasonTradeCatalogFacts;
  receivingFranchiseId: string;
  candidateRosterIds?: readonly string[];
}
export function seasonTradePlayerValue(
  playerVersionId: string,
  context: SeasonTradeValueContext,
): number {
  const ratings = context.catalogFacts.ratings.get(playerVersionId);
  if (ratings === undefined) {
    throw new SeasonTradeFactsError(`no detailed ratings for ${playerVersionId}`);
  }
  const mean = (...values: number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const offense = mean(
    ratings.insideScoring,
    ratings.closeShot,
    ratings.midrange,
    ratings.threePoint,
    ratings.freeThrow,
    ratings.ballHandling,
    ratings.passing,
    ratings.offensiveIq,
  );
  const defense = mean(
    ratings.perimeterDefense,
    ratings.interiorDefense,
    ratings.steal,
    ratings.block,
    ratings.defensiveIq,
    ratings.offensiveRebound,
    ratings.defensiveRebound,
  );
  const physical = mean(ratings.speed, ratings.strength, ratings.vertical);
  const contribution =
    VALUE_OFFENSE_WEIGHT * offense +
    VALUE_DEFENSE_WEIGHT * defense +
    VALUE_PHYSICAL_WEIGHT * physical;
  const availabilityFactor = seasonTradePlayerHealthFacts(context.run.health, playerVersionId)
    .available
    ? 1
    : VALUE_UNAVAILABLE_FACTOR;
  const load =
    context.run.effects.playerStates.find((player) => player.playerVersionId === playerVersionId)
      ?.recentLoadBasisPoints ?? 0;
  const workloadFactor = 1 - (VALUE_WORKLOAD_MAX_PENALTY * load) / 10000;
  const primary = context.catalogFacts.primary.get(playerVersionId);
  let roleFitFactor = 1;
  if (primary !== undefined) {
    const group = slotGroupOf(primary);
    const roster =
      context.candidateRosterIds ??
      rosterPlayerVersionIdsOf(context.run, context.receivingFranchiseId);
    let groupDepth = 0;
    for (const id of roster) {
      const playable = context.catalogFacts.playable.get(id);
      if (playable !== undefined && canPlayGroup(playable, group)) groupDepth += 1;
    }
    roleFitFactor =
      1 +
      VALUE_ROLE_FIT_BONUS_PER_SHORTAGE * Math.max(0, VALUE_ROLE_FIT_NEUTRAL_DEPTH - groupDepth);
  }
  const value = contribution * availabilityFactor * workloadFactor * roleFitFactor;
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}
function canPlayGroup(playable: readonly Position[], group: SlotGroup): boolean {
  return playable.some((position) => slotGroupOf(position) === group);
}
export function seasonTradeValueBandFor(input: {
  kind: SeasonTradePackageKind;
  outgoingValues: readonly number[];
  incomingValues: readonly number[];
}): SeasonTradeOfferValueBand {
  const outgoing = input.outgoingValues.reduce((sum, value) => sum + value, 0);
  const incoming = input.incomingValues.reduce((sum, value) => sum + value, 0);
  if (outgoing <= 0) throw new SeasonTradeInvariantError('outgoing trade value must be positive');
  const raw = Math.round((1000 * incoming) / outgoing);
  const ratioBasisPoints = Math.min(
    RATIO_SCHEMA_BOUNDS.upper,
    Math.max(RATIO_SCHEMA_BOUNDS.lower, raw),
  );
  const bounds = input.kind === '1-1' ? TRADE_BAND_1V1 : TRADE_BAND_DEFAULT;
  const qualified = ratioBasisPoints >= bounds.lower && ratioBasisPoints <= bounds.upper;
  return {
    ratioBasisPoints,
    band: input.kind === '1-1' ? '85-115' : '80-120',
    qualified,
  };
}
export function ratioMutuallyWithinBand(
  ratioBasisPoints: number,
  kind: SeasonTradePackageKind,
): boolean {
  const bounds = kind === '1-1' ? TRADE_BAND_1V1 : TRADE_BAND_DEFAULT;
  if (ratioBasisPoints < bounds.lower || ratioBasisPoints > bounds.upper) return false;
  const reciprocal = Math.ceil(1000000 / ratioBasisPoints);
  return reciprocal >= bounds.lower && reciprocal <= bounds.upper;
}
export function rosterPlayerVersionIdsOf(run: SeasonRun, franchiseId: string): string[] {
  const roster = run.rosters.find((entry) => entry.franchiseId === franchiseId);
  if (roster === undefined) throw new SeasonTradeInvariantError(`unknown roster ${franchiseId}`);
  return roster.players.map((player) => player.playerVersionId);
}
function aiFranchiseIdsOf(run: SeasonRun, humanFranchiseId: string): string[] {
  const authority = run.authority;
  if (authority.kind === 'season-multiplayer') {
    const excluded = new Set([authority.p1.franchiseId, authority.p2.franchiseId]);
    return run.league.teams
      .map((team) => team.franchiseId)
      .filter((franchiseId) => !excluded.has(franchiseId))
      .sort();
  }
  return run.league.teams
    .map((team) => team.franchiseId)
    .filter((franchiseId) => franchiseId !== humanFranchiseId)
    .sort();
}
function tradeSeed(rootSeed: string, ...keys: string[]): string {
  return seasonNamespaceSeed(rootSeed, SEASON_SEED_NAMESPACES.trades, ...keys);
}
function seedInt(seed: string, modulus: number): number {
  return drawHexInt(seed) % modulus;
}
function rankedBySeed<T>(
  items: readonly T[],
  seedOf: (item: T) => string,
  keyOf: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => {
    const seedA = seedOf(a);
    const seedB = seedOf(b);
    if (seedA !== seedB) return seedA < seedB ? -1 : 1;
    const keyA = keyOf(a);
    const keyB = keyOf(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
}
function pickDistinct<T>(
  items: readonly T[],
  seedOf: (item: T) => string,
  keyOf: (item: T) => string,
  k: number,
): T[] {
  if (k < 1 || k > items.length) {
    throw new SeasonTradeInvariantError(
      `cannot pick ${String(k)} of ${String(items.length)} items`,
    );
  }
  return rankedBySeed(items, seedOf, keyOf).slice(0, k);
}
function primaryGroupOf(facts: SeasonTradeCatalogFacts, playerVersionId: string): SlotGroup | null {
  const primary = facts.primary.get(playerVersionId);
  return primary === undefined ? null : slotGroupOf(primary);
}
function slotGroupsOf(facts: SeasonTradeCatalogFacts, playerVersionId: string): SlotGroup[] {
  const playable = facts.playable.get(playerVersionId);
  if (playable === undefined) return [];
  const groups = new Set<SlotGroup>();
  for (const position of playable) groups.add(slotGroupOf(position));
  return (['G', 'F', 'C'] as const).filter((group) => groups.has(group));
}
function swappedRosterIds(
  rosterIds: readonly string[],
  removed: readonly string[],
  added: readonly string[],
): string[] {
  return [...rosterIds.filter((id) => !removed.includes(id)), ...added];
}
function rosterIsLegal(rosterIds: readonly string[], facts: SeasonTradeCatalogFacts): boolean {
  return rosterLegalityReasons(rosterIds, facts).length === 0;
}
function rosterLegalityReasons(
  rosterIds: readonly string[],
  facts: SeasonTradeCatalogFacts,
): string[] {
  const failures: string[] = [];
  if (rosterIds.length < SEASON_ROSTER_MIN_SIZE || rosterIds.length > SEASON_ROSTER_MAX_SIZE) {
    failures.push(`roster must hold 10-15 players (got ${String(rosterIds.length)})`);
  }
  if (new Set(rosterIds).size !== rosterIds.length) {
    failures.push('roster must contain distinct playerVersionIds');
  }
  const members: SeasonRosterMemberInput[] = rosterIds.map((playerVersionId) => ({
    playerVersionId,
    playable: facts.playable.get(playerVersionId) ?? [],
  }));
  if (!rotationSubsetExists(members)) {
    failures.push('roster has no legal ten-player rotation subset');
  }
  return failures;
}
function rotationSubsetExists(members: readonly SeasonRosterMemberInput[]): boolean {
  if (members.length < 10) return false;
  const extras = members.length - 10;
  if (extras === 0) {
    return validateTenMemberRotation(members);
  }
  const byId = new Map(members.map((member) => [member.playerVersionId, member]));
  const ids = [...members.map((member) => member.playerVersionId)].sort();
  const total = 1 << ids.length;
  for (let mask = 0; mask < total; mask += 1) {
    if (bitCount(mask) !== extras) continue;
    const subset: SeasonRosterMemberInput[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      if ((mask & (1 << i)) === 0) {
        const member = byId.get(ids[i] as string);
        if (member !== undefined) subset.push(member);
      }
    }
    if (subset.length === 10 && validateTenMemberRotation(subset)) return true;
  }
  return false;
}
function bitCount(value: number): number {
  let count = 0;
  let v = value;
  while (v > 0) {
    count += v & 1;
    v >>= 1;
  }
  return count;
}
function validateTenMemberRotation(members: readonly SeasonRosterMemberInput[]): boolean {
  return validateSeasonRoster(members).length === 0;
}
interface OfferGenerationContext {
  run: SeasonEconomyRun;
  rootSeed: string;
  windowIndex: number;
  humanFranchiseId: string;
  catalogFacts: SeasonTradeCatalogFacts;
}
interface OfferCandidate {
  aiFranchiseId: string;
  kind: SeasonTradePackageKind;
  outgoing: string[];
  incoming: string[];
  rawRatio: number;
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
  if (!rosterIsLegal(humanAfter, catalogFacts) || !rosterIsLegal(aiAfter, catalogFacts)) {
    return null;
  }
  const outgoingValues = outgoing.map((id) =>
    seasonTradePlayerValue(id, {
      run,
      catalogFacts,
      receivingFranchiseId: humanFranchiseId,
      candidateRosterIds: humanAfter,
    }),
  );
  const incomingValues = incoming.map((id) =>
    seasonTradePlayerValue(id, {
      run,
      catalogFacts,
      receivingFranchiseId: humanFranchiseId,
      candidateRosterIds: humanAfter,
    }),
  );
  const rawRatio = Math.round(
    (1000 * incomingValues.reduce((sum, value) => sum + value, 0)) /
      outgoingValues.reduce((sum, value) => sum + value, 0),
  );
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
function kindOrderStartingAt(kind: SeasonTradePackageKind): SeasonTradePackageKind[] {
  const order: SeasonTradePackageKind[] = ['1-1', '2-2', '1-2', '2-1'];
  const start = order.indexOf(kind);
  return [...order.slice(start), ...order.slice(0, start)];
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
          candidate.rawRatio >= RATIO_SCHEMA_BOUNDS.lower &&
          candidate.rawRatio <= RATIO_SCHEMA_BOUNDS.upper;
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
  const outgoingValues = candidate.outgoing.map((id) =>
    seasonTradePlayerValue(id, {
      run,
      catalogFacts,
      receivingFranchiseId: humanFranchiseId,
      candidateRosterIds: humanAfter,
    }),
  );
  const incomingValues = candidate.incoming.map((id) =>
    seasonTradePlayerValue(id, {
      run,
      catalogFacts,
      receivingFranchiseId: humanFranchiseId,
      candidateRosterIds: humanAfter,
    }),
  );
  const valueBand = seasonTradeValueBandFor({
    kind: candidate.kind,
    outgoingValues,
    incomingValues,
  });
  const outgoingHealth = candidate.outgoing.map((id) =>
    seasonTradePlayerHealthFacts(run.health, id),
  );
  const incomingHealth = candidate.incoming.map((id) =>
    seasonTradePlayerHealthFacts(run.health, id),
  );
  const outgoingRoles = candidate.outgoing.map((id) => slotGroupsOf(catalogFacts, id).join('/'));
  const incomingRoles = candidate.incoming.map((id) => slotGroupsOf(catalogFacts, id).join('/'));
  const roleFit = {
    outgoingRoles,
    incomingRoles,
    notes: `${humanFranchiseId} sends ${candidate.outgoing.join(', ')}; ${candidate.aiFranchiseId} sends ${candidate.incoming.join(', ')}`,
  };
  const incomingDepth = coverageDepthOf(humanAfter, candidate.incoming, catalogFacts);
  const outgoingDepth = coverageDepthOf(aiAfter, candidate.outgoing, catalogFacts);
  const rosterNeedFacts = {
    outgoingDepth,
    incomingDepth,
    notes: `${humanFranchiseId} post-swap depth at the incoming primary group: ${String(incomingDepth)}; ${candidate.aiFranchiseId} post-swap depth at the outgoing primary group: ${String(outgoingDepth)}`,
  };
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
  const projectedRotationChanges = [
    `${outgoingFacts} leave the ${humanFranchiseId} rotation`,
    `${incomingFacts} join with the replaced players' target minutes`,
    'starters/bench/closing five rebuilt deterministically by matchStartingFive',
  ].join('; ');
  const removedPairs = canonicalPlayerPairs(humanRosterIds).filter(
    ([a, b]) => candidate.outgoing.includes(a) || candidate.outgoing.includes(b),
  ).length;
  const newPairs = canonicalPlayerPairs(humanAfter).filter(
    ([a, b]) => candidate.incoming.includes(a) || candidate.incoming.includes(b),
  ).length;
  const projectedChemistryDisruption = { removedPairs, newPairs };
  return {
    offerId,
    windowIndex,
    seedPath,
    toFranchiseId: franchiseIdSchema.parse(humanFranchiseId),
    fromFranchiseId: franchiseIdSchema.parse(candidate.aiFranchiseId),
    outgoingPlayerVersionIds: candidate.outgoing,
    incomingPlayerVersionIds: candidate.incoming,
    outgoingHealth,
    incomingHealth,
    valueBand,
    roleFit,
    rosterNeedFacts,
    projectedRotationChanges,
    projectedChemistryDisruption,
    status: 'open',
  };
}
function coverageDepthOf(
  rosterIds: readonly string[],
  movedIn: readonly string[],
  facts: SeasonTradeCatalogFacts,
): number {
  const groups = new Set<SlotGroup>();
  for (const id of movedIn) {
    const group = primaryGroupOf(facts, id);
    if (group !== null) groups.add(group);
  }
  if (groups.size === 0) return 0;
  let depth = 0;
  for (const id of rosterIds) {
    const playable = facts.playable.get(id);
    if (playable === undefined) continue;
    if ([...groups].some((group) => canPlayGroup(playable, group))) depth += 1;
  }
  return depth;
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
    catalogFacts: seasonTradeCatalogFactsOf(catalog),
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
  for (const probeKind of kindOrderStartingAt(kind)) {
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
    if (!rosterIsLegal(aAfter, catalogFacts) || !rosterIsLegal(bAfter, catalogFacts)) {
      continue;
    }
    const incomingValues = outgoing.map((id) =>
      seasonTradePlayerValue(id, {
        run,
        catalogFacts,
        receivingFranchiseId: b,
        candidateRosterIds: bAfter,
      }),
    );
    const outgoingValues = incoming.map((id) =>
      seasonTradePlayerValue(id, {
        run,
        catalogFacts,
        receivingFranchiseId: b,
        candidateRosterIds: bAfter,
      }),
    );
    const rawRatio = Math.round(
      (1000 * incomingValues.reduce((sum, value) => sum + value, 0)) /
        outgoingValues.reduce((sum, value) => sum + value, 0),
    );
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
  const outgoingValues = candidate.incoming.map((id) =>
    seasonTradePlayerValue(id, {
      run,
      catalogFacts,
      receivingFranchiseId: candidate.b,
      candidateRosterIds: bAfter,
    }),
  );
  const incomingValues = candidate.outgoing.map((id) =>
    seasonTradePlayerValue(id, {
      run,
      catalogFacts,
      receivingFranchiseId: candidate.b,
      candidateRosterIds: bAfter,
    }),
  );
  const valueBand = seasonTradeValueBandFor({
    kind: candidate.kind,
    outgoingValues,
    incomingValues,
  });
  const outgoingHealth = candidate.incoming.map((id) =>
    seasonTradePlayerHealthFacts(run.health, id),
  );
  const incomingHealth = candidate.outgoing.map((id) =>
    seasonTradePlayerHealthFacts(run.health, id),
  );
  const outgoingRoles = candidate.incoming.map((id) => slotGroupsOf(catalogFacts, id).join('/'));
  const incomingRoles = candidate.outgoing.map((id) => slotGroupsOf(catalogFacts, id).join('/'));
  const outgoingDepth = coverageDepthOf(aAfter, candidate.incoming, catalogFacts);
  const incomingDepth = coverageDepthOf(bAfter, candidate.outgoing, catalogFacts);
  const removedPairs = canonicalPlayerPairs(rosterB).filter(
    ([x, y]) => candidate.incoming.includes(x) || candidate.incoming.includes(y),
  ).length;
  const newPairs = canonicalPlayerPairs(bAfter).filter(
    ([x, y]) => candidate.outgoing.includes(x) || candidate.outgoing.includes(y),
  ).length;
  return {
    offerId,
    windowIndex,
    seedPath,
    toFranchiseId: franchiseIdSchema.parse(candidate.b),
    fromFranchiseId: franchiseIdSchema.parse(candidate.a),
    outgoingPlayerVersionIds: candidate.incoming,
    incomingPlayerVersionIds: candidate.outgoing,
    outgoingHealth,
    incomingHealth,
    valueBand,
    roleFit: {
      outgoingRoles,
      incomingRoles,
      notes: `${candidate.b} sends ${candidate.incoming.join(', ')} to ${candidate.a} for ${candidate.outgoing.join(', ')}`,
    },
    rosterNeedFacts: {
      outgoingDepth,
      incomingDepth,
      notes: `${candidate.a} post-swap depth at the moved group: ${String(outgoingDepth)}; ${candidate.b} post-swap depth: ${String(incomingDepth)}`,
    },
    projectedRotationChanges: `AI-to-AI: ${candidate.a} and ${candidate.b} rotations rebuilt deterministically; minute targets preserved for retained players`,
    projectedChemistryDisruption: { removedPairs, newPairs },
    status: 'accepted',
  };
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
interface AiSpendResult {
  health: SeasonHealthState;
  influence: SeasonInfluenceState;
  transactions: SeasonTransactionEntry[];
}
function applyAiInfluenceSpends(
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
    catalogFacts: seasonTradeCatalogFactsOf(catalog),
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
  const boardSeed = seasonNamespaceSeed(
    rootSeed,
    SEASON_SEED_NAMESPACES.trades,
    'window',
    String(windowIndex),
    'board',
  );
  const boardRng = createRng(boardSeed);
  const selected = shuffle(aiIds, boardRng).slice(0, TRADE_BOARD_PROFILE_COUNT);
  const rosterByFranchise = new Map<string, SeasonRoster>(
    run.rosters.map((roster) => [roster.franchiseId, roster]),
  );
  const rotationByFranchise = new Map<string, SeasonRotation>(
    run.rotations.map((rotation) => [rotation.franchiseId, rotation]),
  );
  const boardProfiles: SeasonTradeBoardTeamProfile[] = [];
  for (const franchiseId of selected) {
    const teamSeed = seasonNamespaceSeed(
      rootSeed,
      SEASON_SEED_NAMESPACES.trades,
      'window',
      String(windowIndex),
      'board',
      franchiseId,
    );
    const teamRng = createRng(teamSeed);
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
    const trendSeed = seasonNamespaceSeed(
      rootSeed,
      SEASON_SEED_NAMESPACES.trades,
      'window',
      String(windowIndex),
      'board',
      'trend',
      playerVersionId,
    );
    const trend = createRng(trendSeed).pick([...TRADE_BOARD_TRENDS]);
    return {
      playerVersionId,
      trend,
      basis: `Board estimate holds ${playerVersionId} ${trend} this window.`,
    };
  });
  return { boardProfiles, canonicalTeamOrder, valueTrends };
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
    catalogFacts: seasonTradeCatalogFactsOf(catalog),
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
    catalogFacts: seasonTradeCatalogFactsOf(catalog),
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
  const stateDigest = seasonRunStateDigest({
    stateRevision: next.stateRevision,
    stage: next.stage,
    postseason: next.postseason,
    awards: next.awards,
    completion: next.completion,
    checkpointState: next.checkpointState,
    health: next.health,
    influence: next.influence,
    transactions: next.transactions,
    trade: next.trade,
    freeAgency: next.freeAgency,
    objectives: next.objectives,
    campaign: (
      next as {
        campaign?: unknown;
      }
    ).campaign as never,
    evolution: (
      next as unknown as {
        evolution?: import('@hoop-rush/data-contracts').SeasonEvolutionState | null;
      }
    ).evolution,
    rosters: next.rosters,
    ownership: next.ownership,
    rotations: next.rotations,
    effects: next.effects,
  });
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
  const facts = seasonTradeCatalogFactsOf(catalog);
  const { toFranchiseId, fromFranchiseId } = offer;
  if (toFranchiseId === fromFranchiseId) {
    throw new SeasonTradeInvariantError('a trade must involve two distinct franchises');
  }
  const outgoing = offer.outgoingPlayerVersionIds;
  const incoming = offer.incomingPlayerVersionIds;
  if (
    outgoing.length === 0 ||
    outgoing.length > 2 ||
    incoming.length === 0 ||
    incoming.length > 2
  ) {
    throw new SeasonTradeInvariantError('a trade must move one or two players on each side');
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
  const toEntries = [
    ...toRoster.players.filter((player) => !outgoing.includes(player.playerVersionId)),
    ...fromRoster.players.filter((player) => incoming.includes(player.playerVersionId)),
  ];
  const fromEntries = [
    ...fromRoster.players.filter((player) => !incoming.includes(player.playerVersionId)),
    ...toRoster.players.filter((player) => outgoing.includes(player.playerVersionId)),
  ];
  const toIdsAfter = toEntries.map((player) => player.playerVersionId);
  const fromIdsAfter = fromEntries.map((player) => player.playerVersionId);
  const legalityFailures = [
    ...rosterLegalityReasons(toIdsAfter, facts).map((reason) => `${toFranchiseId}: ${reason}`),
    ...rosterLegalityReasons(fromIdsAfter, facts).map((reason) => `${fromFranchiseId}: ${reason}`),
  ];
  if (legalityFailures.length > 0) {
    throw new SeasonTradeInvariantError(
      `traded rosters fail legality: ${legalityFailures.join('; ')}`,
    );
  }
  const ownership = run.ownership.map((row) =>
    moved.includes(row.playerVersionId)
      ? {
          ...row,
          ownerFranchiseId: outgoing.includes(row.playerVersionId)
            ? fromFranchiseId
            : toFranchiseId,
        }
      : row,
  );
  const rotations = run.rotations.map((rotation) => {
    if (rotation.franchiseId === toFranchiseId) {
      return repairRotationAfterTrade(rotation, facts, toIdsAfter, outgoing, incoming);
    }
    if (rotation.franchiseId === fromFranchiseId) {
      return repairRotationAfterTrade(rotation, facts, fromIdsAfter, incoming, outgoing);
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
  let effects: SeasonEffectsState = run.effects;
  if (activeMoved) {
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
  const windowBlockIndex = windowBlockIndexOf(run, offer.windowIndex);
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
      offerId: offer.offerId,
      seedPath: offer.seedPath,
    },
    explanation: `Trade: ${toFranchiseId} receives ${incoming.join(', ')} for ${outgoing.join(', ')}`,
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
      { franchiseId: toFranchiseId, added: [...incoming], removed: [...outgoing] },
      { franchiseId: fromFranchiseId, added: [...outgoing], removed: [...incoming] },
    ],
  };
}
function windowBlockIndexOf(run: SeasonRun, windowIndex: number): number | null {
  return (
    run.trade?.windows.find((window) => window.windowIndex === windowIndex)?.blockIndex ?? null
  );
}
function repairRotationAfterTrade(
  oldRotation: SeasonRotation,
  facts: SeasonTradeCatalogFacts,
  newRosterIds: readonly string[],
  movedOut: readonly string[],
  movedIn: readonly string[],
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
  const pairing = pairIncomingToOutgoing(movedIn, movedOut, facts);
  const minutesByIncoming = new Map(
    pairing.map(([incomingId, outgoingId]) => [incomingId, outgoingId]),
  );
  const rotationMemberIds = rotationMembers.map((member) => member.playerVersionId);
  const targetMinutes = rotationMemberIds.map((playerVersionId) => {
    const inheritedFrom = minutesByIncoming.get(playerVersionId);
    const minutes =
      inheritedFrom !== undefined
        ? (minutesById.get(inheritedFrom) ?? 16)
        : (minutesById.get(playerVersionId) ?? 16);
    return { playerVersionId, minutes };
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
function pairIncomingToOutgoing(
  movedIn: readonly string[],
  movedOut: readonly string[],
  facts: SeasonTradeCatalogFacts,
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const used = new Set<string>();
  for (const incomingId of [...movedIn].sort()) {
    const incomingGroups = new Set(slotGroupsOf(facts, incomingId));
    let best: string | null = null;
    let bestOverlap = -1;
    for (const outgoingId of movedOut) {
      if (used.has(outgoingId)) continue;
      const overlap = slotGroupsOf(facts, outgoingId).filter((group) =>
        incomingGroups.has(group),
      ).length;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = outgoingId;
      }
    }
    if (best === null) {
      best = [...movedOut].find((outgoingId) => !used.has(outgoingId)) ?? movedOut[0] ?? incomingId;
    }
    used.add(best);
    pairs.push([incomingId, best]);
  }
  return pairs;
}
export function expireTradeOffersForBlock(
  trade: SeasonTradeState | null,
  blockIndex: number,
): SeasonTradeState | null {
  if (trade === null) return null;
  const windows: SeasonTradeWindowState[] = trade.windows.map((window) => {
    if (window.status === 'open' && window.blockIndex + 1 === blockIndex) {
      return {
        ...window,
        status: 'closed',
        offers: window.offers.map((offer) =>
          offer.status === 'open' ? { ...offer, status: 'expired' as const } : offer,
        ),
      };
    }
    return window;
  });
  const changed = windows.some((window, index) => {
    const prior = trade.windows[index];
    return prior === undefined || window !== prior;
  });
  return changed ? { ...trade, windows } : trade;
}
