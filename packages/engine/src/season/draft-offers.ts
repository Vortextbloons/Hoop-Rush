import { SEASON_DRAFT_OFFER_SIZE, SEASON_DRAFT_SAFE_MINIMUM, seasonNamespaceSeed, type SeasonDraftCandidate, type SeasonDraftCatalog, type SeasonDraftOffer, type SeasonDraftOfferCard, type SeasonDraftState, } from '@hoop-rush/data-contracts';
import { createRng } from '../sim/rng.ts';
import { SEASON_ROSTER_SIZE, groupMaskOf, rosterFeasible, type SeasonRosterMemberInput, } from './roster-rules.ts';
export const OFFER_SAFE_ORDER_KEY = 'safe-order';
export const OFFER_SAMPLE_ORDER_KEY = 'sample-order';
export const SEASON_DRAFT_COVERAGE_REASON = 'Selecting this version would leave the 4G/4F/3C completion targets unreachable with the remaining picks';
export function multiHumanDraft(state: SeasonDraftState): boolean {
    return state.participants.length > 1;
}
export function ownedPlayerIds(state: SeasonDraftState, catalog: SeasonDraftCatalog): Set<string> {
    const byVersion = new Map(catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]));
    const owned = new Set<string>();
    for (const pick of state.picks) {
        const candidate = byVersion.get(pick.playerVersionId);
        if (candidate !== undefined)
            owned.add(candidate.playerId);
    }
    return owned;
}
function identityAvailable(state: SeasonDraftState, catalog: SeasonDraftCatalog, candidate: SeasonDraftCandidate): boolean {
    if (!multiHumanDraft(state))
        return true;
    return !ownedPlayerIds(state, catalog).has(candidate.playerId);
}
export function remainingCandidates(state: SeasonDraftState, catalog: SeasonDraftCatalog): SeasonDraftCandidate[] {
    const owned = new Set(state.picks.map((pick) => pick.playerVersionId));
    return catalog.candidates
        .filter((candidate) => !owned.has(candidate.playerVersionId))
        .filter((candidate) => identityAvailable(state, catalog, candidate))
        .sort((a, b) => a.playerVersionId.localeCompare(b.playerVersionId));
}
function availableMembers(state: SeasonDraftState, catalog: SeasonDraftCatalog, excludeVersionId: string | null): SeasonRosterMemberInput[] {
    const owned = new Set(state.picks.map((pick) => pick.playerVersionId));
    const members: SeasonRosterMemberInput[] = [];
    for (const candidate of catalog.candidates) {
        if (owned.has(candidate.playerVersionId))
            continue;
        if (candidate.playerVersionId === excludeVersionId)
            continue;
        if (!identityAvailable(state, catalog, candidate))
            continue;
        members.push({
            playerVersionId: candidate.playerVersionId,
            playable: candidate.positions.playable,
        });
    }
    return members;
}
function ownedMembers(state: SeasonDraftState, catalog: SeasonDraftCatalog, participantId: string): SeasonRosterMemberInput[] {
    const byId = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
    const members: SeasonRosterMemberInput[] = [];
    for (const pick of state.picks) {
        if (pick.participantId !== participantId)
            continue;
        const candidate = byId.get(pick.playerVersionId);
        if (candidate === undefined) {
            throw new Error(`catalog is missing owned version ${pick.playerVersionId}`);
        }
        members.push({ playerVersionId: pick.playerVersionId, playable: candidate.positions.playable });
    }
    return members;
}
export function selectionKeepsFeasibility(state: SeasonDraftState, catalog: SeasonDraftCatalog, participantId: string, candidate: SeasonDraftCandidate): boolean {
    const owned = ownedMembers(state, catalog, participantId);
    const remaining = SEASON_ROSTER_SIZE - owned.length - 1;
    if (remaining < 0)
        return false;
    const probe: SeasonRosterMemberInput[] = [
        ...owned,
        { playerVersionId: candidate.playerVersionId, playable: candidate.positions.playable },
    ];
    const available = availableMembers(state, catalog, candidate.playerVersionId);
    return rosterFeasible(probe, available, remaining);
}
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
export type SeasonOfferDrawResult = {
    status: 'drawn';
    offer: SeasonDraftOffer;
} | {
    status: 'too-few-candidates';
    remainingCount: number;
} | {
    status: 'too-few-safe';
    safeCount: number;
};
export function drawGlobalOffer(state: SeasonDraftState, catalog: SeasonDraftCatalog, participantId: string): SeasonOfferDrawResult {
    const candidates = remainingCandidates(state, catalog);
    if (candidates.length < SEASON_DRAFT_OFFER_SIZE) {
        return { status: 'too-few-candidates', remainingCount: candidates.length };
    }
    const maskOfCandidate = new Map(candidates.map((candidate) => [
        candidate.playerVersionId,
        groupMaskOf(candidate.positions.playable),
    ]));
    const probedMasks = new Map<number, boolean>();
    for (const candidate of candidates) {
        const mask = maskOfCandidate.get(candidate.playerVersionId) ?? 0;
        if (probedMasks.has(mask))
            continue;
        probedMasks.set(mask, selectionKeepsFeasibility(state, catalog, participantId, candidate));
    }
    const safeCandidates = candidates.filter((candidate) => probedMasks.get(maskOfCandidate.get(candidate.playerVersionId) ?? 0) === true);
    if (safeCandidates.length < SEASON_DRAFT_SAFE_MINIMUM) {
        return { status: 'too-few-safe', safeCount: safeCandidates.length };
    }
    const round = state.round;
    const pickOrdinal = state.picks.filter((pick) => pick.participantId === participantId).length + 1;
    const seedPath = offerSeedPath(participantId, round, pickOrdinal);
    const offerSeed = seasonNamespaceSeed(state.rootSeed, 'draft', 'offer', participantId, String(round), String(pickOrdinal));
    const safePool = [...safeCandidates];
    const safeRng = createRng(seasonNamespaceSeed(offerSeed, OFFER_SAFE_ORDER_KEY));
    const safeSelected: SeasonDraftCandidate[] = [];
    for (let i = 0; i < SEASON_DRAFT_SAFE_MINIMUM; i += 1) {
        const picked = safeRng.pick(safePool);
        safePool.splice(safePool.indexOf(picked), 1);
        safeSelected.push(picked);
    }
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
