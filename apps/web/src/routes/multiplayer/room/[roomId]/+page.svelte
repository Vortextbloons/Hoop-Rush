<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
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
  import {
    commandIdSchema,
    fixedFiveTimeoutMsForMode,
    idSchema,
  } from '@hoop-rush/data-contracts';
  import { createConfiguredFixedFiveTransport } from '$lib/fixed-five-transport';
  import {
    friendlyFixedFiveJoinError,
    loadFixedFiveMembership,
    saveFixedFiveMembership,
  } from '$lib/fixed-five-identity';
  import { fixedFiveRepository } from '$lib/fixed-five-repo';
  import { FixedFiveRunner } from '$lib/fixed-five-runner';
  import FixedFiveScoreboard from '$lib/components/FixedFiveScoreboard.svelte';
  import FixedFiveDraftPanel from '$lib/components/FixedFiveDraftPanel.svelte';
  import {
    assembleCompetitionRun,
    buildSimulationTeam,
    computeCompetitionDigest,
    computeDueAutopick,
    deriveEffectivePhase,
    isDraftComplete,
    loadActivityAt,
    loadFixedFiveAssets,
    overlaySnapshotProgress,
    pickOrdinalOf,
    refsForParticipant,
    replayFixedFiveLog,
    roomLogFacts,
    saveActivityNow,
    summarizeWorkerEntries,
    type DraftReplay,
    type FixedFiveAssets,
    type PickRef,
  } from '$lib/fixed-five-room-state';
  import { presentationForVariant } from '$lib/draft-presentation';
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

  let progress = $state<{ completed: number; total: number } | null>(null);
  let simStarted = $state(false);
  let simDone = $state(false);
  let simError = $state<string | null>(null);
  let simEntries = $state<FixedFiveWorkerResultEntry[]>([]);
  let runner: FixedFiveRunner | null = null;

  interface LocalResult {
    result: FixedFiveCompetitionResult;
    digest: ContentHash;
    p1: { refs: PickRef[]; players: SimulationPlayer[] };
    p2: { refs: PickRef[]; players: SimulationPlayer[] };
    weakestReplacedOpponentId: string | null;
  }
  let localResult = $state<LocalResult | null>(null);
  let submittedPropose = $state<ContentHash | null>(null);
  let confirmedFor = $state<ContentHash | null>(null);
  let reranMismatch = $state(false);
  let completedSent = $state(false);
  let failSent = $state(false);
  let busyAction = $state<string | null>(null);
  let leaveBusy = $state(false);
  let rematchBusy = $state(false);
  let submittedTimeouts = $state<Set<string>>(new Set());

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
      );
    } catch {
      return null;
    }
  });
  const facts = $derived(roomLogFacts(commands));
  const phase = $derived(
    snapshot && replay ? deriveEffectivePhase(snapshot.phase, replay, simDone) : 'lobby',
  );
  const display = $derived(
    snapshot && replay ? overlaySnapshotProgress(snapshot, replay, facts) : snapshot,
  );
  const presentation = $derived(
    presentationForVariant(snapshot?.settings.variant ?? 'ratings'),
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
  const lastAutopick = $derived.by((): { displayName: string; seedPath: string } | null => {
    if (!assets) return null;
    const timeouts = commands.filter((c) => c.payload.kind === 'timeout-autopick');
    const last = timeouts[timeouts.length - 1];
    if (!last) return null;
    const payload = last.payload;
    if (payload.kind !== 'timeout-autopick') return null;
    const row = assets.index.players.find((p) => p.playerId === payload.playerId);
    return { displayName: row?.displayName ?? payload.playerId, seedPath: payload.seedPath };
  });

  function transport() {
    return createConfiguredFixedFiveTransport();
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
        lastOrdinal = Math.max(...fresh.map((c) => c.ordinal));
        for (const command of fresh) {
          commands = [...commands, command];
          try {
            await fixedFiveRepository.appendCommand(command);
          } catch {
            /* already stored */
          }
        }
        saveActivityNow(roomId);
        notice = `Synced ${fresh.length} command${fresh.length === 1 ? '' : 's'} after the last accepted ordinal.`;
      }
      await fixedFiveRepository.saveActiveSnapshot(snapshot, lastOrdinal + 1).catch(() => {});
    } catch (e) {
      if (mounted) error = friendlyFixedFiveJoinError(e);
    } finally {
      if (mounted) syncing = false;
    }
  }

  const REVERSIBLE_KINDS = new Set([
    'ready',
    'reroll',
    'classic-pick',
    'duel-claim',
    'sandbox-place',
    'sandbox-remove',
  ]);

  async function sendCommand(
    payload: FixedFiveCommandPayload,
    options?: { actor?: 'p1' | 'p2'; commandId?: string; retry?: boolean },
  ): Promise<boolean> {
    error = null;
    const commandId = newCommandId(options?.commandId);
    try {
      const receipt = await transport().submitCommand({
        schemaVersion: 1,
        roomId: brandedRoomId(),
        commandId,
        actorParticipantId: options?.actor ?? selfId,
        payload,
        expectedRevision: snapshot?.revision,
      });
      if (!receipt.accepted && receipt.rejectionCode === 'stale-revision') {
        notice = 'Stale command — resyncing once before a single retry.';
        await sync(lastOrdinal);
        if (options?.retry !== false && REVERSIBLE_KINDS.has(payload.kind) && mounted) {
          const retry = await transport().submitCommand({
            schemaVersion: 1,
            roomId: brandedRoomId(),
            commandId,
            actorParticipantId: options?.actor ?? selfId,
            payload,
            expectedRevision: snapshot?.revision,
          });
          if (!retry.accepted) {
            error = `Command rejected: ${retry.rejectionCode ?? 'unknown'}`;
            return false;
          }
        } else if (mounted) {
          error = 'Command rejected as stale; not retried because it is irreversible.';
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

  async function sendPick(playerId: PlayerId, slot: SlotIndex): Promise<void> {
    draftError = null;
    if (!snapshot || !replay) return;
    const mode = snapshot.settings.mode;
    if (mode === 'sandbox-shared-82') {
      await sendCommand({ kind: 'sandbox-place', playerId, slotIndex: slot });
      return;
    }
    if (mode === 'duel') {
      if (replay.mode !== 'duel' || !replay.state.currentRoll) {
        draftError = 'No active duel roll.';
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

  async function startSim(): Promise<void> {
    if (simStarted || !snapshot || !assets || !snapshot.rootSeed || !replay) return;
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
        simDone = true;
        return;
      }
      simEntries = [];
      progress = { completed: 0, total: snapshot.settings.mode === 'duel' ? 7 : 161 };
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
          localResult = {
            result: summary.result,
            digest,
            p1: { refs: p1Refs, players: [...p1Team.players] },
            p2: { refs: p2Refs, players: [...p2Team.players] },
            weakestReplacedOpponentId: summary.weakestReplacedOpponentId,
          };
          simDone = true;
        } catch (e) {
          if (mounted) simError = e instanceof Error ? e.message : String(e);
        }
      }
    } catch (e) {
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
        saveFixedFiveMembership({ ...resumed.membership, code: snap.code ?? resumed.membership.code });
        const [stored, loadedAssets] = await Promise.all([
          fixedFiveRepository.loadActive(roomId).catch(() => null),
          loadFixedFiveAssets().catch((e: unknown) => {
            assetsError = e instanceof Error ? e.message : String(e);
            return null;
          }),
        ]);
        if (!mounted) return;
        assets = loadedAssets;
        lastOrdinal =
          stored?.commandCursor != null ? stored.commandCursor - 1 : snap.commandCount - 1;
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
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      if (resyncTimer) clearInterval(resyncTimer);
      if (clockTimer) clearInterval(clockTimer);
    };
  });

  $effect(() => {
    if (!mounted || !snapshot || !replay) return;
    if (phase === 'simulating' && !simStarted && !simError && snapshot.rootSeed) {
      void startSim();
    }
  });

  $effect(() => {
    if (!mounted || !localResult || !snapshot) return;
    if (snapshot.phase !== 'lobby') return;
    const myDigest = localResult.digest;
    const foreign = facts.proposals.filter((p) => p.actor !== selfId);
    if (facts.proposals.length === 0 && !submittedPropose) {
      void proposeDigest(myDigest);
      return;
    }
    if (foreign.length === 0) return;
    const match = foreign.some((p) => p.digest === myDigest);
    if (match && confirmedFor !== myDigest) {
      void confirmDigest(myDigest, true);
      return;
    }
    if (!match && !reranMismatch) {
      reranMismatch = true;
      const first = foreign[0];
      if (first && !submittedPropose) {
        void (async () => {
          await proposeDigest(myDigest);
          await confirmDigest(first.digest, false);
        })();
      } else if (first) {
        void confirmDigest(first.digest, false);
      }
    }
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
</script>

<svelte:head>
  <title>Room — Hoop Rush Multiplayer</title>
</svelte:head>

<section class="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6 md:pb-10">
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
    <div class="mt-4">
      <p class="text-label text-primary">Fixed-five · {snapshot.settings.mode} · {phase}</p>
      <h1 class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase">
        Room {snapshot.code ?? '····'}
      </h1>
    </div>

    <div class="mt-4">
      <FixedFiveScoreboard snapshot={display} selfId={selfId} />
    </div>

    {#if replay && replay.skipped > 0}
      <p class="mt-3 text-xs text-amber-600" role="status">
        {replay.skipped} command{replay.skipped === 1 ? '' : 's'} could not be applied to the draft
        and {replay.skipped === 1 ? 'was' : 'were'} skipped.
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
      <div class="mt-6 rounded-2xl bg-surface-1 p-6">
        <h2 class="font-display text-sm font-extrabold uppercase">Lobby — waiting & ready</h2>
        <p class="mt-1 text-xs text-muted-foreground">
          Variant frozen: {snapshot.settings.variant}. Codes expire after 15 minutes; rooms after 24
          hours.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onclick={() => sendCommand({ kind: 'ready', ready: true })}
            class="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >Ready</button
          >
          <button
            type="button"
            onclick={() => sendCommand({ kind: 'start' })}
            class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
            >Start draft</button
          >
          {#if selfId === 'p1'}
            <button
              type="button"
              onclick={() =>
                transport()
                  .removeGuest(roomId, 'p2')
                  .then((s) => (snapshot = s))}
              class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
              >Remove guest (pre-draft)</button
            >
          {/if}
          <button
            type="button"
            onclick={doLeave}
            disabled={leaveBusy}
            class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold disabled:opacity-40"
            >Leave</button
          >
        </div>
      </div>
    {:else if phase === 'drafting' && replay && assets}
      <div class="mt-6 rounded-2xl bg-surface-1 p-6">
        <h2 class="font-display text-sm font-extrabold uppercase">
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
            disabled={syncing}
            deadlineText={clockText}
            {lastAutopick}
            error={draftError}
            onPick={(playerId, slot) => {
              draftError = null;
              void sendPick(playerId, slot).catch((e: unknown) => {
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
      <div class="mt-6 rounded-2xl bg-surface-1 p-6">
        <h2 class="font-display text-sm font-extrabold uppercase">Simulating locally</h2>
        {#if simError}
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
        {:else if progress}
          <p class="mt-2 text-sm" role="status">{progress.completed}/{progress.total} games</p>
          <div class="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              class="h-full bg-primary"
              style={`width: ${(progress.completed / Math.max(1, progress.total)) * 100}%`}
            ></div>
          </div>
        {:else}
          <p class="mt-2 text-sm text-muted-foreground" role="status">
            Warming the bounded worker… progress capped at four updates per second.
          </p>
        {/if}
        <p class="mt-2 text-xs text-muted-foreground">
          Every game validated with checkGameResult. H2H occurrences simulate once and mirror into
          both records.
        </p>
      </div>
    {:else if phase === 'awaiting-confirmation'}
      <div class="mt-6 rounded-2xl bg-surface-1 p-6">
        <h2 class="font-display text-sm font-extrabold uppercase">
          Waiting for result confirmation
        </h2>
        {#if localResult}
          <p class="mt-2 font-mono text-xs break-all" aria-label="Result digest">
            {localResult.digest.slice(0, 16)}…{localResult.digest.slice(-8)}
          </p>
          {#if localResult.result.competition === 'shared-82'}
            <div class="mt-3 grid gap-2 sm:grid-cols-2">
              {#each localResult.result.participants as participant (participant.participantId)}
                <div class="rounded-xl border border-line-soft bg-card p-3 text-sm">
                  <p class="font-bold">
                    {participant.participantId === selfId ? 'You' : 'Opponent'} · {participant.wins}–{participant.losses}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    Diff {participant.differential >= 0 ? '+' : ''}{participant.differential} · H2H
                    {participant.h2hWins}
                  </p>
                </div>
              {/each}
            </div>
          {:else}
            <ul class="mt-3 space-y-1 text-sm">
              {#each localResult.result.games as game (game.gameNumber)}
                <li>
                  Game {game.gameNumber}: {game.winner === selfId ? 'You' : 'Opponent'}
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          <p class="mt-2 text-sm text-muted-foreground" role="status">
            Recomputing the shared result from the accepted command log…
          </p>
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
              onclick={() => proposeDigest(confirmed.digest)}
              disabled={busyAction !== null}
              class="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >
              Propose digest
            </button>
            <button
              type="button"
              onclick={() => confirmDigest(confirmed.digest, true)}
              disabled={busyAction !== null}
              class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold disabled:opacity-40"
            >
              Confirm digest
            </button>
            <button
              type="button"
              onclick={() => attemptComplete(confirmed.digest)}
              disabled={busyAction !== null}
              class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold disabled:opacity-40"
            >
              Complete room
            </button>
          {/if}
          <button
            type="button"
            onclick={() => attemptFail()}
            disabled={busyAction !== null}
            class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >
            Report mismatch
          </button>
        </div>
      </div>
    {:else if phase === 'completed' && localResult}
      <div class="mt-6 rounded-2xl bg-surface-1 p-6">
        <h2 class="font-display text-sm font-extrabold uppercase">
          Completed — {localResult.result.competition === 'duel' ? 'duel series' : 'shared 82 comparison'}
        </h2>
        {#if localResult.result.competition === 'shared-82'}
          <p class="mt-2 text-sm">
            Winner: {localResult.result.ranking[0] === selfId ? 'You' : 'Opponent'} (wins, then
            differential, then seeded tie-break)
          </p>
        {:else}
          <p class="mt-2 text-sm">
            Winner: {localResult.result.winner === selfId ? 'You' : 'Opponent'} ·
            {localResult.result.p1Wins}–{localResult.result.p2Wins} after
            {localResult.result.stoppedAtGame} games
          </p>
        {/if}
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onclick={() => sendCommand({ kind: 'rematch-request' })}
            class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
          >
            Request rematch
          </button>
          <button
            type="button"
            onclick={() => sendCommand({ kind: 'rematch-confirm' })}
            class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
          >
            Confirm rematch
          </button>
          <button
            type="button"
            onclick={doRematch}
            disabled={rematchBusy || !canRematch}
            title={canRematch ? 'Create the successor room' : 'Needs both confirmations first'}
            class="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {rematchBusy ? 'Creating…' : 'New successor room →'}
          </button>
        </div>
        {#if !canRematch}
          <p class="mt-2 text-xs text-muted-foreground">
            Rematch needs both confirmations and a completed room; it never overwrites this run.
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
