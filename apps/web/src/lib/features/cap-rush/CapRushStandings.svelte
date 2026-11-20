<script lang="ts">
  import {
    CAP_RUSH_CONFERENCE_NAMES,
    capRushConferenceStandingsEntries,
    type CapRushConferenceStandings,
    type HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import ConferenceStandingsTable from '#lib/components/basketball/ConferenceStandingsTable.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';

  let {
    standings,
    manifest = null,
    userTeamId = null,
    onTeamSelect,
  }: {
    standings: CapRushConferenceStandings;
    manifest?: HoopRushManifest | null;
    userTeamId?: string | null;
    onTeamSelect?: (teamId: string) => void;
  } = $props();

  const entries = $derived(capRushConferenceStandingsEntries(standings));
  const userEntry = $derived(
    userTeamId === null ? null : (entries.find((entry) => entry.teamId === userTeamId) ?? null),
  );
  const userConference = $derived(userEntry?.conference ?? null);

  const tables = $derived([
    { conference: 'west' as const, entries: standings.west.entries, cutoff: standings.west.cutoff },
    { conference: 'east' as const, entries: standings.east.entries, cutoff: standings.east.cutoff },
  ]);
</script>

<Panel as="section" padding="none" class="p-4 sm:p-6" aria-label="Final league standings">
  <SectionHeading eyebrow="Conference standings" title="Final standings" size="md">
    {#snippet actions()}
      {#if userEntry}
        <p
          class="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 font-mono text-[10px] font-bold text-primary uppercase"
        >
          {userConference !== null
            ? `${CAP_RUSH_CONFERENCE_NAMES[userConference]} · Seed ${userEntry.seed}`
            : `Your seed · ${userEntry.seed}`}
        </p>
      {/if}
    {/snippet}
  </SectionHeading>

  <div class="mt-4 grid gap-4 lg:grid-cols-2">
    {#each tables as table (table.conference ?? 'overall')}
      <ConferenceStandingsTable
        conferenceLabel={table.conference === null
          ? 'League'
          : CAP_RUSH_CONFERENCE_NAMES[table.conference]}
        caption={table.conference === null
          ? 'League standings'
          : `${CAP_RUSH_CONFERENCE_NAMES[table.conference]} standings`}
        rows={table.entries}
        {userTeamId}
        {onTeamSelect}
        {manifest}
      />
    {/each}
  </div>
</Panel>
