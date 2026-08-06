<script lang="ts">
  import type { HoopRushManifest, SeasonRoster } from '@hoop-rush/data-contracts';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import { eraIdentityOf, franchiseIdentityOf } from '$lib/season/season-branding';
  import type { SeasonRunShellData } from '$lib/season/season-shell-context';
  import {
    activeLineupChemistryBp,
    FATIGUE_BAND_BADGE,
    FATIGUE_BAND_LABEL,
    fatigueBand,
    fatiguePercent,
    loadStateOf,
    strongestAndWeakestPairs,
  } from '$lib/season/season-effects-view';
  import type { SeasonEffectsState, SeasonGameSummary } from '@hoop-rush/data-contracts';

  /**
   * Human franchise roster cards (M2.4): ten player-season versions with
   * faces, historical source identity, OVR, current rotation role/minutes,
   * the recorded M2.4 fatigue band + workload, and the last-game minutes.
   * The chemistry panel above shows the active-lineup chemistry and the
   * strongest/weakest recorded pairs (shared possessions as evidence).
   */

  let {
    roster,
    manifest,
    shell,
    roleOf,
    effects,
    summaries,
  }: {
    roster: SeasonRoster;
    manifest: HoopRushManifest;
    shell: SeasonRunShellData;
    /** Current rotation role + minutes for each playerVersionId. */
    roleOf: (playerVersionId: string) => { role: string; minutes: number | string };
    /** M2.4 recorded effects state at the last accepted boundary. */
    effects: SeasonEffectsState | null;
    /** Accepted summaries (last-game minutes per player). */
    summaries: SeasonGameSummary[];
  } = $props();

  const rosterVersions = $derived(roster.players.map((entry) => entry.playerVersionId));

  const pendingUnit = $derived(shell.editor?.rows() ?? []);
  const pendingStarters = $derived(
    pendingUnit
      .filter((row) => row.role.startsWith('Starter'))
      .map((row) => row.member.playerVersionId),
  );
  const pendingStartersFive = $derived(
    pendingStarters.length === 5 ? pendingStarters : rosterVersions.slice(0, 5),
  );

  const lineupChemistry = $derived(
    effects === null ? null : activeLineupChemistryBp(effects, pendingStartersFive),
  );

  const pairs = $derived(
    effects === null ? null : strongestAndWeakestPairs(effects, rosterVersions),
  );

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

  function nameOf(playerVersionId: string): string {
    const entry = roster.players.find((p) => p.playerVersionId === playerVersionId);
    return entry?.displayName ?? playerVersionId;
  }
</script>

<div class="flex flex-col gap-4">
  {#if effects !== null && roster !== null}
    <section aria-labelledby="chemistry-heading" class="bg-surface-1 p-4 sm:rounded-xl">
      <p id="chemistry-heading" class="text-label uppercase text-muted-foreground">
        Unit chemistry
      </p>
      <p class="mt-1 font-mono text-xs text-foreground">
        Active lineup <span class="font-bold">
          {lineupChemistry === null ? '—' : `${(lineupChemistry / 100).toFixed(0)}%`}
        </span>
        {#if pendingStarters.length !== 5}
          <span class="text-muted-foreground"> · pending starters</span>
        {/if}
      </p>
      {#if pairs !== null && (pairs.strongest.length > 0 || pairs.weakest.length > 0)}
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          {#if pairs.strongest.length > 0}
            <div>
              <p class="font-mono text-[10px] text-muted-foreground">Most shared play</p>
              <ul class="mt-1 space-y-1">
                {#each pairs.strongest as pair (pair.a + pair.b)}
                  <li class="flex items-center justify-between gap-2 font-mono text-[10px]">
                    <span class="min-w-0 truncate">
                      {nameOf(pair.a)} + {nameOf(pair.b)}
                    </span>
                    <span class="shrink-0 text-positive">
                      {pair.shared} trips · {(pair.chemistryBp / 100).toFixed(0)}%
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
          {#if pairs.weakest.length > 0}
            <div>
              <p class="font-mono text-[10px] text-muted-foreground">Least shared play</p>
              <ul class="mt-1 space-y-1">
                {#each pairs.weakest as pair (pair.a + pair.b)}
                  <li class="flex items-center justify-between gap-2 font-mono text-[10px]">
                    <span class="min-w-0 truncate">
                      {nameOf(pair.a)} + {nameOf(pair.b)}
                    </span>
                    <span class="shrink-0 text-muted-foreground">
                      {pair.shared} trips · {(pair.chemistryBp / 100).toFixed(0)}%
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      {/if}
      <p class="mt-3 font-mono text-[9px] text-muted-foreground/70">
        Shared possessions are recorded evidence from completed trips, not a prediction.
      </p>
    </section>
  {/if}

  <ul class="flex flex-col gap-0 sm:gap-2">
    {#each roster.players as entry (entry.playerVersionId)}
      {@const face = shell.facesByVersion.get(entry.playerVersionId) ?? null}
      {@const eraIdentity = eraIdentityOf(manifest, entry.franchiseId, entry.eraId)}
      {@const modernIdentity = franchiseIdentityOf(manifest, entry.franchiseId)}
      {@const candidate =
        shell.catalog?.candidates.find((c) => c.playerVersionId === entry.playerVersionId) ?? null}
      {@const rotation = roleOf(entry.playerVersionId)}
      {@const load = effects === null ? null : loadStateOf(effects, entry.playerVersionId)}
      {@const band = load === null ? null : fatigueBand(load.fatigueBasisPoints)}
      {@const lastMinutes = lastGameMinutes.get(entry.playerVersionId) ?? null}
      <li class="overflow-hidden bg-surface-1 p-3 sm:rounded-xl">
        <div class="flex min-w-0 items-start gap-3">
          {#if face !== null}
            <SeasonPlayerFace {face} {manifest} size="sm" />
          {:else}
            <span
              class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display font-extrabold text-muted-foreground"
              aria-hidden="true"
            >
              ?
            </span>
          {/if}
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <p class="min-w-0 truncate text-sm font-semibold">{entry.displayName}</p>
              {#if candidate}
                <span
                  class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground"
                >
                  OVR {candidate.summaryRatings.overallRating}
                </span>
              {/if}
              {#if band !== null && load !== null}
                <span
                  class={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${FATIGUE_BAND_BADGE[band]}`}
                >
                  {FATIGUE_BAND_LABEL[band]}
                  {fatiguePercent(load.fatigueBasisPoints)}%
                </span>
              {/if}
            </div>
            <p class="truncate font-mono text-[10px] text-muted-foreground">
              {entry.seasonKey}
              {#if shell.playablePositions(entry.playerVersionId).length > 0}
                · {shell.playablePositions(entry.playerVersionId).join('/')}
              {/if}
            </p>
            {#if eraIdentity?.displayLabel}
              <p
                class="mt-1 line-clamp-2 font-mono text-[9px] leading-snug text-muted-foreground/70"
              >
                {eraIdentity.displayLabel}
              </p>
            {/if}
            {#if load !== null}
              <p class="mt-1 font-mono text-[9px] text-muted-foreground/70">
                Recent load {(load.recentLoadBasisPoints / 100).toFixed(0)}%
                {#if lastMinutes !== null}
                  · last game {Math.round(lastMinutes)} min
                {/if}
              </p>
            {/if}
          </div>
          <div class="flex shrink-0 flex-col items-end gap-1">
            <SeasonTeamLogo
              {manifest}
              franchiseId={entry.franchiseId}
              teamExternalId={modernIdentity?.teamExternalId ?? ''}
              logoCandidates={eraIdentity?.logoCandidates ?? []}
              size="sm"
              alt={eraIdentity?.displayLabel ?? modernIdentity?.displayName ?? ''}
            />
            <span class="whitespace-nowrap font-mono text-[10px] text-muted-foreground">
              {rotation.role} · {rotation.minutes} min
            </span>
          </div>
        </div>
      </li>
    {/each}
  </ul>
</div>
