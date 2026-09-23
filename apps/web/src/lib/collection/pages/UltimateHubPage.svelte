<script lang="ts">
  import { onDestroy } from 'svelte';
  import { resolve } from '$app/paths';
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
  import { setProgressViews } from '$lib/collection/collection-progression-view.ts';
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
        <p class="ur-hub-overline">Your permanent run</p>
        <h2 id="hub-hero-title">
          {collectionState.claimedWelcome
            ? 'The next possession is yours.'
            : 'Your run starts here.'}
        </h2>
        <p>{nextAction.detail}</p>
        <a class="ur-primary-action" href={resolve(nextAction.href as any)}>{nextAction.label}</a>
      </div>
      <div class="ur-hub-scoreline" aria-label="Collection totals">
        <div><strong>{collectionState.owned.length}</strong><span>cards owned</span></div>
        <div>
          <strong>{catalog?.cards.length.toLocaleString('en-US') ?? '—'}</strong><span
            >to collect</span
          >
        </div>
        <div>
          <strong>{collectionState.balances.Coins.toLocaleString('en-US')}</strong><span>Coins</span
          >
        </div>
      </div>
    </section>

    <div class="ur-hub-grid">
      <section class="ur-hub-panel ur-team-snapshot" aria-labelledby="team-snapshot-title">
        <div class="ur-panel-heading">
          <div>
            <h3 id="team-snapshot-title">Starting five</h3>
            <p>
              {savedTeam
                ? teamCheck?.ok
                  ? 'Saved and legal'
                  : 'Needs attention'
                : 'No saved team yet'}
            </p>
          </div>
          <a href={resolve('/ultimate/run/team' as any)}>Edit team</a>
        </div>
        {#if savedTeam}
          <ol class="ur-five-list">
            {#each teamCards as card, index (savedTeam.starters[index])}
              <li>
                <span class="ur-slot-number">{index + 1}</span>
                {#if manifest && card}
                  <PlayerFace
                    player={{
                      playerId: card.playerId,
                      playerExternalId: card.playerExternalId,
                      altIds: null,
                    }}
                    {manifest}
                    size="sm"
                    fallbackInitials={initialsOf(card.displayName)}
                  />
                {/if}
                <span class="ur-player-line">
                  <strong>{card?.displayName ?? 'Empty slot'}</strong>
                  <small
                    >{card
                      ? `${card.seasonKey} · Overall ${overallOf(card.cardId) ?? '—'}`
                      : 'Choose a card in Team'}</small
                  >
                </span>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="ur-empty-line">Claim your starter, then save a legal five to unlock games.</p>
          <a class="ur-text-action" href={resolve('/ultimate/run/team' as any)}>Build a team</a>
        {/if}
      </section>

      <section class="ur-hub-panel ur-run-snapshot" aria-labelledby="run-snapshot-title">
        <div class="ur-panel-heading">
          <div>
            <h3 id="run-snapshot-title">Game tape</h3>
            <p>
              {playState?.pendingGame
                ? 'Matchup prepared'
                : recentGame
                  ? 'Latest result'
                  : 'Ready when you are'}
            </p>
          </div>
          <a href={resolve('/ultimate/run/play' as any)}
            >{playState?.pendingGame ? 'Resume' : 'Play'}</a
          >
        </div>
        {#if playState?.pendingGame}
          <div class="ur-run-feature">
            <span class="ur-status-badge">Matchup ready</span>
            <strong>
              {playState.pendingGame.gameVersion === 'collection-game-v3'
                ? playState.pendingGame.challenge.displayName
                : playState.pendingGame.gameVersion === 'collection-game-v2'
                  ? `${playState.pendingGame.difficulty.difficultyId} game`
                  : 'Legacy matchup'}
            </strong>
            <p>The setup is saved. Continue in Play to start the game.</p>
          </div>
        {:else if recentGame}
          <div class="ur-run-feature">
            <span class="ur-status-badge"
              >{recentGame.result.winner === 'home' ? 'Win' : 'Loss'}</span
            >
            <strong class="ur-result-score">
              {recentGame.result.outcome === 'completed'
                ? recentGame.result.home.score
                : recentGame.result.homeScore}<span>–</span>{recentGame.result.outcome ===
              'completed'
                ? recentGame.result.away.score
                : recentGame.result.awayScore}
            </strong>
            <p>
              Final score · {recentGame.gameVersion === 'collection-game-v3'
                ? recentGame.prepared.challenge.displayName
                : 'Ultimate Run game'}
            </p>
          </div>
        {:else}
          <div class="ur-run-feature">
            <span class="ur-status-badge">No game in progress</span>
            <strong>Take the court</strong>
            <p>Your score, play-by-play, and rewards are saved from the game record.</p>
          </div>
        {/if}
      </section>

      <section class="ur-hub-panel ur-chase-panel" aria-labelledby="collection-chase-title">
        <div class="ur-panel-heading">
          <div>
            <h3 id="collection-chase-title">Collection chase</h3>
            <p>Progress across the three launch sets</p>
          </div>
          <a href={resolve('/ultimate/run/collection' as any)}>Browse cards</a>
        </div>
        {#if sets.length > 0}
          <ul class="ur-set-progress-list">
            {#each sets as set (set.setId)}
              <li>
                <span>{set.title}</span>
                <strong>{set.ownedCount}/{set.requiredCount}</strong>
                <span
                  class="ur-progress-track"
                  aria-label={`${set.ownedCount} of ${set.requiredCount} cards`}
                >
                  <span style={`width:${(set.ownedCount / set.requiredCount) * 100}%`}></span>
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="ur-empty-line">Claim your starter to begin filling the launch sets.</p>
        {/if}
      </section>

      <section class="ur-hub-panel ur-pack-shortcuts" aria-labelledby="pack-shortcuts-title">
        <div class="ur-panel-heading">
          <div>
            <h3 id="pack-shortcuts-title">On the shelf</h3>
            <p>Useful packs you can afford now</p>
          </div>
          <a href={resolve('/ultimate/run/packs' as any)}>Full odds</a>
        </div>
        {#if availablePacks.length > 0}
          <ul>
            {#each availablePacks.slice(0, 3) as pack (pack.packId)}
              <li>
                <span class="ur-pack-stamp" aria-hidden="true">{pack.slots.length}</span>
                <span
                  ><strong>{pack.packId.replaceAll('-', ' ')}</strong><small
                    >{pack.slots.length} {pack.slots.length === 1 ? 'card' : 'cards'}</small
                  ></span
                >
                <span class="ur-pack-price"
                  >{pack.priceAmount.toLocaleString('en-US')} {pack.priceCurrency}</span
                >
              </li>
            {/each}
          </ul>
        {:else}
          <p class="ur-empty-line">No packs are affordable with the current balances.</p>
          <a class="ur-text-action" href={resolve('/ultimate/run/play' as any)}>Play for Coins</a>
        {/if}
      </section>

      {#if shell.snapshot?.latestPull}
        <a class="ur-recent-receipt" href={resolve('/ultimate/run/packs' as any)}>
          <span class="ur-receipt-mark" aria-hidden="true">+</span>
          <span>
            <strong>{shell.snapshot.latestPull.packId ?? 'Starter'} received</strong>
            <small
              >{shell.snapshot.latestPull.newCount} new · +{shell.snapshot.latestPull
                .exchangeGained} Exchange from duplicates</small
            >
          </span>
          <span class="ur-receipt-view">View receipt</span>
        </a>
      {/if}
    </div>
  {/if}
</div>

<style>
  .ur-hub {
    display: grid;
    gap: 1.35rem;
  }

  .ur-hub-hero {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(17rem, 0.85fr);
    min-height: 17rem;
    border-block: 1px solid var(--ur-line-strong);
    background:
      linear-gradient(115deg, rgb(255 197 61 / 7%), transparent 44%),
      repeating-linear-gradient(0deg, transparent 0 31px, rgb(240 236 223 / 3%) 32px),
      var(--ur-raised);
  }

  .ur-hub-hero-copy {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    padding: clamp(1.25rem, 4vw, 3rem);
  }

  .ur-hub-overline {
    color: var(--ur-apex);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.08em;
  }

  .ur-hub-hero h2 {
    max-width: 15ch;
    margin-top: 0.5rem;
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 6vw, 4.7rem);
    font-weight: 800;
    letter-spacing: -0.035em;
    line-height: 0.93;
  }

  .ur-hub-hero-copy > p:not(.ur-hub-overline) {
    max-width: 38ch;
    margin-top: 1rem;
    color: var(--ur-muted);
    font-size: 0.94rem;
  }

  .ur-primary-action {
    display: inline-flex;
    min-height: 3rem;
    align-items: center;
    margin-top: 1.25rem;
    padding: 0.7rem 1.1rem;
    background: var(--ur-apex);
    color: #241a02;
    font-size: 0.9rem;
    font-weight: 800;
  }

  .ur-primary-action:hover {
    background: #ffda73;
  }

  .ur-hub-scoreline {
    display: grid;
    align-content: end;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
    padding: 1.5rem;
    border-left: 1px solid var(--ur-line);
    background: rgb(0 0 0 / 16%);
  }

  .ur-hub-scoreline div {
    display: flex;
    min-height: 5.5rem;
    flex-direction: column;
    justify-content: center;
    padding: 0.8rem 1rem;
    border-top: 1px solid var(--ur-line);
  }

  .ur-hub-scoreline strong {
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: clamp(1.75rem, 4vw, 2.6rem);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .ur-hub-scoreline span {
    margin-top: 0.3rem;
    color: var(--ur-muted);
    font-size: 0.76rem;
  }

  .ur-hub-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .ur-hub-panel {
    min-width: 0;
    padding: 1.2rem;
    border-top: 2px solid var(--ur-line-strong);
    background: var(--ur-raised);
  }

  .ur-panel-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .ur-panel-heading h3 {
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 800;
    line-height: 1.05;
  }

  .ur-panel-heading p,
  .ur-empty-line {
    margin-top: 0.35rem;
    color: var(--ur-muted);
    font-size: 0.82rem;
  }

  .ur-panel-heading > a,
  .ur-text-action {
    min-height: 2.75rem;
    display: inline-flex;
    align-items: center;
    color: var(--ur-apex);
    font-size: 0.78rem;
    font-weight: 800;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .ur-five-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .ur-five-list li {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem;
    border-left: 1px solid var(--ur-line-strong);
  }

  .ur-slot-number {
    color: var(--ur-apex);
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 800;
  }

  .ur-player-line,
  .ur-pack-shortcuts li > span:nth-child(2) {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }

  .ur-player-line strong,
  .ur-pack-shortcuts li strong {
    overflow: hidden;
    color: var(--ur-paper);
    font-size: 0.78rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ur-player-line small,
  .ur-pack-shortcuts li small {
    color: var(--ur-muted);
    font-size: 0.68rem;
  }

  .ur-run-feature {
    display: flex;
    min-height: 9.5rem;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 0.45rem;
    margin-top: 0.75rem;
    padding: 0.75rem 1rem;
    border-left: 3px solid var(--ur-apex);
    background: var(--ur-surface);
  }

  .ur-run-feature > strong {
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: 1.65rem;
    font-weight: 800;
    line-height: 1;
  }

  .ur-run-feature p {
    max-width: 42ch;
    color: var(--ur-muted);
    font-size: 0.8rem;
  }

  .ur-result-score {
    font-variant-numeric: tabular-nums;
  }

  .ur-result-score span {
    padding-inline: 0.4rem;
    color: var(--ur-muted);
  }

  .ur-set-progress-list,
  .ur-pack-shortcuts ul {
    display: grid;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .ur-set-progress-list li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.35rem 0.75rem;
    color: var(--ur-paper);
    font-size: 0.8rem;
  }

  .ur-set-progress-list strong {
    font-variant-numeric: tabular-nums;
  }

  .ur-progress-track {
    grid-column: 1 / -1;
    display: block;
    height: 0.3rem;
    background: #303a3e;
  }

  .ur-progress-track > span {
    display: block;
    height: 100%;
    background: var(--ur-apex);
  }

  .ur-pack-shortcuts li {
    display: flex;
    min-height: 3rem;
    align-items: center;
    gap: 0.65rem;
    border-bottom: 1px solid var(--ur-line);
    padding-bottom: 0.5rem;
  }

  .ur-pack-stamp {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    flex: none;
    place-items: center;
    border: 1px solid var(--ur-line-strong);
    color: var(--ur-apex);
    font-family: var(--font-display);
    font-size: 1.15rem;
    font-weight: 800;
  }

  .ur-pack-price {
    margin-left: auto;
    color: var(--ur-paper);
    font-size: 0.72rem;
    font-weight: 700;
    text-align: right;
  }

  .ur-recent-receipt {
    display: flex;
    min-height: 4.5rem;
    grid-column: 1 / -1;
    align-items: center;
    gap: 0.85rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--ur-line);
    color: var(--ur-paper);
  }

  .ur-receipt-mark {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    flex: none;
    place-items: center;
    border: 1px solid var(--ur-apex);
    color: var(--ur-apex);
    font-family: var(--font-display);
    font-size: 1.4rem;
  }

  .ur-recent-receipt > span:nth-child(2) {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
  }

  .ur-recent-receipt small {
    color: var(--ur-muted);
    font-size: 0.75rem;
  }

  .ur-receipt-view {
    color: var(--ur-apex);
    font-size: 0.78rem;
    font-weight: 800;
  }

  @media (max-width: 899px) {
    .ur-hub-hero {
      grid-template-columns: 1fr;
    }

    .ur-hub-scoreline {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      border-top: 1px solid var(--ur-line);
      border-left: 0;
    }
  }

  @media (max-width: 600px) {
    .ur-hub-grid {
      grid-template-columns: 1fr;
    }

    .ur-recent-receipt {
      grid-column: auto;
    }

    .ur-five-list {
      grid-template-columns: 1fr;
    }

    .ur-receipt-view {
      display: none;
    }
  }
</style>
