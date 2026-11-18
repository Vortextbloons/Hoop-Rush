<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    eyebrow = null,
    eyebrowTone = 'primary',
    title,
    headingId = undefined,
    description = null,
    level = 2,
    size = 'md',
    align = 'end',
    actions = null,
    class: className = '',
    children,
    ...rest
  }: {
    eyebrow?: string | null;
    eyebrowTone?: 'primary' | 'muted' | 'accent';
    title: string | Snippet;
    headingId?: string;
    description?: string | null;
    level?: 1 | 2 | 3 | 4;
    size?: 'sm' | 'md' | 'lg';
    align?: 'start' | 'end';
    actions?: Snippet | null;
    children?: Snippet;
  } & Omit<HTMLAttributes<HTMLDivElement>, 'title'> = $props();
</script>

<div {...rest} class={['ui-section-head', className]} data-align={align}>
  <div class="ui-section-heading">
    {#if eyebrow !== null}
      <p class="ui-label" data-tone={eyebrowTone}>{eyebrow}</p>
    {/if}
    <svelte:element this={`h${level}`} class="ui-section-title" data-size={size} id={headingId}>
      {#if typeof title === 'function'}
        {@render title()}
      {:else}
        {title}
      {/if}
    </svelte:element>
    {#if description !== null}
      <p class="ui-section-description">{description}</p>
    {/if}
    {#if children !== undefined}
      {@render children()}
    {/if}
  </div>
  {#if actions !== null}
    <div class="ui-section-actions">{@render actions()}</div>
  {/if}
</div>
