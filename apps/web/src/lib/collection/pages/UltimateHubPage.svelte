<script lang="ts">
  import { onDestroy } from 'svelte';
  import { asset, resolve } from '$app/paths';
  import type {
    CollectionCatalog,
    CollectionGameRecordUnion,
    CollectionPlayState,
    CollectionProgressionRules,
    CollectionState,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { validateCollectionActiveTeam } from '@hoop-rush/engine';
  import AsyncState from '$lib/components/AsyncState.svelte';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import { getManifest } from '$lib/data';
  import {
    ensureCollection,
    ensurePlayStateSnapshot,
    loadCommittedGame,
  } from '$lib/collection/collection-hub.ts';
  import {
    loadCollectionCatalog,
    loadCollectionProgression,
  } from '$lib/collection/collection-assets.ts';
  import {
    humanizeIdentifier,
    setProgressViews,
  } from '$lib/collection/collection-progression-view.ts';
  import { ultimateNextActionOf } from '$lib/collection/ultimate-hub.ts';
  import { getContext } from 'svelte';
  import {
    ULTIMATE_RUN_SHELL_CONTEXT,
    type UltimateRunShell,
  } from '$lib/collection/ultimate-shell.svelte';

  const shell = getContext<UltimateRunShell>(ULTIMATE_RUN_SHELL_CONTEXT);
  let mounted = true;
  onDestroy(() => {
    mounted = false;
  });

  const SHORT_SLOT_LABELS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;

  let phase = $state<'loading' | 'error' | 'ready'>('loading');
  let error = $state<string | null>(null);
  let collectionState = $state<CollectionState | null>(null);
  let catalog = $state<CollectionCatalog | null>(null);
  let progression = $state<CollectionProgressionRules | null>(null);
  let playState = $state<CollectionPlayState | null>(null);
  let manifest = $state<HoopRushManifest | null>(null);
  let recentGame = $state<CollectionGameRecordUnion | null>(null);

  async function load(): Promise<void> {
    phase = 'loading';
    error = null;
    try {
      const [state, loadedCatalog, loadedManifest] = await Promise.all([
        ensureCollection(new Date().toISOString()),
        loadCollectionCatalog(),
        getManifest(),
      ]);
      if (!mounted) return;
      collectionState = state;
      catalog = loadedCatalog;
      manifest = loadedManifest;
      shell.sync(state, loadedCatalog.cards.length);
      if (state.claimedWelcome) {
        const snapshot = await ensurePlayStateSnapshot(new Date().toISOString());
        if (!mounted) return;
        playState = snapshot.playState;
        const rawGameId = sessionStorage.getItem('collection-last-game');
        if (rawGameId) {
          recentGame = await loadCommittedGame(rawGameId).catch(() => null);
        }
      }
      void loadCollectionProgression()
        .then((loaded) => {
          if (mounted) progression = loaded;
        })
        .catch(() => {
          if (mounted) progression = null;
        });
      phase = 'ready';
    } catch (failure) {
      if (!mounted) return;
      error = failure instanceof Error ? failure.message : 'Ultimate Run could not load.';
      phase = 'error';
    }
  }

  $effect(() => {
    void load();
  });

  $effect(() => {
    if (collectionState && catalog) shell.sync(collectionState, catalog.cards.length);
  });

  const ownedIds = $derived(new Set((collectionState?.owned ?? []).map((card) => card.cardId)));
  const savedTeam = $derived(playState?.activeTeam ?? null);
  const teamCheck = $derived(
    savedTeam && catalog
      ? validateCollectionActiveTeam(
          savedTeam,
          (cardId) => catalog?.cards.find((card) => card.cardId === cardId),
          ownedIds,
        )
      : null,
  );
  const teamCards = $derived(
    savedTeam?.starters.map(
      (cardId) => catalog?.cards.find((card) => card.cardId === cardId) ?? null,
    ) ?? [],
  );
  const affordablePack = $derived.by(() => {
    const state = collectionState;
    if (!state?.claimedWelcome || !catalog) return null;
    return (
      catalog.packs.find((pack) => state.balances[pack.priceCurrency] >= pack.priceAmount)
        ?.packId ?? null
    );
  });
  const nextAction = $derived(
    ultimateNextActionOf({
      starterClaimed: collectionState?.claimedWelcome ?? false,
      team: {
        exists: savedTeam !== null,
        valid: teamCheck?.ok ?? false,
        saved: savedTeam !== null,
      },
      pendingMatchup: playState?.pendingGame !== null && playState?.pendingGame !== undefined,
      unviewedResult: recentGame !== null,
      affordablePackId: affordablePack,
    }),
  );
  const availablePacks = $derived.by(() => {
    const state = collectionState;
    if (!state || !catalog) return [];
    return catalog.packs.filter((pack) => state.balances[pack.priceCurrency] >= pack.priceAmount);
  });
  const sets = $derived(
    collectionState && progression && catalog
      ? setProgressViews({
          progression,
          catalog,
          ownedCardIds: ownedIds,
          claimedSetIds: collectionState.claimedSetIds,
        })
      : [],
  );

  const ownedCount = $derived(collectionState?.owned.length ?? 0);
  const totalCount = $derived(catalog?.cards.length ?? 0);
  const completePct = $derived(
    totalCount > 0 ? Math.min(100, Math.round((ownedCount / totalCount) * 100)) : 0,
  );
  const coins = $derived(collectionState?.balances.Coins ?? 0);
  const exchange = $derived(collectionState?.balances.Exchange ?? 0);
  const latestPull = $derived(shell.snapshot?.latestPull ?? null);
  const chaseSets = $derived(sets.slice(0, 3));
  const shelfPacks = $derived(availablePacks.slice(0, 3));

  function initialsOf(name: string): string {
    return name
      .split(' ')
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function overallOf(cardId: string): number | null {
    return (
      catalog?.cards.find((card) => card.cardId === cardId)?.summarySource?.overallRating ?? null
    );
  }

  function fmt(value: number): string {
    return value.toLocaleString('en-US');
  }

  function packNameOf(packId: string | null): string {
    if (!packId) return 'Starter';
    return humanizeIdentifier(packId);
  }

  function packTone(packId: string): string {
    if (packId === 'tip-off') return 'gold';
    if (packId === 'fast-break') return 'ember';
    if (packId === 'full-court') return 'eclipse';
    if (packId === 'main-event') return 'apex';
    return 'titan';
  }

  function setTone(title: string, setId: string): string {
    const hay = `${title} ${setId}`.toLowerCase();
    if (hay.includes('apex')) return 'apex';
    if (hay.includes('eruption')) return 'eruption';
    if (hay.includes('eclipse')) return 'eclipse';
    return 'ember';
  }

  function setGlyph(title: string, setId: string): string {
    const hay = `${title} ${setId}`.toLowerCase();
    if (hay.includes('apex')) return 'A';
    if (hay.includes('eruption')) return 'E';
    if (hay.includes('eclipse')) return 'C';
    return title.charAt(0).toUpperCase();
  }

  function timeAgo(iso: string): string {
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return '';
    const diffMs = Date.now() - then;
    if (diffMs < 0) return 'just now';
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function scoreOf(game: CollectionGameRecordUnion): { home: number; away: number } {
    if (game.result.outcome === 'completed') {
      return { home: game.result.home.score, away: game.result.away.score };
    }
    return { home: game.result.homeScore, away: game.result.awayScore };
  }

  function rewardCoinsOf(game: CollectionGameRecordUnion): number {
    if (game.gameVersion === 'collection-game-v1') return game.reward.amount;
    return game.reward.total;
  }

  function gameLabelOf(game: CollectionGameRecordUnion): string {
    if (game.gameVersion === 'collection-game-v3') {
      return game.prepared.challenge.displayName;
    }
    if (game.gameVersion === 'collection-game-v2') {
      return `${humanizeIdentifier(game.prepared.difficulty.difficultyId)} game`;
    }
    return 'Ultimate Run game';
  }

  function objectiveSummaryOf(game: CollectionGameRecordUnion): string {
    if (game.gameVersion === 'collection-game-v1') return 'Standard table';
    const evaluation = game.objectiveEvaluation;
    if (evaluation.kind === 'not-selected') return 'No objective';
    if (evaluation.kind === 'forfeit') return 'Forfeit';
    return evaluation.success ? 'Objective passed' : 'Objective failed';
  }

  function marginOf(game: CollectionGameRecordUnion): string {
    if (game.result.outcome !== 'completed') return 'Forfeit';
    const { home, away } = scoreOf(game);
    const margin = Math.abs(home - away);
    return `${margin} pts`;
  }

  function resultHref(game: CollectionGameRecordUnion): string {
    if (game.gameVersion === 'collection-game-v3') return '/ultimate/run/play?mode=challenges';
    return '/ultimate/run/play';
  }
</script>

<svelte:head>
  <meta
    name="description"
    content="Continue your Ultimate Run: collect cards, build a team, and play."
  />
</svelte:head>

<div class="ur-hub">
  {#if phase === 'loading'}
    <AsyncState
      kind="loading"
      title="Opening your run"
      message="Loading your collection and lineup…"
    />
  {:else if phase === 'error'}
    <AsyncState
      kind="error"
      title="Your run could not load"
      message={error ?? 'Unknown error.'}
      retry={() => void load()}
    />
  {:else if collectionState}
    <section class="ur-hub-hero" aria-labelledby="hub-hero-title">
      <div class="ur-hub-hero-copy">
        <p class="ur-hub-overline">Your next move</p>
        <h2 id="hub-hero-title">
          {collectionState.claimedWelcome
            ? 'Make the next possession yours.'
            : 'Start building your collection.'}
        </h2>
        <p class="ur-hub-detail">
          {nextAction.detail} Keep building your collection and take on new challenges.
        </p>
        <a class="ur-primary-action" href={resolve(nextAction.href as any)}>
          {nextAction.label}
          <svg viewBox="0 0 16 16" aria-hidden="true" class="ur-arrow">
            <path
              d="M2 8h10M8.5 4.5 12 8l-3.5 3.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </a>
        <div class="ur-hub-scoreline" aria-label="Collection totals">
          <div class="ur-stat-tile">
            <svg viewBox="0 0 20 20" aria-hidden="true" class="ur-stat-icon">
              <rect x="2.5" y="5.5" width="11" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6" />
              <path d="M5.5 5.5V4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 16.5 4v9" fill="none" stroke="currentColor" stroke-width="1.6" />
            </svg>
            <strong class="ur-number">{fmt(ownedCount)}</strong>
            <span>Cards owned</span>
            <small>
              {#if latestPull}
                +{latestPull.newCount} from last pack
              {:else}
                {fmt(ownedCount)} in the binder
              {/if}
            </small>
          </div>
          <div class="ur-stat-tile">
            <svg viewBox="0 0 20 20" aria-hidden="true" class="ur-stat-icon">
              <path d="M10 2.5 17.5 6.5 10 10.5 2.5 6.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
              <path d="m2.5 10 7.5 4 7.5-4M2.5 13.5 10 17.5l7.5-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
            </svg>
            <strong class="ur-number">{totalCount > 0 ? fmt(totalCount) : '—'}</strong>
            <span>In the collection</span>
            <small>{completePct}% complete</small>
            <span class="ur-mini-track" aria-hidden="true">
              <span style={`width:${completePct}%`}></span>
            </span>
          </div>
          <div class="ur-stat-tile">
            <span class="ur-coin" aria-hidden="true">C</span>
            <strong class="ur-number">{fmt(coins)}</strong>
            <span>Coins</span>
            <small>{fmt(exchange)} Exchange</small>
          </div>
        </div>
      </div>
      <section class="ur-hub-lineup" aria-labelledby="hub-lineup-title">
        <div class="ur-hub-lineup-heading">
          <div>
            <h3 id="hub-lineup-title">Your starting five</h3>
            <p>
              {savedTeam
                ? teamCheck?.ok
                  ? 'Five cards, ready to play. Edit your lineup, try new combinations, and chase higher rewards.'
                  : 'Lineup needs attention before the next game.'
                : 'Five cards, ready to play. Edit your lineup, try new combinations, and chase higher rewards.'}
            </p>
          </div>
          <a class="ur-edit-lineup" href={resolve('/ultimate/run/team' as any)}>
            <svg viewBox="0 0 16 16" aria-hidden="true" class="ur-pencil">
              <path
                d="M11.2 2.4a1.4 1.4 0 0 1 2 2L5.4 12.2l-2.7.7.7-2.7Z"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linejoin="round"
              />
            </svg>
            {savedTeam ? 'Edit lineup' : 'Build team'}
          </a>
        </div>
        {#if savedTeam}
          <ol class="ur-hub-lineup-cards">
            {#each teamCards as card, index (savedTeam.starters[index])}
              {@const ovr = card ? overallOf(card.cardId) : null}
              {@const tone = card?.rarity.toLowerCase() ?? 'empty'}
              <li class="ur-hub-player-card ur-hub-player-card--{tone}">
                <span class="ur-hub-slot">{SHORT_SLOT_LABELS[index] ?? '—'}</span>
                <span class="ur-hub-ovr ur-number">{ovr ?? '—'}</span>
                <span class="ur-hub-face">
                  {#if manifest && card}
                    <PlayerFace
                      player={{
                        playerId: card.playerId,
                        playerExternalId: card.playerExternalId,
                        altIds: null,
                      }}
                      {manifest}
                      size="xl"
                      fallbackInitials={initialsOf(card.displayName)}
                    />
                  {:else}
                    <span class="ur-hub-empty-face" aria-hidden="true">+</span>
                  {/if}
                </span>
                <span class="ur-hub-player-name">{card?.displayName ?? 'Open slot'}</span>
                <span class="ur-hub-player-facts">{card?.rarity ?? 'Choose a card'}</span>
                <span class="ur-hub-mark" aria-hidden="true">
                  <img src={asset('/ultimate/logo.svg')} alt="" width="18" height="18" loading="lazy" />
                </span>
              </li>
            {/each}
          </ol>
        {:else}
          <a class="ur-hub-lineup-empty" href={resolve('/ultimate/run/team' as any)}>
            <span aria-hidden="true">+</span>
            <strong>Build a legal five</strong>
            <small>Assign guards, forwards, and a center to unlock Play.</small>
          </a>
        {/if}
      </section>
    </section>

    <div class="ur-hub-grid">
      <section class="ur-hub-panel ur-run-snapshot" aria-labelledby="run-snapshot-title">
        <div class="ur-panel-heading">
          <h3 id="run-snapshot-title">Last game</h3>
          <a class="ur-panel-link" href={resolve('/ultimate/run/play' as any)}>
            {playState?.pendingGame ? 'Resume' : recentGame ? 'Play again' : 'Play'}
            <span aria-hidden="true">→</span>
          </a>
        </div>
        {#if playState?.pendingGame}
          <div class="ur-score-hero">
            <span class="ur-status-badge">Matchup ready</span>
            <strong class="ur-score-hero-title">
              {playState.pendingGame.gameVersion === 'collection-game-v3'
                ? playState.pendingGame.challenge.displayName
                : playState.pendingGame.gameVersion === 'collection-game-v2'
                  ? `${humanizeIdentifier(playState.pendingGame.difficulty.difficultyId)} game`
                  : 'Legacy matchup'}
            </strong>
            <p>The setup is saved. Continue in Play to start the game.</p>
          </div>
        {:else if recentGame}
          {@const gameScore = scoreOf(recentGame)}
          {@const won = recentGame.result.winner === 'home'}
          {@const rewardCoins = rewardCoinsOf(recentGame)}
          <div class="ur-score-hero">
            <span class="ur-status-badge ur-status-badge--win">{won ? 'Win' : 'Loss'}</span>
            <strong class="ur-result-score ur-number">
              {gameScore.home}<span> - </span>{gameScore.away}
            </strong>
            <p>
              Final score · {gameLabelOf(recentGame)}
              {#if timeAgo(recentGame.completedAtIso)}
                <span class="ur-game-ago"> · {timeAgo(recentGame.completedAtIso)}</span>
              {/if}
            </p>
          </div>
          <div class="ur-reward-trio">
            <div>
              <span class="ur-coin ur-coin--sm" aria-hidden="true">C</span>
              <strong class="ur-number">+ {fmt(rewardCoins)}</strong>
              <span>Coins earned</span>
            </div>
            <div>
              <svg viewBox="0 0 20 20" aria-hidden="true" class="ur-trio-icon">
                <path d="M10 2.5 17.5 6.5 10 10.5 2.5 6.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
                <path d="m2.5 10 7.5 4 7.5-4M2.5 13.5 10 17.5l7.5-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
              </svg>
              <strong>{objectiveSummaryOf(recentGame)}</strong>
              <span>Objective</span>
            </div>
            <div>
              <span class="ur-xp" aria-hidden="true">XP</span>
              <strong class="ur-number">{marginOf(recentGame)}</strong>
              <span>Margin</span>
            </div>
          </div>
          <a class="ur-quiet-link" href={resolve(resultHref(recentGame) as any)}>View result →</a>
        {:else}
          <div class="ur-score-hero">
            <span class="ur-status-badge">No game in progress</span>
            <strong class="ur-score-hero-title">Take the court</strong>
            <p>Your score, play-by-play, and rewards are saved from the game record.</p>
          </div>
        {/if}
      </section>

      <section class="ur-hub-panel ur-chase-panel" aria-labelledby="collection-chase-title">
        <div class="ur-panel-heading">
          <h3 id="collection-chase-title">Collection chase</h3>
          <a class="ur-panel-link" href={resolve('/ultimate/run/collection' as any)}>
            Browse cards <span aria-hidden="true">→</span>
          </a>
        </div>
        <p class="ur-panel-sub">Progress across the three launch sets.</p>
        {#if chaseSets.length > 0}
          <div class="ur-chase-body">
            <ul class="ur-set-progress-list">
              {#each chaseSets as set (set.setId)}
                {@const tone = setTone(set.title, set.setId)}
                {@const pct = set.requiredCount > 0 ? Math.round((set.ownedCount / set.requiredCount) * 100) : 0}
                <li>
                  <span class="ur-set-glyph ur-set-glyph--{tone}" aria-hidden="true">
                    {setGlyph(set.title, set.setId)}
                  </span>
                  <span class="ur-set-meta">
                    <span class="ur-set-row">
                      <span class="ur-set-name">{set.title}</span>
                      <span class="ur-set-count ur-number">{set.ownedCount} / {set.requiredCount}</span>
                    </span>
                    <span class="ur-progress-track" aria-label={`${set.ownedCount} of ${set.requiredCount} cards`}>
                      <span class="ur-progress-fill ur-progress-fill--{tone}" style={`width:${Math.min(100, pct)}%`}></span>
                    </span>
                  </span>
                  <span class="ur-set-pct ur-number ur-set-pct--{tone}">{pct}%</span>
                </li>
              {/each}
            </ul>
            <div class="ur-pack-art" aria-hidden="true">
              <div class="ur-pack ur-pack--back">
                <img src={asset('/ultimate/logo.svg')} alt="" width="40" height="40" loading="lazy" />
                <span>UR</span>
              </div>
              <div class="ur-pack ur-pack--front">
                <img src={asset('/ultimate/logo.svg')} alt="" width="52" height="52" loading="lazy" />
                <span>UR</span>
              </div>
            </div>
          </div>
        {:else}
          <p class="ur-empty-line">Claim your starter to begin filling the launch sets.</p>
        {/if}
      </section>

      <section class="ur-hub-panel ur-pack-shortcuts" aria-labelledby="pack-shortcuts-title">
        <div class="ur-panel-heading">
          <h3 id="pack-shortcuts-title">On the shelf</h3>
          <a class="ur-panel-link" href={resolve('/ultimate/run/packs' as any)}>
            Full odds <span aria-hidden="true">→</span>
          </a>
        </div>
        <p class="ur-panel-sub">Useful packs you can afford now.</p>
        {#if shelfPacks.length > 0}
          <ul>
            {#each shelfPacks as pack (pack.packId)}
              <li>
                <a class="ur-shelf-row" href={resolve('/ultimate/run/packs' as any)}>
                  <span class="ur-shelf-thumb ur-shelf-thumb--{packTone(pack.packId)}" aria-hidden="true">
                    <img src={asset('/ultimate/logo.svg')} alt="" width="26" height="26" loading="lazy" />
                  </span>
                  <span class="ur-shelf-meta">
                    <strong>{packNameOf(pack.packId)}</strong>
                    <small>{pack.slots.length} {pack.slots.length === 1 ? 'card' : 'cards'}</small>
                  </span>
                  <span class="ur-pack-price">
                    <span class="ur-coin ur-coin--sm" aria-hidden="true">C</span>
                    <span class="ur-number">{fmt(pack.priceAmount)} {pack.priceCurrency}</span>
                  </span>
                  <span class="ur-chevron" aria-hidden="true">›</span>
                </a>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="ur-empty-line">No packs are affordable with the current balances.</p>
          <a class="ur-text-action" href={resolve('/ultimate/run/play' as any)}>Play for Coins</a>
        {/if}
      </section>

      {#if latestPull}
        <a class="ur-recent-receipt" href={resolve('/ultimate/run/packs' as any)}>
          <span class="ur-receipt-gift" aria-hidden="true">
            <svg viewBox="0 0 20 20" class="ur-gift-icon">
              <rect x="2.5" y="7.5" width="15" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6" />
              <path d="M2.5 4.5h15V7.5h-15zM10 4.5v13" fill="none" stroke="currentColor" stroke-width="1.6" />
              <path d="M10 4.5C7.5 4.5 5.5 4 5.5 2.8 5.5 1.9 6.2 1.5 7 1.5c1.6 0 3 3 3 3Zm0 0c2.5 0 4.5-.5 4.5-1.7 0-.9-.7-1.3-1.5-1.3-1.6 0-3 3-3 3Z" fill="none" stroke="currentColor" stroke-width="1.3" />
            </svg>
          </span>
          <span class="ur-receipt-copy">
            <strong>{packNameOf(latestPull.packId)} received</strong>
            <small>
              {latestPull.newCount} new {latestPull.newCount === 1 ? 'card' : 'cards'} · +{latestPull.exchangeGained} Exchange from duplicates
            </small>
          </span>
          <span class="ur-receipt-view">View receipt <span aria-hidden="true">→</span></span>
        </a>
      {/if}
    </div>
  {/if}
</div>

<style>
  .ur-hub {
    display: grid;
    gap: 1rem;
    padding: clamp(0.75rem, 2vw, 1.25rem);
    border: 1px solid rgb(255 197 61 / 22%);
    border-radius: 1rem;
    background:
      radial-gradient(ellipse 70% 32% at 50% 0%, rgb(255 197 61 / 18%), transparent 65%),
      radial-gradient(ellipse 90% 30% at 50% 100%, rgb(201 140 69 / 16%), transparent 65%),
      radial-gradient(ellipse 120% 100% at 50% 45%, transparent 55%, rgb(0 0 0 / 55%) 100%),
      linear-gradient(180deg, #0e151b 0%, #0a0f13 55%, #0d0a06 100%);
    box-shadow:
      0 1.5rem 3rem rgb(0 0 0 / 45%),
      inset 0 1px 0 rgb(255 255 255 / 8%);
  }

  .ur-hub-hero {
    position: relative;
    display: grid;
    grid-template-columns: minmax(19rem, 0.82fr) minmax(0, 1.5fr);
    overflow: hidden;
    border: 1px solid rgb(255 197 61 / 28%);
    border-radius: 0.9rem;
    background:
      radial-gradient(ellipse 60% 45% at 50% 0%, rgb(255 255 255 / 14%), transparent 60%),
      radial-gradient(ellipse 45% 60% at 88% 20%, rgb(255 122 26 / 22%), transparent 65%),
      radial-gradient(ellipse 55% 50% at 12% 100%, rgb(255 197 61 / 7%), transparent 60%),
      linear-gradient(112deg, #10161b 0%, #0b1014 45%, #131a20 100%);
    box-shadow:
      0 1.5rem 3rem rgb(0 0 0 / 45%),
      inset 0 1px 0 rgb(255 255 255 / 8%);
  }

  .ur-hub-hero::after {
    position: absolute;
    inset: 0;
    background:
      repeating-linear-gradient(90deg, transparent 0 79px, rgb(240 236 223 / 3%) 80px),
      radial-gradient(ellipse 80% 55% at 50% 110%, rgb(201 140 69 / 12%), transparent 60%);
    content: '';
    pointer-events: none;
  }

  .ur-hub-hero-copy,
  .ur-hub-lineup {
    position: relative;
    z-index: 1;
  }

  .ur-hub-hero-copy {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    padding: clamp(1.25rem, 3vw, 2.25rem);
    background: linear-gradient(90deg, rgb(8 11 14 / 82%) 0%, rgb(8 11 14 / 55%) 55%, transparent 100%);
  }

  .ur-hub-overline {
    color: var(--ur-apex);
    font-family: var(--font-display);
    font-size: 0.74rem;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .ur-hub-hero h2 {
    max-width: 12ch;
    margin-top: 0.55rem;
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(2.5rem, 5vw, 4rem);
    font-weight: 900;
    letter-spacing: -0.02em;
    line-height: 0.95;
    text-wrap: balance;
  }

  .ur-hub-detail {
    max-width: 40ch;
    margin-top: 0.9rem;
    color: #c3caca;
    font-size: 0.88rem;
    line-height: 1.5;
  }

  .ur-primary-action {
    display: inline-flex;
    min-height: 2.9rem;
    align-items: center;
    gap: 0.55rem;
    margin-top: 1.2rem;
    padding: 0.65rem 1.35rem;
    border-radius: 999px;
    background: linear-gradient(180deg, #ffd35c, var(--ur-apex));
    color: #241a02;
    font-size: 0.92rem;
    font-weight: 800;
    box-shadow:
      0 0.5rem 1.4rem rgb(255 197 61 / 28%),
      inset 0 1px 0 rgb(255 255 255 / 45%);
  }

  .ur-primary-action:hover {
    background: #ffda73;
  }

  .ur-arrow {
    width: 1rem;
    height: 1rem;
  }

  .ur-hub-scoreline {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.6rem;
    width: 100%;
    margin-top: 1.35rem;
  }

  .ur-stat-tile {
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    padding: 0.7rem 0.75rem 0.65rem;
    border: 1px solid rgb(255 197 61 / 20%);
    border-radius: 0.6rem;
    background: rgb(10 14 17 / 78%);
    backdrop-filter: blur(6px);
  }

  .ur-stat-icon {
    width: 1.05rem;
    height: 1.05rem;
    margin-bottom: 0.35rem;
    color: #8d979b;
  }

  .ur-stat-tile strong {
    color: #f5f1e4;
    font-family: var(--font-display);
    font-size: clamp(1.35rem, 2.6vw, 1.8rem);
    font-weight: 800;
    line-height: 1;
  }

  .ur-stat-tile > span {
    color: #9aa4a6;
    font-size: 0.7rem;
  }

  .ur-stat-tile small {
    color: #6fce97;
    font-size: 0.68rem;
    font-weight: 600;
  }

  .ur-mini-track {
    display: block;
    width: 100%;
    height: 0.28rem;
    margin-top: 0.4rem;
    border-radius: 999px;
    background: rgb(255 255 255 / 12%);
  }

  .ur-mini-track > span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--ur-ember), var(--ur-apex));
  }

  .ur-coin {
    display: inline-grid;
    width: 1.5rem;
    height: 1.5rem;
    place-items: center;
    margin-bottom: 0.35rem;
    border-radius: 999px;
    background: radial-gradient(circle at 35% 30%, #ffe39a, var(--ur-apex) 60%, #9a7414);
    color: #241a02;
    font-size: 0.8rem;
    font-weight: 900;
    box-shadow: inset 0 0 0 2px rgb(36 26 2 / 25%);
  }

  .ur-coin--sm {
    width: 1.1rem;
    height: 1.1rem;
    margin-bottom: 0;
    font-size: 0.62rem;
  }

  .ur-hub-lineup {
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
    justify-content: center;
    overflow: hidden;
    padding: clamp(1rem, 2.4vw, 1.75rem);
    border-left: 1px solid rgb(255 197 61 / 14%);
    background:
      radial-gradient(ellipse 42% 58% at 50% 52%, transparent 58%, rgb(255 197 61 / 10%) 60%, transparent 62%),
      radial-gradient(ellipse 60% 45% at 50% 0%, rgb(255 255 255 / 10%), transparent 60%),
      repeating-linear-gradient(90deg, transparent 0 79px, rgb(240 236 223 / 4%) 80px),
      linear-gradient(180deg, rgb(201 140 69 / 22%) 0%, rgb(201 140 69 / 10%) 30%, rgb(10 14 17 / 72%) 78%);
  }

  .ur-hub-lineup::before {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: transparent;
    font-family: var(--font-display);
    font-size: clamp(6rem, 14vw, 11rem);
    font-weight: 900;
    letter-spacing: 0.04em;
    content: 'UR';
    pointer-events: none;
    -webkit-text-stroke: 1px rgb(255 197 61 / 10%);
  }

  .ur-hub-lineup-heading {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.85rem;
  }

  .ur-hub-lineup-heading h3 {
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(1.35rem, 2.4vw, 1.9rem);
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1;
    text-shadow: 0 2px 12px rgb(0 0 0 / 60%);
  }

  .ur-hub-lineup-heading p {
    max-width: 62ch;
    margin-top: 0.4rem;
    color: #c3caca;
    font-size: 0.74rem;
    line-height: 1.45;
    text-shadow: 0 1px 8px rgb(0 0 0 / 70%);
  }

  .ur-edit-lineup {
    display: inline-flex;
    flex: none;
    min-height: 2.4rem;
    align-items: center;
    gap: 0.45rem;
    padding-inline: 0.8rem;
    border: 1px solid rgb(255 255 255 / 28%);
    border-radius: 0.5rem;
    background: rgb(8 11 14 / 60%);
    color: #f5f1e4;
    font-size: 0.76rem;
    font-weight: 700;
    backdrop-filter: blur(6px);
  }

  .ur-edit-lineup:hover {
    border-color: var(--ur-apex);
  }

  .ur-pencil {
    width: 0.9rem;
    height: 0.9rem;
  }

  .ur-hub-lineup-cards {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: clamp(0.45rem, 1vw, 0.75rem);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ur-hub-player-card {
    --ur-card-glow: var(--ur-ember);
    --ur-card-chip: var(--ur-ember);
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
    overflow: hidden;
    padding: 0.45rem 0.45rem 0.55rem;
    border: 1px solid color-mix(in srgb, var(--ur-card-glow) 75%, white 8%);
    border-radius: 0.65rem;
    background:
      linear-gradient(165deg, color-mix(in srgb, var(--ur-card-glow) 22%, transparent), transparent 46%),
      linear-gradient(180deg, #1b2329 0%, #0c1114 78%);
    box-shadow:
      0 0 1.1rem color-mix(in srgb, var(--ur-card-glow) 32%, transparent),
      0 0.9rem 1.6rem rgb(0 0 0 / 50%),
      inset 0 1px 0 rgb(255 255 255 / 12%);
  }

  .ur-hub-player-card::after {
    position: absolute;
    inset: auto 12% -0.6rem;
    height: 1.1rem;
    border-radius: 999px;
    background: radial-gradient(ellipse, color-mix(in srgb, var(--ur-card-glow) 55%, transparent), transparent 70%);
    filter: blur(6px);
    content: '';
    pointer-events: none;
  }

  .ur-hub-player-card--apex {
    --ur-card-glow: var(--ur-apex);
    --ur-card-chip: var(--ur-apex);
  }

  .ur-hub-player-card--eruption {
    --ur-card-glow: #ff4a2a;
    --ur-card-chip: #ff4a2a;
  }

  .ur-hub-player-card--eclipse {
    --ur-card-glow: var(--ur-eclipse);
    --ur-card-chip: var(--ur-eclipse);
  }

  .ur-hub-player-card--ember {
    --ur-card-glow: var(--ur-ember);
    --ur-card-chip: var(--ur-ember);
  }

  .ur-hub-player-card--titan {
    --ur-card-glow: var(--ur-titan);
    --ur-card-chip: var(--ur-titan);
  }

  .ur-hub-player-card--immortal {
    --ur-card-glow: var(--ur-immortal);
    --ur-card-chip: var(--ur-immortal);
  }

  .ur-hub-slot {
    position: absolute;
    z-index: 2;
    top: 0.5rem;
    left: 0.5rem;
    display: inline-grid;
    min-width: 1.5rem;
    height: 1.5rem;
    place-items: center;
    padding-inline: 0.25rem;
    border: 1px solid color-mix(in srgb, var(--ur-card-chip) 80%, white 10%);
    border-radius: 0.3rem;
    background: rgb(8 11 14 / 82%);
    color: var(--ur-card-chip);
    font-family: var(--font-display);
    font-size: 0.72rem;
    font-weight: 900;
    letter-spacing: 0.02em;
  }

  .ur-hub-ovr {
    position: absolute;
    z-index: 2;
    top: 0.42rem;
    right: 0.55rem;
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 900;
    text-shadow:
      0 2px 6px rgb(0 0 0 / 80%),
      0 0 12px color-mix(in srgb, var(--ur-card-glow) 60%, transparent);
  }

  .ur-hub-face {
    display: grid;
    width: 100%;
    aspect-ratio: 0.82;
    place-items: stretch;
    overflow: hidden;
    margin-top: 1.9rem;
    border-radius: 0.45rem;
    border-bottom: 1px solid color-mix(in srgb, var(--ur-card-glow) 45%, transparent);
    background:
      linear-gradient(180deg, transparent 52%, rgb(8 11 14 / 78%)),
      radial-gradient(
        ellipse at 50% 18%,
        color-mix(in srgb, var(--ur-card-glow) 30%, transparent),
        transparent 62%
      ),
      radial-gradient(ellipse at 50% 40%, #5b6670 0%, #3a434b 45%, #232b31 100%);
  }

  .ur-hub-face :global(.relative) {
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .ur-hub-face :global(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 12%;
    transform: scale(1.08);
  }

  .ur-hub-face :global(.absolute) {
    background: transparent;
  }

  .ur-hub-empty-face {
    display: grid;
    place-items: center;
    color: rgb(240 236 223 / 70%);
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 800;
  }

  .ur-hub-player-name {
    display: -webkit-box;
    min-height: 2.1em;
    overflow: hidden;
    margin-top: 0.45rem;
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(0.78rem, 1.25vw, 0.95rem);
    font-weight: 800;
    line-height: 1.05;
    text-overflow: ellipsis;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .ur-hub-player-facts {
    margin-top: 0.2rem;
    color: var(--ur-card-glow);
    font-size: 0.66rem;
    font-weight: 700;
  }

  .ur-hub-mark {
    display: flex;
    justify-content: center;
    margin-top: 0.35rem;
    opacity: 0.9;
  }

  .ur-hub-mark img {
    width: 1.15rem;
    height: 1.15rem;
    filter: drop-shadow(0 0 6px color-mix(in srgb, var(--ur-card-glow) 60%, transparent));
  }

  .ur-hub-lineup-empty {
    display: grid;
    min-height: 11rem;
    justify-items: start;
    align-content: center;
    gap: 0.35rem;
    padding: 1rem;
    border: 1px dashed var(--ur-line-strong);
    border-radius: 0.65rem;
    color: var(--ur-paper);
  }

  .ur-hub-lineup-empty > span {
    color: var(--ur-apex);
    font-family: var(--font-display);
    font-size: 2.5rem;
    line-height: 1;
  }

  .ur-hub-lineup-empty strong {
    font-family: var(--font-display);
    font-size: 1.25rem;
  }

  .ur-hub-lineup-empty small {
    max-width: 35ch;
    color: var(--ur-muted);
    font-size: 0.75rem;
  }

  .ur-hub-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1rem;
  }

  .ur-hub-panel {
    position: relative;
    min-width: 0;
    overflow: hidden;
    padding: 1.1rem 1.1rem 1rem;
    border: 1px solid rgb(255 197 61 / 20%);
    border-radius: 0.8rem;
    background:
      radial-gradient(ellipse at 90% 0%, rgb(255 197 61 / 7%), transparent 50%),
      linear-gradient(160deg, #12191d 0%, #0b1014 70%);
    box-shadow: 0 1rem 2rem rgb(0 0 0 / 35%);
  }

  .ur-panel-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .ur-panel-heading h3 {
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.05;
  }

  .ur-panel-sub {
    margin-top: 0.25rem;
    color: #9aa4a6;
    font-size: 0.8rem;
  }

  .ur-panel-link {
    display: inline-flex;
    flex: none;
    min-height: 2.5rem;
    align-items: center;
    gap: 0.3rem;
    color: var(--ur-apex);
    font-size: 0.78rem;
    font-weight: 800;
    text-decoration: underline;
    text-underline-offset: 0.22em;
    white-space: nowrap;
  }

  .ur-empty-line {
    margin-top: 0.9rem;
    color: #9aa4a6;
    font-size: 0.82rem;
  }

  .ur-text-action {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    color: var(--ur-apex);
    font-size: 0.78rem;
    font-weight: 800;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .ur-score-hero {
    position: relative;
    display: flex;
    min-height: 10.5rem;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-end;
    gap: 0.4rem;
    margin-top: 0.85rem;
    padding: 0.9rem 1rem;
    overflow: hidden;
    border: 1px solid rgb(255 197 61 / 20%);
    border-radius: 0.65rem;
    background:
      radial-gradient(ellipse 70% 60% at 50% 0%, rgb(255 197 61 / 18%), transparent 60%),
      radial-gradient(ellipse 60% 55% at 80% 30%, rgb(255 122 26 / 20%), transparent 65%),
      radial-gradient(ellipse 80% 40% at 50% 100%, rgb(201 140 69 / 16%), transparent 65%),
      linear-gradient(180deg, #232d33 0%, #12181c 55%, #0b0f12 100%);
  }

  .ur-score-hero::after {
    position: absolute;
    inset: auto 0 0;
    height: 42%;
    background:
      repeating-linear-gradient(90deg, transparent 0 59px, rgb(201 140 69 / 14%) 60px),
      linear-gradient(180deg, transparent, rgb(201 140 69 / 16%));
    content: '';
    pointer-events: none;
  }

  .ur-score-hero > * {
    position: relative;
    z-index: 1;
  }

  .ur-status-badge {
    border-color: rgb(255 197 61 / 55%);
    border-radius: 0.4rem;
    background: rgb(8 11 14 / 70%);
    color: #ffd35c;
  }

  .ur-status-badge--win {
    border-color: rgb(255 197 61 / 65%);
    color: #ffd35c;
  }

  .ur-score-hero-title {
    color: #f5f1e4;
    font-family: var(--font-display);
    font-size: 1.3rem;
    font-weight: 800;
    line-height: 1.1;
  }

  .ur-result-score {
    color: #f5f1e4;
    font-family: var(--font-display);
    font-size: clamp(2rem, 3.4vw, 2.6rem);
    font-weight: 900;
    letter-spacing: -0.02em;
    line-height: 1;
    text-shadow: 0 2px 14px rgb(0 0 0 / 65%);
  }

  .ur-result-score span {
    padding-inline: 0.35rem;
    color: #8d979b;
    font-weight: 700;
  }

  .ur-score-hero p {
    max-width: 44ch;
    color: #c3caca;
    font-size: 0.78rem;
  }

  .ur-game-ago {
    color: #8d979b;
  }

  .ur-reward-trio {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 0.85rem;
    border-top: 1px solid rgb(255 255 255 / 8%);
    padding-top: 0.8rem;
  }

  .ur-reward-trio > div {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    padding-inline: 0.75rem;
  }

  .ur-reward-trio > div + div {
    border-left: 1px solid rgb(255 255 255 / 10%);
  }

  .ur-reward-trio > div:first-child {
    padding-left: 0;
  }

  .ur-reward-trio strong {
    color: #f5f1e4;
    font-size: 0.86rem;
    font-weight: 800;
    white-space: nowrap;
  }

  .ur-reward-trio > div > span:last-child {
    color: #8d979b;
    font-size: 0.68rem;
  }

  .ur-trio-icon {
    width: 1.1rem;
    height: 1.1rem;
    color: #8d979b;
  }

  .ur-xp {
    display: inline-grid;
    min-width: 1.6rem;
    height: 1.25rem;
    place-items: center;
    padding-inline: 0.3rem;
    border: 1px solid rgb(139 92 246 / 70%);
    border-radius: 0.3rem;
    background: rgb(139 92 246 / 18%);
    color: #c4b5fd;
    font-size: 0.6rem;
    font-weight: 900;
  }

  .ur-quiet-link {
    display: inline-flex;
    margin-top: 0.7rem;
    color: var(--ur-apex);
    font-size: 0.78rem;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 0.22em;
  }

  .ur-chase-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 5.5rem;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.9rem;
  }

  .ur-set-progress-list {
    display: grid;
    gap: 0.7rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ur-set-progress-list li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.65rem;
    padding: 0.55rem 0.6rem;
    border: 1px solid rgb(255 255 255 / 7%);
    border-radius: 0.55rem;
    background: rgb(8 12 15 / 55%);
  }

  .ur-set-glyph {
    display: grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border-radius: 0.5rem;
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 900;
  }

  .ur-set-glyph--apex {
    border: 1px solid rgb(255 197 61 / 60%);
    background: rgb(255 197 61 / 14%);
    color: var(--ur-apex);
  }

  .ur-set-glyph--eruption {
    border: 1px solid rgb(255 74 42 / 60%);
    background: rgb(255 74 42 / 14%);
    color: #ff7a54;
  }

  .ur-set-glyph--eclipse {
    border: 1px solid rgb(139 92 246 / 60%);
    background: rgb(139 92 246 / 16%);
    color: #c4b5fd;
  }

  .ur-set-glyph--ember {
    border: 1px solid rgb(198 90 46 / 60%);
    background: rgb(198 90 46 / 14%);
    color: #f0a97e;
  }

  .ur-set-meta {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 0.35rem;
  }

  .ur-set-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .ur-set-name {
    overflow: hidden;
    color: #f5f1e4;
    font-size: 0.8rem;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ur-set-count {
    flex: none;
    color: #9aa4a6;
    font-size: 0.7rem;
  }

  .ur-progress-track {
    display: block;
    height: 0.32rem;
    overflow: hidden;
    border-radius: 999px;
    background: rgb(255 255 255 / 10%);
  }

  .ur-progress-fill {
    display: block;
    height: 100%;
    border-radius: 999px;
  }

  .ur-progress-fill--apex {
    background: linear-gradient(90deg, #9a7414, var(--ur-apex));
  }

  .ur-progress-fill--eruption {
    background: linear-gradient(90deg, #a32e12, #ff5a2a);
  }

  .ur-progress-fill--eclipse {
    background: linear-gradient(90deg, #5b3bb5, #a588ff);
  }

  .ur-progress-fill--ember {
    background: linear-gradient(90deg, var(--ur-ember), var(--ur-apex));
  }

  .ur-set-pct {
    min-width: 2.2rem;
    font-size: 0.72rem;
    font-weight: 800;
    text-align: right;
  }

  .ur-set-pct--apex {
    color: var(--ur-apex);
  }

  .ur-set-pct--eruption {
    color: #ff7a54;
  }

  .ur-set-pct--eclipse {
    color: #c4b5fd;
  }

  .ur-set-pct--ember {
    color: #f0a97e;
  }

  .ur-pack-art {
    position: relative;
    height: 9.5rem;
  }

  .ur-pack {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    border: 1px solid rgb(255 197 61 / 55%);
    border-radius: 0.35rem;
    background:
      linear-gradient(160deg, rgb(255 211 92 / 28%), transparent 45%),
      linear-gradient(180deg, #2a2111 0%, #12100a 70%);
    box-shadow:
      0 0 1.2rem rgb(255 197 61 / 25%),
      0 0.8rem 1.4rem rgb(0 0 0 / 55%);
    color: var(--ur-apex);
    font-family: var(--font-display);
    font-size: 0.7rem;
    font-weight: 900;
    letter-spacing: 0.08em;
  }

  .ur-pack--back {
    top: 0.4rem;
    right: 1.6rem;
    width: 3.6rem;
    height: 5.6rem;
    transform: rotate(9deg);
    opacity: 0.85;
  }

  .ur-pack--front {
    top: 1.6rem;
    right: 0.2rem;
    width: 4.3rem;
    height: 6.6rem;
    transform: rotate(-7deg);
  }

  .ur-pack img {
    filter: drop-shadow(0 0 8px rgb(255 197 61 / 45%));
  }

  .ur-pack-shortcuts ul {
    display: grid;
    gap: 0.55rem;
    margin-top: 0.9rem;
    padding: 0;
    list-style: none;
  }

  .ur-shelf-row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.55rem 0.6rem;
    border: 1px solid rgb(255 255 255 / 7%);
    border-radius: 0.6rem;
    background: rgb(8 12 15 / 55%);
    color: inherit;
  }

  .ur-shelf-row:hover {
    border-color: rgb(255 197 61 / 40%);
  }

  .ur-shelf-thumb {
    display: grid;
    width: 2.4rem;
    height: 2.9rem;
    flex: none;
    place-items: center;
    border-radius: 0.3rem;
    border: 1px solid;
  }

  .ur-shelf-thumb img {
    filter: drop-shadow(0 0 6px rgb(0 0 0 / 60%));
  }

  .ur-shelf-thumb--gold {
    border-color: rgb(255 197 61 / 65%);
    background: linear-gradient(165deg, #3a2f14, #141007);
    box-shadow: 0 0 0.8rem rgb(255 197 61 / 25%);
  }

  .ur-shelf-thumb--ember {
    border-color: rgb(255 74 42 / 65%);
    background: linear-gradient(165deg, #3d1a10, #120a07);
    box-shadow: 0 0 0.8rem rgb(255 74 42 / 25%);
  }

  .ur-shelf-thumb--eclipse {
    border-color: rgb(139 92 246 / 65%);
    background: linear-gradient(165deg, #241b3b, #0e0a18);
    box-shadow: 0 0 0.8rem rgb(139 92 246 / 30%);
  }

  .ur-shelf-thumb--apex {
    border-color: rgb(255 197 61 / 65%);
    background: linear-gradient(165deg, #40300f, #100c05);
    box-shadow: 0 0 0.8rem rgb(255 197 61 / 30%);
  }

  .ur-shelf-thumb--titan {
    border-color: rgb(169 180 216 / 55%);
    background: linear-gradient(165deg, #282d3b, #101319);
  }

  .ur-shelf-meta {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
  }

  .ur-shelf-meta strong {
    overflow: hidden;
    color: #f5f1e4;
    font-size: 0.82rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ur-shelf-meta small {
    color: #8d979b;
    font-size: 0.7rem;
  }

  .ur-pack-price {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.35rem;
    color: #f5f1e4;
    font-size: 0.74rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .ur-chevron {
    flex: none;
    color: #8d979b;
    font-size: 1.1rem;
    line-height: 1;
  }

  .ur-recent-receipt {
    display: flex;
    grid-column: 1 / -1;
    min-height: 4.25rem;
    align-items: center;
    gap: 0.85rem;
    padding: 0.7rem 1rem;
    border: 1px solid rgb(255 197 61 / 45%);
    border-radius: 0.7rem;
    background:
      radial-gradient(ellipse at 0% 50%, rgb(255 197 61 / 14%), transparent 55%),
      linear-gradient(100deg, #17130a 0%, #0f1417 60%);
    color: #f5f1e4;
    box-shadow: inset 0 1px 0 rgb(255 197 61 / 18%);
  }

  .ur-receipt-gift {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    flex: none;
    place-items: center;
    border: 1px solid rgb(255 197 61 / 55%);
    border-radius: 0.55rem;
    background: rgb(255 197 61 / 12%);
    color: var(--ur-apex);
  }

  .ur-gift-icon {
    width: 1.25rem;
    height: 1.25rem;
  }

  .ur-receipt-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
  }

  .ur-receipt-copy strong {
    font-size: 0.88rem;
  }

  .ur-receipt-copy small {
    overflow: hidden;
    color: #9aa4a6;
    font-size: 0.74rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ur-receipt-view {
    display: inline-flex;
    flex: none;
    min-height: 2.4rem;
    align-items: center;
    padding-inline: 0.9rem;
    border: 1px solid rgb(255 197 61 / 60%);
    border-radius: 0.5rem;
    color: #ffd35c;
    font-size: 0.78rem;
    font-weight: 800;
    white-space: nowrap;
  }

  .ur-number {
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 1020px) {
    .ur-hub-hero {
      grid-template-columns: 1fr;
    }

    .ur-hub-hero-copy {
      background: linear-gradient(180deg, rgb(8 11 14 / 72%), transparent);
    }

    .ur-hub-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .ur-pack-shortcuts {
      grid-column: 1 / -1;
    }
  }

  @media (max-width: 640px) {
    .ur-hub-scoreline {
      gap: 0.45rem;
    }

    .ur-stat-tile {
      padding: 0.55rem 0.5rem;
    }

    .ur-hub-lineup-cards {
      grid-template-columns: repeat(5, minmax(7rem, 1fr));
      overflow-x: auto;
      padding-bottom: 0.5rem;
      scroll-snap-type: x mandatory;
    }

    .ur-hub-player-card {
      scroll-snap-align: start;
    }

    .ur-hub-grid {
      grid-template-columns: 1fr;
    }

    .ur-pack-shortcuts {
      grid-column: auto;
    }

    .ur-chase-body {
      grid-template-columns: minmax(0, 1fr);
    }

    .ur-pack-art {
      display: none;
    }

    .ur-receipt-copy small {
      white-space: normal;
    }

    .ur-receipt-view {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ur-hub *,
    .ur-hub *::before,
    .ur-hub *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
</style>
