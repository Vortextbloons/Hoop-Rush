<script lang="ts">
  import { asset, resolve } from '$app/paths';
  import '$lib/collection/ultimate-theme.css';
  import { onDestroy } from 'svelte';
  import type {
    CollectionCatalog,
    CollectionProgressionRules,
    CollectionPullRecord,
    CollectionState,
  } from '@hoop-rush/data-contracts';
  import { COLLECTION_RARITY_ORDER } from '@hoop-rush/data-contracts';
  import { z } from 'zod';
  import { describeCollectionPackOdds, describeCollectionTargetOdds } from '@hoop-rush/engine';
  import { getManifest } from '$lib/data';
  import AsyncState from '$lib/components/AsyncState.svelte';
  import CollectionNav from '$lib/collection/CollectionNav.svelte';
  import ActiveTarget from '$lib/collection/ActiveTarget.svelte';
  import {
    loadCollectionCatalog,
    loadCollectionProgression,
  } from '$lib/collection/collection-assets.ts';
  import {
    ensureCollection,
    openPack,
    setTargetPlayer,
    StaleCollectionPreviewError,
  } from '$lib/collection/collection-hub.ts';
  import { getCollectionRepo } from '$lib/collection/collection-hub.ts';
  import { collectionErrorMessage } from '$lib/collection/collection-errors.ts';
  import {
    isTargetedPullSlot,
    packTargetOddsView,
    pullTargetPlayerId,
    targetPlayerSummary,
    targetedReceiptFacts,
    targetedSummaryForPlayer,
    type PackTargetOddsView,
    type TargetedReceiptFacts,
  } from '$lib/collection/collection-targeting-view.ts';
  import { arenaDuplicate, arenaError, arenaPackOpen, arenaPackReveal } from '$lib/arena-sound';

  let mounted = true;
  onDestroy(() => {
    mounted = false;
  });

  let phase = $state<'loading' | 'error' | 'ready'>('loading');
  let error = $state<string | null>(null);
  let catalog = $state<CollectionCatalog | null>(null);
  let progression = $state<CollectionProgressionRules | null>(null);
  let progressionError = $state<string | null>(null);
  let collectionState = $state<CollectionState | null>(null);
  let purchasing = $state<string | null>(null);
  let purchaseError = $state<string | null>(null);
  let staleNotice = $state<string | null>(null);
  let targetBusy = $state(false);
  let targetError = $state<string | null>(null);
  let receipt = $state<{
    pull: CollectionPullRecord;
    cardsAdded: number;
    exchangeGained: number;
    balances: { Coins: number; Exchange: number };
    targeting: TargetedReceiptFacts | null;
  } | null>(null);
  let showAll = $state(false);
  let announcement = $state('');

  const PACK_BLURBS: Record<string, string> = {
    'tip-off': 'One card. A quick look at the pool.',
    'fast-break': 'Three cards, all ordinary slots.',
    'full-court': 'Five cards with one Eruption-or-better slot.',
    'main-event': 'Ten cards with one Apex-or-better slot.',
    spotlight: 'One special-only card, Apex or better. Costs Exchange.',
  };

  function formatChance(probability: number): string {
    if (probability <= 0) return '0%';
    const percent = probability * 100;
    if (percent >= 10) return `${percent.toFixed(1)}%`;
    if (percent >= 1) return `${percent.toFixed(2)}%`;
    return `${percent.toPrecision(2)}%`;
  }

  function slotLabel(packId: string, slotIndex: number): string {
    const pack = catalog?.packs.find((entry) => entry.packId === packId);
    const slot = pack?.slots[slotIndex];
    if (!slot) return `Slot ${slotIndex + 1}`;
    if (slot.kind === 'guaranteed')
      return `Slot ${slotIndex + 1} · ${slot.floorRarity}+ guaranteed`;
    return `Slot ${slotIndex + 1} · ordinary`;
  }

  function playerIdOf(cardId: string): string | null {
    return catalog?.cards.find((card) => card.cardId === cardId)?.playerId ?? null;
  }

  function playerNameOf(playerId: string | null): string {
    if (playerId === null) return '';
    return catalog?.cards.find((card) => card.playerId === playerId)?.displayName ?? playerId;
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
      phase = 'ready';
      void loadCollectionProgression()
        .then((loaded) => {
          if (mounted) {
            progression = loaded;
            progressionError = null;
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
      await restoreReceipt();
    } catch (loadError) {
      if (!mounted) return;
      error = loadError instanceof Error ? loadError.message : 'Could not load the packs.';
      phase = 'error';
    }
  }

  const lastReceiptSchema = z.object({
    pullSequence: z.number().int().nonnegative(),
  });
  async function restoreReceipt(): Promise<void> {
    try {
      const raw = sessionStorage.getItem('collection-last-receipt');
      if (!raw || !collectionState) return;
      const result = lastReceiptSchema.safeParse(JSON.parse(raw));
      if (!result.success) return;
      const saved = result.data;
      const repo = getCollectionRepo();
      const snapshot = await repo.loadCollection(collectionState.collectionId);
      if (!mounted || !snapshot) return;
      const pull = snapshot.pulls.find((entry) => entry.pullSequence === saved.pullSequence);
      if (!pull) return;
      const pullLedger = snapshot.ledger.filter(
        (entry) => entry.pullSequence === pull.pullSequence,
      );
      receipt = {
        pull,
        cardsAdded: pull.slots.filter((slot) => slot.kept).length,
        exchangeGained: pullLedger
          .filter((entry) => entry.reason === 'duplicate-conversion')
          .reduce((sum, entry) => sum + entry.amount, 0),
        balances: { ...snapshot.state.balances },
        targeting: targetedReceiptFacts({
          pull,
          playerName: playerNameOf(pullTargetPlayerId(pull)),
          playerIdOf,
        }),
      };
    } catch {
      // A missing receipt simply means nothing to restore.
    }
  }

  $effect(() => {
    void load();
  });

  const balances = $derived(collectionState?.balances ?? { Coins: 0, Exchange: 0 });
  const claimed = $derived(collectionState?.claimedWelcome ?? false);
  const activeTargetId = $derived(collectionState?.activeTargetPlayerId ?? null);
  const activeTargetSummary = $derived(
    catalog && activeTargetId ? targetPlayerSummary(catalog, activeTargetId) : null,
  );
  const activeTargetLine = $derived(
    activeTargetId ? targetedSummaryForPlayer(activeTargetSummary, activeTargetId) : '',
  );
  const targetingBlocked = $derived(activeTargetId !== null && progression === null);
  const targetOddsByPack = $derived.by(() => {
    const map = new Map<string, PackTargetOddsView>();
    if (!catalog) return map;
    const targetPlayerId = progression === null ? null : activeTargetId;
    const playerName = playerNameOf(targetPlayerId);
    for (const pack of catalog.packs) {
      const odds = describeCollectionTargetOdds({
        catalog,
        pack,
        targetPlayerId,
        multiplierBp: progression?.targetMultiplierBp ?? 10_000,
      });
      map.set(
        pack.packId,
        packTargetOddsView({
          odds,
          playerName,
          eligibleVersionCount: activeTargetSummary?.versionCount ?? 0,
        }),
      );
    }
    return map;
  });

  async function clearTarget(): Promise<void> {
    if (targetBusy) return;
    targetBusy = true;
    targetError = null;
    try {
      const next = await setTargetPlayer(null, new Date().toISOString());
      if (!mounted) return;
      collectionState = next;
      announcement = 'Target cleared. Packs draw with equal card weights again.';
    } catch (failure) {
      if (!mounted) return;
      targetError = collectionErrorMessage(failure, 'Clearing the target failed.');
    } finally {
      if (mounted) targetBusy = false;
    }
  }

  async function buy(packId: string): Promise<void> {
    if (purchasing || !collectionState) return;
    const preview = {
      revision: collectionState.revision,
      digest: collectionState.digest,
    };
    purchasing = packId;
    purchaseError = null;
    staleNotice = null;
    showAll = false;
    try {
      arenaPackOpen();
    } catch {}
    try {
      const outcome = await openPack(packId, new Date().toISOString(), preview);
      if (!mounted) return;
      collectionState = outcome.state;
      const pullLedger = outcome.ledgerEntries.filter(
        (entry) => entry.reason === 'duplicate-conversion',
      );
      const targeting = targetedReceiptFacts({
        pull: outcome.pull,
        playerName: playerNameOf(pullTargetPlayerId(outcome.pull)),
        playerIdOf,
      });
      receipt = {
        pull: outcome.pull,
        cardsAdded: outcome.pull.slots.filter((slot) => slot.kept).length,
        exchangeGained: pullLedger.reduce((sum, entry) => sum + entry.amount, 0),
        balances: { ...outcome.state.balances },
        targeting,
      };
      try {
        sessionStorage.setItem(
          'collection-last-receipt',
          JSON.stringify({ pullSequence: outcome.pull.pullSequence }),
        );
      } catch {
        // Receipt restore is best-effort.
      }
      announcement = [
        `Pack opened. ${receipt.cardsAdded} new cards, plus ${receipt.exchangeGained} Exchange.`,
        targeting?.summary ?? '',
      ]
        .filter((part) => part.length > 0)
        .join(' ');
      try {
        const order = ['Ember', 'Eruption', 'Apex', 'Titan', 'Eclipse', 'Immortal'];
        let best = 0;
        for (const slot of outcome.pull.slots) {
          const rank = order.indexOf(slot.rarity);
          if (rank > best) best = rank;
        }
        arenaPackReveal(order[best]);
        if (receipt.cardsAdded === 0) arenaDuplicate();
      } catch {}
    } catch (buyError) {
      if (!mounted) return;
      try {
        arenaError();
      } catch {}
      if (buyError instanceof StaleCollectionPreviewError) {
        staleNotice = buyError.message;
        const refreshed = await ensureCollection(new Date().toISOString()).catch(() => null);
        if (mounted && refreshed) collectionState = refreshed;
        return;
      }
      purchaseError = collectionErrorMessage(buyError, 'Purchase failed. Try again.');
      const refreshed = await ensureCollection(new Date().toISOString()).catch(() => null);
      if (mounted && refreshed) collectionState = refreshed;
    } finally {
      if (mounted) purchasing = null;
    }
  }

  const receiptCards = $derived.by(() => {
    if (!receipt || !catalog) return [];
    const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
    return receipt.pull.slots.map((slot) => ({ slot, card: byId.get(slot.cardId) ?? null }));
  });
  const visibleReceiptCards = $derived(showAll ? receiptCards : receiptCards.slice(0, 3));
</script>

<svelte:head>
  <title>Packs · Hoop Rush</title>
</svelte:head>

<div class="ultimate-root mx-auto w-full max-w-6xl px-3 py-6 sm:px-6">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div class="flex items-center gap-3">
      <img
        src={asset('/ultimate/logo.png')}
        alt="Ultimate Run"
        class="h-11 w-11 rounded-lg"
        width="44"
        height="44"
      />
      <div>
        <p class="ultimate-eyebrow">Ultimate Run</p>
        <h1 class="font-display text-3xl font-extrabold tracking-tight">Pack store</h1>
        <p class="text-sm text-muted-foreground">Seeded pulls. Odds shown before every purchase.</p>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span><strong class="tabular-nums">{balances.Coins}</strong> Coins</span>
      <span><strong class="tabular-nums">{balances.Exchange}</strong> Exchange</span>
      <CollectionNav current="packs" />
    </div>
  </div>

  <p class="sr-only" role="status">{announcement}</p>

  {#if phase === 'loading'}
    <div class="mt-6">
      <AsyncState kind="loading" title="Loading" message="Loading the pack store…" />
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
        message="Claim the free starter in the collection book before opening packs."
      />
    </div>
    <a
      href={resolve('/collection')}
      class="mt-3 inline-block rounded-xl bg-accent px-5 py-2.5 font-bold text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Go to collection
    </a>
  {:else if catalog}
    {#if progressionError}
      <div class="mt-4">
        <AsyncState
          kind="error"
          title="Targeting odds unavailable"
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
    {/if}

    {#if activeTargetId && catalog}
      <ActiveTarget
        playerName={activeTargetSummary?.displayName ?? activeTargetId}
        summaryLine={activeTargetLine}
        blurb={progression?.display.targetingBlurb ?? undefined}
        busy={targetBusy}
        onClear={clearTarget}
      />
      {#if targetError}
        <p role="alert" class="mt-2 text-sm text-destructive">{targetError}</p>
      {/if}
    {/if}

    {#if staleNotice}
      <p role="status" class="mt-4 rounded-xl border border-accent/50 bg-card p-4 text-sm">
        {staleNotice}
      </p>
    {/if}

    {#if purchaseError}
      <p
        role="alert"
        class="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
      >
        {purchaseError}
      </p>
    {/if}

    {#if receipt}
      <section
        aria-label="Pack results"
        class="mt-6 rounded-2xl border border-accent/50 bg-card p-5"
      >
        <h2 class="font-display text-xl font-extrabold">Pack opened</h2>
        <p class="text-sm text-muted-foreground" aria-live="polite">
          {receipt.cardsAdded} new cards · +{receipt.exchangeGained} Exchange · balances now
          {receipt.balances.Coins} Coins / {receipt.balances.Exchange} Exchange.
        </p>
        {#if receipt.targeting}
          <p class="mt-1 text-sm" role="status">{receipt.targeting.summary}</p>
        {/if}
        <ul class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {#each visibleReceiptCards as { slot, card } (slot.slotIndex)}
            {@const targeted = isTargetedPullSlot(receipt.pull, slot.cardId, playerIdOf)}
            <li class="min-w-0 rounded-xl bg-surface-2 p-3 text-sm">
              <span class="block truncate font-semibold">{card?.displayName ?? slot.cardId}</span>
              <span class="block text-xs text-muted-foreground">
                {card ? `${card.seasonKey} · ${slot.rarity}` : slot.rarity}
                {#if slot.kept}
                  · <strong class="text-positive">New</strong>
                {:else}
                  · Duplicate · +{slot.conversionAmount} Exchange
                {/if}
              </span>
              {#if targeted}
                <span class="mt-1 block text-xs font-semibold text-accent"> Targeted player </span>
              {/if}
            </li>
          {/each}
        </ul>
        {#if receiptCards.length > 3}
          <button
            type="button"
            onclick={() => {
              showAll = !showAll;
            }}
            class="mt-3 min-h-11 rounded-xl bg-surface-2 px-4 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showAll ? 'Show less' : `Show all ${receiptCards.length}`}
          </button>
        {/if}
      </section>
    {/if}

    <ul class="mt-6 grid gap-4 md:grid-cols-2">
      {#each catalog.packs as pack (pack.packId)}
        {@const odds = describeCollectionPackOdds(catalog, pack)}
        {@const targetOdds = targetOddsByPack.get(pack.packId)}
        {@const affordable = balances[pack.priceCurrency] >= pack.priceAmount}
        {@const shortfall = pack.priceAmount - balances[pack.priceCurrency]}
        <li class="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="font-display text-xl font-extrabold capitalize">
                {pack.packId.replace('-', ' ')}
              </h2>
              <p class="text-sm text-muted-foreground">{PACK_BLURBS[pack.packId] ?? ''}</p>
            </div>
            <p class="shrink-0 text-right text-sm">
              <strong class="tabular-nums">{pack.priceAmount} {pack.priceCurrency}</strong>
              <span class="block text-xs text-muted-foreground"
                >{pack.slots.length} {pack.slots.length === 1 ? 'card' : 'cards'}</span
              >
            </p>
          </div>
          <ul class="mt-3 space-y-1 text-sm">
            {#each pack.slots as slot, index (index)}
              <li class="text-muted-foreground">{slotLabel(pack.packId, index)}</li>
            {/each}
          </ul>
          {#if targetOdds}
            <p
              class="mt-3 break-words rounded-xl bg-surface-2 px-3 py-2 text-sm {targetOdds.eligible
                ? 'text-foreground'
                : 'text-muted-foreground'}"
            >
              {targetOdds.summary}
            </p>
          {/if}
          <details class="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
            <summary class="cursor-pointer font-semibold">Odds details</summary>
            <div class="mt-2 overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead>
                  <tr class="text-muted-foreground">
                    <th scope="col" class="pr-2 font-semibold">Rarity</th>
                    {#each odds.perSlot as slot (slot.slotIndex)}
                      <th scope="col" class="pr-2 font-semibold">Slot {slot.slotIndex + 1}</th>
                    {/each}
                    <th scope="col" class="font-semibold">≥1 in pack</th>
                  </tr>
                </thead>
                <tbody>
                  {#each COLLECTION_RARITY_ORDER as rarity (rarity)}
                    <tr>
                      <th scope="row" class="pr-2 font-semibold">{rarity}</th>
                      {#each odds.perSlot as slot (slot.slotIndex)}
                        <td class="pr-2 tabular-nums"
                          >{formatChance(slot.distribution[rarity] ?? 0)}</td
                        >
                      {/each}
                      <td class="tabular-nums">{formatChance(odds.atLeastOne[rarity] ?? 0)}</td>
                    </tr>
                  {/each}
                  {#if targetOdds?.hasTarget}
                    <tr>
                      <th scope="row" class="pr-2 font-semibold">Target player</th>
                      {#each targetOdds.perSlotLabels as label, index (index)}
                        <td class="pr-2 tabular-nums">{label}</td>
                      {/each}
                      <td class="tabular-nums">{targetOdds.atLeastOneLabel}</td>
                    </tr>
                  {/if}
                </tbody>
              </table>
            </div>
            <p class="mt-2 text-xs text-muted-foreground">
              Pool: {odds.cardCount} slots · duplicate values
              {COLLECTION_RARITY_ORDER.map(
                (rarity) => `${rarity} +${odds.duplicateExchange[rarity] ?? 0}`,
              ).join(' · ')}. No pity, no rarity boosts, no duplicate protection. Targeting keeps
              every rarity weight unchanged.
            </p>
            {#if targetOdds?.hasTarget}
              <p class="mt-1 text-xs text-muted-foreground">
                Target chance is exact and comes from the same compiled pack distributions as the
                draw. Tiny nonzero values are never rounded to zero.
              </p>
            {/if}
          </details>
          {#if targetingBlocked}
            <p class="mt-3 text-xs text-destructive">
              The targeting rules artifact is unavailable, so this pack cannot be opened while a
              target is active. Clear the target or retry loading.
            </p>
          {/if}
          <button
            type="button"
            onclick={() => buy(pack.packId)}
            disabled={!affordable || purchasing !== null || targetingBlocked}
            class="mt-4 min-h-11 rounded-xl bg-accent px-5 py-2.5 font-bold text-accent-foreground outline-none disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {#if purchasing === pack.packId}
              Opening…
            {:else}
              Open for {pack.priceAmount} {pack.priceCurrency}
            {/if}
          </button>
          {#if !affordable}
            <p class="mt-2 text-xs text-muted-foreground">
              Needs {shortfall} more {pack.priceCurrency}.
            </p>
          {/if}
          {#if targetOdds?.hasTarget && targetOdds.eligible}
            <p class="mt-2 text-xs text-muted-foreground">
              Purchase rechecks the state that produced this preview. If the collection changed, the
              odds refresh and a new click is required.
            </p>
          {/if}
        </li>
      {/each}
    </ul>
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
