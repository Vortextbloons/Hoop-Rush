<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import '$lib/collection/ultimate-theme.css';
  import { onDestroy, tick } from 'svelte';
  import type {
    CollectionCatalog,
    CollectionCatalogCard,
    CollectionChallengeValidationFacts,
    CollectionDifficultyId,
    CollectionGameRecordUnion,
    CollectionGameRules,
    CollectionObjectiveId,
    CollectionPlayState,
    CollectionProgressionRules,
    CollectionState,
  } from '@hoop-rush/data-contracts';
  import { collectionGameIdSchema } from '@hoop-rush/data-contracts';
  import { validateCollectionChallengeTeam } from '@hoop-rush/engine';
  import AsyncState from '$lib/components/AsyncState.svelte';
  import CollectionNav from '$lib/collection/CollectionNav.svelte';
  import ChallengeCard from '$lib/collection/ChallengeCard.svelte';
  import DifficultyPicker from '$lib/collection/DifficultyPicker.svelte';
  import MatchupReport from '$lib/collection/MatchupReport.svelte';
  import ObjectivePicker from '$lib/collection/ObjectivePicker.svelte';
  import RewardReceipt from '$lib/collection/RewardReceipt.svelte';
  import {
    loadCollectionCatalog,
    loadCollectionGameRules,
    loadCollectionProgression,
  } from '$lib/collection/collection-assets.ts';
  import {
    abandonBasicGame,
    abandonChallengeGame,
    acceptBasicGameResult,
    acceptChallengeGameResult,
    collectionChallengeOffers,
    collectionGameWorkerAssets,
    collectionObjectiveOffers,
    ensureCollection,
    ensurePlayStateSnapshot,
    loadCommittedGame,
    prepareBasicGame,
    prepareChallengeGame,
    type AcceptedGameOutcome,
  } from '$lib/collection/collection-hub.ts';
  import { runCollectionGame } from '$lib/collection/collection-game-runner.ts';
  import { collectionErrorMessage } from '$lib/collection/collection-errors.ts';
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
  import {
    challengeCardView,
    challengeRewardPreview,
    requirementLabel,
    type ChallengeCardView,
  } from '$lib/collection/collection-progression-view.ts';
  import { arenaError, arenaGameResult } from '$lib/arena-sound';

  let mounted = true;
  onDestroy(() => {
    mounted = false;
    stopPlayback();
  });

  let phase = $state<'loading' | 'error' | 'ready'>('loading');
  let error = $state<string | null>(null);
  let catalog = $state<CollectionCatalog | null>(null);
  let rules = $state<CollectionGameRules | null>(null);
  let progression = $state<CollectionProgressionRules | null>(null);
  let progressionError = $state<string | null>(null);
  let collectionState = $state<CollectionState | null>(null);
  let playState = $state<CollectionPlayState | null>(null);
  let rootSeed = $state<string | null>(null);
  let busy = $state<'idle' | 'preparing' | 'playing' | 'committing'>('idle');
  let flowError = $state<string | null>(null);
  let record = $state<CollectionGameRecordUnion | null>(null);
  let announcement = $state('');

  let mode = $state<'standard' | 'challenges'>('standard');
  let difficultyId = $state<CollectionDifficultyId>('street');
  let selectedObjectiveId = $state<CollectionObjectiveId | null>(null);
  let selectedChallengeId = $state<string | null>(null);
  let challengeObjectiveId = $state<CollectionObjectiveId | null>(null);
  let challengePanel = $state<HTMLElement | undefined>(undefined);

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
  const pendingV1 = $derived(pending?.gameVersion === 'collection-game-v1' ? pending : null);
  const pendingCurrent = $derived(
    pending !== null && pending.gameVersion !== 'collection-game-v1' ? pending : null,
  );
  const recordV2 = $derived(
    record !== null && record.gameVersion !== 'collection-game-v1' ? record : null,
  );
  const shownEvents = $derived(record ? visibleEvents(record.events, watchMode) : []);
  const facts = $derived(record ? explanationFacts(record, record.events) : null);
  const claimed = $derived(collectionState?.claimedWelcome ?? false);
  const hasTeam = $derived(playState !== null);
  const balances = $derived(collectionState?.balances ?? { Coins: 0, Exchange: 0 });
  const clearedDifficultyIds = $derived(playState?.clearedDifficultyIds ?? []);
  const clearedChallengeIds = $derived(playState?.clearedChallengeIds ?? []);
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

  const setTitleOf = $derived((setId: string) => {
    return catalog?.sets.find((set) => set.setId === setId)?.title ?? null;
  });
  const challengeFacts = $derived.by(() => {
    const map = new Map<string, CollectionChallengeValidationFacts>();
    if (progression === null || catalog === null || playState === null) return map;
    const ownedCardIds = new Set((collectionState?.owned ?? []).map((entry) => entry.cardId));
    for (const challenge of progression.challenges) {
      map.set(
        challenge.challengeId,
        validateCollectionChallengeTeam({
          definition: challenge,
          team: playState.activeTeam,
          catalog,
          ownedCardIds,
        }).facts,
      );
    }
    return map;
  });
  const challengeViews = $derived.by(() => {
    if (progression === null) return [];
    const cleared = clearedChallengeIds as readonly string[];
    const views: ChallengeCardView[] = [];
    for (const challenge of progression.challenges) {
      const challengeFactsForId = challengeFacts.get(challenge.challengeId);
      if (challengeFactsForId === undefined) continue;
      views.push(
        challengeCardView({
          challenge,
          facts: challengeFactsForId,
          cleared: cleared.includes(challenge.challengeId),
          hasPendingGame: pending !== null,
          setTitleOf,
        }),
      );
    }
    return views;
  });
  const selectedChallenge = $derived(
    progression !== null && selectedChallengeId !== null
      ? (progression.challenges.find(
          (challenge) => challenge.challengeId === selectedChallengeId,
        ) ?? null)
      : null,
  );
  const selectedChallengeFacts = $derived(
    selectedChallengeId !== null ? (challengeFacts.get(selectedChallengeId) ?? null) : null,
  );
  const selectedChallengeCleared = $derived(
    selectedChallengeId !== null &&
      (clearedChallengeIds as readonly string[]).includes(selectedChallengeId),
  );
  const challengeOffers = $derived.by(() => {
    if (
      progression === null ||
      rules === null ||
      playState === null ||
      rootSeed === null ||
      pending !== null ||
      selectedChallenge === null
    ) {
      return [];
    }
    try {
      return collectionChallengeOffers({
        progression,
        rules,
        rootSeed,
        challengeId: selectedChallenge.challengeId,
        gameSequence: playState.nextGameSequence,
        team: playState.activeTeam,
      });
    } catch {
      return [];
    }
  });
  const effectiveChallengeObjectiveId = $derived(
    challengeObjectiveId !== null &&
      challengeOffers.some((offer) => offer.objectiveId === challengeObjectiveId)
      ? challengeObjectiveId
      : null,
  );
  const challengeObjectiveOptions = $derived(
    rules !== null && selectedChallenge !== null
      ? objectiveOptionViews({
          offers: challengeOffers,
          rules,
          difficultyId: selectedChallenge.difficultyId,
        })
      : [],
  );
  const challengePreview = $derived(
    rules !== null && selectedChallenge !== null
      ? rewardPreview({
          rules,
          difficultyId: selectedChallenge.difficultyId,
          selectedObjectiveId: effectiveChallengeObjectiveId,
          clearedDifficultyIds,
        })
      : null,
  );
  const challengeReward = $derived(
    selectedChallenge !== null
      ? challengeRewardPreview(selectedChallenge, selectedChallengeCleared)
      : null,
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

  function rewardCoinsOf(gameRecord: CollectionGameRecordUnion): number {
    if (gameRecord.gameVersion === 'collection-game-v1') return gameRecord.reward.amount;
    return gameRecord.reward.total;
  }

  function challengeRewardNoteOf(gameRecord: CollectionGameRecordUnion): string {
    if (gameRecord.gameVersion !== 'collection-game-v3') return '';
    const component = gameRecord.reward.components.find(
      (entry) => entry.kind === 'challenge-first-clear' || entry.kind === 'challenge-repeat-win',
    );
    if (component === undefined) return '';
    const label =
      component.kind === 'challenge-first-clear' ? 'Challenge first clear' : 'Challenge repeat win';
    return ` ${label} +${String(component.amount)} Coins.`;
  }

  function readFlowFromUrl(): void {
    const params = page.url.searchParams;
    const requestedChallenge = params.get('challenge');
    const requestedMode = params.get('mode');
    if (requestedChallenge !== null && requestedChallenge.length > 0) {
      selectedChallengeId = requestedChallenge;
      mode = 'challenges';
      return;
    }
    mode = requestedMode === 'challenges' ? 'challenges' : 'standard';
  }

  async function selectChallenge(challengeId: string): Promise<void> {
    selectedChallengeId = challengeId;
    challengeObjectiveId = null;
    mode = 'challenges';
    await tick();
    challengePanel?.focus();
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
      readFlowFromUrl();
      if (loadedState.claimedWelcome) {
        const snapshot = await ensurePlayStateSnapshot(new Date().toISOString());
        if (!mounted) return;
        playState = snapshot.playState;
        rootSeed = snapshot.rootSeed;
        await restoreLastGame();
      }
      phase = 'ready';
      void loadCollectionProgression()
        .then((loaded) => {
          if (!mounted) return;
          progression = loaded;
          progressionError = null;
          if (
            selectedChallengeId !== null &&
            !loaded.challenges.some((challenge) => challenge.challengeId === selectedChallengeId)
          ) {
            selectedChallengeId = null;
          }
        })
        .catch((failure: unknown) => {
          if (!mounted) return;
          progression = null;
          progressionError =
            failure instanceof Error
              ? failure.message
              : 'The collection progression rules are unavailable.';
        });
    } catch (loadError) {
      if (!mounted) return;
      error = loadError instanceof Error ? loadError.message : 'Could not load play.';
      phase = 'error';
    }
  }

  async function restoreLastGame(): Promise<void> {
    try {
      const rawGameId = sessionStorage.getItem('collection-last-game');
      if (!rawGameId || playState?.pendingGame) return;
      const parsedGameId = collectionGameIdSchema.safeParse(rawGameId);
      if (!parsedGameId.success) return;
      const committed = await loadCommittedGame(parsedGameId.data);
      if (!mounted || !committed) return;
      record = committed;
      if (committed.gameVersion === 'collection-game-v3') {
        mode = 'challenges';
        selectedChallengeId = committed.prepared.challenge.challengeId;
      }
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
    if (mode === 'challenges' && selectedChallengeId === null) return;
    busy = 'preparing';
    flowError = null;
    try {
      const nowIso = new Date().toISOString();
      const outcome =
        mode === 'challenges'
          ? await prepareChallengeGame(
              selectedChallengeId as string,
              effectiveChallengeObjectiveId,
              nowIso,
            )
          : await prepareBasicGame(nowIso, {
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
      announcement =
        mode === 'challenges' && selectedChallenge !== null
          ? `Challenge matchup prepared: ${selectedChallenge.displayName}.`
          : `Matchup prepared at ${difficultyNameOf(difficultyId)}.`;
    } catch (prepareError) {
      if (!mounted) return;
      flowError = collectionErrorMessage(prepareError, 'Preparing failed.');
    } finally {
      if (mounted) busy = 'idle';
    }
  }

  async function abandon(): Promise<void> {
    if (busy !== 'idle') return;
    const pendingGame = pending;
    const challengeName =
      pendingGame !== null && pendingGame.gameVersion === 'collection-game-v3'
        ? pendingGame.challenge.displayName
        : null;
    busy = 'preparing';
    flowError = null;
    try {
      const next =
        challengeName !== null
          ? await abandonChallengeGame(new Date().toISOString())
          : await abandonBasicGame(new Date().toISOString());
      if (!mounted) return;
      playState = next;
      record = null;
      announcement =
        challengeName !== null
          ? `Challenge abandoned: ${challengeName}. No reward or clear was granted and the game sequence advanced.`
          : 'Matchup abandoned. Prepare a new game when ready.';
    } catch (abandonError) {
      if (!mounted) return;
      flowError = collectionErrorMessage(abandonError, 'Abandoning failed.');
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
        let accepted: AcceptedGameOutcome;
        if (matchup.gameVersion === 'collection-game-v3') {
          if (completed.result.gameVersion !== 'collection-game-v3') {
            throw new Error('The worker returned a result for a different game version.');
          }
          accepted = await acceptChallengeGameResult({
            result: completed.result,
            events: completed.events,
            completedAtIso,
            recordedAtIso: new Date().toISOString(),
          });
        } else {
          accepted = await acceptBasicGameResult({
            result: completed.result,
            events: completed.events,
            completedAtIso,
            recordedAtIso: new Date().toISOString(),
          });
        }
        if (!mounted) return;
        playState = accepted.playState;
        collectionState = { ...(collectionState as CollectionState), balances: accepted.balances };
        record = accepted.record;
        if (accepted.record.gameVersion === 'collection-game-v3') {
          mode = 'challenges';
          selectedChallengeId = accepted.record.prepared.challenge.challengeId;
        }
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
        if (collectionGameIdSchema.safeParse(matchup.gameId).success) {
          sessionStorage.setItem('collection-last-game', matchup.gameId);
        }
      } catch {
        // Receipt restore is best-effort.
      }
      cursor = 0;
      playing = false;
      const committed = record;
      const won = committed?.result.winner === 'home';
      const coins = committed === null ? 0 : rewardCoinsOf(committed);
      let objectiveNote = '';
      if (committed?.gameVersion === 'collection-game-v2') {
        const evaluation = committed.objectiveEvaluation;
        if (evaluation.kind === 'evaluated') {
          objectiveNote = evaluation.success ? ' Objective passed.' : ' Objective failed.';
        }
      }
      const challengeNote = committed === null ? '' : challengeRewardNoteOf(committed);
      announcement = `${won ? 'You won' : 'CPU won'}. +${String(coins)} Coins.${objectiveNote}${challengeNote}`;
      try {
        arenaGameResult(won);
      } catch {}
      busy = 'idle';
    } catch (playError) {
      if (!mounted) return;
      try {
        arenaError();
      } catch {}
      flowError = collectionErrorMessage(playError, 'The game failed. Try again.');
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
        One game at a time. Standard games scale with Street, Pro, and Legend. Challenges add a
        fixed roster requirement and a fixed reward.
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
      {#if pendingCurrent && catalog}
        <MatchupReport prepared={pendingCurrent} {catalog} />
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
      <fieldset class="mt-4" disabled={setupLocked}>
        <legend class="sr-only">Play mode</legend>
        <div class="flex flex-wrap gap-2">
          <label class="relative block">
            <input
              type="radio"
              name="collection-play-mode"
              value="standard"
              checked={mode === 'standard'}
              onchange={() => {
                mode = 'standard';
              }}
              class="peer sr-only"
            />
            <span
              class="mode-pill flex min-h-11 items-center rounded-xl border-2 border-border bg-surface-2 px-4 py-2 text-sm font-bold"
            >
              Standard
            </span>
          </label>
          <label class="relative block">
            <input
              type="radio"
              name="collection-play-mode"
              value="challenges"
              checked={mode === 'challenges'}
              onchange={() => {
                mode = 'challenges';
              }}
              class="peer sr-only"
            />
            <span
              class="mode-pill flex min-h-11 items-center rounded-xl border-2 border-border bg-surface-2 px-4 py-2 text-sm font-bold"
            >
              Challenges
            </span>
          </label>
        </div>
      </fieldset>

      {#if mode === 'standard'}
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
                  {difficultyNameOf(difficultyId)} · {preview.multiplierLabel} on outcome, objective,
                  and margin. First clear is fixed.
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
                    <dd class="font-bold text-foreground tabular-nums">
                      +{preview.maxRepeatCoins}
                    </dd>
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
      {:else}
        <section
          aria-label="Challenge browser"
          class="mt-4 rounded-2xl border border-border bg-card p-5"
        >
          <div class="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p class="ultimate-eyebrow">Challenges</p>
              <h2 class="font-display text-xl font-extrabold">
                {progression?.display.challengesTitle ?? 'Fixed roster challenges'}
              </h2>
            </div>
            <p class="text-xs text-muted-foreground">
              {progression?.display.challengesBlurb ??
                'Eligibility uses the committed active team. Challenges never edit or save your team.'}
            </p>
          </div>

          {#if progressionError}
            <div class="mt-4">
              <AsyncState
                kind="error"
                title="Challenges unavailable"
                message={progressionError}
                retry={() => {
                  progressionError = null;
                  void loadCollectionProgression()
                    .then((loaded) => {
                      if (mounted) progression = loaded;
                    })
                    .catch((failure: unknown) => {
                      if (!mounted) return;
                      progressionError =
                        failure instanceof Error
                          ? failure.message
                          : 'The collection progression rules are unavailable.';
                    });
                }}
              />
            </div>
          {:else if progression === null}
            <div class="mt-4">
              <AsyncState kind="loading" title="Loading" message="Loading challenges…" />
            </div>
          {:else}
            <ul class="mt-4 grid gap-4 lg:grid-cols-2">
              {#each challengeViews as view (view.challengeId)}
                {@const viewFacts = challengeFacts.get(view.challengeId)}
                {#if viewFacts}
                  <ChallengeCard
                    {view}
                    facts={viewFacts}
                    difficultyLabel={difficultyNameOf(view.difficultyId)}
                    teamPath={`/collection/team?challenge=${view.challengeId}`}
                    selected={selectedChallengeId === view.challengeId}
                    onSelect={(challengeId) => void selectChallenge(challengeId)}
                  />
                {/if}
              {/each}
            </ul>

            {#if selectedChallenge && selectedChallengeFacts}
              <div
                bind:this={challengePanel}
                tabindex="-1"
                class="mt-6 rounded-2xl border border-border bg-surface-2 p-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Selected challenge"
              >
                <h3 class="font-display text-lg font-extrabold">
                  {selectedChallenge.displayName}
                </h3>
                <p class="mt-1 text-sm text-muted-foreground">
                  {requirementLabel(selectedChallenge.requirement, setTitleOf)} ·
                  {difficultyNameOf(selectedChallenge.difficultyId)} difficulty · snapshotted when you
                  prepare
                </p>
                <p class="mt-2 text-sm tabular-nums">
                  Team progress: {selectedChallengeFacts.rosterCount}/{selectedChallengeFacts.requiredRosterCount}
                  matching active cards · {selectedChallengeFacts.starterCount}/{selectedChallengeFacts.requiredStarterCount}
                  matching starters
                </p>
                {#if !selectedChallengeFacts.success}
                  <p role="alert" class="mt-2 text-sm font-semibold text-destructive">
                    This challenge cannot be prepared yet.
                  </p>
                  <p class="mt-1 text-sm">
                    <a
                      href={resolve(
                        `/collection/team?challenge=${selectedChallenge.challengeId}` as any,
                      )}
                      class="font-semibold underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Edit team
                    </a>
                    to meet the requirement, then return.
                  </p>
                  <details class="mt-3 rounded-xl bg-card p-3 text-xs">
                    <summary
                      class="cursor-pointer font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Full requirement facts
                    </summary>
                    <p class="mt-2">
                      Team legal: {selectedChallengeFacts.teamValid ? 'yes' : 'no'} · matching card IDs:
                      {selectedChallengeFacts.matchingCardIds.length === 0
                        ? 'none'
                        : selectedChallengeFacts.matchingCardIds.join(', ')} · team issues:
                      {selectedChallengeFacts.teamIssueCodes.length === 0
                        ? 'none'
                        : selectedChallengeFacts.teamIssueCodes.join(', ')}
                    </p>
                  </details>
                {:else}
                  <div class="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]">
                    <ObjectivePicker
                      options={challengeObjectiveOptions}
                      value={effectiveChallengeObjectiveId}
                      disabled={setupLocked}
                      legend="Challenge objective"
                      onChange={(id) => {
                        challengeObjectiveId = id;
                      }}
                    />
                    {#if challengePreview && challengeReward}
                      <section
                        aria-label="Challenge reward preview"
                        class="rounded-2xl border border-border bg-card p-4 lg:sticky lg:top-4 lg:self-start"
                      >
                        <h4 class="font-display text-base font-extrabold">Exact reward preview</h4>
                        <p class="mt-1 text-xs text-muted-foreground">
                          Standard rewards use the {difficultyNameOf(
                            selectedChallenge.difficultyId,
                          )} M4.3 table. Challenge rewards are fixed.
                        </p>
                        <h5
                          class="mt-3 text-xs font-bold uppercase tracking-wide text-muted-foreground"
                        >
                          Standard components
                        </h5>
                        <ul class="mt-2 space-y-2">
                          {#each challengePreview.rows as row (row.kind)}
                            <li
                              class="flex items-start justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm"
                            >
                              <span>
                                <span class="block font-semibold">{row.label}</span>
                                <span class="block text-xs text-muted-foreground">{row.detail}</span
                                >
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
                        <h5
                          class="mt-3 text-xs font-bold uppercase tracking-wide text-muted-foreground"
                        >
                          Challenge components
                        </h5>
                        <ul class="mt-2 space-y-2">
                          {#each challengeReward.rows as row (row.kind)}
                            <li
                              class="flex items-start justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm"
                            >
                              <span>
                                <span class="block font-semibold">{row.label}</span>
                                <span class="block text-xs text-muted-foreground">{row.detail}</span
                                >
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
                            <dt>Max standard repeat</dt>
                            <dd class="font-bold text-foreground tabular-nums">
                              +{challengePreview.maxRepeatCoins}
                            </dd>
                          </div>
                          <div class="flex items-center justify-between gap-3">
                            <dt>Max challenge repeat win</dt>
                            <dd class="font-bold text-foreground tabular-nums">
                              +{challengeReward.repeatWinCoins}
                            </dd>
                          </div>
                          <div class="flex items-center justify-between gap-3">
                            <dt>Max total with both first clears</dt>
                            <dd class="font-bold text-foreground tabular-nums">
                              +{challengePreview.maxTotalCoins + challengeReward.firstClearCoins}
                            </dd>
                          </div>
                        </dl>
                        <button
                          type="button"
                          onclick={prepare}
                          disabled={setupLocked}
                          class="mt-4 min-h-11 w-full rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {busy === 'preparing' ? 'Preparing…' : 'Prepare challenge'}
                        </button>
                        <p class="mt-2 text-xs text-muted-foreground" aria-live="polite">
                          Preparing locks the matchup and consumes the game sequence. Abandoning
                          never reuses it.
                        </p>
                      </section>
                    {/if}
                  </div>
                {/if}
              </div>
            {:else}
              <p class="mt-4 text-sm text-muted-foreground">
                Choose an eligible challenge to pick an objective and prepare.
              </p>
            {/if}
          {/if}
        </section>
      {/if}
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
            {#each [{ id: 'fast', label: 'Fast' }, { id: 'standard', label: 'Standard' }, { id: 'slow', label: 'Slow' }] as modeOption (modeOption.id)}
              <button
                type="button"
                onclick={() => setMode(modeOption.id as WatchMode)}
                aria-pressed={watchMode === modeOption.id}
                class="min-h-11 rounded-xl px-4 py-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring {watchMode ===
                modeOption.id
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-surface-2'}"
              >
                {modeOption.label}
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
              disabled={busy !== 'idle' || (mode === 'challenges' && selectedChallengeId === null)}
              class="min-h-11 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {busy === 'preparing'
                ? 'Preparing…'
                : mode === 'challenges' && selectedChallenge !== null
                  ? `Play ${selectedChallenge.displayName} again`
                  : 'Play again'}
            </button>
          </div>
        {/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  input:checked + .mode-pill {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface-2));
  }
  input:focus-visible + .mode-pill {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }
  input:disabled + .mode-pill {
    cursor: not-allowed;
    opacity: 0.6;
  }
  @media (prefers-reduced-motion: reduce) {
    .ultimate-root :global(*) {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
