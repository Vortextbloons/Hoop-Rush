import {
  SEASON_SEED_NAMESPACES,
  SEASON_ROSTER_MAX_SIZE,
  SEASON_ROSTER_MIN_SIZE,
  normalizeSponsorGearState,
  seasonNamespaceSeed,
  type Position,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonHealthState,
  type SeasonPlayerSponsorSlots,
  type SeasonRoster,
  type SeasonRun,
  type SeasonTradeOfferValueBand,
  type SimulationRatings,
} from '@hoop-rush/data-contracts';
import { slotGroupOf, type SlotGroup } from '../domain/positions.ts';
import { createRng, shuffle } from '../sim/rng.ts';
import { validateSeasonRoster, type SeasonRosterMemberInput } from './roster-rules.ts';
import { applySponsorBoosts } from './sponsors.ts';
import { drawHexInt } from './season-seeds.ts';

export const TRADE_VALUE_BAND = { lower: 850, upper: 1150 } as const;
export const TRADE_PACKAGE_WEIGHTS = [1, 0.4, 0.3, 0.2, 0.15] as const;
export const TRADE_CONSOLIDATION_BEST_MIN_RATIO = 700;
export type TradeAssetEligibilityStatus = 'eligible' | 'protected' | 'availability-risk';
export interface TradeAssetEligibilityInput {
  playerVersionId: string;
  fromFranchiseId?: string;
  protectedIds: readonly string[];
  available: boolean;
  hasBlockingInjury?: boolean;
}
export interface TradeAssetEligibilityResult {
  status: TradeAssetEligibilityStatus;
  reason: string | null;
}
export function tradeAssetEligibilityOf(
  input: TradeAssetEligibilityInput,
): TradeAssetEligibilityResult {
  if (input.protectedIds.includes(input.playerVersionId)) {
    return { status: 'protected', reason: 'Off limits' };
  }
  const blocking = input.hasBlockingInjury ?? !input.available;
  if (blocking) {
    return { status: 'availability-risk', reason: 'Out with injury — harder to move' };
  }
  return { status: 'eligible', reason: null };
}
const RATIO_SCHEMA_BOUNDS = { lower: 800, upper: 1200 } as const;
export type SeasonTradePackageKind = '1-1' | '2-2' | '1-2' | '2-1';
export function packageKindOf(seed: string): SeasonTradePackageKind {
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
export function kindOrderStartingAt(kind: SeasonTradePackageKind): SeasonTradePackageKind[] {
  const order: SeasonTradePackageKind[] = ['1-1', '2-2', '1-2', '2-1'];
  const start = order.indexOf(kind);
  return [...order.slice(start), ...order.slice(0, start)];
}
const VALUE_OFFENSE_WEIGHT = 0.45;
const VALUE_DEFENSE_WEIGHT = 0.4;
const VALUE_PHYSICAL_WEIGHT = 0.15;
const VALUE_UNAVAILABLE_FACTOR = 0.7;
const VALUE_WORKLOAD_MAX_PENALTY = 0.15;
const VALUE_ROLE_FIT_BONUS_PER_SHORTAGE = 0.02;
const VALUE_ROLE_FIT_NEUTRAL_DEPTH = 3;
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
export interface SeasonTradeCatalogFacts {
  playable: ReadonlyMap<string, readonly Position[]>;
  ratings: ReadonlyMap<string, SimulationRatings>;
  primary: ReadonlyMap<string, Position>;
}
export function seasonTradeCatalogFactsOf(
  catalog: SeasonDraftCatalog,
  applied?: Record<string, SeasonPlayerSponsorSlots>,
): SeasonTradeCatalogFacts {
  const playable = new Map<string, readonly Position[]>();
  const ratings = new Map<string, SimulationRatings>();
  const primary = new Map<string, Position>();
  for (const candidate of catalog.candidates) {
    playable.set(candidate.playerVersionId, candidate.positions.playable);
    const slots = applied?.[candidate.playerVersionId];
    ratings.set(
      candidate.playerVersionId,
      slots === undefined
        ? candidate.detailedRatings
        : applySponsorBoosts(candidate.detailedRatings, slots),
    );
    primary.set(candidate.playerVersionId, candidate.positions.primary);
  }
  return { playable, ratings, primary };
}
export function sponsorSlotsOf(run: SeasonEconomyRun): Record<string, SeasonPlayerSponsorSlots> {
  return normalizeSponsorGearState(run.sponsors).players.slots;
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
export function canPlayGroup(playable: readonly Position[], group: SlotGroup): boolean {
  return playable.some((position) => slotGroupOf(position) === group);
}
export function seasonTradeValueBandFor(input: {
  kind: SeasonTradePackageKind;
  outgoingValues: readonly number[];
  incomingValues: readonly number[];
}): SeasonTradeOfferValueBand {
  const outgoing = seasonTradePackageValue(input.outgoingValues);
  const incoming = seasonTradePackageValue(input.incomingValues);
  if (outgoing <= 0) throw new SeasonTradeInvariantError('outgoing trade value must be positive');
  const raw = Math.round((1000 * incoming) / outgoing);
  const ratioBasisPoints = Math.min(
    RATIO_SCHEMA_BOUNDS.upper,
    Math.max(RATIO_SCHEMA_BOUNDS.lower, raw),
  );
  const bounds = TRADE_VALUE_BAND;
  const qualified = ratioBasisPoints >= bounds.lower && ratioBasisPoints <= bounds.upper;
  return {
    ratioBasisPoints,
    band: input.kind === '1-1' ? '85-115' : '80-120',
    qualified,
  };
}
export function ratioMutuallyWithinBand(
  ratioBasisPoints: number,
  _kind?: SeasonTradePackageKind,
): boolean {
  void _kind;
  const bounds = TRADE_VALUE_BAND;
  if (ratioBasisPoints < bounds.lower || ratioBasisPoints > bounds.upper) return false;
  const reciprocal = Math.ceil(1000000 / ratioBasisPoints);
  return reciprocal >= bounds.lower && reciprocal <= bounds.upper;
}
export function seasonTradePackageValue(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  let total = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const weight = TRADE_PACKAGE_WEIGHTS[i] ?? 0.15;
    total += (sorted[i] ?? 0) * weight;
  }
  return Math.round(total * 100) / 100;
}
export function seasonTradeBestValue(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values);
}
export function seasonTradePackageRatio(input: {
  outgoingValues: readonly number[];
  incomingValues: readonly number[];
}): number {
  const outgoing = seasonTradePackageValue(input.outgoingValues);
  const incoming = seasonTradePackageValue(input.incomingValues);
  if (outgoing <= 0) return 0;
  return Math.round((1000 * incoming) / outgoing);
}
export function rosterPlayerVersionIdsOf(run: SeasonRun, franchiseId: string): string[] {
  const roster = run.rosters.find((entry) => entry.franchiseId === franchiseId);
  if (roster === undefined) throw new SeasonTradeInvariantError(`unknown roster ${franchiseId}`);
  return roster.players.map((player) => player.playerVersionId);
}
export function aiFranchiseIdsOf(run: SeasonRun, humanFranchiseId: string): string[] {
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
export function tradeSeed(rootSeed: string, ...keys: string[]): string {
  return seasonNamespaceSeed(rootSeed, SEASON_SEED_NAMESPACES.trades, ...keys);
}
export function tradeOfferBackfillSeed(rootSeed: string, seedPath: readonly string[]): string {
  return tradeSeed(rootSeed, ...seedPath, 'backfill');
}
export function seedInt(seed: string, modulus: number): number {
  return drawHexInt(seed) % modulus;
}
export function rankedBySeed<T>(
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
export function pickDistinct<T>(
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
export function primaryGroupOf(
  facts: SeasonTradeCatalogFacts,
  playerVersionId: string,
): SlotGroup | null {
  const primary = facts.primary.get(playerVersionId);
  return primary === undefined ? null : slotGroupOf(primary);
}
export function slotGroupsOf(facts: SeasonTradeCatalogFacts, playerVersionId: string): SlotGroup[] {
  const playable = facts.playable.get(playerVersionId);
  if (playable === undefined) return [];
  const groups = new Set<SlotGroup>();
  for (const position of playable) groups.add(slotGroupOf(position));
  return (['G', 'F', 'C'] as const).filter((group) => groups.has(group));
}
export function swappedRosterIds(
  rosterIds: readonly string[],
  removed: readonly string[],
  added: readonly string[],
): string[] {
  return [...rosterIds.filter((id) => !removed.includes(id)), ...added];
}
export function tradeRosterLegalityReasons(
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
export function rosterIsLegal(
  rosterIds: readonly string[],
  facts: SeasonTradeCatalogFacts,
): boolean {
  return tradeRosterLegalityReasons(rosterIds, facts).length === 0;
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
const TRADE_BACKFILL_WALK_ATTEMPT_CAP = 2000;
export interface TradeBackfillSelection {
  picks: string[];
  entries: SeasonRoster['players'];
}
export function selectTradeBackfill(input: {
  catalog: SeasonDraftCatalog;
  run: SeasonEconomyRun;
  receivingFranchiseId: string;
  rosterAfterIds: readonly string[];
  seed: string;
}): TradeBackfillSelection | null {
  const needed = SEASON_ROSTER_MIN_SIZE - input.rosterAfterIds.length;
  if (needed <= 0) return { picks: [], entries: [] };
  const facts = seasonTradeCatalogFactsOf(input.catalog, sponsorSlotsOf(input.run));
  const owned = new Set(input.run.ownership.map((row) => row.playerVersionId));
  for (const id of input.rosterAfterIds) owned.add(id);
  const ordering = createRng(seasonNamespaceSeed(input.seed, 'backfill-order'));
  const pool = shuffle(
    input.catalog.candidates.filter(
      (candidate) =>
        !owned.has(candidate.playerVersionId) &&
        seasonTradePlayerHealthFacts(input.run.health, candidate.playerVersionId).available,
    ),
    ordering,
  );
  const ordered = [...pool].sort(
    (a, b) =>
      seasonTradePlayerValue(a.playerVersionId, {
        run: input.run,
        catalogFacts: facts,
        receivingFranchiseId: input.receivingFranchiseId,
        candidateRosterIds: input.rosterAfterIds,
      }) -
      seasonTradePlayerValue(b.playerVersionId, {
        run: input.run,
        catalogFacts: facts,
        receivingFranchiseId: input.receivingFranchiseId,
        candidateRosterIds: input.rosterAfterIds,
      }),
  );
  const ids = ordered.map((candidate) => candidate.playerVersionId);
  if (ids.length < needed) return null;
  const legal = (picks: readonly string[]): boolean =>
    tradeRosterLegalityReasons([...input.rosterAfterIds, ...picks], facts).length === 0;
  let picks = ids.slice(0, needed);
  if (legal(picks)) return toBackfillSelection(input.catalog, picks);
  let attempts = 0;
  let improved = true;
  while (!legal(picks) && improved && attempts < TRADE_BACKFILL_WALK_ATTEMPT_CAP) {
    improved = false;
    for (let i = 0; i < picks.length; i += 1) {
      for (const alt of ids) {
        attempts += 1;
        if (attempts >= TRADE_BACKFILL_WALK_ATTEMPT_CAP) break;
        if (picks.includes(alt)) continue;
        const next = [...picks];
        next[i] = alt;
        if (legal(next)) {
          picks = next;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }
  if (!legal(picks)) return null;
  return toBackfillSelection(input.catalog, picks);
}
function toBackfillSelection(catalog: SeasonDraftCatalog, picks: string[]): TradeBackfillSelection {
  const byId = new Map(
    catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
  );
  return {
    picks: [...picks],
    entries: picks.map((playerVersionId) => {
      const candidate = byId.get(playerVersionId);
      if (candidate === undefined) {
        throw new SeasonTradeInvariantError(
          `backfill references unknown version ${playerVersionId}`,
        );
      }
      return {
        playerVersionId: candidate.playerVersionId,
        playerId: candidate.playerId,
        franchiseId: candidate.franchiseId,
        eraId: candidate.eraId,
        seasonKey: candidate.seasonKey,
        displayName: candidate.displayName,
      };
    }),
  };
}
export interface TradeBackfillFill {
  toBackfill: SeasonRoster['players'];
  fromBackfill: SeasonRoster['players'];
  toIdsFilled: string[];
  fromIdsFilled: string[];
}
export function fillTradeBackfill(input: {
  catalog: SeasonDraftCatalog;
  run: SeasonEconomyRun;
  toFranchiseId: string;
  fromFranchiseId: string;
  toIds: readonly string[];
  fromIds: readonly string[];
  seed: string;
}): TradeBackfillFill | null {
  const toSelection = selectTradeBackfill({
    catalog: input.catalog,
    run: input.run,
    receivingFranchiseId: input.toFranchiseId,
    rosterAfterIds: input.toIds,
    seed: seasonNamespaceSeed(input.seed, 'to'),
  });
  if (toSelection === null) return null;
  const fromSelection = selectTradeBackfill({
    catalog: {
      ...input.catalog,
      candidates: input.catalog.candidates.filter(
        (candidate) => !toSelection.picks.includes(candidate.playerVersionId),
      ),
    },
    run: input.run,
    receivingFranchiseId: input.fromFranchiseId,
    rosterAfterIds: input.fromIds,
    seed: seasonNamespaceSeed(input.seed, 'from'),
  });
  if (fromSelection === null) return null;
  return {
    toBackfill: toSelection.entries,
    fromBackfill: fromSelection.entries,
    toIdsFilled: [...input.toIds, ...toSelection.picks],
    fromIdsFilled: [...input.fromIds, ...fromSelection.picks],
  };
}
export function coverageDepthOf(
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
export function fingerprintOf(outgoing: readonly string[], incoming: readonly string[]): string {
  const o = [...outgoing].sort().join(',');
  const i = [...incoming].sort().join(',');
  return `${o}|${i}`;
}
