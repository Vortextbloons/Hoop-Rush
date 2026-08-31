<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import TeamDetailView from '$lib/components/season/TeamDetailView.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import { seasonTeamDetail } from '$lib/season/season-team-detail-view';
  import {
    overallRatingOfSlice,
    playablePositionsOfSlice,
    summaryRatingsOfSlice,
  } from '$lib/season/season-player-slice';
  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);
  const franchiseId = $derived(page.url.searchParams.get('franchiseId') ?? '');
  const detail = $derived.by(() => {
    const run = shell.run;
    const manifest = shell.manifest;
    if (run === null || manifest === null || !shell.playerSliceReady || franchiseId === '')
      return null;
    const slice = shell.playerSlice;
    const roster = run.rosters.find((r) => r.franchiseId === franchiseId);
    const rotation = run.rotations.find((r) => r.franchiseId === franchiseId);
    if (roster === undefined || rotation === undefined) return null;
    return seasonTeamDetail({
      roster,
      rotation,
      rosters: run.rosters,
      rotations: run.rotations,
      standings: run.standings,
      league: run.league,
      summaries: shell.snapshot?.summaries ?? [],
      overallRatingOf: (playerVersionId) => overallRatingOfSlice(slice, playerVersionId),
      summaryRatingsOf: (playerVersionId) => summaryRatingsOfSlice(slice, playerVersionId),
      playablePositions: (playerVersionId) => playablePositionsOfSlice(slice, playerVersionId),
    });
  });
  const isHuman = $derived(franchiseId !== '' && shell.humanFranchiseId === franchiseId);
  const manifest = $derived(shell.manifest);
</script>

<svelte:head>
  <title>Season Run — Team detail — Hoop Rush</title>
</svelte:head>

<div
  class="flex min-w-0 flex-col gap-4 pt-6 pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:pb-6"
>
  <div class="flex min-w-0 items-center justify-between gap-3 px-3 sm:px-0">
    <a
      href={resolve('/season/run/league')}
      data-season-team-detail-back
      class="inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
    >
      ← League
    </a>
    {#if isHuman && detail !== null}
      <a
        href={resolve('/season/run/team' as any)}
        class="inline-flex items-center gap-2 rounded-lg border border-primary/60 bg-surface-2 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-primary transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-primary hover:bg-surface-3"
      >
        Edit rotation
      </a>
    {/if}
  </div>

  {#if detail === null || manifest === null}
    <section
      aria-labelledby="team-missing-heading"
      class="mx-auto mt-8 w-full max-w-xl px-3 sm:px-0"
    >
      <div class="rounded-xl bg-surface-1 p-6 text-center">
        <h2
          id="team-missing-heading"
          class="font-display text-xl font-extrabold uppercase tracking-tight"
        >
          Team not found
        </h2>
        <p class="mt-2 text-sm text-muted-foreground">
          {franchiseId === '' || shell.run === null
            ? 'No active Season Run is loaded.'
            : `${shell.franchiseName(franchiseId)} is not part of this run.`}
        </p>
        <a
          href={resolve('/season/run/league')}
          class="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Back to League
        </a>
      </div>
    </section>
  {:else}
    <TeamDetailView {detail} {manifest} {shell} {isHuman} />
  {/if}
</div>
