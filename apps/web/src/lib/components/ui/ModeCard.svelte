<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    href = null,
    title,
    description,
    imageSrc = null,
    icon = null,
    facts = [],
    cta,
    progress = null,
    disabled = false,
    selected = false,
    onclick = undefined,
    footer = null,
    class: className = '',
    ...rest
  }: {
    href?: string | null;
    title: string;
    description: string;
    imageSrc?: string | null;
    icon?: Snippet | null;
    facts?: readonly { label: string; icon?: Snippet }[];
    cta: string;
    progress?: string | null;
    disabled?: boolean;
    selected?: boolean;
    onclick?: (() => void) | undefined;
    footer?: Snippet | null;
  } & Omit<HTMLAttributes<HTMLElement>, 'title' | 'onclick'> = $props();
</script>

{#snippet content()}
  {#if imageSrc !== null}
    <span class="ui-mode-card-media">
      <img src={imageSrc} alt="" loading="lazy" />
    </span>
  {/if}
  {#if icon !== null}
    <span class="ui-mode-card-icon">{@render icon()}</span>
  {/if}
  <span class="ui-mode-card-body">
    <span class="ui-mode-card-title">{title}</span>
    <span class="ui-mode-card-description">{description}</span>
    {#if progress !== null}
      <span class="ui-mode-card-progress">{progress}</span>
    {/if}
    {#if facts.length > 0}
      <span class="ui-mode-card-facts">
        {#each facts as fact (fact.label)}
          <span class="ui-mode-card-fact">
            {#if fact.icon !== undefined}{@render fact.icon()}{/if}
            {fact.label}
          </span>
        {/each}
      </span>
    {/if}
  </span>
  <span class="ui-mode-card-cta">
    {cta}
    <span aria-hidden="true">→</span>
  </span>
{/snippet}

{#if footer !== null}
  <div
    {...rest}
    class={['ui-panel', 'ui-mode-card', className]}
    data-disabled={disabled ? 'true' : undefined}
    data-selected={selected ? 'true' : undefined}
    data-has-footer={footer !== null ? 'true' : undefined}
  >
    {#if disabled}
      <div class="ui-mode-card-main" aria-disabled="true">
        {@render content()}
      </div>
    {:else if href !== null}
      <!-- eslint-disable svelte/no-navigation-without-resolve -- forwarded, already-resolved href -->
      <a class="ui-mode-card-main" {href} {onclick}>
        {@render content()}
      </a>
      <!-- eslint-enable svelte/no-navigation-without-resolve -->
    {:else if onclick !== undefined}
      <button class="ui-mode-card-main" type="button" aria-pressed={selected} {onclick}
        >{@render content()}</button
      >
    {:else}
      <div class="ui-mode-card-main">{@render content()}</div>
    {/if}
    <div class="ui-mode-card-footer">{@render footer()}</div>
  </div>
{:else if disabled}
  <div
    {...rest}
    class={['ui-panel', 'ui-mode-card', className]}
    data-disabled="true"
    data-selected={selected ? 'true' : undefined}
    aria-disabled="true"
  >
    {@render content()}
  </div>
{:else if href !== null}
  <!-- eslint-disable svelte/no-navigation-without-resolve -- forwarded, already-resolved href -->
  <a
    {...rest}
    {href}
    class={['ui-panel', 'ui-mode-card', className]}
    data-selected={selected ? 'true' : undefined}
    {onclick}
  >
    {@render content()}
  </a>
  <!-- eslint-enable svelte/no-navigation-without-resolve -->
{:else if onclick !== undefined}
  <button
    {...rest}
    type="button"
    class={['ui-panel', 'ui-mode-card', className]}
    data-selected={selected ? 'true' : undefined}
    aria-pressed={selected}
    {onclick}
  >
    {@render content()}
  </button>
{:else}
  <div
    {...rest}
    class={['ui-panel', 'ui-mode-card', className]}
    data-selected={selected ? 'true' : undefined}
  >
    {@render content()}
  </div>
{/if}
