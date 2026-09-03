<script lang="ts">import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { Users, Swords, Trophy, Clock, Zap, ArrowLeft, Copy, Check, LogIn, Plus, Link as LinkIcon, } from '@lucide/svelte';
import { createInMemorySeasonRoomCoordinator } from '$lib/season/season-room-coordinator';
import { createSupabaseSeasonTransport, isSupabaseConfigured } from '$lib/season/supabase-season-transport';
import { seasonRootSeed } from '$lib/season/season-ids';
import { friendlyJoinError, inviteLinkForCode } from '$lib/season/season-room-identity';
type Mode = 'season' | 'classic' | 'sandbox';
type Pace = 'live' | 'async';
type View = 'choose' | 'create' | 'join';
let view = $state<View>('choose');
let selectedMode = $state<Mode>('classic');
let pace = $state<Pace>('live');
let code = $state('');
let busy = $state(false);
let error = $state<string | null>(null);
let preview = $state<{
    mode: string;
    pace: string;
    detail: string;
} | null>(null);
let createdCode = $state<string | null>(null);
let createdRoomId = $state<string | null>(null);
let expiresAt = $state<string | null>(null);
let copiedInvite = $state(false);
let copiedCode = $state(false);
let tick = $state(0);
let countdown = $derived.by(() => {
    if (!expiresAt)
        return null;
    void tick;
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0)
        return 'expired';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${String(s).padStart(2, '0')}`;
});
onMount(() => {
    const iv = setInterval(() => tick++, 1000);
    try {
        const params = new URLSearchParams(window.location.search);
        const codeParam = params.get('code');
        if (codeParam && /^[0-9]{4}$/.test(codeParam)) {
            code = codeParam;
            view = 'join';
            void doPreview();
        }
    }
    catch { }
    return () => clearInterval(iv);
});
const modes = [
    {
        id: 'season' as const,
        name: 'Season Run — Solo only',
        desc: 'Solo only — available at /season',
        detail: 'Season Run is solo-only for now.',
        icon: Trophy,
        disabled: true,
    },
    {
        id: 'classic' as const,
        name: 'Classic',
        desc: '5 rounds · franchise era · 82-0 — head-to-head or vs AI',
        detail: 'Shared 82 or Duel. Picks use Classic roll draft, same pool per player.',
        icon: Swords,
        disabled: false,
    },
    {
        id: 'sandbox' as const,
        name: 'Sandbox',
        desc: 'Any 5 peak seasons — free pick, head-to-head or vs AI',
        detail: 'Shared 82 or Duel. Draft any 5 peaks, no rolls.',
        icon: Zap,
        disabled: false,
    },
] as const;
const paceOptions: {
    id: Pace;
    label: string;
    detail: string;
}[] = [
    { id: 'live', label: 'Live', detail: '90s draft · 5m decisions' },
    { id: 'async', label: 'Async', detail: '24h draft · 12h decisions' },
];
function getCoordinator() {
    const useSupabase = isSupabaseConfigured();
    const transport = useSupabase
        ? createSupabaseSeasonTransport({
            url: (import.meta as unknown as {
                env: Record<string, string>;
            }).env.VITE_SUPABASE_URL ?? '',
            publishableKey: (import.meta as unknown as {
                env: Record<string, string>;
            }).env
                .VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
        })
        : undefined;
    return createInMemorySeasonRoomCoordinator({
        transport,
        onSnapshot: () => { },
        onCommands: () => { },
    });
}
async function startCreate() {
    if (selectedMode === 'season') {
        error = 'Season Run is solo-only. Choose Classic or Sandbox.';
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
        const c = (snap as unknown as {
            code?: string;
        }).code ?? null;
        createdCode = c;
        createdRoomId = snap.roomId;
        expiresAt = (snap as unknown as {
            expiresAt?: string;
        }).expiresAt ?? snap.expiresAt ?? null;
        if (!expiresAt) {
            expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        }
    }
    catch (e) {
        error = friendlyJoinError(e);
        if (!isSupabaseConfigured())
            error = 'Multiplayer is offline right now. You can still play solo Classic/Sandbox.';
    }
    finally {
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
        const mode = (snap.settings as unknown as {
            mode?: string;
        }).mode ?? 'season';
        const paceLabel = snap.settings.pace === 'live'
            ? 'Live — 90s draft · 5 min decisions'
            : 'Async — 24h draft · 12h decisions';
        const modeLabel = mode === 'season' ? 'Season Run' : mode === 'classic' ? 'Classic' : 'Sandbox';
        preview = { mode: modeLabel, pace: snap.settings.pace, detail: paceLabel };
    }
    catch (e) {
        error = friendlyJoinError(e);
        preview = null;
    }
    finally {
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
        await goto(resolve('/multiplayer/room/[roomId]', { roomId: snap.roomId }));
    }
    catch (e) {
        error = friendlyJoinError(e);
    }
    finally {
        busy = false;
    }
}
async function copyInviteLink() {
    const toCopy = createdCode ? inviteLinkForCode(createdCode) : null;
    if (!toCopy)
        return;
    try {
        await navigator.clipboard.writeText(toCopy);
        copiedInvite = true;
        setTimeout(() => (copiedInvite = false), 1500);
    }
    catch { }
}
async function copyCode() {
    if (!createdCode)
        return;
    try {
        await navigator.clipboard.writeText(createdCode);
        copiedCode = true;
        setTimeout(() => (copiedCode = false), 1500);
    }
    catch { }
}
function goToRoom() {
    if (createdRoomId)
        goto(resolve('/multiplayer/room/[roomId]', { roomId: createdRoomId }));
}
function backToChoose() {
    view = 'choose';
    error = null;
    preview = null;
    if (!new URLSearchParams(window.location.search).get('code'))
        code = '';
}
function backFromCreate() {
    view = 'choose';
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
      <div class="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <p class="font-semibold text-foreground">
          Multiplayer: Classic & Sandbox. Season Run is solo at <a
            href={resolve('/season')}
            class="underline">/season</a
          >.
        </p>
      </div>
    </div>
  </div>

  {#if !isSupabaseConfigured()}
    <div class="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
      <p class="font-semibold text-amber-600">Multiplayer not configured</p>
      <p class="mt-1 text-muted-foreground">
        Multiplayer is offline right now. You can still play solo Classic/Sandbox.
      </p>
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
          Pick mode and pace, then create a 4-digit code. Code stays visible until opponent joins.
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
          Got a code? Enter the 4 digits or open an invite link (/multiplayer?code=0042).
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
        ><Users class="h-3 w-3" />2 players</span
      >
    </div>
  {:else if view === 'create'}
    {#if !createdCode}
      <div class="rounded-2xl bg-surface-1 p-6 sm:p-7">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h3 class="font-display text-sm font-extrabold tracking-widest uppercase">
              Pick your battle
            </h3>
            <p class="mt-1 text-xs text-muted-foreground">
              Host picks mode and pace — opponent sees both before joining. Pace applies to all
              modes.
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
              disabled={m.disabled}
              title={m.disabled
                ? m.id === 'season'
                  ? 'Season Run is solo-only — play at /season'
                  : 'Unavailable'
                : undefined}
              onclick={() => {
                if (!m.disabled) selectedMode = m.id;
              }}
              class="flex flex-col rounded-xl border p-4 text-left transition-all {m.disabled
                ? 'opacity-50 cursor-not-allowed border-line-soft bg-card'
                : selectedMode === m.id
                  ? 'border-primary bg-primary/10 ring-1 ring-primary'
                  : 'border-line-soft bg-card hover:border-line-strong'}"
            >
              <Icon
                class="h-5 w-5 {selectedMode === m.id ? 'text-primary' : 'text-muted-foreground'}"
              />
              <p class="font-display mt-3 text-sm font-extrabold tracking-tight uppercase">
                {m.name}
              </p>
              <p class="mt-1 text-xs font-medium text-muted-foreground">{m.desc}</p>
              <p class="mt-1 text-xs leading-relaxed text-muted-foreground/70">{m.detail}</p>
              {#if selectedMode === m.id}<span
                  class="mt-3 inline-flex rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest text-primary-foreground uppercase"
                  >Selected</span
                >{/if}
            </button>
          {/each}
        </div>

        <div class="mt-5">
          <p class="text-label tracking-[0.12em] text-muted-foreground">Pace</p>
          <div class="mt-2 grid gap-2 sm:grid-cols-2">
            {#each paceOptions as p (p.id)}
              <button
                type="button"
                onclick={() => (pace = p.id)}
                class="flex items-center justify-between rounded-xl border p-4 text-left {pace ===
                p.id
                  ? 'border-primary bg-primary/10 ring-1 ring-primary'
                  : 'border-line-soft bg-card hover:border-line-strong'}"
              >
                <div>
                  <p class="text-sm font-bold">{p.label}</p>
                  <p class="text-xs text-muted-foreground">{p.detail}</p>
                </div>
                {#if pace === p.id}<span
                    class="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground"
                    >Selected</span
                  >{/if}
              </button>
            {/each}
          </div>
        </div>

        <button
          type="button"
          onclick={startCreate}
          disabled={busy}
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
          You’ll get a 4-digit code + invite link to share. Code stays visible in lobby.
        </p>
      </div>
    {:else}
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
                onclick={copyInviteLink}
                class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                {#if copiedInvite}<Check class="h-4 w-4" /> Copied link!{:else}<LinkIcon
                    class="h-4 w-4"
                  /> Copy invite link{/if}
              </button>
              <button
                type="button"
                onclick={copyCode}
                class="inline-flex items-center gap-1.5 rounded-xl bg-card px-4 py-2.5 text-sm font-semibold shadow-sm hover:bg-surface-2"
              >
                {#if copiedCode}<Check class="h-4 w-4 text-positive" /> Copied!{:else}<Copy
                    class="h-4 w-4"
                  /> Copy code{/if}
              </button>
            </div>
            <p class="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock class="h-3.5 w-3.5" />
              {#if countdown && countdown !== 'expired'}expires in {countdown}{:else if countdown === 'expired'}expired
                — create a new room{:else}expires in 15 minutes{/if}
              · Codes expire in 15 min. Invite link fills it automatically.
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
          Mode locked: {selectedMode === 'season'
            ? 'Season Run'
            : selectedMode === 'classic'
              ? 'Classic'
              : 'Sandbox'} · {pace === 'live' ? 'Live' : 'Async'}
        </h3>
        <p class="mt-1 text-xs text-muted-foreground">
          Host chose {selectedMode} · {pace} — guests see this before joining.
        </p>
        <button
          type="button"
          onclick={goToRoom}
          class="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground hover:opacity-90"
        >
          Enter lobby →
        </button>
        <p class="mt-2 text-center text-xs text-muted-foreground">
          Code stays visible in lobby. Share invite link now — opponent can join while you enter.
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
          <p class="text-xs text-muted-foreground">Enter the 4-digit code or open invite link.</p>
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
        Codes expire in 15 min. Invite link fills it automatically.
      </p>
    </div>
  {/if}
</section>
