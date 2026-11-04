<script lang="ts" generics="Row, Side extends string = string">
  import type { Snippet } from 'svelte';
  import PlayerStatsTable from '../PlayerStatsTable.svelte';
  import type { PlayerStatColumn, PlayerStatsTotals } from '../player-stats-table';
  import PlayerStatsControls from './PlayerStatsControls.svelte';

  let {
    title = null,
    description = null,
    ariaLabel = null,
    surface = 'panel',
    class: className = '',
    actions = null,
    sideOptions = null,
    side = null,
    onsidechange = null,
    sideLabel = 'Roster',
    values = 'game',
    onvalueschange = null,
    valuesLabel = 'Stat values',
    rows,
    columns,
    rowKey,
    identity: identitySnippet,
    cell: cellSnippet = null,
    totalsRow = null,
    caption = null,
    playerLabel = 'Player',
    tableClass = '',
    rowClass = null,
    rowAttributes = null,
    stickyIdentity = false,
    note = null,
    footer = null,
    empty = null,
    cards = null,
  }: {
    title?: string | null;
    description?: string | null;
    ariaLabel?: string | null;
    surface?: 'panel' | 'none';
    class?: string;
    actions?: Snippet | null;
    sideOptions?: readonly { value: Side; label: string }[] | null;
    side?: Side | null;
    onsidechange?: ((value: Side) => void) | null;
    sideLabel?: string;
    values?: 'game' | 'totals';
    onvalueschange?: ((value: 'game' | 'totals') => void) | null;
    valuesLabel?: string;
    rows: readonly Row[] | null;
    columns: readonly PlayerStatColumn<Row>[];
    rowKey: (row: Row, index: number) => string;
    identity: Snippet<[Row]>;
    cell?: Snippet<[Row, PlayerStatColumn<Row>]> | null;
    totalsRow?: PlayerStatsTotals<Row> | null;
    caption?: string | null;
    playerLabel?: string;
    tableClass?: string;
    rowClass?: ((row: Row, index: number) => string) | null;
    rowAttributes?: ((row: Row, index: number) => Record<string, string>) | null;
    stickyIdentity?: boolean;
    note?: string | null;
    footer?: Snippet | null;
    empty?: Snippet | null;
    cards?: Snippet | null;
  } = $props();

  const showControls = $derived(
    rows !== null &&
      ((sideOptions !== null && sideOptions.length > 0 && onsidechange !== null) ||
        onvalueschange !== null),
  );
  const showHead = $derived(
    title !== null || description !== null || actions !== null || showControls,
  );
</script>

<section
  class={['ui-stats-section', className]}
  data-surface={surface}
  aria-label={ariaLabel ?? undefined}
>
  {#if showHead}
    <div class="ui-stats-head">
      {#if title !== null || description !== null}
        <div class="ui-stats-heading">
          {#if title !== null}<h3 class="ui-stats-title">{title}</h3>{/if}
          {#if description !== null}<p class="ui-stats-description">{description}</p>{/if}
        </div>
      {/if}
      {#if showControls || actions !== null}
        <div class="ui-stats-head-actions">
          {#if actions !== null}
            <div class="ui-stats-actions">{@render actions()}</div>
          {/if}
          {#if showControls}
            <PlayerStatsControls
              {sideOptions}
              {side}
              {onsidechange}
              {sideLabel}
              {values}
              {onvalueschange}
              {valuesLabel}
            />
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if rows === null}
    {#if empty !== null}
      {@render empty()}
    {:else}
      <p class="ui-stats-empty">Player stats are not available.</p>
    {/if}
  {:else}
    <div class="ui-stats-scroll" data-mobile-cards={cards !== null ? 'true' : undefined}>
      <PlayerStatsTable
        {columns}
        {rows}
        {rowKey}
        {caption}
        {playerLabel}
        totals={totalsRow}
        {tableClass}
        {rowClass}
        {rowAttributes}
        {stickyIdentity}
        playerCellClass="ui-stats-player-cell"
        playerHeadCellClass="ui-stats-player-cell"
        playerTotalCellClass="ui-stats-player-cell"
      >
        {#snippet identity(row)}
          {@render identitySnippet(row)}
        {/snippet}
        {#snippet cell(row, column)}
          {#if cellSnippet !== null}
            {@render cellSnippet(row, column)}
          {:else}
            {column.value(row)}
          {/if}
        {/snippet}
      </PlayerStatsTable>
    </div>
    {#if cards !== null}
      <div class="ui-stats-cards">{@render cards()}</div>
    {/if}
    {#if note !== null}
      <p class="ui-stats-note">{note}</p>
    {/if}
    {#if footer !== null}
      <div class="ui-stats-footer">{@render footer()}</div>
    {/if}
  {/if}
</section>
