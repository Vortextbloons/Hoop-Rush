<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Check, Copy } from '@lucide/svelte';
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
    PlayerId,
    Seed,
    SlotIndex,
  } from '@hoop-rush/data-contracts';
  import { commandIdSchema, fixedFiveTimeoutMsForMode, idSchema } from '@hoop-rush/data-contracts';
  import { getFixedFiveTransport } from '$lib/fixed-five-transport';
  import { submitFixedFiveCommand } from '$lib/fixed-five-command-submit';
  import {
    friendlyFixedFiveJoinError,
    inviteLinkForFixedFiveCode,
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
  import type { FixedFiveWorkerTeam, PlayersIndexEntry } from '@hoop-rush/data-contracts';
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
  const SIM_SHOWDOWN_MIN_MS = 3000;
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
  function verifyGuardStorageKey(id: string): string {
    return `hoop-rush:fixed-five:verify:${id}`;
  }
  function saveVerifyGuards(): void {
    try {
      localStorage.setItem(
        verifyGuardStorageKey(roomId),
        JSON.stringify({ submittedPropose, confirmedFor, reranMismatch, mismatchReported }),
      );
    } catch {}
  }
  function restoreVerifyGuards(): void {
    try {
      const raw = localStorage.getItem(verifyGuardStorageKey(roomId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        submittedPropose?: unknown;
        confirmedFor?: unknown;
        reranMismatch?: unknown;
        mismatchReported?: unknown;
      };
      if (typeof parsed.submittedPropose === 'string')
        submittedPropose = parsed.submittedPropose as ContentHash;
      if (typeof parsed.confirmedFor === 'string')
        confirmedFor = parsed.confirmedFor as ContentHash;
      if (parsed.reranMismatch === true) reranMismatch = true;
      if (parsed.mismatchReported === true) mismatchReported = true;
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
    snapshot && replay ? deriveEffectivePhase(snapshot.phase, replay, simDone) : 'lobby',
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
  const p1ResultRows = $derived.by((): (PlayersIndexEntry | null)[] => {
    const rows: (PlayersIndexEntry | null)[] = [null, null, null, null, null];
    if (!localResult) return rows;
    for (const ref of localResult.p1.refs) {
      if (ref.slotIndex >= 0 && ref.slotIndex < 5)
        rows[ref.slotIndex] = indexById.get(ref.playerId as string) ?? null;
    }
    return rows;
  });
  const p2ResultRows = $derived.by((): (PlayersIndexEntry | null)[] => {
    const rows: (PlayersIndexEntry | null)[] = [null, null, null, null, null];
    if (!localResult) return rows;
    for (const ref of localResult.p2.refs) {
      if (ref.slotIndex >= 0 && ref.slotIndex < 5)
        rows[ref.slotIndex] = indexById.get(ref.playerId as string) ?? null;
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
    const remaining = anchorMs + timeoutMs - Date.now();
    if (remaining <= 0) return 'Pick clock expired — resolving the deterministic fallback…';
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
      const row = assets.index.players.find((p) => p.playerId === payload.playerId);
      return { displayName: row?.displayName ?? payload.playerId, seedPath: payload.seedPath };
    },
  );
  function transport() {
    return getFixedFiveTransport();
  }
  async function copyInviteLink() {
    if (!snapshot?.code) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${inviteLinkForFixedFiveCode(snapshot.code)}`,
      );
      copiedInvite = true;
      setTimeout(() => (copiedInvite = false), 1500);
    } catch {}
  }
  async function copyRoomCode() {
    if (!snapshot?.code) return;
    try {
      await navigator.clipboard.writeText(snapshot.code);
      copiedCode = true;
      setTimeout(() => (copiedCode = false), 1500);
    } catch {}
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
          notice = `Synced ${String(addedCount)} command${addedCount === 1 ? '' : 's'} after the last accepted ordinal.`;
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
  async function sendPick(
    playerId: PlayerId,
    slot: SlotIndex,
    moveTarget?: SlotIndex | null,
  ): Promise<void> {
    draftError = null;
    if (!snapshot || !replay) return;
    const mode = snapshot.settings.mode;
    if (mode === 'sandbox-shared-82') {
      if (moveTarget == null || replay.mode !== 'sandbox-shared-82') {
        await sendCommand({ kind: 'sandbox-place', playerId, slotIndex: slot });
        return;
      }
      const builder = selfId === 'p1' ? replay.p1 : replay.p2;
      const incumbent = builder.placements.find((p) => p.slotIndex === slot) ?? null;
      const subjectOld = builder.placements.find((p) => p.playerId === playerId)?.slotIndex ?? null;
      if (!incumbent || incumbent.playerId === playerId) {
        await sendCommand({ kind: 'sandbox-place', playerId, slotIndex: slot });
        return;
      }
      if (subjectOld !== null) {
        const freed = await sendCommand({ kind: 'sandbox-remove', slotIndex: subjectOld });
        if (!freed) {
          draftError = 'Move was rejected — resync and try again.';
          return;
        }
      }
      const placed = await sendCommand({ kind: 'sandbox-place', playerId, slotIndex: slot });
      if (!placed) {
        draftError = 'Displacement pick was rejected — it may already be spent.';
        return;
      }
      const restored = await sendCommand({
        kind: 'sandbox-place',
        playerId: incumbent.playerId,
        slotIndex: moveTarget,
      });
      if (!restored) {
        draftError = 'Placed your pick but could not move the displaced player back.';
      }
      return;
    }
    if (mode === 'duel') {
      if (replay.mode === 'sandbox-duel') {
        if (!isFixedFiveDraftTurn(replay, selfId)) {
          draftError = 'Wait for your opponent to finish this pick.';
          return;
        }
        await sendCommand({ kind: 'sandbox-place', playerId, slotIndex: slot });
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
      if (mounted) verificationError = e instanceof Error ? e.message : String(e);
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
    if (now - anchorMs <= timeoutMs) return;
    const deadline = snapshot.deadline;
    if (!deadline) return;
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
    const receipt = verificationReceipt;
    if (!receipt || receipt.resultDigest !== localResult.digest) return;
    if (submittedReceipt !== receipt.receiptDigest) return;
    if (confirmedFor !== receipt.resultDigest) return;
    const foreignVerified = facts.confirms.filter(
      (c) => c.actor !== selfId && c.digest === receipt.resultDigest && c.verified,
    );
    if (foreignVerified.length === 0) return;
    const pairKey = `${receipt.resultDigest}:${String(foreignVerified.length)}`;
    if (completedPairKey === pairKey) return;
    void runCompleteOnce(receipt.receiptDigest, pairKey);
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
    if (!current) return 'Fixed-Five';
    if (current.settings.mode === 'duel') return 'Fixed-Five · Duel · Best of 7';
    if (current.settings.mode === 'sandbox-shared-82') return 'Fixed-Five · Sandbox · Shared 82';
    return 'Fixed-Five · Classic · Shared 82';
  });
  const resultVerified = $derived.by((): boolean => {
    if (!snapshot || !localResult) return false;
    if (snapshot.phase === 'completed') return true;
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
</script>

<svelte:head>
  <title>Room — Hoop Rush Multiplayer</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6 md:pb-10">
  <a
    href={resolve('/multiplayer')}
    class="text-label mt-6 inline-flex items-center gap-1.5 self-start text-muted-foreground hover:text-foreground"
  >
    <span aria-hidden="true">←</span> All rooms
  </a>

  {#if loading}
    <p class="mt-8 text-sm text-muted-foreground" role="status">Loading room…</p>
  {:else if error && !snapshot}
    <p
      role="alert"
      class="mt-8 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
    >
      {error}
    </p>
  {:else if snapshot && display}
    <div class="mt-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-label text-primary break-words">
          {modeDetailLabel} · {phase}
        </p>
        <h1 class="font-display mt-2 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl">
          Room {snapshot.code ?? '····'}
        </h1>
      </div>
      <div class="flex items-center gap-2">
        <ArenaSoundToggle />
        {#if resultVerified}
          <p
            class="inline-flex items-center gap-1.5 rounded-full border border-positive/40 bg-positive/10 px-3 py-1 font-mono text-[11px] font-bold text-positive"
          >
            <span aria-hidden="true" class="inline-block h-1.5 w-1.5 rounded-full bg-current"
            ></span>
            Verified locally
          </p>
        {/if}
      </div>
    </div>

    <div class="mt-4">
      {#if phase !== 'completed' && phase !== 'awaiting-confirmation' && phase !== 'integrity-failed'}
        <FixedFiveScoreboard snapshot={display} {selfId} />
      {/if}
    </div>

    {#if replay && replay.skipped > 0}
      <p class="mt-3 text-xs text-amber-600" role="status">
        {replay.skipped} command{replay.skipped === 1 ? '' : 's'} could not be applied to the draft and
        {replay.skipped === 1 ? 'was' : 'were'} skipped.
      </p>
    {/if}
    {#if reconnecting}<p class="mt-3 text-xs text-muted-foreground" role="status">
        Reconnecting… syncing after wake-up hint.
      </p>{/if}
    {#if syncing}<p class="mt-1 text-xs text-muted-foreground" role="status">
        Syncing commands after last accepted ordinal…
      </p>{/if}
    {#if notice}<p
        class="mt-3 rounded-lg border border-line-soft bg-card p-3 text-xs"
        role="status"
      >
        {notice}
      </p>{/if}
    {#if error}<p
        class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        role="alert"
      >
        {error}
      </p>{/if}
    {#if opponent && !opponent.online}<p class="mt-3 text-xs text-amber-600" role="status">
        Opponent offline — presence is display-only and never decides validity.
      </p>{/if}

    {#if phase === 'lobby'}
      <div class="mt-6 rounded-2xl bg-surface-1 p-4 sm:p-6">
        <h2 class="font-display text-sm font-extrabold uppercase">
          {selfId === 'p1' ? 'Lobby — start when your opponent joins' : 'Lobby — waiting for host'}
        </h2>
        <p class="mt-1 text-xs text-muted-foreground">
          Variant frozen: {snapshot.settings.variant}. Codes expire after 15 minutes; rooms after 24
          hours.
        </p>
        {#if selfId === 'p1'}
          {#if snapshot.code}
            <div class="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <p class="text-label text-primary">Share with your opponent</p>
              <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div class="flex justify-center gap-1.5 sm:justify-start">
                  {#each snapshot.code.split('') as digit, i (i)}
                    <span
                      class="inline-flex h-12 w-10 items-center justify-center rounded-xl border-2 border-primary/40 bg-card font-mono text-2xl font-black sm:h-14 sm:w-12 sm:text-3xl"
                      >{digit}</span
                    >
                  {/each}
                </div>
                <div class="grid gap-2 sm:flex sm:flex-wrap">
                  <button
                    type="button"
                    onclick={copyRoomCode}
                    class="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line-soft bg-card px-4 py-2.5 text-sm font-semibold sm:w-auto"
                  >
                    {#if copiedCode}<Check class="h-4 w-4" /> Copied!{:else}<Copy class="h-4 w-4" /> Copy
                      code{/if}
                  </button>
                  <button
                    type="button"
                    onclick={copyInviteLink}
                    class="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground sm:w-auto"
                  >
                    {#if copiedInvite}<Check class="h-4 w-4" /> Copied!{:else}Copy invite link{/if}
                  </button>
                </div>
              </div>
            </div>
          {/if}
          {#if opponent?.online}
            <p class="mt-4 text-sm font-semibold text-positive" role="status">
              Opponent joined — start the draft for both players.
            </p>
          {:else}
            <p class="mt-4 text-sm text-muted-foreground" role="status">
              Waiting for opponent to join… Share the code above. Start unlocks once they join.
            </p>
          {/if}
          <div class="mt-4 grid gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              onclick={startDraft}
              disabled={busyAction !== null || !opponent?.online}
              title={!opponent?.online
                ? 'Waiting for opponent to join'
                : 'Start the draft for both'}
              class="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40 sm:py-2"
              >{busyAction === 'start' ? 'Starting…' : 'Start'}</button
            >
            <button
              type="button"
              onclick={() =>
                transport()
                  .removeGuest(roomId, 'p2')
                  .then((s) => (snapshot = s))}
              class="rounded-xl border border-line-soft bg-card px-4 py-2.5 text-sm font-semibold sm:py-2"
              >Remove guest (pre-draft)</button
            >
            <button
              type="button"
              onclick={doLeave}
              disabled={leaveBusy}
              class="rounded-xl border border-line-soft bg-card px-4 py-2.5 text-sm font-semibold disabled:opacity-40 sm:py-2"
              >Leave</button
            >
          </div>
        {:else}
          <div class="mt-4 rounded-xl border border-line-soft bg-card p-4" role="status">
            <p class="text-sm font-semibold">Joined ✓ Waiting for the host to start the draft…</p>
            <p class="mt-1 text-xs text-muted-foreground">
              No action needed — the draft opens here automatically once the host starts it.
            </p>
          </div>
          <div class="mt-4 grid gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              onclick={doLeave}
              disabled={leaveBusy}
              class="rounded-xl border border-line-soft bg-card px-4 py-2.5 text-sm font-semibold disabled:opacity-40 sm:py-2"
              >Leave</button
            >
          </div>
        {/if}
      </div>
    {:else if phase === 'drafting' && replay && assets}
      <div class="mt-4 min-w-0 overflow-x-clip rounded-2xl bg-surface-1 p-3 sm:mt-6 sm:p-6">
        <h2 class="font-display text-sm font-extrabold break-words uppercase">
          Drafting — {snapshot.settings.mode === 'duel'
            ? 'alternating duel draft'
            : snapshot.settings.mode === 'sandbox-shared-82'
              ? 'simultaneous free-pick draft'
              : 'simultaneous roll draft'}
        </h2>
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
            onPick={(playerId, slot, moveTarget) => {
              draftError = null;
              void sendPick(playerId, slot, moveTarget).catch((e: unknown) => {
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
      {@const youShort =
        localResult != null
          ? `${localResult.digest.slice(0, 6)}…${localResult.digest.slice(-4)}`
          : null}
      {@const rivalProposal = facts.proposals.find((p) => p.actor !== selfId) ?? null}
      {@const rivalShort =
        rivalProposal != null
          ? `${rivalProposal.digest.slice(0, 6)}…${rivalProposal.digest.slice(-4)}`
          : null}
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
            <h2 class="font-display text-sm font-extrabold uppercase">
              Deterministic verification — no tap needed
            </h2>
            <p class="mt-1 text-xs text-muted-foreground">
              {#if !localResult}
                Recomputing the shared result from the accepted command log…
              {:else if verificationError}
                Local verification failed: {verificationError}. This result cannot receive a
                receipt, so the room cannot complete from this device.
              {:else if rivalProposal == null}
                Result {youShort} ready — proposing to the room…
              {:else if !digestsMatch}
                Results differ — you {youShort} vs rival {rivalShort}. Re-running from the shared
                log…
              {:else if !foreignConfirmed}
                Waiting for your rival's verified confirmation of {youShort}…
              {:else if !verificationReceipt}
                Both seats confirmed {youShort} — replaying every game from the accepted command log to
                produce a verification receipt…
              {:else if submittedReceipt !== verificationReceipt.receiptDigest}
                Replay verified against the accepted command log — storing receipt {receiptShort}…
              {:else}
                Receipt {receiptShort} stored — locking the room…
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
                  completedPairKey = null;
                  completeNotReady = false;
                  void sync(lastOrdinal);
                }}
                disabled={busyAction !== null}
                class="mt-2 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-40"
              >
                {busyAction === 'complete' ? 'Locking…' : 'Try locking again'}
              </button>
            {/if}
          </div>
          <span
            class="verify-count"
            title={`Receipt ${submittedReceipt ?? 'pending'} · proposals ${facts.proposals.length} · confirmations ${facts.confirms.length}`}
            >{facts.proposals.length}/{facts.confirms.length}</span
          >
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
        <p class="mt-2 text-xs text-muted-foreground">
          Receipt {receiptShort ?? 'pending'} · proposals {facts.proposals.length} · confirmations
          {facts.confirms.length}{reranMismatch ? ' · mismatch rerun done' : ''}. Both clients
          replay every game from the accepted command log and store a verification receipt; the room
          locks only after the matching confirmations.
        </p>
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
            onNewRoom={doRematch}
            {rematchBusy}
            canNewRoom={canRematch}
          />
        {/if}
        {#if !canRematch}
          <p class="text-xs text-muted-foreground">
            Rematch needs both players to hit rematch in this completed room; it never overwrites
            this run.
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
          Integrity failure — mismatch rerun failed
        </h2>
        <p class="mt-1 text-xs">
          Both clients reran once from the accepted log and still disagreed. Neither result is
          accepted.
        </p>
      </div>
    {:else if phase === 'expired'}
      <div class="mt-6 rounded-2xl bg-surface-1 p-6">
        <h2 class="font-display text-sm font-extrabold uppercase">Expired</h2>
        <p class="mt-1 text-xs text-muted-foreground">
          Local saves are kept. Start a fresh room from the hub.
        </p>
      </div>
    {/if}

    <div class="mt-6 flex gap-2">
      <button
        type="button"
        onclick={doLeave}
        disabled={leaveBusy}
        class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold disabled:opacity-40"
        >Leave room</button
      >
    </div>
  {/if}
</section>

<style>
  .verify-banner {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    border-radius: 1rem;
    border: 1px solid color-mix(in srgb, var(--color-primary) 45%, transparent);
    background:
      radial-gradient(
        60% 120% at 0% 0%,
        color-mix(in srgb, var(--color-primary) 16%, transparent),
        transparent 70%
      ),
      var(--color-surface-1);
    padding: 0.9rem 1rem;
    animation: verify-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .verify-orb {
    width: 1rem;
    height: 1rem;
    border-radius: 999px;
    flex-shrink: 0;
    background: conic-gradient(var(--color-primary), var(--color-accent), var(--color-primary));
    animation: orb-spin 1s linear infinite;
    box-shadow: 0 0 16px color-mix(in srgb, var(--color-primary) 60%, transparent);
  }
  .verify-count {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 800;
    color: var(--color-primary);
    border: 1px solid color-mix(in srgb, var(--color-primary) 50%, transparent);
    border-radius: 999px;
    padding: 0.25rem 0.6rem;
    flex-shrink: 0;
  }
  @keyframes verify-in {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  @keyframes orb-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .verify-banner,
    .verify-orb {
      animation: none;
    }
  }
</style>
