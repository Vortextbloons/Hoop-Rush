<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { FixedFiveRoomSnapshot } from '@hoop-rush/data-contracts';
  import { createFixedFiveTransport } from '$lib/fixed-five-transport';
  import {
    friendlyFixedFiveJoinError,
    loadFixedFiveMembership,
    saveFixedFiveMembership,
  } from '$lib/fixed-five-identity';
  import { fixedFiveRepository } from '$lib/fixed-five-repo';
  import FixedFiveScoreboard from '$lib/components/FixedFiveScoreboard.svelte';

  let roomId = $derived($page.params.roomId as string);
  let snapshot = $state<FixedFiveRoomSnapshot | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let reconnecting = $state(false);
  let syncing = $state(false);
  let lastOrdinal = $state(-1);
  let selfId = $state<'p1' | 'p2'>('p1');
  let progress = $state<{ completed: number; total: number } | null>(null);
  let rematchBusy = $state(false);
  let leaveBusy = $state(false);
  let mounted = true;

  function transport() {
    const env = import.meta as unknown as { env: Record<string, string> };
    return createFixedFiveTransport({
      url: env.env.VITE_SUPABASE_URL,
      publishableKey: env.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    });
  }

  async function sync(afterOrdinal: number): Promise<void> {
    if (!snapshot) return;
    syncing = true;
    try {
      const commands = await transport().refetch(roomId, afterOrdinal);
      if (!mounted) return;
      if (commands.length > 0) {
        lastOrdinal = Math.max(...commands.map((c) => c.ordinal));
        for (const command of commands) {
          try {
            await fixedFiveRepository.appendCommand(command);
          } catch {}
        }
        notice = `Synced ${commands.length} command${commands.length === 1 ? '' : 's'} after a stale revision.`;
      }
      await fixedFiveRepository.saveActiveSnapshot(snapshot, lastOrdinal + 1);
    } catch (e) {
      if (mounted) error = friendlyFixedFiveJoinError(e);
    } finally {
      if (mounted) syncing = false;
    }
  }

  async function sendCommand(
    payload: FixedFiveRoomSnapshot extends never
      ? never
      : import('@hoop-rush/data-contracts').FixedFiveCommandPayload,
  ): Promise<void> {
    error = null;
    try {
      const receipt = await transport().submitCommand({
        schemaVersion: 1,
        roomId,
        commandId: crypto.randomUUID(),
        actorParticipantId: selfId,
        payload,
        expectedRevision: snapshot?.revision,
      });
      if (!receipt.accepted && receipt.rejectionCode === 'stale-revision') {
        notice = 'Stale command — resyncing once before retry.';
        await sync(lastOrdinal);
      } else if (!receipt.accepted) {
        error = `Command rejected: ${receipt.rejectionCode ?? 'unknown'}`;
      }
    } catch (e) {
      error = friendlyFixedFiveJoinError(e);
    }
  }

  async function resolveTimeout(): Promise<void> {
    try {
      await transport().resolveTimeout(roomId);
      await sync(lastOrdinal);
      notice = 'Overdue fallback resolved. Timeout never spends a reroll.';
    } catch (e) {
      error = friendlyFixedFiveJoinError(e);
    }
  }

  onMount(() => {
    mounted = true;
    const membership = loadFixedFiveMembership(roomId);
    if (membership) selfId = membership.participantId;
    let unsubscribe: (() => void) | null = null;
    let resyncTimer: ReturnType<typeof setInterval> | null = null;

    async function boot(): Promise<void> {
      loading = true;
      try {
        const t = transport();
        const { snapshot: snap, membership: resumed } = await t.resume(roomId);
        if (!mounted) return;
        snapshot = snap;
        selfId = resumed.participantId;
        saveFixedFiveMembership({ ...resumed, code: snap.code ?? resumed.code });
        const stored = await fixedFiveRepository.loadActive(roomId).catch(() => null);
        lastOrdinal =
          stored?.commandCursor != null ? stored.commandCursor - 1 : snap.commandCount - 1;
        await fixedFiveRepository.saveActiveSnapshot(snap, lastOrdinal + 1).catch(() => {});
        unsubscribe = t.subscribe(roomId, (next) => {
          if (!mounted) return;
          snapshot = next;
          reconnecting = false;
        }).unsubscribe;
        await sync(lastOrdinal);
      } catch (e) {
        if (mounted) error = friendlyFixedFiveJoinError(e);
      } finally {
        if (mounted) loading = false;
      }
    }

    void boot();

    const onFocus = () => {
      reconnecting = true;
      void sync(lastOrdinal).finally(() => {
        if (mounted) reconnecting = false;
      });
    };
    const onOnline = () => {
      reconnecting = true;
      void sync(lastOrdinal).finally(() => {
        if (mounted) reconnecting = false;
      });
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    resyncTimer = setInterval(() => {
      void resolveTimeout();
    }, 15000);

    return () => {
      mounted = false;
      unsubscribe?.();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      if (resyncTimer) clearInterval(resyncTimer);
    };
  });

  async function doLeave(): Promise<void> {
    leaveBusy = true;
    try {
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

  let phase = $derived(snapshot?.phase ?? 'lobby');
  let opponent = $derived(snapshot?.members.find((m) => m.participantId !== selfId) ?? null);
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
  {:else if snapshot}
    <div class="mt-4">
      <p class="text-label text-primary">Fixed-five · {snapshot.settings.mode} · {phase}</p>
      <h1 class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase">
        Room {snapshot.code ?? '····'}
      </h1>
    </div>

    <div class="mt-4">
      <FixedFiveScoreboard {snapshot} {selfId} />
    </div>

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
    {:else if phase === 'drafting'}
      <div class="mt-6 rounded-2xl bg-surface-1 p-6">
        <h2 class="font-display text-sm font-extrabold uppercase">
          Drafting — simultaneous Shared 82 · alternating Duel
        </h2>
        <p class="mt-1 text-xs text-muted-foreground">
          Classic & Duel: 90s per required pick. Sandbox: five minutes to build and lock. A timeout
          never spends a reroll; safe moves preserve a legal G/G/F/F/C completion and draw from the
          top eight via rootSeed/timeout-autopick/mode/participant/pickOrdinal.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onclick={() => sendCommand({ kind: 'reroll', axis: 'franchise' })}
            class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
            >Reroll franchise</button
          >
          <button
            type="button"
            onclick={() => sendCommand({ kind: 'reroll', axis: 'era' })}
            class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
            >Reroll era</button
          >
          <button
            type="button"
            onclick={resolveTimeout}
            class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
            >Resolve overdue fallback</button
          >
        </div>
        {#if snapshot.deadline}
          <p class="mt-3 text-xs text-muted-foreground">
            Pending command cursor {snapshot.deadline.cursor} · pick ordinal {snapshot.deadline
              .pickOrdinal}. Reconnect resolves overdue fallbacks immediately.
          </p>
        {/if}
      </div>
    {:else if phase === 'simulating'}
      <div class="mt-6 rounded-2xl bg-surface-1 p-6">
        <h2 class="font-display text-sm font-extrabold uppercase">Simulating locally</h2>
        {#if progress}
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
        <p class="mt-1 text-xs text-muted-foreground">
          First finished client proposes the final digest; the peer recomputes and confirms. On
          disagreement both rerun once from the accepted log.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onclick={() => sendCommand({ kind: 'propose-result', resultDigest: '0'.repeat(64) })}
            class="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >Propose digest</button
          >
          <button
            type="button"
            onclick={() =>
              sendCommand({ kind: 'confirm-result', resultDigest: '0'.repeat(64), verified: true })}
            class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
            >Confirm digest</button
          >
        </div>
      </div>
    {:else if phase === 'completed'}
      <div class="mt-6 rounded-2xl bg-surface-1 p-6">
        <h2 class="font-display text-sm font-extrabold uppercase">
          Completed — Shared 82 comparison or Duel series
        </h2>
        <p class="mt-1 text-xs text-muted-foreground">
          Ranked by wins, then differential, then the recorded seeded tie-break. Rematch needs both
          confirmations and never overwrites this run.
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onclick={() => sendCommand({ kind: 'rematch-request' })}
            class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
            >Request rematch</button
          >
          <button
            type="button"
            onclick={() => sendCommand({ kind: 'rematch-confirm' })}
            class="rounded-xl border border-line-soft bg-card px-4 py-2 text-sm font-semibold"
            >Confirm rematch</button
          >
          <button
            type="button"
            onclick={doRematch}
            disabled={rematchBusy}
            class="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {rematchBusy ? 'Creating…' : 'New successor room →'}
          </button>
        </div>
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
