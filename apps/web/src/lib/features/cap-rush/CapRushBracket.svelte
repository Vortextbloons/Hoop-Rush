<script lang="ts">
  import {
    capRushConferenceStandingsEntries,
    type CapRushPlayoffSeries,
    type CapRushConferenceStandings,
    type HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import { franchiseIdentityOf } from '#lib/branding.js';
  import PlayoffBracket from '#lib/components/basketball/PlayoffBracket.svelte';

  let {
    series,
    standings,
    manifest = null,
    userTeamId = null,
    onTeamSelect,
    onSeriesSelect,
    selectedSeriesId = null,
  }: {
    series: readonly CapRushPlayoffSeries[];
    standings: CapRushConferenceStandings;
    manifest?: HoopRushManifest | null;
    userTeamId?: string | null;
    onTeamSelect?: (teamId: string) => void;
    onSeriesSelect?: (series: CapRushPlayoffSeries) => void;
    selectedSeriesId?: string | null;
  } = $props();

  const entries = $derived(
    new Map(capRushConferenceStandingsEntries(standings).map((entry) => [entry.teamId, entry])),
  );

  function nameOf(teamId: string): string {
    return entries.get(teamId)?.displayName ?? teamId;
  }

  function seedOf(teamId: string): number {
    return entries.get(teamId)?.seed ?? 0;
  }

  function identityOf(teamId: string) {
    const identity = manifest === null ? null : franchiseIdentityOf(manifest, teamId);
    if (identity === null) return null;
    return {
      franchiseId: identity.franchiseId,
      teamExternalId: identity.teamExternalId,
      abbreviation: identity.abbreviation,
    };
  }
</script>

<PlayoffBracket
  {series}
  {manifest}
  {userTeamId}
  teamNameOf={nameOf}
  teamSeedOf={seedOf}
  teamIdentityOf={identityOf}
  ariaLabel="Playoff bracket"
  onTeamSelect={(teamId) => onTeamSelect?.(teamId)}
  onSeriesSelect={(entry) => onSeriesSelect?.(entry as CapRushPlayoffSeries)}
  {selectedSeriesId}
/>
