<script lang="ts">
  import type { Snippet } from 'svelte';
  import './gamecast-broadcast.css';
  import GamecastFeed, { type BroadcastFeedRow } from './GamecastFeed.svelte';

  let {
    label,
    scoreboard,
    progress = null,
    content = null,
    feed = null,
    feedTitle = 'Live feed',
    feedLabel = 'Play-by-play feed',
    feedEmptyMessage = 'Waiting for the first possession.',
    feedShowTags = true,
    feedCountLabel,
    feedPeriodLabel = undefined,
    feedClockLabel = undefined,
    class: className = 'broadcast',
  }: {
    label: string;
    scoreboard: Snippet;
    progress?: number | null;
    content?: Snippet | null;
    feed?: readonly BroadcastFeedRow[] | null;
    feedTitle?: string;
    feedLabel?: string;
    feedEmptyMessage?: string;
    feedShowTags?: boolean;
    feedCountLabel: string;
    feedPeriodLabel?: (period: number) => string;
    feedClockLabel?: (seconds: number) => string;
    class?: string;
  } = $props();

  const progressPct = $derived(
    progress === null
      ? 0
      : Math.round(Math.min(1, Math.max(0, Number.isNaN(progress) ? 0 : progress)) * 100),
  );
</script>

<section class={className} aria-label={label}>
  {@render scoreboard()}
  {#if progress !== null}
    <div class="bc-progress" aria-hidden="true">
      <div
        class="bc-progress-fill"
        data-active={progress >= 1 ? undefined : 'true'}
        style:width={`${progressPct}%`}
      ></div>
    </div>
  {/if}
  {@render content?.()}
  {#if feed !== null}
    <GamecastFeed
      rows={feed}
      title={feedTitle}
      label={feedLabel}
      emptyMessage={feedEmptyMessage}
      showTags={feedShowTags}
      countLabel={feedCountLabel}
      periodLabel={feedPeriodLabel}
      clockLabel={feedClockLabel}
    />
  {/if}
</section>
