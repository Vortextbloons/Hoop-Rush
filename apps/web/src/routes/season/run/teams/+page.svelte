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
  import { homeRuleOf } from '$lib/season/season-evolution-view';
  import { candidateOf } from '$lib/season/season-catalog-index';
  import { boostedOverallForPlayer } from '$lib/season/sponsor-gear-view';
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
      overallRatingOf: (playerVersionId) => {
        const base = overallRatingOfSlice(slice, playerVersionId);
        const candidate = candidateOf(shell.catalog, playerVersionId);
        if (candidate === null) return base;
        return (
          boostedOverallForPlayer(run, playerVersionId, {
            overall: candidate.summaryRatings.overallRating,
            baseRatings: candidate.detailedRatings,
            tendencies: candidate.tendencies,
          }) ?? base
        );
      },
      summaryRatingsOf: (playerVersionId) => summaryRatingsOfSlice(slice, playerVersionId),
      playablePositions: (playerVersionId) => playablePositionsOfSlice(slice, playerVersionId),
    });
  });
  const isHuman = $derived(franchiseId !== '' && shell.humanFranchiseId === franchiseId);
  const manifest = $derived(shell.manifest);
  const homeRule = $derived(
    shell.run === null ? ('standard' as const) : homeRuleOf(shell.run, franchiseId),
  );
</script>

<svelte:head>
  <title>Season Run — Team detail — Hoop Rush</title>
</svelte:head>

<div
  class="flex min-w-0 flex-col gap-4 pt-6 pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:pb-6"
>
  <div class="sr-arrive flex min-w-0 items-center justify-between gap-3">
    <a
      href={resolve('/season/run/league')}
      data-season-team-detail-back
      class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground outline-none transition-colors hover:text-foreground motion-reduce:transition-none"
    >
      ← League
    </a>
    {#if isHuman && detail !== null}
      <a
        href={resolve('/season/run/team' as any)}
        class="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface-2 px-4 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-primary transition-colors outline-none hover:border-primary motion-reduce:transition-none"
      >
        Edit rotation
      </a>
    {/if}
  </div>

  {#if detail === null || manifest === null}
    <section
      aria-labelledby="team-missing-heading"
      class="mx-auto mt-8 w-full max-w-xl"
    >
      <div class="sr-panel p-6 text-center">
        <p class="sr-eyebrow">Season Run</p>
        <h2
          id="team-missing-heading"
          class="sr-page-title mt-1 text-2xl"
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
          class="sr-btn-ghost mt-4"
        >
          Back to League
        </a>
      </div>
    </section>
  {:else}
    <TeamDetailView {detail} {manifest} {shell} {isHuman} {homeRule} />
  {/if}
</div>