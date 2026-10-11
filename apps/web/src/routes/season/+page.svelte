<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Dialog } from 'bits-ui';
  import '$lib/season/season-theme.css';
  import type {
    HoopRushManifest,
    PlayersIndex,
    SeasonDraftCatalog,
    SeasonLeague,
    SeasonRosterTargets,
    SeasonRun,
    SeasonSchedule,
  } from '@hoop-rush/data-contracts';
  import type { SeasonRunPlayerSliceEntry } from '@hoop-rush/persistence';
  import SeasonDraftBoard from '$lib/components/season/SeasonDraftBoard.svelte';
  import FrontOfficePicker from '$lib/components/season/FrontOfficePicker.svelte';
  import LeagueGenerationArena from '$lib/components/season/LeagueGenerationArena.svelte';
  import type {
    SeasonDraftFlow,
    SeasonDraftFlowState,
    SeasonDraftGenerationProgress,
  } from '$lib/season/season-draft-flow';
  import {
    draftStageOf,
    humanizeDraftError,
    humanizeDraftGenerationError,
  } from '$lib/season/season-draft-flow';
  import { buildVersionFaceIndex, type SeasonFaceRef } from '$lib/season/season-branding';
  import {
    loadSeasonDraftCatalog,
    loadSeasonLeague,
    loadSeasonRosterTargets,
    loadSeasonSchedule,
  } from '$lib/season/season-assets';
  import { getManifest } from '$lib/data';
  import { DexieSeasonDraftRepository } from '@hoop-rush/persistence';
  import { getSeasonRunRepository } from '$lib/season/season-repo';
  import { clearAllSeasonData } from '$lib/season/season-data-recovery';
  import { seasonRootSeed } from '$lib/ids';
  import { buildSeasonRunFromGeneration, sha256Hex } from '$lib/season/season-run-builder';
  let manifest = $state<HoopRushManifest | null>(null);
  let league = $state<SeasonLeague | null>(null);
  let schedule = $state<SeasonSchedule | null>(null);
  let playersIndex = $state.raw<PlayersIndex | null>(null);
  let assetsError: string | null = $state(null);
  let loaded = $state(false);
  let busy = $state(false);
  let board = $state<SeasonDraftFlowState | null>(null);
  let flow = $state.raw<SeasonDraftFlow | null>(null);
  let started = $state(false);
  let actionError = $state<string | null>(null);
  let generationError: string | null = $state(null);
  let generationProgress = $state<SeasonDraftGenerationProgress | null>(null);
  let generationReveal = $state(false);
  let promoting = $state(false);
  let promoteError: string | null = $state(null);
  let resumeHref: string | null = $state(null);
  let brokenRunError: string | null = $state(null);
  let hasDraft = $state(false);
  let executiveId = $state<import('@hoop-rush/data-contracts').SeasonFrontOfficeId | null>(null);
  let faces = $state<Map<string, SeasonFaceRef>>(new Map());
  let clearOpen = $state(false);
  let clearing = $state(false);
  let clearError: string | null = $state(null);
  async function confirmClearSeasonData(): Promise<void> {
    if (clearing) return;
    clearing = true;
    clearError = null;
    try {
      await clearAllSeasonData();
      clearOpen = false;
      resumeHref = null;
      brokenRunError = null;
      if (flow !== null) {
        hasDraft = false;
        started = false;
        board = flow.state();
      }
    } catch (error) {
      clearError = error instanceof Error ? error.message : String(error);
    } finally {
      clearing = false;
    }
  }
  $effect(() => {
    if (!browser) return;
    let cancelled = false;
    Promise.all([getManifest(), loadSeasonLeague(), loadSeasonSchedule()])
      .then(async ([m, seasonLeague, seasonSchedule]) => {
        if (cancelled) return;
        manifest = m;
        league = seasonLeague;
        schedule = seasonSchedule;
        const draftRepo = new DexieSeasonDraftRepository();
        let storedDraft: Awaited<ReturnType<DexieSeasonDraftRepository['loadSeasonDraft']>> = null;
        try {
          storedDraft = await draftRepo.loadSeasonDraft();
        } catch (error) {
          brokenRunError =
            error instanceof Error ? error.message : 'The saved season draft could not be loaded.';
        }
        if (cancelled) return;
        if (storedDraft !== null) {
          const rosterTargets = await loadSeasonRosterTargets();
          if (cancelled) return;
          await ensureFlow(rosterTargets);
          if (cancelled) return;
          if (flow !== null) {
            hasDraft = await flow.load();
            board = flow.state();
            const savedExecutive = board.draft?.frontOffice?.executiveId ?? null;
            if (savedExecutive !== null) executiveId = savedExecutive;
            if (board.draft !== null) started = true;
          }
        } else {
          hasDraft = false;
        }
        try {
          const repo = await getSeasonRunRepository(seasonSchedule);
          const index = await repo.loadActiveRunIndex();
          if (!cancelled && index) {
            try {
              const snapshot = await repo.loadActiveRun();
              if (snapshot !== null) {
                resumeHref = resolve('/season/run');
              } else {
                brokenRunError =
                  'A saved season was found but its checkpoint is missing. Restart to clear the broken save and start fresh.';
              }
            } catch (error) {
              brokenRunError =
                error instanceof Error ? error.message : 'The saved season could not be loaded.';
            }
          }
        } catch (error) {
          if (!cancelled) {
            brokenRunError =
              error instanceof Error ? error.message : 'The saved season could not be loaded.';
          }
        }
        loaded = true;
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          assetsError = error instanceof Error ? error.message : String(error);
          loaded = true;
        }
      });
    return () => {
      cancelled = true;
    };
  });
  async function ensureFlow(rosterTargets?: SeasonRosterTargets): Promise<SeasonDraftFlow | null> {
    if (flow !== null) return flow;
    const catalog = await loadSeasonDraftCatalog();
    const targets = rosterTargets ?? (await loadSeasonRosterTargets());
    const { SeasonDraftFlow } = await import('$lib/season/season-draft-flow');
    const instance = new SeasonDraftFlow(new DexieSeasonDraftRepository(), catalog, targets);
    instance.onPhaseChange = () => {
      if (flow !== null) board = flow.state();
    };
    instance.onGenerationProgress = () => {
      generationProgress = instance.generationProgress;
      if (flow !== null) board = flow.state();
    };
    if (playersIndex === null) {
      const { getPlayersIndex } = await import('$lib/data');
      playersIndex = await getPlayersIndex();
    }
    faces = buildVersionFaceIndex(
      playersIndex.players,
      catalog.candidates.map((candidate) => ({
        playerVersionId: candidate.playerVersionId,
        playerId: candidate.playerId,
        franchiseId: candidate.franchiseId,
        eraId: candidate.eraId,
        seasonKey: candidate.seasonKey,
        displayName: candidate.displayName,
      })),
    );
    flow = instance;
    return instance;
  }
  const draftStatus = $derived(
    board?.draft?.status === 'drafting' ||
      board?.draft?.status === 'finalized' ||
      board?.draft?.status === 'complete'
      ? board.draft.status
      : ('none' as const),
  );
  const draftStage = $derived(
    draftStageOf({
      draftStatus,
      phase: board?.phase ?? 'idle',
      generationError,
      hasGeneration: board?.generation != null,
    }),
  );
  const friendlyActionError = $derived(
    actionError === null ? null : humanizeDraftError(actionError),
  );
  const friendlyGenerationError = $derived(
    generationError === null ? null : humanizeDraftGenerationError(generationError),
  );
  async function resumeDraft(): Promise<void> {
    if (board?.draft?.frontOffice == null) {
      if (executiveId === null || flow === null) return;
      busy = true;
      actionError = null;
      try {
        const record = await flow.selectFrontOffice(executiveId);
        if (record.status === 'rejected') {
          actionError = flow.error ?? 'The draft rejected the front office choice.';
          return;
        }
        board = flow.state();
      } catch (error) {
        actionError = error instanceof Error ? error.message : String(error);
        return;
      } finally {
        busy = false;
      }
    }
    started = true;
  }
  async function startDraft() {
    if (!league) return;
    if (executiveId === null) {
      actionError = 'Choose a front office first — the executive sticks for the whole run.';
      return;
    }
    busy = true;
    actionError = null;
    try {
      const instance = await ensureFlow();
      if (instance === null) return;
      const record = await instance.create({ rootSeed: seasonRootSeed(), league });
      if (record.status === 'rejected') {
        actionError = record.message;
      } else {
        const fo = await instance.selectFrontOffice(executiveId);
        if (fo.status === 'rejected') {
          actionError = instance.error ?? 'The draft rejected the front office choice.';
        } else {
          started = true;
        }
      }
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      if (flow !== null) board = flow.state();
      busy = false;
    }
  }
  async function runCommand(
    command: () => Promise<{
      status: string;
    }>,
  ) {
    if (!flow) return;
    busy = true;
    actionError = null;
    generationError = null;
    try {
      const record = await command();
      if (record.status === 'rejected') {
        actionError = flow.error ?? 'The draft rejected that action.';
      }
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      board = flow.state();
      busy = false;
    }
  }
  function onDraw() {
    void runCommand(() => flow!.draw());
  }
  function onPick(playerVersionId: string) {
    void runCommand(() => flow!.pick('human', playerVersionId));
  }
  function onFinalize() {
    void runCommand(() => flow!.finalize());
  }
  async function generateLeague() {
    if (!flow || busy) return;
    busy = true;
    generationReveal = true;
    actionError = null;
    generationError = null;
    generationProgress = flow.generationProgress;
    const anticipation = new Promise<void>((done) =>
      setTimeout(done, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 2400),
    );
    try {
      const generation = await flow.generate();
      if (generation !== null) await anticipation;
      if (generation === null && flow.error !== null) {
        generationError = flow.error;
      }
    } catch (error) {
      generationError = flow.error ?? (error instanceof Error ? error.message : String(error));
    } finally {
      generationReveal = false;
      board = flow.state();
      busy = false;
    }
  }
  async function promote() {
    if (!flow || !flow.draft || !flow.generation || !schedule) return;
    promoting = true;
    promoteError = null;
    try {
      const repo = await getSeasonRunRepository();
      const draftRepo = new DexieSeasonDraftRepository();
      const stored = await draftRepo.loadSeasonDraft();
      if (!stored) throw new Error('The completed draft record is missing.');
      const scheduleContentHash =
        (await sha256Hex(`${JSON.stringify(schedule)}\n`)) ??
        manifest?.season?.schedule?.contentHash;
      if (!scheduleContentHash) {
        throw new Error('Unable to determine the schedule content hash.');
      }
      const run = buildSeasonRunFromGeneration({
        runId: flow.draft.runId,
        rootSeed: flow.draft.rootSeed,
        league: flow.draft.league,
        schedule,
        scheduleContentHash,
        draft: flow.draft,
        generation: flow.generation,
      });
      const slice = buildPlayerSlice(run, flow.catalog);
      await repo.promoteSeasonDraftToRun(stored, run, slice);
      await goto(resolve('/season/run'));
    } catch (error) {
      promoteError = error instanceof Error ? error.message : String(error);
    } finally {
      promoting = false;
    }
  }
  async function discardDraft() {
    if (!flow) return;
    busy = true;
    try {
      await flow.clear();
      started = false;
      hasDraft = false;
      board = flow.state();
    } finally {
      busy = false;
    }
  }
  function buildPlayerSlice(
    run: SeasonRun,
    catalog: SeasonDraftCatalog,
  ): SeasonRunPlayerSliceEntry[] {
    const byVersion = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
    const entries: SeasonRunPlayerSliceEntry[] = [];
    for (const roster of run.rosters) {
      for (const entry of roster.players) {
        const candidate = byVersion.get(entry.playerVersionId);
        if (candidate === undefined) continue;
        entries.push({
          playerVersionId: entry.playerVersionId,
          playerId: entry.playerId,
          franchiseId: entry.franchiseId,
          eraId: entry.eraId,
          seasonKey: entry.seasonKey,
          displayName: entry.displayName,
          positionsPlayable: [...candidate.positions.playable],
          summaryRatings: { ...candidate.summaryRatings },
          staminaRating: candidate.stamina.rating,
          durabilityRating: candidate.durability.rating,
        });
      }
    }
    return entries;
  }
</script>

<svelte:head>
  <title>Season Run — Hoop Rush</title>
</svelte:head>

<div class="season-root min-h-[100svh]">
  <section class="mx-auto w-full min-w-0 max-w-6xl overflow-x-clip px-3 py-6 sm:px-6 sm:py-10">
    <header class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <p class="sr-eyebrow">Season Run</p>
        <h1 class="sr-page-title sr-arrive mt-2 break-words">Draft 10. Coach 82.</h1>
        <p class="mt-3 max-w-xl text-xs text-muted-foreground">
          Choose an executive, then build your roster.
        </p>
        <p class="mt-1 font-mono text-[11px] tracking-wide text-muted-foreground">
          30 teams • 82 games • 10-player roster • 1 champion
        </p>
      </div>
      {#if draftStage !== 'executive'}
        <a
          href={resolve('/')}
          class="sr-eyebrow shrink-0 self-start underline-offset-4 hover:underline sm:self-auto"
        >
          ← Back
        </a>
      {/if}
    </header>

    {#if assetsError}
      <div class="sr-panel-quiet mt-8 p-4" role="alert">
        <span class="sr-badge" data-tone="loss">Data error</span>
        <p class="mt-2 text-xs text-muted-foreground">Failed to load season data: {assetsError}</p>
      </div>
    {:else if !loaded}
      <p class="sr-section-label mt-8">
        <span class="sr-live-dot mr-2 inline-block h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true"></span>
        Loading your season…
      </p>
    {:else if brokenRunError}
      <div class="sr-panel-quiet mt-10 p-6">
        <p class="sr-eyebrow">Save error</p>
        <h2 class="font-display mt-2 text-xl font-extrabold uppercase tracking-tight">
          Saved season could not load
        </h2>
        <p class="mt-2 text-xs text-muted-foreground">{brokenRunError}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" onclick={() => (clearOpen = true)} class="sr-btn-danger">
            Restart season
          </button>
        </div>
        {#if clearError}
          <p role="alert" class="mt-3 text-xs text-destructive">{clearError}</p>
        {/if}
      </div>
    {:else if resumeHref}
      <div class="sr-panel-featured mt-10 p-6">
        <p class="sr-eyebrow">Welcome back</p>
        <h2 class="font-display mt-2 text-xl font-extrabold uppercase tracking-tight">
          Back to your season
        </h2>
        <p class="mt-2 text-xs text-muted-foreground">Pick up right where you left off.</p>
        <a href={resolve('/season/run')} class="sr-btn mt-4">Continue season</a>
      </div>
    {:else if draftStage === 'executive'}
      <div class="mx-auto mt-6 flex w-full max-w-3xl flex-col pb-10">
        <div class="sr-panel sr-arrive p-6">
          <p class="sr-eyebrow">Front office</p>
          <h2 class="font-display mt-2 text-xl font-extrabold uppercase tracking-tight">
            Pick your executive
          </h2>
          <p class="mt-2 max-w-xl text-xs text-muted-foreground">
            Choose one for the season. Their ability and drawback affect your run.
          </p>
          <div class="mt-5">
            <FrontOfficePicker
              value={executiveId}
              disabled={busy}
              onChange={(id) => (executiveId = id)}
            />
          </div>
          <div class="mt-6 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
            <a
              href={resolve('/')}
              class="inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-3 text-xs font-semibold text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
            >
              ← Back
            </a>
            <button type="button" onclick={startDraft} disabled={busy || executiveId === null} class="sr-btn">
              {busy ? 'Starting…' : 'Start draft →'}
            </button>
          </div>
          {#if friendlyActionError}
            <p role="alert" class="sr-panel-quiet mt-3 p-3">
              <span class="sr-badge" data-tone="loss">Rejected</span>
              <span class="mt-2 block text-xs text-muted-foreground">{friendlyActionError}</span>
            </p>
          {/if}
        </div>
      </div>
    {:else if generationReveal}
      <LeagueGenerationArena progress={generationProgress} {league} />
    {:else if draftStage === 'drafting' || draftStage === 'ready'}
      <div class="mx-auto mt-6 flex w-full max-w-4xl flex-col gap-4 pb-[max(6rem,env(safe-area-inset-bottom))] sm:mt-8">
        {#if flow && manifest && board?.draft}
          <SeasonDraftBoard
            flow={board}
            {manifest}
            {faces}
            catalog={flow.catalog}
            {busy}
            error={friendlyActionError}
            {onDraw}
            {onPick}
            {onFinalize}
          />
        {/if}
        {#if draftStage === 'ready'}
          <div class="sr-panel-quiet p-6">
            <p class="sr-eyebrow">Next step</p>
            <h2 class="font-display mt-1 text-base font-extrabold uppercase tracking-tight">
              Build the league
            </h2>
            <p class="mt-2 text-xs text-muted-foreground">Fill the other 29 teams, then play.</p>
            <button
              type="button"
              onclick={generateLeague}
              disabled={busy || promoting}
              class="sr-btn mt-4"
            >
              Build league
            </button>
          </div>
        {/if}
      </div>
    {:else if draftStage === 'generating'}
      <LeagueGenerationArena progress={generationProgress} {league} />
    {:else if draftStage === 'stalled'}
      <div class="sr-panel-quiet mt-10 p-6">
        <p class="sr-eyebrow">Generation paused</p>
        <h2 class="font-display mt-2 text-xl font-extrabold uppercase tracking-tight">
          League setup hit a snag
        </h2>
        <p class="mt-2 text-xs text-muted-foreground">{friendlyGenerationError}</p>
        <p class="mt-1 text-xs text-muted-foreground">Your draft is saved.</p>
        <button type="button" onclick={generateLeague} disabled={busy} class="sr-btn mt-4">
          Retry
        </button>
      </div>
    {:else if draftStage === 'complete'}
      <div class="mt-10 flex max-w-2xl flex-col gap-6 pb-32">
        <div class="sr-panel-featured sr-arrive p-6">
          <p class="sr-eyebrow">Draft complete</p>
          <h2 class="font-display mt-1 text-xl font-extrabold uppercase tracking-tight">
            League ready
          </h2>
          <p class="mt-2 text-xs text-muted-foreground">Your 10 are set. Time to play 82.</p>
          <button type="button" onclick={promote} disabled={promoting} class="sr-btn mt-5">
            {promoting ? 'Starting…' : 'Start season'}
          </button>
          {#if promoteError}
            <div role="alert" class="sr-panel-quiet mt-3 p-3">
              <p class="font-semibold">Couldn’t start the season</p>
              <p class="mt-1 text-muted-foreground">{promoteError}</p>
              <p class="mt-1 text-xs text-muted-foreground">Your draft is saved — try again.</p>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </section>

  <Dialog.Root bind:open={clearOpen}>
    <Dialog.Content class="sr-dialog w-[calc(100vw-2rem)] max-w-md p-6">
      <Dialog.Title class="font-display text-2xl font-extrabold tracking-tight uppercase">
        Restart season?
      </Dialog.Title>
      <Dialog.Description class="mt-1 text-sm text-muted-foreground">
        This permanently deletes your saved Season Run and any in-progress draft from this browser.
        You will start a new season from the setup screen.
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
  </Dialog.Root>
</div>
