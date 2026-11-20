<script lang="ts">
  import type { HTMLTableAttributes } from 'svelte/elements';
  import type { ComparisonRow } from '../ui/types';

  let {
    rows,
    leftLabel = 'You',
    rightLabel = 'Opponent',
    class: className = '',
    ...rest
  }: {
    rows: readonly ComparisonRow[];
    leftLabel?: string;
    rightLabel?: string;
  } & HTMLTableAttributes = $props();
</script>

<table {...rest} class={['ui-comparison', className]}>
  <thead>
    <tr>
      <th scope="col" data-align="start">{leftLabel}</th>
      <th scope="col" data-align="center">Stat</th>
      <th scope="col" data-align="end">{rightLabel}</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as row, index (index)}
      <tr>
        <td
          data-align="start"
          data-bold={row.bold === false ? undefined : 'true'}
          data-highlight={row.highlight === 'left' ? 'true' : undefined}
        >
          {row.left}
        </td>
        <th scope="row" data-align="center">
          <span class="ui-comparison-label">{row.label}</span>
          {#if row.note}
            <span class="ui-comparison-note">{row.note}</span>
          {/if}
        </th>
        <td
          data-align="end"
          data-bold={row.bold === false ? undefined : 'true'}
          data-highlight={row.highlight === 'right' ? 'true' : undefined}
        >
          {row.right}
        </td>
      </tr>
    {/each}
  </tbody>
</table>
