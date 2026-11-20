<script lang="ts">
  import type { ComparisonRow, ScheduleCell } from '../ui/types';
  import EmptyState from '../ui/EmptyState.svelte';
  import ComparisonTable from './ComparisonTable.svelte';
  import ScheduleGrid from './ScheduleGrid.svelte';

  const schedule: ScheduleCell[] = [
    {
      key: 'game-1',
      label: 'G1',
      sublabel: 'BOS 102–99',
      state: 'win',
      selectable: true,
      selected: true,
    },
    { key: 'game-2', label: 'G2', sublabel: 'NYK 88–91', state: 'loss' },
    { key: 'game-3', label: 'G3', sublabel: 'vs LAL', state: 'upcoming' },
    { key: 'game-4', label: 'G4', sublabel: 'MIA', state: 'neutral' },
  ];

  const comparison: ComparisonRow[] = [
    {
      label: 'Points per game',
      left: '112.4',
      right: '108.1',
      note: 'Per game',
      highlight: 'left',
    },
    { label: 'FG%', left: '48.2%', right: '45.9%', bold: false },
  ];
</script>

<EmptyState
  kind="error"
  title="Report unavailable"
  message="Could not read the run."
  retry={() => {}}
  retryLabel="Retry now"
  data-test-error="true"
/>

<ScheduleGrid cells={schedule} columns={4} label="Test schedule" data-test-schedule="grid" />

<ComparisonTable rows={comparison} leftLabel="Us" rightLabel="Them" data-test-comparison="table" />
