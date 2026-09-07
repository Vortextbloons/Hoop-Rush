<script lang="ts">
  import type { HoopRushManifest, SeasonRoster } from '@hoop-rush/data-contracts';
  import SeasonRosterRow from '$lib/components/season/SeasonRosterRow.svelte';
  import { eraIdentityOf, franchiseIdentityOf } from '$lib/season/season-branding';
  import type { SeasonRunShellData } from '$lib/season/season-shell-context';
  import {
    FATIGUE_BAND_BADGE,
    FATIGUE_BAND_LABEL,
    fatigueBand,
    fatiguePercent,
    loadStateOf,
  } from '$lib/season/season-effects-view';
  import type { SeasonEffectsState, SeasonGameSummary } from '@hoop-rush/data-contracts';
  import { candidateOf } from '$lib/season/season-catalog-index';
  import { gearPointsOf, sponsorSlotsOf } from '$lib/season/sponsor-gear-view';
  import type { SeasonRun } from '@hoop-rush/data-contracts';
  let {
    roster,
    manifest,
    shell,
    roleOf,
    effects,
    summaries,
    embedded = false,
    sponsorsRun = null,
    onSelectPlayer = null,
  }: {
    roster: SeasonRoster;
    manifest: HoopRushManifest;
    shell: SeasonRunShellData;
    roleOf: (playerVersionId: string) => {
      role: string;
      minutes: number | string;
    };
    effects: SeasonEffectsState | null;
    summaries: SeasonGameSummary[];
    embedded?: boolean;
    sponsorsRun?: SeasonRun | null;
    onSelectPlayer?: ((playerVersionId: string) => void) | null;
  } = $props();
  const lastGame = $derived(summaries.length > 0 ? summaries[summaries.length - 1] : null);
  const lastGameMinutes = $derived(
    new Map<string, number>(
      lastGame === null || lastGame === undefined
        ? []
        : [...lastGame.homePlayers, ...lastGame.awayPlayers].map((line) => [
            line.playerVersionId,
            line.seconds / 60,
          ]),
    ),
  );
  function handleSelect(playerVersionId: string): void {
    onSelectPlayer?.(playerVersionId);
  }
</script>

<section
  aria-labelledby={embedded ? undefined : 'roster-heading'}
  class="flex flex-col gap-2"
  data-season-roster-list
>
  {#if !embedded}
    <h3
      id="roster-heading"
      class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
    >
      Roster
    </h3>
  {/if}
  <ul class="flex flex-col gap-0 sm:gap-2">
    {#each roster.players as entry (entry.playerVersionId)}
      {@const face = shell.facesByVersion.get(entry.playerVersionId) ?? null}
      {@const eraIdentity = eraIdentityOf(manifest, entry.franchiseId, entry.eraId)}
      {@const modernIdentity = franchiseIdentityOf(manifest, entry.franchiseId)}
      {@const candidate = candidateOf(shell.catalog, entry.playerVersionId)}
      {@const playable = shell.playablePositions(entry.playerVersionId)}
      {@const rotation = roleOf(entry.playerVersionId)}
      {@const active = rotation.role !== 'Inactive'}
      {@const load =
        active && effects !== null ? loadStateOf(effects, entry.playerVersionId) : null}
      {@const band = load === null ? null : fatigueBand(load.fatigueBasisPoints)}
      {@const lastMinutes = lastGameMinutes.get(entry.playerVersionId) ?? null}
      {@const gearPoints =
        sponsorsRun === null ? 0 : gearPointsOf(sponsorSlotsOf(sponsorsRun, entry.playerVersionId))}
      <li
        data-season-roster-status={active ? 'active' : 'inactive'}
        class="overflow-hidden bg-surface-1 p-0 sm:rounded-xl"
      >
        <SeasonRosterRow
          playerVersionId={entry.playerVersionId}
          displayName={entry.displayName}
          seasonKey={entry.seasonKey}
          franchiseId={entry.franchiseId}
          {face}
          {manifest}
          eraDisplayLabel={eraIdentity?.displayLabel ?? null}
          eraLogoCandidates={eraIdentity?.logoCandidates ?? []}
          teamExternalId={modernIdentity?.teamExternalId ?? ''}
          teamDisplayName={eraIdentity?.displayLabel ?? modernIdentity?.displayName ?? ''}
          overall={candidate?.summaryRatings.overallRating ?? null}
          {playable}
          role={rotation.role}
          minutes={rotation.minutes}
          {active}
          fatigueBadgeClass={band === null ? null : FATIGUE_BAND_BADGE[band]}
          fatigueBadgeText={band === null || load === null
            ? null
            : `${FATIGUE_BAND_LABEL[band]} ${fatiguePercent(load.fatigueBasisPoints)}%`}
          recentLoadText={load === null
            ? null
            : `Recent load ${(load.recentLoadBasisPoints / 100).toFixed(0)}%`}
          {lastMinutes}
          {gearPoints}
          selectable={onSelectPlayer !== null}
          onSelect={handleSelect}
        />
      </li>
    {/each}
  </ul>
</section>
