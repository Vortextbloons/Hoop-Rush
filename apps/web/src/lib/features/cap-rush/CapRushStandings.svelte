<script lang="ts">
  import {
    CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS,
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

  function tieBreakLabel(value: string): string {
    switch (value) {
      case 'wins':
        return 'wins';
      case 'head-to-head':
        return 'head-to-head record';
      case 'conference':
        return 'conference record';
      case 'point-differential':
        return 'point differential';
      case 'points-for':
        return 'points scored';
      case 'team-id':
        return 'stable team id';
      default:
        return 'wins';
    }
  }

  const tables = $derived([
    { conference: 'west' as const, entries: standings.west.entries, cutoff: standings.west.cutoff },
    { conference: 'east' as const, entries: standings.east.entries, cutoff: standings.east.cutoff },
  ]);
</script>

<Panel as="section" padding="none" class="p-4 sm:p-6" aria-label="Final league standings">
  <SectionHeading eyebrow="Conference standings" title="Eight per conference." size="md">
    {#snippet actions()}
      {#if userEntry}
        <p
          class="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] font-bold text-primary uppercase"
        >
          {userConference !== null
            ? `${CAP_RUSH_CONFERENCE_NAMES[userConference]} · Seed ${userEntry.seed}`
            : `Your seed · ${userEntry.seed}`}
        </p>
      {/if}
    {/snippet}
  </SectionHeading>

  <p class="mt-2 text-xs text-muted-foreground">
    Seeds 1–{CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS} in each conference qualify. Ties break on wins, then head-to-head
    record among tied teams, then conference record, point differential, points scored and stable team
    id.
  </p>

  <div class="mt-4 grid gap-4 lg:grid-cols-2">
    {#each tables as table (table.conference ?? 'overall')}
      {@const cutoff = table.cutoff}
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
        cutoffNote={cutoff === null
          ? null
          : `Cutoff: seed ${cutoff.seed} finished ${cutoff.wins}–${cutoff.losses} with a ${cutoff.pointDifferential > 0 ? '+' : ''}${cutoff.pointDifferential} differential. Decided by ${tieBreakLabel(cutoff.tieBreak)}.`}
      />
    {/each}
  </div>
</Panel>
