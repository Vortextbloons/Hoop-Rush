<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { asset, resolve } from '$app/paths';
  import {
    Check,
    Copy,
    ArrowLeft,
    ArrowRight,
    Users,
    Clock,
    LockKeyhole,
    Link,
    LogOut,
    ShieldCheck,
  } from '@lucide/svelte';
  import type {
    CommandId,
    ContentHash,
    FixedFiveCommand,
    FixedFiveCommandPayload,
    FixedFiveCompetitionResult,
    FixedFiveRoomSnapshot,
    FixedFiveVerificationReceipt,
    FixedFiveWorkerResultEntry,
    Id,
    PlayersIndexEntry,
    Seed,
    SlotIndex,
  } from '@hoop-rush/data-contracts';
  import {
    commandIdSchema,
    contentHashSchema,
    fixedFiveTimeoutMsForMode,
    idSchema,
    playerVersionId,
  } from '@hoop-rush/data-contracts';
  import { z } from 'zod';
  import { getFixedFiveTransport } from '$lib/fixed-five-transport';
  import { submitFixedFiveCommand } from '$lib/fixed-five-command-submit';
  import {
    friendlyFixedFiveJoinError,
    loadFixedFiveMembership,
    saveFixedFiveMembership,
  } from '$lib/fixed-five-identity';
  import { fixedFiveRepository } from '$lib/fixed-five-repo';
  import { FixedFiveRunner } from '$lib/fixed-five-runner';
  import {
    FixedFiveSimulationGate,
    type FixedFiveSimulationReason,
  } from '$lib/fixed-five-simulation-gate';
  import FixedFiveScoreboard from '$lib/components/FixedFiveScoreboard.svelte';
  import FixedFiveDraftPanel from '$lib/components/FixedFiveDraftPanel.svelte';
  import FixedFiveSimShow from '$lib/components/FixedFiveSimShow.svelte';
  import FixedFiveResults from '$lib/components/FixedFiveResults.svelte';
  import {
    aggregateFixedFivePlayerStats,
    type FixedFivePlayerStats,
  } from '$lib/fixed-five-player-stats';
  import { rollAnimationFor } from '$lib/fixed-five-roll-animation';
  import {
    assembleCompetitionRun,
    buildFixedFiveVerificationInput,
    buildSimulationTeam,
    computeCompetitionDigest,
    computeDueAutopick,
    deriveEffectivePhase,
    isDraftComplete,
    isFixedFiveDraftTurn,
    loadActivityAt,
    loadFixedFiveAssets,
    mergeFixedFiveCommands,
    overlaySnapshotProgress,
    refsForParticipant,
    replayFixedFiveLog,
    restoreFixedFiveCommandSyncState,
    roomLogFacts,
    saveActivityNow,
    summarizeWorkerEntries,
    type DraftReplay,
    type FixedFiveAssets,
    type PickRef,
  } from '$lib/fixed-five-room-state';
  import { presentationForVariant } from '$lib/draft-presentation';
  import ArenaSoundToggle from '$lib/components/ArenaSoundToggle.svelte';
  import { arenaWin } from '$lib/arena-sound';
  import type { SimulationPlayer } from '@hoop-rush/data-contracts';
  import type { FixedFiveWorkerTeam } from '@hoop-rush/data-contracts';
  let roomId = $derived($page.params.roomId as string);
  let snapshot = $state<FixedFiveRoomSnapshot | null>(null);
  let commands = $state<FixedFiveCommand[]>([]);
  let assets = $state<FixedFiveAssets | null>(null);
  let assetsError = $state<string | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let draftError = $state<string | null>(null);
  let reconnecting = $state(false);
  let syncing = $state(false);
  let lastOrdinal = $state(-1);
  let selfId = $state<'p1' | 'p2'>('p1');
  let mounted = true;
  let tick = $state(0);
  const SIM_SHOWDOWN_MIN_MS = 7000;
  const SIM_SHOWDOWN_REDUCED_MS = 400;
  let progress = $state<{
    completed: number;
    total: number;
  } | null>(null);
  let simStarted = $state(false);
  let simStartAt = $state(0);
  let simDone = $state(false);
  let simError = $state<string | null>(null);
  let simEntries = $state<FixedFiveWorkerResultEntry[]>([]);
  let statsEntries = $state<FixedFiveWorkerResultEntry[]>([]);
  let statsBuilding = $state(false);
  let statsRebuildStarted = $state(false);
  let runner: FixedFiveRunner | null = null;
  let statsRunner: FixedFiveRunner | null = null;
  const simulationGate = new FixedFiveSimulationGate();
  let simulationReason: FixedFiveSimulationReason = 'initial';
  interface LocalResult {
    result: FixedFiveCompetitionResult;
    digest: ContentHash;
    p1: {
      refs: PickRef[];
      players: SimulationPlayer[];
    };
    p2: {
      refs: PickRef[];
      players: SimulationPlayer[];
    };
    weakestReplacedOpponentId: string | null;
  }
  let localResult = $state<LocalResult | null>(null);
  let submittedPropose = $state<ContentHash | null>(null);
  let confirmedFor = $state<ContentHash | null>(null);
  let reranMismatch = $state(false);
  let mismatchReported = $state(false);
  let completedPairKey = $state<string | null>(null);
  let completeNotReady = $state(false);
  let completeInFlight = false;
  let failSent = $state(false);
  let verificationReceipt = $state<FixedFiveVerificationReceipt | null>(null);
  let verificationError = $state<string | null>(null);
  let verificationInFlight = $state(false);
  let verificationRunner: FixedFiveRunner | null = null;
  let submittedReceipt = $state<string | null>(null);
  let receiptSubmitInFlight = false;
  let receiptRetry = $state(0);
  let receiptRebuilds = 0;
  let receiptsUnsupported = $state(false);
  function isMissingFunctionError(e: unknown): boolean {
    const message = e instanceof Error ? e.message : String(e);
    if (/schema cache|PGRST202|404/.test(message)) return true;
    const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : null;
    return code === 'PGRST202';
  }
  function markReceiptsUnsupported(): void {
    if (receiptsUnsupported) return;
    receiptsUnsupported = true;
    verificationError = null;
    saveVerifyGuards();
    if (mounted) {
      notice = 'Checking that both players have the same result.';
    }
  }
  function verifyGuardStorageKey(id: string): string {
    return `hoop-rush:fixed-five:verify:${id}`;
  }
  function saveVerifyGuards(): void {
    try {
      localStorage.setItem(
        verifyGuardStorageKey(roomId),
        JSON.stringify({
          submittedPropose,
          confirmedFor,
          reranMismatch,
          mismatchReported,
          receiptsUnsupported,
        }),
      );
    } catch {}
  }
  const verifyGuardSchema = z.object({
    submittedPropose: contentHashSchema.nullable().optional(),
    confirmedFor: contentHashSchema.nullable().optional(),
    reranMismatch: z.boolean().optional(),
    mismatchReported: z.boolean().optional(),
    receiptsUnsupported: z.boolean().optional(),
  });
  function restoreVerifyGuards(): void {
    try {
      const raw = localStorage.getItem(verifyGuardStorageKey(roomId));
      if (!raw) return;
      const result = verifyGuardSchema.safeParse(JSON.parse(raw));
      if (!result.success) return;
      if (result.data.submittedPropose) submittedPropose = result.data.submittedPropose;
      if (result.data.confirmedFor) confirmedFor = result.data.confirmedFor;
      if (result.data.reranMismatch === true) reranMismatch = true;
      if (result.data.mismatchReported === true) mismatchReported = true;
    } catch {}
  }
  let busyAction = $state<string | null>(null);
  let leaveBusy = $state(false);
  let rematchBusy = $state(false);
  let submittedTimeouts = $state<Set<string>>(new Set());
  let copiedInvite = $state(false);
  let copiedCode = $state(false);
  let winPlayed = $state(false);
  const replay = $derived.by((): DraftReplay | null => {
    if (!snapshot || !assets || !snapshot.rootSeed) return null;
    try {
      return replayFixedFiveLog(
        snapshot.settings.mode,
        snapshot.roomId,
        snapshot.rootSeed,
        snapshot.settings.versions.dataVersion,
        snapshot.settings.variant,
        assets,
        commands,
        snapshot.settings.sourceMode,
        snapshot.settings.versions.multiplayerVersion,
      );
    } catch {
      return null;
    }
  });
  const facts = $derived(roomLogFacts(commands));
  const rollAnimation = $derived(
    rollAnimationFor(commands, snapshot?.settings.mode ?? 'classic-shared-82', selfId),
  );
  const phase = $derived(
    snapshot && replay
      ? deriveEffectivePhase(snapshot.phase, replay, simDone)
      : (snapshot?.phase ?? 'lobby'),
  );
  const display = $derived(
    snapshot && replay ? overlaySnapshotProgress(snapshot, replay, facts) : snapshot,
  );
  const presentation = $derived(presentationForVariant(snapshot?.settings.variant ?? 'ratings'));
  const indexById = $derived(
    assets
      ? new Map<string, PlayersIndexEntry>(
          assets.index.players.map((p) => [p.playerId as string, p]),
        )
      : new Map<string, PlayersIndexEntry>(),
  );
  const indexByVersionId = $derived(
    assets
      ? new Map<string, PlayersIndexEntry>(
          assets.index.players.map((p) => [
            playerVersionId(p.playerId, p.franchiseId, p.eraId, p.seasonKey),
            p,
          ]),
        )
      : new Map<string, PlayersIndexEntry>(),
  );
  const p1ResultRows = $derived.by((): (PlayersIndexEntry | null)[] => {
    const rows: (PlayersIndexEntry | null)[] = [null, null, null, null, null];
    if (!localResult) return rows;
    for (const ref of localResult.p1.refs) {
      if (ref.slotIndex >= 0 && ref.slotIndex < 5)
        rows[ref.slotIndex] =
          (ref.playerVersionId ? indexByVersionId.get(ref.playerVersionId) : null) ??
          indexById.get(ref.playerId as string) ??
          null;
    }
    return rows;
  });
  const p2ResultRows = $derived.by((): (PlayersIndexEntry | null)[] => {
    const rows: (PlayersIndexEntry | null)[] = [null, null, null, null, null];
    if (!localResult) return rows;
    for (const ref of localResult.p2.refs) {
      if (ref.slotIndex >= 0 && ref.slotIndex < 5)
        rows[ref.slotIndex] =
          (ref.playerVersionId ? indexByVersionId.get(ref.playerVersionId) : null) ??
          indexById.get(ref.playerId as string) ??
          null;
    }
    return rows;
  });
  const statsSource = $derived(statsEntries.length > 0 ? statsEntries : simEntries);
  const playerStats = $derived.by((): FixedFivePlayerStats | null => {
    if (!snapshot || statsSource.length === 0) return null;
    try {
      return aggregateFixedFivePlayerStats(snapshot.settings.mode, statsSource, 'p1', 'p2');
    } catch {
      return null;
    }
  });
  const statsState = $derived<'ready' | 'building' | 'empty'>(
    playerStats ? 'ready' : statsBuilding ? 'building' : 'empty',
  );
  const opponent = $derived(display?.members.find((m) => m.participantId !== selfId) ?? null);
  const timeoutMs = $derived(
    snapshot ? fixedFiveTimeoutMsForMode(snapshot.settings.mode) : 90 * 1000,
  );
  const anchorMs = $derived.by(() => {
    void tick;
    const stored = loadActivityAt(roomId);
    if (stored) return stored;
    return snapshot ? Date.parse(snapshot.createdAt) : Date.now();
  });
  const clockText = $derived.by((): string | null => {
    if (!snapshot || phase !== 'drafting') return null;
    void tick;
    const deadlineMs = snapshot.deadline
      ? Date.parse(snapshot.deadline.deadlineAt)
      : anchorMs + timeoutMs;
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) return 'Time is up · choosing an automatic pick…';
    const total = Math.floor(remaining / 1000);
    return `Pick clock: ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  });
  const lastAutopick = $derived.by(
    (): {
      displayName: string;
      seedPath: string;
    } | null => {
      if (!assets) return null;
      const timeouts = commands.filter((c) => c.payload.kind === 'timeout-autopick');
      const last = timeouts[timeouts.length - 1];
      if (!last) return null;
      const payload = last.payload;
      if (payload.kind !== 'timeout-autopick') return null;
      const row = payload.playerVersionId
        ? assets.index.players.find(
            (p) =>
              playerVersionId(p.playerId, p.franchiseId, p.eraId, p.seasonKey) ===
              payload.playerVersionId,
          )
        : assets.index.players.find((p) => p.playerId === payload.playerId);
      return { displayName: row?.displayName ?? payload.playerId, seedPath: payload.seedPath };
    },
  );
  function transport() {
    return getFixedFiveTransport();
  }
  async function copyInviteLink() {
    if (!snapshot?.code) return;
    error = null;
    try {
      await navigator.clipboard.writeText(
        new URL(`${resolve('/multiplayer')}?code=${snapshot.code}`, window.location.origin).href,
      );
      if (!mounted) return;
      copiedInvite = true;
      setTimeout(() => {
        if (mounted) copiedInvite = false;
      }, 1500);
    } catch {
      if (mounted) error = 'Could not copy the invite. Share the room code instead.';
    }
  }
  async function copyRoomCode() {
    if (!snapshot?.code) return;
    error = null;
    try {
      await navigator.clipboard.writeText(snapshot.code);
      if (!mounted) return;
      copiedCode = true;
      setTimeout(() => {
        if (mounted) copiedCode = false;
      }, 1500);
    } catch {
      if (mounted) error = 'Could not copy the code. You can select and copy the digits below.';
    }
  }
  function brandedRoomId(): Id {
    return idSchema.parse(roomId);
  }
  function newCommandId(provided?: string): CommandId {
    return provided ? commandIdSchema.parse(provided) : commandIdSchema.parse(crypto.randomUUID());
  }
  async function sync(afterOrdinal: number): Promise<void> {
    if (!snapshot) return;
    syncing = true;
    try {
      const fresh = await transport().refetch(roomId, afterOrdinal);
      if (!mounted) return;
      if (fresh.length > 0) {
        const merged = mergeFixedFiveCommands(commands, fresh);
        const addedCount = merged.length - commands.length;
        commands = merged;
        const byOrdinal = new Map(merged.map((c) => [c.ordinal, c] as const));
        let contiguous = lastOrdinal;
        while (byOrdinal.has(contiguous + 1)) contiguous += 1;
        lastOrdinal = contiguous;
        for (const command of fresh) {
          try {
            await fixedFiveRepository.appendCommand(command);
          } catch {}
        }
        saveActivityNow(roomId);
        if (addedCount > 0) {
          notice = 'Room is up to date.';
        }
      }
      await fixedFiveRepository.saveActiveSnapshot(snapshot, lastOrdinal + 1).catch(() => {});
      if (verificationReceipt && submittedReceipt === null) receiptRetry += 1;
    } catch (e) {
      if (mounted) error = friendlyFixedFiveJoinError(e);
    } finally {
      if (mounted) syncing = false;
    }
  }
  async function sendCommand(
    payload: FixedFiveCommandPayload,
    options?: {
      actor?: 'p1' | 'p2';
      commandId?: string;
      retry?: boolean;
    },
  ): Promise<boolean> {
    error = null;
    const commandId = newCommandId(options?.commandId);
    try {
      const result = await submitFixedFiveCommand({
        submitCommand: (command) => transport().submitCommand(command),
        roomId: brandedRoomId(),
        commandId,
        actorParticipantId: options?.actor ?? selfId,
        payload,
        expectedRevision: snapshot?.revision,
        resync: () => sync(lastOrdinal),
        retry: options?.retry,
        retryAfterResync: () => {
          if (payload.kind === 'propose-result') {
            return localResult?.digest === payload.resultDigest;
          }
          const currentResult = localResult;
          if (payload.kind !== 'confirm-result' || !currentResult) return false;
          const freshForeign = roomLogFacts(commands).proposals.filter(
            (proposal) => proposal.actor !== selfId,
          );
          if (payload.verified) {
            return (
              currentResult.digest === payload.resultDigest &&
              freshForeign.some((proposal) => proposal.digest === payload.resultDigest)
            );
          }
          return (
            reranMismatch &&
            currentResult.digest !== payload.resultDigest &&
            freshForeign.some((proposal) => proposal.digest === payload.resultDigest) &&
            !freshForeign.some((proposal) => proposal.digest === currentResult.digest)
          );
        },
      });
      const receipt = result.receipt;
      if (snapshot && receipt.revision > snapshot.revision) {
        snapshot = { ...snapshot, revision: receipt.revision };
      }
      if (result.retried && receipt.accepted) {
        notice = 'Room changed while sending — resynced and recovered.';
      }
      if (!receipt.accepted && receipt.rejectionCode === 'stale-revision') {
        notice = 'Stale command — resyncing once before a single retry.';
        if (mounted) {
          error = result.retried
            ? 'The room changed again during the retry. The command was not applied.'
            : 'The room changed and invalidated this command. It was not applied.';
          return false;
        }
      } else if (!receipt.accepted) {
        error = `Command rejected: ${receipt.rejectionCode ?? 'unknown'}`;
        return false;
      }
      saveActivityNow(roomId);
      await sync(lastOrdinal);
      return true;
    } catch (e) {
      if (mounted) error = friendlyFixedFiveJoinError(e);
      return false;
    }
  }
  async function sendPick(player: PlayersIndexEntry, slot: SlotIndex): Promise<void> {
    draftError = null;
    if (!snapshot || !replay) return;
    const playerId = player.playerId;
    const playerVersion = playerVersionId(
      player.playerId,
      player.franchiseId,
      player.eraId,
      player.seasonKey,
    );
    const mode = snapshot.settings.mode;
    if (mode === 'sandbox-shared-82') {
      if (replay.mode !== 'sandbox-shared-82') {
        draftError = 'The draft is still syncing — try again in a moment.';
        return;
      }
      if (replay.draftStyle === 'snake') {
        if (!isFixedFiveDraftTurn(replay, selfId)) {
          draftError = 'Wait for your opponent to finish this pick.';
          return;
        }
        await sendCommand({
          kind: 'sandbox-place',
          playerId,
          playerVersionId: playerVersion,
          slotIndex: slot,
        });
        return;
      }
      const builder = selfId === 'p1' ? replay.p1 : replay.p2;
      const incumbent = builder.placements.find((p) => p.slotIndex === slot) ?? null;
      const subjectPlaced = builder.placements.some((p) => p.playerId === playerId);
      if (!incumbent && !subjectPlaced) {
        await sendCommand({
          kind: 'sandbox-place',
          playerId,
          playerVersionId: playerVersion,
          slotIndex: slot,
        });
        return;
      }
      const repositioned = await sendCommand({
        kind: 'sandbox-reposition',
        playerId,
        slotIndex: slot,
      });
      if (!repositioned) {
        draftError = 'That rearrangement is no longer legal — resync and try again.';
      }
      return;
    }
    if (mode === 'duel') {
      if (replay.mode === 'sandbox-duel') {
        if (!isFixedFiveDraftTurn(replay, selfId)) {
          draftError = 'Wait for your opponent to finish this pick.';
          return;
        }
        await sendCommand({
          kind: 'sandbox-place',
          playerId,
          playerVersionId: playerVersion,
          slotIndex: slot,
        });
        return;
      }
      if (replay.mode !== 'duel' || !replay.state.currentRoll) {
        draftError = 'No active duel roll.';
        return;
      }
      if (!isFixedFiveDraftTurn(replay, selfId)) {
        draftError = 'Wait for your opponent to finish this pick.';
        return;
      }
      const roll = replay.state.currentRoll;
      await sendCommand({
        kind: 'duel-claim',
        playerId,
        slotIndex: slot,
        franchiseId: roll.franchiseId,
        eraId: roll.eraId,
      });
      return;
    }
    if (replay.mode !== 'classic-shared-82') {
      await sendCommand({ kind: 'classic-pick', playerId, slotIndex: slot });
      return;
    }
    const draft = selfId === 'p1' ? replay.p1 : replay.p2;
    if (draft.picks.some((pick) => pick.playerId === playerId)) {
      await sendCommand({ kind: 'classic-reposition', playerId, slotIndex: slot });
      return;
    }
    await sendCommand({ kind: 'classic-pick', playerId, slotIndex: slot });
  }
  type VerificationOutcome =
    | {
        ok: true;
        receipt: FixedFiveVerificationReceipt;
      }
    | {
        ok: false;
        failures: string[];
      };
  function runVerification(
    input: Parameters<FixedFiveRunner['verify']>[0],
  ): Promise<VerificationOutcome> {
    return new Promise((resolve) => {
      const active = new FixedFiveRunner((event) => {
        if (event.kind === 'progress' || event.kind === 'results' || event.kind === 'complete') {
          return;
        }
        active.dispose();
        if (verificationRunner === active) verificationRunner = null;
        if (event.kind === 'verified') resolve({ ok: true, receipt: event.receipt });
        else if (event.kind === 'verification-failed')
          resolve({ ok: false, failures: event.failures });
        else resolve({ ok: false, failures: [event.message] });
      });
      verificationRunner = active;
      active.verify(input);
    });
  }
  async function prepareReceipt(): Promise<void> {
    if (verificationInFlight || !snapshot || !assets || !localResult || !snapshot.rootSeed) return;
    verificationInFlight = true;
    verificationError = null;
    try {
      const challenge = await transport().verificationChallenge(roomId);
      const current = localResult;
      if (!mounted || !snapshot || !assets || !current) return;
      const input = buildFixedFiveVerificationInput({
        roomId,
        competition: snapshot.settings.mode === 'duel' ? 'duel' : 'shared-82',
        rootSeed: snapshot.rootSeed,
        versions: snapshot.settings.versions,
        challenge,
        commands,
        bracket: assets.bracket,
        profile: assets.profile,
        result: current.result,
        resultDigest: current.digest,
        p1: current.p1,
        p2: current.p2,
      });
      const outcome = await runVerification(input);
      if (!mounted) return;
      if (!outcome.ok) {
        verificationError = outcome.failures.join('; ');
        return;
      }
      verificationReceipt = outcome.receipt;
      void storeReceipt(outcome.receipt);
    } catch (e) {
      if (isMissingFunctionError(e)) {
        markReceiptsUnsupported();
      } else if (mounted) {
        verificationError = e instanceof Error ? e.message : String(e);
      }
    } finally {
      verificationInFlight = false;
    }
  }
  async function storeReceipt(receipt: FixedFiveVerificationReceipt): Promise<void> {
    if (receiptSubmitInFlight || submittedReceipt === receipt.receiptDigest) return;
    receiptSubmitInFlight = true;
    try {
      const out = await transport().submitVerification(roomId, receipt, snapshot?.revision);
      if (!mounted) return;
      submittedReceipt = out.receiptId;
      if (snapshot && out.revision > snapshot.revision) {
        snapshot = { ...snapshot, revision: out.revision };
      }
    } catch (e) {
      const rejection = e as {
        rejectionCode?: unknown;
        revision?: unknown;
      };
      if (
        typeof rejection.revision === 'number' &&
        snapshot &&
        rejection.revision > snapshot.revision
      ) {
        snapshot = { ...snapshot, revision: rejection.revision };
      }
      if (rejection.rejectionCode === 'invalid-receipt' && receiptRebuilds < 2) {
        receiptRebuilds += 1;
        verificationReceipt = null;
        verificationError = null;
        if (mounted) {
          notice = 'Verification receipt was rejected — rebuilding it from the accepted log.';
        }
      } else if (rejection.rejectionCode === 'invalid-receipt') {
        if (mounted) {
          verificationError =
            'The server rejected the verification receipt for this accepted command log.';
        }
      } else if (isMissingFunctionError(e)) {
        markReceiptsUnsupported();
      } else if (mounted) {
        notice = 'Verification receipt is ready but not stored yet — retrying after the next sync.';
      }
      if (mounted) void sync(lastOrdinal);
    } finally {
      receiptSubmitInFlight = false;
    }
  }
  async function resolveOverdue(): Promise<void> {
    if (!snapshot || !assets || !snapshot.rootSeed || !replay || phase !== 'drafting') return;
    const mode = snapshot.settings.mode;
    const now = Date.now();
    const deadline = snapshot.deadline;
    if (!deadline) return;
    if (now < Date.parse(deadline.deadlineAt)) return;
    const participant = deadline.participantId;
    if (participant !== selfId) return;
    const ordinal = deadline.pickOrdinal;
    const key = `${participant}:${ordinal}`;
    if (submittedTimeouts.has(key)) return;
    const applied = commands.some(
      (c) =>
        c.actorParticipantId === participant &&
        c.payload.kind === 'timeout-autopick' &&
        c.payload.pickOrdinal === ordinal,
    );
    if (applied) return;
    const pick = computeDueAutopick(mode, snapshot.rootSeed, replay, assets, participant);
    if (!pick) return;
    submittedTimeouts = new Set([...submittedTimeouts, key]);
    try {
      const stored = await transport().commitFallback(
        roomId,
        deadline.cursor,
        {
          kind: 'timeout-autopick',
          playerId: pick.playerId,
          playerVersionId: pick.playerVersionId,
          slotIndex: pick.slotIndex,
          pickOrdinal: ordinal,
          seedPath: pick.seedPath,
        },
        snapshot?.revision,
      );
      if (snapshot && stored.revision > snapshot.revision) {
        snapshot = { ...snapshot, revision: stored.revision };
      }
      if (!stored.stored) {
        submittedTimeouts = new Set([...submittedTimeouts].filter((entry) => entry !== key));
        return;
      }
      await transport().resolveTimeout(roomId);
      await sync(lastOrdinal);
    } catch (e) {
      submittedTimeouts = new Set([...submittedTimeouts].filter((entry) => entry !== key));
      if (isMissingFunctionError(e)) {
        markReceiptsUnsupported();
        submittedTimeouts = new Set([...submittedTimeouts, key]);
        void sendCommand(
          {
            kind: 'timeout-autopick',
            playerId: pick.playerId,
            playerVersionId: pick.playerVersionId,
            slotIndex: pick.slotIndex,
            pickOrdinal: ordinal,
            seedPath: pick.seedPath,
          },
          { actor: participant, commandId: `timeout-${deadline.cursor}-${ordinal}` },
        );
        return;
      }
      if (mounted) error = friendlyFixedFiveJoinError(e);
    }
  }
  async function startSim(reason: FixedFiveSimulationReason): Promise<void> {
    if (simStarted || !snapshot || !assets || !snapshot.rootSeed || !replay) return;
    if (!simulationGate.tryStart(reason)) return;
    simStarted = true;
    simError = null;
    try {
      const rootSeed: Seed = snapshot.rootSeed;
      const p1Refs = refsForParticipant(replay, assets, 'p1');
      const p2Refs = refsForParticipant(replay, assets, 'p2');
      if (p1Refs.length !== 5 || p2Refs.length !== 5) {
        throw new Error('both lineups must be complete before simulating');
      }
      const pending = await fixedFiveRepository.loadPendingResult(roomId).catch(() => null);
      const p1Team: FixedFiveWorkerTeam = await buildSimulationTeam(
        assets.manifest,
        'p1',
        'Player 1',
        p1Refs,
      );
      const p2Team: FixedFiveWorkerTeam = await buildSimulationTeam(
        assets.manifest,
        'p2',
        'Player 2',
        p2Refs,
      );
      if (pending?.run.result) {
        localResult = {
          result: pending.run.result,
          digest: pending.run.resultDigest,
          p1: { refs: p1Refs, players: [...p1Team.players] },
          p2: { refs: p2Refs, players: [...p2Team.players] },
          weakestReplacedOpponentId: pending.run.authorityFacts.weakestReplacedOpponentId,
        };
        simulationGate.finish();
        simDone = true;
        return;
      }
      simEntries = [];
      progress = { completed: 0, total: snapshot.settings.mode === 'duel' ? 7 : 161 };
      simStartAt = Date.now();
      const active = new FixedFiveRunner((event) => {
        if (!mounted) return;
        if (event.kind === 'progress') {
          progress = { completed: event.completedGames, total: event.totalGames };
        } else if (event.kind === 'results') {
          simEntries = [...simEntries, ...event.entries];
          progress = { completed: simEntries.length, total: progress?.total ?? simEntries.length };
        } else if (event.kind === 'complete') {
          void finalizeSim();
        } else if (event.kind === 'error') {
          simulationGate.fail();
          simError = event.message;
        }
      });
      runner = active;
      const versions = snapshot.settings.versions;
      if (snapshot.settings.mode === 'duel') {
        active.runDuel({
          rootSeed,
          p1Team,
          p2Team,
          profile: assets.profile,
          dataVersion: versions.dataVersion,
          engineVersion: versions.engineVersion,
        });
      } else {
        active.runShared82({
          rootSeed,
          p1Team,
          p2Team,
          bracket: assets.bracket,
          profile: assets.profile,
          dataVersion: versions.dataVersion,
          engineVersion: versions.engineVersion,
        });
      }
      async function finalizeSim(): Promise<void> {
        if (!mounted || !snapshot || !assets) return;
        try {
          const summary = summarizeWorkerEntries({
            mode: snapshot.settings.mode,
            bracket: assets.bracket,
            rootSeed: snapshot.rootSeed as Seed,
            p1TeamId: 'p1',
            p2TeamId: 'p2',
            p1PlayerIds: p1Team.players.map((player) => player.playerId),
            p2PlayerIds: p2Team.players.map((player) => player.playerId),
            entries: simEntries,
          });
          const digest = computeCompetitionDigest({
            rootSeed: snapshot.rootSeed as Seed,
            versions: snapshot.settings.versions,
            p1: { refs: p1Refs, players: [...p1Team.players] },
            p2: { refs: p2Refs, players: [...p2Team.players] },
            commands,
            result: summary.result,
          });
          const run = assembleCompetitionRun({
            roomId,
            sourceMode: snapshot.settings.sourceMode,
            competition: snapshot.settings.mode === 'duel' ? 'duel' : 'shared-82',
            rootSeed: snapshot.rootSeed as Seed,
            versions: snapshot.settings.versions,
            commands,
            p1: { refs: p1Refs, players: [...p1Team.players] },
            p2: { refs: p2Refs, players: [...p2Team.players] },
            result: summary.result,
            resultDigest: digest,
            weakestReplacedOpponentId: summary.weakestReplacedOpponentId,
          });
          await fixedFiveRepository.savePendingResult(roomId, run, selfId);
          let reducedMotion = false;
          try {
            reducedMotion =
              typeof window !== 'undefined' &&
              typeof window.matchMedia === 'function' &&
              window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          } catch {
            reducedMotion = false;
          }
          const minShow = reducedMotion ? SIM_SHOWDOWN_REDUCED_MS : SIM_SHOWDOWN_MIN_MS;
          const waitMs = Math.max(0, simStartAt + minShow - Date.now());
          if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
          if (!mounted) return;
          localResult = {
            result: summary.result,
            digest,
            p1: { refs: p1Refs, players: [...p1Team.players] },
            p2: { refs: p2Refs, players: [...p2Team.players] },
            weakestReplacedOpponentId: summary.weakestReplacedOpponentId,
          };
          simulationGate.finish();
          simDone = true;
        } catch (e) {
          simulationGate.fail();
          if (mounted) simError = e instanceof Error ? e.message : String(e);
        }
      }
    } catch (e) {
      simulationGate.fail();
      simError = e instanceof Error ? e.message : String(e);
      simStarted = false;
    }
  }
  async function proposeDigest(digest: ContentHash): Promise<void> {
    busyAction = 'propose';
    try {
      const ok = await sendCommand({ kind: 'propose-result', resultDigest: digest });
      if (ok) {
        submittedPropose = digest;
        saveVerifyGuards();
      }
    } finally {
      busyAction = null;
    }
  }
  async function confirmDigest(digest: ContentHash, verified: boolean): Promise<void> {
    busyAction = 'confirm';
    try {
      const ok = await sendCommand({ kind: 'confirm-result', resultDigest: digest, verified });
      if (ok && verified) {
        confirmedFor = digest;
        saveVerifyGuards();
      }
    } finally {
      busyAction = null;
    }
  }
  async function attemptComplete(receiptId: string): Promise<boolean> {
    busyAction = 'complete';
    try {
      const out = await transport().complete(roomId, receiptId);
      if (!out.completed && mounted) {
        notice = 'Completion not ready yet — waiting for the matching confirmation.';
      }
      await sync(lastOrdinal);
      return out.completed;
    } catch (e) {
      if (mounted) error = friendlyFixedFiveJoinError(e);
      return false;
    } finally {
      busyAction = null;
    }
  }
  async function runCompleteOnce(receiptId: string, pairKey: string | null): Promise<void> {
    if (completeInFlight || !mounted) return;
    completeInFlight = true;
    if (pairKey) completedPairKey = pairKey;
    completeNotReady = false;
    try {
      const done = await attemptComplete(receiptId);
      if (mounted) completeNotReady = !done;
    } finally {
      completeInFlight = false;
    }
  }
  async function attemptFail(): Promise<boolean> {
    busyAction = 'fail';
    try {
      const out = await transport().fail(roomId);
      await sync(lastOrdinal);
      return out.failed;
    } catch (e) {
      if (mounted) error = friendlyFixedFiveJoinError(e);
      return false;
    } finally {
      busyAction = null;
    }
  }
  async function startDraft(): Promise<void> {
    if (selfId !== 'p1' || busyAction !== null) return;
    busyAction = 'start';
    try {
      await sendCommand({ kind: 'start' });
    } finally {
      if (mounted) busyAction = null;
    }
  }
  onMount(() => {
    mounted = true;
    restoreVerifyGuards();
    const membership = loadFixedFiveMembership(roomId);
    if (membership) selfId = membership.participantId;
    let unsubscribe: (() => void) | null = null;
    let resyncTimer: ReturnType<typeof setInterval> | null = null;
    let clockTimer: ReturnType<typeof setInterval> | null = null;
    async function boot(): Promise<void> {
      loading = true;
      try {
        const t = transport();
        const resumed = await t.resume(roomId);
        if (!mounted) return;
        const snap = resumed.snapshot;
        snapshot = snap;
        selfId = resumed.membership.participantId;
        saveFixedFiveMembership({
          ...resumed.membership,
          code: snap.code ?? resumed.membership.code,
        });
        const [storedCommands, loadedAssets] = await Promise.all([
          fixedFiveRepository.listCommands(roomId).catch(() => []),
          loadFixedFiveAssets().catch((e: unknown) => {
            assetsError = e instanceof Error ? e.message : String(e);
            return null;
          }),
        ]);
        if (!mounted) return;
        assets = loadedAssets;
        const restored = restoreFixedFiveCommandSyncState(storedCommands);
        commands = restored.commands;
        lastOrdinal = restored.lastOrdinal;
        if (!snap.rootSeed && mounted) {
          error = 'Room is missing its server seed — it cannot be simulated.';
        }
        await fixedFiveRepository.saveActiveSnapshot(snap, lastOrdinal + 1).catch(() => {});
        unsubscribe = t.subscribe(roomId, (next) => {
          if (!mounted) return;
          snapshot = next;
          reconnecting = false;
          void sync(lastOrdinal);
        }).unsubscribe;
        await sync(lastOrdinal);
        if (receiptsUnsupported) {
          try {
            await t.verificationChallenge(roomId);
            if (!mounted) return;
            receiptsUnsupported = false;
            completedPairKey = null;
            completeNotReady = false;
            saveVerifyGuards();
            notice = 'Server verification is available — continuing with receipt flow.';
            await sync(lastOrdinal);
          } catch (e) {
            if (!isMissingFunctionError(e) && mounted) error = friendlyFixedFiveJoinError(e);
          }
        }
      } catch (e) {
        if (mounted) error = friendlyFixedFiveJoinError(e);
      } finally {
        if (mounted) loading = false;
      }
    }
    void boot();
    const wake = () => {
      reconnecting = true;
      void sync(lastOrdinal).finally(() => {
        if (mounted) reconnecting = false;
      });
    };
    const onFocus = () => wake();
    const onOnline = () => wake();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    resyncTimer = setInterval(() => {
      void transport()
        .resolveTimeout(roomId)
        .then(() => sync(lastOrdinal))
        .catch(() => {});
    }, 15000);
    clockTimer = setInterval(() => {
      tick += 1;
      void resolveOverdue();
    }, 1000);
    return () => {
      mounted = false;
      unsubscribe?.();
      runner?.dispose();
      runner = null;
      statsRunner?.dispose();
      statsRunner = null;
      verificationRunner?.dispose();
      verificationRunner = null;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      if (resyncTimer) clearInterval(resyncTimer);
      if (clockTimer) clearInterval(clockTimer);
    };
  });
  $effect(() => {
    if (!mounted || !snapshot || !replay) return;
    if (phase === 'simulating' && !simStarted && !simError && snapshot.rootSeed) {
      void startSim(simulationReason);
    }
  });
  $effect(() => {
    if (!mounted || phase !== 'completed' || winPlayed) return;
    if (!localResult) return;
    winPlayed = true;
    arenaWin();
  });
  $effect(() => {
    if (!mounted || !snapshot || !replay || !localResult) return;
    if (phase !== 'awaiting-confirmation' && phase !== 'completed') return;
    if (statsSource.length > 0 || statsBuilding || statsRebuildStarted) return;
    statsRebuildStarted = true;
    void rebuildStatsEntries();
  });
  async function rerunSimulation(): Promise<void> {
    try {
      simulationReason = 'mismatch-rerun';
      if (!simulationGate.canStart(simulationReason)) return;
      runner?.dispose();
      runner = null;
      statsRunner?.dispose();
      statsRunner = null;
      await fixedFiveRepository.clearPendingResult(roomId).catch(() => {});
      verificationReceipt = null;
      verificationError = null;
      submittedReceipt = null;
      receiptRebuilds = 0;
      simStarted = false;
      simDone = false;
      localResult = null;
      simEntries = [];
      statsEntries = [];
      statsBuilding = false;
      statsRebuildStarted = false;
      progress = null;
      simError = null;
      await sync(lastOrdinal);
      if (mounted) void startSim(simulationReason);
    } catch (e) {
      if (mounted) simError = e instanceof Error ? e.message : String(e);
    }
  }
  async function rebuildStatsEntries(): Promise<void> {
    if (statsBuilding || !snapshot || !assets || !snapshot.rootSeed || !replay || !localResult) {
      return;
    }
    statsBuilding = true;
    try {
      const rootSeed: Seed = snapshot.rootSeed;
      const p1Team: FixedFiveWorkerTeam = await buildSimulationTeam(
        assets.manifest,
        'p1',
        'Player 1',
        localResult.p1.refs,
      );
      const p2Team: FixedFiveWorkerTeam = await buildSimulationTeam(
        assets.manifest,
        'p2',
        'Player 2',
        localResult.p2.refs,
      );
      if (!mounted) {
        statsBuilding = false;
        return;
      }
      statsRunner?.dispose();
      const collected: FixedFiveWorkerResultEntry[] = [];
      const active = new FixedFiveRunner((event) => {
        if (!mounted) return;
        if (event.kind === 'results') {
          for (const entry of event.entries) collected.push(entry);
        } else if (event.kind === 'complete') {
          statsEntries = collected;
          statsBuilding = false;
          statsRunner?.dispose();
          statsRunner = null;
        } else if (event.kind === 'error') {
          statsBuilding = false;
          statsRunner?.dispose();
          statsRunner = null;
        }
      });
      statsRunner = active;
      const versions = snapshot.settings.versions;
      if (snapshot.settings.mode === 'duel') {
        active.runDuel({
          rootSeed,
          p1Team,
          p2Team,
          profile: assets.profile,
          dataVersion: versions.dataVersion,
          engineVersion: versions.engineVersion,
        });
      } else {
        active.runShared82({
          rootSeed,
          p1Team,
          p2Team,
          bracket: assets.bracket,
          profile: assets.profile,
          dataVersion: versions.dataVersion,
          engineVersion: versions.engineVersion,
        });
      }
    } catch {
      if (mounted) statsBuilding = false;
    }
  }
  function requestStatsRebuild(): void {
    statsRebuildStarted = true;
    void rebuildStatsEntries();
  }
  $effect(() => {
    if (!mounted || !localResult || !snapshot) return;
    if (phase !== 'awaiting-confirmation') return;
    const myDigest = localResult.digest;
    const proposals = facts.proposals;
    const foreign = proposals.filter((p) => p.actor !== selfId);
    const iProposed = proposals.some((p) => p.actor === selfId && p.digest === myDigest);
    const matchingProposal = proposals.some((p) => p.digest === myDigest);
    const iConfirmed = facts.confirms.some(
      (c) => c.actor === selfId && c.digest === myDigest && c.verified,
    );
    if (iProposed && submittedPropose !== myDigest) {
      submittedPropose = myDigest;
      saveVerifyGuards();
    }
    if (iConfirmed && confirmedFor !== myDigest) {
      confirmedFor = myDigest;
      saveVerifyGuards();
    }
    if (iConfirmed) return;
    if (foreign.length === 0) {
      if (!matchingProposal && submittedPropose !== myDigest) {
        void proposeDigest(myDigest);
      } else if (matchingProposal && confirmedFor !== myDigest) {
        void confirmDigest(myDigest, true);
      }
      return;
    }
    const match = foreign.some((p) => p.digest === myDigest);
    if (match) {
      if (confirmedFor !== myDigest) void confirmDigest(myDigest, true);
      return;
    }
    if (!reranMismatch) {
      reranMismatch = true;
      saveVerifyGuards();
      void rerunSimulation();
    }
  });
  $effect(() => {
    if (!mounted || !localResult || !snapshot || !reranMismatch || mismatchReported) return;
    if (phase !== 'awaiting-confirmation') return;
    const myDigest = localResult.digest;
    const foreign = facts.proposals.filter((p) => p.actor !== selfId);
    if (foreign.some((p) => p.digest === myDigest)) return;
    if (foreign.length === 0) return;
    mismatchReported = true;
    saveVerifyGuards();
    const first = foreign[0];
    const iDenied = first
      ? facts.confirms.some((c) => c.actor === selfId && c.digest === first.digest && !c.verified)
      : true;
    void (async () => {
      if (submittedPropose !== myDigest) await proposeDigest(myDigest);
      if (first && !iDenied) await confirmDigest(first.digest, false);
    })();
  });
  $effect(() => {
    if (!mounted || !snapshot || !localResult || !assets) return;
    if (phase !== 'awaiting-confirmation') return;
    if (receiptsUnsupported) return;
    if (!snapshot.rootSeed) return;
    if (verificationReceipt || verificationError || verificationInFlight) return;
    const myDigest = localResult.digest;
    const ownConfirmed = facts.confirms.some(
      (c) => c.actor === selfId && c.digest === myDigest && c.verified,
    );
    const foreignConfirmed = facts.confirms.some(
      (c) => c.actor !== selfId && c.digest === myDigest && c.verified,
    );
    if (!ownConfirmed || !foreignConfirmed) return;
    void prepareReceipt();
  });
  $effect(() => {
    void receiptRetry;
    if (!mounted || !verificationReceipt) return;
    if (submittedReceipt === verificationReceipt.receiptDigest) return;
    void storeReceipt(verificationReceipt);
  });
  $effect(() => {
    if (!mounted || !snapshot || !localResult) return;
    if (phase !== 'awaiting-confirmation') return;
    if (!receiptsUnsupported) {
      const receipt = verificationReceipt;
      if (!receipt || receipt.resultDigest !== localResult.digest) return;
      if (submittedReceipt !== receipt.receiptDigest) return;
      if (confirmedFor !== receipt.resultDigest) return;
      const foreignVerified = facts.confirms.filter(
        (c) => c.actor !== selfId && c.digest === receipt.resultDigest && c.verified,
      );
      if (foreignVerified.length === 0) return;
      const pairKey = `receipt:${receipt.resultDigest}:${String(foreignVerified.length)}`;
      if (completedPairKey === pairKey) return;
      void runCompleteOnce(receipt.receiptDigest, pairKey);
      return;
    }
    if (!confirmedFor) return;
    const foreignVerified = facts.confirms.filter(
      (c) => c.actor !== selfId && c.digest === confirmedFor && c.verified,
    );
    if (foreignVerified.length === 0) return;
    const pairKey = `${confirmedFor}:${String(foreignVerified.length)}`;
    if (completedPairKey === pairKey) return;
    void runCompleteOnce(confirmedFor, pairKey);
  });
  $effect(() => {
    if (!mounted || !snapshot || failSent) return;
    if (phase === 'completed' || phase === 'integrity-failed' || phase === 'expired') return;
    const digests = new Set(facts.proposals.map((p) => p.digest));
    const denied = facts.confirms.some((c) => !c.verified);
    if (digests.size >= 2 && denied) {
      failSent = true;
      void attemptFail().then((failed) => {
        if (!mounted) return;
        if (!failed) {
          failSent = false;
          notice = 'Mismatch recorded — will retry marking the room once synced.';
        }
      });
    }
  });
  async function doLeave(): Promise<void> {
    leaveBusy = true;
    try {
      runner?.dispose();
      runner = null;
      await transport().leave(roomId, selfId);
      await goto(resolve('/multiplayer'));
    } catch (e) {
      error = friendlyFixedFiveJoinError(e);
    } finally {
      leaveBusy = false;
    }
  }
  async function doRematch(): Promise<void> {
    rematchBusy = true;
    error = null;
    try {
      const { snapshot: next, code } = await transport().rematch(roomId);
      saveFixedFiveMembership({ roomId: next.roomId, participantId: selfId, code });
      await goto(resolve('/multiplayer/room/[roomId]', { roomId: next.roomId }));
    } catch (e) {
      error = friendlyFixedFiveJoinError(e);
    } finally {
      rematchBusy = false;
    }
  }
  const canRematch = $derived(
    facts.rematchRequested.p1 &&
      facts.rematchRequested.p2 &&
      facts.rematchConfirmed.p1 &&
      facts.rematchConfirmed.p2 &&
      snapshot?.phase === 'completed',
  );
  const modeDetailLabel = $derived.by((): string => {
    const current = snapshot;
    if (!current) return 'Multiplayer';
    const format = current.settings.mode === 'duel' ? 'Duel · Best of 7' : 'Season · 82 games';
    return `${format} · ${current.settings.sourceMode === 'sandbox' ? 'Sandbox' : 'Classic'}`;
  });
  const resultVerified = $derived.by((): boolean => {
    if (!snapshot || !localResult) return false;
    if (snapshot.phase === 'completed') return true;
    if (receiptsUnsupported) return snapshot.confirmedDigest === localResult.digest;
    return (
      verificationReceipt !== null &&
      verificationReceipt.resultDigest === localResult.digest &&
      verificationReceipt.receiptDigest === submittedReceipt
    );
  });
  async function doRematchAction(): Promise<void> {
    if (rematchBusy) return;
    rematchBusy = true;
    error = null;
    try {
      const other = selfId === 'p1' ? 'p2' : 'p1';
      if (!facts.rematchRequested[selfId]) {
        await sendCommand({ kind: 'rematch-request' });
      }
      if (facts.rematchRequested[other] && !facts.rematchConfirmed[selfId]) {
        await sendCommand({ kind: 'rematch-confirm' });
      }
      if (canRematch) {
        await doRematch();
      } else {
        notice = 'Rematch requested — it starts once your opponent hits rematch too.';
      }
    } catch (e) {
      error = friendlyFixedFiveJoinError(e);
    } finally {
      rematchBusy = false;
    }
  }

  const roomName = $derived(snapshot?.settings.mode === 'duel' ? 'Duel' : 'Season');
  const roomImage = $derived(
    snapshot?.settings.mode === 'duel'
      ? '/images/multiplayer/duel.jpg'
      : snapshot?.settings.mode === 'sandbox-shared-82'
        ? '/images/multiplayer/sandbox-season.jpg'
        : '/images/multiplayer/shared-season.jpg',
  );
  const stageIndex = $derived(
    phase === 'lobby' ? 0 : phase === 'drafting' ? 1 : phase === 'completed' ? 3 : 2,
  );
  const phaseLabel = $derived(
    phase === 'lobby'
      ? 'Lobby'
      : phase === 'drafting'
        ? 'Draft'
        : phase === 'simulating'
          ? 'Playing'
          : phase === 'awaiting-confirmation'
            ? 'Checking results'
            : phase === 'completed'
              ? 'Final'
              : phase === 'expired'
                ? 'Room expired'
                : 'Result mismatch',
  );
  async function removeGuest(): Promise<void> {
    if (busyAction !== null || selfId !== 'p1' || phase !== 'lobby') return;
    busyAction = 'remove';
    error = null;
    try {
      const next = await transport().removeGuest(roomId, 'p2');
      if (mounted) snapshot = next;
    } catch (e) {
      if (mounted) error = friendlyFixedFiveJoinError(e);
    } finally {
      if (mounted) busyAction = null;
    }
  }
</script>

<svelte:head>
  <title>Room — Hoop Rush Multiplayer</title>
</svelte:head>

<section class="room-page">
  <div class="room-nav">
    <a href={resolve('/multiplayer')}><ArrowLeft size={15} aria-hidden="true" /> Multiplayer</a
    ><ArenaSoundToggle />
  </div>
  {#if loading}
    <div class="room-empty" role="status">
      <Users size={28} aria-hidden="true" />
      <h1>Opening your room</h1>
      <p>Loading players and match settings…</p>
    </div>
  {:else if error && !snapshot}
    <div class="room-empty">
      <h1>Couldn’t open this room</h1>
      <p role="alert">{error}</p>
      <a href={resolve('/multiplayer')} class="room-primary"
        >Back to multiplayer <ArrowRight size={16} /></a
      >
    </div>
  {:else if snapshot && display}
    <header class="room-header">
      <div>
        <p class="room-eyebrow">Multiplayer · {phaseLabel}</p>
        <h1>{roomName}</h1>
        <p class="room-subtitle">
          {snapshot.settings.sourceMode === 'sandbox'
            ? 'Sandbox · Snake Draft'
            : 'Classic · Roll Draft'} · {snapshot.settings.variant === 'ball-knowledge'
            ? 'Ball Knowledge'
            : 'Ratings'} · {snapshot.settings.mode === 'duel' ? 'Best of 7' : '82 games'} · Room {snapshot.code ??
            'closed'}
        </p>
      </div>
      {#if resultVerified}<span class="verified-pill"
          ><ShieldCheck size={15} aria-hidden="true" /> Result verified</span
        >{/if}
    </header>
    {#if phase !== 'expired' && phase !== 'integrity-failed'}
      <ol class="room-stages" aria-label="Match progress">
        {#each ['Lobby', 'Draft your five', 'Play', 'Results'] as label, i (label)}
          <li
            class:current={i === stageIndex}
            class:finished={i < stageIndex}
            aria-current={i === stageIndex ? 'step' : undefined}
          >
            <span
              >{#if i < stageIndex}<Check size={13} aria-hidden="true" />{:else}{i + 1}{/if}</span
            >{label}
          </li>
        {/each}
      </ol>
    {/if}
    {#if error}<p class="room-alert" role="alert">{error}</p>{/if}
    {#if reconnecting || syncing}<p class="room-connection" role="status">
        {reconnecting ? 'Reconnecting to your room…' : 'Updating your room…'}
      </p>{/if}
    {#if opponent && !opponent.online && phase !== 'lobby' && phase !== 'completed'}<p
        class="room-connection"
        role="status"
      >
        Your opponent is offline. Their place in the room is kept.
      </p>{/if}
    {#if notice || (replay && replay.skipped > 0)}
      <details class="room-activity">
        <summary>Room activity</summary>{#if notice}<p>
            {notice}
          </p>{/if}{#if replay && replay.skipped > 0}<p>
            {replay.skipped} draft update{replay.skipped === 1 ? ' was' : 's were'} skipped because it
            could not be applied.
          </p>{/if}
      </details>
    {/if}
    {#if phase !== 'lobby' && phase !== 'completed' && phase !== 'awaiting-confirmation' && phase !== 'integrity-failed' && phase !== 'expired'}<div
        class="room-players"
      >
        <FixedFiveScoreboard snapshot={display} {selfId} />
      </div>{/if}

    {#if phase === 'lobby'}
      <div class="lobby-layout">
        <div class="invite-panel">
          <div class="lobby-photo">
            <img src={asset(roomImage)} alt="" width="1536" height="1024" /><span
              class="photo-caption">{roomName} · Head to head</span
            >
          </div>
          <div class="invite-body">
            <p class="room-eyebrow">{selfId === 'p1' ? 'Bring your opponent' : 'You’re in'}</p>
            <h2>{selfId === 'p1' ? 'Your court. Your invite.' : 'The matchup is set.'}</h2>
            <p>
              {selfId === 'p1'
                ? 'Share this code or send an invite link. The draft begins when you start it.'
                : 'Stay in this room. The draft opens for both players when the host starts.'}
            </p>
            {#if snapshot.code}
              <div class="invite-code" aria-label={`Room code ${snapshot.code}`}>
                {snapshot.code}
              </div>
              <div class="invite-actions">
                <button type="button" onclick={copyRoomCode} class="room-secondary"
                  >{#if copiedCode}<Check size={16} /> Copied{:else}<Copy size={16} /> Copy code{/if}</button
                ><button type="button" onclick={copyInviteLink} class="room-primary"
                  >{#if copiedInvite}<Check size={16} /> Copied{:else}<Link size={16} /> Copy invite link{/if}</button
                >
              </div>
              <p class="invite-footnote">Room codes expire after 15 minutes.</p>
            {/if}
          </div>
        </div>
        <div class="lobby-settings">
          <div class="lobby-panel-heading">
            <h2>Your matchup</h2>
            <span><Users size={14} aria-hidden="true" /> {display.members.length}/2</span>
          </div>
          <FixedFiveScoreboard snapshot={display} {selfId} />
          <dl class="lobby-rules">
            <div>
              <dt>Draft source</dt>
              <dd>{snapshot.settings.sourceMode === 'sandbox' ? 'Sandbox' : 'Classic'}</dd>
            </div>
            <div>
              <dt>Player ratings</dt>
              <dd>{snapshot.settings.variant === 'ball-knowledge' ? 'Hidden' : 'Visible'}</dd>
            </div>
            <div>
              <dt><Clock size={14} aria-hidden="true" /> Pick timer</dt>
              <dd>{snapshot.settings.mode === 'sandbox-shared-82' ? '5 minutes' : '90 seconds'}</dd>
            </div>
            <div>
              <dt><LockKeyhole size={14} aria-hidden="true" /> Room access</dt>
              <dd>Invite only</dd>
            </div>
          </dl>
          {#if assetsError}<p class="room-alert" role="alert">
              The player pool could not be loaded. Reload the room to try again.
            </p>
            <button type="button" class="room-secondary" onclick={() => window.location.reload()}
              >Reload room</button
            >{/if}
          <div class="lobby-ready" role="status">
            <span class:joined={opponent?.online}></span>
            <p>
              {selfId === 'p1'
                ? opponent?.online
                  ? 'Your opponent is here. Ready when you are.'
                  : 'Waiting for your opponent to join.'
                : 'Waiting for the host to start the draft.'}
            </p>
          </div>
          {#if selfId === 'p1'}<button
              type="button"
              onclick={startDraft}
              disabled={busyAction !== null || !opponent?.online || !assets}
              class="room-primary start-draft"
              >{busyAction === 'start'
                ? 'Starting draft…'
                : !assets && !assetsError
                  ? 'Loading players…'
                  : 'Start draft'}<ArrowRight size={18} aria-hidden="true" /></button
            >{/if}
          <div class="lobby-manage">
            {#if selfId === 'p1' && opponent}<button
                type="button"
                onclick={removeGuest}
                disabled={busyAction !== null}
                >{busyAction === 'remove' ? 'Removing…' : 'Remove opponent'}</button
              >{/if}<button type="button" onclick={doLeave} disabled={leaveBusy}
              ><LogOut size={14} aria-hidden="true" />{leaveBusy
                ? 'Leaving…'
                : 'Leave room'}</button
            >
          </div>
        </div>
      </div>
    {:else if phase === 'drafting' && (!replay || !assets)}
      <div class="room-empty">
        <h2>Preparing your draft</h2>
        <p role="status">{assetsError ?? 'Loading your player pool and lineup…'}</p>
        {#if assetsError}<button
            type="button"
            class="room-secondary"
            onclick={() => window.location.reload()}>Reload room</button
          >{/if}
      </div>
    {:else if phase === 'drafting' && replay && assets}
      <div class="draft-room">
        {#if assetsError}
          <p class="mt-2 text-xs text-destructive" role="alert">{assetsError}</p>
        {:else}
          <FixedFiveDraftPanel
            mode={snapshot.settings.mode}
            {selfId}
            {replay}
            {assets}
            {presentation}
            rollAxis={rollAnimation.axis}
            rollNonce={rollAnimation.nonce}
            disabled={syncing}
            deadlineText={clockText}
            {lastAutopick}
            error={draftError}
            onPick={(player, slot) => {
              draftError = null;
              void sendPick(player, slot).catch((e: unknown) => {
                draftError = e instanceof Error ? e.message : String(e);
              });
            }}
            onReroll={(axis) => {
              draftError = null;
              void sendCommand({ kind: 'reroll', axis }).then((ok) => {
                if (!ok) draftError = 'Reroll was rejected — it may already be spent.';
              });
            }}
            onRemove={(slot) => {
              void sendCommand({ kind: 'sandbox-remove', slotIndex: slot });
            }}
            onLock={() => {
              void sendCommand({ kind: 'sandbox-lock' }, { retry: false });
            }}
          />
        {/if}
      </div>
    {:else if phase === 'simulating'}
      <div class="mt-6">
        {#if simError}
          <div class="rounded-2xl bg-surface-1 p-6">
            <h2 class="font-display text-sm font-extrabold uppercase">Simulating locally</h2>
            <p class="mt-2 text-sm text-destructive" role="alert">{simError}</p>
            <button
              type="button"
              onclick={() => {
                simStarted = false;
                simError = null;
              }}
              class="mt-3 rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
            >
              Retry simulation
            </button>
          </div>
        {:else if snapshot}
          <FixedFiveSimShow
            mode={snapshot.settings.mode}
            {progress}
            entries={simEntries}
            {selfId}
          />
        {/if}
      </div>
    {:else if phase === 'awaiting-confirmation'}
      {@const rivalProposal = facts.proposals.find((p) => p.actor !== selfId) ?? null}
      {@const digestsMatch =
        localResult != null && rivalProposal != null
          ? rivalProposal.digest === localResult.digest
          : null}
      {@const youDigest = localResult?.digest ?? null}
      {@const foreignConfirmed =
        youDigest != null &&
        facts.confirms.some((c) => c.actor !== selfId && c.digest === youDigest && c.verified)}
      {@const receiptShort =
        verificationReceipt != null
          ? `${verificationReceipt.receiptDigest.slice(0, 6)}…${verificationReceipt.receiptDigest.slice(-4)}`
          : null}
      <div class="mt-6 flex flex-col gap-4">
        <div class="verify-banner" role="status">
          <span class="verify-orb" aria-hidden="true"></span>
          <div class="min-w-0 flex-1">
            <h2 class="font-display text-sm font-extrabold uppercase">Checking the final result</h2>
            <p class="mt-1 text-xs text-muted-foreground">
              {#if !localResult}
                Rebuilding your match result…
              {:else if receiptsUnsupported && rivalProposal == null}
                Your result is ready. Waiting for your opponent…
              {:else if receiptsUnsupported && !digestsMatch}
                The results differ. Replaying the match to check them…
              {:else if receiptsUnsupported}
                Both players have the same result. Finishing your match…
              {:else if verificationError}
                The result could not be verified: {verificationError}
              {:else if rivalProposal == null}
                Your result is ready. Sharing it with your opponent…
              {:else if !digestsMatch}
                The results differ. Replaying the match to check them…
              {:else if !foreignConfirmed}
                Waiting for your opponent to confirm the result…
              {:else if !verificationReceipt}
                Both players agree. Checking the replay…
              {:else if submittedReceipt !== verificationReceipt.receiptDigest}
                Replay checked. Saving verification…
              {:else}
                Result verified. Finishing your match…
              {/if}
            </p>
            {#if verificationError}
              <button
                type="button"
                onclick={() => (verificationError = null)}
                disabled={verificationInFlight}
                class="mt-2 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-40"
              >
                {verificationInFlight ? 'Verifying…' : 'Retry verification'}
              </button>
            {/if}
            {#if completeNotReady && localResult}
              <button
                type="button"
                onclick={() => {
                  void (async () => {
                    try {
                      await transport().verificationChallenge(roomId);
                      if (!mounted) return;
                      receiptsUnsupported = false;
                      completedPairKey = null;
                      completeNotReady = false;
                      saveVerifyGuards();
                      notice = 'Server verification is available — continuing with receipt flow.';
                    } catch (e) {
                      if (!isMissingFunctionError(e) && mounted)
                        error = friendlyFixedFiveJoinError(e);
                      completedPairKey = null;
                      completeNotReady = false;
                    }
                    await sync(lastOrdinal);
                  })();
                }}
                disabled={busyAction !== null}
                class="mt-2 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-40"
              >
                {busyAction === 'complete' ? 'Finishing…' : 'Retry finishing match'}
              </button>
            {/if}
          </div>
        </div>
        {#if localResult && snapshot && assets}
          <FixedFiveResults
            mode={snapshot.settings.mode}
            result={localResult.result}
            {selfId}
            manifest={assets.manifest}
            p1Rows={p1ResultRows}
            p2Rows={p2ResultRows}
            {presentation}
            digest={localResult.digest}
            stats={playerStats}
            {statsState}
            onRebuildStats={requestStatsRebuild}
            entries={statsSource}
            roomCode={snapshot.code}
            createdAt={snapshot.createdAt}
            verified={resultVerified}
            modeDetail={modeDetailLabel}
            receiptDigest={verificationReceipt?.receiptDigest ?? null}
          />
        {/if}
        <details class="room-activity">
          <summary>Verification details</summary>
          <p>
            Receipt {receiptShort ?? 'pending'} · proposals {facts.proposals.length} · confirmations
            {facts.confirms.length}{reranMismatch ? ' · mismatch rerun done' : ''}. Both clients
            replay every game from the accepted command log and store a verification receipt; the
            room locks only after the matching confirmations.
          </p>
        </details>
      </div>
    {:else if phase === 'completed' && localResult}
      <div class="mt-6 flex flex-col gap-4">
        {#if snapshot && assets}
          <FixedFiveResults
            mode={snapshot.settings.mode}
            result={localResult.result}
            {selfId}
            manifest={assets.manifest}
            p1Rows={p1ResultRows}
            p2Rows={p2ResultRows}
            {presentation}
            digest={localResult.digest}
            stats={playerStats}
            {statsState}
            onRebuildStats={requestStatsRebuild}
            entries={statsSource}
            roomCode={snapshot.code}
            createdAt={snapshot.createdAt}
            verified={resultVerified}
            modeDetail={modeDetailLabel}
            receiptDigest={verificationReceipt?.receiptDigest ?? null}
            onRematch={doRematchAction}
            rematchWaiting={facts.rematchRequested[selfId] &&
              !facts.rematchRequested[selfId === 'p1' ? 'p2' : 'p1']}
            rematchLabel={canRematch
              ? 'Start rematch'
              : facts.rematchRequested[selfId === 'p1' ? 'p2' : 'p1']
                ? 'Accept rematch'
                : facts.rematchRequested[selfId]
                  ? 'Waiting for opponent'
                  : 'Rematch'}
            {rematchBusy}
          />
        {/if}
        {#if !canRematch}
          <p class="text-xs text-muted-foreground">
            Both players need to agree to a rematch. This result stays saved.
          </p>
        {/if}
      </div>
    {:else if phase === 'completed'}
      <div class="mt-6 rounded-2xl bg-surface-1 p-6">
        <h2 class="font-display text-sm font-extrabold uppercase">Completed</h2>
        <p class="mt-1 text-xs text-muted-foreground">
          The room completed before this client finished simulating. Reload to rebuild the result
          from the accepted log.
        </p>
      </div>
    {:else if phase === 'integrity-failed'}
      <div class="mt-6 rounded-2xl border border-destructive/40 bg-destructive/10 p-6" role="alert">
        <h2 class="font-display text-sm font-extrabold uppercase">
          The results could not be verified
        </h2>
        <p class="mt-1 text-xs">
          The match was replayed, but the two results still differ. Neither result has been
          accepted.
        </p>
      </div>
    {:else if phase === 'expired'}
      <div class="mt-6 rounded-2xl bg-surface-1 p-6">
        <h2 class="font-display text-2xl font-extrabold uppercase">Room expired</h2>
        <p class="mt-1 text-xs text-muted-foreground">
          Your local saves are kept. Create a new room to play again.
        </p>
        <a class="room-primary mt-4" href={resolve('/multiplayer')}
          >Choose a match <ArrowRight size={16} /></a
        >
      </div>
    {/if}

    {#if phase !== 'lobby'}<div class="room-footer">
        <button
          type="button"
          onclick={doLeave}
          disabled={leaveBusy}
          class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >{leaveBusy ? 'Leaving…' : 'Leave room'}</button
        >
      </div>{/if}
  {/if}
</section>

<style>
  .room-page {
    width: 100%;
    max-width: 1400px;
    margin: auto;
    padding: 24px 32px 80px;
  }
  .room-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 30px;
  }
  .room-nav a {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-muted-foreground);
    font-size: 12px;
  }
  .room-nav a:hover {
    color: var(--color-foreground);
  }
  .room-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .room-eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-primary);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .room-header h1,
  .room-empty h1 {
    margin-top: 6px;
    font-family: var(--font-display);
    font-size: clamp(38px, 4vw, 58px);
    font-weight: 800;
    line-height: 1;
    text-transform: uppercase;
  }
  .room-subtitle {
    color: var(--color-muted-foreground);
    font-size: 12px;
    margin-top: 12px;
  }
  .verified-pill {
    display: flex;
    gap: 7px;
    align-items: center;
    color: var(--color-positive);
    font-size: 11px;
  }
  .room-stages {
    display: flex;
    margin: 28px 0;
    padding: 17px 0;
    border-top: 1px solid var(--color-line-soft);
    border-bottom: 1px solid var(--color-line-soft);
    gap: 32px;
  }
  .room-stages li {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-muted-foreground);
    font-size: 12px;
  }
  .room-stages li > span {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--color-line-strong);
    border-radius: 50%;
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .room-stages .current {
    color: var(--color-foreground);
    font-weight: 600;
  }
  .room-stages .current > span {
    color: var(--color-primary-foreground);
    background: var(--color-primary);
    border-color: var(--color-primary);
  }
  .room-stages .finished > span {
    color: var(--color-positive);
    border-color: var(--color-positive);
  }
  .room-alert {
    margin: 16px 0;
    padding: 14px;
    border: 1px solid var(--color-destructive);
    background: color-mix(in srgb, var(--color-destructive) 8%, var(--color-card));
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.7;
  }
  .room-connection {
    color: var(--color-muted-foreground);
    font-size: 12px;
    margin: 14px 0;
  }
  .room-activity {
    color: var(--color-muted-foreground);
    font-size: 11px;
    line-height: 1.7;
    margin: 16px 0;
  }
  .room-activity summary {
    cursor: pointer;
    width: fit-content;
  }
  .room-activity p {
    margin-top: 8px;
  }
  .room-players {
    margin-bottom: 24px;
  }
  .lobby-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(340px, 0.8fr);
    gap: 24px;
    align-items: start;
  }
  .invite-panel,
  .lobby-settings {
    overflow: hidden;
    border: 1px solid var(--color-line-soft);
    border-radius: 12px;
    background: var(--color-card);
  }
  .lobby-photo {
    position: relative;
    height: 205px;
    color: #f5f3ef;
  }
  .lobby-photo::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, transparent 30%, rgb(8 12 17 / 85%));
  }
  .lobby-photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 30%;
  }
  .photo-caption {
    position: absolute;
    z-index: 1;
    bottom: 20px;
    left: 28px;
    font-family: var(--font-display);
    font-size: 15px;
    text-transform: uppercase;
    font-weight: 700;
    letter-spacing: 0.05em;
  }
  .invite-body {
    padding: 28px;
  }
  .invite-body h2 {
    font-family: var(--font-display);
    font-size: 34px;
    line-height: 1.1;
    font-weight: 800;
    margin: 7px 0 10px;
  }
  .invite-body > p:not(.room-eyebrow) {
    color: var(--color-muted-foreground);
    font-size: 12px;
    line-height: 1.7;
    max-width: 420px;
  }
  .invite-code {
    font-family: var(--font-mono);
    font-size: clamp(40px, 5vw, 62px);
    font-weight: 700;
    letter-spacing: 0.18em;
    line-height: 1;
    padding: 28px 0;
    user-select: all;
  }
  .invite-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .room-primary,
  .room-secondary {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
  }
  .room-primary {
    background: var(--color-primary);
    color: var(--color-primary-foreground);
  }
  .room-secondary {
    border: 1px solid var(--color-line-strong);
    background: var(--color-surface-2);
  }
  .invite-body .invite-footnote {
    margin-top: 16px;
    font-size: 10px;
  }
  .lobby-settings {
    border-top: 2px solid var(--color-primary);
    padding: 24px;
  }
  .lobby-panel-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }
  .lobby-panel-heading h2 {
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 700;
  }
  .lobby-panel-heading > span {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 11px;
    color: var(--color-muted-foreground);
  }
  .lobby-settings :global(.player-seats) {
    grid-template-columns: 1fr;
  }
  .lobby-rules {
    margin: 24px 0;
    padding: 20px 0;
    border-block: 1px solid var(--color-line-soft);
  }
  .lobby-rules > div {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 12px;
    margin-bottom: 13px;
  }
  .lobby-rules > div:last-child {
    margin: 0;
  }
  .lobby-rules dt {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-muted-foreground);
  }
  .lobby-rules dd {
    font-weight: 600;
  }
  .lobby-ready {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--color-muted-foreground);
    font-size: 12px;
    line-height: 1.6;
    margin-bottom: 16px;
  }
  .lobby-ready > span {
    height: 6px;
    width: 6px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--color-muted-foreground);
  }
  .lobby-ready > span.joined {
    background: var(--color-positive);
  }
  .start-draft {
    width: 100%;
    padding: 14px;
  }
  .lobby-manage {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    margin-top: 22px;
  }
  .lobby-manage button {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-muted-foreground);
    font-size: 11px;
  }
  .lobby-manage button:hover {
    color: var(--color-foreground);
  }
  .draft-room {
    min-width: 0;
  }
  .room-footer {
    border-top: 1px solid var(--color-line-soft);
    margin-top: 30px;
    padding-top: 20px;
  }
  .room-empty {
    display: flex;
    align-items: flex-start;
    flex-direction: column;
    gap: 18px;
    padding: 60px 0;
  }
  .room-empty h2 {
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: 800;
  }
  .room-empty p {
    font-size: 13px;
    color: var(--color-muted-foreground);
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button:focus-visible,
  a:focus-visible,
  summary:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 4px;
  }
  @media (max-width: 850px) {
    .lobby-layout {
      grid-template-columns: 1fr;
    }
    .room-page {
      padding: 24px 20px 88px;
    }
    .lobby-photo {
      height: 180px;
    }
  }
  @media (max-width: 520px) {
    .room-stages {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }
    .room-stages li {
      flex-direction: column;
      text-align: center;
      gap: 6px;
      font-size: 10px;
    }
    .room-stages li > span {
      width: 18px;
      height: 18px;
    }
    .room-header {
      align-items: flex-start;
      flex-direction: column;
    }
    .invite-body,
    .lobby-settings {
      padding: 20px;
    }
    .invite-actions > button {
      flex: 1;
      padding-inline: 10px;
    }
  }

  .verify-banner {
    display: flex;
    align-items: center;
    gap: 14px;
    border: 1px solid var(--color-line-soft);
    border-radius: 10px;
    padding: 20px;
    background: var(--color-card);
  }
  .verify-orb {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    border: 2px solid var(--color-line-strong);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: verify-spin 1s linear infinite;
  }
  @keyframes verify-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .verify-orb {
      animation: none;
    }
  }
</style>
