<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { HavocDraftCard } from '@hoop-rush/data-contracts';
  import HavocDraftCardView from '#lib/features/havoc/HavocDraftCard.svelte';
  import {
    HAVOC_REVEAL_FLIP_MS,
    HAVOC_REVEAL_SELECTION_MS,
    havocRevealBeginOffer,
    havocRevealDelayMs,
    havocRevealResolve,
    havocRevealSelect,
    type HavocRevealResolution,
    type HavocRevealState,
  } from './havoc-multiplayer-reveal.js';

  let {
    cards,
    offerId,
    revision = 0,
    active,
    busy,
    reducedMotion,
    lineupSide = 'local',
    onpick,
  }: {
    cards: readonly HavocDraftCard[];
    offerId: string | null;
    revision?: number;
    active: boolean;
    busy: boolean;
    reducedMotion: boolean;
    lineupSide?: string;
    onpick: (card: HavocDraftCard) => Promise<boolean>;
  } = $props();

  let reveal = $state<HavocRevealState>(havocRevealBeginOffer(null, []));
  let hintedCardId = $state<string | null>(null);
  let ghost: HTMLElement | null = null;
  let lastKey = '';
  let pickInFlight = $state(false);

  const interactive = $derived(active && !busy && cards.length > 0);
  const locked = $derived(busy || !active || reveal.pendingCardId !== null || pickInFlight);

  $effect(() => {
    const key = `${offerId ?? ''}:${String(revision)}`;
    if (key === lastKey) return;
    lastKey = key;
    reveal = havocRevealBeginOffer(
      offerId,
      cards.map((card) => card.cardId),
    );
    hintedCardId = null;
    cancelGhost();
  });

  onDestroy(() => {
    cancelGhost();
  });

  function cancelGhost(): void {
    if (ghost !== null) {
      ghost.remove();
      ghost = null;
    }
  }

  function cardElement(cardId: string): HTMLElement | null {
    const article = document.querySelector<HTMLElement>(`[data-havoc-card="${cardId}"]`);
    return article?.closest('.hm-offer-card') ?? article;
  }

  async function pickCard(card: HavocDraftCard): Promise<void> {
    if (!interactive || pickInFlight) return;
    const next = havocRevealSelect(reveal, card.cardId);
    if (next === null) return;
    reveal = next;
    hintedCardId = null;
    const element = cardElement(card.cardId);
    const sourceRect = element?.getBoundingClientRect() ?? null;
    pickInFlight = true;
    let accepted = false;
    let resolved: HavocRevealResolution = { state: reveal, acceptedCardId: null };
    try {
      accepted = await onpick(card);
    } finally {
      pickInFlight = false;
      resolved = havocRevealResolve(reveal, accepted);
      reveal = resolved.state;
    }
    if (
      resolved.acceptedCardId === null ||
      reducedMotion ||
      element === null ||
      sourceRect === null
    ) {
      return;
    }
    await tick();
    playSelectionMove(element, sourceRect, card.slot);
  }

  function playSelectionMove(element: HTMLElement, sourceRect: DOMRect, slot: string): void {
    if (ghost !== null) return;
    const target = document.querySelector<HTMLElement>(
      `[data-havoc-lineup-side="${lineupSide}"][data-havoc-lineup-slot="${slot}"]`,
    );
    if (target === null) return;
    const targetRect = target.getBoundingClientRect();
    if (targetRect.width === 0 && targetRect.height === 0) return;
    const clone = element.cloneNode(true) as HTMLElement;
    clone.classList.remove('revealing', 'pending');
    clone.classList.add('hm-selection-ghost');
    clone.style.position = 'fixed';
    clone.style.left = `${String(sourceRect.left)}px`;
    clone.style.top = `${String(sourceRect.top)}px`;
    clone.style.width = `${String(sourceRect.width)}px`;
    clone.style.height = `${String(sourceRect.height)}px`;
    clone.style.margin = '0';
    clone.style.pointerEvents = 'none';
    clone.style.zIndex = '60';
    document.body.appendChild(clone);
    const dx = targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
    const dy = targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2);
    const scale = Math.max(0.25, Math.min(0.6, targetRect.height / Math.max(1, sourceRect.height)));
    const animation = clone.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
        {
          transform: `translate(${String(dx)}px, ${String(dy)}px) scale(${String(scale)})`,
          opacity: 0.15,
          offset: 1,
        },
      ],
      { duration: HAVOC_REVEAL_SELECTION_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
    ghost = clone;
    animation.onfinish = () => {
      if (ghost === clone) {
        clone.remove();
        ghost = null;
      }
    };
    animation.oncancel = () => {
      if (ghost === clone) {
        clone.remove();
        ghost = null;
      }
    };
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!interactive) return;
    if (event.key === '1' || event.key === '2' || event.key === '3') {
      const card = cards[Number(event.key) - 1];
      if (card === undefined) return;
      hintedCardId = card.cardId;
      event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      hintedCardId = null;
      return;
    }
    if (event.key === 'Enter' && hintedCardId !== null) {
      const card = cards.find((candidate) => candidate.cardId === hintedCardId);
      if (card === undefined) return;
      event.preventDefault();
      void pickCard(card);
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#key offerId ?? 'none'}
  <ul class="h-cards hm-offer" aria-label="Draft offer">
    {#each cards as card, index (card.cardId)}
      <li
        class="hm-offer-card"
        class:revealing={!reducedMotion}
        class:pending={reveal.pendingCardId === card.cardId}
        data-selected={card.cardId === hintedCardId}
        style:--reveal-delay={`${String(havocRevealDelayMs(index, reducedMotion))}ms`}
        style:--reveal-flip={`${String(HAVOC_REVEAL_FLIP_MS)}ms`}
      >
        <span class="hm-offer-key" aria-hidden="true">{index + 1}</span>
        <HavocDraftCardView
          {card}
          mode="effective"
          busy={locked}
          onPick={(cardId) => {
            const selected = cards.find((candidate) => candidate.cardId === cardId);
            if (selected !== undefined) void pickCard(selected);
          }}
        />
      </li>
    {/each}
  </ul>
{/key}

<style>
  .hm-offer {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .hm-offer-card {
    position: relative;
    display: flex;
    min-width: 0;
    perspective: 900px;
  }
  .hm-offer-card.revealing :global(.h-card) {
    animation: hm-card-flip var(--reveal-flip, 300ms) both;
    animation-delay: var(--reveal-delay, 0ms);
  }
  .hm-offer-card.pending :global(.h-card) {
    opacity: 0.7;
  }
  .hm-offer-card[data-selected='true'] {
    border-radius: 24px;
    outline: 3px solid #f290c5;
    outline-offset: 4px;
  }
  .hm-offer-key {
    position: absolute;
    z-index: 2;
    top: -12px;
    left: 50%;
    transform: translateX(-50%);
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 999px;
    background: #ffd782;
    color: #141b39;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 800;
  }
  @keyframes hm-card-flip {
    from {
      transform: rotateY(90deg);
      opacity: 0;
    }
    to {
      transform: rotateY(0deg);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hm-offer-card.revealing :global(.h-card) {
      animation: none;
    }
  }
</style>
