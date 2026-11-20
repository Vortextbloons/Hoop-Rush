<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    score,
    caption = null,
    meta = null,
    secondary = null,
    tone = 'default',
    scoreLabel = null,
    badges = null,
    class: className = '',
    ...rest
  }: {
    score: string;
    caption?: string | null;
    meta?: string | null;
    secondary?: string | null;
    tone?: 'default' | 'champion' | 'defeat';
    scoreLabel?: string | null;
    badges?: Snippet | null;
  } & HTMLAttributes<HTMLDivElement> = $props();
</script>

<div {...rest} class={['ui-panel', 'ui-result-hero', className]} data-tone={tone}>
  {#if badges !== null}
    <div class="ui-result-hero-badges">{@render badges()}</div>
  {/if}
  <p class="ui-result-hero-score" aria-label={scoreLabel ?? undefined}>{score}</p>
  {#if caption !== null}
    <p class="ui-result-hero-caption">{caption}</p>
  {/if}
  {#if meta !== null}
    <p class="ui-result-hero-meta">{meta}</p>
  {/if}
  {#if secondary !== null}
    <p class="ui-result-hero-secondary">{secondary}</p>
  {/if}
</div>
