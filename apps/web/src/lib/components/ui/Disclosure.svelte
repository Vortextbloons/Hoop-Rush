<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLDetailsAttributes } from 'svelte/elements';

  let {
    summary,
    meta = null,
    open = undefined,
    class: className = '',
    children,
    ...rest
  }: {
    summary: string;
    meta?: string | null;
    open?: boolean;
    children: Snippet;
  } & Omit<HTMLDetailsAttributes, 'children'> = $props();
</script>

<details {...rest} {open} class={['ui-panel', 'ui-disclosure', className]}>
  <summary class="ui-disclosure-summary">
    <span class="ui-disclosure-copy">
      <span class="ui-disclosure-title">{summary}</span>
      {#if meta !== null}
        <span class="ui-disclosure-meta">{meta}</span>
      {/if}
    </span>
    <svg
      class="ui-disclosure-chevron"
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 7.5 10 12.5 15 7.5"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </summary>
  <div class="ui-disclosure-body">{@render children()}</div>
</details>
