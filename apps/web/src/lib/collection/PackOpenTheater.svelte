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
          <p class="ur-theater-label">Committed receipt</p>
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
      <p class="ur-theater-context">The pack result is already recorded.</p>

      {#if stage === 'complete'}
        <section class="ur-pack-summary" aria-label="Committed pack results">
          <div class="ur-summary-heading">
            <h3>Receipt confirmed</h3>
            <p>These are the cards and balances from this pack.</p>
          </div>
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
          data-stage={stage}
          aria-label={`Card ${activeCardIndex + 1} of ${cards.length}`}
        >
          <div class="ur-reveal-stage-meta">
            <span>Card {activeCardIndex + 1} of {cards.length}</span>
            <span
              class={stage === 'revealed' ? rarityClass(activePlan.rarity) : 'ur-seal--sealed'}
              aria-label={stage === 'revealed' ? activePlan.rarity : 'Card sealed'}
              >{stage === 'revealed' ? activePlan.rarity : 'Sealed'}</span
            >
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
            <div class="ur-card-back ur-seal--sealed" data-stage={stage}>
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
    width: min(70rem, calc(100vw - 2rem));
    max-width: none;
    max-height: min(94svh, 62rem);
    padding: 0;
    overflow: auto;
    border: 1px solid var(--ur-line-strong);
    background: var(--ur-bg);
    color: var(--ur-ink);
    box-shadow: 0 2rem 8rem color-mix(in srgb, var(--ur-bg) 84%, transparent);
  }

  .ur-pack-theater::backdrop {
    background: color-mix(in srgb, var(--ur-bg) 88%, transparent);
    backdrop-filter: blur(7px);
  }

  .ur-pack-theater-inner {
    min-height: 32rem;
    padding: clamp(1rem, 3vw, 2rem);
    background:
      linear-gradient(
        90deg,
        transparent calc(50% - 1px),
        color-mix(in srgb, var(--ur-line) 24%, transparent) 50%,
        transparent calc(50% + 1px)
      ),
      radial-gradient(
        ellipse at 50% 0%,
        color-mix(in srgb, var(--ur-accent) 10%, transparent),
        transparent 55%
      ),
      var(--ur-bg);
  }

  .ur-theater-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.9rem;
    border-bottom: 1px solid var(--ur-line);
  }

  .ur-theater-label {
    color: var(--ur-accent);
    font-size: 0.7rem;
    font-weight: 700;
  }

  .ur-theater-header h2 {
    margin-top: 0.2rem;
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: clamp(1.8rem, 5vw, 2.7rem);
    font-weight: 800;
    line-height: 1;
  }

  .ur-theater-context {
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--ur-line);
    color: var(--ur-muted);
    font-size: 0.72rem;
  }

  .ur-theater-skip,
  .ur-show-all,
  .ur-take-cards {
    min-height: 2.85rem;
    padding: 0.65rem 1rem;
    border: 1px solid var(--ur-line-strong);
    color: var(--ur-paper);
    font-size: 0.86rem;
    font-weight: 800;
    cursor: pointer;
  }

  .ur-theater-skip,
  .ur-show-all {
    background: var(--ur-surface);
  }

  .ur-pack-theater button:focus-visible {
    outline: 3px solid var(--ur-focus);
    outline-offset: 3px;
  }

  .ur-reveal-stage {
    position: relative;
    isolation: isolate;
    display: grid;
    justify-items: center;
    overflow: hidden;
    margin-top: 1.2rem;
    padding: clamp(1rem, 3vw, 1.75rem) 1rem 1.25rem;
    border: 1px solid var(--ur-line);
    background:
      radial-gradient(
        ellipse at 50% 12%,
        color-mix(in srgb, var(--ur-accent) 14%, transparent),
        transparent 48%
      ),
      repeating-linear-gradient(
        0deg,
        transparent 0 3.4rem,
        color-mix(in srgb, var(--ur-line) 14%, transparent) 3.45rem
      ),
      var(--ur-bg);
  }

  .ur-reveal-stage::before,
  .ur-reveal-stage::after {
    position: absolute;
    z-index: -1;
    content: '';
    pointer-events: none;
  }

  .ur-reveal-stage::before {
    inset: 8% 15%;
    border: 1px solid color-mix(in srgb, var(--ur-line-strong) 35%, transparent);
    border-radius: 50%;
  }

  .ur-reveal-stage::after {
    inset: 8% 49.5%;
    border-inline: 1px solid color-mix(in srgb, var(--ur-line-strong) 28%, transparent);
  }

  .ur-reveal-stage-meta {
    position: relative;
    z-index: 1;
    display: flex;
    width: min(100%, 25rem);
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    color: var(--ur-muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .ur-reveal-stage-meta > span:last-child {
    display: inline-flex;
    min-height: 1.5rem;
    align-items: center;
    padding: 0.15rem 0.45rem;
    border: 1px solid currentColor;
    font-weight: 800;
  }

  .ur-seal--sealed {
    color: var(--ur-muted);
  }

  .ur-seal--ember {
    --ur-reveal-rarity: var(--ur-ember);
  }

  .ur-seal--eruption {
    --ur-reveal-rarity: var(--ur-eruption);
  }

  .ur-seal--apex {
    --ur-reveal-rarity: var(--ur-apex);
  }

  .ur-seal--titan {
    --ur-reveal-rarity: var(--ur-titan);
  }

  .ur-seal--eclipse {
    --ur-reveal-rarity: var(--ur-eclipse);
  }

  .ur-seal--immortal {
    --ur-reveal-rarity: var(--ur-immortal);
  }

  .ur-reveal-stage-meta > span:last-child:not(.ur-seal--sealed) {
    color: var(--ur-reveal-rarity);
  }

  .ur-card-back {
    position: relative;
    display: flex;
    width: min(100%, 25rem);
    min-height: clamp(24rem, 54svh, 34rem);
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    margin-top: 0.75rem;
    padding: clamp(1.5rem, 5vw, 2.5rem);
    border: 2px solid var(--ur-reveal-rarity, var(--ur-line-strong));
    background:
      radial-gradient(
        ellipse at center,
        color-mix(in srgb, var(--ur-paper) 7%, transparent),
        transparent 55%
      ),
      linear-gradient(155deg, color-mix(in srgb, var(--ur-surface) 74%, transparent), var(--ur-bg));
    text-align: center;
    clip-path: polygon(0 0, 89% 0, 100% 6%, 100% 100%, 0 100%);
  }

  .ur-card-back .ur-card-back-court {
    position: absolute;
    inset: 14% 12%;
    border: 1px solid
      color-mix(in srgb, var(--ur-reveal-rarity, var(--ur-line-strong)) 45%, transparent);
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
    border-inline: 1px solid
      color-mix(in srgb, var(--ur-reveal-rarity, var(--ur-line-strong)) 40%, transparent);
  }

  .ur-card-back .ur-card-back-court::after {
    inset: 37% 0;
    border-block: 1px solid
      color-mix(in srgb, var(--ur-reveal-rarity, var(--ur-line-strong)) 40%, transparent);
  }

  .ur-card-back strong,
  .ur-card-back-caption,
  .ur-card-clue {
    position: relative;
    z-index: 1;
  }

  .ur-card-back strong {
    color: var(--ur-reveal-rarity, var(--ur-paper));
    font-family: var(--font-display);
    font-size: clamp(2.5rem, 8vw, 4rem);
    font-weight: 800;
    line-height: 0.95;
  }

  .ur-card-back-caption,
  .ur-card-clue {
    margin-top: 1rem;
    color: var(--ur-muted);
    font-size: 0.9rem;
  }

  .ur-card-clue {
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: 1.55rem;
    font-weight: 700;
  }

  .ur-revealed-card {
    display: grid;
    min-height: clamp(24rem, 54svh, 34rem);
    place-items: center;
    margin-top: 0.75rem;
  }

  .ur-show-all {
    margin-top: 1rem;
  }

  .ur-pack-summary {
    padding-top: 1.25rem;
  }

  .ur-summary-heading {
    margin-bottom: 0.9rem;
  }

  .ur-summary-heading h3 {
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 800;
  }

  .ur-summary-heading p {
    margin-top: 0.15rem;
    color: var(--ur-muted);
    font-size: 0.78rem;
  }

  .ur-pack-summary-scoreline {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-block: 1px solid var(--ur-line);
  }

  .ur-pack-summary-scoreline div {
    display: flex;
    min-width: 0;
    flex-direction: column;
    justify-content: center;
    padding: 0.8rem 1rem;
    border-right: 1px solid var(--ur-line);
  }

  .ur-pack-summary-scoreline strong {
    overflow: hidden;
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: clamp(1.25rem, 3vw, 2rem);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ur-pack-summary-scoreline span {
    margin-top: 0.2rem;
    color: var(--ur-muted);
    font-size: 0.72rem;
  }

  .ur-targeting-receipt {
    margin-top: 0.8rem;
    color: var(--ur-accent);
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
    color: var(--ur-accent);
    font-size: 0.68rem;
    font-weight: 800;
  }

  .ur-take-cards {
    width: 100%;
    margin-top: 1.25rem;
    border-color: var(--ur-accent);
    background: var(--ur-accent);
    color: var(--ur-bg);
  }

  .ur-pack-fallback > p {
    margin-top: 0.4rem;
    color: var(--ur-muted);
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

    .ur-theater-context {
      font-size: 0.68rem;
    }

    .ur-reveal-stage {
      padding-inline: 0.65rem;
    }

    .ur-card-back,
    .ur-revealed-card {
      min-height: 24rem;
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
      border-color: var(--ur-line-strong);
      background-color: var(--ur-bg);
    }
    to {
      border-color: var(--ur-reveal-rarity, var(--ur-line-strong));
      background-color: var(--ur-surface);
    }
  }
</style>
