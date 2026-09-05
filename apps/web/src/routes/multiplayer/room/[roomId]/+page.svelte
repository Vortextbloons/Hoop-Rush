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
    pickOrdinalOf,
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
  let completedSent = $state(false);
  let failSent = $state(false);
  let busyAction = $state<string | null>(null);
  let leaveBusy = $state(false);
  let rematchBusy = $state(false);
  let submittedTimeouts = $state<Set<string>>(new Set());
  let copiedInvite = $state(false);
  let copiedCode = $state(false);
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
  async function resolveOverdue(): Promise<void> {
    if (!snapshot || !assets || !snapshot.rootSeed || !replay || phase !== 'drafting') return;
    const mode = snapshot.settings.mode;
    const now = Date.now();
    if (now - anchorMs <= timeoutMs) return;
    for (const participant of ['p1', 'p2'] as const) {
      const ordinal = pickOrdinalOf(replay, participant);
      const key = `${participant}:${ordinal}`;
      if (submittedTimeouts.has(key)) continue;
      if (commands.some((c) => c.commandId === `timeout-${mode}-${participant}-${ordinal}`)) {
        continue;
      }
      const pick = computeDueAutopick(mode, snapshot.rootSeed, replay, assets, participant);
      if (!pick) continue;
      submittedTimeouts = new Set([...submittedTimeouts, key]);
      await sendCommand(
        {
          kind: 'timeout-autopick',
          playerId: pick.playerId,
          slotIndex: pick.slotIndex,
          pickOrdinal: ordinal,
          seedPath: pick.seedPath,
        },
        { actor: participant, commandId: `timeout-${mode}-${participant}-${ordinal}` },
      );
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
        } else {
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
      if (ok) submittedPropose = digest;
    } finally {
      busyAction = null;
    }
  }
  async function confirmDigest(digest: ContentHash, verified: boolean): Promise<void> {
    busyAction = 'confirm';
    try {
      const ok = await sendCommand({ kind: 'confirm-result', resultDigest: digest, verified });
      if (ok && verified) confirmedFor = digest;
    } finally {
      busyAction = null;
    }
  }
  async function attemptComplete(digest: ContentHash): Promise<void> {
    busyAction = 'complete';
    try {
      const out = await transport().complete(roomId, digest);
      if (!out.completed && mounted) {
        notice = 'Completion not ready yet — waiting for the matching confirmation.';
      }
      await sync(lastOrdinal);
    } catch (e) {
      if (mounted) error = friendlyFixedFiveJoinError(e);
    } finally {
      busyAction = null;
    }
  }
  async function attemptFail(): Promise<void> {
    busyAction = 'fail';
    try {
      await transport().fail(roomId);
      await sync(lastOrdinal);
    } catch (e) {
      if (mounted) error = friendlyFixedFiveJoinError(e);
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
    if (snapshot.phase !== 'lobby') return;
    const myDigest = localResult.digest;
    const foreign = facts.proposals.filter((p) => p.actor !== selfId);
    if (foreign.length === 0) {
      if (submittedPropose !== myDigest) void proposeDigest(myDigest);
      return;
    }
    const match = foreign.some((p) => p.digest === myDigest);
    if (match && confirmedFor !== myDigest) {
      void confirmDigest(myDigest, true);
      return;
    }
    if (!match && !reranMismatch) {
      reranMismatch = true;
      void rerunSimulation();
    }
  });
  $effect(() => {
    if (!mounted || !localResult || !snapshot || !reranMismatch || mismatchReported) return;
    if (snapshot.phase !== 'lobby') return;
    const myDigest = localResult.digest;
    const foreign = facts.proposals.filter((p) => p.actor !== selfId);
    if (foreign.some((p) => p.digest === myDigest)) return;
    if (foreign.length === 0) return;
    mismatchReported = true;
    const first = foreign[0];
    void (async () => {
      if (submittedPropose !== myDigest) await proposeDigest(myDigest);
      if (first) await confirmDigest(first.digest, false);
    })();
  });
  $effect(() => {
    if (!mounted || !snapshot || !localResult) return;
    if (snapshot.phase !== 'lobby' || completedSent) return;
    if (!confirmedFor) return;
    const foreignConfirm = facts.confirms.some(
      (c) => c.actor !== selfId && c.digest === confirmedFor && c.verified,
    );
    if (foreignConfirm) {
      completedSent = true;
      void attemptComplete(confirmedFor).catch(() => {
        completedSent = false;
      });
    }
  });
  $effect(() => {
    if (!mounted || !snapshot || failSent) return;
    if (snapshot.phase !== 'lobby') return;
    const digests = new Set(facts.proposals.map((p) => p.digest));
    const denied = facts.confirms.some((c) => !c.verified);
    if (digests.size >= 2 && denied) {
      failSent = true;
      void attemptFail().catch(() => {
        failSent = false;
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
    return snapshot.confirmedDigest === localResult.digest;
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
      {#if resultVerified}
        <p
          class="inline-flex items-center gap-1.5 rounded-full border border-positive/40 bg-positive/10 px-3 py-1 font-mono text-[11px] font-bold text-positive"
        >
          <span aria-hidden="true" class="inline-block h-1.5 w-1.5 rounded-full bg-current"></span>
          Result verified
        </p>
      {/if}
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
      <div class="mt-6 flex flex-col gap-4">
        <div class="rounded-2xl bg-surface-1 p-4 sm:p-5">
          <h2 class="font-display text-sm font-extrabold uppercase">
            Waiting for result confirmation
          </h2>
          {#if !localResult}
            <p class="mt-2 text-sm text-muted-foreground" role="status">
              Recomputing the shared result from the accepted command log…
            </p>
          {/if}
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
          />
        {/if}
        <p class="mt-2 text-xs text-muted-foreground">
          Proposals {facts.proposals.length} · confirmations {facts.confirms.length}{reranMismatch
            ? ' · mismatch rerun done'
            : ''}. First finished client proposes; the peer recomputes and confirms.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          {#if localResult}
            {@const confirmed = localResult}
            <button
              type="button"
              onclick={() => attemptComplete(confirmed.digest)}
              disabled={busyAction !== null}
              class="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >
              Complete room
            </button>
          {/if}
        </div>
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
