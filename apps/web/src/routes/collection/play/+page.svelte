<script lang="ts">
  import { resolve } from '$app/paths';
  import '$lib/collection/ultimate-theme.css';
  import { onDestroy } from 'svelte';
  import type {
    CollectionCatalog,
    CollectionCatalogCard,
    CollectionDifficultyId,
    CollectionGameRecordUnion,
    CollectionGameRules,
    CollectionObjectiveId,
    CollectionPlayState,
    CollectionState,
  } from '@hoop-rush/data-contracts';
  import AsyncState from '$lib/components/AsyncState.svelte';
  import CollectionNav from '$lib/collection/CollectionNav.svelte';
  import DifficultyPicker from '$lib/collection/DifficultyPicker.svelte';
  import MatchupReport from '$lib/collection/MatchupReport.svelte';
  import ObjectivePicker from '$lib/collection/ObjectivePicker.svelte';
  import RewardReceipt from '$lib/collection/RewardReceipt.svelte';
  import {
    loadCollectionCatalog,
    loadCollectionGameRules,
  } from '$lib/collection/collection-assets.ts';
  import {
    abandonBasicGame,
    acceptBasicGameResult,
    collectionGameWorkerAssets,
    collectionObjectiveOffers,
    ensureCollection,
    ensurePlayStateSnapshot,
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
  import {
    difficultyOptionViews,
    objectiveOptionViews,
    rewardPreview,
  } from '$lib/collection/collection-setup.ts';

  let mounted = true;
  onDestroy(() => {
    mounted = false;
    stopPlayback();
  });

  let phase = $state<'loading' | 'error' | 'ready'>('loading');
  let error = $state<string | null>(null);
  let catalog = $state<CollectionCatalog | null>(null);
  let rules = $state<CollectionGameRules | null>(null);
  let collectionState = $state<CollectionState | null>(null);
  let playState = $state<CollectionPlayState | null>(null);
  let rootSeed = $state<string | null>(null);
  let busy = $state<'idle' | 'preparing' | 'playing' | 'committing'>('idle');
  let flowError = $state<string | null>(null);
  let record = $state<CollectionGameRecordUnion | null>(null);
  let announcement = $state('');

  let difficultyId = $state<CollectionDifficultyId>('street');
  let selectedObjectiveId = $state<CollectionObjectiveId | null>(null);

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
  const pendingV2 = $derived(pending?.gameVersion === 'collection-game-v2' ? pending : null);
  const pendingV1 = $derived(pending?.gameVersion === 'collection-game-v1' ? pending : null);
  const recordV2 = $derived(record?.gameVersion === 'collection-game-v2' ? record : null);
  const shownEvents = $derived(record ? visibleEvents(record.events, watchMode) : []);
  const facts = $derived(record ? explanationFacts(record, record.events) : null);
  const claimed = $derived(collectionState?.claimedWelcome ?? false);
  const hasTeam = $derived(playState !== null);
  const balances = $derived(collectionState?.balances ?? { Coins: 0, Exchange: 0 });
  const clearedDifficultyIds = $derived(playState?.clearedDifficultyIds ?? []);
  const difficultyOptions = $derived(
    rules ? difficultyOptionViews(rules, clearedDifficultyIds) : [],
  );
  const offers = $derived.by(() => {
    if (rules === null || playState === null || rootSeed === null || pending !== null) return [];
    try {
      return collectionObjectiveOffers({
        rules,
        rootSeed,
        difficultyId,
        gameSequence: playState.nextGameSequence,
        team: playState.activeTeam,
      });
    } catch {
      return [];
    }
  });
  const effectiveObjectiveId = $derived(
    selectedObjectiveId !== null &&
      offers.some((offer) => offer.objectiveId === selectedObjectiveId)
      ? selectedObjectiveId
      : null,
  );
  const objectiveOptions = $derived(
    rules ? objectiveOptionViews({ offers, rules, difficultyId }) : [],
  );
  const preview = $derived(
    rules
      ? rewardPreview({
          rules,
          difficultyId,
          selectedObjectiveId: effectiveObjectiveId,
          clearedDifficultyIds,
        })
      : null,
  );
  const setupLocked = $derived(busy !== 'idle');
  const pendingPlayerStarters = $derived(
    pendingV1?.playerTeam.starters.map((cardId) => byId.get(cardId) ?? null) ?? [],
  );
  const pendingCpuStarters = $derived(
    pendingV1?.cpuTeam.starters.map((cardId) => byId.get(cardId) ?? null) ?? [],
  );

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

  function difficultyNameOf(id: CollectionDifficultyId): string {
    return difficultyOptions.find((option) => option.difficultyId === id)?.displayName ?? id;
  }

  function objectiveTitleOf(objectiveId: string): string | null {
    if (recordV2 === null) return null;
    const offer = recordV2.prepared.objectives.offers.find(
      (candidate) => candidate.objectiveId === objectiveId,
    );
    return offer?.title ?? null;
  }

  async function load(): Promise<void> {
    try {
      const nowIso = new Date().toISOString();
      const [loadedCatalog, loadedState, loadedRules] = await Promise.all([
        loadCollectionCatalog(),
        ensureCollection(nowIso),
        loadCollectionGameRules(),
      ]);
      if (!mounted) return;
      catalog = loadedCatalog;
      collectionState = loadedState;
      rules = loadedRules;
      if (loadedState.claimedWelcome) {
        const snapshot = await ensurePlayStateSnapshot(new Date().toISOString());
        if (!mounted) return;
        playState = snapshot.playState;
        rootSeed = snapshot.rootSeed;
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
    const [loadedState, snapshot] = await Promise.all([
      ensureCollection(new Date().toISOString()),
      ensurePlayStateSnapshot(new Date().toISOString()),
    ]);
    if (!mounted) return;
    collectionState = loadedState;
    playState = snapshot.playState;
    rootSeed = snapshot.rootSeed;
  }

  async function prepare(): Promise<void> {
    if (busy !== 'idle') return;
    busy = 'preparing';
    flowError = null;
    try {
      const outcome = await prepareBasicGame(new Date().toISOString(), {
        difficultyId,
        objectiveId: effectiveObjectiveId,
      });
      if (!mounted) return;
      playState = outcome.playState;
      record = null;
      try {
        sessionStorage.removeItem('collection-last-game');
      } catch {
        // Session storage is best-effort.
      }
      announcement = `Matchup prepared at ${difficultyNameOf(difficultyId)}.`;
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
      const committed = record;
      const won = committed?.result.winner === 'home';
      const coins =
        committed === null
          ? 0
          : committed.gameVersion === 'collection-game-v2'
            ? committed.reward.total
            : committed.reward.amount;
      let objectiveNote = '';
      if (committed?.gameVersion === 'collection-game-v2') {
        const evaluation = committed.objectiveEvaluation;
        if (evaluation.kind === 'evaluated') {
          objectiveNote = evaluation.success ? ' Objective passed.' : ' Objective failed.';
        }
      }
      announcement = `${won ? 'You won' : 'CPU won'}. +${coins} Coins.${objectiveNote}`;
      busy = 'idle';
    } catch (playError) {
      if (!mounted) return;
      flowError = playError instanceof Error ? playError.message : 'The game failed. Try again.';
      await refreshState().catch(() => undefined);
      if (mounted) busy = 'idle';
    }
  }
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
        One game at a time. Street, Pro, and Legend scale the CPU and the rewards.
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
      class="mt-3 inline-block min-h-11 rounded-xl bg-accent px-5 py-2.5 font-bold text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      class="mt-3 inline-block min-h-11 rounded-xl bg-accent px-5 py-2.5 font-bold text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Build team
    </a>
  {:else}
    {#if flowError}
      <p
        role="alert"
        class="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
      >
        {flowError}
      </p>
    {/if}

    {#if pending}
      {#if pendingV2 && catalog}
        <MatchupReport prepared={pendingV2} {catalog} />
      {:else if pendingV1}
        <section aria-label="Matchup" class="mt-4 rounded-2xl border border-accent/50 bg-card p-5">
          <h2 class="font-display text-xl font-extrabold">Matchup ready</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            Legacy matchup. Rewards use the recorded M4.2 100/10 table.
          </p>
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
        </section>
      {/if}
      <div class="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onclick={play}
          disabled={busy !== 'idle'}
          class="min-h-11 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {busy === 'playing' ? 'Playing…' : busy === 'committing' ? 'Committing…' : 'Start game'}
        </button>
        <button
          type="button"
          onclick={abandon}
          disabled={busy !== 'idle'}
          class="min-h-11 rounded-xl bg-surface-2 px-5 py-2.5 text-sm font-bold outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          Abandon matchup
        </button>
      </div>
      {#if busy === 'playing'}
        <p class="mt-3 text-sm text-muted-foreground" aria-live="polite">
          Simulating in the background. The result commits before it is shown.
        </p>
      {/if}
    {:else if !record}
      <section aria-label="Game setup" class="mt-4 rounded-2xl border border-border bg-card p-5">
        <div class="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p class="ultimate-eyebrow">Pre-game setup</p>
            <h2 class="font-display text-xl font-extrabold">Scout the matchup</h2>
          </div>
          <p class="text-xs text-muted-foreground">
            Setup locks when you prepare. Abandon to change it.
          </p>
        </div>
        <div class="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]">
          <div class="space-y-6">
            <DifficultyPicker
              options={difficultyOptions}
              value={difficultyId}
              disabled={setupLocked}
              onChange={(id) => {
                if (id !== difficultyId) selectedObjectiveId = null;
                difficultyId = id;
              }}
            />
            <ObjectivePicker
              options={objectiveOptions}
              value={effectiveObjectiveId}
              disabled={setupLocked}
              onChange={(id) => {
                selectedObjectiveId = id;
              }}
            />
          </div>
          {#if preview}
            <section
              aria-label="Reward preview"
              class="rounded-2xl border border-border bg-surface-2 p-4 lg:sticky lg:top-4 lg:self-start"
            >
              <h3 class="font-display text-base font-extrabold">Exact reward preview</h3>
              <p class="mt-1 text-xs text-muted-foreground">
                {difficultyNameOf(difficultyId)} · {preview.multiplierLabel} on outcome, objective, and
                margin. First clear is fixed.
              </p>
              <ul class="mt-3 space-y-2">
                {#each preview.rows as row (row.kind)}
                  <li
                    class="flex items-start justify-between gap-3 rounded-lg bg-card px-3 py-2 text-sm"
                  >
                    <span>
                      <span class="block font-semibold">{row.label}</span>
                      <span class="block text-xs text-muted-foreground">{row.detail}</span>
                    </span>
                    <span
                      class="font-bold tabular-nums {row.coins === 0
                        ? 'text-muted-foreground'
                        : 'text-accent'}"
                    >
                      {row.coins === 0 ? '—' : `+${row.coins}`}
                    </span>
                  </li>
                {/each}
              </ul>
              <dl class="mt-3 space-y-1 text-xs text-muted-foreground">
                <div class="flex items-center justify-between gap-3">
                  <dt>Max repeat (win + objective + margin)</dt>
                  <dd class="font-bold text-foreground tabular-nums">+{preview.maxRepeatCoins}</dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt>Max total with first clear</dt>
                  <dd class="font-bold text-foreground tabular-nums">+{preview.maxTotalCoins}</dd>
                </div>
              </dl>
              <button
                type="button"
                onclick={prepare}
                disabled={setupLocked}
                class="mt-4 min-h-11 w-full rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
              >
                {busy === 'preparing' ? 'Preparing…' : 'Prepare matchup'}
              </button>
              <p class="mt-2 text-xs text-muted-foreground" aria-live="polite">
                Preparing consumes the game sequence. Abandoning never reuses it.
              </p>
            </section>
          {/if}
        </div>
      </section>
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
                class="min-h-11 rounded-xl px-4 py-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring {watchMode ===
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
              class="min-h-11 rounded-xl bg-surface-2 px-4 py-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              onclick={stepOnce}
              disabled={playing}
              class="min-h-11 rounded-xl bg-surface-2 px-4 py-2 text-sm font-bold outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
            >
              Step
            </button>
            <button
              type="button"
              onclick={skipToFinal}
              class="min-h-11 rounded-xl bg-surface-2 px-4 py-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          {#if !recordV2}
            <div class="rounded-xl bg-surface-2 p-4 text-sm">
              <h3 class="font-bold">Reward receipt</h3>
              <p class="mt-2 tabular-nums text-muted-foreground">
                +{facts.rewardCoins} Coins ({facts.rewardReason === 'game-win-reward'
                  ? 'win'
                  : 'loss'}) · balances now {balances.Coins} Coins.
              </p>
            </div>
          {/if}
        </div>

        {#if recordV2}
          <RewardReceipt record={recordV2} {balances} {objectiveTitleOf} />
        {/if}

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
              class="min-h-11 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
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
