<script lang="ts">
  import { setContext } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Briefcase, LogOut, RefreshCw, Trophy, Users, X, Zap } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import { ordinal, provisionalRanking, recordLabel } from '#lib/season/season-presentation.js';
  import { SeasonRunShell } from '#lib/season/season-shell-state.svelte.js';
  import { SEASON_RUN_SHELL_CONTEXT } from '#lib/season/season-shell-context.js';
  import { isNavItemActive } from '#lib/nav-items.js';
  import {
    buildSeasonNavGroups,
    seasonMobileNavOf,
    type SeasonNavGroup,
  } from '#lib/season/season-nav.js';
  import BottomNav from '#lib/components/BottomNav.svelte';
  import SeasonMasthead from '#lib/components/season/SeasonMasthead.svelte';
  import '#lib/season/season-theme.css';
  let { children } = $props();
  const shell = new SeasonRunShell();
  setContext(SEASON_RUN_SHELL_CONTEXT, shell);
  const groups: SeasonNavGroup[] = $derived.by(() => {
    const stage = (shell.run?.stage ?? null) as Parameters<typeof buildSeasonNavGroups>[1]['stage'];
    return buildSeasonNavGroups(
      {
        gameday: Zap,
        team: Users,
        league: Trophy,
        bracket: Trophy,
        frontOffice: Briefcase,
      },
      {
        stage,
        freeAgencyVisible: (shell.run?.freeAgency.windows.length ?? 0) > 0,
      },
    );
  });
  const { primary: mobilePrimary, overflow: mobileOverflow } = $derived(seasonMobileNavOf(groups));
  const routeId = $derived(page.route.id);
  const activeSubGroup = $derived.by(
    () => groups.find((group) => group.children.some((c) => isNavItemActive(c, routeId))) ?? null,
  );
  const leagueRoute = $derived(routeId === '/season/run/league');
  const shellWidthClass = $derived(
    leagueRoute
      ? 'max-w-6xl xl:max-w-[96rem] 2xl:max-w-[110rem]'
      : 'max-w-6xl xl:max-w-7xl 2xl:max-w-[88rem]',
  );
  $effect(() => {
    if (!import.meta.env.SSR) {
      void shell.init();
    }
    return () => {
      shell.dispose();
    };
  });
  let quitOpen = $state(false);
  let quitting = $state(false);
  let quitError: string | null = $state(null);
  let clearOpen = $state(false);
  let clearing = $state(false);
  let clearError: string | null = $state(null);
  async function confirmClearSeasonData(): Promise<void> {
    if (clearing) return;
    clearing = true;
    clearError = null;
    try {
      const result =
        shell.hub !== null
          ? await shell.hub.clearSeasonData()
          : await (async () => {
              const { clearAllSeasonData } = await import('#lib/season/season-data-recovery.js');
              await clearAllSeasonData();
              return { ok: true, error: null };
            })();
      if (!result.ok) {
        clearError = result.error;
        return;
      }
      clearOpen = false;
      shell.error = null;
      shell.hubError = null;
      await goto(resolve('season/'));
    } catch (error) {
      clearError = error instanceof Error ? error.message : String(error);
    } finally {
      clearing = false;
    }
  }
  async function confirmQuit(): Promise<void> {
    if (quitting) return;
    quitting = true;
    quitError = null;
    try {
      const result = await shell.quitRun();
      if (!result.ok) {
        quitError = result.error;
        return;
      }
      quitOpen = false;
      await goto(resolve('season/'));
    } finally {
      quitting = false;
    }
  }
  const rankingWeak = new WeakMap<object, ReturnType<typeof provisionalRanking>>();
  const rankingByDigest = new Map<string, ReturnType<typeof provisionalRanking>>();
  function standingsDigest(
    rows: readonly {
      franchiseId: string;
      wins: number;
      losses: number;
      pointsFor: number;
      pointsAgainst: number;
    }[],
  ): string {
    let hash = 2166136261;
    const sorted = [...rows].sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1));
    for (const row of sorted) {
      for (let i = 0; i < row.franchiseId.length; i += 1)
        hash = Math.imul(hash ^ row.franchiseId.charCodeAt(i), 16777619);
      hash = Math.imul(hash ^ row.wins, 16777619);
      hash = Math.imul(hash ^ row.losses, 16777619);
      hash = Math.imul(hash ^ row.pointsFor, 16777619);
      hash = Math.imul(hash ^ row.pointsAgainst, 16777619);
    }
    return `${String(rows.length)}:${String(hash >>> 0)}`;
  }
  function memoizedRanking(
    standings: Parameters<typeof provisionalRanking>[0],
    league: Parameters<typeof provisionalRanking>[1],
  ): ReturnType<typeof provisionalRanking> {
    const weakHit = rankingWeak.get(standings);
    if (weakHit !== undefined) return weakHit;
    const digest = standingsDigest(standings.rows);
    const digestHit = rankingByDigest.get(digest);
    if (digestHit !== undefined) {
      rankingWeak.set(standings, digestHit);
      return digestHit;
    }
    const ranked = provisionalRanking(standings, league);
    rankingWeak.set(standings, ranked);
    rankingByDigest.set(digest, ranked);
    if (rankingByDigest.size > 4) {
      const oldest = rankingByDigest.keys().next().value;
      if (oldest !== undefined) rankingByDigest.delete(oldest);
    }
    return ranked;
  }
  const mastheadFacts = $derived.by(() => {
    const run = shell.run;
    const franchiseId = shell.humanFranchiseId;
    const manifest = shell.manifest;
    if (run === null || franchiseId === null || manifest === null) return null;
    const row = run.standings.rows.find((r) => r.franchiseId === franchiseId);
    if (row === undefined) return null;
    const ranked = memoizedRanking(run.standings, run.league).find(
      (entry) => entry.row.franchiseId === franchiseId,
    );
    if (run.stage === 'play-in' || run.stage === 'playoffs' || run.stage === 'completed') {
      const stageWord =
        run.stage === 'play-in' ? 'Play-In' : run.stage === 'playoffs' ? 'Playoffs' : 'Finals';
      return {
        franchiseId,
        record: recordLabel(row.wins, row.losses),
        position: ranked === undefined ? stageWord : `${ordinal(ranked.rank)} seed · ${stageWord}`,
      };
    }
    return {
      franchiseId,
      record: recordLabel(row.wins, row.losses),
      position: ranked === undefined ? '' : `${ordinal(ranked.rank)} in the ${ranked.conference}`,
    };
  });
  const seasonLoadError = $derived(shell.error ?? shell.hubError ?? null);
  const isHistoryRoute = $derived(routeId?.startsWith('/season/run/history') ?? false);
  const showBrokenResume = $derived(
    shell.ready &&
      seasonLoadError === null &&
      shell.hub !== null &&
      shell.snapshot === null &&
      shell.index !== null,
  );
  const showEmptyState = $derived(
    shell.ready &&
      seasonLoadError === null &&
      shell.hub !== null &&
      shell.snapshot === null &&
      shell.index === null &&
      !showBrokenResume &&
      !isHistoryRoute,
  );
</script>

<svelte:head>
  <title>Season Run · Hoop Rush</title>
  <meta name="theme-color" content="#0C1015" />
</svelte:head>

<div class="season-root">
  {#if seasonLoadError !== null || showBrokenResume}
    <div class="mx-auto mt-16 w-full max-w-xl px-4 sm:px-6">
      <div class="sr-panel sr-arrive p-6">
        <p class="sr-eyebrow">Season Run</p>
        <h1 class="sr-page-title mt-1">Season data unavailable</h1>
        <p class="mt-3 text-sm text-muted-foreground">
          {#if seasonLoadError !== null}
            {seasonLoadError.message}
          {:else}
            The saved season checkpoint is missing or incomplete. Restart to clear the broken save
            and start fresh.
          {/if}
        </p>
        {#if seasonLoadError !== null}
          <div class="sr-panel-quiet mt-4 p-3">
            <p class="sr-section-label">Diagnostic code</p>
            <code class="mt-1 block break-all text-xs text-foreground">{seasonLoadError.code}</code>
            {#if seasonLoadError.failures.length > 0}
              <details class="mt-3">
                <summary class="sr-section-label cursor-pointer"
                  >Validation details ({seasonLoadError.failures.length})</summary
                >

                <ul class="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  {#each seasonLoadError.failures as failure (failure)}
                    <li class="break-words">{failure}</li>
                  {/each}
                </ul>
              </details>
            {/if}
          </div>
        {/if}
        <div class="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onclick={() => (clearOpen = true)} class="sr-btn-danger"
            >Restart season</button
          >

          <a href={resolve('season/')} class="sr-btn-ghost">Back to Season setup</a>
        </div>
        {#if clearError !== null}
          <p class="mt-3 text-sm text-destructive" role="alert">{clearError}</p>
        {/if}
      </div>
    </div>
    <Dialog.Root bind:open={clearOpen}>
      <Dialog.Portal>
        <Dialog.Overlay class="sr-dialog-overlay" />
        <Dialog.Content class="sr-dialog w-[min(28rem,calc(100vw-2rem))] p-6">
          <Dialog.Title class="sr-page-title text-2xl">Restart season?</Dialog.Title>
          <Dialog.Description class="mt-2 text-sm text-muted-foreground">
            This permanently deletes your saved Season Run and any in-progress draft from this
            browser. You will start a new season from the setup screen.
          </Dialog.Description>
          <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close class="sr-btn-ghost">Cancel</Dialog.Close>
            <button
              type="button"
              onclick={() => void confirmClearSeasonData()}
              disabled={clearing}
              class="sr-btn-danger"
            >
              {clearing ? 'Restarting…' : 'Clear save and restart'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  {:else if !shell.ready}
    <div class="mx-auto mt-16 w-full max-w-xl px-4 sm:px-6">
      <div class="sr-panel p-6" aria-live="polite">
        <p class="sr-section-label">Loading your season…</p>
      </div>
    </div>
  {:else if showEmptyState}
    <div class="mx-auto mt-16 w-full max-w-xl px-4 sm:px-6">
      <div class="sr-panel p-6">
        <p class="sr-eyebrow">Season Run</p>
        <h1 class="sr-page-title mt-1">No active Season Run</h1>
        <p class="mt-3 text-sm text-muted-foreground">
          Create a franchise, draft ten players, and generate the league to open your command
          center.
        </p>
        <a href={resolve('season/')} class="sr-btn mt-5">Start a Season Run</a>
      </div>
    </div>
  {:else}
    <div class="mx-auto w-full min-w-0 overflow-x-clip sm:px-6 {shellWidthClass}">
      {#if shell.externalChange !== null}
        <div
          role="status"
          class="flex flex-wrap items-center justify-between gap-2 border-b border-warn/40 bg-warn/10 px-4 py-2.5 text-sm sm:rounded-b-xl"
          style="border-color: rgb(224 177 94 / 40%); background: rgb(224 177 94 / 8%)"
        >
          <span class="min-w-0 flex-1 font-medium" style="color: var(--sr-warn)">
            {shell.externalChange.message}
          </span>
          <span class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onclick={() => void shell.refresh()}
              class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold outline-none"
              style="border: 1px solid rgb(224 177 94 / 45%); color: var(--sr-warn)"
            >
              <RefreshCw class="h-3.5 w-3.5" />
              Reload season
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onclick={() => shell.acknowledgeExternalChange()}
              class="grid h-7 w-7 place-items-center rounded-lg outline-none"
              style="color: var(--sr-warn)"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </span>
        </div>
      {/if}
      <div class="px-3 pt-6 sm:px-0">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div class="min-w-0 flex-1">
            {#if mastheadFacts}
              <SeasonMasthead
                manifest={shell.manifest}
                franchiseId={mastheadFacts.franchiseId}
                recordLabel={mastheadFacts.record}
                positionLabel={mastheadFacts.position}
              />
            {/if}
          </div>
          <button
            type="button"
            onclick={() => (quitOpen = true)}
            disabled={quitting}
            class="sr-btn-ghost inline-flex w-fit shrink-0 px-3 py-2 text-xs"
          >
            <LogOut class="h-4 w-4 shrink-0" />
            Quit run
          </button>
        </div>
      </div>
      <nav aria-label="Season navigation" class="sr-nav-primary mt-5 hidden md:block">
        <div
          class="mx-auto flex min-w-max w-full items-center gap-1 px-4 sm:px-6 {shellWidthClass}"
        >
          {#each groups as group (group.id)}
            {@const groupActive = group.children.some((c) => isNavItemActive(c, routeId))}
            <a href={resolve(group.href as any)} aria-current={groupActive ? 'page' : undefined}>
              <group.icon class="h-4 w-4 shrink-0" />
              {group.label}
            </a>
          {/each}
        </div>
      </nav>
      {#if activeSubGroup !== null && activeSubGroup.children.length > 1}
        <div class="mx-auto hidden w-full px-4 sm:px-6 md:block {shellWidthClass}">
          <nav aria-label={`${activeSubGroup.label} sections`} class="sr-nav-sub">
            {#each activeSubGroup.children as child (child.id)}
              <a
                href={resolve(child.href as any)}
                aria-current={isNavItemActive(child, routeId) ? 'page' : undefined}
              >
                {child.label}
              </a>
            {/each}
          </nav>
        </div>
      {/if}
      <main class="min-w-0 overflow-x-clip pb-[max(6.5rem,env(safe-area-inset-bottom))] md:pb-14">
        <div class="mx-auto w-full px-3 sm:px-6 {shellWidthClass}">
          {@render children()}
        </div>
      </main>
    </div>
    <BottomNav items={mobilePrimary} overflowItems={mobileOverflow} label="Season navigation" />
    <Dialog.Root
      open={quitOpen}
      onOpenChange={(open) => {
        if (!open && !quitting) quitOpen = false;
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="sr-dialog-overlay" />
        <Dialog.Content class="sr-dialog w-[min(28rem,calc(100vw-2rem))] p-6">
          <div class="flex items-start justify-between gap-3">
            <Dialog.Title class="sr-page-title text-2xl">Quit this run?</Dialog.Title>
            <Dialog.Close
              aria-label="Cancel"
              class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-strong text-muted-foreground"
            >
              <X class="h-4 w-4" />
            </Dialog.Close>
          </div>
          <p class="mt-3 text-sm text-muted-foreground">
            Quitting ends this Season Run and deletes its progress from this browser. You can start
            a new Season Run from the Season setup screen.
          </p>
          {#if quitError}
            <p
              role="alert"
              class="mt-3 rounded-lg p-3 text-sm"
              style="border: 1px solid rgb(229 100 110 / 40%); background: rgb(229 100 110 / 10%); color: var(--sr-loss)"
            >
              {quitError}
            </p>
          {/if}
          <div class="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onclick={() => (quitOpen = false)}
              disabled={quitting}
              class="sr-btn-ghost"
            >
              Stay
            </button>
            <button
              type="button"
              onclick={() => void confirmQuit()}
              disabled={quitting}
              class="sr-btn-danger"
            >
              {quitting ? 'Quitting…' : 'Quit and delete'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  {/if}
</div>
