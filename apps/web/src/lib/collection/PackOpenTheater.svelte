<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type {
    CollectionCatalogCard,
    CollectionPullRecord,
    CollectionPullSlotResult,
    CollectionRarity,
    CollectionState,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import PackRevealCard from './PackRevealCard.svelte';
  import type { CollectionCardView } from './collection-card-view.ts';
  import type { PackRevealPlan } from './pack-reveal-plan.ts';

  type PackReceipt = {
    pull: CollectionPullRecord;
    cardsAdded: number;
    exchangeGained: number;
    balances: CollectionState['balances'];
    targetingSummary: string | null;
  };

  type PackTheaterCard = {
    slot: CollectionPullSlotResult;
    card: CollectionCatalogCard | null;
    view: CollectionCardView | null;
    targeted: boolean;
  };

  type RevealStage =
    'idle' | 'entering' | 'beats' | 'clues' | 'revealed' | 'advancing' | 'complete';

  let {
    receipt,
    cards,
    plan,
    manifest,
    packLabel,
    animateOnOpen,
    onTake,
  }: {
    receipt: PackReceipt | null;
    cards: readonly PackTheaterCard[];
    plan: PackRevealPlan | null;
    manifest: HoopRushManifest | null;
    packLabel: string;
    animateOnOpen: boolean;
    onTake: () => void;
  } = $props();

  let dialog = $state<HTMLDialogElement | undefined>(undefined);
  let skipButton = $state<HTMLButtonElement | undefined>(undefined);
  let takeButton = $state<HTMLButtonElement | undefined>(undefined);
  let stage = $state<RevealStage>('idle');
  let activeCardIndex = $state(0);
  let beatIndex = $state(0);
  let clueIndex = $state(0);
  let announcement = $state('');
  let activePullSequence: number | null = null;
  let presentationToken = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const activeCard = $derived(cards[activeCardIndex] ?? null);
  const activePlan = $derived(plan?.cards[activeCardIndex] ?? null);
  const activeBeat = $derived(activePlan?.beats[beatIndex] ?? null);
  const activeClue = $derived(activePlan?.clues[clueIndex] ?? null);

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function showSummary(message = 'Pack results are ready.'): void {
    clearTimer();
    stage = 'complete';
    announcement = message;
    void tick().then(() => takeButton?.focus());
  }

  function scheduleNext(token: number): void {
    clearTimer();
    if (stage === 'idle' || stage === 'complete') return;
    const delay = stage === 'clues' ? 620 : stage === 'revealed' ? 920 : 420;
    timer = setTimeout(() => {
      timer = null;
      if (token !== presentationToken) return;
      advance(token);
    }, delay);
  }

  function advance(token: number): void {
    if (stage === 'entering') {
      stage = 'beats';
      beatIndex = 0;
    } else if (stage === 'beats') {
      if (activePlan && beatIndex + 1 < activePlan.beats.length) {
        beatIndex += 1;
      } else if (activePlan && activePlan.clues.length > 0) {
        stage = 'clues';
        clueIndex = 0;
        announcement = activePlan.clues[0]
          ? `${activePlan.clues[0].label}: ${activePlan.clues[0].value}.`
          : '';
      } else {
        stage = 'revealed';
      }
    } else if (stage === 'clues') {
      if (activePlan && clueIndex + 1 < activePlan.clues.length) {
        clueIndex += 1;
        const clue = activePlan.clues[clueIndex];
        if (clue) announcement = `${clue.label}: ${clue.value}.`;
      } else {
        stage = 'revealed';
      }
    } else if (stage === 'revealed') {
      stage = 'advancing';
    } else if (stage === 'advancing') {
      if (activeCardIndex + 1 < cards.length) {
        activeCardIndex += 1;
        beatIndex = 0;
        clueIndex = 0;
        stage = 'entering';
        announcement = `Card ${activeCardIndex + 1} of ${cards.length}.`;
      } else {
        showSummary();
        return;
      }
    }
    scheduleNext(token);
  }

  async function startPresentation(sequence: number, shouldAnimate: boolean): Promise<void> {
    const token = ++presentationToken;
    clearTimer();
    try {
      if (dialog && !dialog.open) dialog.showModal();
    } catch {
      showSummary('The committed pack receipt is ready.');
      return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!shouldAnimate || prefersReducedMotion || !plan || cards.length === 0) {
      showSummary('The committed pack receipt is ready.');
      return;
    }

    activeCardIndex = 0;
    beatIndex = 0;
    clueIndex = 0;
    stage = 'entering';
    announcement = `Opening ${packLabel}. Card 1 of ${cards.length}.`;
    await tick();
    if (token !== presentationToken || activePullSequence !== sequence) return;
    skipButton?.focus();
    scheduleNext(token);
  }

  function skipToSummary(): void {
    if (stage !== 'complete') showSummary('Showing all committed pack results.');
  }

  function handleCancel(event: Event): void {
    event.preventDefault();
    skipToSummary();
  }

  function takeCards(): void {
    clearTimer();
    onTake();
  }

  $effect(() => {
    const currentReceipt = receipt;
    const sequence = currentReceipt?.pull.pullSequence ?? null;
    if (sequence === null) {
      if (activePullSequence !== null) {
        activePullSequence = null;
        presentationToken += 1;
        clearTimer();
        stage = 'idle';
        if (dialog?.open) dialog.close();
      }
      return;
    }
    if (sequence === activePullSequence) return;
    activePullSequence = sequence;
    void startPresentation(sequence, animateOnOpen);
  });

  onDestroy(() => {
    presentationToken += 1;
    clearTimer();
  });

  function rarityClass(rarity: CollectionRarity): string {
    return `ur-seal--${rarity.toLowerCase()}`;
  }
</script>

{#if receipt}
  <dialog
    bind:this={dialog}
    class="ur-pack-theater"
    aria-labelledby="pack-theater-title"
    aria-describedby="pack-theater-description"
    oncancel={handleCancel}
  >
    <div class="ur-pack-theater-inner" class:ur-pack-theater-complete={stage === 'complete'}>
      <header class="ur-theater-header">
        <div>
          <p class="ur-theater-label">Ultimate Run · pack receipt</p>
          <h2 id="pack-theater-title">{stage === 'complete' ? 'Pack opened' : packLabel}</h2>
        </div>
        {#if stage !== 'complete'}
          <button
            bind:this={skipButton}
            type="button"
            class="ur-theater-skip"
            onclick={skipToSummary}
          >
            Skip
          </button>
        {/if}
      </header>

      <p id="pack-theater-description" class="sr-only">
        The pack result was committed before this presentation began.
      </p>
      <p class="sr-only" role="status" aria-live="polite">{announcement}</p>

      {#if stage === 'complete'}
        <section class="ur-pack-summary" aria-label="Committed pack results">
          <div class="ur-pack-summary-scoreline">
            <div><strong>{receipt.cardsAdded}</strong><span>new cards</span></div>
            <div><strong>+{receipt.exchangeGained}</strong><span>Exchange gained</span></div>
            <div>
              <strong>{receipt.balances.Coins.toLocaleString('en-US')}</strong><span>Coins now</span
              >
            </div>
            <div>
              <strong>{receipt.balances.Exchange.toLocaleString('en-US')}</strong><span
                >Exchange now</span
              >
            </div>
          </div>
          {#if receipt.targetingSummary}
            <p class="ur-targeting-receipt">{receipt.targetingSummary}</p>
          {/if}
          <ul class="ur-pack-receipt-cards" aria-label="Cards in this pack">
            {#each cards as item (item.slot.slotIndex)}
              <li>
                <PackRevealCard
                  view={item.view}
                  {manifest}
                  displayName={item.card?.displayName ?? item.slot.cardId}
                  rarity={item.slot.rarity}
                  kept={item.slot.kept}
                  conversionAmount={item.slot.conversionAmount}
                  compact
                />
                {#if item.targeted}
                  <span class="ur-targeted-mark">Targeted player</span>
                {/if}
              </li>
            {/each}
          </ul>
          <button bind:this={takeButton} type="button" class="ur-take-cards" onclick={takeCards}>
            Take cards
          </button>
        </section>
      {:else if activeCard && activePlan}
        <section
          class="ur-reveal-stage"
          aria-label={`Card ${activeCardIndex + 1} of ${cards.length}`}
        >
          <div class="ur-reveal-stage-meta">
            <span>Card {activeCardIndex + 1} of {cards.length}</span>
            <span class={rarityClass(activePlan.rarity)}>{activePlan.rarity}</span>
          </div>
          {#if stage === 'revealed'}
            <div class="ur-revealed-card">
              <PackRevealCard
                view={activeCard.view}
                {manifest}
                displayName={activeCard.card?.displayName ?? activeCard.slot.cardId}
                rarity={activeCard.slot.rarity}
                kept={activeCard.slot.kept}
                conversionAmount={activeCard.slot.conversionAmount}
              />
            </div>
          {:else}
            <div class="ur-card-back {rarityClass(activePlan.rarity)}" data-stage={stage}>
              <span class="ur-card-back-court" aria-hidden="true"></span>
              <strong>
                {#if stage === 'entering'}
                  Sealed card
                {:else if stage === 'beats'}
                  {activeBeat ?? 'Reveal'}
                {:else if stage === 'clues' && activeClue}
                  {activeClue.label}
                {:else if stage === 'advancing'}
                  Next card up
                {/if}
              </strong>
              {#if stage === 'clues' && activeClue}
                <span class="ur-card-clue">{activeClue.value}</span>
              {:else}
                <span class="ur-card-back-caption"
                  >{stage === 'entering' ? packLabel : 'The result is already recorded'}</span
                >
              {/if}
            </div>
          {/if}
          {#if cards.length > 1}
            <button type="button" class="ur-show-all" onclick={skipToSummary}>Show all cards</button
            >
          {/if}
        </section>
      {:else}
        <section class="ur-pack-summary ur-pack-fallback" aria-label="Pack receipt">
          <p>The committed pack result is available below.</p>
          <p>{receipt.cardsAdded} new cards · +{receipt.exchangeGained} Exchange.</p>
          <button bind:this={takeButton} type="button" class="ur-take-cards" onclick={takeCards}>
            Take cards
          </button>
        </section>
      {/if}
    </div>
  </dialog>
{/if}

<style>
  .ur-pack-theater {
    width: min(60rem, calc(100vw - 2rem));
    max-width: none;
    max-height: min(92svh, 58rem);
    padding: 0;
    overflow: auto;
    border: 1px solid #657077;
    background: #080b0e;
    color: #f0ecdf;
    box-shadow: 0 2rem 8rem rgb(0 0 0 / 75%);
  }

  .ur-pack-theater::backdrop {
    background: rgb(2 4 5 / 86%);
    backdrop-filter: blur(8px);
  }

  .ur-pack-theater-inner {
    min-height: 30rem;
    padding: clamp(1rem, 3vw, 2rem);
    background:
      repeating-linear-gradient(0deg, transparent 0 43px, rgb(240 236 223 / 2.5%) 44px), #080b0e;
  }

  .ur-theater-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid #293237;
  }

  .ur-theater-label {
    color: #abb5b8;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .ur-theater-header h2 {
    margin-top: 0.2rem;
    color: #f0ecdf;
    font-family: var(--font-display);
    font-size: clamp(1.8rem, 5vw, 2.7rem);
    font-weight: 800;
    line-height: 1;
  }

  .ur-theater-skip,
  .ur-show-all,
  .ur-take-cards {
    min-height: 2.85rem;
    padding: 0.65rem 1rem;
    border: 1px solid #627077;
    color: #f0ecdf;
    font-size: 0.86rem;
    font-weight: 800;
  }

  .ur-theater-skip,
  .ur-show-all {
    background: #192126;
  }

  .ur-pack-theater button:focus-visible {
    outline: 3px solid #ffe08a;
    outline-offset: 3px;
  }

  .ur-reveal-stage {
    display: grid;
    justify-items: center;
    padding-block: 1rem 0.5rem;
  }

  .ur-reveal-stage-meta {
    display: flex;
    width: min(100%, 23rem);
    justify-content: space-between;
    gap: 1rem;
    color: #abb5b8;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .ur-seal--ember {
    --ur-reveal-rarity: #c65a2e;
  }

  .ur-seal--eruption {
    --ur-reveal-rarity: #ff5a2a;
  }

  .ur-seal--apex {
    --ur-reveal-rarity: #ffc53d;
  }

  .ur-seal--titan {
    --ur-reveal-rarity: #a9b4d8;
  }

  .ur-seal--eclipse {
    --ur-reveal-rarity: #a588ff;
  }

  .ur-seal--immortal {
    --ur-reveal-rarity: #ffe9b0;
  }

  .ur-reveal-stage-meta .ur-seal--ember,
  .ur-reveal-stage-meta .ur-seal--eruption,
  .ur-reveal-stage-meta .ur-seal--apex,
  .ur-reveal-stage-meta .ur-seal--titan,
  .ur-reveal-stage-meta .ur-seal--eclipse,
  .ur-reveal-stage-meta .ur-seal--immortal {
    color: var(--ur-reveal-rarity);
    font-weight: 800;
  }

  .ur-card-back {
    position: relative;
    display: flex;
    width: min(100%, 23rem);
    min-height: 30rem;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    margin-top: 0.75rem;
    padding: 2rem;
    border: 2px solid var(--ur-reveal-rarity);
    background: radial-gradient(ellipse at center, rgb(240 236 223 / 4%), transparent 55%), #10171b;
    text-align: center;
    clip-path: polygon(0 0, 89% 0, 100% 6%, 100% 100%, 0 100%);
  }

  .ur-card-back .ur-card-back-court {
    position: absolute;
    inset: 14% 12%;
    border: 1px solid color-mix(in srgb, var(--ur-reveal-rarity) 45%, transparent);
    border-radius: 50%;
    pointer-events: none;
  }

  .ur-card-back .ur-card-back-court::before,
  .ur-card-back .ur-card-back-court::after {
    position: absolute;
    content: '';
    pointer-events: none;
  }

  .ur-card-back .ur-card-back-court::before {
    inset: 0 48%;
    border-inline: 1px solid color-mix(in srgb, var(--ur-reveal-rarity) 40%, transparent);
  }

  .ur-card-back .ur-card-back-court::after {
    inset: 37% 0;
    border-block: 1px solid color-mix(in srgb, var(--ur-reveal-rarity) 40%, transparent);
  }

  .ur-card-back strong,
  .ur-card-back-caption,
  .ur-card-clue {
    position: relative;
    z-index: 1;
  }

  .ur-card-back strong {
    color: var(--ur-reveal-rarity);
    font-family: var(--font-display);
    font-size: clamp(2.5rem, 8vw, 4rem);
    font-weight: 800;
    line-height: 0.95;
  }

  .ur-card-back-caption,
  .ur-card-clue {
    margin-top: 1rem;
    color: #c0c8c7;
    font-size: 0.9rem;
  }

  .ur-card-clue {
    color: #f0ecdf;
    font-family: var(--font-display);
    font-size: 1.55rem;
    font-weight: 700;
  }

  .ur-revealed-card {
    display: grid;
    min-height: 30rem;
    place-items: center;
    margin-top: 0.75rem;
  }

  .ur-show-all {
    margin-top: 1rem;
  }

  .ur-pack-summary {
    padding-top: 1.25rem;
  }

  .ur-pack-summary-scoreline {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-block: 1px solid #293237;
  }

  .ur-pack-summary-scoreline div {
    display: flex;
    min-width: 0;
    flex-direction: column;
    justify-content: center;
    padding: 0.8rem 1rem;
    border-right: 1px solid #293237;
  }

  .ur-pack-summary-scoreline strong {
    overflow: hidden;
    color: #f0ecdf;
    font-family: var(--font-display);
    font-size: clamp(1.25rem, 3vw, 2rem);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ur-pack-summary-scoreline span {
    margin-top: 0.2rem;
    color: #abb5b8;
    font-size: 0.72rem;
  }

  .ur-targeting-receipt {
    margin-top: 0.8rem;
    color: #e3cd87;
    font-size: 0.85rem;
  }

  .ur-pack-receipt-cards {
    display: grid;
    gap: 0.55rem;
    margin-top: 1rem;
  }

  .ur-pack-receipt-cards li {
    min-width: 0;
  }

  .ur-targeted-mark {
    display: inline-block;
    margin: 0.25rem 0 0.2rem 0.5rem;
    color: #e3cd87;
    font-size: 0.68rem;
    font-weight: 800;
  }

  .ur-take-cards {
    width: 100%;
    margin-top: 1.25rem;
    border-color: #ffc53d;
    background: #ffc53d;
    color: #241a02;
  }

  .ur-pack-fallback > p {
    margin-top: 0.4rem;
    color: #c0c8c7;
  }

  @media (min-width: 700px) {
    .ur-pack-receipt-cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 520px) {
    .ur-pack-theater {
      width: calc(100vw - 1rem);
      max-height: calc(100svh - 1rem - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    }

    .ur-pack-theater-inner {
      min-height: 0;
      padding: 0.85rem;
    }

    .ur-card-back,
    .ur-revealed-card {
      min-height: 26rem;
    }

    .ur-pack-summary-scoreline {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .ur-pack-summary-scoreline div:nth-child(2) {
      border-right: 0;
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .ur-card-back[data-stage='beats'] {
      animation: court-signal 360ms ease-out both;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ur-pack-theater,
    .ur-pack-theater * {
      animation: none !important;
      transition: none !important;
      scroll-behavior: auto !important;
    }
  }

  @keyframes court-signal {
    from {
      border-color: #6b7478;
      background-color: #0b1114;
    }
    to {
      border-color: var(--ur-reveal-rarity);
      background-color: #141d21;
    }
  }
</style>
