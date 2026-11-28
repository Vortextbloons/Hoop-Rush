<script lang="ts">
  import type { FullCourtArt } from './full-court-art.ts';
  import type { FullCourtTeamMinutesRow } from './full-court-coaching-presenter.ts';
  import FullCourtPortrait from './FullCourtPortrait.svelte';

  let {
    rows,
    art = null,
  }: {
    rows: readonly FullCourtTeamMinutesRow[];
    art?: FullCourtArt | null;
  } = $props();

  const ordered = $derived(
    [...rows]
      .filter((row) => row.minutes > 0)
      .sort(
        (left, right) =>
          right.minutes - left.minutes ||
          (left.player.displayName < right.player.displayName ? -1 : 1),
      ),
  );
</script>

{#if ordered.length === 0}
  <p class="ladder-empty">Assign minutes to see the rotation shape.</p>
{:else}
  <ul class="ladder" aria-label="Rotation minute distribution">
    {#each ordered as row (row.player.playerId)}
      <li
        class="ladder-row"
        data-starter={row.starterSlot !== null}
        data-closer={row.closer}
        aria-label={`${row.player.displayName}, ${row.minutes} minutes`}
      >
        <span class="ladder-id">
          <FullCourtPortrait player={row.player} {art} size="xs" />
          <span class="ladder-name">{row.player.displayName}</span>
        </span>
        <span class="ladder-track" aria-hidden="true">
          <span
            class="ladder-bar"
            style:width={`${String(Math.min(100, (row.minutes / 48) * 100))}%`}
          ></span>
        </span>
        <span class="ladder-min">{row.minutes}</span>
      </li>
    {/each}
  </ul>
  <p class="ladder-legend" aria-hidden="true">
    <span><i class="legend-starter"></i>Starter</span>
    <span><i class="legend-bench"></i>Bench</span>
    <span class="legend-scale">0–48 min</span>
  </p>
{/if}

<style>
  .ladder {
    display: grid;
    gap: 0.3rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .ladder-row {
    display: grid;
    min-width: 0;
    align-items: center;
    gap: 0.45rem;
    grid-template-columns: minmax(6.5rem, 9.5rem) minmax(0, 1fr) 1.6rem;
    padding: 0.2rem 0;
  }

  .ladder-id {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.35rem;
  }

  .ladder-name {
    overflow: hidden;
    color: var(--color-muted-foreground);
    font-size: 0.6875rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ladder-row[data-starter='true'] .ladder-name {
    color: var(--color-foreground);
  }

  .ladder-track {
    position: relative;
    display: block;
    height: 0.6rem;
    overflow: hidden;
    border-radius: 999px;
    background:
      repeating-linear-gradient(
        to right,
        transparent 0 calc(25% - 1px),
        color-mix(in srgb, var(--color-line-soft) 85%, transparent) calc(25% - 1px) 25%
      ),
      var(--color-surface-3);
  }

  .ladder-bar {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--color-line-strong);
    transition: width 120ms ease;
  }

  .ladder-row[data-starter='true'] .ladder-bar {
    background: linear-gradient(90deg, var(--color-primary), var(--color-accent));
  }

  .ladder-row[data-closer='true'] .ladder-bar {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 75%, transparent);
  }

  .ladder-min {
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .ladder-row[data-starter='true'] .ladder-min {
    color: var(--color-foreground);
  }

  .ladder-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    margin: 0.55rem 0 0;
    padding-top: 0.45rem;
    border-top: 1px solid var(--color-line-soft);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.5rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .ladder-legend span {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .ladder-legend i {
    display: block;
    width: 0.7rem;
    height: 0.35rem;
    border-radius: 999px;
    background: var(--color-line-strong);
  }

  .ladder-legend .legend-starter {
    background: linear-gradient(90deg, var(--color-primary), var(--color-accent));
  }

  .legend-scale {
    margin-left: auto;
  }

  .ladder-empty {
    margin: 0;
    color: var(--color-muted-foreground);
    font-size: 0.75rem;
    line-height: 1.5;
  }

  @media (prefers-reduced-motion: reduce) {
    .ladder-bar {
      transition: none;
    }
  }
</style>
