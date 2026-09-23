<script lang="ts">
  import { resolve } from '$app/paths';
  import '$lib/collection/ultimate-theme.css';
  import { onDestroy } from 'svelte';
  import type {
    CollectionCatalog,
    CollectionIndexEntry,
    CollectionProgressionRules,
    CollectionPullRecord,
    CollectionState,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { COLLECTION_RARITY_ORDER } from '@hoop-rush/data-contracts';
  import { z } from 'zod';
  import { describeCollectionPackOdds, describeCollectionTargetOdds } from '@hoop-rush/engine';
  import { getManifest } from '$lib/data';
  import AsyncState from '$lib/components/AsyncState.svelte';
  import { getContext } from 'svelte';
  import {
    ULTIMATE_RUN_SHELL_CONTEXT,
    type UltimateRunShell,
  } from '$lib/collection/ultimate-shell.svelte';
  import ActiveTarget from '$lib/collection/ActiveTarget.svelte';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import {
    loadCollectionIndex,
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
  import PackOpenTheater from '$lib/collection/PackOpenTheater.svelte';
  import { collectionCardViewOf } from '$lib/collection/collection-card-view.ts';
  import { packRevealPlanOf } from '$lib/collection/pack-reveal-plan.ts';

  const shell = getContext<UltimateRunShell>(ULTIMATE_RUN_SHELL_CONTEXT);

  let mounted = true;
  onDestroy(() => {
    mounted = false;
  });

  let phase = $state<'loading' | 'error' | 'ready'>('loading');
  let error = $state<string | null>(null);
  let catalog = $state<CollectionCatalog | null>(null);
  let indexEntries = $state<CollectionIndexEntry[]>([]);
  let manifest = $state<HoopRushManifest | null>(null);
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
  let animateReceipt = $state(false);
  let announcement = $state('');

  const PACK_BLURBS: Record<string, string> = {
    'tip-off': 'One card. A quick look at the pool.',
    'fast-break': 'Three cards, all ordinary slots.',
    'full-court': 'Five cards with one Eruption-or-better slot.',
    'main-event': 'Ten cards with one Apex-or-better slot.',
    spotlight: 'One special-only card, Apex or better. Costs Exchange.',
  };
  const PACK_LABELS: Record<string, string> = {
    'tip-off': 'Tip-Off',
    'fast-break': 'Fast Break',
    'full-court': 'Full Court',
    'main-event': 'Main Event',
    spotlight: 'Spotlight',
  };

  function initialsOf(name: string): string {
    return name
      .split(/\s+/)
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  const spotlightFaces = $derived.by(() => {
    if (!catalog) return [];
    const rank = new Map(COLLECTION_RARITY_ORDER.map((rarity, index) => [rarity, index]));
    return catalog.cards
      .filter((card) => card.family !== 'Base')
      .sort(
        (a, b) =>
          (rank.get(b.rarity) ?? 0) - (rank.get(a.rarity) ?? 0) ||
          (a.cardId < b.cardId ? -1 : 1),
      )
      .slice(0, 2)
      .map((card) => ({
        playerId: card.playerId,
        playerExternalId: card.playerExternalId,
        displayName: card.displayName,
      }));
  });

  function formatChance(probability: number): string {
    if (probability <= 0) return '0%';
    const percent = probability * 100;
    if (percent >= 10) return `${percent.toFixed(1)}%`;
    if (percent >= 1) return `${percent.toFixed(2)}%`;
    return `${percent.toPrecision(2)}%`;
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
      const [loadedCatalog, loadedIndex, loadedManifest, loadedState] = await Promise.all([
        loadCollectionCatalog(),
        loadCollectionIndex(),
        getManifest(),
        ensureCollection(new Date().toISOString()),
      ]);
      if (!mounted) return;
      catalog = loadedCatalog;
      indexEntries = loadedIndex.cards;
      manifest = loadedManifest;
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
      animateReceipt = false;
    } catch {
      // A missing receipt simply means nothing to restore.
    }
  }

  $effect(() => {
    void load();
  });

  $effect(() => {
    if (collectionState && catalog) shell.sync(collectionState, catalog.cards.length);
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
  const activeTargetPlayer = $derived.by(() => {
    if (!catalog || !activeTargetId) return null;
    const card = catalog.cards.find((entry) => entry.playerId === activeTargetId);
    if (!card) return null;
    return {
      playerId: activeTargetId,
      playerExternalId: card.playerExternalId,
      altIds: null,
    };
  });
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
      animateReceipt = true;
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
    const currentReceipt = receipt;
    if (!currentReceipt || !catalog) return [];
    const cardsById = new Map(catalog.cards.map((card) => [card.cardId, card]));
    const entriesById = new Map(indexEntries.map((entry) => [entry.cardId, entry]));
    return currentReceipt.pull.slots.map((slot) => {
      const card = cardsById.get(slot.cardId) ?? null;
      const entry = entriesById.get(slot.cardId);
      return {
        slot,
        card,
        view: entry ? collectionCardViewOf({ entry, catalogCard: card, owned: slot.kept }) : null,
        targeted: isTargetedPullSlot(currentReceipt.pull, slot.cardId, playerIdOf),
      };
    });
  });
  const revealPlan = $derived(
    receipt && catalog
      ? packRevealPlanOf({ pull: receipt.pull, catalogCards: catalog.cards })
      : null,
  );

  function takeReceipt(): void {
    try {
      sessionStorage.removeItem('collection-last-receipt');
    } catch {
      // Receipt recovery is best-effort.
    }
    receipt = null;
    animateReceipt = false;
  }
</script>

<div class="ur-page ur-packs-page">
  <section class="pack-hero" aria-labelledby="pack-store-title">
    <div class="pack-hero-glow" aria-hidden="true"></div>
    <div class="pack-hero-inner">
      <div class="pack-hero-copy">
        <p class="ur-hero-eyebrow pack-kicker">Pack shelf</p>
        <h2 id="pack-store-title" class="pack-title">Choose a <span class="pack-gold">pack</span></h2>
        <p class="ur-page-description">
          Compare the cost, card slots, guarantees, and exact draw odds before opening.
        </p>
      </div>
      {#if collectionState}
        <section class="ur-wallet ur-stat-duo" aria-label="Available balance">
          <p class="ur-wallet-title ur-hero-eyebrow">Available balance</p>
          <div class="ur-wallet-balances">
            <p class="ur-stat-box ur-stat-gold">
              <span class="coin-dot" aria-hidden="true">$</span>
              <strong class="ur-number">{balances.Coins.toLocaleString('en-US')}</strong>
              <span><small>Coins</small></span>
            </p>
            <p class="ur-stat-box">
              <span class="exchange-dot" aria-hidden="true">◈</span>
              <strong class="ur-number">{balances.Exchange.toLocaleString('en-US')}</strong>
              <span><small>Exchange</small></span>
            </p>
          </div>
        </section>
      {/if}
    </div>
  </section>

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
      href={resolve('/ultimate/run/collection' as any)}
      class="ur-btn-gold mt-3 inline-block px-5 py-2.5 outline-none"
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
        player={activeTargetPlayer}
        {manifest}
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

    <ul class="ur-pack-shelf mt-6">
      {#each catalog.packs as pack (pack.packId)}
        {@const odds = describeCollectionPackOdds(catalog, pack)}
        {@const targetOdds = targetOddsByPack.get(pack.packId)}
        {@const affordable = balances[pack.priceCurrency] >= pack.priceAmount}
        {@const shortfall = pack.priceAmount - balances[pack.priceCurrency]}
        {@const guaranteedCount = pack.slots.filter((slot) => slot.kind === 'guaranteed').length}
        {@const isExchange = pack.priceCurrency === 'Exchange'}
        <li
          class="ur-pack-product"
          class:pack-exchange={isExchange}
          class:pack-tip-off={pack.packId === 'tip-off'}
          class:pack-fast-break={pack.packId === 'fast-break'}
          class:pack-full-court={pack.packId === 'full-court'}
          class:pack-main-event={pack.packId === 'main-event'}
          class:pack-spotlight={pack.packId === 'spotlight'}
        >
          <div class="pack-visual" aria-hidden="true">
            {#if pack.packId === 'spotlight' && spotlightFaces.length > 0}
              <div class="pack-faces" aria-hidden="true">
                {#each spotlightFaces as face, faceIndex (face.playerId + '-' + String(faceIndex))}
                  <div class="spot-face spot-face-{faceIndex}">
                    {#if manifest}
                      <PlayerFace
                        player={{
                          playerId: face.playerId,
                          playerExternalId: face.playerExternalId,
                          altIds: null,
                        }}
                        {manifest}
                        size="sm"
                        eager
                        fallbackInitials={initialsOf(face.displayName)}
                      />
                    {:else}
                      <span class="spot-face-initials">{initialsOf(face.displayName)}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
            <div class="pack-foil">
              <span class="foil-brand">UR</span>
              <span class="foil-name">{PACK_LABELS[pack.packId] ?? pack.packId}</span>
              <span class="foil-count ur-number">{pack.slots.length}</span>
              <span class="foil-unit">{pack.slots.length === 1 ? 'CARD' : 'CARDS'}</span>
            </div>
            <div class="pack-visual-copy">
              <h2>{PACK_LABELS[pack.packId] ?? pack.packId}</h2>
              <p>{PACK_BLURBS[pack.packId] ?? ''}</p>
              {#if guaranteedCount > 0}
                <span class="guarantee-pill">
                  <span class="guarantee-crown" aria-hidden="true">♛</span>
                  {guaranteedCount} guaranteed
                </span>
              {/if}
            </div>
          </div>

          <div class="pack-body">
            <div class="pack-meta">
              <p class="pack-meta-cards">
                <span class="meta-icon" aria-hidden="true">▤</span>
                <strong class="ur-number"
                  >{pack.slots.length} {pack.slots.length === 1 ? 'Card' : 'Cards'}</strong
                >
                <small>
                  {pack.slots.length} {pack.slots.length === 1 ? 'slot' : 'slots'}{#if guaranteedCount > 0} · {guaranteedCount} guaranteed{/if}
                </small>
              </p>
              <p
                class="pack-meta-price"
                aria-label={`Cost: ${pack.priceAmount} ${pack.priceCurrency}`}
              >
                {#if isExchange}
                  <span class="exchange-dot" aria-hidden="true">◈</span>
                {:else}
                  <span class="coin-dot" aria-hidden="true">$</span>
                {/if}
                <strong class="ur-number">{pack.priceAmount.toLocaleString('en-US')}</strong>
                <small>{pack.priceCurrency}</small>
              </p>
            </div>

            <section class="ur-odds-preview" aria-label="Odds of at least one card at each rarity">
              <h3>Chance of at least one</h3>
              <ul>
                {#each COLLECTION_RARITY_ORDER as rarity (rarity)}
                  <li>
                    <span class="ur-rarity ur-rarity-{rarity.toLowerCase()}">{rarity}</span>
                    <strong class="ur-number">{formatChance(odds.atLeastOne[rarity] ?? 0)}</strong>
                  </li>
                {/each}
              </ul>
            </section>

            {#if targetOdds}
              <p class="ur-target-odds" class:ur-target-odds-ineligible={!targetOdds.eligible}>
                {targetOdds.summary}
              </p>
            {/if}

            <details class="ur-pack-odds-details">
              <summary><span>Odds details</span><span class="details-chevron" aria-hidden="true">›</span></summary>
              <div class="ur-odds-table-wrap">
                <table>
                  <thead>
                    <tr class="text-muted-foreground">
                      <th scope="col">Rarity</th>
                      {#each odds.perSlot as slot (slot.slotIndex)}
                        <th scope="col">Slot {slot.slotIndex + 1}</th>
                      {/each}
                      <th scope="col">≥1 in pack</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each COLLECTION_RARITY_ORDER as rarity (rarity)}
                      <tr>
                        <th scope="row">{rarity}</th>
                        {#each odds.perSlot as slot (slot.slotIndex)}
                          <td class="ur-number">{formatChance(slot.distribution[rarity] ?? 0)}</td>
                        {/each}
                        <td class="ur-number">{formatChance(odds.atLeastOne[rarity] ?? 0)}</td>
                      </tr>
                    {/each}
                    {#if targetOdds?.hasTarget}
                      <tr>
                        <th scope="row">Target player</th>
                        {#each targetOdds.perSlotLabels as label, index (index)}
                          <td class="ur-number">{label}</td>
                        {/each}
                        <td class="ur-number">{targetOdds.atLeastOneLabel}</td>
                      </tr>
                    {/if}
                  </tbody>
                </table>
              </div>
              <p class="ur-odds-note">
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
              <p class="ur-target-blocked">
                The targeting rules artifact is unavailable, so this pack cannot be opened while a
                target is active. Clear the target or retry loading.
              </p>
            {/if}
            <button
              type="button"
              onclick={() => buy(pack.packId)}
              disabled={!affordable || purchasing !== null || targetingBlocked}
              class="ur-pack-buy"
            >
              <span class="buy-count" aria-hidden="true">1</span>
              {#if purchasing === pack.packId}
                Opening…
              {:else}
                Open for {pack.priceAmount} {pack.priceCurrency}
              {/if}
            </button>
            {#if !affordable}
              <p class="ur-pack-shortfall">
                Needs {shortfall} more {pack.priceCurrency}.
              </p>
            {/if}
            {#if targetOdds?.hasTarget && targetOdds.eligible}
              <p class="ur-preview-notice">
                Purchase rechecks the state that produced this preview. If the collection changed, the
                odds refresh and a new click is required.
              </p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if receipt}
  <PackOpenTheater
    receipt={{
      pull: receipt.pull,
      cardsAdded: receipt.cardsAdded,
      exchangeGained: receipt.exchangeGained,
      balances: receipt.balances,
      targetingSummary: receipt.targeting?.summary ?? null,
    }}
    cards={receiptCards}
    plan={revealPlan}
    {manifest}
    packLabel={PACK_LABELS[receipt.pull.packId ?? ''] ?? 'Starter'}
    animateOnOpen={animateReceipt}
    onTake={takeReceipt}
  />
{/if}

<style>
  .ur-page-description {
    max-width: 52ch;
    margin-top: 0.55rem;
    color: color-mix(in srgb, var(--ur-paper) 74%, transparent);
    font-size: 0.92rem;
    line-height: 1.55;
  }

  .pack-hero {
    position: relative;
    overflow: hidden;
    margin-bottom: 1.1rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 30%, var(--ur-line-strong));
    border-radius: 0.75rem;
    background:
      linear-gradient(180deg, rgb(255 197 61 / 5%), transparent 22%),
      linear-gradient(165deg, #141c21, #0b1114 75%);
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 40%),
      0 0 2rem rgb(255 197 61 / 6%),
      0 1.2rem 2.5rem rgb(0 0 0 / 35%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
  }

  .pack-hero-glow {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(105deg, transparent 42%, rgb(255 197 61 / 7%) 50%, transparent 58%),
      linear-gradient(75deg, transparent 55%, rgb(255 255 255 / 4%) 62%, transparent 70%);
    pointer-events: none;
  }

  .pack-hero-inner {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1.25rem;
    padding: clamp(1.25rem, 3vw, 2.25rem);
  }

  .pack-kicker {
    color: var(--ur-apex);
  }

  .pack-hero-copy .pack-title {
    margin-top: 0.25rem;
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(2rem, 5vw, 3.1rem);
    font-weight: 900;
    letter-spacing: -0.035em;
    line-height: 0.95;
    text-shadow: 0 2px 18px rgb(0 0 0 / 60%);
  }

  .pack-gold {
    color: var(--ur-apex);
  }

  .ur-wallet {
    min-width: min(100%, 22rem);
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
    backdrop-filter: none;
  }

  .ur-wallet-title {
    margin-bottom: 0.5rem;
  }

  .ur-wallet-balances {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.55rem;
    margin-top: 0;
  }

  .ur-wallet-balances .ur-stat-box {
    min-width: 0;
    align-items: center;
  }

  .ur-wallet-balances p + p {
    padding-left: 0.7rem;
    border-left: 0;
  }

  .ur-wallet-balances strong {
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .ur-wallet-balances .ur-stat-gold strong {
    color: var(--ur-apex);
  }

  .ur-wallet-balances span:last-child {
    color: var(--ur-muted);
    font-size: 0.7rem;
  }

  .ur-wallet-balances small {
    color: var(--ur-muted);
    font-size: 0.68rem;
  }

  .coin-dot,
  .exchange-dot {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 900;
  }

  .coin-dot {
    background: radial-gradient(circle at 35% 30%, #ffe9a8, #f5b81f 60%, #9a6206);
    color: #3a2703;
    box-shadow: 0 0 0.7rem rgb(255 197 61 / 55%);
  }

  .exchange-dot {
    background: radial-gradient(circle at 35% 30%, #e3d0ff, #8b5cf6 60%, #4c1d95);
    color: #1e1033;
    box-shadow: 0 0 0.7rem rgb(139 92 246 / 55%);
  }

  .ur-pack-shelf {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    align-items: stretch;
    gap: clamp(0.85rem, 1.6vw, 1.25rem);
    margin-top: 1.5rem;
    padding: 0;
    list-style: none;
  }

  .ur-packs-page :global(.ur-active-target) {
    border: 1px solid color-mix(in srgb, var(--ur-apex) 34%, var(--ur-line-strong));
    border-radius: 0.75rem;
  }

  .ur-pack-product {
    display: flex;
    grid-column: span 4;
    min-width: 0;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 30%, var(--ur-line-strong));
    border-radius: 0.75rem;
    background:
      linear-gradient(180deg, rgb(255 197 61 / 5%), transparent 22%),
      linear-gradient(165deg, #141c21, #0b1114 75%);
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 40%),
      0 0 2rem rgb(255 197 61 / 6%),
      0 1.2rem 2.5rem rgb(0 0 0 / 35%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
  }

  .pack-main-event {
    grid-column: span 7;
    border-color: color-mix(in srgb, var(--ur-apex) 42%, var(--ur-line-strong));
  }

  .pack-spotlight {
    grid-column: span 5;
    border-color: color-mix(in srgb, var(--ur-titan) 55%, var(--ur-line-strong));
    box-shadow:
      0 0 0 1px rgb(0 0 0 / 40%),
      0 0 2rem rgb(169 180 216 / 12%),
      0 1.2rem 2.5rem rgb(0 0 0 / 35%),
      inset 0 1px 0 rgb(255 255 255 / 6%);
  }

  .pack-visual {
    position: relative;
    display: grid;
    grid-template-columns: 8.5rem minmax(0, 1fr);
    align-items: center;
    gap: 1rem;
    min-height: 11rem;
    padding: 1.1rem 1.1rem 1rem;
    overflow: hidden;
    background:
      radial-gradient(22rem 12rem at 20% -40%, rgb(255 197 61 / 30%), transparent 60%),
      linear-gradient(180deg, #1b1510 0%, #0b0906 100%);
  }

  .pack-visual::before {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(105deg, transparent 44%, rgb(255 220 130 / 9%) 50%, transparent 56%),
      linear-gradient(75deg, transparent 60%, rgb(255 255 255 / 5%) 66%, transparent 72%);
    content: '';
    pointer-events: none;
  }

  .pack-visual::after {
    position: absolute;
    inset: auto 0 0;
    height: 45%;
    background: radial-gradient(70% 100% at 30% 110%, rgb(255 197 61 / 20%), transparent 70%);
    content: '';
    pointer-events: none;
  }

  .pack-tip-off .pack-visual {
    background:
      radial-gradient(22rem 12rem at 20% -40%, rgb(255 197 61 / 34%), transparent 60%),
      linear-gradient(180deg, #221a0c 0%, #0d0a04 100%);
  }

  .pack-tip-off .pack-visual::after {
    background: radial-gradient(70% 100% at 30% 110%, rgb(255 197 61 / 24%), transparent 70%);
  }

  .pack-fast-break .pack-visual {
    background:
      radial-gradient(22rem 12rem at 20% -40%, rgb(255 90 42 / 42%), transparent 60%),
      linear-gradient(180deg, #230f0a 0%, #0d0503 100%);
  }

  .pack-fast-break .pack-visual::after {
    background: radial-gradient(70% 100% at 30% 110%, rgb(255 90 42 / 28%), transparent 70%);
  }

  .pack-full-court .pack-visual {
    background:
      radial-gradient(24rem 13rem at 80% -40%, rgb(139 92 246 / 44%), transparent 62%),
      linear-gradient(180deg, #181029 0%, #0b0714 100%);
  }

  .pack-full-court .pack-visual::after {
    background: radial-gradient(70% 100% at 50% 110%, rgb(139 92 246 / 30%), transparent 70%);
  }

  .pack-main-event .pack-visual {
    background:
      radial-gradient(26rem 13rem at 15% -40%, rgb(255 197 61 / 40%), transparent 60%),
      radial-gradient(24rem 12rem at 85% -30%, rgb(255 218 115 / 26%), transparent 62%),
      linear-gradient(180deg, #241b08 0%, #0e0a03 100%);
  }

  .pack-main-event .pack-visual::after {
    background: radial-gradient(70% 100% at 50% 110%, rgb(255 197 61 / 28%), transparent 70%);
  }

  .pack-spotlight .pack-visual {
    background:
      radial-gradient(24rem 13rem at 20% -40%, rgb(169 180 216 / 42%), transparent 62%),
      radial-gradient(20rem 12rem at 85% 120%, rgb(223 229 255 / 18%), transparent 60%),
      linear-gradient(180deg, #1b2233 0%, #0a0d16 100%);
  }

  .pack-spotlight .pack-visual::after {
    background: radial-gradient(70% 100% at 50% 110%, rgb(169 180 216 / 30%), transparent 70%);
  }

  .pack-foil {
    position: relative;
    z-index: 1;
    display: flex;
    min-height: 9rem;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.1rem;
    padding: 0.6rem 0.5rem;
    border: 1px solid rgb(255 220 130 / 70%);
    border-radius: 0.65rem;
    background: linear-gradient(160deg, #2a2111 0%, #0f0d08 45%, #3a2c10 100%);
    box-shadow:
      inset 0 1px 0 rgb(255 235 180 / 35%),
      inset 0 -0.6rem 1rem rgb(0 0 0 / 55%),
      0 0.5rem 1.2rem rgb(0 0 0 / 60%),
      0 0 1.4rem rgb(255 197 61 / 18%);
    text-align: center;
    transform: perspective(30rem) rotateY(-7deg);
  }

  .pack-foil::before {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(115deg, transparent 42%, rgb(255 240 200 / 22%) 50%, transparent 58%);
    content: '';
    pointer-events: none;
  }

  .pack-spotlight .pack-foil {
    border-color: rgb(169 180 216 / 80%);
    background: linear-gradient(160deg, #232c44 0%, #0b0e18 50%, #3d4a6e 100%);
    box-shadow:
      inset 0 1px 0 rgb(223 229 255 / 35%),
      inset 0 -0.6rem 1rem rgb(0 0 0 / 55%),
      0 0.5rem 1.2rem rgb(0 0 0 / 60%),
      0 0 1.6rem rgb(169 180 216 / 35%);
    transform: perspective(30rem) rotateY(7deg);
  }

  .foil-brand {
    padding: 0.1rem 0.4rem;
    border: 1px solid rgb(255 220 130 / 60%);
    border-radius: 999px;
    color: var(--ur-apex);
    font-size: 0.6rem;
    font-weight: 900;
    letter-spacing: 0.2em;
  }

  .pack-spotlight .foil-brand {
    border-color: rgb(169 180 216 / 60%);
    color: #dfe5ff;
  }

  .foil-name {
    margin-top: 0.3rem;
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    line-height: 1.1;
    text-transform: uppercase;
  }

  .foil-count {
    color: #fff;
    font-family: var(--font-display);
    font-size: 2.6rem;
    font-weight: 800;
    line-height: 1;
    text-shadow: 0 0 1rem rgb(255 197 61 / 80%);
  }

  .pack-spotlight .foil-count {
    text-shadow: 0 0 1rem rgb(169 180 216 / 90%);
  }

  .foil-unit {
    color: var(--ur-muted);
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.28em;
  }

  .pack-visual-copy {
    position: relative;
    z-index: 1;
    min-width: 0;
  }

  .pack-visual-copy h2 {
    color: #fff;
    font-family: var(--font-display);
    font-size: clamp(1.5rem, 2.4vw, 2rem);
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1;
    text-shadow: 0 0.15rem 1rem rgb(0 0 0 / 70%);
  }

  .pack-visual-copy p {
    margin-top: 0.35rem;
    color: rgb(255 255 255 / 78%);
    font-size: 0.8rem;
    line-height: 1.45;
    text-shadow: 0 0.1rem 0.6rem rgb(0 0 0 / 70%);
  }

  .guarantee-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.6rem;
    padding: 0.3rem 0.6rem;
    border: 1px solid rgb(255 197 61 / 75%);
    border-radius: 0.45rem;
    background: rgb(20 12 2 / 72%);
    color: #ffd876;
    font-size: 0.68rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .guarantee-crown {
    font-size: 0.8rem;
  }

  .pack-spotlight .guarantee-pill {
    border-color: rgb(169 180 216 / 75%);
    background: rgb(18 24 40 / 72%);
    color: #dfe5ff;
  }

  .pack-faces {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }

  .spot-face {
    position: absolute;
    top: 50%;
    width: 3.6rem;
    height: 4.8rem;
    translate: 0 -50%;
  }

  .spot-face-0 {
    left: 0.35rem;
    transform: rotate(-10deg);
  }

  .spot-face-1 {
    left: 7.4rem;
    transform: rotate(9deg);
  }

  .spot-face :global(.relative) {
    width: 100%;
    height: 100%;
    border: 1px solid rgb(169 180 216 / 70%);
    border-radius: 0.55rem;
    background: #1c2233;
    box-shadow: 0 0 1rem rgb(169 180 216 / 45%);
  }

  .spot-face-initials {
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    border: 1px solid rgb(169 180 216 / 70%);
    border-radius: 0.55rem;
    background: #232c44;
    color: #dfe5ff;
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 800;
  }

  .pack-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    padding: 0.9rem 1rem 1rem;
    border-top: 1px solid color-mix(in srgb, var(--ur-apex) 22%, var(--ur-line));
    background:
      linear-gradient(180deg, rgb(255 197 61 / 5%), transparent 30%),
      linear-gradient(165deg, #141c21, #0b1114 75%);
  }

  .pack-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding-bottom: 0.8rem;
    border-bottom: 1px solid var(--ur-line);
  }

  .pack-meta-cards {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.5rem;
    color: var(--ur-paper);
  }

  .meta-icon {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    border: 1px solid var(--ur-line-strong);
    border-radius: 0.45rem;
    background: var(--ur-surface);
    color: var(--ur-paper);
    font-size: 0.9rem;
  }

  .pack-meta-cards strong {
    font-size: 0.95rem;
    white-space: nowrap;
  }

  .pack-meta-cards small {
    display: block;
    color: var(--ur-muted);
    font-size: 0.68rem;
    font-weight: 400;
    white-space: nowrap;
  }

  .pack-meta-price {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.45rem;
    padding: 0.4rem 0.65rem;
    padding-left: 0.65rem;
    border: 1px solid color-mix(in srgb, var(--ur-apex) 45%, var(--ur-line-strong));
    border-radius: 999px;
    background: rgb(6 9 12 / 72%);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 6%);
  }

  .pack-meta-price .coin-dot,
  .pack-meta-price .exchange-dot {
    width: 1.35rem;
    height: 1.35rem;
    font-size: 0.68rem;
  }

  .pack-meta-price strong {
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 800;
  }

  .pack-meta-price small {
    color: var(--ur-apex);
    font-size: 0.68rem;
    font-weight: 800;
  }

  .pack-exchange .pack-meta-price {
    border-color: color-mix(in srgb, var(--ur-titan) 55%, var(--ur-line-strong));
  }

  .pack-exchange .pack-meta-price small {
    color: var(--ur-titan);
  }

  .ur-odds-preview {
    margin-top: 0.8rem;
  }

  .ur-odds-preview h3 {
    color: var(--ur-muted);
    font-size: 0.68rem;
    font-weight: 700;
  }

  .ur-odds-preview ul {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.45rem;
    margin-top: 0.5rem;
    padding: 0;
    list-style: none;
  }

  .ur-odds-preview li {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
  }

  .ur-odds-preview .ur-rarity {
    flex: 1;
    justify-content: center;
    min-height: 1.45rem;
    padding: 0.25rem 0.3rem;
    border-radius: 0.3rem;
    font-size: 0.6rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .ur-odds-preview .ur-rarity-ember {
    border-color: #6b7683;
    background: #2b3138;
    color: #e8edf2;
  }

  .ur-odds-preview .ur-rarity-eruption {
    border-color: #e04a3a;
    background: #5a1f1a;
    color: #ffd9d2;
  }

  .ur-odds-preview .ur-rarity-apex {
    border-color: #ffc53d;
    background: #4a3a14;
    color: #ffe39a;
  }

  .ur-odds-preview .ur-rarity-titan {
    border-color: #a588ff;
    background: #3b2a5e;
    color: #d9c8ff;
  }

  .ur-odds-preview .ur-rarity-eclipse {
    border-color: #ff7a2a;
    background: #55250f;
    color: #ffe0c2;
  }

  .ur-odds-preview .ur-rarity-immortal {
    border-color: #ffe9b0;
    background: #5c4c22;
    color: #fff4d5;
  }

  .ur-odds-preview strong {
    flex: none;
    color: var(--ur-paper);
    font-size: 0.74rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .ur-target-odds {
    margin-top: 0.65rem;
    padding: 0.6rem 0.7rem;
    border-left: 2px solid var(--ur-accent);
    background: var(--ur-surface);
    color: var(--ur-paper);
    font-size: 0.75rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .ur-target-odds-ineligible {
    border-left-color: var(--ur-line-strong);
    color: var(--ur-muted);
  }

  .ur-pack-odds-details {
    margin-top: 0.65rem;
    border: 1px solid var(--ur-line);
    border-radius: 0.6rem;
    background: var(--ur-bg);
  }

  .ur-pack-odds-details summary {
    display: flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.45rem 0.7rem;
    color: var(--ur-paper);
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 800;
    list-style: none;
  }

  .ur-pack-odds-details summary::-webkit-details-marker {
    display: none;
  }

  .details-chevron {
    color: var(--ur-apex);
    font-size: 1.1rem;
    line-height: 1;
  }

  .pack-spotlight .details-chevron {
    color: var(--ur-titan);
  }

  .ur-odds-table-wrap {
    overflow-x: auto;
    padding: 0 0.65rem 0.65rem;
  }

  .ur-pack-odds-details table {
    width: 100%;
    min-width: max-content;
    border-collapse: collapse;
    text-align: left;
    font-size: 0.65rem;
    white-space: nowrap;
  }

  .ur-pack-odds-details th,
  .ur-pack-odds-details td {
    padding: 0.4rem 0.45rem;
    border-bottom: 1px solid var(--ur-line);
  }

  .ur-pack-odds-details thead th {
    color: var(--ur-muted);
    font-weight: 700;
  }

  .ur-pack-odds-details tbody th {
    color: var(--ur-paper);
    font-weight: 700;
  }

  .ur-pack-odds-details td {
    color: var(--ur-ink);
    text-align: right;
  }

  .ur-odds-note {
    margin-top: 0.65rem;
    color: var(--ur-muted);
    font-size: 0.65rem;
    line-height: 1.5;
    white-space: normal;
  }

  .ur-target-blocked,
  .ur-pack-shortfall,
  .ur-preview-notice {
    margin-top: 0.55rem;
    font-size: 0.68rem;
    line-height: 1.45;
  }

  .ur-target-blocked {
    color: var(--ur-danger);
  }

  .ur-pack-shortfall,
  .ur-preview-notice {
    color: var(--ur-muted);
  }

  .ur-pack-buy {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    width: 100%;
    min-height: 3rem;
    margin-top: 0.9rem;
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--ur-apex);
    border-radius: 0.55rem;
    background: linear-gradient(180deg, #ffda73 0%, #f5b81f 55%, #e09b12 100%);
    color: #2a1c02;
    font-size: 0.9rem;
    font-weight: 900;
    line-height: 1.2;
    text-align: center;
    cursor: pointer;
    box-shadow:
      0 0.4rem 1.2rem rgb(245 184 31 / 35%),
      inset 0 1px 0 rgb(255 255 255 / 55%);
  }

  .ur-pack-buy:hover:not(:disabled) {
    filter: brightness(1.06);
  }

  .buy-count {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 999px;
    background: rgb(0 0 0 / 72%);
    color: #ffd876;
    font-size: 0.72rem;
    font-weight: 900;
  }

  .pack-exchange .ur-pack-buy {
    border-color: var(--ur-titan);
    background: linear-gradient(180deg, #dfe5ff 0%, var(--ur-titan) 55%, #7d8cc0 100%);
    color: #141a2a;
    box-shadow:
      0 0.4rem 1.2rem rgb(169 180 216 / 40%),
      inset 0 1px 0 rgb(255 255 255 / 45%);
  }

  .pack-exchange .buy-count {
    background: rgb(20 26 42 / 80%);
    color: #dfe5ff;
  }

  .ur-pack-buy:disabled {
    border-color: var(--ur-line-strong);
    background: var(--ur-surface);
    color: var(--ur-muted);
    cursor: not-allowed;
    box-shadow: none;
  }

  .ur-pack-buy:disabled .buy-count {
    background: color-mix(in srgb, var(--ur-muted) 25%, transparent);
    color: var(--ur-muted);
  }

  .ur-packs-page :global(button:focus-visible),
  .ur-packs-page :global(summary:focus-visible) {
    outline: 3px solid var(--ur-focus);
    outline-offset: 3px;
  }

  @media (max-width: 1100px) {
    .ur-pack-product,
    .pack-main-event,
    .pack-spotlight {
      grid-column: span 6;
    }
  }

  @media (max-width: 720px) {
    .pack-hero-inner {
      flex-direction: column;
      align-items: stretch;
    }

    .ur-wallet {
      width: 100%;
    }

    .ur-pack-product,
    .pack-main-event,
    .pack-spotlight {
      grid-column: span 12;
    }

    .pack-visual {
      grid-template-columns: 7rem minmax(0, 1fr);
    }

    .ur-odds-preview ul {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 420px) {
    .ur-wallet-balances {
      gap: 0.85rem;
    }

    .pack-meta-cards small {
      white-space: normal;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ur-packs-page :global(*) {
      animation: none !important;
      transition: none !important;
    }
  }
</style>
