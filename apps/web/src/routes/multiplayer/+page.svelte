<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import {
    Users,
    Swords,
    Trophy,
    Clock,
    Shield,
    Zap,
    ArrowLeft,
    Copy,
    Check,
    LogIn,
    Plus,
  } from '@lucide/svelte';
  import { createInMemorySeasonRoomCoordinator } from '$lib/season/season-room-coordinator';
  import {
    createSupabaseSeasonTransport,
    isSupabaseConfigured,
    multiplayerDisabledMessage,
  } from '$lib/season/supabase-season-transport';
  import { seasonRootSeed } from '$lib/season/season-ids';
  import { friendlyJoinError } from '$lib/season/season-room-identity';

  type Mode = 'season' | 'classic' | 'sandbox';
  type Pace = 'live' | 'async';
  type View = 'choose' | 'create' | 'join';

  let view = $state<View>('choose');
  let selectedMode = $state<Mode>('season');
  let pace = $state<Pace>('live');
  let code = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let preview = $state<{ mode: string; pace: string; detail: string } | null>(null);
  let createdCode = $state<string | null>(null);
  let createdRoomId = $state<string | null>(null);
  let expiresAt = $state<string | null>(null);
  let copied = $state(false);
  let tick = $state(0);

  let countdown = $derived.by(() => {
    if (!expiresAt) return null;
    void tick;
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) return 'expired';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
  });

  onMount(() => {
    const iv = setInterval(() => tick++, 1000);
    return () => clearInterval(iv);
  });

  // Season is live-only
  $effect(() => {
    if (selectedMode === 'season' && pace !== 'live') pace = 'live';
  });

  const modes = [
    {
      id: 'season' as const,
      name: 'Season Run',
      desc: '10 rounds · 30 teams · 82 games',
      detail: 'Full league, private locks, hash-verified.',
      icon: Trophy,
      disabled: false,
    },
    {
      id: 'classic' as const,
      name: 'Classic',
      desc: '5 rounds · same pool · 82-0',
      detail: 'Franchise + era, one reroll each.',
      icon: Swords,
      disabled: true,
    },
    {
      id: 'sandbox' as const,
      name: 'Sandbox',
      desc: 'Any 5 peak seasons',
      detail: 'Best-of-2, fast.',
      icon: Zap,
      disabled: true,
    },
  ] as const;

  function getCoordinator() {
    const useSupabase = isSupabaseConfigured();
    const transport = useSupabase
      ? createSupabaseSeasonTransport({
          url:
            (import.meta as unknown as { env: Record<string, string> }).env.VITE_SUPABASE_URL ?? '',
          publishableKey:
            (import.meta as unknown as { env: Record<string, string> }).env
              .VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
        })
      : undefined;
    return createInMemorySeasonRoomCoordinator({
      transport,
      onSnapshot: () => {},
      onCommands: () => {},
    });
  }

  async function startCreate() {
    if (selectedMode !== 'season') {
      error = 'Classic and Sandbox are coming next — Season Run is live now.';
      return;
    }
    busy = true;
    error = null;
    createdCode = null;
    createdRoomId = null;
    expiresAt = null;
    try {
      const coordinator = getCoordinator();
      const snap = await coordinator.createRoom(pace, seasonRootSeed(), selectedMode);
      const c = (snap as unknown as { code?: string }).code ?? null;
      createdCode = c;
      createdRoomId = snap.roomId;
      expiresAt = (snap as unknown as { expiresAt?: string }).expiresAt ?? snap.expiresAt ?? null;
      if (!expiresAt) {
        expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
    } catch (e) {
      error = friendlyJoinError(e);
      if (!isSupabaseConfigured()) error = multiplayerDisabledMessage();
      // stay in create view so user can retry, but don't lose picker
    } finally {
      busy = false;
    }
  }

  async function doPreview() {
    if (!code || code.length !== 4) {
      error = 'Enter a 4-digit code';
      return;
    }
    busy = true;
    error = null;
    try {
      const coordinator = getCoordinator();
      const snap = await coordinator.previewRoom(code);
      const mode = (snap.settings as unknown as { mode?: string }).mode ?? 'season';
      const paceLabel =
        snap.settings.pace === 'live'
          ? 'Live — 90s draft · 5 min decisions'
          : 'Async — 24h draft · 12h decisions';
      const modeLabel =
        mode === 'season' ? 'Season Run' : mode === 'classic' ? 'Classic' : 'Sandbox';
      preview = { mode: modeLabel, pace: snap.settings.pace, detail: paceLabel };
    } catch (e) {
      error = friendlyJoinError(e);
      preview = null;
    } finally {
      busy = false;
    }
  }

  async function doJoin() {
    if (!code || code.length !== 4) {
      error = 'Enter a 4-digit code';
      return;
    }
    busy = true;
    error = null;
    try {
      const coordinator = getCoordinator();
      const { snap } = await coordinator.joinRoom(code);
      await goto(`/multiplayer/room/${snap.roomId}`);
    } catch (e) {
      error = friendlyJoinError(e);
    } finally {
      busy = false;
    }
  }

  async function copyCode() {
    if (!createdCode) return;
    try {
      await navigator.clipboard.writeText(createdCode);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {}
  }

  function goToRoom() {
    if (createdRoomId) goto(`/multiplayer/room/${createdRoomId}`);
  }

  function backToChoose() {
    // keep createdCode if we already have one, just switch view – host shouldn't lose code on "Back"
    if (createdCode && createdRoomId) {
      // if user backs from code display, stay on chooser but code still in memory; still allow re-enter
    }
    view = 'choose';
    error = null;
    preview = null;
    code = '';
  }

  function backFromCreate() {
    if (createdCode) {
      // if code already created, go to chooser but don't discard code entirely; user can still Enter lobby
      view = 'choose';
    } else {
      view = 'choose';
    }
    error = null;
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
      <p class="text-label text-primary">Multiplayer · Room lobby</p>
      <h1 class="font-display mt-2 text-4xl font-extrabold tracking-tight uppercase sm:text-5xl">
        Two humans.<br /><span class="text-primary">One league.</span>
      </h1>
      <p class="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Rooms are temporary — code, presence, and checkpoint hashes only. Simulation stays local.
      </p>
    </div>
  </div>

  {#if !isSupabaseConfigured()}
    <div class="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
      <p class="font-semibold text-amber-600">Multiplayer not configured</p>
      <p class="mt-1 text-muted-foreground">{multiplayerDisabledMessage()}</p>
    </div>
  {/if}

  {#if view === 'choose'}
    <div class="grid gap-4 sm:grid-cols-2">
      <button
        type="button"
        onclick={() => {
          view = 'create';
          error = null;
        }}
        disabled={busy}
        class="group relative flex flex-col rounded-2xl border border-line-soft bg-surface-1 p-7 text-left transition-all hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:p-8"
      >
        <div
          class="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground"
        >
          <Plus class="h-6 w-6" />
        </div>
        <h2 class="font-display mt-5 text-2xl font-extrabold tracking-tight uppercase">
          Start a room
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
          Pick Season Run and pace, then create a 4-digit code. Code lives 15 minutes, cleared after
          2 join.
        </p>
        <span class="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">
          Pick mode & create →
          <span aria-hidden="true" class="transition-transform group-hover:translate-x-0.5">→</span>
        </span>
        <div
          class="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-transparent group-hover:ring-primary/20"
        ></div>
      </button>

      <button
        type="button"
        onclick={() => {
          view = 'join';
          error = null;
        }}
        class="group flex flex-col rounded-2xl border border-line-soft bg-card p-7 text-left transition-all hover:border-line-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring sm:p-8"
      >
        <div
          class="flex h-12 w-12 items-center justify-center rounded-xl border border-line-soft bg-surface-1"
        >
          <LogIn class="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 class="font-display mt-5 text-2xl font-extrabold tracking-tight uppercase">
          Join a room
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
          Got a code? Enter the 4 digits and jump straight into the lobby.
        </p>
        <span class="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-foreground"
          >Enter code → <span
            aria-hidden="true"
            class="transition-transform group-hover:translate-x-0.5">→</span
          ></span
        >
      </button>
    </div>

    <div
      class="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground"
    >
      <span
        class="inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-3 py-1"
        ><Shield class="h-3 w-3" />Private until both lock</span
      >
      <span
        class="inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-3 py-1"
        ><Users class="h-3 w-3" />2 humans + 28 AI</span
      >
      <span
        class="inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-3 py-1"
        ><Trophy class="h-3 w-3" />One table</span
      >
    </div>

    {#if createdCode && createdRoomId}
      <div
        class="mt-6 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/10 p-6 sm:p-8"
      >
        <p class="text-label tracking-[0.16em] text-primary">Your last room code — still active</p>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <div class="flex gap-1.5">
            {#each createdCode.split('') as d, i (i)}
              <span
                class="inline-flex h-14 w-12 items-center justify-center rounded-xl border-2 border-primary/40 bg-card font-mono text-3xl font-black tracking-widest sm:h-16 sm:w-14 sm:text-4xl"
                >{d}</span
              >
            {/each}
          </div>
          <button
            type="button"
            onclick={copyCode}
            class="inline-flex items-center gap-1.5 rounded-xl bg-card px-4 py-2.5 text-sm font-semibold shadow-sm hover:bg-surface-2"
          >
            {#if copied}<Check class="h-4 w-4 text-positive" /> Copied!{:else}<Copy
                class="h-4 w-4"
              /> Copy invite{/if}
          </button>
          <button
            type="button"
            onclick={goToRoom}
            class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >Enter lobby →</button
          >
        </div>
        <p class="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock class="h-3.5 w-3.5" />
          {#if countdown && countdown !== 'expired'}expires in {countdown}{:else if countdown === 'expired'}expired
            — create a new room{:else}expires in 15 minutes{/if}
          · share this, not the room URL
        </p>
      </div>
    {/if}
  {:else if view === 'create'}
    <!-- mode picker before create -->
    {#if !createdCode}
      <div class="rounded-2xl bg-surface-1 p-6 sm:p-7">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h3 class="font-display text-sm font-extrabold tracking-widest uppercase">
              Pick your battle
            </h3>
            <p class="mt-1 text-xs text-muted-foreground">
              Host picks — opponent sees it before joining. Season Run is live now.
            </p>
          </div>
          <button
            type="button"
            onclick={backFromCreate}
            class="inline-flex items-center gap-1.5 rounded-lg border border-line-soft bg-card px-3 py-1.5 text-xs font-semibold hover:border-line-strong"
          >
            <ArrowLeft class="h-3.5 w-3.5" /> Back
          </button>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          {#each modes as m (m.id)}
            {@const Icon = m.icon}
            <button
              type="button"
              onclick={() => {
                if (!m.disabled) selectedMode = m.id;
              }}
              disabled={m.disabled}
              class="flex flex-col rounded-xl border p-4 text-left transition-all {selectedMode ===
              m.id
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-line-soft bg-card hover:border-line-strong'} {m.disabled
                ? 'opacity-50 cursor-not-allowed'
                : ''}"
            >
              <Icon
                class="h-5 w-5 {selectedMode === m.id ? 'text-primary' : 'text-muted-foreground'}"
              />
              <p class="font-display mt-3 text-sm font-extrabold tracking-tight uppercase">
                {m.name}
                {#if m.disabled}<span
                    class="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tracking-widest"
                    >Soon</span
                  >{/if}
              </p>
              <p class="mt-1 text-xs font-medium text-muted-foreground">{m.desc}</p>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground/70">{m.detail}</p>
              {#if selectedMode === m.id && !m.disabled}<span
                  class="mt-3 inline-flex rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest text-primary-foreground uppercase"
                  >Selected</span
                >{/if}
            </button>
          {/each}
        </div>

        {#if selectedMode === 'season'}
          <div class="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div class="flex items-center gap-2">
              <Clock class="h-4 w-4 text-primary" />
              <p class="text-sm font-bold">Live — 90s draft · 5m decisions</p>
            </div>
            <p class="mt-1 text-xs text-muted-foreground">
              Season Run is live-only. Async (24h) coming later.
            </p>
          </div>
        {:else}
          <p
            class="mt-4 rounded-lg border border-dashed border-line-soft bg-card/50 p-3 text-xs text-muted-foreground"
          >
            {#if selectedMode === 'classic'}Classic: 5 rounds, same pool — no pace timer. First to
              82-0 wins.
            {:else}Sandbox: any 5 peak seasons — best-of-2, no season clock.{/if}
          </p>
        {/if}

        <button
          type="button"
          onclick={startCreate}
          disabled={busy || selectedMode !== 'season'}
          class="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Creating…' : 'Create room →'}
        </button>
        {#if error}
          <p
            role="alert"
            class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            {error}
          </p>
        {/if}
        <p class="mt-2 text-center text-xs text-muted-foreground">
          You’ll get a 4-digit code to share. It’s not in the URL.
        </p>
      </div>
    {:else}
      <!-- code on top after creation -->
      <div class="rounded-2xl border-2 border-dashed border-primary/40 bg-primary/10 p-6 sm:p-8">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-label tracking-[0.16em] text-primary">Room code — share it</p>
            <div class="mt-3 flex flex-wrap items-center gap-3">
              <div class="flex gap-1.5">
                {#each createdCode.split('') as d, i (i)}
                  <span
                    class="inline-flex h-14 w-12 items-center justify-center rounded-xl border-2 border-primary/40 bg-card font-mono text-3xl font-black tracking-widest sm:h-16 sm:w-14 sm:text-4xl"
                    >{d}</span
                  >
                {/each}
              </div>
              <button
                type="button"
                onclick={copyCode}
                class="inline-flex items-center gap-1.5 rounded-xl bg-card px-4 py-2.5 text-sm font-semibold shadow-sm hover:bg-surface-2"
              >
                {#if copied}<Check class="h-4 w-4 text-positive" /> Copied!{:else}<Copy
                    class="h-4 w-4"
                  /> Copy invite{/if}
              </button>
            </div>
            <p class="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock class="h-3.5 w-3.5" />
              {#if countdown && countdown !== 'expired'}expires in {countdown}{:else if countdown === 'expired'}expired
                — create a new room{:else}expires in 15 minutes{/if}
              · cleared after 2nd player joins · never in URL
            </p>
          </div>
          <button
            type="button"
            onclick={backFromCreate}
            class="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-background px-3 py-1.5 text-xs font-semibold hover:bg-card"
          >
            <ArrowLeft class="h-3.5 w-3.5" /> Back
          </button>
        </div>
        {#if error}
          <p
            role="alert"
            class="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            {error}
          </p>
        {/if}
      </div>

      <div class="mt-6 rounded-2xl bg-surface-1 p-6 sm:p-7">
        <h3 class="font-display text-sm font-extrabold tracking-widest uppercase">
          Mode locked: Season Run
        </h3>
        <p class="mt-1 text-xs text-muted-foreground">
          Host chose Season Run · Live — guests see this before joining.
        </p>
        <button
          type="button"
          onclick={goToRoom}
          class="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90"
        >
          Enter lobby →
        </button>
        <p class="mt-2 text-center text-xs text-muted-foreground">
          Code stays visible in lobby. Share it now — opponent can join while you enter.
        </p>
      </div>
    {/if}
  {:else if view === 'join'}
    <div class="mx-auto max-w-md rounded-2xl bg-surface-1 p-6 sm:p-8">
      <button
        type="button"
        onclick={backToChoose}
        class="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft class="h-3.5 w-3.5" /> Back to choose
      </button>
      <div class="mt-4 flex items-center gap-3">
        <div
          class="flex h-10 w-10 items-center justify-center rounded-xl bg-card border border-line-soft"
        >
          <LogIn class="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <h2 class="font-display text-lg font-extrabold tracking-tight uppercase">Join a room</h2>
          <p class="text-xs text-muted-foreground">Enter the 4-digit code from your host.</p>
        </div>
      </div>

      <label for="join-code" class="text-label mt-6 mb-2 block text-muted-foreground"
        >Room code</label
      >
      <button
        type="button"
        onclick={() => document.getElementById('join-code')?.focus()}
        class="flex w-full justify-center gap-2 focus:outline-none"
        aria-label="Enter room code"
      >
        {#each Array(4) as _, i (i)}
          <span
            class="inline-flex h-14 w-14 items-center justify-center rounded-xl border-2 bg-card font-mono text-2xl font-black {code[
              i
            ]
              ? 'border-primary bg-primary/10'
              : 'border-line-soft'}"
          >
            {code[i] ?? ''}
          </span>
        {/each}
      </button>
      <input
        id="join-code"
        type="text"
        inputmode="numeric"
        maxlength={4}
        placeholder="0000"
        bind:value={code}
        class="mt-3 w-full rounded-xl border-2 border-line-soft bg-card px-4 py-3 text-center font-mono text-lg font-bold tracking-[0.5em] placeholder:text-muted-foreground/30 focus:border-primary focus:outline-none"
      />

      <div class="mt-3 flex gap-2">
        <button
          type="button"
          onclick={doPreview}
          disabled={busy || code.length !== 4}
          class="flex-1 rounded-xl border border-line-soft bg-card px-4 py-2.5 text-sm font-semibold hover:border-line-strong disabled:opacity-40"
          >Preview</button
        >
        <button
          type="button"
          onclick={doJoin}
          disabled={busy || code.length !== 4}
          class="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Joining…' : 'Join →'}
        </button>
      </div>

      {#if preview}
        <div class="mt-3 rounded-xl border border-positive/30 bg-positive/10 p-3 text-xs">
          <p class="font-semibold text-positive">
            {preview.mode} · {preview.pace === 'live' ? 'Live' : 'Async'}
          </p>
          <p class="mt-1 text-muted-foreground">{preview.detail} · 2 humans + 28 AI · one table</p>
          <p class="mt-1 text-muted-foreground">You’ll join as the Guest. Host is already in.</p>
        </div>
      {/if}
      {#if error}
        <p
          role="alert"
          class="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {error}
        </p>
      {/if}

      <p class="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
        Codes include leading zeros (<code class="font-mono">0042</code>) and expire in 15 minutes.
      </p>
    </div>
  {/if}
</section>
