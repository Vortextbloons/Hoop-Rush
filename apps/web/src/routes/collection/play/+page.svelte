<script lang="ts">
  import { resolve } from '$app/paths';
  import '$lib/collection/ultimate-theme.css';
  import { onDestroy } from 'svelte';
  import type {
    CollectionCatalog,
    CollectionCatalogCard,
    CollectionGameRecord,
    CollectionPlayState,
    CollectionState,
  } from '@hoop-rush/data-contracts';
  import AsyncState from '$lib/components/AsyncState.svelte';
  import CollectionNav from '$lib/collection/CollectionNav.svelte';
  import { loadCollectionCatalog } from '$lib/collection/collection-assets.ts';
  import {
    abandonBasicGame,
    acceptBasicGameResult,
    collectionGameWorkerAssets,
    ensureCollection,
    ensurePlayState,
    loadCommittedGame,
    prepareBasicGame,
  } from '$lib/collection/collection-hub.ts';
  import { runCollectionGame } from '$lib/collection/collection-game-runner.ts';
  import {
    cadenceFor,
    eventLabel,
    explanationFacts,
    visibleEvents,
    type WatchMode,
  } from '$lib/collection/collection-gamecast.ts';

  let mounted = true;
  onDestroy(() => {
    mounted = false;
    stopPlayback();
  });

  let phase = $state<'loading' | 'error' | 'ready'>('loading');
  let error = $state<string | null>(null);
  let catalog = $state<CollectionCatalog | null>(null);
  let collectionState = $state<CollectionState | null>(null);
  let playState = $state<CollectionPlayState | null>(null);
  let busy = $state<'idle' | 'preparing' | 'playing' | 'committing'>('idle');
  let flowError = $state<string | null>(null);
  let record = $state<CollectionGameRecord | null>(null);
  let announcement = $state('');

  let watchMode = $state<WatchMode>('standard');
  let cursor = $state(0);
  let playing = $state(false);
  let playbackTimer: ReturnType<typeof setTimeout> | null = null;

  const byId = $derived(
    new Map((catalog?.cards ?? []).map((card) => [card.cardId, card] as const)),
  );
  const nameOf = (cardId: string): string => byId.get(cardId)?.displayName ?? 'Unknown card';
  const overallOf = (card: CollectionCatalogCard | undefined): number =>
    card?.summarySource?.overallRating ?? 60;

  const pending = $derived(playState?.pendingGame ?? null);
  const shownEvents = $derived(record ? visibleEvents(record.events, watchMode) : []);
  const facts = $derived(record ? explanationFacts(record, record.events) : null);
  const claimed = $derived(collectionState?.claimedWelcome ?? false);
  const hasTeam = $derived(playState !== null);
  const balances = $derived(collectionState?.balances ?? { Coins: 0, Exchange: 0 });

  function stopPlayback(): void {
    playing = false;
    if (playbackTimer !== null) {
      clearTimeout(playbackTimer);
      playbackTimer = null;
    }
  }

  function scheduleTick(): void {
    if (playbackTimer !== null) {
      clearTimeout(playbackTimer);
      playbackTimer = null;
    }
    const cadence = cadenceFor(watchMode);
    if (cadence === null || !playing) return;
    playbackTimer = setTimeout(() => {
      if (!mounted) return;
      if (cursor < shownEvents.length - 1) {
        cursor += 1;
        scheduleTick();
      } else {
        playing = false;
      }
    }, cadence);
  }

  function setMode(mode: WatchMode): void {
    stopPlayback();
    watchMode = mode;
    cursor = 0;
  }

  function togglePlayback(): void {
    if (shownEvents.length === 0) return;
    if (playing) {
      stopPlayback();
      return;
    }
    if (cursor >= shownEvents.length - 1) cursor = 0;
    playing = true;
    scheduleTick();
  }

  function stepOnce(): void {
    if (playing || shownEvents.length === 0) return;
    cursor = Math.min(cursor + 1, shownEvents.length - 1);
  }

  function skipToFinal(): void {
    stopPlayback();
    cursor = Math.max(0, shownEvents.length - 1);
  }

  async function load(): Promise<void> {
    try {
      const [loadedCatalog, loadedState] = await Promise.all([
        loadCollectionCatalog(),
        ensureCollection(new Date().toISOString()),
      ]);
      if (!mounted) return;
      catalog = loadedCatalog;
      collectionState = loadedState;
      if (loadedState.claimedWelcome) {
        const play = await ensurePlayState(new Date().toISOString());
        if (!mounted) return;
        playState = play;
        await restoreLastGame();
      }
      phase = 'ready';
    } catch (loadError) {
      if (!mounted) return;
      error = loadError instanceof Error ? loadError.message : 'Could not load play.';
      phase = 'error';
    }
  }

  async function restoreLastGame(): Promise<void> {
    try {
      const gameId = sessionStorage.getItem('collection-last-game');
      if (!gameId || playState?.pendingGame) return;
      const committed = await loadCommittedGame(gameId);
      if (!mounted || !committed) return;
      record = committed;
      cursor = 0;
    } catch {
      // No restored game simply means nothing to resume watching.
    }
  }

  $effect(() => {
    void load();
  });

  async function refreshState(): Promise<void> {
    const [loadedState, play] = await Promise.all([
      ensureCollection(new Date().toISOString()),
      ensurePlayState(new Date().toISOString()),
    ]);
    if (!mounted) return;
    collectionState = loadedState;
    playState = play;
  }

  async function prepare(): Promise<void> {
    if (busy !== 'idle') return;
    busy = 'preparing';
    flowError = null;
    try {
      const outcome = await prepareBasicGame(new Date().toISOString());
      if (!mounted) return;
      playState = outcome.playState;
      announcement = 'Matchup ready. Your team faces the CPU team.';
    } catch (prepareError) {
      if (!mounted) return;
      flowError = prepareError instanceof Error ? prepareError.message : 'Preparing failed.';
    } finally {
      if (mounted) busy = 'idle';
    }
  }

  async function abandon(): Promise<void> {
    if (busy !== 'idle') return;
    busy = 'preparing';
    flowError = null;
    try {
      const next = await abandonBasicGame(new Date().toISOString());
      if (!mounted) return;
      playState = next;
      record = null;
      announcement = 'Matchup abandoned. Prepare a new game when ready.';
    } catch (abandonError) {
      if (!mounted) return;
      flowError = abandonError instanceof Error ? abandonError.message : 'Abandoning failed.';
    } finally {
      if (mounted) busy = 'idle';
    }
  }

  async function play(): Promise<void> {
    const matchup = pending;
    if (busy !== 'idle' || !matchup) return;
    busy = 'playing';
    flowError = null;
    stopPlayback();
    try {
      const assets = await collectionGameWorkerAssets();
      const completed = await runCollectionGame({
        prepared: matchup,
        catalogUrl: assets.catalogUrl,
        catalogHash: assets.catalogHash,
        profileUrl: assets.profileUrl,
        profileHash: assets.profileHash,
      });
      if (!mounted) return;
      busy = 'committing';
      const completedAtIso = new Date().toISOString();
      try {
        const accepted = await acceptBasicGameResult({
          result: completed.result,
          events: completed.events,
          completedAtIso,
          recordedAtIso: new Date().toISOString(),
        });
        if (!mounted) return;
        playState = accepted.playState;
        collectionState = { ...(collectionState as CollectionState), balances: accepted.balances };
        record = accepted.record;
      } catch (acceptError) {
        const recovered = await loadCommittedGame(matchup.gameId).catch(() => null);
        if (!mounted) return;
        if (recovered) {
          await refreshState().catch(() => undefined);
          if (!mounted) return;
          record = recovered;
        } else {
          throw acceptError;
        }
      }
      if (!mounted) return;
      try {
        sessionStorage.setItem('collection-last-game', matchup.gameId);
      } catch {
        // Receipt restore is best-effort.
      }
      cursor = 0;
      playing = false;
      const won = record?.result.winner === 'home';
      announcement = won ? 'You won. 100 Coins.' : 'You lost. 10 Coins.';
      busy = 'idle';
    } catch (playError) {
      if (!mounted) return;
      flowError = playError instanceof Error ? playError.message : 'The game failed. Try again.';
      await refreshState().catch(() => undefined);
      if (mounted) busy = 'idle';
    }
  }

  const pendingPlayerStarters = $derived(
    pending?.playerTeam.starters.map((cardId) => byId.get(cardId) ?? null) ?? [],
  );
  const pendingCpuStarters = $derived(
    pending?.cpuTeam.starters.map((cardId) => byId.get(cardId) ?? null) ?? [],
  );
</script>

<svelte:head>
  <title>Play · Hoop Rush</title>
</svelte:head>

<div class="ultimate-root mx-auto w-full max-w-6xl px-3 py-6 sm:px-6">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <p class="ultimate-eyebrow">Ultimate Run</p>
      <h1 class="font-display text-3xl font-extrabold tracking-tight">Play</h1>
      <p class="text-sm text-muted-foreground">
        One game at a time. Win 100 Coins · Loss 10 Coins.
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span><strong class="tabular-nums">{balances.Coins}</strong> Coins</span>
      <CollectionNav current="play" />
    </div>
  </div>

  <p class="sr-only" role="status">{announcement}</p>

  {#if phase === 'loading'}
    <div class="mt-6">
      <AsyncState kind="loading" title="Loading" message="Loading play…" />
    </div>
  {:else if phase === 'error'}
    <div class="mt-6">
      <AsyncState
        kind="error"
        title="Couldn't load"
        message={error ?? 'Unknown error.'}
        retry={() => {
          phase = 'loading';
          void load();
        }}
      />
    </div>
  {:else if !claimed}
    <div class="mt-6">
      <AsyncState
        kind="empty"
        title="Starter first"
        message="Claim the free starter in the collection book before playing."
      />
    </div>
    <a
      href={resolve('/collection')}
      class="mt-3 inline-block min-h-[44px] rounded-xl bg-accent px-5 py-2.5 font-bold text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Go to collection
    </a>
  {:else if !hasTeam}
    <div class="mt-6">
      <AsyncState
        kind="empty"
        title="No team yet"
        message="Build and save a team before playing."
      />
    </div>
    <a
      href={resolve('/collection/team')}
      class="mt-3 inline-block min-h-[44px] rounded-xl bg-accent px-5 py-2.5 font-bold text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Build team
    </a>
  {:else}
    <section
      aria-label="Game rules"
      class="mt-4 rounded-2xl border border-border bg-card p-5 text-sm"
    >
      <h2 class="font-display text-lg font-extrabold">Basic game</h2>
      <ul class="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
        <li>Your saved team against a generated 12-card CPU team.</li>
        <li>2020s simulation profile, neutral home court.</li>
        <li>Reward: <strong>Win 100 Coins · Loss 10 Coins</strong>.</li>
      </ul>
    </section>

    {#if flowError}
      <p
        role="alert"
        class="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
      >
        {flowError}
      </p>
    {/if}

    {#if pending && !record}
      <section aria-label="Matchup" class="mt-4 rounded-2xl border border-accent/50 bg-card p-5">
        <h2 class="font-display text-xl font-extrabold">Matchup ready</h2>
        <div class="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <h3 class="font-bold">Your starters</h3>
            <ul class="mt-2 space-y-1 text-sm">
              {#each pendingPlayerStarters as card, index (index)}
                <li class="tabular-nums">
                  {card ? `${card.displayName} · Overall ${overallOf(card)}` : 'Unknown card'}
                </li>
              {/each}
            </ul>
          </div>
          <div>
            <h3 class="font-bold">CPU starters</h3>
            <ul class="mt-2 space-y-1 text-sm">
              {#each pendingCpuStarters as card, index (index)}
                <li class="tabular-nums">
                  {card ? `${card.displayName} · Overall ${overallOf(card)}` : 'Unknown card'}
                </li>
              {/each}
            </ul>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onclick={play}
            disabled={busy !== 'idle'}
            class="min-h-[44px] rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {busy === 'playing' ? 'Playing…' : busy === 'committing' ? 'Committing…' : 'Start game'}
          </button>
          <button
            type="button"
            onclick={abandon}
            disabled={busy !== 'idle'}
            class="min-h-[44px] rounded-xl bg-surface-2 px-5 py-2.5 text-sm font-bold outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Abandon matchup
          </button>
        </div>
        {#if busy === 'playing'}
          <p class="mt-3 text-sm text-muted-foreground" aria-live="polite">
            Simulating in the background. The result commits before it is shown.
          </p>
        {/if}
      </section>
    {:else if !record}
      <div class="mt-4">
        <button
          type="button"
          onclick={prepare}
          disabled={busy !== 'idle'}
          class="min-h-[44px] rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {busy === 'preparing' ? 'Preparing…' : 'Prepare game'}
        </button>
      </div>
    {/if}

    {#if record && facts}
      <section aria-label="Result" class="mt-4 rounded-2xl border border-border bg-card p-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="font-display text-2xl font-extrabold tabular-nums">
              You {facts.homeScore} · CPU {facts.awayScore}
            </h2>
            <p class="text-sm text-muted-foreground">
              {facts.winner === 'home' ? 'You won' : 'CPU won'}{facts.overtimePeriods > 0
                ? ` · ${facts.overtimePeriods} overtime${facts.overtimePeriods === 1 ? '' : 's'}`
                : ''} · +{facts.rewardCoins} Coins
            </p>
          </div>
          <div class="flex flex-wrap gap-2" role="group" aria-label="Watch mode">
            {#each [{ id: 'fast', label: 'Fast' }, { id: 'standard', label: 'Standard' }, { id: 'slow', label: 'Slow' }] as mode (mode.id)}
              <button
                type="button"
                onclick={() => setMode(mode.id as WatchMode)}
                aria-pressed={watchMode === mode.id}
                class="min-h-[44px] rounded-xl px-4 py-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring {watchMode ===
                mode.id
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-surface-2'}"
              >
                {mode.label}
              </button>
            {/each}
          </div>
        </div>

        {#if watchMode !== 'fast'}
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onclick={togglePlayback}
              class="min-h-[44px] rounded-xl bg-surface-2 px-4 py-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              onclick={stepOnce}
              disabled={playing}
              class="min-h-[44px] rounded-xl bg-surface-2 px-4 py-2 text-sm font-bold outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
            >
              Step
            </button>
            <button
              type="button"
              onclick={skipToFinal}
              class="min-h-[44px] rounded-xl bg-surface-2 px-4 py-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Skip to final
            </button>
            <span class="text-sm tabular-nums text-muted-foreground" aria-live="off">
              {Math.min(cursor + 1, shownEvents.length)} / {shownEvents.length}
              {watchMode === 'standard' ? '· 250 ms per event' : '· 650 ms per event'}
            </span>
          </div>
          <ol class="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1 text-sm" aria-label="Gamecast">
            {#each shownEvents.slice(0, cursor + 1) as event (event.eventOrder)}
              <li class="rounded-lg bg-surface-2 px-3 py-2 tabular-nums">{eventLabel(event)}</li>
            {/each}
          </ol>
        {/if}

        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <div class="rounded-xl bg-surface-2 p-4 text-sm">
            <h3 class="font-bold">Game facts</h3>
            <ul class="mt-2 space-y-1 tabular-nums text-muted-foreground">
              <li>
                Top scorer (you): {facts.topHome
                  ? `${nameOf(facts.topHome.cardId)} · ${facts.topHome.points}`
                  : '—'}
              </li>
              <li>
                Top scorer (CPU): {facts.topAway
                  ? `${nameOf(facts.topAway.cardId)} · ${facts.topAway.points}`
                  : '—'}
              </li>
              <li>Lead changes: {facts.leadChanges}</li>
              <li>
                Biggest lead: {facts.biggestLead.side === 'tied'
                  ? 'none'
                  : `${facts.biggestLead.side === 'home' ? 'You' : 'CPU'} by ${facts.biggestLead.points}`}
              </li>
              {#if facts.exceptions > 0}
                <li>Short-handed foul exceptions: {facts.exceptions}</li>
              {/if}
            </ul>
          </div>
          <div class="rounded-xl bg-surface-2 p-4 text-sm">
            <h3 class="font-bold">Reward receipt</h3>
            <p class="mt-2 tabular-nums text-muted-foreground">
              +{facts.rewardCoins} Coins ({facts.rewardReason === 'game-win-reward'
                ? 'win'
                : 'loss'}) · balances now {balances.Coins} Coins.
            </p>
          </div>
        </div>

        {#if record.result.outcome === 'completed'}
          {@const completed = record.result}
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            {#each [{ side: completed.home, label: 'Your box score' }, { side: completed.away, label: 'CPU box score' }] as box (box.label)}
              <div class="overflow-x-auto rounded-xl bg-surface-2 p-4">
                <h3 class="text-sm font-bold">{box.label} · {box.side.score}</h3>
                <table class="mt-2 w-full text-left text-xs tabular-nums">
                  <thead>
                    <tr class="text-muted-foreground">
                      <th scope="col" class="pr-2">Player</th>
                      <th scope="col" class="pr-2">Min</th>
                      <th scope="col" class="pr-2">Pts</th>
                      <th scope="col" class="pr-2">Reb</th>
                      <th scope="col" class="pr-2">Ast</th>
                      <th scope="col" class="pr-2">TO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each box.side.players as player (player.cardId)}
                      <tr>
                        <th scope="row" class="pr-2 font-semibold">{nameOf(player.cardId)}</th>
                        <td class="pr-2">{player.minutes.toFixed(1)}</td>
                        <td class="pr-2">{player.points}</td>
                        <td class="pr-2">{player.rebounds.total}</td>
                        <td class="pr-2">{player.assists}</td>
                        <td class="pr-2">{player.turnovers}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/each}
          </div>
        {/if}

        {#if !pending}
          <div class="mt-4">
            <button
              type="button"
              onclick={prepare}
              disabled={busy !== 'idle'}
              class="min-h-[44px] rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {busy === 'preparing' ? 'Preparing…' : 'Play again'}
            </button>
          </div>
        {/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  @media (prefers-reduced-motion: reduce) {
    .ultimate-root :global(*) {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
