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
    'idle' | 'opening' | 'entering' | 'beats' | 'clues' | 'revealed' | 'advancing' | 'complete';

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
  let nextButton = $state<HTMLButtonElement | undefined>(undefined);
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
  const revealColor = $derived(
    stage === 'clues' || stage === 'revealed'
      ? `var(--ur-${activePlan?.rarity.toLowerCase() ?? 'apex'})`
      : '#c7d5e3',
  );
  const charge = $derived(
    stage === 'clues' || stage === 'revealed'
      ? 100
      : stage === 'beats'
        ? ((beatIndex + 1) / (activePlan?.beats.length ?? 1)) * 100
        : 0,
  );

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
    if (stage === 'idle' || stage === 'complete' || stage === 'revealed') return;
    const delay =
      stage === 'opening' ? 1250 : stage === 'clues' ? 700 : stage === 'advancing' ? 240 : 380;
    timer = setTimeout(() => {
      timer = null;
      if (token !== presentationToken) return;
      advance(token);
    }, delay);
  }

  function advance(token: number): void {
    if (stage === 'opening') {
      stage = 'entering';
    } else if (stage === 'entering') {
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
    if (stage === 'revealed') {
      announcement = `${activeCard?.card?.displayName ?? activeCard?.slot.cardId}. ${activePlan?.rarity}. ${activeCard?.slot.kept ? 'New card.' : `Duplicate. ${activeCard?.slot.conversionAmount} Exchange.`}`;
      void tick().then(() => {
        if (token === presentationToken && stage === 'revealed') nextButton?.focus();
      });
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
    stage = 'opening';
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
          <p class="ur-theater-label">Hoop Rush · Pack drop</p>
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
        Watch each card reveal, then choose Next card. Skip shows all your cards immediately.
      </p>
      <p class="sr-only" role="status" aria-live="polite">{announcement}</p>

      {#if stage === 'complete'}
        <section class="ur-pack-summary" aria-label="Committed pack results">
          <div class="ur-summary-heading">
            <h3>Your haul</h3>
            <p>{packLabel} · All {cards.length} cards revealed</p>
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
          data-rarity={stage === 'clues' || stage === 'revealed' ? activePlan.rarity : 'sealed'}
          style:--drop-color={revealColor}
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
          <div class="ur-arena-lights" aria-hidden="true"></div>
          <div class="ur-court-floor" aria-hidden="true"></div>
          {#if stage === 'opening'}
            <div class="ur-pack-rip" aria-hidden="true">
              <div class="ur-pack-wrapper">
                <span class="ur-pack-brand">HOOP<br />RUSH</span>
                <span class="ur-pack-name">{packLabel}</span>
                <span class="ur-pack-tear">OPEN THE GAME</span>
              </div>
              <div class="ur-pack-lid"></div>
              <span class="ur-pack-rip-light"></span>
            </div>
            <p class="ur-drop-caption">Breaking the seal</p>
          {:else if stage === 'revealed'}
            <div class="ur-impact" aria-hidden="true">
              <span class="ur-impact-ring"></span>
              {#each Array.from({ length: 18 }, (_, index) => index) as spark (spark)}
                <i
                  style:--angle={`${spark * 20}deg`}
                  style:--distance={`${150 + (spark % 4) * 35}px`}
                  style:--delay={`${(spark % 3) * 40}ms`}
                ></i>
              {/each}
            </div>
            <p class="ur-rarity-callout">{activePlan.rarity}</p>
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
            <button
              bind:this={nextButton}
              type="button"
              class="ur-next-card"
              onclick={() => advance(presentationToken)}
            >
              {activeCardIndex + 1 < cards.length ? 'Next card' : 'See your haul'}
              <span aria-hidden="true">→</span>
            </button>
          {:else}
            {#key `${activeCardIndex}-${stage}-${beatIndex}-${clueIndex}`}
              <div class="ur-card-back ur-seal--sealed" data-stage={stage}>
                <span class="ur-card-back-court" aria-hidden="true"></span>
                <span class="ur-card-back-brand" aria-hidden="true">HR</span>
                <strong>
                  {#if stage === 'entering'}
                    Game on
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
                    >{stage === 'entering' ? packLabel : 'Here comes your next player'}</span
                  >
                {/if}
              </div>
            {/key}
            <div class="ur-charge-track" aria-hidden="true">
              <span style:width={`${charge}%`}></span>
            </div>
          {/if}
          <ol class="ur-pack-progress" aria-label="Pack reveal progress">
            {#each cards as item, index (item.slot.slotIndex)}
              <li
                class:ur-progress-done={index < activeCardIndex ||
                  (index === activeCardIndex && stage === 'revealed')}
                class:ur-progress-active={index === activeCardIndex}
                aria-current={index === activeCardIndex ? 'step' : undefined}
              >
                <span class="sr-only"
                  >Card {index + 1}{index < activeCardIndex ? ', revealed' : ''}</span
                >
              </li>
            {/each}
          </ol>
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
    margin: auto;
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
    --ur-pack-card-height: clamp(21rem, 48svh, 30rem);
    --ur-pack-face-height: clamp(11rem, 25svh, 16rem);
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

  .ur-reveal-stage {
    min-height: 39rem;
    perspective: 1100px;
    border-color: color-mix(in srgb, var(--drop-color) 28%, transparent);
    background:
      radial-gradient(
        ellipse at 50% 45%,
        color-mix(in srgb, var(--drop-color) 16%, transparent),
        transparent 65%
      ),
      #080d14;
  }

  .ur-arena-lights {
    position: absolute;
    z-index: -1;
    inset: -30% -15%;
    background:
      conic-gradient(
        from 175deg at 25% 0%,
        transparent 0deg,
        color-mix(in srgb, var(--drop-color) 15%, transparent) 12deg,
        transparent 24deg
      ),
      conic-gradient(
        from 160deg at 75% 0%,
        transparent 0deg,
        color-mix(in srgb, var(--drop-color) 15%, transparent) 12deg,
        transparent 24deg
      );
    transform-origin: top center;
    animation: arena-sweep 7s ease-in-out infinite alternate;
  }

  .ur-court-floor {
    position: absolute;
    z-index: -1;
    inset: 64% -35% -60%;
    border: 2px solid color-mix(in srgb, var(--drop-color) 30%, transparent);
    border-radius: 50%;
    background:
      repeating-linear-gradient(90deg, transparent 0 79px, #ffffff0c 80px 81px),
      repeating-linear-gradient(0deg, transparent 0 79px, #ffffff0c 80px 81px);
    transform: rotateX(65deg);
  }

  .ur-pack-rip {
    position: relative;
    width: min(70vw, 18rem);
    height: 27rem;
    margin-top: 2rem;
    perspective: 900px;
  }

  .ur-pack-wrapper {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 2rem;
    border: 2px solid #ffe19b;
    background:
      repeating-linear-gradient(135deg, transparent 0 22px, #ffffff0b 23px 24px),
      linear-gradient(145deg, #46505c, #101720 45%, #67501e);
    box-shadow:
      0 0 60px #ffc53d26,
      inset 0 0 0 7px #ffffff12;
    clip-path: polygon(
      0 0,
      100% 0,
      100% 100%,
      95% 98%,
      90% 100%,
      85% 98%,
      80% 100%,
      75% 98%,
      70% 100%,
      65% 98%,
      60% 100%,
      55% 98%,
      50% 100%,
      45% 98%,
      40% 100%,
      35% 98%,
      30% 100%,
      25% 98%,
      20% 100%,
      15% 98%,
      10% 100%,
      5% 98%,
      0 100%
    );
    animation: wrapper-rip 1250ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }

  .ur-pack-brand {
    font-family: var(--font-display);
    font-weight: 900;
    font-style: italic;
    font-size: 4.8rem;
    line-height: 0.85;
    letter-spacing: -0.05em;
    color: #fff3d6;
    text-shadow: 4px 4px 0 #8e6414;
  }

  .ur-pack-name {
    margin-top: 1.5rem;
    color: #ffe19b;
    font-weight: 800;
  }
  .ur-pack-tear {
    margin-top: 2.5rem;
    font-size: 0.65rem;
    letter-spacing: 0.2em;
    color: #d5dde6;
  }
  .ur-pack-lid {
    position: absolute;
    inset: -1rem 0 auto;
    height: 2.5rem;
    border: 2px solid #ffe19b;
    background: repeating-linear-gradient(90deg, #ac812c 0 3px, #ebd28c 4px 5px);
    animation: lid-rip 1250ms ease-in both;
  }

  .ur-pack-rip-light {
    position: absolute;
    inset: 5% -40%;
    background: radial-gradient(ellipse, #fff3d6 0, #ffc53d88 18%, transparent 65%);
    pointer-events: none;
    animation: seal-light 1250ms ease-out both;
  }

  .ur-drop-caption {
    color: var(--ur-paper);
    font-size: 0.75rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .ur-card-back {
    min-height: 29rem;
    width: min(100%, 21rem);
    border-color: var(--drop-color);
    color: var(--drop-color);
    background:
      repeating-linear-gradient(135deg, transparent 0 20px, #ffffff06 21px 22px),
      linear-gradient(150deg, #273340, #0b111a 65%);
    box-shadow: inset 0 0 0 6px #ffffff08;
  }
  .ur-card-back-brand {
    position: absolute;
    top: 2rem;
    font-family: var(--font-display);
    font-style: italic;
    font-size: 5rem;
    font-weight: 900;
    color: #ffffff12;
  }
  .ur-card-back strong {
    color: var(--drop-color);
    font-size: clamp(2rem, 7vw, 3rem);
  }
  .ur-card-back-court {
    transform: rotate(-25deg);
  }
  .ur-card-back[data-stage='entering'] {
    animation: card-deal 380ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .ur-card-back[data-stage='beats'] {
    animation: card-charge 380ms ease-out both;
  }
  .ur-card-back[data-stage='clues'] {
    animation: clue-lock 700ms ease-out both;
  }
  .ur-card-back[data-stage='advancing'] {
    animation: card-away 240ms ease-in both;
  }
  .ur-charge-track {
    width: min(100%, 21rem);
    height: 3px;
    margin-top: 1rem;
    background: #ffffff1c;
  }
  .ur-charge-track span {
    display: block;
    height: 100%;
    background: var(--drop-color);
    box-shadow: 0 0 12px var(--drop-color);
    transition: width 300ms ease-out;
  }
  .ur-rarity-callout {
    position: absolute;
    top: 3.5rem;
    z-index: 2;
    color: var(--drop-color);
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(2.1rem, 6vw, 3.2rem);
    font-style: italic;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    animation: rarity-hit 650ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .ur-revealed-card {
    position: relative;
    z-index: 1;
    margin-top: 4.5rem;
    min-height: 0;
    width: min(100%, 21rem);
    filter: drop-shadow(0 12px 35px color-mix(in srgb, var(--drop-color) 28%, transparent));
    animation: reveal-slam 720ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .ur-impact {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .ur-impact-ring {
    position: absolute;
    left: calc(50% - 10rem);
    top: 12rem;
    width: 20rem;
    height: 20rem;
    border: 2px solid var(--drop-color);
    border-radius: 50%;
    animation: impact-ring 950ms ease-out both;
  }
  .ur-impact i {
    position: absolute;
    left: 50%;
    top: 45%;
    width: 4px;
    height: 24px;
    background: var(--drop-color);
    transform: rotate(var(--angle));
    animation: spark-launch 900ms var(--delay) ease-out both;
  }
  .ur-reveal-stage[data-rarity='Ember'] .ur-impact {
    opacity: 0.35;
  }
  .ur-reveal-stage[data-rarity='Eclipse'],
  .ur-reveal-stage[data-rarity='Immortal'] {
    background:
      radial-gradient(
        ellipse at 50% 42%,
        color-mix(in srgb, var(--drop-color) 28%, transparent),
        transparent 70%
      ),
      #060910;
  }
  .ur-reveal-stage[data-rarity='Immortal'] .ur-rarity-callout {
    letter-spacing: 0.2em;
  }
  .ur-next-card {
    position: relative;
    z-index: 2;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 3rem;
    min-height: 3rem;
    margin-top: 1.2rem;
    padding: 0.75rem 1.5rem;
    border: 1px solid #ffe19b;
    border-bottom: 4px solid #a76f10;
    border-radius: 0.3rem;
    background: linear-gradient(#ffe19b, #ffc53d);
    color: #241804;
    font-weight: 900;
    cursor: pointer;
  }
  .ur-next-card:hover {
    filter: brightness(1.08);
  }
  .ur-pack-progress {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 1rem;
    padding: 0;
    list-style: none;
  }
  .ur-pack-progress li {
    width: 1.6rem;
    height: 0.3rem;
    background: #ffffff24;
    border-radius: 2px;
  }
  .ur-pack-progress .ur-progress-done {
    background: var(--ur-apex);
  }
  .ur-pack-progress .ur-progress-active {
    outline: 1px solid var(--ur-paper);
    outline-offset: 3px;
  }
  .ur-show-all {
    min-height: 2.75rem;
    margin-top: 0.8rem;
    border: 0;
    background: transparent;
    color: var(--ur-muted);
    font-size: 0.75rem;
  }
  .ur-pack-summary {
    animation: haul-enter 400ms ease-out both;
  }
  .ur-summary-heading h3 {
    font-size: 2rem;
    font-style: italic;
  }

  @keyframes arena-sweep {
    to {
      transform: rotate(8deg) scale(1.05);
    }
  }
  @keyframes wrapper-rip {
    0% {
      opacity: 0;
      transform: translateY(50px) rotateY(-25deg) rotate(-8deg) scale(0.8);
    }
    25%,
    50% {
      opacity: 1;
      transform: none;
    }
    70% {
      transform: translateY(10px) scale(1.03);
      opacity: 1;
    }
    100% {
      transform: translateY(160px) rotate(12deg) scale(1.2);
      opacity: 0;
    }
  }
  @keyframes lid-rip {
    0%,
    50% {
      transform: none;
      opacity: 1;
    }
    100% {
      transform: translate(100px, -180px) rotate(45deg);
      opacity: 0;
    }
  }
  @keyframes seal-light {
    0%,
    50% {
      transform: scale(0.1);
      opacity: 0;
    }
    70% {
      opacity: 0.8;
    }
    100% {
      transform: scale(1.5);
      opacity: 0;
    }
  }
  @keyframes card-deal {
    from {
      transform: translateY(70px) rotateY(-35deg) rotate(-8deg) scale(0.85);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @keyframes card-charge {
    0% {
      transform: scale(0.97) rotate(-1deg);
    }
    45% {
      transform: scale(1.025) rotate(1deg);
    }
    100% {
      transform: none;
    }
  }
  @keyframes clue-lock {
    from {
      transform: rotateY(14deg) scale(0.95);
      opacity: 0.5;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @keyframes card-away {
    to {
      transform: translateX(-150px) rotate(-12deg) scale(0.7);
      opacity: 0;
    }
  }
  @keyframes reveal-slam {
    from {
      transform: rotateY(85deg) translateY(30px) scale(0.65);
      opacity: 0;
    }
    65% {
      transform: rotateY(-6deg) translateY(-8px) scale(1.04);
      opacity: 1;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @keyframes rarity-hit {
    from {
      transform: scale(1.8) translateY(-15px);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @keyframes impact-ring {
    from {
      transform: scale(0.4);
      opacity: 0.7;
    }
    to {
      transform: scale(2.5);
      opacity: 0;
    }
  }
  @keyframes spark-launch {
    from {
      transform: rotate(var(--angle)) translateY(-60px) scaleY(1);
      opacity: 0;
    }
    20% {
      opacity: 0.8;
    }
    to {
      transform: rotate(var(--angle)) translateY(calc(-1 * var(--distance))) scaleY(0.2);
      opacity: 0;
    }
  }
  @keyframes haul-enter {
    from {
      transform: translateY(15px);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }

  @media (max-width: 520px) {
    .ur-reveal-stage {
      min-height: 36rem;
    }
    .ur-pack-rip {
      height: 24rem;
    }
    .ur-pack-brand {
      font-size: 4rem;
    }
    .ur-card-back {
      min-height: 27rem;
    }
    .ur-revealed-card {
      width: min(100%, 19rem);
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
</style>
