<script lang="ts">
  import type {
    DraftDuelCard,
    DraftDuelPresentation,
    DraftDuelUnavailableReason,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import { formatPositions } from '#lib/player-positions.js';
  import { DRAFT_DUEL_REASON_LABELS, draftDuelCardView } from './draft-duel-card-view.ts';

  let {
    card,
    presentation,
    manifest = null,
    disabled = false,
    reason = null,
    selected = false,
    considering = false,
    compact = false,
    onselect,
    onconsider,
  }: {
    card: DraftDuelCard;
    presentation: DraftDuelPresentation;
    manifest?: HoopRushManifest | null;
    disabled?: boolean;
    reason?: DraftDuelUnavailableReason | null;
    selected?: boolean;
    considering?: boolean;
    compact?: boolean;
    onselect?: (card: DraftDuelCard) => void;
    onconsider?: (card: DraftDuelCard | null) => void;
  } = $props();

  const view = $derived(draftDuelCardView(card, presentation));
  const reasonLabel = $derived(reason === null ? null : DRAFT_DUEL_REASON_LABELS[reason]);
  const franchiseLabel = $derived(franchiseAbbreviation(card.franchiseId));
  const positionsLabel = $derived(formatPositions(view.positions));
  const initials = $derived(
    view.displayName
      .split(' ')
      .filter((part) => part.length > 0)
      .map((part) => part[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase(),
  );
  const state = $derived(
    disabled ? 'disabled' : selected ? 'selected' : considering ? 'considering' : 'idle',
  );
  const ariaLabel = $derived.by(() => {
    const parts: string[] = [view.displayName, view.seasonKey, franchiseLabel, positionsLabel];
    if (!view.strengthHidden && view.overall !== null) {
      parts.push(`Overall ${String(view.overall)}`);
    }
    if (!view.strengthHidden && view.bandLabel !== null) {
      parts.push(`Band ${view.bandLabel}`);
    }
    if (disabled && reasonLabel !== null) {
      parts.push(reasonLabel);
    }
    return parts.join(', ');
  });

  let considerationSent = false;

  function considerOn(): void {
    if (disabled || considerationSent) return;
    considerationSent = true;
    onconsider?.(card);
  }

  function considerOff(): void {
    if (!considerationSent) return;
    considerationSent = false;
    onconsider?.(null);
  }

  function handleSelect(): void {
    if (disabled) return;
    onselect?.(card);
  }
</script>

<button
  type="button"
  class="dd-card"
  class:dd-card-compact={compact}
  class:dd-card-disabled={disabled}
  class:dd-card-selected={selected}
  class:dd-card-considering={considering}
  class:dd-card-elite={view.elite}
  data-state={state}
  data-card-id={card.cardId}
  data-elite={view.elite ? 'true' : undefined}
  aria-disabled={disabled}
  aria-pressed={selected}
  aria-label={ariaLabel}
  onclick={handleSelect}
  onpointerenter={considerOn}
  onpointerleave={considerOff}
  onpointerdown={considerOn}
  onfocus={considerOn}
  onblur={considerOff}
>
  <span class="dd-card-top">
    {#if manifest && card.playerExternalId}
      <PlayerFace
        player={{ playerId: card.playerId, playerExternalId: card.playerExternalId, altIds: null }}
        {manifest}
        size="sm"
        fallbackInitials={initials}
      />
    {:else}
      <span class="dd-card-face" aria-hidden="true">{initials}</span>
    {/if}
    <span class="dd-card-ident">
      <span class="dd-card-name">{view.displayName}</span>
      <span class="dd-card-season">{view.seasonKey}</span>
    </span>
    {#if !view.strengthHidden && view.overall !== null}
      <span class="dd-card-ovr" data-overall={view.overall}>
        <small>OVR</small>
        <strong>{view.overall}</strong>
      </span>
    {/if}
  </span>
  <span class="dd-card-meta">
    <span class="dd-card-positions">{positionsLabel}</span>
    {#if !compact}
      <span class="dd-card-franchise">{franchiseLabel} · {view.eraId}</span>
    {/if}
  </span>
  <span class="dd-card-foot">
    {#if !view.strengthHidden && view.bandLabel !== null}
      <span class="dd-card-band" data-band={view.bandLabel}>{view.bandLabel}</span>
    {/if}
    {#if disabled && reasonLabel !== null}
      <span class="dd-card-reason" data-reason={reason}>{reasonLabel}</span>
    {/if}
  </span>
</button>

<style>
  .dd-card {
    position: relative;
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: 8.75rem;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.7rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 12px;
    background: var(--color-card);
    color: var(--color-foreground);
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition:
      border-color 140ms ease,
      box-shadow 140ms ease,
      transform 140ms ease;
  }

  @media (hover: hover) {
    .dd-card:hover {
      transform: translateY(-2px);
      border-color: var(--color-line-strong);
    }

    .dd-card-disabled:hover {
      transform: none;
      border-color: var(--color-line-soft);
    }
  }

  .dd-card:active:not(.dd-card-disabled) {
    transform: scale(0.98);
  }

  .dd-card:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--color-ring);
  }

  .dd-card-selected {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 55%, transparent);
  }

  .dd-card-considering {
    border-style: dashed;
    border-color: var(--color-primary);
  }

  .dd-card-disabled {
    cursor: not-allowed;
    opacity: 0.62;
    filter: grayscale(0.4);
  }

  .dd-card-elite {
    border-color: var(--color-primary);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--color-primary) 40%, transparent),
      0 0 18px color-mix(in srgb, var(--color-primary) 18%, transparent);
  }

  .dd-card-elite::before {
    content: '';
    position: absolute;
    top: 0;
    left: 12%;
    right: 12%;
    height: 2px;
    border-radius: 999px;
    background: linear-gradient(90deg, transparent, var(--color-primary), transparent);
  }

  .dd-card-elite.dd-card-selected {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--color-primary) 55%, transparent),
      0 0 18px color-mix(in srgb, var(--color-primary) 24%, transparent);
  }

  .dd-card-top {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    min-width: 0;
  }

  .dd-card-face {
    display: grid;
    width: 2.5rem;
    height: 2.5rem;
    flex: none;
    place-items: center;
    border-radius: 9px;
    background: var(--color-surface-3);
    color: var(--color-muted-foreground);
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 800;
  }

  .dd-card-ident {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 0.15rem;
  }

  .dd-card-name {
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 800;
    line-height: 1.05;
    overflow-wrap: anywhere;
  }

  .dd-card-season {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
  }

  .dd-card-ovr {
    display: grid;
    flex: none;
    justify-items: center;
    padding: 0.15rem 0.35rem 0.2rem;
    border: 1px solid color-mix(in srgb, var(--color-primary) 60%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-surface-2) 80%, transparent);
    color: var(--color-primary);
    line-height: 0.95;
  }

  .dd-card-ovr small {
    font-family: var(--font-mono);
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 0.12em;
  }

  .dd-card-ovr strong {
    font-family: var(--font-display);
    font-size: 1.45rem;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
  }

  .dd-card-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    color: var(--color-muted-foreground);
  }

  .dd-card-positions {
    letter-spacing: 0.06em;
  }

  .dd-card-franchise {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dd-card-foot {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: auto;
    min-height: 1.15rem;
  }

  .dd-card-band {
    display: inline-flex;
    align-items: center;
    padding: 0.12rem 0.45rem;
    border: 1px solid color-mix(in srgb, var(--color-primary) 55%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-primary);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.1em;
  }

  .dd-card-reason {
    display: inline-flex;
    align-items: center;
    padding: 0.12rem 0.45rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .dd-card-compact {
    min-height: 0;
    gap: 0.45rem;
    padding: 0.5rem;
  }

  .dd-card-compact .dd-card-name {
    font-size: 0.95rem;
  }

  .dd-card-compact .dd-card-face {
    width: 2rem;
    height: 2rem;
    font-size: 0.85rem;
  }

  @media (max-width: 640px) {
    .dd-card {
      min-height: 7.25rem;
      gap: 0.5rem;
      padding: 0.6rem;
      border-radius: 11px;
    }
    .dd-card-top {
      gap: 0.45rem;
    }
    .dd-card-face {
      width: 2.1rem;
      height: 2.1rem;
      border-radius: 8px;
      font-size: 0.88rem;
    }
    .dd-card-name {
      font-size: 0.92rem;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      overflow: hidden;
    }
    .dd-card-season {
      font-size: 9px;
    }
    .dd-card-ovr {
      padding: 0.12rem 0.3rem 0.16rem;
      border-radius: 7px;
    }
    .dd-card-ovr strong {
      font-size: 1.18rem;
    }
    .dd-card-meta {
      font-size: 9px;
      gap: 0.35rem;
    }
    .dd-card-foot {
      min-height: 1rem;
      gap: 0.3rem;
      flex-wrap: wrap;
    }
  }

  @media (max-width: 380px) {
    .dd-card {
      min-height: 6.9rem;
      padding: 0.55rem;
    }
    .dd-card-name {
      font-size: 0.86rem;
    }
    .dd-card-ovr strong {
      font-size: 1.08rem;
    }
    .dd-card-meta {
      font-size: 8px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dd-card,
    .dd-card:active:not(.dd-card-disabled) {
      transition: none;
      transform: none;
    }
  }
</style>
