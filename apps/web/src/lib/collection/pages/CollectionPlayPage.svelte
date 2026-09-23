<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import '$lib/collection/ultimate-theme.css';
  import { getContext, onDestroy, tick } from 'svelte';
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
    clockLabel,
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
  import {
    ULTIMATE_RUN_SHELL_CONTEXT,
    type UltimateRunShell,
  } from '$lib/collection/ultimate-shell.svelte';

  const shell = getContext<UltimateRunShell>(ULTIMATE_RUN_SHELL_CONTEXT);

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
  const scoreboardEvent = $derived(
    record && shownEvents.length > 0
      ? shownEvents[Math.min(cursor, shownEvents.length - 1)]!
      : null,
  );
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

  function quarterSplitsOf(gameRecord: CollectionGameRecordUnion): Array<{
    label: string;
    home: number;
    away: number;
  }> {
    if (gameRecord.result.outcome !== 'completed') return [];
    const homePeriods = gameRecord.result.home.periodScores;
    const awayPeriods = gameRecord.result.away.periodScores;
    const count = Math.min(homePeriods.length, awayPeriods.length, 8);
    const splits: Array<{ label: string; home: number; away: number }> = [];
    for (let index = 0; index < count; index += 1) {
      const label = index < 4 ? `Q${String(index + 1)}` : `OT${String(index - 3)}`;
      splits.push({ label, home: homePeriods[index] ?? 0, away: awayPeriods[index] ?? 0 });
    }
    return splits;
  }

  function previewIconOf(kind: string): string {
    if (kind === 'outcome-win') return '◉';
    if (kind === 'outcome-loss') return '✕';
    if (kind === 'margin') return '▂';
    if (kind === 'first-clear') return '★';
    return '◎';
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

  $effect(() => {
    if (collectionState && catalog) shell.sync(collectionState, catalog.cards.length);
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

<div class="ur-page ur-play-page">
  <div class="ur-pregame-hero">
    <div class="ur-pregame-copy">
      <p class="ur-pregame-kicker">Ultimate Run · Pre-game</p>
      <h2 class="ur-pregame-title">Under the lights</h2>
      <p class="ur-page-description">
        Set the matchup, play the committed simulation, then watch its recorded gamecast.
      </p>
    </div>
    <div class="ur-pregame-status">
      <strong class="ur-number">
        {playState?.pendingGame
          ? 'Matchup prepared'
          : playState
            ? `Game ${playState.nextGameSequence + (record ? 0 : 1)}`
            : 'Run setup'}</strong
      >
      <small
        >{playState?.pendingGame
          ? 'Locked until abandoned'
          : 'Pre-game · setup locks on prepare'}</small
      >
      {#if playState}
        <span
          class="ur-clear-dots"
          aria-label={`${clearedDifficultyIds.length} of 3 difficulty first clears claimed`}
        >
          {#each ['street', 'pro', 'legend'] as id (id)}
            <i data-done={clearedDifficultyIds.includes(id as CollectionDifficultyId)}></i>
          {/each}
        </span>
      {/if}
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
      href={resolve('/ultimate/run/collection' as any)}
      class="ur-btn-gold mt-3 inline-block px-5 py-2.5 outline-none"
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
      href={resolve('/ultimate/run/team' as any)}
      class="ur-btn-gold mt-3 inline-block px-5 py-2.5 outline-none"
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
        <section aria-label="Matchup" class="ur-arena-panel mt-4 p-5">
          <h2 class="ur-section-title">Matchup ready</h2>
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
      <div class="ur-pending-actions">
        <button
          type="button"
          onclick={play}
          disabled={busy !== 'idle'}
          class="ur-btn-gold ur-start-sim px-5 py-2.5 text-sm outline-none disabled:opacity-40"
        >
          {busy === 'playing'
            ? 'Playing…'
            : busy === 'committing'
              ? 'Committing…'
              : 'Start simulation →'}
        </button>
        <button
          type="button"
          onclick={abandon}
          disabled={busy !== 'idle'}
          class="ur-btn-ghost px-5 py-2.5 text-sm outline-none disabled:opacity-40"
        >
          Abandon matchup
        </button>
        <span class="ur-pending-note"
          >Setup locks when you prepare. Abandoning never reuses it.</span
        >
      </div>
      {#if busy === 'playing'}
        <p class="mt-3 text-sm text-muted-foreground" aria-live="polite">
          Simulating in the background. The result commits before it is shown.
        </p>
      {/if}
    {:else if !record}
      <fieldset class="ur-mode-switch" disabled={setupLocked}>
        <legend class="sr-only">Play mode</legend>
        <div class="ur-mode-pills">
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
            <span class="mode-pill" class:mode-active={mode === 'standard'}> Standard </span>
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
            <span class="mode-pill" class:mode-active={mode === 'challenges'}> Challenges </span>
          </label>
        </div>
      </fieldset>

      {#if mode === 'standard'}
        <section aria-label="Game setup" class="ur-scout-panel">
          <div class="ur-scout-grid">
            <div class="ur-scout-main">
              <div class="ur-step-head">
                <span class="ur-step-num" aria-hidden="true">1.</span>
                <div>
                  <h2 class="ur-step-title">Scout the matchup</h2>
                  <p class="ur-step-sub">
                    Choose the rules and difficulty. Rewards scale with risk.
                  </p>
                </div>
              </div>
              <DifficultyPicker
                options={difficultyOptions}
                value={difficultyId}
                disabled={setupLocked}
                legend="Difficulty"
                onChange={(id) => {
                  if (id !== difficultyId) selectedObjectiveId = null;
                  difficultyId = id;
                }}
              />
              <div class="ur-step-head ur-step-head--two">
                <span class="ur-step-num" aria-hidden="true">2.</span>
                <div>
                  <h2 class="ur-step-title">Objective</h2>
                  <p class="ur-step-sub">
                    The objective changes rewards only. It never changes the opponent.
                  </p>
                </div>
              </div>
              <ObjectivePicker
                options={objectiveOptions}
                value={effectiveObjectiveId}
                disabled={setupLocked}
                legend="Objective"
                onChange={(id) => {
                  selectedObjectiveId = id;
                }}
              />
            </div>
            {#if preview}
              <section aria-label="Reward preview" class="ur-reward-preview">
                <h3 class="ur-reward-title">Expected reward preview</h3>
                <p class="ur-reward-sub">
                  {difficultyNameOf(difficultyId)} · {effectiveObjectiveId ?? 'No objective'} · {preview.firstClearClaimed
                    ? 'First clear claimed'
                    : 'First clear fixed'}
                </p>
                <ul class="ur-reward-rows">
                  {#each preview.rows as row (row.kind)}
                    <li>
                      <span class="ur-reward-icon" aria-hidden="true"
                        >{previewIconOf(row.kind)}</span
                      >
                      <span class="ur-reward-copy">
                        <span class="ur-reward-label">{row.label}</span>
                        <span class="ur-reward-detail">{row.detail}</span>
                      </span>
                      <span class="ur-reward-coins" data-zero={row.coins === 0}>
                        {row.coins === 0 ? '—' : `+${row.coins}`}
                      </span>
                    </li>
                  {/each}
                </ul>
                <div class="ur-reward-max">
                  <span>Max possible reward <small>(win + margin, first clear)</small></span>
                  <strong class="ur-number">+{preview.maxTotalCoins}</strong>
                </div>
                <p class="ur-reward-repeat tabular-nums">
                  Max repeat {preview.maxRepeatCoins} · win {preview.winCoins} + margin {preview.marginMaxCoins}{preview.objectiveCoins !==
                  null
                    ? ` + objective ${preview.objectiveCoins}`
                    : ''}
                </p>
                <button
                  type="button"
                  onclick={prepare}
                  disabled={setupLocked}
                  class="ur-btn-gold ur-prepare-btn"
                >
                  {busy === 'preparing' ? 'Preparing…' : 'Prepare matchup →'}
                </button>
                <p class="ur-reward-lock" aria-live="polite">
                  <span aria-hidden="true">◈</span> Setup locks when you prepare. Abandoning never reuses
                  it.
                </p>
              </section>
            {/if}
          </div>
        </section>
      {:else}
        <section aria-label="Challenge browser" class="ur-arena-panel mt-4 p-5">
          <div class="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p class="ur-hero-eyebrow">Challenges</p>
              <h2 class="ur-section-title">
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
            <ul class="ur-challenge-grid mt-4 grid gap-4 lg:grid-cols-2">
              {#each challengeViews as view (view.challengeId)}
                {@const viewFacts = challengeFacts.get(view.challengeId)}
                {#if viewFacts}
                  <ChallengeCard
                    {view}
                    facts={viewFacts}
                    difficultyLabel={difficultyNameOf(view.difficultyId)}
                    teamPath={`/ultimate/run/team?challenge=${view.challengeId}`}
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
                class="ur-selected-challenge mt-6 p-5 outline-none"
                aria-label="Selected challenge"
              >
                <h3 class="ur-section-title">
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
                        `/ultimate/run/team?challenge=${selectedChallenge.challengeId}` as any,
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
                        class="ur-reward-preview p-4 lg:sticky lg:top-4 lg:self-start"
                      >
                        <h4 class="ur-section-title ur-reward-title">Exact reward preview</h4>
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
                          class="ur-btn-gold mt-4 w-full px-5 py-2.5 text-sm outline-none disabled:opacity-40"
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
      {@const splits = quarterSplitsOf(record)}
      <section aria-label="Result and gamecast" class="ur-gamecast mt-4">
        <div class="ur-broadcast-mast">
          <p class="ur-broadcast-note">Recorded from the committed game. This is not live play.</p>
          <button
            type="button"
            onclick={prepare}
            disabled={busy !== 'idle'}
            class="ur-play-again ur-play-again--mast"
          >
            {busy === 'preparing' ? 'Preparing…' : 'Play again'}
          </button>
        </div>
        <div class="ur-scoreboard ur-final-board">
          <p class="ur-final-kicker">
            {facts.winner === 'home' ? 'Final · Win' : 'Final · Loss'}
            <span aria-hidden="true"> · </span>
            <span>
              {record.gameVersion === 'collection-game-v3'
                ? record.prepared.challenge.displayName
                : record.gameVersion === 'collection-game-v1'
                  ? 'Ultimate Run game'
                  : difficultyNameOf(record.prepared.difficulty.difficultyId)}
            </span>
          </p>
          <div class="ur-scoreline" aria-label="Final score">
            <div><span>You</span><strong class="ur-number">{facts.homeScore}</strong></div>
            <span class="ur-score-divider" aria-hidden="true">-</span>
            <div><span>CPU</span><strong class="ur-number">{facts.awayScore}</strong></div>
          </div>
          <p class="ur-final-coins">+{facts.rewardCoins} Coins</p>
          {#if splits.length > 0}
            <ol class="ur-quarter-strip" aria-label="Score by quarter">
              {#each splits as split (split.label)}
                <li class="tabular-nums">
                  <span>{split.label}</span><strong>{split.home}-{split.away}</strong>
                </li>
              {/each}
            </ol>
          {/if}
          <p class="ur-final-meta">
            {facts.winner === 'home' ? 'You won' : 'CPU won'}
            {facts.overtimePeriods > 0
              ? ` · ${facts.overtimePeriods} overtime${facts.overtimePeriods === 1 ? '' : 's'}`
              : ''}
          </p>
        </div>

        <div class="ur-gamecast-controls ur-control-bar">
          <div class="ur-speed-pills" role="group" aria-label="Recorded replay speed">
            {#each [{ id: 'fast', label: 'Fast' }, { id: 'standard', label: 'Standard' }, { id: 'slow', label: 'Slow' }] as modeOption (modeOption.id)}
              <button
                type="button"
                onclick={() => setMode(modeOption.id as WatchMode)}
                aria-pressed={watchMode === modeOption.id}
                class="ur-speed-pill"
                data-active={watchMode === modeOption.id}
              >
                {modeOption.label}
              </button>
            {/each}
          </div>
          {#if watchMode !== 'fast'}
            <div class="ur-replay-actions">
              <button type="button" onclick={togglePlayback} class="ur-replay-primary">
                {playing ? 'Pause recording' : '⏵ Play recording'}
              </button>
              <button type="button" onclick={stepOnce} disabled={playing} class="ur-replay-btn">
                Next event
              </button>
              <button type="button" onclick={skipToFinal} class="ur-replay-btn">
                Skip to final
              </button>
            </div>
          {/if}
        </div>

        {#if watchMode !== 'fast'}
          <p class="ur-event-meta tabular-nums" aria-live="off">
            {Math.min(cursor + 1, shownEvents.length)} / {shownEvents.length}
            {watchMode === 'standard' ? '· 250 ms per event' : '· 650 ms per event'}
            {#if scoreboardEvent}
              <span>
                · Q{scoreboardEvent.period} · {clockLabel(scoreboardEvent.secondsRemaining)}</span
              >
            {/if}
          </p>
          <ol class="ur-recorded-events" aria-label="Recorded gamecast events">
            {#each shownEvents.slice(0, cursor + 1) as event (event.eventOrder)}
              <li class="tabular-nums">
                <span class="ur-event-q">Q{event.period}</span>{eventLabel(event)}
              </li>
            {/each}
          </ol>
        {/if}

        <div class="ur-facts-grid">
          <div class="ur-facts-panel">
            <h3>Game facts</h3>
            <ul class="tabular-nums">
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
            <div class="ur-facts-panel">
              <h3>Reward breakdown</h3>
              <p class="tabular-nums">
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
      </section>
    {/if}
  {/if}
</div>

<style>
  .ur-mode-switch {
    margin-top: 1rem;
  }
  .ur-mode-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .mode-pill {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    padding: 0.55rem 1.15rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 28%, var(--ur-line-strong));
    border-radius: 0.55rem;
    background: linear-gradient(180deg, rgb(255 255 255 / 3%), transparent 40%), var(--ur-surface);
    color: var(--ur-muted);
    font-size: 0.82rem;
    font-weight: 800;
    cursor: pointer;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 5%);
  }
  .mode-pill.mode-active,
  input:checked + .mode-pill {
    border-color: #ff7a2f;
    background:
      linear-gradient(180deg, rgb(255 218 115 / 22%), rgb(255 197 61 / 10%)), var(--ur-raised);
    color: #ffb37a;
    box-shadow:
      0 0 1rem rgb(255 110 30 / 20%),
      inset 0 1px 0 rgb(255 255 255 / 8%);
  }
  input:focus-visible + .mode-pill {
    outline: 3px solid var(--ur-focus);
    outline-offset: 2px;
  }
  input:disabled + .mode-pill {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .ur-page-description {
    max-width: 58ch;
    margin-top: 0.45rem;
    color: var(--ur-muted);
    font-size: 0.9rem;
  }

  .ur-pregame-hero {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem 1.5rem;
    margin-bottom: 1.1rem;
    padding: clamp(1.1rem, 3vw, 1.8rem);
    border: 1px solid color-mix(in srgb, var(--ur-apex) 28%, var(--ur-line));
    border-radius: 0.9rem;
    background:
      radial-gradient(ellipse 55% 80% at 50% 0%, rgb(255 196 64 / 22%), transparent 62%),
      radial-gradient(ellipse 40% 60% at 88% 30%, rgb(255 122 26 / 16%), transparent 60%),
      linear-gradient(180deg, #181f25, #0b0f13 70%);
    box-shadow:
      0 1.2rem 2.6rem rgb(0 0 0 / 45%),
      inset 0 1px 0 rgb(255 255 255 / 8%);
  }
  .ur-pregame-kicker {
    margin: 0;
    color: var(--ur-apex);
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }
  .ur-pregame-title {
    margin: 0.3rem 0 0;
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(2.2rem, 5.5vw, 3.4rem);
    font-weight: 900;
    letter-spacing: -0.03em;
    line-height: 0.95;
    text-shadow: 0 2px 18px rgb(0 0 0 / 60%);
  }
  .ur-pregame-hero .ur-page-description {
    max-width: 52ch;
    margin-top: 0.55rem;
  }
  .ur-pregame-status {
    display: grid;
    gap: 0.3rem;
    min-width: min(16rem, 100%);
    padding: 0.8rem 1rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 35%, var(--ur-line));
    border-radius: 0.7rem;
    background: rgb(6 9 12 / 68%);
  }
  .ur-pregame-status strong {
    color: #fff;
    font-size: 1rem;
  }
  .ur-pregame-status small {
    color: var(--ur-muted);
    font-size: 0.7rem;
  }
  .ur-clear-dots {
    display: flex;
    gap: 0.35rem;
    margin-top: 0.3rem;
  }
  .ur-clear-dots i {
    width: 1.6rem;
    height: 0.4rem;
    border-radius: 999px;
    background: var(--ur-line-strong);
  }
  .ur-clear-dots i[data-done='true'] {
    background: linear-gradient(90deg, #e9a91f, var(--ur-apex));
    box-shadow: 0 0 8px rgb(255 197 61 / 50%);
  }

  .ur-gamecast {
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 30%, var(--ur-line-strong));
    border-radius: 0.75rem;
    background:
      linear-gradient(180deg, rgb(255 197 61 / 5%), transparent 22%),
      linear-gradient(165deg, #141c21, #0b1114 75%);
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 40%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
    padding: clamp(0.75rem, 2vw, 1.25rem);
  }

  .ur-broadcast-mast {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 1.5rem;
    padding: 0.8rem 1rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 24%, var(--ur-line));
    border-radius: 0.75rem;
    margin-bottom: 0.75rem;
    background: linear-gradient(180deg, rgb(255 255 255 / 2%), transparent 40%), var(--ur-surface);
  }

  .ur-broadcast-note {
    margin: 0;
    color: var(--ur-muted);
    font-size: 0.82rem;
  }

  .ur-scoreboard {
    overflow: hidden;
    padding: clamp(1rem, 3vw, 1.8rem);
    border: 1px solid color-mix(in srgb, var(--ur-apex) 32%, var(--ur-line-strong));
    border-radius: 0.75rem;
    background:
      linear-gradient(180deg, rgb(255 197 61 / 7%), transparent 26%),
      linear-gradient(
        90deg,
        transparent 49.8%,
        color-mix(in srgb, var(--ur-paper) 8%, transparent) 50%,
        transparent 50.2%
      ),
      repeating-linear-gradient(
        0deg,
        transparent 0 31px,
        color-mix(in srgb, var(--ur-paper) 4%, transparent) 32px
      ),
      radial-gradient(
        ellipse at 50% 0%,
        color-mix(in srgb, var(--ur-apex) 14%, transparent),
        transparent 62%
      ),
      linear-gradient(165deg, #141c21, #0b1114 75%);
    box-shadow:
      0 0 2rem rgb(255 197 61 / 8%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
  }

  .ur-play-again {
    min-height: 2.75rem;
    padding: 0.6rem 1rem;
    border: 1px solid var(--ur-apex);
    border-radius: 0.55rem;
    background: linear-gradient(180deg, #ffda73, var(--ur-apex));
    color: #241a02;
    font-size: 0.86rem;
    font-weight: 900;
    box-shadow:
      0 0.4rem 1.2rem rgb(245 184 31 / 35%),
      inset 0 1px 0 rgb(255 255 255 / 55%);
  }

  .ur-play-again:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .ur-scoreline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(0.65rem, 5vw, 3rem);
    padding-block: clamp(1.3rem, 5vw, 3rem);
    border-block: 1px solid var(--ur-line-strong);
    margin-block: 1rem;
  }

  .ur-scoreline > div {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: center;
  }

  .ur-scoreline > div > span {
    color: var(--ur-muted);
    font-size: 0.78rem;
    font-weight: 700;
  }

  .ur-scoreline strong {
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(3.7rem, 13vw, 7rem);
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    line-height: 0.95;
    text-shadow: 0 2px 24px rgb(0 0 0 / 65%);
  }

  .ur-score-divider {
    color: var(--ur-line-strong);
    font-family: var(--font-display);
    font-size: clamp(2rem, 8vw, 4rem);
  }

  .ur-gamecast-controls {
    display: flex;
    justify-content: flex-start;
    margin-top: 1rem;
    padding-block: 0.75rem;
    border-block: 1px solid var(--ur-line);
  }

  .ur-recorded-events li {
    border: 1px solid var(--ur-line);
    border-inline-start: 2px solid var(--ur-apex);
    border-radius: 0.6rem;
    background: var(--ur-surface);
    padding: 0.6rem 0.75rem;
  }

  .ur-gamecast .rounded-xl.bg-surface-2 {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 22%, var(--ur-line));
    border-radius: 0.75rem;
    background: var(--ur-surface);
  }

  .ur-play-page section[aria-label='Game setup'],
  .ur-play-page section[aria-label='Challenge browser'] {
    padding: clamp(1rem, 2.5vw, 1.5rem);
  }

  .ur-reward-preview {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 34%, var(--ur-line-strong));
    border-radius: 0.75rem;
    background:
      linear-gradient(105deg, color-mix(in srgb, var(--ur-apex) 14%, transparent), transparent 62%),
      linear-gradient(165deg, #141c21, #0b1114 75%);
    box-shadow:
      0 0 2rem rgb(255 197 61 / 10%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
  }

  .ur-reward-title {
    font-size: 1.1rem;
  }

  .ur-reward-preview li,
  .ur-selected-challenge li {
    border: 1px solid var(--ur-line);
    border-radius: 0.6rem;
  }

  .ur-selected-challenge {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 30%, var(--ur-line-strong));
    border-radius: 0.75rem;
    background:
      linear-gradient(180deg, rgb(255 197 61 / 5%), transparent 22%),
      linear-gradient(165deg, #141c21, #0b1114 75%);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%);
  }

  .ur-selected-challenge:focus-visible {
    outline: 3px solid var(--ur-focus);
    outline-offset: 2px;
  }

  .ur-challenge-grid > :global(*) {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 26%, var(--ur-line-strong)) !important;
    border-radius: 0.75rem !important;
    background:
      linear-gradient(180deg, rgb(255 197 61 / 5%), transparent 22%),
      linear-gradient(165deg, #141c21, #0b1114 75%) !important;
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 40%),
      inset 0 1px 0 rgb(255 255 255 / 6%) !important;
  }

  .ur-play-page :global(fieldset .card) {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 26%, var(--ur-line-strong)) !important;
    border-radius: 0.75rem !important;
    background:
      linear-gradient(180deg, rgb(255 255 255 / 2%), transparent 35%), var(--ur-raised) !important;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 5%) !important;
  }

  .ur-play-page :global(fieldset input:checked + .card) {
    border-color: var(--ur-apex) !important;
    background:
      linear-gradient(180deg, rgb(255 218 115 / 16%), rgb(255 197 61 / 7%)), var(--ur-raised) !important;
    box-shadow:
      0 0 1.2rem rgb(255 197 61 / 18%),
      inset 0 1px 0 rgb(255 255 255 / 8%) !important;
  }

  .ur-play-page :global(fieldset input:focus-visible + .card) {
    outline: 3px solid var(--ur-focus) !important;
    outline-offset: 2px !important;
  }

  .ur-play-page :global(.ur-matchup-report) {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 30%, var(--ur-line-strong)) !important;
    border-radius: 0.75rem !important;
  }

  .ur-play-page :global(.ur-reward-receipt) {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 30%, var(--ur-line-strong)) !important;
    border-radius: 0.75rem !important;
    background:
      linear-gradient(105deg, color-mix(in srgb, var(--ur-apex) 14%, transparent), transparent 62%),
      linear-gradient(165deg, #141c21, #0b1114 75%) !important;
    box-shadow:
      0 0 2rem rgb(255 197 61 / 10%),
      inset 0 1px 0 rgb(255 255 255 / 6%) !important;
  }

  .ur-play-page :global(.ur-reward-receipt .ur-receipt-total) {
    border: 1px solid var(--ur-apex) !important;
    border-radius: 0.75rem !important;
    background: linear-gradient(180deg, #ffda73, var(--ur-apex)) !important;
    color: #241a02 !important;
  }

  .ur-play-page :global(.ur-reward-receipt .ur-receipt-total span) {
    color: #241a02 !important;
  }

  .ur-play-page .rounded-xl.bg-surface-2 {
    border-radius: 0.75rem;
  }

  .ur-play-page table {
    border-collapse: collapse;
  }

  .ur-play-page tbody tr {
    border-top: 1px solid var(--ur-line);
  }

  .ur-play-page th,
  .ur-play-page td {
    padding-block: 0.4rem;
  }

  .ur-scout-panel {
    margin-top: 1rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 26%, var(--ur-line-strong));
    border-radius: 0.9rem;
    background: linear-gradient(165deg, #12181d, #0b1014 75%);
    box-shadow:
      0 1.2rem 2.5rem rgb(0 0 0 / 40%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
    padding: clamp(1rem, 2.6vw, 1.6rem);
  }
  .ur-scout-grid {
    display: grid;
    gap: 1.4rem;
    grid-template-columns: minmax(0, 1fr) minmax(0, 21rem);
    align-items: start;
  }
  .ur-scout-main {
    display: grid;
    gap: 1.2rem;
    min-width: 0;
  }
  .ur-step-head {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
  }
  .ur-step-head--two {
    margin-top: 0.2rem;
    padding-top: 1.1rem;
    border-top: 1px solid var(--ur-line);
  }
  .ur-step-num {
    color: var(--ur-apex);
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 900;
  }
  .ur-step-title {
    margin: 0;
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.15rem;
    font-weight: 850;
  }
  .ur-step-sub {
    margin: 0.15rem 0 0;
    color: var(--ur-muted);
    font-size: 0.76rem;
  }
  .ur-reward-preview {
    position: sticky;
    top: 1rem;
    padding: 1rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 38%, var(--ur-line-strong));
    border-radius: 0.8rem;
    background:
      linear-gradient(165deg, #171310, #0e0c0a 75%), linear-gradient(165deg, #141c21, #0b1114);
    box-shadow:
      0 0 2rem rgb(255 150 40 / 10%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
  }
  .ur-reward-title {
    margin: 0;
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.02rem;
    font-weight: 850;
  }
  .ur-reward-sub {
    margin: 0.25rem 0 0;
    color: var(--ur-muted);
    font-size: 0.7rem;
  }
  .ur-reward-rows {
    display: grid;
    gap: 0.45rem;
    margin: 0.8rem 0 0;
    padding: 0;
    list-style: none;
  }
  .ur-reward-rows li {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--ur-line);
    border-radius: 0.6rem;
    background: rgb(6 9 12 / 55%);
  }
  .ur-reward-icon {
    display: grid;
    width: 1.7rem;
    height: 1.7rem;
    flex: none;
    place-items: center;
    border-radius: 999px;
    background: rgb(255 197 61 / 12%);
    color: var(--ur-apex);
    font-size: 0.8rem;
    font-weight: 900;
  }
  .ur-reward-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
  }
  .ur-reward-label {
    color: var(--ur-paper);
    font-size: 0.8rem;
    font-weight: 800;
  }
  .ur-reward-detail {
    color: var(--ur-muted);
    font-size: 0.68rem;
  }
  .ur-reward-coins {
    flex: none;
    color: var(--ur-apex);
    font-size: 0.84rem;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }
  .ur-reward-coins[data-zero='true'] {
    color: var(--ur-muted);
  }
  .ur-reward-max {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    margin-top: 0.8rem;
    padding-top: 0.7rem;
    border-top: 1px solid var(--ur-line);
    color: var(--ur-muted);
    font-size: 0.74rem;
  }
  .ur-reward-max small {
    font-weight: 500;
  }
  .ur-reward-max strong {
    color: var(--ur-apex);
    font-size: 1.05rem;
  }
  .ur-reward-repeat {
    margin: 0.3rem 0 0;
    color: var(--ur-muted);
    font-size: 0.68rem;
  }
  .ur-prepare-btn {
    width: 100%;
    margin-top: 0.8rem;
  }
  .ur-reward-lock {
    margin: 0.55rem 0 0;
    color: var(--ur-muted);
    font-size: 0.68rem;
    text-align: center;
  }
  .ur-pending-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    margin-top: 1rem;
    padding: 0.85rem 1rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 26%, var(--ur-line));
    border-radius: 0.8rem;
    background: #10171c;
  }
  .ur-start-sim {
    min-width: 12rem;
  }
  .ur-pending-note {
    color: var(--ur-muted);
    font-size: 0.72rem;
  }
  .ur-final-board {
    text-align: center;
  }
  .ur-final-kicker {
    margin: 0;
    color: var(--ur-apex);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.04em;
  }
  .ur-final-kicker span:last-child {
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.3rem;
    font-weight: 900;
    letter-spacing: -0.02em;
  }
  .ur-final-coins {
    margin: 0.2rem 0 0;
    color: var(--ur-success);
    font-size: 0.9rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .ur-quarter-strip {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.4rem;
    margin: 0.9rem 0 0;
    padding: 0;
    list-style: none;
  }
  .ur-quarter-strip li {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--ur-line);
    border-radius: 0.45rem;
    background: rgb(6 9 12 / 55%);
    color: var(--ur-muted);
    font-size: 0.7rem;
  }
  .ur-quarter-strip strong {
    color: var(--ur-paper);
  }
  .ur-final-meta {
    margin: 0.6rem 0 0;
    color: var(--ur-muted);
    font-size: 0.76rem;
  }
  .ur-control-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
  }
  .ur-speed-pills {
    display: flex;
    gap: 0.4rem;
  }
  .ur-speed-pill {
    min-height: 2.5rem;
    padding: 0.45rem 0.95rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 28%, var(--ur-line));
    border-radius: 0.55rem;
    background: var(--ur-surface);
    color: var(--ur-paper);
    font-size: 0.78rem;
    font-weight: 800;
  }
  .ur-speed-pill[data-active='true'] {
    border-color: var(--ur-apex);
    background: linear-gradient(180deg, #ffda73, var(--ur-apex));
    color: #241a02;
  }
  .ur-replay-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .ur-replay-primary {
    min-height: 2.5rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--ur-apex);
    border-radius: 0.55rem;
    background: linear-gradient(180deg, #ffda73, var(--ur-apex));
    color: #241a02;
    font-size: 0.8rem;
    font-weight: 900;
  }
  .ur-replay-btn {
    min-height: 2.5rem;
    padding: 0.5rem 0.9rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 28%, var(--ur-line));
    border-radius: 0.55rem;
    background: var(--ur-surface);
    color: var(--ur-paper);
    font-size: 0.78rem;
    font-weight: 800;
  }
  .ur-replay-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .ur-event-meta {
    margin: 0.6rem 0 0;
    color: var(--ur-muted);
    font-size: 0.74rem;
  }
  .ur-recorded-events {
    display: grid;
    gap: 0.3rem;
    max-height: 18rem;
    margin: 0.6rem 0 0;
    padding: 0 0.15rem 0.15rem 0;
    overflow-y: auto;
    list-style: none;
  }
  .ur-recorded-events li {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    font-size: 0.78rem;
  }
  .ur-event-q {
    flex: none;
    min-width: 1.8rem;
    color: var(--ur-apex);
    font-size: 0.68rem;
    font-weight: 900;
  }
  .ur-facts-grid {
    display: grid;
    gap: 0.8rem;
    margin-top: 1rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ur-facts-panel {
    padding: 0.9rem 1rem;
    border: 1px solid var(--ur-line);
    border-radius: 0.7rem;
    background: #10171c;
    font-size: 0.8rem;
  }
  .ur-facts-panel h3 {
    margin: 0 0 0.45rem;
    color: #fff;
    font-size: 0.84rem;
    font-weight: 850;
  }
  .ur-facts-panel ul {
    display: grid;
    gap: 0.2rem;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--ur-muted);
  }
  .ur-facts-panel p {
    margin: 0;
    color: var(--ur-muted);
  }
  .ur-play-again--mast {
    min-height: 2.5rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .ur-play-page :global(*) {
      animation: none !important;
      transition: none !important;
    }

    .mode-pill {
      transition: none;
    }
  }

  @media (max-width: 1080px) {
    .ur-scout-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .ur-reward-preview {
      position: static;
    }
  }

  @media (max-width: 520px) {
    .ur-pregame-hero {
      flex-direction: column;
      align-items: flex-start;
    }

    .ur-pregame-status {
      width: 100%;
    }

    .ur-control-bar {
      flex-direction: column;
      align-items: stretch;
    }

    .ur-facts-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .ur-gamecast-controls {
      justify-content: flex-start;
    }
  }
</style>
