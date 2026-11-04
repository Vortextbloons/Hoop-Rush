<script lang="ts">
  import type { PlayerStatColumn } from '../player-stats-table';
  import PlayerStatsSection from './PlayerStatsSection.svelte';

  interface Row {
    id: string;
    name: string;
    slot: string;
    minutes: number;
    points: number;
    rebounds: number;
  }

  const columns: readonly PlayerStatColumn<Row>[] = [
    { key: 'minutes', label: 'MIN', value: (row) => row.minutes, hideBelow: 'sm' },
    {
      key: 'points',
      label: 'PTS',
      value: (row) => row.points,
      cellClass: 'ui-stats-value-strong',
    },
    { key: 'rebounds', label: 'REB', value: (row) => row.rebounds },
  ];

  let {
    rows = null as readonly Row[] | null,
    side = 'you' as 'you' | 'opp',
    totals = false,
    onsidechange = (_next: 'you' | 'opp') => {},
    onvalueschange = (_next: 'game' | 'totals') => {},
  }: {
    rows?: readonly Row[] | null;
    side?: 'you' | 'opp';
    totals?: boolean;
    onsidechange?: (next: 'you' | 'opp') => void;
    onvalueschange?: (next: 'game' | 'totals') => void;
  } = $props();
</script>

<PlayerStatsSection
  title="Test player stats"
  ariaLabel="Test player stats"
  sideOptions={[
    { value: 'you', label: 'You' },
    { value: 'opp', label: 'Opponent' },
  ]}
  {side}
  {onsidechange}
  values={totals ? 'totals' : 'game'}
  {onvalueschange}
  {rows}
  {columns}
  rowKey={(row) => row.id}
  note="Per-game averages"
  caption="Test player stats table"
  stickyIdentity
>
  {#snippet identity(row)}
    <span class="ui-stats-player-name">{row.name}</span>
  {/snippet}
  {#snippet empty()}
    <p>No player stats</p>
  {/snippet}
</PlayerStatsSection>
