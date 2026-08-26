import { SEASON_DRAFT_OFFER_SIZE, SEASON_DRAFT_VERSION, seasonDraftStateSchema, seasonLeagueSchema, seasonNamespaceSeed, seasonDigestHex, type SeasonDraftCatalog, type SeasonDraftCommand, type SeasonDraftCommandRecord, type SeasonDraftErrorCode, type SeasonDraftOffer, type SeasonDraftParticipant, type SeasonDraftPick, type SeasonDraftState, } from '@hoop-rush/data-contracts';
import { createRng } from '../sim/rng.ts';
import { validateDraftCatalog } from './catalog-validation.ts';
import { drawGlobalOffer } from './draft-offers.ts';
import { completionTargetsMet, legalFiveAfterAnyRemoval, rosterFeasible, type SeasonRosterMemberInput, } from './roster-rules.ts';
import { SeasonAiGenerationError, type SeasonAiGenerationInput, type SeasonLeagueGenerationResult, } from './ai.ts';
export type { SeasonAiGenerationInput, SeasonLeagueGenerationResult };
const DRAFT_SEED_KEYS = {
    franchiseAssignment: 'franchise-assignment',
    firstPick: 'first-pick',
} as const;
const MAX_PICKS_PER_PARTICIPANT = 10;
const ROUND_COUNT = 10;
const MIN_CATALOG_CANDIDATES = SEASON_DRAFT_OFFER_SIZE;
function participantIdsOf(state: SeasonDraftState): string[] {
    return [...state.participants.map((p) => p.participantId)].sort();
}
function participantOrder(state: SeasonDraftState, round: number): string[] {
    const sorted = participantIdsOf(state);
    const base = [
        state.firstPickParticipantId,
        ...sorted.filter((id) => id !== state.firstPickParticipantId),
    ];
    return round % 2 === 1 ? base : [...base].reverse();
}
function pickCount(state: SeasonDraftState, participantId: string): number {
    return state.picks.filter((p) => p.participantId === participantId).length;
}
function ownedVersionIds(state: SeasonDraftState): Set<string> {
    return new Set(state.picks.map((p) => p.playerVersionId));
}
function membersOf(versionIds: readonly string[], catalog: SeasonDraftCatalog): SeasonRosterMemberInput[] {
    const byId = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
    const members: SeasonRosterMemberInput[] = [];
    for (const versionId of versionIds) {
        const candidate = byId.get(versionId);
        if (candidate === undefined) {
            throw new Error(`catalog is missing owned version ${versionId}`);
        }
        members.push({ playerVersionId: versionId, playable: candidate.positions.playable });
    }
    return members;
}
export function seasonDraftStateDigest(state: SeasonDraftState): string {
    return seasonDigestHex(seasonDraftStateCanonical(state));
}
export function seasonDraftStateCanonical(state: SeasonDraftState): string {
    return JSON.stringify({
        draftVersion: state.draftVersion,
        runId: state.runId,
        rootSeed: state.rootSeed,
        league: state.league,
        participants: [...state.participants].sort((a, b) => a.participantId < b.participantId ? -1 : 1),
        firstPickParticipantId: state.firstPickParticipantId,
        round: state.round,
        currentTurnParticipantId: state.currentTurnParticipantId,
        status: state.status,
        revision: state.revision,
        currentOffer: state.currentOffer,
        offers: [...state.offers].sort((a, b) => `${a.participantId}:${String(a.round)}` < `${b.participantId}:${String(b.round)}` ? -1 : 1),
        picks: [...state.picks].sort((a, b) => `${a.participantId}:${String(a.round)}` < `${b.participantId}:${String(b.round)}` ? -1 : 1),
        commandLog: state.commandLog,
    });
}
function rejectedRecord(state: SeasonDraftState | null, command: SeasonDraftCommand, errorCode: SeasonDraftErrorCode, message: string): SeasonDraftCommandRecord {
    return {
        status: 'rejected',
        commandId: command.commandId,
        revision: state?.revision ?? 0,
        errorCode,
        message,
        command,
    };
}
function withLog(state: SeasonDraftState, record: SeasonDraftCommandRecord): SeasonDraftState {
    return { ...state, commandLog: [...state.commandLog, record] };
}
function acceptedAgainst(nextState: SeasonDraftState, command: SeasonDraftCommand, revisionBefore: number): SeasonDraftCommandRecord {
    return {
        status: 'accepted',
        commandId: command.commandId,
        revisionBefore,
        revisionAfter: nextState.revision,
        stateDigest: seasonDraftStateDigest(nextState),
        command,
    };
}
interface CommandResult {
    state: SeasonDraftState | null;
    record: SeasonDraftCommandRecord;
    generation: SeasonLeagueGenerationResult | null;
}
function createDraft(command: SeasonDraftCommand, catalog: SeasonDraftCatalog): CommandResult {
    const payload = command.payload;
    if (payload.kind !== 'create-season-draft') {
        throw new Error('createDraft requires a create-season-draft payload');
    }
    const reject = (code: SeasonDraftErrorCode, message: string): CommandResult => ({
        state: null,
        record: rejectedRecord(null, command, code, message),
        generation: null,
    });
    const leagueParse = seasonLeagueSchema.safeParse(payload.league);
    if (!leagueParse.success) {
        return reject('INVALID_CATALOG', 'create-season-draft league fails the league schema');
    }
    const league = leagueParse.data;
    const humanIds = payload.humanParticipantIds;
    if (new Set(humanIds).size !== humanIds.length) {
        return reject('INVALID_CATALOG', 'human participant ids must be distinct');
    }
    if (catalog.candidates.length < MIN_CATALOG_CANDIDATES) {
        return reject('UNCOMPLETABLE_ROSTER', `catalog has ${String(catalog.candidates.length)} candidates; need at least ${String(MIN_CATALOG_CANDIDATES)} to draw a global eight-card offer`);
    }
    const assignmentRng = createRng(seasonNamespaceSeed(payload.rootSeed, 'draft', DRAFT_SEED_KEYS.franchiseAssignment));
    const remainingFranchises = league.teams.map((team) => team.franchiseId).sort();
    const participants: SeasonDraftParticipant[] = [];
    for (const participantId of [...humanIds].sort()) {
        if (remainingFranchises.length === 0) {
            return reject('INVALID_CATALOG', 'no distinct franchise remains for a participant');
        }
        const franchiseId = assignmentRng.pick(remainingFranchises);
        participants.push({ participantId, franchiseId });
        remainingFranchises.splice(remainingFranchises.indexOf(franchiseId), 1);
    }
    const firstPickParticipantId = createRng(seasonNamespaceSeed(payload.rootSeed, 'draft', DRAFT_SEED_KEYS.firstPick)).pick([...humanIds].sort());
    const bareState: SeasonDraftState = {
        schemaVersion: 2,
        draftVersion: SEASON_DRAFT_VERSION,
        runId: payload.runId,
        rootSeed: payload.rootSeed,
        league,
        catalogVersion: SEASON_DRAFT_VERSION,
        participants,
        firstPickParticipantId,
        round: 1,
        currentTurnParticipantId: firstPickParticipantId,
        status: 'drafting',
        revision: 1,
        currentOffer: null,
        offers: [],
        picks: [],
        commandLog: [],
    };
    const record = acceptedAgainst(bareState, command, 0);
    const state = withLog(bareState, record);
    return { state, record, generation: null };
}
function advanceTurn(state: SeasonDraftState): {
    round: number;
    currentTurnParticipantId: string | null;
} {
    const allFull = state.participants.every((p) => pickCount(state, p.participantId) >= MAX_PICKS_PER_PARTICIPANT);
    if (allFull) {
        return { round: ROUND_COUNT, currentTurnParticipantId: null };
    }
    const order = participantOrder(state, state.round);
    const currentIndex = order.indexOf(state.currentTurnParticipantId ?? '');
    for (let i = currentIndex + 1; i < order.length; i += 1) {
        const id = order[i];
        if (id !== undefined && pickCount(state, id) < MAX_PICKS_PER_PARTICIPANT) {
            return { round: state.round, currentTurnParticipantId: id };
        }
    }
    const nextRound = state.round + 1;
    if (nextRound > ROUND_COUNT) {
        return { round: ROUND_COUNT, currentTurnParticipantId: null };
    }
    const nextOrder = participantOrder(state, nextRound);
    const nextPicker = nextOrder.find((id) => pickCount(state, id) < MAX_PICKS_PER_PARTICIPANT);
    if (nextPicker === undefined) {
        return { round: ROUND_COUNT, currentTurnParticipantId: null };
    }
    return { round: nextRound, currentTurnParticipantId: nextPicker };
}
function drawOffer(state: SeasonDraftState, catalog: SeasonDraftCatalog, command: SeasonDraftCommand): CommandResult {
    const payload = command.payload;
    if (payload.kind !== 'draw-season-offer') {
        throw new Error('drawOffer requires a draw-season-offer payload');
    }
    const pid = payload.participantId;
    if (state.status !== 'drafting' || state.currentTurnParticipantId === null) {
        return {
            state,
            record: rejectedRecord(state, command, 'WRONG_TURN', 'no turn is active for a draw'),
            generation: null,
        };
    }
    if (pid !== state.currentTurnParticipantId) {
        return {
            state,
            record: rejectedRecord(state, command, 'WRONG_TURN', `it is ${state.currentTurnParticipantId}'s turn, not ${pid}'s`),
            generation: null,
        };
    }
    if (state.currentOffer !== null) {
        const nextState: SeasonDraftState = { ...state, revision: state.revision + 1 };
        const record = acceptedAgainst(nextState, command, state.revision);
        return { state: withLog(nextState, record), record, generation: null };
    }
    const draw = drawGlobalOffer(state, catalog, pid);
    if (draw.status === 'too-few-candidates') {
        return {
            state,
            record: rejectedRecord(state, command, 'NO_FEASIBLE_GLOBAL_OFFER', `only ${String(draw.remainingCount)} unowned candidates remain; need at least ${String(SEASON_DRAFT_OFFER_SIZE)} to draw an offer`),
            generation: null,
        };
    }
    if (draw.status === 'too-few-safe') {
        return {
            state,
            record: rejectedRecord(state, command, 'NO_FEASIBLE_GLOBAL_OFFER', `only ${String(draw.safeCount)} feasibility-safe candidates remain; need at least 3 to draw an offer`),
            generation: null,
        };
    }
    const offer: SeasonDraftOffer = draw.offer;
    const nextState: SeasonDraftState = {
        ...state,
        currentOffer: offer,
        offers: [...state.offers, offer],
        revision: state.revision + 1,
    };
    const record = acceptedAgainst(nextState, command, state.revision);
    return { state: withLog(nextState, record), record, generation: null };
}
function selectPlayer(state: SeasonDraftState, catalog: SeasonDraftCatalog, command: SeasonDraftCommand): CommandResult {
    const payload = command.payload;
    if (payload.kind !== 'select-draft-player') {
        throw new Error('selectPlayer requires a select payload');
    }
    const pid = payload.participantId;
    if (state.status !== 'drafting' || state.currentTurnParticipantId === null) {
        return {
            state,
            record: rejectedRecord(state, command, 'ILLEGAL_PICK', 'the draft is not in a pickable state'),
            generation: null,
        };
    }
    if (pid !== state.currentTurnParticipantId) {
        return {
            state,
            record: rejectedRecord(state, command, 'WRONG_TURN', `it is ${state.currentTurnParticipantId}'s turn, not ${pid}'s`),
            generation: null,
        };
    }
    if (state.currentOffer === null) {
        return {
            state,
            record: rejectedRecord(state, command, 'NO_OFFER_DRAWN', 'no offer is drawn for this turn'),
            generation: null,
        };
    }
    const offer = state.currentOffer;
    const card = offer.cards.find((c) => c.playerVersionId === payload.playerVersionId);
    if (card === undefined) {
        return {
            state,
            record: rejectedRecord(state, command, 'UNAVAILABLE_POOL', `version ${payload.playerVersionId} is not in the current offer`),
            generation: null,
        };
    }
    if (state.picks.some((p) => p.playerVersionId === payload.playerVersionId)) {
        return {
            state,
            record: rejectedRecord(state, command, 'OWNED_VERSION', 'that player version is already owned'),
            generation: null,
        };
    }
    if (pickCount(state, pid) >= MAX_PICKS_PER_PARTICIPANT) {
        return {
            state,
            record: rejectedRecord(state, command, 'ILLEGAL_PICK', 'the roster is already full'),
            generation: null,
        };
    }
    if (!card.selectable) {
        const reason = card.coverageReason ?? 'the card is not feasibility-safe';
        return {
            state,
            record: rejectedRecord(state, command, 'UNCOMPLETABLE_ROSTER', `this pick is disabled: ${reason}`),
            generation: null,
        };
    }
    const candidate = catalog.candidates.find((c) => c.playerVersionId === payload.playerVersionId);
    if (candidate === undefined) {
        return {
            state,
            record: rejectedRecord(state, command, 'UNAVAILABLE_POOL', 'the selected version is not in the catalog'),
            generation: null,
        };
    }
    const ownedMembers = membersOf(state.picks.filter((p) => p.participantId === pid).map((p) => p.playerVersionId), catalog);
    const probe: SeasonRosterMemberInput[] = [
        ...ownedMembers,
        { playerVersionId: candidate.playerVersionId, playable: candidate.positions.playable },
    ];
    const available = catalog.candidates
        .filter((c) => !ownedVersionIds(state).has(c.playerVersionId))
        .filter((c) => c.playerVersionId !== candidate.playerVersionId)
        .map((c) => ({ playerVersionId: c.playerVersionId, playable: c.positions.playable }));
    const remaining = MAX_PICKS_PER_PARTICIPANT - ownedMembers.length - 1;
    if (!rosterFeasible(probe, available, remaining)) {
        return {
            state,
            record: rejectedRecord(state, command, 'UNCOMPLETABLE_ROSTER', 'this pick would make the final roster constraints impossible'),
            generation: null,
        };
    }
    const pick: SeasonDraftPick = {
        participantId: pid,
        round: offer.round,
        pickOrdinal: offer.pickOrdinal,
        playerVersionId: payload.playerVersionId,
        franchiseId: candidate.franchiseId,
        eraId: candidate.eraId,
        seedPath: offer.seedPath,
    };
    const withPick = { ...state, picks: [...state.picks, pick] };
    const { round, currentTurnParticipantId } = advanceTurn(withPick);
    const nextState: SeasonDraftState = {
        ...withPick,
        currentOffer: null,
        round,
        currentTurnParticipantId,
        revision: state.revision + 1,
    };
    const record = acceptedAgainst(nextState, command, state.revision);
    return { state: withLog(nextState, record), record, generation: null };
}
function finalizeRosters(state: SeasonDraftState, catalog: SeasonDraftCatalog, command: SeasonDraftCommand): CommandResult {
    if (state.status !== 'drafting') {
        return {
            state,
            record: rejectedRecord(state, command, 'ILLEGAL_PICK', 'finalize requires a drafting state'),
            generation: null,
        };
    }
    for (const participant of state.participants) {
        const picks = state.picks.filter((p) => p.participantId === participant.participantId);
        if (picks.length !== MAX_PICKS_PER_PARTICIPANT) {
            return {
                state,
                record: rejectedRecord(state, command, 'UNCOMPLETABLE_ROSTER', `${participant.participantId} has ${String(picks.length)} picks; need ${String(MAX_PICKS_PER_PARTICIPANT)}`),
                generation: null,
            };
        }
        const members = membersOf(picks.map((p) => p.playerVersionId), catalog);
        if (!completionTargetsMet(members)) {
            return {
                state,
                record: rejectedRecord(state, command, 'UNCOMPLETABLE_ROSTER', `${participant.participantId}'s roster misses the 4/4/3 completion target`),
                generation: null,
            };
        }
        if (!legalFiveAfterAnyRemoval(members)) {
            return {
                state,
                record: rejectedRecord(state, command, 'UNCOMPLETABLE_ROSTER', `${participant.participantId}'s roster has no legal five after every single absence`),
                generation: null,
            };
        }
    }
    const nextState: SeasonDraftState = {
        ...state,
        status: 'finalized',
        currentTurnParticipantId: null,
        revision: state.revision + 1,
    };
    const record = acceptedAgainst(nextState, command, state.revision);
    return { state: withLog(nextState, record), record, generation: null };
}
function generateAiLeague(state: SeasonDraftState, catalog: SeasonDraftCatalog, command: SeasonDraftCommand, deps: SeasonAiGenerationDeps): CommandResult {
    if (state.status !== 'finalized') {
        return {
            state,
            record: rejectedRecord(state, command, 'ILLEGAL_PICK', 'generate-ai-league requires finalized human rosters'),
            generation: null,
        };
    }
    const input: Omit<SeasonAiGenerationInput, 'targets'> = {
        seed: state.rootSeed,
        catalog,
        league: state.league,
        humanFranchiseIds: state.participants.map((p) => p.franchiseId),
        humanRosters: state.participants.map((p) => ({
            franchiseId: p.franchiseId,
            playerVersionIds: state.picks
                .filter((pick) => pick.participantId === p.participantId)
                .map((pick) => pick.playerVersionId),
        })),
    };
    let generation: SeasonLeagueGenerationResult;
    try {
        generation = deps.generate(input);
    }
    catch (error) {
        if (error instanceof SeasonAiGenerationError) {
            return {
                state,
                record: rejectedRecord(state, command, 'GENERATION_EXHAUSTED', `${error.message}: ${String(error.diagnostics.failedTeams.length)} failed teams, ${String(error.diagnostics.unmetConstraints.length)} unmet constraints, ${String(error.diagnostics.nodesVisited)} nodes visited`),
                generation: null,
            };
        }
        throw error;
    }
    const nextState: SeasonDraftState = {
        ...state,
        status: 'complete',
        revision: state.revision + 1,
    };
    const record = acceptedAgainst(nextState, command, state.revision);
    return { state: withLog(nextState, record), record, generation };
}
export interface SeasonAiGenerationDeps {
    generate: (input: Omit<SeasonAiGenerationInput, 'targets'>) => SeasonLeagueGenerationResult;
}
export function applySeasonDraftCommand(state: SeasonDraftState | null, catalog: SeasonDraftCatalog, command: SeasonDraftCommand, deps: SeasonAiGenerationDeps): {
    state: SeasonDraftState | null;
    record: SeasonDraftCommandRecord;
    generation: SeasonLeagueGenerationResult | null;
} {
    let validatedCatalog: SeasonDraftCatalog;
    try {
        validatedCatalog = validateDraftCatalog(catalog);
    }
    catch {
        return {
            state,
            record: rejectedRecord(state, command, 'INVALID_CATALOG', 'draft catalog is invalid'),
            generation: null,
        };
    }
    if (state === null) {
        if (command.payload.kind !== 'create-season-draft') {
            const errorCode: SeasonDraftErrorCode = command.payload.kind === 'reveal-draft-roll' || command.payload.kind === 'claim-draft-pool'
                ? 'UNSUPPORTED_COMMAND'
                : 'INVALID_CATALOG';
            return {
                state: null,
                record: rejectedRecord(null, command, errorCode, 'no draft exists; only create-season-draft is accepted'),
                generation: null,
            };
        }
        return createDraft(command, validatedCatalog);
    }
    const parsedState = seasonDraftStateSchema.safeParse(state);
    if (!parsedState.success) {
        throw new Error('draft state fails the schema; refusing to continue');
    }
    const validatedState = parsedState.data;
    const prior = validatedState.commandLog.find((record) => record.commandId === command.commandId);
    if (prior !== undefined) {
        return { state: validatedState, record: prior, generation: null };
    }
    if (command.expectedRevision !== validatedState.revision) {
        const record = rejectedRecord(validatedState, command, 'STALE_REVISION', `expected revision ${String(validatedState.revision)}, got ${String(command.expectedRevision)}`);
        return { state: withLog(validatedState, record), record, generation: null };
    }
    switch (command.payload.kind) {
        case 'create-season-draft': {
            const record = rejectedRecord(validatedState, command, 'STALE_REVISION', 'a draft already exists');
            return { state: withLog(validatedState, record), record, generation: null };
        }
        case 'reveal-draft-roll':
        case 'claim-draft-pool':
            return {
                state: validatedState,
                record: rejectedRecord(validatedState, command, 'UNSUPPORTED_COMMAND', 'season-draft-v1 reveal/claim commands are not supported by season-draft-v2'),
                generation: null,
            };
        case 'draw-season-offer':
            return drawOffer(validatedState, validatedCatalog, command);
        case 'select-draft-player':
            return selectPlayer(validatedState, validatedCatalog, command);
        case 'finalize-human-rosters':
            return finalizeRosters(validatedState, validatedCatalog, command);
        case 'generate-ai-league':
            return generateAiLeague(validatedState, validatedCatalog, command, deps);
    }
}
