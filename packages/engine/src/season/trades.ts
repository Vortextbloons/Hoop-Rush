import {
  SEASON_SEED_NAMESPACES,
  SEASON_TRADE_VERSION,
  seasonNamespaceSeed,
  type Position,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonRoster,
  type SeasonRotation,
  type SeasonRun,
  type SeasonTradeOffer,
  type SeasonTradeOfferValueBand,
  type SeasonTradeRosterChange,
  type SeasonTradeState,
  type SeasonTradeWindowState,
  type SeasonTransactionEntry,
  type SimulationRatings,
} from '@hoop-rush/data-contracts';
import { slotGroupOf, type SlotGroup } from '../domain/positions.ts';
import { canonicalRosterPairs } from './chemistry.ts';
import { applyRiskyRehabOutcome, rollSeasonRehabOutcome } from './injuries.ts';
import { applySeasonInfluenceSpend } from './influence.ts';
import { buildMinimalRotation, validateSeasonRotation } from './rotation.ts';
import {
  SEASON_ROSTER_SIZE,
  validateSeasonRoster,
  type SeasonRosterMemberInput,
} from './roster-rules.ts';
import { drawHexInt } from './season-seeds.ts';
import { seasonRunStateDigest } from './state-digest.ts';
import { seasonTransactionEntry } from './transactions.ts';

/**
 * M2.5 generated trade windows (season-trade-v1, engine side, spec/2.0/07
 * M2.5 §13). Windows open after accepted checkpoints for blocks 2, 4, 5
 * (windowIndex 0, 1, 2): three base human offers plus deterministic AI-to-AI
 * offers/acceptances (8-15 AI trades per season, 3-6 per window) and AI
 * Influence spends, all through the shared legality and transaction
 * functions. Offers survive reload in the run's `trade` state.
 *
 * ## Contextual player value (bounded; NEVER Overall as authority)
 *
 * `seasonTradePlayerValue` combines four recorded inputs only (M2.5 §13:
 * role fit, availability, workload, contribution):
 *
 * - Contribution (0..100): a fixed weighted mean of the catalog's detailed
 *   possession ratings — offense (insideScoring, closeShot, midrange,
 *   threePoint, freeThrow, ballHandling, passing, offensiveIq), defense
 *   (perimeterDefense, interiorDefense, steal, block, defensiveIq,
 *   offensiveRebound, defensiveRebound), physical (speed, strength,
 *   vertical); `0.45 * offense + 0.40 * defense + 0.15 * physical`.
 * - Availability factor: 1.0 when the player has no active injury (the
 *   frozen health derivation, mirroring the health workstream's
 *   `seasonPlayerAvailable`); 0.7 with an active injury (an unavailable
 *   player keeps reduced trade value; recovery is possible).
 * - Workload factor: `1 - 0.15 * recentLoadBasisPoints / 10_000` from the
 *   effects load state (a worn player is worth less today), in [0.85, 1.0].
 * - Role-fit factor: `1 + 0.02 * max(0, 3 - groupDepth)` where groupDepth
 *   is the number of players on the receiving roster (after the swap)
 *   capable of the player's primary coarse group (G/F/C), in [1.00, 1.06].
 *
 * `value = clamp(0, 100, contribution * availability * workload * roleFit)`
 * rounded to two decimals. Every input is a recorded fact; Overall never
 * appears.
 *
 * ## Value bands (M2.5 §13)
 *
 * Ratio in basis points (1000 bp = 100% of the outgoing value):
 * `ratioBasisPoints = round(1000 * incoming / outgoing)`. 1-for-1 trades
 * qualify in [850, 1150] (`85-115` band), 2-for-2 in [800, 1200]
 * (`80-120`). The trade schema bounds the recorded ratio to [800, 1200];
 * the generator therefore only records candidates whose raw ratio is inside
 * [800, 1200] (probe selection below), and `qualified` reflects the frozen
 * band membership. AI-to-AI acceptance requires the ratio to be mutually
 * within band: both directions (ratio and its reciprocal) inside the band —
 * 1-for-1: [870, 1150], 2-for-2: [834, 1200].
 *
 * ## Deterministic generation (no execution-order RNG)
 *
 * All randomness derives from `seasonNamespaceSeed(rootSeed, 'trades', ...)`
 * with named sub-seed keys. Offer seed paths are
 * `['window', <wi>, 'offer', <n>]` for the three base human offers,
 * `['window', <wi>, 'extra-offer']` for the influence-purchased fourth offer,
 * and `['window', <wi>, 'ai', <n>]` for AI-to-AI activity; every offer
 * records its `seedPath` and its `offerId` is `off-` + the derived sub-seed.
 * Player/franchise selection ranks candidates by their own sub-seed and
 * takes the first k (order-independent).
 *
 * Human offers: an AI franchise is picked from the seeded ranking (never the
 * human franchise, and distinct across the three base offers); the swap
 * size (1-for-1 or 2-for-2) is seeded; outgoing human players and incoming
 * AI players are seeded picks. Up to 7 deterministic probes (sub-seed key
 * `probe/<k>`) seek a candidate that (a) keeps both resulting rosters legal
 * (validateSeasonRoster) and (b) has a raw ratio inside [800, 1200],
 * preferring the probe closest to 1000 bp. If no probe lands inside the
 * schema range, the closest legal probe is recorded with its ratio clamped
 * to [800, 1200] (qualified reflects the clamped ratio; virtually
 * unreachable with the packaged pool spread).
 *
 * AI-to-AI trades: per window, a seeded target in [3, 6] with a 40-candidate
 * attempt budget and a season cap of 15 minus the AI trades already recorded
 * in prior windows. Every candidate passes the SAME legality and mutual-band
 * functions as human trades before it is recorded (never forced);
 * AI-accepted offers are recorded with status 'accepted'. AI trades never
 * involve the human roster, and their candidates never move a player
 * referenced by an open human offer of the same window, so open offers
 * always remain actionable.
 *
 * AI Influence spends at window open: for every AI franchise in canonical
 * order, a seeded 25% decision to spend 1 Influence on extra-trade-offer
 * (balance permitting: floor -3), and a seeded 30% decision to spend 2
 * Influence on risky-rehab for one seeded active injury (balance permitting),
 * with the outcome rolled through the health workstream's rehab seams and
 * recorded in the ledger and rehabs tracking. All AI spends use
 * deterministic synthetic commandIds (`ai-window-<wi>-<franchise>-<...>`).
 *
 * ## Rotation repair (deterministic, M2.5 §13)
 *
 * After a trade, the rotation of each affected franchise is rebuilt by
 * `buildMinimalRotation` (deterministic G,G,F,F,C starter matching in
 * canonical order, canonical bench hierarchy, closing five = starters), then
 * the PRE-TRADE minute structure is preserved: every retained player keeps
 * their exact target minutes, and each incoming player inherits the minutes
 * of the outgoing player they replace (1-for-1 direct; 2-for-2 paired by
 * best coarse-group overlap, ties by canonical order). The rebuilt rotation
 * is validated with `validateSeasonRotation` before it is accepted.
 *
 * ## Atomic application (applySeasonTrade)
 *
 * One immutable path: unique ownership transfer (a version never appears on
 * two rosters), both rosters updated (legal ten players), deterministic
 * rotation repair, injury records follow the player (franchiseId updated),
 * player load entries stay keyed to the version (the version set never
 * changes) while the old-roster pair states involving moved players are
 * removed and the two new rosters' canonical pairs are added at zero
 * shared possessions (exactly 1,350 league pairs and 300 loads preserved),
 * and one immutable `trade` transaction entry. `applySeasonTrade` mutates
 * the run except `stateRevision`/`stateDigest`, which the caller advances
 * (every window and every accepted command bumps the revision exactly once).
 *
 * ## Catalog requirement (interpretation decision, reported to the lead)
 *
 * The frozen run snapshot carries no player positions or ratings, but
 * legality checks and rotation repair require positions and the value
 * function requires ratings. The window opener and trade application
 * therefore take the packaged draft catalog (the block runner and the
 * command application layer both hold it); when it is absent,
 * `SeasonTradeFactsError` is thrown instead of recording an unvalidated
 * trade (never force invalid trades).
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

/**
 * The windowIndex opened by an accepted block index (2, 4, 5). The trade-
 * injury window block→index map: block 2 opens window 0, block 4 opens
 * window 1, block 5 opens window 2.
 */
export const WINDOW_BLOCK_INDEX_TO_INDEX: Readonly<Record<number, number>> = {
  2: 0,
  4: 1,
  5: 2,
};

/** Frozen 1-for-1 value band (basis points). */
const BAND_85_115 = { lower: 850, upper: 1150 } as const;
/** Frozen 2-for-2 value band (basis points). */
const BAND_80_120 = { lower: 800, upper: 1200 } as const;
/** The schema's recordable ratio window (seasonTradeOfferValueBandSchema). */
const RATIO_SCHEMA_BOUNDS = { lower: 800, upper: 1200 } as const;

/** Value-function weights (documented above). */
const VALUE_OFFENSE_WEIGHT = 0.45;
const VALUE_DEFENSE_WEIGHT = 0.4;
const VALUE_PHYSICAL_WEIGHT = 0.15;
const VALUE_UNAVAILABLE_FACTOR = 0.7;
const VALUE_WORKLOAD_MAX_PENALTY = 0.15;
const VALUE_ROLE_FIT_BONUS_PER_SHORTAGE = 0.02;
const VALUE_ROLE_FIT_NEUTRAL_DEPTH = 3;

/** AI willingness constants (documented above). */
const AI_EXTRA_OFFER_WILLINGNESS_PERCENT = 25;
const AI_REHAB_WILLINGNESS_PERCENT = 30;

/** Seeded per-window AI trade target: `3 + seedInt % 4` in [3, 6]. */
const AI_TRADE_TARGET_RANGE = 4;
/** Candidate attempts per window before recording fewer trades. */
const AI_TRADE_ATTEMPT_BUDGET = 40;
/** Season-level cap on AI trades (frozen trade-targets gate: 8-15). */
const AI_TRADE_SEASON_CAP = 15;
/** Deterministic probes per human/extra offer. */
const OFFER_PROBE_BUDGET = 7;

/** Typed error: the catalog player facts (positions/ratings) are missing. */
export class SeasonTradeFactsError extends Error {
  constructor(message: string) {
    super(`season trades: ${message}`);
    this.name = 'SeasonTradeFactsError';
  }
}

/** Typed invariant failure: a trade broke a frozen rule. */
export class SeasonTradeInvariantError extends Error {
  constructor(message: string) {
    super(`season trades invariant: ${message}`);
    this.name = 'SeasonTradeInvariantError';
  }
}

/**
 * The engine-facing run view used by the economy modules. The persisted
 * Season Run record keeps the M2.4 effects state (300 player loads + 1,350
 * pair chemistries) as a column beside the run snapshot — the engine
 * `SeasonRun` schema does not carry it (M2.5 contract §2: exactly six new
 * run fields, effects excluded). The economy modules mutate effects
 * (chemistry reset on trades, workload reads for value), so they operate on
 * `SeasonRun & { effects }`; callers that keep effects separate (the block
 * runner, the command layer) pass them via the explicit input/options
 * fields documented below.
 */
export type SeasonEconomyRun = SeasonRun & { effects: SeasonEffectsState };

/** Everything the block commit writes when a trade window opens. */
export interface SeasonWindowOpenResult {
  trade: SeasonTradeState;
  influence: SeasonInfluenceState;
  transactions: SeasonTransactionEntry[];
  rosters: SeasonRoster[];
  ownership: SeasonRun['ownership'];
  rotations: SeasonRotation[];
  /** Post-window effects state (AI trades reset pair chemistry). */
  effects: SeasonEffectsState;
  /**
   * Post-window health state (AI risky-rehab outcomes mutate injury
   * records). The frozen M2.5 contract result shape predates this field;
   * it is an additive extension so the runner can persist the window's
   * health mutation (the state digest covers health).
   */
  health: SeasonHealthState;
  stateRevision: number;
  stateDigest: string;
}

export interface SeasonOpenTradeWindowInput {
  /** The run at its post-block state (health/influence/transactions already updated). */
  run: SeasonRun;
  /** The accepted block index (2, 4, or 5 opens a window). */
  blockIndex: number;
  rootSeed: string;
  humanFranchiseId: string | null;
  /**
   * Packaged draft catalog (player positions + detailed ratings + primary
   * positions). The block runner and command layer hold it; required for
   * legality validation, rotation repair, and the contextual value function
   * (a missing catalog throws SeasonTradeFactsError rather than recording an
   * unvalidated window).
   */
  catalog?: SeasonDraftCatalog;
  /**
   * The pre-window effects state (AI trades reset pair chemistry and the
   * value function reads workloads). Required when `run` does not already
   * carry an `effects` field (persistence-record shape).
   */
  effects?: SeasonEffectsState;
}

/** Derived per-version facts the trade module reads from the catalog. */
export interface SeasonTradeCatalogFacts {
  playable: ReadonlyMap<string, readonly Position[]>;
  ratings: ReadonlyMap<string, SimulationRatings>;
  primary: ReadonlyMap<string, Position>;
}

/** Builds the derived facts maps from the packaged catalog. */
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

/** Derived health facts for one player (frozen availability derivation). */
export interface SeasonTradePlayerHealthFacts {
  available: boolean;
  activeInjuryIds: string[];
}

/**
 * Active injury ids and availability from the recorded health state. This
 * mirrors the health workstream's `seasonPlayerAvailable` exactly (a player
 * is unavailable iff they have an injury that is not same-game-returned and
 * has missed games remaining); implemented locally so the trade module stays
 * a pure function of the recorded state while the health seam is pending.
 */
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

/**
 * Resolves the engine-facing run view from the frozen input shape: the run
 * itself when it already carries an `effects` field (persistence-record
 * shape), else the explicit effects input. Throws when effects are absent.
 */
export function seasonEconomyRunOf(run: SeasonRun, effects?: SeasonEffectsState): SeasonEconomyRun {
  if (effects !== undefined) return { ...run, effects };
  if ('effects' in run && run.effects !== undefined) {
    return run as SeasonEconomyRun;
  }
  throw new SeasonTradeFactsError(
    'the effects state is required (the persistence record keeps it beside the run snapshot)',
  );
}

/** Contextual player value inputs (documented in the module docstring). */
export interface SeasonTradeValueContext {
  run: SeasonEconomyRun;
  catalogFacts: SeasonTradeCatalogFacts;
  /** The roster the player would join (role fit evaluates against it). */
  receivingFranchiseId: string;
  /** The receiving roster AFTER the swap; defaults to the current roster. */
  candidateRosterIds?: readonly string[];
}

/**
 * The bounded contextual player value (0..100, two decimals): weighted
 * contribution from the detailed ratings, scaled by availability, workload
 * (effects recent load), and role fit on the receiving roster. Never reads
 * Overall.
 */
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
  const workloadFactor = 1 - (VALUE_WORKLOAD_MAX_PENALTY * load) / 10_000;

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

/** The 1-for-1 / 2-for-2 value band of a candidate swap (to-side view). */
export function seasonTradeValueBandFor(input: {
  size: 1 | 2;
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
  const bounds = input.size === 1 ? BAND_85_115 : BAND_80_120;
  const qualified = ratioBasisPoints >= bounds.lower && ratioBasisPoints <= bounds.upper;
  return { ratioBasisPoints, band: input.size === 1 ? '85-115' : '80-120', qualified };
}

/**
 * True when the ratio is mutually within the band: both the ratio and its
 * reciprocal (the other side's view) fall inside the frozen band. This is
 * the AI-to-AI acceptance rule (M2.5 §13: bands influence AI willingness).
 * The reciprocal is bounded with a ceiling so the integer boundary matches
 * the documented mutual windows (1-for-1: [870, 1150], 2-for-2: [834, 1200]).
 */
export function ratioMutuallyWithinBand(ratioBasisPoints: number, size: 1 | 2): boolean {
  const bounds = size === 1 ? BAND_85_115 : BAND_80_120;
  if (ratioBasisPoints < bounds.lower || ratioBasisPoints > bounds.upper) return false;
  const reciprocal = Math.ceil(1_000_000 / ratioBasisPoints);
  return reciprocal >= bounds.lower && reciprocal <= bounds.upper;
}

/** Every playerVersionId of one franchise's roster, in roster order. */
export function rosterPlayerVersionIdsOf(run: SeasonRun, franchiseId: string): string[] {
  const roster = run.rosters.find((entry) => entry.franchiseId === franchiseId);
  if (roster === undefined) throw new SeasonTradeInvariantError(`unknown roster ${franchiseId}`);
  return roster.players.map((player) => player.playerVersionId);
}

/** All AI franchise ids (every franchise except the human's). */
function aiFranchiseIdsOf(run: SeasonRun, humanFranchiseId: string): string[] {
  return run.league.teams
    .map((team) => team.franchiseId)
    .filter((franchiseId) => franchiseId !== humanFranchiseId)
    .sort();
}

/** The named trade-namespace sub-seed for a key path. */
function tradeSeed(rootSeed: string, ...keys: string[]): string {
  return seasonNamespaceSeed(rootSeed, SEASON_SEED_NAMESPACES.trades, ...keys);
}

/** A deterministic 0..modulus-1 integer from a sub-seed. */
function seedInt(seed: string, modulus: number): number {
  return drawHexInt(seed) % modulus;
}

/** Deterministic ranking: by sub-seed, ties broken by the canonical key. */
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

/** Deterministic pick of k distinct items by their own sub-seeds. */
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

/** The coarse group ('G' | 'F' | 'C') of a player's primary position. */
function primaryGroupOf(facts: SeasonTradeCatalogFacts, playerVersionId: string): SlotGroup | null {
  const primary = facts.primary.get(playerVersionId);
  return primary === undefined ? null : slotGroupOf(primary);
}

/** Coarse slot groups a player can play (from the catalog positions). */
function slotGroupsOf(facts: SeasonTradeCatalogFacts, playerVersionId: string): SlotGroup[] {
  const playable = facts.playable.get(playerVersionId);
  if (playable === undefined) return [];
  const groups = new Set<SlotGroup>();
  for (const position of playable) groups.add(slotGroupOf(position));
  return (['G', 'F', 'C'] as const).filter((group) => groups.has(group));
}

/** Resulting roster ids after a same-size swap. */
function swappedRosterIds(
  rosterIds: readonly string[],
  removed: readonly string[],
  added: readonly string[],
): string[] {
  return [...rosterIds.filter((id) => !removed.includes(id)), ...added];
}

/** True when the roster keeps the full ten-player legality contract. */
function rosterIsLegal(rosterIds: readonly string[], facts: SeasonTradeCatalogFacts): boolean {
  if (rosterIds.length !== SEASON_ROSTER_SIZE || new Set(rosterIds).size !== SEASON_ROSTER_SIZE) {
    return false;
  }
  const members: SeasonRosterMemberInput[] = rosterIds.map((playerVersionId) => ({
    playerVersionId,
    playable: facts.playable.get(playerVersionId) ?? [],
  }));
  return validateSeasonRoster(members).length === 0;
}

/** Legality failure strings for a candidate roster (accept-command path). */
function rosterLegalityReasons(
  rosterIds: readonly string[],
  facts: SeasonTradeCatalogFacts,
): string[] {
  const members: SeasonRosterMemberInput[] = rosterIds.map((playerVersionId) => ({
    playerVersionId,
    playable: facts.playable.get(playerVersionId) ?? [],
  }));
  return validateSeasonRoster(members);
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
  size: 1 | 2;
  outgoing: string[];
  incoming: string[];
  /** Raw ratio (to-side view) before schema clamping. */
  rawRatio: number;
}

/**
 * One deterministic candidate for a human-facing offer: the AI franchise,
 * swap size, outgoing human players, and incoming AI players, plus the raw
 * value ratio. Returns null when the swap would make either roster illegal.
 */
function humanOfferCandidate(
  context: OfferGenerationContext,
  seedPath: string[],
  aiFranchiseId: string,
  size: 1 | 2,
  probeIndex: number,
): OfferCandidate | null {
  const { run, rootSeed, humanFranchiseId, catalogFacts } = context;
  const humanRosterIds = rosterPlayerVersionIdsOf(run, humanFranchiseId);
  const aiRosterIds = rosterPlayerVersionIdsOf(run, aiFranchiseId);
  const outgoing = pickDistinct(
    humanRosterIds,
    (id) => tradeSeed(rootSeed, ...seedPath, 'outgoing', String(probeIndex), id),
    (id) => id,
    size,
  );
  const incoming = pickDistinct(
    aiRosterIds,
    (id) => tradeSeed(rootSeed, ...seedPath, 'incoming', String(probeIndex), id),
    (id) => id,
    size,
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
  return { aiFranchiseId, size, outgoing, incoming, rawRatio };
}

/** AI franchises for the offer, ranked and skipping the human + used ones. */
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

/**
 * Generates one human-facing offer (base or extra): deterministic AI
 * franchise and swap selection with bounded legality/plausibility probes.
 * Returns null only when no legal candidate exists at all (window opens with
 * one fewer offer; virtually unreachable for legal 30-team leagues).
 */
export function generateHumanTradeOffer(
  context: OfferGenerationContext,
  seedPath: string[],
  usedFranchiseIds: readonly string[],
): SeasonTradeOffer | null {
  const { rootSeed } = context;
  const size: 1 | 2 = seedInt(tradeSeed(rootSeed, ...seedPath, 'size'), 100) < 55 ? 1 : 2;

  const franchises = rankedAiFranchises(context, seedPath, usedFranchiseIds);
  for (const aiFranchiseId of franchises) {
    let best: OfferCandidate | null = null;
    for (let probe = 0; probe < OFFER_PROBE_BUDGET; probe += 1) {
      const candidate = humanOfferCandidate(context, seedPath, aiFranchiseId, size, probe);
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
    if (best !== null) {
      return assembleHumanOffer(context, seedPath, best);
    }
  }

  // No franchise yielded a legal candidate (paranoid path): record nothing.
  // The window still opens; offers are generated facts, never fabricated.
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
    size: candidate.size,
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

  const removedPairs = canonicalRosterPairs(humanRosterIds).filter(
    ([a, b]) => candidate.outgoing.includes(a) || candidate.outgoing.includes(b),
  ).length;
  const newPairs = canonicalRosterPairs(humanAfter).filter(
    ([a, b]) => candidate.incoming.includes(a) || candidate.incoming.includes(b),
  ).length;
  const projectedChemistryDisruption = { removedPairs, newPairs };

  return {
    offerId,
    windowIndex,
    seedPath,
    toFranchiseId: humanFranchiseId,
    fromFranchiseId: candidate.aiFranchiseId,
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

/** Post-swap roster depth at the primary groups of the moved-in players. */
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

/** The deterministic fourth human offer purchased with Influence. */
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

/**
 * One AI-to-AI candidate (never the human roster; legality pre-checked).
 * Reads the CURRENT working run (rosters mutate as earlier trades apply),
 * so candidates always reference real rosters. `protectedPlayers` are the
 * players referenced by the window's open human offers — AI trades never
 * move them, so every open offer stays actionable.
 */
function aiTradeCandidate(
  run: SeasonEconomyRun,
  context: OfferGenerationContext,
  attempt: number,
  usedPairs: ReadonlySet<string>,
  protectedPlayers: ReadonlySet<string>,
): {
  a: string;
  b: string;
  size: 1 | 2;
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

  const size: 1 | 2 = seedInt(tradeSeed(rootSeed, ...basePath, 'size'), 100) < 55 ? 1 : 2;
  const rosterA = rosterPlayerVersionIdsOf(run, a);
  const rosterB = rosterPlayerVersionIdsOf(run, b);
  const outgoing = pickDistinct(
    rosterA,
    (id) => tradeSeed(rootSeed, ...basePath, 'outgoing', id),
    (id) => id,
    size,
  );
  const incoming = pickDistinct(
    rosterB,
    (id) => tradeSeed(rootSeed, ...basePath, 'incoming', id),
    (id) => id,
    size,
  );
  if (
    outgoing.some((id) => protectedPlayers.has(id)) ||
    incoming.some((id) => protectedPlayers.has(id))
  ) {
    return null;
  }

  const aAfter = swappedRosterIds(rosterA, outgoing, incoming);
  const bAfter = swappedRosterIds(rosterB, incoming, outgoing);
  if (!rosterIsLegal(aAfter, catalogFacts) || !rosterIsLegal(bAfter, catalogFacts)) return null;

  // To-side view: franchise b receives franchise a's outgoing players.
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
  if (!ratioMutuallyWithinBand(rawRatio, size)) return null;
  return { a, b, size, outgoing, incoming, rawRatio };
}

function assembleAiOffer(
  run: SeasonEconomyRun,
  context: OfferGenerationContext,
  candidate: { a: string; b: string; size: 1 | 2; outgoing: string[]; incoming: string[] },
  attempt: number,
): SeasonTradeOffer {
  // Offer-field convention (shared with human offers): `outgoing` is the
  // set the TO side gives away and `incoming` is the set the FROM side
  // sends. For AI-to-AI, b is the to-side: b gives away `incoming` (its own
  // players picked on rosterB) and receives `outgoing` (a's players).
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
    size: candidate.size,
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

  const removedPairs = canonicalRosterPairs(rosterB).filter(
    ([x, y]) => candidate.incoming.includes(x) || candidate.incoming.includes(y),
  ).length;
  const newPairs = canonicalRosterPairs(bAfter).filter(
    ([x, y]) => candidate.outgoing.includes(x) || candidate.outgoing.includes(y),
  ).length;

  return {
    offerId,
    windowIndex,
    seedPath,
    toFranchiseId: candidate.b,
    fromFranchiseId: candidate.a,
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

/** AI trades recorded in prior windows (season cap accounting). */
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

/** Seeded AI Influence spends at window open (extra-trade-offer + risky-rehab). */
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
    const spentExtra = (influence.windows[franchiseId] ?? []).some(
      (window) => window.windowIndex === windowIndex && window.extraOfferSpent,
    );
    const balance = influence.balances[franchiseId] ?? 0;
    if (wantExtra && !spentExtra && balance >= -2) {
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
      const currentBalance = influence.balances[franchiseId] ?? 0;
      if (
        pick !== undefined &&
        wantRehab &&
        influence.rehabs[pick.injuryId] === undefined &&
        currentBalance >= -1
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

/**
 * Deterministic AI-to-AI trades for one window: seeded target in [3, 6],
 * capped by the season total (15 minus prior windows), with a 40-candidate
 * attempt budget. Every recorded trade passed the same legality and
 * mutual-band functions and is applied through `applySeasonTrade`.
 * `protectedPlayers` are the players referenced by the window's open human
 * offers (generated before the AI activity); AI trades never move them.
 */
function applyAiTrades(
  run: SeasonEconomyRun,
  rootSeed: string,
  windowIndex: number,
  catalog: SeasonDraftCatalog,
  humanFranchiseId: string,
  appliedAtStateRevision: number,
  protectedPlayers: ReadonlySet<string>,
): { run: SeasonEconomyRun; offers: SeasonTradeOffer[]; transactions: SeasonTransactionEntry[] } {
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

/**
 * Opens a trade window after the accepted checkpoint for blocks 2, 4, 5
 * (windowIndex 0, 1, 2); any other block index returns null, as does a run
 * without a human franchise (offers target the human; the CLI calibration
 * runs use fixtures with one). Returns null when the window already exists
 * (idempotent — the window was persisted with the block commit). Generates
 * three base human offers, AI Influence spends, and AI-to-AI activity, all
 * deterministically, and returns the full post-window state with
 * `stateRevision + 1` and the recomputed `stateDigest`.
 */
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

  // 1. Three base human offers (distinct AI franchises, seeded order).
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

  // 2. AI Influence spends (seeded, balance permitting; ledger + transactions).
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

  // 3. AI-to-AI trades through the shared applySeasonTrade path. AI trades
  // never move players referenced by the open human offers above.
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

  const trade: SeasonTradeState = {
    schemaVersion: 1,
    tradeVersion: SEASON_TRADE_VERSION,
    windows: [...(run.trade?.windows ?? []), { windowIndex, blockIndex, status: 'open', offers }],
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
    checkpointState: next.checkpointState,
    health: next.health,
    influence: next.influence,
    transactions: next.transactions,
    trade: next.trade,
    objectives: next.objectives,
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

/** Options for one atomic trade application. */
export interface SeasonTradeApplicationOptions {
  /** The command id recorded on the immutable trade transaction entry. */
  commandId?: string | null;
  /** The state revision the trade transaction entry records. */
  appliedAtStateRevision?: number;
}

/** The mutated run plus the two roster-change rows of an applied trade. */
export interface SeasonTradeApplicationResult {
  /** The mutated run (carries the effects state alongside the snapshot). */
  run: SeasonEconomyRun;
  rosterChanges: SeasonTradeRosterChange[];
}

/**
 * Applies one trade atomically (M2.5 §13): unique ownership transfer (a
 * version never appears on two rosters), both rosters updated (legal ten
 * players), deterministic rotation repair with preserved minute targets,
 * injury records follow the players, player loads stay keyed to the version
 * while old-roster pairs are removed and new-roster canonical pairs are
 * added at zero shared possessions (1,350 pairs / 300 loads preserved), and
 * one immutable `trade` transaction entry. Also marks the offer `accepted`
 * in the run's trade state when it is recorded there. Does NOT advance
 * `stateRevision`/`stateDigest` — the caller (command handler or window
 * opener) bumps the revision exactly once and recomputes the digest.
 */
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
  if (outgoing.length === 0 || outgoing.length !== incoming.length) {
    throw new SeasonTradeInvariantError(
      'a trade must move the same number of players on both sides',
    );
  }

  // Structural pre-checks: every moved version on its stated roster exactly
  // once, owned by the stated franchise, and never on two rosters.
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

  // New rosters (ten players each; entries carry their new franchiseId).
  const toEntries = [
    ...toRoster.players.filter((player) => !outgoing.includes(player.playerVersionId)),
    ...fromRoster.players
      .filter((player) => incoming.includes(player.playerVersionId))
      .map((player) => ({ ...player, franchiseId: toFranchiseId })),
  ];
  const fromEntries = [
    ...fromRoster.players.filter((player) => !incoming.includes(player.playerVersionId)),
    ...toRoster.players
      .filter((player) => outgoing.includes(player.playerVersionId))
      .map((player) => ({ ...player, franchiseId: fromFranchiseId })),
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

  // Ownership transfer (unique: a version never appears on two rosters).
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

  // Deterministic rotation repair for the two affected franchises.
  const rotations = run.rotations.map((rotation) => {
    if (rotation.franchiseId === toFranchiseId) {
      return repairRotationAfterTrade(rotation, facts, toIdsAfter, outgoing, incoming);
    }
    if (rotation.franchiseId === fromFranchiseId) {
      return repairRotationAfterTrade(rotation, facts, fromIdsAfter, incoming, outgoing);
    }
    return rotation;
  });

  // Effects: player loads follow the version (unchanged set of 300); pairs
  // involving moved players are removed and the two new rosters' canonical
  // pairs are added at zero shared possessions (exactly 1,350 pairs).
  const movedSet = new Set(moved);
  const keptPairs = run.effects.pairStates.filter(
    (pair) => !movedSet.has(pair.a) && !movedSet.has(pair.b),
  );
  const addedPairs = [
    ...canonicalRosterPairs(toIdsAfter),
    ...canonicalRosterPairs(fromIdsAfter),
  ].filter(([a, b]) => !keptPairs.some((pair) => pair.a === a && pair.b === b));
  const pairStates = [
    ...keptPairs,
    ...addedPairs.map(([a, b]) => ({ a, b, sharedPossessions: 0 })),
  ].sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1));
  if (pairStates.length !== 1350) {
    throw new SeasonTradeInvariantError(
      `effects pair states must stay at 1,350 after a trade (got ${String(pairStates.length)})`,
    );
  }
  const effects: SeasonEffectsState = {
    schemaVersion: 1,
    playerStates: run.effects.playerStates,
    pairStates,
  };

  // Health records follow the players (franchiseId updated).
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

  // One immutable trade transaction entry.
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

  // Mark the offer accepted when the run's trade state records it.
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

/** The block index of a window (null when the trade state lacks the window). */
function windowBlockIndexOf(run: SeasonRun, windowIndex: number): number | null {
  return (
    run.trade?.windows.find((window) => window.windowIndex === windowIndex)?.blockIndex ?? null
  );
}

/**
 * Deterministic rotation repair (M2.5 §13): rebuilds a legal rotation for the
 * franchise from its new ten players (matchStartingFive in canonical order,
 * bench hierarchy, closing five = starters), then preserves the pre-trade
 * minute structure — retained players keep their exact target minutes and
 * each incoming player inherits the minutes of the outgoing player they
 * replace (1-for-1 direct; 2-for-2 paired by best coarse-group overlap with
 * canonical tie-breaking). The repaired rotation is validated before return.
 */
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
  const base = buildMinimalRotation({ franchiseId: oldRotation.franchiseId, members });
  const minutesById = new Map(
    oldRotation.targetMinutes.map((entry) => [entry.playerVersionId, entry.minutes]),
  );
  const pairing = pairIncomingToOutgoing(movedIn, movedOut, facts);
  const minutesByIncoming = new Map(
    pairing.map(([incomingId, outgoingId]) => [incomingId, outgoingId]),
  );
  const targetMinutes = newRosterIds.map((playerVersionId) => {
    const inheritedFrom = minutesByIncoming.get(playerVersionId);
    const minutes =
      inheritedFrom !== undefined
        ? (minutesById.get(inheritedFrom) ?? 16)
        : (minutesById.get(playerVersionId) ?? 16);
    return { playerVersionId, minutes };
  });
  const rotation: SeasonRotation = { ...base, targetMinutes };
  // Validate against the ROSTER's ten players only (the catalog facts map
  // covers every candidate in the packaged catalog, far beyond this roster).
  const memberPlayable = new Map<string, readonly Position[]>();
  for (const playerVersionId of newRosterIds) {
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

/** Incoming players paired to the outgoing players whose minutes they take. */
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

/**
 * Closes trade windows whose deadline this block submission triggers
 * (M2.5 §13 LEAD DECISION): window 0 (opened by block 2) closes at block 3
 * submission, window 1 (block 4) at block 5, window 2 (block 5) at block 6.
 * Closing marks the window `closed` and every still-open offer `expired`.
 * Returns null when the run has no trade state.
 */
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
