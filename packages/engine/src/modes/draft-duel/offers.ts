import type {
  DraftDuelCatalogEntry,
  DraftDuelCard,
  DraftDuelDraft,
  DraftDuelFairness,
  DraftDuelParticipantId,
  Seed,
  SlotGroup,
} from '@hoop-rush/data-contracts';
import {
  DRAFT_DUEL_MAX_GENERATION_ATTEMPTS,
  overallBandForPercentile,
  overallBandIndexOf,
} from '@hoop-rush/data-contracts';
import { createRng, shuffle, swapAt } from '../../sim/rng.ts';
import type { DraftDuelCatalog } from './catalog.ts';
import {
  buildDraftDuelSafetyBase,
  draftDuelCardProfileMask,
  draftDuelOpenSlotNeeds,
  draftDuelRoundSafetyHolds,
  profileMaskCovers,
  unclaimedGroupAvailability,
  withDraftDuelOffers,
  type DraftDuelGroupNeeds,
  type DraftDuelOfferPools,
  type DraftDuelRoundOffers,
  type DraftDuelSafetyBase,
} from './feasibility.ts';
import { draftDuelOfferSeed, draftDuelSharedBandSeed } from './seeds.ts';

const ROUND_COUNT = 5;
const POOL_SIZE = 8;
const TOKEN_COUNT = ROUND_COUNT * POOL_SIZE;
const GROUP_ORDER: readonly SlotGroup[] = ['G', 'F', 'C'];

export class DraftDuelGenerationError extends Error {
  readonly fairness: DraftDuelFairness;
  readonly round: number;
  readonly attempts: number;
  constructor(fairness: DraftDuelFairness, round: number, attempts: number, message: string) {
    super(message);
    this.name = 'DraftDuelGenerationError';
    this.fairness = fairness;
    this.round = round;
    this.attempts = attempts;
  }
}

export function draftDuelFairBandTokens(rootSeed: Seed, attempt: number): number[] {
  const rng = createRng(draftDuelSharedBandSeed(rootSeed, attempt));
  const tokens: number[] = [];
  for (let index = 0; index < TOKEN_COUNT; index += 1) {
    tokens.push(overallBandIndexOf(overallBandForPercentile(rng.next())));
  }
  return tokens;
}

interface DraftDuelFairCandidate {
  playerId: string;
  entries: readonly DraftDuelCatalogEntry[];
}

interface DraftDuelOfferContext {
  fairness: DraftDuelFairness;
  rootSeed: Seed;
  round: number;
  safetyBase: DraftDuelSafetyBase;
  requirements: { p1: DraftDuelGroupNeeds; p2: DraftDuelGroupNeeds };
  playerIds: readonly string[];
  entriesByPlayerId: ReadonlyMap<string, readonly DraftDuelCatalogEntry[]>;
  playersByBand: ReadonlyMap<number, readonly string[]>;
}

function protectionRequirements(
  needed: DraftDuelGroupNeeds,
  picksSecond: boolean,
  availability: DraftDuelGroupNeeds,
): DraftDuelGroupNeeds {
  const extra = picksSecond ? 1 : 0;
  const required: DraftDuelGroupNeeds = { G: 0, F: 0, C: 0 };
  for (const group of GROUP_ORDER) {
    if (needed[group] === 0) continue;
    required[group] = Math.min(needed[group] + extra, POOL_SIZE, availability[group]);
  }
  return required;
}

function buildOfferContext(
  state: DraftDuelDraft,
  catalog: DraftDuelCatalog,
  round: number,
): DraftDuelOfferContext {
  const safetyBase = buildDraftDuelSafetyBase(state, catalog);
  const availability = unclaimedGroupAvailability(safetyBase.unclaimedProfileCounts);
  const requirements = {
    p1: protectionRequirements(
      draftDuelOpenSlotNeeds(safetyBase, 'p1'),
      state.firstPicker !== 'p1',
      availability,
    ),
    p2: protectionRequirements(
      draftDuelOpenSlotNeeds(safetyBase, 'p2'),
      state.firstPicker !== 'p2',
      availability,
    ),
  };
  const playersByBand = new Map<number, string[]>();
  for (const playerId of catalog.playerIds) {
    const entries = catalog.byPlayerId.get(playerId) ?? [];
    const bands = new Set<number>();
    for (const entry of entries) bands.add(entry.card.bandIndex);
    for (const band of bands) {
      const list = playersByBand.get(band);
      if (list) list.push(playerId);
      else playersByBand.set(band, [playerId]);
    }
  }
  return {
    fairness: state.fairness,
    rootSeed: state.rootSeed,
    round,
    safetyBase,
    requirements,
    playerIds: catalog.playerIds,
    entriesByPlayerId: catalog.byPlayerId,
    playersByBand,
  };
}

function fairBandCandidates(
  context: DraftDuelOfferContext,
  band: number,
  placed: ReadonlySet<string>,
): DraftDuelFairCandidate[] {
  const playerIds = context.playersByBand.get(band) ?? [];
  const candidates: DraftDuelFairCandidate[] = [];
  for (const playerId of playerIds) {
    if (placed.has(playerId) || context.safetyBase.claimedPlayerIds.has(playerId)) continue;
    const entries = (context.entriesByPlayerId.get(playerId) ?? []).filter(
      (entry) => entry.card.bandIndex === band,
    );
    if (entries.length === 0) continue;
    candidates.push({ playerId, entries });
  }
  return candidates;
}

function candidateCovers(candidate: DraftDuelFairCandidate, group: SlotGroup): boolean {
  return candidate.entries.some((entry) =>
    profileMaskCovers(draftDuelCardProfileMask(entry.card), group),
  );
}

function preferScarceGroup(
  context: DraftDuelOfferContext,
  participantId: DraftDuelParticipantId,
  candidates: readonly DraftDuelFairCandidate[],
  coverage: DraftDuelGroupNeeds,
): readonly DraftDuelFairCandidate[] {
  const required = context.requirements[participantId];
  let best: readonly DraftDuelFairCandidate[] | null = null;
  for (const group of GROUP_ORDER) {
    if (coverage[group] >= required[group]) continue;
    const options = candidates.filter((candidate) => candidateCovers(candidate, group));
    if (options.length === 0) continue;
    if (best === null || options.length < best.length) best = options;
  }
  return best ?? candidates;
}

function buildFairPool(
  context: DraftDuelOfferContext,
  participantId: DraftDuelParticipantId,
  attempt: number,
  tokens: readonly number[],
): DraftDuelCard[] | null {
  const shuffled = shuffle(
    tokens,
    createRng(draftDuelOfferSeed(context.rootSeed, participantId, 1, attempt)),
  );
  const start = (context.round - 1) * POOL_SIZE;
  const slice = shuffled.slice(start, start + POOL_SIZE);
  const rng = createRng(
    draftDuelOfferSeed(context.rootSeed, participantId, context.round, attempt),
  );
  const pool: DraftDuelCard[] = [];
  const placed = new Set<string>();
  const coverage: DraftDuelGroupNeeds = { G: 0, F: 0, C: 0 };
  for (const band of slice) {
    const candidates = fairBandCandidates(context, band, placed);
    if (candidates.length === 0) return null;
    const preferred = preferScarceGroup(context, participantId, candidates, coverage);
    const player = rng.pick(preferred);
    const version = rng.pick(player.entries);
    pool.push(version.card);
    placed.add(player.playerId);
    const mask = draftDuelCardProfileMask(version.card);
    for (const group of GROUP_ORDER) {
      if (profileMaskCovers(mask, group)) coverage[group] += 1;
    }
  }
  return pool;
}

function buildFairOffers(
  context: DraftDuelOfferContext,
  attempt: number,
): DraftDuelRoundOffers | null {
  const tokens = draftDuelFairBandTokens(context.rootSeed, attempt);
  const p1 = buildFairPool(context, 'p1', attempt, tokens);
  if (p1 === null) return null;
  const p2 = buildFairPool(context, 'p2', attempt, tokens);
  if (p2 === null) return null;
  return { p1, p2 };
}

function buildUnfairPool(
  context: DraftDuelOfferContext,
  participantId: DraftDuelParticipantId,
  attempt: number,
): DraftDuelCard[] | null {
  const eligible: string[] = [];
  for (const playerId of context.playerIds) {
    if (!context.safetyBase.claimedPlayerIds.has(playerId)) eligible.push(playerId);
  }
  if (eligible.length < POOL_SIZE) return null;
  const rng = createRng(
    draftDuelOfferSeed(context.rootSeed, participantId, context.round, attempt),
  );
  const pool: DraftDuelCard[] = [];
  for (let index = 0; index < POOL_SIZE; index += 1) {
    const swapIndex = rng.nextInt(index, eligible.length - 1);
    swapAt(eligible, index, swapIndex);
    const playerId = eligible[index];
    if (playerId === undefined) return null;
    const entries = context.entriesByPlayerId.get(playerId) ?? [];
    if (entries.length === 0) return null;
    pool.push(rng.pick(entries).card);
  }
  return pool;
}

function buildUnfairOffers(
  context: DraftDuelOfferContext,
  attempt: number,
): DraftDuelRoundOffers | null {
  const p1 = buildUnfairPool(context, 'p1', attempt);
  if (p1 === null) return null;
  const p2 = buildUnfairPool(context, 'p2', attempt);
  if (p2 === null) return null;
  return { p1, p2 };
}

function poolsSatisfyProtection(
  context: DraftDuelOfferContext,
  offers: DraftDuelRoundOffers,
): boolean {
  for (const participantId of ['p1', 'p2'] as const) {
    const coverage: DraftDuelGroupNeeds = { G: 0, F: 0, C: 0 };
    for (const card of offers[participantId]) {
      const mask = draftDuelCardProfileMask(card);
      for (const group of GROUP_ORDER) {
        if (profileMaskCovers(mask, group)) coverage[group] += 1;
      }
    }
    const required = context.requirements[participantId];
    for (const group of GROUP_ORDER) {
      if (coverage[group] < required[group]) return false;
    }
  }
  return true;
}

function offersMatch(
  left: DraftDuelRoundOffers,
  right: DraftDuelOfferPools | DraftDuelRoundOffers,
): boolean {
  for (const participantId of ['p1', 'p2'] as const) {
    const leftPool = left[participantId];
    const rightPool = right[participantId];
    if (leftPool.length !== rightPool.length) return false;
    for (let slot = 0; slot < leftPool.length; slot += 1) {
      const leftCard = leftPool[slot];
      const rightCard = rightPool[slot];
      if (leftCard === undefined || rightCard === undefined) return false;
      if (leftCard.cardId !== rightCard.cardId) return false;
      if (leftCard.playerVersionId !== rightCard.playerVersionId) return false;
    }
  }
  return true;
}

export function draftDuelFairAttemptForState(
  state: DraftDuelDraft,
  catalog: DraftDuelCatalog,
): number | null {
  if (state.fairness !== 'fair') return null;
  const firstRound = state.rounds[0];
  if (!firstRound) return null;
  const beforeAnyPicks: DraftDuelDraft = {
    ...state,
    pickOrdinal: 0,
    rounds: state.rounds.map((round) => ({ ...round, picks: [] })),
  };
  const context = buildOfferContext(beforeAnyPicks, catalog, 1);
  for (let attempt = 0; attempt < DRAFT_DUEL_MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const offers = buildFairOffers(context, attempt);
    if (offers !== null && offersMatch(offers, firstRound.offers)) return attempt;
  }
  return null;
}

export function buildRoundOffers(
  state: DraftDuelDraft,
  catalog: DraftDuelCatalog,
): DraftDuelRoundOffers {
  if (
    state.status !== 'drafting' ||
    state.pickOrdinal >= ROUND_COUNT * 2 ||
    state.pickOrdinal % 2 !== 0
  ) {
    throw new Error(
      `draft duel offers are generated at round starts (status ${state.status}, pickOrdinal ${String(state.pickOrdinal)})`,
    );
  }
  const round = Math.floor(state.pickOrdinal / 2) + 1;
  const context = buildOfferContext(state, catalog, round);
  let attemptPlan: number[];
  if (context.fairness === 'fair') {
    if (round === 1) {
      attemptPlan = Array.from(
        { length: DRAFT_DUEL_MAX_GENERATION_ATTEMPTS },
        (_, attempt) => attempt,
      );
    } else {
      const committedAttempt = draftDuelFairAttemptForState(state, catalog);
      if (committedAttempt === null) {
        throw new DraftDuelGenerationError(
          context.fairness,
          round,
          0,
          `draft duel fair generation could not recover the committed band history for round ${String(round)}`,
        );
      }
      attemptPlan = [committedAttempt];
    }
  } else {
    attemptPlan = Array.from(
      { length: DRAFT_DUEL_MAX_GENERATION_ATTEMPTS },
      (_, attempt) => attempt,
    );
  }
  let lastFailure = 'unknown';
  for (const attempt of attemptPlan) {
    const offers =
      context.fairness === 'fair'
        ? buildFairOffers(context, attempt)
        : buildUnfairOffers(context, attempt);
    if (offers === null) {
      lastFailure = 'a band token had no available player';
      continue;
    }
    if (!poolsSatisfyProtection(context, offers)) {
      lastFailure = 'position protection unmet';
      continue;
    }
    if (!draftDuelRoundSafetyHolds(withDraftDuelOffers(context.safetyBase, offers))) {
      lastFailure = 'joint safety failed';
      continue;
    }
    return offers;
  }
  throw new DraftDuelGenerationError(
    context.fairness,
    round,
    attemptPlan.length,
    `draft duel generation failed for round ${String(round)} (${context.fairness}) after ${String(attemptPlan.length)} generation attempt(s); last failure: ${lastFailure}`,
  );
}
