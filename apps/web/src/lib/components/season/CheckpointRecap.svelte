<script lang="ts">
  import type {
    HoopRushManifest,
    SeasonBlockRecap,
    SeasonRecordMovement,
    SeasonRosterEntry,
  } from '@hoop-rush/data-contracts';
  import { ordinal, recordLabel, streakLabel } from '$lib/season/season-presentation';
  import {
    eraIdentityOf,
    franchiseIdentityOf,
    type SeasonFaceRef,
  } from '$lib/season/season-branding';
  import SeasonPlayerFace from './SeasonPlayerFace.svelte';
  import SeasonTeamLogo from './SeasonTeamLogo.svelte';

  /**
   * Factual block recap (spec/2.0/02 recap, spec/2.0/11 block recap, M2.3,
   * M2.3.5). Leads with record and standings movement, then notable
   * performances, streaks, version-versus-version spotlights, and the next
   * human games. Every claim derives from accepted saved facts; nothing is
   * invented. When a manifest plus the face/roster indexes are provided,
   * movement rows and streaks brand franchise logos, and performances and
   * spotlights brand player headshots with their historical source logos.
   * M2.3 recaps deliberately do NOT report injuries, trades, Influence,
   * stamina, or chemistry claims — those systems ship in later milestones.
   */

  let {
    recap,
    humanRecord,
    franchiseName,
    playerName,
    manifest = null,
    faces = new Map(),
    rosterByVersion = new Map(),
  }: {
    recap: SeasonBlockRecap;
    humanRecord: SeasonRecordMovement | null;
    franchiseName: (franchiseId: string) => string;
    playerName: (playerVersionId: string) => string;
    /** Packaged manifest; when present recaps render logos and headshots. */
    manifest?: HoopRushManifest | null;
    faces?: ReadonlyMap<string, SeasonFaceRef>;
    rosterByVersion?: ReadonlyMap<string, SeasonRosterEntry>;
  } = $props();

  const movementLabel = (movement: SeasonRecordMovement): string =>
    `${movement.winsBefore}–${movement.lossesBefore} → ${movement.winsAfter}–${movement.lossesAfter} (${
      movement.positionBefore !== movement.positionAfter
        ? `${ordinal(movement.positionBefore)} → ${ordinal(movement.positionAfter)}`
        : `${ordinal(movement.positionAfter)} in conference`
    })`;

  const franchiseIdentity = (franchiseId: string) =>
    manifest ? franchiseIdentityOf(manifest, franchiseId) : null;

  /** Historical source identity for one player version (logo + season). */
  function versionSource(playerVersionId: string): {
    teamExternalId: string;
    logoCandidates: readonly string[];
    seasonLabel: string;
  } | null {
    const rosterEntry = rosterByVersion.get(playerVersionId);
    if (rosterEntry === undefined || manifest === null) return null;
    const modern = franchiseIdentityOf(manifest, rosterEntry.franchiseId);
    if (modern === null) return null;
    const era = eraIdentityOf(manifest, rosterEntry.franchiseId, rosterEntry.eraId);
    return {
      teamExternalId: modern.teamExternalId,
      logoCandidates: era.logoCandidates,
      seasonLabel: era.displayLabel === null ? '' : ` · ${era.displayLabel}`,
    };
  }
</script>

<div class="flex flex-col gap-6">
  {#if humanRecord}
    <section
      aria-labelledby="recap-record-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
    >
      <h2
        id="recap-record-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Your block
      </h2>
      <div class="mt-2 flex items-center gap-3">
        {#if manifest && franchiseIdentity(humanRecord.franchiseId)}
          <SeasonTeamLogo
            {manifest}
            franchiseId={humanRecord.franchiseId}
            teamExternalId={franchiseIdentity(humanRecord.franchiseId)!.teamExternalId}
            alt={`${franchiseName(humanRecord.franchiseId)} logo`}
            size="md"
          />
        {/if}
        <p class="text-2xl font-extrabold">
          {recordLabel(humanRecord.winsAfter, humanRecord.lossesAfter)}
          <span class="ml-2 font-mono text-xs font-normal text-muted-foreground">
            from {recordLabel(humanRecord.winsBefore, humanRecord.lossesBefore)} ·
            {ordinal(humanRecord.positionAfter)} in conference (provisional)
          </span>
        </p>
      </div>
      <p class="mt-1 font-mono text-[10px] text-muted-foreground">
        Block {recap.blockIndex + 1} of 9 · rounds 1–{recap.completedRounds} complete
      </p>
    </section>
  {/if}

  {#if recap.standingsMovement.length > 0}
    <section
      aria-labelledby="recap-movement-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
    >
      <h2
        id="recap-movement-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Standings movement
      </h2>
      <ul class="mt-2 flex flex-col divide-y divide-border/50">
        {#each recap.standingsMovement as movement (movement.franchiseId)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            {#if manifest && franchiseIdentity(movement.franchiseId)}
              <SeasonTeamLogo
                {manifest}
                franchiseId={movement.franchiseId}
                teamExternalId={franchiseIdentity(movement.franchiseId)!.teamExternalId}
                alt=""
                size="sm"
              />
            {/if}
            <span class="min-w-0 flex-1 truncate font-semibold">
              {franchiseName(movement.franchiseId)}
            </span>
            <span class="font-mono text-[10px] text-muted-foreground">
              {movementLabel(movement)}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if recap.notablePerformances.length > 0}
    <section
      aria-labelledby="recap-performances-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
    >
      <h2
        id="recap-performances-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Notable performances
      </h2>
      <ul class="mt-2 flex flex-col divide-y divide-border/50">
        {#each recap.notablePerformances as performance (performance.playerVersionId + performance.gameId)}
          {@const source = versionSource(performance.playerVersionId)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            {#if manifest && faces.get(performance.playerVersionId)}
              <SeasonPlayerFace
                face={faces.get(performance.playerVersionId)!}
                {manifest}
                size="sm"
              />
            {/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">
                {playerName(performance.playerVersionId)}
              </span>
              <span class="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                {#if source && manifest}
                  <SeasonTeamLogo
                    {manifest}
                    franchiseId={performance.franchiseId}
                    teamExternalId={source.teamExternalId}
                    logoCandidates={source.logoCandidates}
                    alt=""
                    size="sm"
                  />
                {/if}
                <span class="min-w-0 truncate">
                  {performance.points} pts · {performance.rebounds} reb · {performance.assists} ast{source
                    ? source.seasonLabel
                    : ''}
                </span>
              </span>
            </span>
            {#if performance.humanTeam}
              <span
                class="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-primary"
              >
                Your team
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if recap.streaks.length > 0}
    <section
      aria-labelledby="recap-streaks-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
    >
      <h2
        id="recap-streaks-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Streaks
      </h2>
      <ul class="mt-2 flex flex-col gap-1.5">
        {#each recap.streaks as streak (streak.franchiseId)}
          <li class="flex items-center gap-2 text-sm">
            {#if manifest && franchiseIdentity(streak.franchiseId)}
              <SeasonTeamLogo
                {manifest}
                franchiseId={streak.franchiseId}
                teamExternalId={franchiseIdentity(streak.franchiseId)!.teamExternalId}
                alt=""
                size="sm"
              />
            {/if}
            <span class="min-w-0 flex-1 truncate font-semibold">
              {franchiseName(streak.franchiseId)}
            </span>
            <span class="shrink-0 font-mono text-[10px] font-bold">
              {streakLabel(streak.kind, streak.length)}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if recap.versionSpotlights.length > 0}
    <section
      aria-labelledby="recap-spotlights-heading"
      class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
    >
      <h2
        id="recap-spotlights-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Version vs version
      </h2>
      <ul class="mt-2 flex flex-col divide-y divide-border/50">
        {#each recap.versionSpotlights as spotlight (spotlight.versionA + spotlight.versionB)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            {#if manifest && faces.get(spotlight.versionA)}
              <SeasonPlayerFace face={faces.get(spotlight.versionA)!} {manifest} size="sm" />
            {/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">
                {playerName(spotlight.versionA)}
                <span class="mx-1 text-muted-foreground">vs</span>
                {playerName(spotlight.versionB)}
              </span>
              <span class="block font-mono text-[10px] text-muted-foreground">
                {spotlight.sameTeam
                  ? 'Same roster · '
                  : ''}{spotlight.gamesPlayedA}/{spotlight.gamesPlayedB}
                games · {spotlight.pointsA}/{spotlight.pointsB} pts ·
                {spotlight.reboundsA}/{spotlight.reboundsB} reb ·
                {spotlight.assistsA}/{spotlight.assistsB} ast
                {#if spotlight.headToHeadGames > 0}
                  · {spotlight.headToHeadGames} meeting{spotlight.headToHeadGames === 1 ? '' : 's'}
                  ({spotlight.headToHeadWinsA}–{spotlight.headToHeadWinsB})
                {/if}
              </span>
            </span>
            {#if manifest && faces.get(spotlight.versionB)}
              <SeasonPlayerFace face={faces.get(spotlight.versionB)!} {manifest} size="sm" />
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section
    aria-labelledby="recap-upcoming-heading"
    class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
  >
    <h2
      id="recap-upcoming-heading"
      class="font-display text-base font-extrabold uppercase tracking-tight"
    >
      Next opponents
    </h2>
    {#if recap.upcomingHumanGames.length === 0}
      <p class="mt-2 text-sm text-muted-foreground">
        {recap.completedRounds >= 82
          ? 'The regular season is complete.'
          : 'No human games scheduled.'}
      </p>
    {:else}
      <ol class="mt-2 flex flex-col gap-1.5">
        {#each recap.upcomingHumanGames as game (game.gameId)}
          <li class="flex flex-wrap items-center gap-2 text-sm">
            <span class="w-14 shrink-0 font-mono text-[10px] text-muted-foreground">
              R{game.round}
            </span>
            {#if manifest && franchiseIdentity(game.opponentFranchiseId)}
              <SeasonTeamLogo
                {manifest}
                franchiseId={game.opponentFranchiseId}
                teamExternalId={franchiseIdentity(game.opponentFranchiseId)!.teamExternalId}
                alt=""
                size="sm"
              />
            {/if}
            <span class="min-w-0 flex-1 truncate">
              {game.humanIsHome ? 'vs' : 'at'}
              {franchiseName(game.opponentFranchiseId)}
            </span>
            <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{game.gameId}</span>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</div>
