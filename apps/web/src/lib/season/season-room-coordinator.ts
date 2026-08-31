import { InMemorySeasonMultiplayerTransport } from '@hoop-rush/data-contracts';
import type {
  SeasonMultiplayerTransport,
  SeasonRoomPublicSnapshot,
  SeasonPublicCommandEnvelope,
  SeasonPrivateDecisionSubmission,
  SeasonCheckpointAttestation,
  SeasonRoomMode,
  SeasonRoomPace,
  SeasonRoomMembership,
  SeasonRoomCode,
} from '@hoop-rush/data-contracts';
import {
  SEASON_MULTIPLAYER_VERSION,
  SEASON_ROOM_PROTOCOL_SCHEMA_VERSION,
  SEASON_TIMER_POLICY_VERSION,
} from '@hoop-rush/data-contracts';
import {
  saveMembership,
  loadMembership,
  saveCode,
  loadCode,
  saveLastRoomId,
  clearMembership,
  clearCode,
} from './season-room-identity';

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
  onCommands: (commands: SeasonPublicCommandEnvelope[]) => void | Promise<void>;
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
  let commandSync = Promise.resolve();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let lastAcceptedOrdinal = -1;
  let uncommittedCandidate: unknown | null = null;

  function startHeartbeat(roomId: string) {
    stopHeartbeat();
    // heartbeat every 5s, presence offline after 30s (generous slack for asset loads / throttling)
    heartbeatTimer = setInterval(() => {
      const pid = state.participantId;
      if (!pid || !state.roomId) return;
      void deps.transport.heartbeat(state.roomId, pid).catch(() => {});
    }, 5_000);
    // immediate heartbeat
    const pid = state.participantId;
    if (pid) void deps.transport.heartbeat(roomId, pid).catch(() => {});
  }
  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

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
    async createRoom(pace: 'live' | 'async', rootSeed: string, mode: SeasonRoomMode = 'season') {
      const snap = await deps.transport.create(
        {
          schemaVersion: SEASON_ROOM_PROTOCOL_SCHEMA_VERSION,
          pace,
          mode,
          roomProtocolVersion: SEASON_ROOM_PROTOCOL_SCHEMA_VERSION,
          multiplayerVersion: SEASON_MULTIPLAYER_VERSION,
          timerPolicyVersion: SEASON_TIMER_POLICY_VERSION,
        },
        rootSeed,
      );
      // persist identity: membership may come from transport (in-memory) or via auto-join; code for host lobby
      const membership = snap.membership ?? null;
      const code = snap.code ?? null;
      if (membership) {
        saveMembership(membership);
        state = {
          ...state,
          roomId: membership.roomId,
          participantId: membership.participantId,
          franchiseId: membership.franchiseId,
          publicSnapshot: snap,
          connected: true,
        };
      } else {
        state = { ...state, roomId: snap.roomId, publicSnapshot: snap, connected: true };
      }
      if (code) saveCode(snap.roomId, code);
      saveLastRoomId(snap.roomId);
      if (state.roomId) startHeartbeat(state.roomId);
      return snap;
    },
    async joinRoom(code: string) {
      const membership = await deps.transport.join(code);
      const snapRes = await deps.transport.resume(membership.roomId);
      // resume now may also return membership; retain private membership per spec
      const snap = snapRes;
      const effectiveMembership =
        (snap as unknown as { membership?: SeasonRoomMembership }).membership ?? membership;
      if ((snap as unknown as { membership?: SeasonRoomMembership }).membership) {
        saveMembership((snap as unknown as { membership: SeasonRoomMembership }).membership);
      } else {
        saveMembership(membership);
      }
      saveLastRoomId(effectiveMembership.roomId);
      // also persist code? join doesn't give code but we keep room code cleared; no saveCode
      state = {
        ...state,
        roomId: effectiveMembership.roomId,
        participantId: effectiveMembership.participantId,
        franchiseId: effectiveMembership.franchiseId,
        publicSnapshot: snap,
        connected: true,
      };
      startHeartbeat(effectiveMembership.roomId);
      return { membership: effectiveMembership, snap: snap as SeasonRoomPublicSnapshot };
    },
    async previewRoom(code: string) {
      return deps.transport.preview(code);
    },
    hydrateFromStorage(roomId: string): SeasonRoomMembership | null {
      const stored = loadMembership(roomId);
      if (stored) {
        state = {
          ...state,
          roomId: stored.roomId,
          participantId: stored.participantId,
          franchiseId: stored.franchiseId,
        };
      }
      return stored;
    },
    getStoredMembership(roomId: string): SeasonRoomMembership | null {
      return loadMembership(roomId);
    },
    getStoredCode(roomId: string): SeasonRoomCode | null {
      return loadCode(roomId);
    },
    async startDraft(roomId: string) {
      const snap = await deps.transport.startDraft(roomId);
      state = { ...state, publicSnapshot: snap };
      deps.onSnapshot(snap);
      return snap;
    },
    async updateSettings(roomId: string, mode: SeasonRoomMode, pace: SeasonRoomPace) {
      const revision = state.publicSnapshot?.settingsRevision;
      const snap = await deps.transport.updateSettings(roomId, { mode, pace }, revision);
      state = { ...state, publicSnapshot: snap };
      deps.onSnapshot(snap);
      return snap;
    },
    async setReady(roomId: string, ready: boolean) {
      const pid = state.participantId;
      if (!pid) throw Object.assign(new Error('not a member'), { code: 'membership' });
      const revision = state.publicSnapshot?.settingsRevision;
      const snap = await deps.transport.setReady(roomId, pid, ready, revision);
      state = { ...state, publicSnapshot: snap };
      deps.onSnapshot(snap);
      return snap;
    },
    async heartbeat(roomId: string) {
      const pid = state.participantId;
      if (!pid) return;
      try {
        await deps.transport.heartbeat(roomId, pid);
      } catch {}
    },
    async leave(roomId: string) {
      const pid = state.participantId;
      if (!pid) return;
      await deps.transport.leave(roomId, pid);
      clearMembership(roomId);
      clearCode(roomId);
      stopHeartbeat();
      state = {
        ...state,
        roomId: null,
        participantId: null,
        franchiseId: null,
        publicSnapshot: null,
        connected: false,
      };
    },
    async refresh(roomId: string) {
      const res = deps.transport.refresh
        ? await deps.transport.refresh(roomId)
        : await deps.transport.resume(roomId);
      const snap = res;
      if (snap.membership) {
        saveMembership(snap.membership);
        state = {
          ...state,
          roomId: snap.membership.roomId,
          participantId: snap.membership.participantId,
          franchiseId: snap.membership.franchiseId,
          publicSnapshot: snap,
          connected: true,
        };
      } else {
        // fallback: try to hydrate membership from storage
        const stored = loadMembership(roomId);
        if (stored) {
          state = {
            ...state,
            roomId,
            participantId: stored.participantId,
            franchiseId: stored.franchiseId,
            publicSnapshot: snap,
            connected: true,
          };
        } else {
          state = { ...state, publicSnapshot: snap };
        }
      }
      deps.onSnapshot(snap);
      startHeartbeat(roomId);
      return snap;
    },
    async resume(roomId: string) {
      const res = deps.transport.refresh
        ? await deps.transport.refresh(roomId)
        : await deps.transport.resume(roomId);
      const snap = res;
      if (snap.membership) {
        saveMembership(snap.membership);
        state = {
          ...state,
          roomId: snap.membership.roomId,
          participantId: snap.membership.participantId,
          franchiseId: snap.membership.franchiseId,
          publicSnapshot: snap,
          connected: true,
        };
      } else {
        const stored = loadMembership(roomId);
        if (stored)
          state = {
            ...state,
            roomId,
            participantId: stored.participantId,
            franchiseId: stored.franchiseId,
            publicSnapshot: snap,
            connected: true,
          };
        else state = { ...state, publicSnapshot: snap };
      }
      deps.onSnapshot(snap);
      startHeartbeat(roomId);
      return snap;
    },
    subscribe(roomId: string) {
      // hydrate identity before subscribing so room page knows "You are P1/P2" even after reload
      const stored = loadMembership(roomId);
      if (stored && !state.participantId) {
        state = {
          ...state,
          roomId: stored.roomId,
          participantId: stored.participantId,
          franchiseId: stored.franchiseId,
        };
      } else if (!state.roomId) {
        state = { ...state, roomId, connected: false };
      }
      unsubscribe?.();
      stopHeartbeat();
      const sub = deps.transport.subscribe(roomId, (snap) => {
        state = { ...state, publicSnapshot: snap };
        deps.onSnapshot(snap);
        // treat Realtime as notification, refetch authoritative commands
        commandSync = commandSync
          .then(async () => {
            const after = Number.isFinite(lastAcceptedOrdinal) ? lastAcceptedOrdinal : -1;
            const cmds = await deps.transport.refetch(roomId, after);
            if (cmds.length > 0) {
              await deps.onCommands(cmds);
              const last = cmds[cmds.length - 1];
              if (last && typeof last.ordinal === 'number') lastAcceptedOrdinal = last.ordinal;
            }
          })
          .catch((error: unknown) => {
            console.error('[season-room-coordinator] command sync failed', error);
          });
      });
      unsubscribe = sub.unsubscribe;
      state = { ...state, roomId, connected: true };
      startHeartbeat(roomId);
    },
    async refetchAfter(ordinal: number) {
      if (!state.roomId) return [];
      const after = Number.isFinite(ordinal) ? ordinal : -1;
      const cmds = await deps.transport.refetch(state.roomId, after);
      const last = cmds[cmds.length - 1];
      if (last && typeof last.ordinal === 'number') lastAcceptedOrdinal = last.ordinal;
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
      stopHeartbeat();
      state = { ...state, connected: false };
    },
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      stopHeartbeat();
    },
    // recovery: load last checkpoint and replay commands
    async reconnect(roomId: string, lastCheckpoint: unknown) {
      state = { ...state, roomId, connected: false };
      const snap = await deps.transport.resume(roomId);
      state = { ...state, publicSnapshot: snap, connected: true };
      const after = Number.isFinite(lastAcceptedOrdinal) ? lastAcceptedOrdinal : -1;
      const cmds = await deps.transport.refetch(roomId, after);
      return { lastCheckpoint, commands: cmds, snapshot: snap };
    },
  };
}

export type SeasonRoomCoordinator = ReturnType<typeof createSeasonRoomCoordinator>;

// default in-memory coordinator for tests / local dev without Supabase
export function createInMemorySeasonRoomCoordinator(
  deps: Omit<SeasonRoomCoordinatorDeps, 'transport'> & { transport?: SeasonMultiplayerTransport },
) {
  const transport = deps.transport ?? new InMemorySeasonMultiplayerTransport();
  return createSeasonRoomCoordinator({ ...deps, transport });
}
