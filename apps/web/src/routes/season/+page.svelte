<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { HoopRushManifest, SeasonLeague, SeasonSchedule } from '@hoop-rush/data-contracts';
  import SeasonDraftBoard from '$lib/components/season/SeasonDraftBoard.svelte';
  import { SeasonDraftFlow, type SeasonDraftFlowState } from '$lib/season/season-draft-flow';
  import { buildVersionFaceIndex, type SeasonFaceRef } from '$lib/season/season-branding';
  import {
    loadSeasonDraftCatalog,
    loadSeasonLeague,
    loadSeasonRosterTargets,
    loadSeasonSchedule,
  } from '$lib/season/season-assets';
  import { getManifest, getPlayersIndex } from '$lib/data';
  import { DexieSeasonDraftRepository } from '@hoop-rush/persistence';
  import { getSeasonRunRepository } from '$lib/season/season-repo';
  import { seasonRootSeed } from '$lib/season/season-ids';
  import { buildSeasonRunFromGeneration, sha256Hex } from '$lib/season/season-run-builder';

  /**
   * Season Run setup (spec/2.0/03, spec/2.0/07, M2.3.5, season-draft-v2):
   * seeded franchise assignment, the ten-round snake draft with one
   * deterministic global eight-card offer per turn, coverage-safe selections,
   * draft resume, AI league generation progress, and promotion of the
   * completed draft to an active run. The board renders engine facts only;
   * every command flows through `SeasonDraftFlow` -> `applySeasonDraftCommand`.
   *
   * Stored records from older save-schema families (development saves) are
   * cleared automatically by the repository on load; the flow always resumes
   * from a current record or a fresh setup state.
   */

  let manifest = $state<HoopRushManifest | null>(null);
  let league = $state<SeasonLeague | null>(null);
  let schedule = $state<SeasonSchedule | null>(null);
  let assetsError: string | null = $state(null);
  let loaded = $state(false);
  let busy = $state(false);
  let board = $state<SeasonDraftFlowState | null>(null);
  let flow = $state.raw<SeasonDraftFlow | null>(null);
  let started = $state(false);
  let actionError = $state<string | null>(null);
  let generationError: string | null = $state(null);
  let promoting = $state(false);
  let promoteError: string | null = $state(null);
  let resumeHref: string | null = $state(null);
  let hasDraft = $state(false);
  let faces = $state<Map<string, SeasonFaceRef>>(new Map());

  $effect(() => {
    if (!browser) return;
    let cancelled = false;
    Promise.all([
      getManifest(),
      loadSeasonLeague(),
      loadSeasonDraftCatalog(),
      loadSeasonSchedule(),
      loadSeasonRosterTargets(),
      getPlayersIndex(),
    ])
      .then(async ([m, seasonLeague, catalog, seasonSchedule, rosterTargets, playersIndex]) => {
        if (cancelled) return;
        manifest = m;
        league = seasonLeague;
        schedule = seasonSchedule;
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
        flow = new SeasonDraftFlow(new DexieSeasonDraftRepository(), catalog, rosterTargets);
        flow.onPhaseChange = () => {
          if (flow !== null) board = flow.state();
        };
        board = flow.state();
        hasDraft = await flow.load();
        board = flow.state();
        // An active run takes precedence over the draft board.
        try {
          const repo = await getSeasonRunRepository();
          const index = await repo.loadActiveRunIndex();
          if (!cancelled && index) {
            resumeHref = resolve('/season/run');
          }
        } catch {
          // Persistence is best-effort on setup; the board still works.
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

  const franchiseName = (franchiseId: string): string =>
    manifest?.modernFranchiseSlots.find((slot) => slot.franchiseId === franchiseId)?.displayName ??
    franchiseId;

  async function startDraft() {
    if (!flow || !league) return;
    busy = true;
    actionError = null;
    try {
      const record = await flow.create({ rootSeed: seasonRootSeed(), league });
      if (record.status === 'rejected') {
        actionError = record.message;
      } else {
        started = true;
      }
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      board = flow.state();
      busy = false;
    }
  }

  async function runCommand(command: () => Promise<{ status: string }>) {
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
    if (!flow) return;
    busy = true;
    actionError = null;
    generationError = null;
    try {
      const generation = await flow.generate();
      if (generation === null && flow.error !== null) {
        generationError = flow.error;
      }
    } catch (error) {
      generationError = flow.error ?? (error instanceof Error ? error.message : String(error));
    } finally {
      board = flow.state();
      busy = false;
    }
  }

  /**
   * Promotes the completed draft to an active run (atomic in the repo).
   */
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
      await repo.promoteSeasonDraftToRun(stored, run);
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
</script>

<svelte:head>
  <title>Season Run — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full min-w-0 max-w-6xl overflow-x-hidden py-6 sm:px-6 sm:py-10">
  <div class="flex flex-col gap-3 px-3 sm:flex-row sm:items-end sm:justify-between sm:px-0">
    <div class="min-w-0">
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Season Run · 2.0</p>
      <h1
        class="font-display mt-2 text-2xl font-extrabold tracking-tight break-words uppercase sm:text-3xl md:text-4xl lg:text-5xl"
      >
        Ten rounds. One league.
      </h1>
      {#if !(started && board?.draft)}
        <p class="mt-3 max-w-xl text-sm text-muted-foreground">
          Your franchise is rolled from the run seed. Each round draws eight global player-season
          cards; safe picks keep the 4G/4F/3C completion targets reachable, and disabled cards say
          why.
        </p>
      {/if}
    </div>
    <a
      href={resolve('/')}
      class="shrink-0 self-start font-mono text-xs text-muted-foreground underline-offset-4 hover:underline sm:self-auto"
    >
      Back
    </a>
  </div>

  {#if assetsError}
    <p
      class="mt-8 mx-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm sm:mx-0"
    >
      Failed to load season data: {assetsError}
    </p>
  {:else if !loaded}
    <p class="mt-8 px-3 font-mono text-sm text-muted-foreground sm:px-0">Loading season data…</p>
  {:else if resumeHref}
    <div class="mt-10 rounded-none bg-surface-1 sm:rounded-xl p-6">
      <h2 class="font-display text-xl font-extrabold uppercase tracking-tight">
        An active season run exists
      </h2>
      <p class="mt-2 text-sm text-muted-foreground">
        Resuming returns to the season hub at the last accepted checkpoint.
      </p>
      <a
        href={resolve('/season/run')}
        class="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
      >
        Resume season
      </a>
    </div>
  {:else if hasDraft && !started && board?.draft}
    <div class="mt-10 rounded-none bg-surface-1 sm:rounded-xl p-6">
      <h2 class="font-display text-xl font-extrabold uppercase tracking-tight">
        Draft in progress
      </h2>
      <p class="mt-2 text-sm text-muted-foreground">
        A saved draft is waiting: {board.draft.picks.length} of 10 picks, round {board.draft.round}.
      </p>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onclick={() => (started = true)}
          class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
        >
          Resume draft
        </button>
        <button
          type="button"
          onclick={discardDraft}
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-5 py-3 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
        >
          Discard and start over
        </button>
      </div>
    </div>
  {:else if !started || !board?.draft}
    <div class="mt-10 flex flex-col gap-6">
      <div class="rounded-none bg-surface-1 sm:rounded-xl p-6">
        <h2 class="font-display text-xl font-extrabold uppercase tracking-tight">
          Start a Season Run
        </h2>
        <p class="mt-2 max-w-xl text-sm text-muted-foreground">
          A fresh run seed rolls your franchise and the first pick. The draft, offers, and picks
          persist to this browser, so reload resumes the exact board.
        </p>
        <button
          type="button"
          onclick={startDraft}
          disabled={busy}
          class="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start draft
        </button>
        {#if actionError}
          <p
            role="alert"
            class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            {actionError}
          </p>
        {/if}
      </div>

      {#if league && manifest}
        <section
          aria-labelledby="season-league-heading"
          class="rounded-none bg-surface-1 sm:rounded-xl p-6"
        >
          <h2
            id="season-league-heading"
            class="font-display text-base font-extrabold uppercase tracking-tight"
          >
            The league
          </h2>
          <p class="mt-2 text-sm text-muted-foreground">
            30 franchises · 82 rounds · nine ten-game blocks plus a final two-game block. One
            franchise is yours; the rest are AI-controlled across four strength bands.
          </p>
          <p class="mt-2 font-mono text-[10px] text-muted-foreground">
            {league.teams.filter((t) => t.control === 'human').length} human franchise ·
            {league.teams.filter((t) => t.control === 'ai').length} AI franchises
          </p>
        </section>
      {/if}
    </div>
  {:else if board.draft?.status === 'drafting' || board.draft?.status === 'finalized'}
    <div class="mt-8 flex flex-col gap-6 pb-[max(6rem,env(safe-area-inset-bottom))] sm:mt-10">
      {#if flow && manifest && board.draft}
        <div class="rounded-none bg-surface-1 sm:rounded-xl px-4 py-3">
          <p class="font-mono text-[10px] break-words text-muted-foreground">
            Your franchise:
            <span class="font-bold text-foreground">
              {franchiseName(board.draft.participants[0]?.franchiseId ?? '—')}
            </span>
            · seed {board.draft.rootSeed.slice(0, 12)}…
          </p>
        </div>
        <SeasonDraftBoard
          flow={board}
          {manifest}
          {faces}
          catalog={flow.catalog}
          {busy}
          error={actionError}
          {onDraw}
          {onPick}
          {onFinalize}
        />
      {/if}
      {#if board.draft?.status === 'finalized'}
        <div class="rounded-none bg-surface-1 sm:rounded-xl p-6">
          <h2 class="font-display text-base font-extrabold uppercase tracking-tight">
            Generate the AI league
          </h2>
          <p class="mt-2 text-sm text-muted-foreground">
            The engine fills the remaining 29 rosters deterministically from the run seed,
            respecting strength bands, role coverage, and legality.
          </p>
          <button
            type="button"
            onclick={generateLeague}
            disabled={busy || promoting}
            class="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {board.phase === 'generating' ? 'Generating…' : 'Generate AI league'}
          </button>
          {#if board.phase === 'generating'}
            <p class="mt-3 font-mono text-xs text-muted-foreground">
              Bounded deterministic generation — running off the main thread so the board stays
              responsive.
            </p>
          {/if}
          {#if generationError}
            <div
              role="alert"
              class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
            >
              <p class="font-semibold">Generation exhausted</p>
              <p class="mt-1 text-muted-foreground">{generationError}</p>
              <p class="mt-1 font-mono text-[10px] text-muted-foreground">
                The engine never relaxes a legality rule; a different seed may succeed.
              </p>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {:else if board.draft?.status === 'complete' && board.generation}
    <div class="mt-10 flex max-w-2xl flex-col gap-6 pb-32">
      <div class="rounded-none bg-surface-1 sm:rounded-xl p-6">
        <h2 class="font-display text-xl font-extrabold uppercase tracking-tight">
          League generated
        </h2>
        <p class="mt-2 text-sm text-muted-foreground">
          30 rosters, 300 unique player versions, and 30 legal rotations are ready. Promoting moves
          the draft into an active run and opens the season hub.
        </p>
        <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div class="rounded-lg bg-surface-2 p-3">
            <dt class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Teams
            </dt>
            <dd class="font-display text-lg font-extrabold">
              {board.generation.diagnostics.teamsGenerated}
            </dd>
          </div>
          <div class="rounded-lg bg-surface-2 p-3">
            <dt class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Repairs
            </dt>
            <dd class="font-display text-lg font-extrabold">
              {board.generation.diagnostics.teamsRepaired}
            </dd>
          </div>
          <div class="rounded-lg bg-surface-2 p-3">
            <dt class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Backtracks
            </dt>
            <dd class="font-display text-lg font-extrabold">
              {board.generation.diagnostics.backtracks}
            </dd>
          </div>
          <div class="rounded-lg bg-surface-2 p-3">
            <dt class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Nodes
            </dt>
            <dd class="font-display text-lg font-extrabold">
              {board.generation.diagnostics.nodesVisited}
            </dd>
          </div>
        </dl>
        <button
          type="button"
          onclick={promote}
          disabled={promoting}
          class="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {promoting ? 'Promoting…' : 'Open the league hub'}
        </button>
        {#if promoteError}
          <div
            role="alert"
            class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            <p class="font-semibold">Could not promote the draft</p>
            <p class="mt-1 text-muted-foreground">{promoteError}</p>
            <p class="mt-1 font-mono text-[10px] text-muted-foreground">
              The draft record stays intact; retry promotion.
            </p>
          </div>
        {/if}
      </div>
      <p class="font-mono text-[10px] text-muted-foreground">
        seed {board.draft.rootSeed} · generation digest {board.generation.digest}
      </p>
    </div>
  {/if}
</section>
