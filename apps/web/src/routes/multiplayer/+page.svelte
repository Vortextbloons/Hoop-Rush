<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Swords, Zap, Trophy, Plus, LogIn, ArrowLeft } from '@lucide/svelte';
  import type { FixedFiveRoomMode, FixedFiveSourceMode } from '@hoop-rush/data-contracts';
  import { getFixedFiveTransport, isFixedFiveSupabaseConfigured } from '$lib/fixed-five-transport';
  import {
    friendlyFixedFiveJoinError,
    loadLastFixedFiveRoomId,
    saveFixedFiveMembership,
  } from '$lib/fixed-five-identity';

  type View = 'choose' | 'create' | 'join';
  let view = $state<View>('choose');
  let mode = $state<FixedFiveRoomMode>('classic-shared-82');
  let sourceMode = $state<FixedFiveSourceMode>('classic');
  let variant = $state<'ratings' | 'ball-knowledge'>('ratings');
  let code = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let preview = $state<string | null>(null);
  let lastRoomId = $state<string | null>(null);

  function transport() {
    return getFixedFiveTransport();
  }

  function versions() {
    return {
      dataVersion: 'data-v1',
      ratingVersion: 'ratings-v3.8',
      positionNormalizationVersion: 'position-v3',
      engineVersion: 'm3-engine-v14',
      bracketVersion: 'bracket-m3-v3',
      scheduleVersion: 'schedule-v1',
      seedDerivationVersion: 'seed-v1',
      classicRollVersion: 'classic-roll-v1',
      profileVersion: '2010s-fixed-v1',
      multiplayerVersion: 'fixed-five-multiplayer-v1',
      autopickVersion: 'fixed-five-autopick-v1',
    };
  }

  onMount(() => {
    try {
      lastRoomId = loadLastFixedFiveRoomId();
      const params = new URLSearchParams(window.location.search);
      const codeParam = params.get('code');
      if (codeParam && /^[0-9]{4}$/.test(codeParam)) {
        code = codeParam;
        view = 'join';
        void doPreview();
      }
    } catch {}
  });

  async function startCreate() {
    busy = true;
    error = null;
    try {
      const t = transport();
      const source: FixedFiveSourceMode =
        mode === 'duel' ? sourceMode : mode === 'classic-shared-82' ? 'classic' : 'sandbox';
      const created = await t.create({ mode, sourceMode: source, variant, versions: versions() });
      saveFixedFiveMembership({ ...created.membership, code: created.code });
      await goto(resolve('/multiplayer/room/[roomId]', { roomId: created.snapshot.roomId }));
    } catch (e) {
      error = friendlyFixedFiveJoinError(e);
      if (!isFixedFiveSupabaseConfigured())
        error = 'Multiplayer is offline right now. You can still play solo Classic/Sandbox.';
    } finally {
      busy = false;
    }
  }

  function cleanCode(): void {
    const clean = code.replace(/\D/g, '').slice(0, 4);
    if (clean !== code) code = clean;
  }

  async function doPreview() {
    cleanCode();
    if (code.length !== 4) {
      error = 'Enter a 4-digit code';
      return;
    }
    busy = true;
    error = null;
    try {
      const snap = await transport().preview(code);
      const modeName =
        snap.settings.mode === 'duel'
          ? 'Duel'
          : snap.settings.mode === 'sandbox-shared-82'
            ? 'Sandbox Season'
            : 'Shared Season';
      const phaseName =
        snap.phase === 'lobby'
          ? 'waiting to start'
          : snap.phase === 'drafting'
            ? 'drafting now'
            : snap.phase === 'completed'
              ? 'finished'
              : 'playing';
      preview = `${modeName} · ${phaseName}`;
    } catch (e) {
      error = friendlyFixedFiveJoinError(e);
      preview = null;
    } finally {
      busy = false;
    }
  }

  async function doJoin() {
    cleanCode();
    if (code.length !== 4) {
      error = 'Enter a 4-digit code';
      return;
    }
    busy = true;
    error = null;
    try {
      const { snapshot, membership } = await transport().join(code);
      saveFixedFiveMembership(membership);
      await goto(resolve('/multiplayer/room/[roomId]', { roomId: snapshot.roomId }));
    } catch (e) {
      error = friendlyFixedFiveJoinError(e);
    } finally {
      busy = false;
    }
  }

  async function resumeLast() {
    if (!lastRoomId) return;
    await goto(resolve('/multiplayer/room/[roomId]', { roomId: lastRoomId }));
  }
</script>

<svelte:head>
  <title>Multiplayer — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6 md:pb-10">
  <div class="flex flex-col gap-4 py-8 sm:py-12">
    <a
      href={resolve('/')}
      class="text-label inline-flex items-center gap-1.5 self-start text-muted-foreground hover:text-foreground"
    >
      <span aria-hidden="true">←</span> Home
    </a>
    <div>
      <p class="text-label text-primary">Multiplayer · Live rooms</p>
      <h1 class="font-display mt-2 text-4xl font-extrabold tracking-tight uppercase sm:text-5xl">
        Play head to head
      </h1>
      <p class="mt-3 max-w-2xl text-sm text-muted-foreground">
        Same draft, same season, head-to-head. Shared Season, Sandbox Season, and Duel — best of 7.
      </p>
    </div>
  </div>

  {#if !isFixedFiveSupabaseConfigured()}
    <div class="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
      <p class="font-semibold text-amber-600">Online play is offline</p>
      <p class="mt-1 text-muted-foreground">
        Couldn’t reach the lobby. Solo Classic and Sandbox still work.
      </p>
    </div>
  {/if}

  {#if lastRoomId}
    <div
      class="mb-6 flex items-center justify-between gap-3 rounded-xl border border-line-soft bg-card p-4"
    >
      <p class="text-sm">Resume your active room?</p>
      <button
        type="button"
        onclick={resumeLast}
        class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        Resume →
      </button>
    </div>
  {/if}

  {#if view === 'choose'}
    <div class="grid gap-4 sm:grid-cols-2">
      <button
        type="button"
        onclick={() => (view = 'create')}
        class="group flex flex-col rounded-2xl border border-line-soft bg-surface-1 p-7 text-left hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div
          class="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"
        >
          <Plus class="h-6 w-6" />
        </div>
        <h2 class="font-display mt-5 text-2xl font-extrabold tracking-tight uppercase">
          Start a room
        </h2>
        <p class="mt-2 text-sm text-muted-foreground">
          Pick a mode and ratings, share a 4-digit code.
        </p>
      </button>
      <button
        type="button"
        onclick={() => (view = 'join')}
        class="group flex flex-col rounded-2xl border border-line-soft bg-card p-7 text-left hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div
          class="flex h-12 w-12 items-center justify-center rounded-xl border border-line-soft bg-surface-1"
        >
          <LogIn class="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 class="font-display mt-5 text-2xl font-extrabold tracking-tight uppercase">
          Join a room
        </h2>
        <p class="mt-2 text-sm text-muted-foreground">Enter the 4-digit code from your opponent.</p>
      </button>
    </div>
    <div class="mt-6 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
      <span class="rounded-full border border-line-soft bg-card px-3 py-1"
        >2 players · live only</span
      >
      <span class="rounded-full border border-line-soft bg-card px-3 py-1"
        >90s picks · 5m sandbox builds</span
      >
    </div>
  {:else if view === 'create'}
    <div class="rounded-2xl bg-surface-1 p-6 sm:p-7">
      <div class="flex items-center justify-between">
        <h3 class="font-display text-sm font-extrabold tracking-widest uppercase">
          Pick your battle
        </h3>
        <button
          type="button"
          onclick={() => (view = 'choose')}
          class="inline-flex items-center gap-1.5 rounded-lg border border-line-soft bg-card px-3 py-1.5 text-xs font-semibold"
        >
          <ArrowLeft class="h-3.5 w-3.5" /> Back
        </button>
      </div>
      <div class="mt-4 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onclick={() => (mode = 'classic-shared-82')}
          class="rounded-xl border p-4 text-left {mode === 'classic-shared-82'
            ? 'border-primary bg-primary/10 ring-1 ring-primary'
            : 'border-line-soft bg-card'}"
        >
          <Swords class="h-5 w-5 text-muted-foreground" />
          <p class="font-display mt-3 text-sm font-extrabold uppercase">Shared Season</p>
          <p class="mt-1 text-xs text-muted-foreground">Same 82 games, head-to-head · 90s picks</p>
        </button>
        <button
          type="button"
          onclick={() => (mode = 'sandbox-shared-82')}
          class="rounded-xl border p-4 text-left {mode === 'sandbox-shared-82'
            ? 'border-primary bg-primary/10 ring-1 ring-primary'
            : 'border-line-soft bg-card'}"
        >
          <Zap class="h-5 w-5 text-muted-foreground" />
          <p class="font-display mt-3 text-sm font-extrabold uppercase">Sandbox Season</p>
          <p class="mt-1 text-xs text-muted-foreground">
            Pick any five · both teams can share players
          </p>
        </button>
        <button
          type="button"
          onclick={() => (mode = 'duel')}
          class="rounded-xl border p-4 text-left {mode === 'duel'
            ? 'border-primary bg-primary/10 ring-1 ring-primary'
            : 'border-line-soft bg-card'}"
        >
          <Trophy class="h-5 w-5 text-muted-foreground" />
          <p class="font-display mt-3 text-sm font-extrabold uppercase">Duel</p>
          <p class="mt-1 text-xs text-muted-foreground">Best of 7 · take turns drafting</p>
        </button>
      </div>
      {#if mode === 'duel'}
        <div class="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onclick={() => (sourceMode = 'classic')}
            class="rounded-xl border p-4 text-left {sourceMode === 'classic'
              ? 'border-primary bg-primary/10'
              : 'border-line-soft bg-card'}"
          >
            <p class="text-sm font-bold">From Classic</p>
            <p class="text-xs text-muted-foreground">Franchise & decade roll draft</p>
          </button>
          <button
            type="button"
            onclick={() => (sourceMode = 'sandbox')}
            class="rounded-xl border p-4 text-left {sourceMode === 'sandbox'
              ? 'border-primary bg-primary/10'
              : 'border-line-soft bg-card'}"
          >
            <p class="text-sm font-bold">From Sandbox</p>
            <p class="text-xs text-muted-foreground">
              Free-pick duel — any player, stars can repeat
            </p>
          </button>
        </div>
      {/if}
      <div class="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onclick={() => (variant = 'ratings')}
          class="rounded-xl border p-4 text-left {variant === 'ratings'
            ? 'border-primary bg-primary/10'
            : 'border-line-soft bg-card'}"
        >
          <p class="text-sm font-bold">Ratings</p>
          <p class="text-xs text-muted-foreground">Same ratings for both players</p>
        </button>
        <button
          type="button"
          onclick={() => (variant = 'ball-knowledge')}
          class="rounded-xl border p-4 text-left {variant === 'ball-knowledge'
            ? 'border-primary bg-primary/10'
            : 'border-line-soft bg-card'}"
        >
          <p class="text-sm font-bold">Ball Knowledge</p>
          <p class="text-xs text-muted-foreground">No ratings — draft on memory</p>
        </button>
      </div>
      <button
        type="button"
        onclick={startCreate}
        disabled={busy}
        class="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground disabled:opacity-40"
      >
        {busy ? 'Creating…' : 'Create room →'}
      </button>
      {#if error}<p
          role="alert"
          class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {error}
        </p>{/if}
    </div>
  {:else}
    <div class="mx-auto max-w-md rounded-2xl bg-surface-1 p-6 sm:p-8">
      <button
        type="button"
        onclick={() => (view = 'choose')}
        class="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
      >
        <ArrowLeft class="h-3.5 w-3.5" /> Back
      </button>
      <h2 class="font-display mt-4 text-lg font-extrabold uppercase">Join a room</h2>
      <label for="join-code" class="text-label mt-6 mb-2 block text-muted-foreground"
        >Room code</label
      >
      <input
        id="join-code"
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength={4}
        placeholder="0000"
        bind:value={code}
        oninput={cleanCode}
        class="w-full rounded-xl border-2 border-line-soft bg-card px-4 py-3 text-center font-mono text-lg font-bold tracking-[0.5em] focus:border-primary focus:outline-none"
      />
      <div class="mt-3 flex gap-2">
        <button
          type="button"
          onclick={doPreview}
          disabled={busy || code.length !== 4}
          class="flex-1 rounded-xl border border-line-soft bg-card px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
          >Preview</button
        >
        <button
          type="button"
          onclick={doJoin}
          disabled={busy || code.length !== 4}
          class="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          {busy ? 'Joining…' : 'Join →'}
        </button>
      </div>
      {#if preview}<p class="mt-3 rounded-xl border border-positive/30 bg-positive/10 p-3 text-xs">
          {preview}
        </p>{/if}
      {#if error}<p
          role="alert"
          class="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {error}
        </p>{/if}
    </div>
  {/if}
</section>
