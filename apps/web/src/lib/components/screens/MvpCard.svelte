<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    label = null,
    name = null,
    team = null,
    slot = null,
    stats = [],
    portrait = null,
    logo = null,
    icon = null,
    tone = 'default',
    emptyCopy = 'No MVP recorded for this run.',
    class: className = '',
    ...rest
  }: {
    label?: string | null;
    name?: string | null;
    team?: string | null;
    slot?: string | null;
    stats?: readonly { label: string; value: string | number }[];
    portrait?: Snippet | null;
    logo?: Snippet | null;
    icon?: Snippet | null;
    tone?: 'default' | 'accent';
    emptyCopy?: string;
  } & Omit<HTMLAttributes<HTMLElement>, 'slot'> = $props();

  const visibleStats = $derived(stats.slice(0, 4));
  const metaLine = $derived(
    [team, slot].filter((part): part is string => part !== null && part.length > 0).join(' · '),
  );
  const empty = $derived(name === null || name.trim().length === 0);
</script>

<section {...rest} class={['ui-panel', 'ui-mvp-card', className]} data-tone={tone}>
  {#if label !== null || icon !== null}
    <div class="ui-mvp-card-head">
      {#if icon !== null}
        <span class="ui-mvp-card-icon" aria-hidden="true">{@render icon()}</span>
      {/if}
      {#if label !== null}
        <p class="ui-label">{label}</p>
      {/if}
    </div>
  {/if}
  {#if empty}
    <p class="ui-mvp-card-empty">{emptyCopy}</p>
  {:else}
    {#if portrait !== null}
      <div class="ui-mvp-card-portrait">{@render portrait()}</div>
    {/if}
    <div class="ui-mvp-card-copy">
      <p class="ui-mvp-card-name">{name}</p>
      {#if metaLine.length > 0}
        <p class="ui-mvp-card-meta">
          {#if logo !== null}<span class="ui-mvp-card-logo">{@render logo()}</span>{/if}
          <span>{metaLine}</span>
        </p>
      {/if}
    </div>
    {#if visibleStats.length > 0}
      <dl class="ui-mvp-card-stats">
        {#each visibleStats as stat (stat.label)}
          <div>
            <dt>{stat.label}</dt>
            <dd class="ui-mvp-card-value">{stat.value}</dd>
          </div>
        {/each}
      </dl>
    {/if}
  {/if}
</section>
