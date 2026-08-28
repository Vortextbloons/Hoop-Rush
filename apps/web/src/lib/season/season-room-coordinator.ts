import { InMemorySeasonMultiplayerTransport } from '@hoop-rush/data-contracts';
import type {
    SeasonMultiplayerTransport,
    SeasonRoomPublicSnapshot,
    SeasonPublicCommandEnvelope,
    SeasonPrivateDecisionSubmission,
    SeasonCheckpointAttestation,
} from '@hoop-rush/data-contracts';

export type SeasonRoomCoordinatorState = {
    roomId: string | null;
    participantId: 'p1' | 'p2' | null;
    franchiseId: string | null;
    opponentFranchiseId: string | null;
    publicSnapshot: SeasonRoomPublicSnapshot | null;
    connected: boolean;
    deadlineAt: string | null;
    locked: boolean;
    integrityFailed: boolean;
};

export type SeasonRoomCoordinatorDeps = {
    transport: SeasonMultiplayerTransport;
    onSnapshot: (snap: SeasonRoomPublicSnapshot) => void;
    onCommands: (commands: SeasonPublicCommandEnvelope[]) => void;
};

export function createSeasonRoomCoordinator(deps: SeasonRoomCoordinatorDeps) {
    let state: SeasonRoomCoordinatorState = {
        roomId: null,
        participantId: null,
        franchiseId: null,
        opponentFranchiseId: null,
        publicSnapshot: null,
        connected: false,
        deadlineAt: null,
        locked: false,
        integrityFailed: false,
    };
    let unsubscribe: (() => void) | null = null;
    let lastAcceptedOrdinal = -1;
    let uncommittedCandidate: unknown | null = null;

    return {
        get state() {
            return state;
        },
        get lastAcceptedOrdinal() {
            return lastAcceptedOrdinal;
        },
        get uncommittedCandidate() {
            return uncommittedCandidate;
        },
        setUncommitted(candidate: unknown) {
            uncommittedCandidate = candidate;
        },
        clearUncommitted() {
            uncommittedCandidate = null;
        },
        async createRoom(pace: 'live' | 'async', rootSeed: string) {
            const snap = await deps.transport.create(
                {
                    schemaVersion: 1,
                    pace,
                    roomProtocolVersion: 1,
                    multiplayerVersion: 'season-multiplayer-v1',
                    timerPolicyVersion: 'season-timers-v1',
                },
                rootSeed,
            );
            state = { ...state, roomId: snap.roomId, publicSnapshot: snap, connected: true };
            return snap;
        },
        async joinRoom(code: string) {
            const membership = await deps.transport.join(code);
            const snap = await deps.transport.resume(membership.roomId);
            state = {
                ...state,
                roomId: membership.roomId,
                participantId: membership.participantId,
                franchiseId: membership.franchiseId,
                publicSnapshot: snap,
                connected: true,
            };
            return { membership, snap };
        },
        async previewRoom(code: string) {
            return deps.transport.preview(code);
        },
        subscribe(roomId: string) {
            unsubscribe?.();
            const sub = deps.transport.subscribe(roomId, (snap) => {
                state = { ...state, publicSnapshot: snap };
                deps.onSnapshot(snap);
                // treat Realtime as notification, refetch authoritative commands
                deps.transport.refetch(roomId, lastAcceptedOrdinal).then((cmds) => {
                    if (cmds.length > 0) {
                        lastAcceptedOrdinal = cmds[cmds.length - 1]!.ordinal;
                        deps.onCommands(cmds);
                    }
                });
            });
            unsubscribe = sub.unsubscribe;
            state = { ...state, roomId, connected: true };
        },
        async refetchAfter(ordinal: number) {
            if (!state.roomId) return [];
            const cmds = await deps.transport.refetch(state.roomId, ordinal);
            if (cmds.length > 0) lastAcceptedOrdinal = cmds[cmds.length - 1]!.ordinal;
            return cmds;
        },
        async submitCommand(envelope: SeasonPublicCommandEnvelope) {
            const receipt = await deps.transport.submitCommand(envelope);
            if (receipt.accepted) lastAcceptedOrdinal = receipt.ordinal;
            return receipt;
        },
        async submitPrivateDecision(submission: SeasonPrivateDecisionSubmission) {
            return deps.transport.submitPrivateDecision(submission);
        },
        async publishAttestation(att: SeasonCheckpointAttestation) {
            const result = await deps.transport.publishAttestation(att);
            if ('acceptedAt' in result) {
                uncommittedCandidate = null;
            }
            return result;
        },
        async handleHashMismatch(inputDigest: string, resultDigest: string) {
            // first mismatch: discard candidate, reload checkpoint, rerun once
            uncommittedCandidate = null;
            return { rerun: true, verifiedInputDigest: inputDigest, verifiedResultDigest: resultDigest };
        },
        disconnect() {
            unsubscribe?.();
            unsubscribe = null;
            state = { ...state, connected: false };
        },
        destroy() {
            unsubscribe?.();
            unsubscribe = null;
        },
        // recovery: load last checkpoint and replay commands
        async reconnect(roomId: string, lastCheckpoint: unknown) {
            state = { ...state, roomId, connected: false };
            const snap = await deps.transport.resume(roomId);
            state = { ...state, publicSnapshot: snap, connected: true };
            const cmds = await deps.transport.refetch(roomId, lastAcceptedOrdinal);
            return { lastCheckpoint, commands: cmds, snapshot: snap };
        },
    };
}

export type SeasonRoomCoordinator = ReturnType<typeof createSeasonRoomCoordinator>;

// default in-memory coordinator for tests / local dev without Supabase
export function createInMemorySeasonRoomCoordinator(deps: Omit<SeasonRoomCoordinatorDeps, 'transport'> & { transport?: SeasonMultiplayerTransport }) {
    const transport = deps.transport ?? new InMemorySeasonMultiplayerTransport();
    return createSeasonRoomCoordinator({ ...deps, transport });
}
