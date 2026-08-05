import {
  SEASON_DRAFT_OFFER_SIZE,
  SEASON_DRAFT_SAFE_MINIMUM,
  seasonNamespaceSeed,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonDraftOffer,
  type SeasonDraftOfferCard,
  type SeasonDraftState,
} from '@hoop-rush/data-contracts';
import { createRng } from '../sim/rng.ts';
import { groupMaskOf, rosterFeasible, type SeasonRosterMemberInput } from './roster-rules.ts';

/**
 * M2.3.5 global eight-card offer generation (spec/2.0/03, season-draft-v2).
 * One offer per turn is drawn from the complete catalog minus already-owned
 * exact versions:
 *
 * 1. Remaining candidates are canonically sorted by `playerVersionId`.
 * 2. Every candidate is tested against the 4G/4F/3C completion-feasibility
 *    probe (same pattern the pick command uses); safe candidates are marked
 *    selectable.
 * 3. Exactly `SEASON_DRAFT_SAFE_MINIMUM` feasibility-safe candidates are
 *    selected deterministically (seeded, with removal, from the sorted safe
 *    list).
 * 4. Five additional distinct candidates are sampled deterministically from
 *    the remaining (unowned, not among the three) candidates without
 *    feasibility filtering.
 * 5. Sampled cards that would break completion feasibility stay visible with
 *    `selectable: false` and a stable coverage reason.
 *
 * Fewer than `SEASON_DRAFT_SAFE_MINIMUM` safe candidates (or fewer than
 * `SEASON_DRAFT_OFFER_SIZE` unowned candidates) is a typed
 * `NO_FEASIBLE_GLOBAL_OFFER` rejection; rules are never relaxed.
 *
 * Seed sub-key scheme (spec/2.0/07 seed tree; persisted verbatim on each
 * offer's `seedPath`):
 *
 *   ['draft', 'offer', <participantId>, <round>, <pickOrdinal>,
 *    'safe-order', 'sample-order']
 *
 *   offerSeed   = seasonNamespaceSeed(rootSeed, 'draft', 'offer', pid,
 *                 String(round), String(pickOrdinal))
 *   safeSeed    = seasonNamespaceSeed(offerSeed, 'safe-order')
 *   sampleSeed  = seasonNamespaceSeed(offerSeed, 'sample-order')
 *
 * The safe-selected three and the five sampled cards are stable functions of
 * (canonically-sorted remaining candidates, seed), so replaying a persisted
 * seedPath against the same (root seed, state, catalog) reproduces the offer
 * byte-for-byte.
 */

/** Draw seed keys appended to the `draft/offer/<pid>/<round>/<pickOrdinal>` prefix. */
export const OFFER_SAFE_ORDER_KEY = 'safe-order';
export const OFFER_SAMPLE_ORDER_KEY = 'sample-order';

/** Stable reason shown beside disabled offer cards (null on selectable cards). */
export const SEASON_DRAFT_COVERAGE_REASON =
  'Selecting this version would leave the 4G/4F/3C completion targets unreachable with the remaining picks';

const ROSTER_SIZE = 10;

/** Canonically sorted unowned candidates (by playerVersionId). */
export function remainingCandidates(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
): SeasonDraftCandidate[] {
  const owned = new Set(state.picks.map((pick) => pick.playerVersionId));
  return catalog.candidates
    .filter((candidate) => !owned.has(candidate.playerVersionId))
    .sort((a, b) => a.playerVersionId.localeCompare(b.playerVersionId));
}

/** Members for the feasibility probe: unowned candidates minus one version. */
function availableMembers(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
  excludeVersionId: string | null,
): SeasonRosterMemberInput[] {
  const owned = new Set(state.picks.map((pick) => pick.playerVersionId));
  const members: SeasonRosterMemberInput[] = [];
  for (const candidate of catalog.candidates) {
    if (owned.has(candidate.playerVersionId)) continue;
    if (candidate.playerVersionId === excludeVersionId) continue;
    members.push({
      playerVersionId: candidate.playerVersionId,
      playable: candidate.positions.playable,
    });
  }
  return members;
}

function ownedMembers(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
  participantId: string,
): SeasonRosterMemberInput[] {
  const byId = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
  const members: SeasonRosterMemberInput[] = [];
  for (const pick of state.picks) {
    if (pick.participantId !== participantId) continue;
    const candidate = byId.get(pick.playerVersionId);
    if (candidate === undefined) {
      throw new Error(`catalog is missing owned version ${pick.playerVersionId}`);
    }
    members.push({ playerVersionId: pick.playerVersionId, playable: candidate.positions.playable });
  }
  return members;
}

/**
 * True when selecting this version keeps the participant's 4G/4F/3C
 * completion targets reachable with the remaining picks. The probed
 * candidate itself is no longer available for future picks.
 */
export function selectionKeepsFeasibility(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
  participantId: string,
  candidate: SeasonDraftCandidate,
): boolean {
  const owned = ownedMembers(state, catalog, participantId);
  const remaining = ROSTER_SIZE - owned.length - 1;
  if (remaining < 0) return false;
  const probe: SeasonRosterMemberInput[] = [
    ...owned,
    { playerVersionId: candidate.playerVersionId, playable: candidate.positions.playable },
  ];
  const available = availableMembers(state, catalog, candidate.playerVersionId);
  return rosterFeasible(probe, available, remaining);
}

/** The full seed path recorded on an offer for a given turn. */
export function offerSeedPath(participantId: string, round: number, pickOrdinal: number): string[] {
  return [
    'draft',
    'offer',
    participantId,
    String(round),
    String(pickOrdinal),
    OFFER_SAFE_ORDER_KEY,
    OFFER_SAMPLE_ORDER_KEY,
  ];
}

export type SeasonOfferDrawResult =
  | { status: 'drawn'; offer: SeasonDraftOffer }
  | { status: 'too-few-candidates'; remainingCount: number }
  | { status: 'too-few-safe'; safeCount: number };

/**
 * Draws one deterministic eight-card offer for the participant's current
 * turn, or returns the typed infeasibility reason. Pure function of
 * (root seed, state, catalog, participant id); the caller persists the offer
 * and its seed path.
 */
export function drawGlobalOffer(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
  participantId: string,
): SeasonOfferDrawResult {
  const candidates = remainingCandidates(state, catalog);
  if (candidates.length < SEASON_DRAFT_OFFER_SIZE) {
    return { status: 'too-few-candidates', remainingCount: candidates.length };
  }
  // Feasibility depends only on the candidate's coarse group mask, so the
  // whole candidate set is probed once per mask (at most seven probes) and
  // every candidate with a safe mask is marked safe. This is exactly
  // equivalent to probing every candidate individually, because removing one
  // candidate from its mask bucket changes that bucket's count identically
  // for every candidate in the bucket.
  const maskOfCandidate = new Map(
    candidates.map((candidate) => [
      candidate.playerVersionId,
      groupMaskOf(candidate.positions.playable),
    ]),
  );
  const probedMasks = new Map<number, boolean>();
  for (const candidate of candidates) {
    const mask = maskOfCandidate.get(candidate.playerVersionId) ?? 0;
    if (probedMasks.has(mask)) continue;
    probedMasks.set(mask, selectionKeepsFeasibility(state, catalog, participantId, candidate));
  }
  const safeCandidates = candidates.filter(
    (candidate) => probedMasks.get(maskOfCandidate.get(candidate.playerVersionId) ?? 0) === true,
  );
  if (safeCandidates.length < SEASON_DRAFT_SAFE_MINIMUM) {
    return { status: 'too-few-safe', safeCount: safeCandidates.length };
  }
  const round = state.round;
  const pickOrdinal = state.picks.filter((pick) => pick.participantId === participantId).length + 1;
  const seedPath = offerSeedPath(participantId, round, pickOrdinal);
  const offerSeed = seasonNamespaceSeed(
    state.rootSeed,
    'draft',
    'offer',
    participantId,
    String(round),
    String(pickOrdinal),
  );

  // Step 3: exactly three feasibility-safe candidates, deterministically.
  const safePool = [...safeCandidates];
  const safeRng = createRng(seasonNamespaceSeed(offerSeed, OFFER_SAFE_ORDER_KEY));
  const safeSelected: SeasonDraftCandidate[] = [];
  for (let i = 0; i < SEASON_DRAFT_SAFE_MINIMUM; i += 1) {
    const picked = safeRng.pick(safePool);
    safePool.splice(safePool.indexOf(picked), 1);
    safeSelected.push(picked);
  }

  // Step 4: five additional distinct candidates, sampled without filtering.
  const sampledIds = new Set(safeSelected.map((candidate) => candidate.playerVersionId));
  const samplePool = candidates.filter((candidate) => !sampledIds.has(candidate.playerVersionId));
  const sampleRng = createRng(seasonNamespaceSeed(offerSeed, OFFER_SAMPLE_ORDER_KEY));
  const sampled: SeasonDraftCandidate[] = [];
  for (let i = 0; i < SEASON_DRAFT_OFFER_SIZE - SEASON_DRAFT_SAFE_MINIMUM; i += 1) {
    const picked = sampleRng.pick(samplePool);
    samplePool.splice(samplePool.indexOf(picked), 1);
    sampled.push(picked);
  }

  const cardOf = (candidate: SeasonDraftCandidate): SeasonDraftOfferCard => {
    const selectable = selectionKeepsFeasibility(state, catalog, participantId, candidate);
    return {
      playerVersionId: candidate.playerVersionId,
      selectable,
      coverageReason: selectable ? null : SEASON_DRAFT_COVERAGE_REASON,
    };
  };
  const offer: SeasonDraftOffer = {
    participantId,
    round,
    pickOrdinal,
    seedPath,
    cards: [...safeSelected, ...sampled].map(cardOf),
  };
  return { status: 'drawn', offer };
}
