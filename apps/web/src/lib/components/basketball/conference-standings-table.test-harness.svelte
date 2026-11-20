<script lang="ts">
  import ConferenceStandingsTable from './ConferenceStandingsTable.svelte';

  const rows = Array.from({ length: 10 }, (_, index) => ({
    teamId: `team-${index + 1}`,
    displayName: `Team ${index + 1}`,
    wins: 50 - index,
    losses: 32 + index,
    pointDifferential: 100 - index * 10,
    seed: index + 1,
    qualified: index < 8,
  }));

  let { selectable = false }: { selectable?: boolean } = $props();
</script>

<ConferenceStandingsTable
  conferenceLabel="West"
  caption="West standings"
  {rows}
  userTeamId="team-3"
  onTeamSelect={selectable ? () => {} : null}
/>
