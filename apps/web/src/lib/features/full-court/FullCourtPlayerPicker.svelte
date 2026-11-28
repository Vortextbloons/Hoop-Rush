<script lang="ts">
  import type { SimulationPlayer } from '@hoop-rush/data-contracts';
  import { X } from '@lucide/svelte';
  import { formatPositions } from '#lib/player-positions.js';
  import type { FullCourtArt } from './full-court-art.ts';
  import FullCourtPortrait from './FullCourtPortrait.svelte';

  let {
    players,
    label,
    art = null,
    selectedId = null,
    excludedIds = [],
    locked = false,
    onSelect,
    onClose = null,
  }: {
    players: readonly SimulationPlayer[];
    label: string;
    art?: FullCourtArt | null;
    selectedId?: string | null;
    excludedIds?: readonly string[];
    locked?: boolean;
    onSelect: (playerId: string) => void;
    onClose?: (() => void) | null;
  } = $props();
</script>

<section class="player-picker" aria-label={label}>
  <div class="picker-head">
    <p class="ui-label">{label}</p>
    {#if onClose !== null}
      <button
        type="button"
        class="picker-close"
        aria-label="Close player picker"
        disabled={locked}
        onclick={onClose}
      >
        <X size={14} aria-hidden="true" />
      </button>
    {/if}
  </div>
  <ul class="picker-grid">
    {#each players as player (player.playerId)}
      {@const excluded = excludedIds.includes(player.playerId)}
      <li>
        <button
          type="button"
          class="picker-card"
          data-selected={selectedId === player.playerId}
          disabled={locked || excluded}
          aria-pressed={selectedId === player.playerId}
          onclick={() => onSelect(player.playerId)}
        >
          <FullCourtPortrait {player} {art} size="sm" />
          <span class="picker-copy">
            <span class="picker-name">{player.displayName}</span>
            <span class="picker-meta">
              {formatPositions(player.positions)}
              {#if player.overall !== undefined}
                · {player.overall} OVR
              {/if}
            </span>
          </span>
        </button>
      </li>
    {/each}
  </ul>
</section>

<style>
  .player-picker {
    margin-top: 0.75rem;
    padding: 0.75rem;
    border: 1px solid color-mix(in srgb, var(--color-primary) 30%, var(--color-line-soft));
    border-radius: 0.75rem;
    background: var(--color-surface-1);
  }

  .picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .picker-close {
    display: grid;
    width: 1.75rem;
    height: 1.75rem;
    flex: none;
    place-items: center;
    border: 1px solid var(--color-line-soft);
    border-radius: 999px;
    color: var(--color-muted-foreground);
    cursor: pointer;
  }

  .picker-close:hover {
    color: var(--color-foreground);
  }

  .picker-grid {
    display: grid;
    margin: 0.6rem 0 0;
    padding: 0;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 11rem), 1fr));
    gap: 0.4rem;
    list-style: none;
  }

  .picker-card {
    display: flex;
    width: 100%;
    min-height: 2.75rem;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.45rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 0.6rem;
    background: var(--color-surface-2);
    text-align: left;
    cursor: pointer;
  }

  .picker-card:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-line-soft));
  }

  .picker-card[data-selected='true'] {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface-2));
  }

  .picker-card:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .picker-copy {
    display: grid;
    min-width: 0;
    gap: 0.1rem;
  }

  .picker-name {
    overflow: hidden;
    color: var(--color-foreground);
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .picker-meta {
    overflow: hidden;
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }
</style>
