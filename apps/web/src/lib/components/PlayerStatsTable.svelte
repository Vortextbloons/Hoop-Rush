<script lang="ts" generics="Row">
  import type { Snippet } from 'svelte';
  import type { PlayerStatColumn, PlayerStatsTotals } from './player-stats-table';
  let {
    columns,
    rows,
    rowKey,
    identity,
    cell = null,
    totals = null,
    playerLabel = 'Player',
    caption = null,
    tableClass = '',
    headClass = '',
    bodyClass = '',
    footClass = '',
    rowClass = null,
    rowAttributes = null,
    playerCellClass = '',
    statCellClass = '',
    headCellClass = '',
    totalCellClass = '',
    playerTotalCellClass = '',
    playerHeadCellClass = '',
  }: {
    columns: readonly PlayerStatColumn<Row>[];
    rows: readonly Row[];
    rowKey: (row: Row, index: number) => string;
    identity: Snippet<[Row]>;
    cell?: Snippet<[Row, PlayerStatColumn<Row>]> | null;
    totals?: PlayerStatsTotals<Row> | null;
    playerLabel?: string;
    caption?: string | null;
    tableClass?: string;
    headClass?: string;
    bodyClass?: string;
    footClass?: string;
    rowClass?: ((row: Row, index: number) => string) | null;
    rowAttributes?: ((row: Row, index: number) => Record<string, string>) | null;
    playerCellClass?: string;
    statCellClass?: string;
    headCellClass?: string;
    totalCellClass?: string;
    playerTotalCellClass?: string;
    playerHeadCellClass?: string;
  } = $props();
</script>

<table class={['ui-stats-table', tableClass]} data-player-stats-table>
  {#if caption !== null}
    <caption class="sr-only">{caption}</caption>
  {/if}
  <thead class={headClass}>
    <tr>
      <th scope="col" class={playerHeadCellClass}>{playerLabel}</th>
      {#each columns as column (column.key)}
        <th
          scope="col"
          data-align={column.align ?? 'end'}
          class={[headCellClass, column.headClass]}
        >
          {column.label}
        </th>
      {/each}
    </tr>
  </thead>
  <tbody class={bodyClass}>
    {#each rows as row, index (rowKey(row, index))}
      {@const attrs = rowAttributes === null ? {} : rowAttributes(row, index)}
      <tr class={rowClass?.(row, index) ?? ''} {...attrs}>
        <th scope="row" class={playerCellClass}>{@render identity(row)}</th>
        {#each columns as column (column.key)}
          <td data-align={column.align ?? 'end'} class={[statCellClass, column.cellClass]}>
            {#if cell !== null}
              {@render cell(row, column)}
            {:else}
              {column.value(row)}
            {/if}
          </td>
        {/each}
      </tr>
    {/each}
  </tbody>
  {#if totals !== null}
    <tfoot class={footClass}>
      <tr>
        <th scope="row" class={playerTotalCellClass}>{totals.label ?? 'Team'}</th>
        {#each columns as column (column.key)}
          <td
            data-align={column.align ?? 'end'}
            class={[totalCellClass, column.totalClass ?? column.cellClass]}
          >
            {totals.value(column)}
          </td>
        {/each}
      </tr>
    </tfoot>
  {/if}
</table>
