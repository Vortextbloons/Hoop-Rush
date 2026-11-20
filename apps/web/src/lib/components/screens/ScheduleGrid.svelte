<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { ScheduleCell } from '../ui/types';

  let {
    cells,
    columns = 8,
    label = 'Schedule results',
    onselect = undefined,
    class: className = '',
    ...rest
  }: {
    cells: readonly ScheduleCell[];
    columns?: number;
    label?: string;
    onselect?: ((key: string) => void) | undefined;
  } & Omit<HTMLAttributes<HTMLOListElement>, 'onselect'> = $props();

  const columnCount = $derived(Math.max(1, Math.floor(columns)));
</script>

<ol
  {...rest}
  class={['ui-schedule-grid', className]}
  aria-label={label}
  data-columns={columnCount}
  style:--ui-schedule-columns={String(columnCount)}
>
  {#each cells as cell (cell.key)}
    <li
      class="ui-schedule-cell"
      data-state={cell.state}
      data-selected={cell.selected === true ? 'true' : undefined}
    >
      {#if cell.selectable === true}
        <button
          type="button"
          class="ui-schedule-button"
          aria-pressed={cell.selected === true}
          aria-label={cell.ariaLabel ?? cell.title ?? undefined}
          title={cell.title ?? undefined}
          onclick={() => onselect?.(cell.key)}
        >
          <span class="ui-schedule-label">{cell.label}</span>
          {#if cell.sublabel !== null && cell.sublabel !== undefined}
            <span class="ui-schedule-sublabel">{cell.sublabel}</span>
          {/if}
        </button>
      {:else}
        <span
          class="ui-schedule-button"
          data-static="true"
          aria-label={cell.ariaLabel ?? cell.title ?? undefined}
          title={cell.title ?? undefined}
        >
          <span class="ui-schedule-label">{cell.label}</span>
          {#if cell.sublabel !== null && cell.sublabel !== undefined}
            <span class="ui-schedule-sublabel">{cell.sublabel}</span>
          {/if}
        </span>
      {/if}
    </li>
  {/each}
</ol>
