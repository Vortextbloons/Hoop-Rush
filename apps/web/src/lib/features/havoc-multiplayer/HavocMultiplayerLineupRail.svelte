<script lang="ts">
  import type { HavocMultiplayerDraftPick } from '@hoop-rush/data-contracts';
  import HavocPlayerArt from '$lib/features/havoc/HavocPlayerArt.svelte';
  import HavocTierBadge from '$lib/features/havoc/HavocTierBadge.svelte';
  import { mutationEntriesSummary } from '$lib/features/havoc/havoc-presentation';
  import { havocMultiplayerLineupSlots } from './havoc-multiplayer-room-view';

  let {
    picks,
    title,
    eyebrow,
    active = false,
    collapsible = false,
    emptyLabel = 'No picks yet.',
  }: {
    picks: readonly HavocMultiplayerDraftPick[];
    title: string;
    eyebrow: string;
    active?: boolean;
    collapsible?: boolean;
    emptyLabel?: string;
  } = $props();

  const slots = $derived(havocMultiplayerLineupSlots(picks));
</script>

{#snippet body()}
  {#if slots.length === 0}
    <p class="h-copy hm-rail-empty">{emptyLabel}</p>
  {:else}
    <ul class="hm-rail-list">
      {#each slots as slot (slot.slot)}
        <li data-havoc-lineup-slot={slot.slot}>
          <HavocPlayerArt
            playerId={slot.playerId}
            playerVersionId={slot.playerVersionId}
            displayName={slot.displayName}
            franchiseId={slot.franchiseId}
            seasonKey={slot.seasonKey}
          />
          <div class="hm-rail-body">
            <span class="hm-rail-slot">{slot.slot}</span>
            <span class="hm-rail-name">{slot.displayName}</span>
            <span class="hm-rail-mutations">{mutationEntriesSummary(slot.mutations)}</span>
          </div>
          <HavocTierBadge tier={slot.tier} size="sm" />
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

{#if collapsible}
  <details class="hm-rail h-panel" data-active={active}>
    <summary>
      <span class="h-eyebrow">{eyebrow}</span>
      <span class="hm-rail-title">{title}</span>
      <span class="hm-rail-count">{picks.length}/5</span>
    </summary>
    {@render body()}
  </details>
{:else}
  <section class="hm-rail h-panel" data-active={active} aria-label={title}>
    <header class="hm-rail-head">
      <p class="h-eyebrow">{eyebrow}</p>
      <div class="hm-rail-title-row">
        <h2 class="h-subtitle">{title}</h2>
        <span class="hm-rail-count">{picks.length}/5</span>
      </div>
    </header>
    {@render body()}
  </section>
{/if}

<style>
  .hm-rail {
    padding: 16px;
  }
  .hm-rail[data-active='true'] {
    border-color: #ffd782;
    box-shadow: 0 0 0 1px #ffd782 inset;
  }
  .hm-rail-head {
    display: grid;
    gap: 4px;
  }
  .hm-rail-title-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .hm-rail-title-row .h-subtitle {
    font-size: 1.25rem;
  }
  .hm-rail-count {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: #aab9db;
  }
  summary {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 8px;
    padding: 0;
  }
  .hm-rail-title {
    font-family: var(--font-display);
    font-size: 1.1rem;
    font-weight: 800;
    text-transform: uppercase;
  }
  .hm-rail-list {
    display: grid;
    gap: 8px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
  }
  .hm-rail-list li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border: 1px solid #3c486b;
    border-radius: 12px;
    background: #141b39;
  }
  .hm-rail-list :global(.h-player-art) {
    width: 44px;
    height: 44px;
  }
  .hm-rail-body {
    display: grid;
    min-width: 0;
    gap: 1px;
  }
  .hm-rail-slot {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: #aab9db;
  }
  .hm-rail-name {
    overflow: hidden;
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 800;
    line-height: 1.1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hm-rail-mutations {
    overflow: hidden;
    font-size: 10px;
    line-height: 1.3;
    color: #c1cae4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hm-rail-empty {
    margin-top: 10px;
    font-size: 12px;
  }
</style>
