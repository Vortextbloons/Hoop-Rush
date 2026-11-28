<script module lang="ts">
  export interface BroadcastFeedRow {
    key: string | number;
    period: number;
    clockSeconds: number;
    side: 'local' | 'opponent' | null;
    team: string;
    tag?: string;
    summary: string;
    points: number;
  }
</script>

<script lang="ts">
  import './gamecast-broadcast.css';
  import { formatClock } from '#lib/format.js';
  import { gamecastPeriodLabel } from './gamecast-broadcast-view';

  let {
    rows,
    countLabel,
    title = 'Live feed',
    label = 'Play-by-play feed',
    emptyMessage = 'Waiting for the first possession.',
    showTags = true,
    periodLabel = gamecastPeriodLabel,
    clockLabel = (seconds: number) => formatClock(Math.max(0, Math.floor(seconds))),
  }: {
    rows: readonly BroadcastFeedRow[];
    countLabel: string;
    title?: string;
    label?: string;
    emptyMessage?: string;
    showTags?: boolean;
    periodLabel?: (period: number) => string;
    clockLabel?: (seconds: number) => string;
  } = $props();
</script>

<section class="bc-feed" aria-label={label}>
  <header class="bc-feed-head">
    <h3>{title}</h3>
    <span class="bc-feed-count">{countLabel}</span>
  </header>
  {#if rows.length > 0}
    <ul class="bc-feed-list" aria-live="polite">
      {#each rows as line, index (line.key)}
        <li
          class="bc-feed-line"
          class:latest={index === 0}
          data-offense={line.side}
          data-tags={showTags}
        >
          <span class="bc-feed-clock">
            {periodLabel(line.period)}
            {clockLabel(line.clockSeconds)}
          </span>
          <span class="bc-feed-team" data-side={line.side}>{line.team}</span>
          {#if showTags}
            <span class="bc-feed-tag" data-points={line.points > 0 ? 'yes' : 'no'}>{line.tag}</span>
          {/if}
          <span class="bc-feed-summary">{line.summary}</span>
          {#if line.points !== 0}
            <span class="bc-feed-pts" class:text-negative={line.points < 0}
              >{line.points > 0 ? '+' : ''}{line.points}</span
            >
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="bc-feed-empty">{emptyMessage}</p>
  {/if}
</section>

<style>
  .bc-feed {
    --dd-opp: var(--broadcast-opponent, hsl(212 90% 62%));
  }
  .bc-feed-line[data-tags='false'] {
    grid-template-columns: auto auto minmax(0, 1fr) auto;
  }
  .bc-feed-summary {
    white-space: normal;
    overflow-wrap: anywhere;
  }
  @media (max-width: 479px) {
    .bc-feed-line[data-tags='true'] {
      grid-template-columns: auto auto minmax(0, 1fr) auto;
    }
    .bc-feed-tag {
      display: none;
    }
  }
</style>
