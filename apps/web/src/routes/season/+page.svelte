<script lang="ts">import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { Dialog } from 'bits-ui';
import type { HoopRushManifest, PlayersIndex, SeasonDraftCatalog, SeasonLeague, SeasonRosterTargets, SeasonRun, SeasonSchedule, } from '@hoop-rush/data-contracts';
import type { SeasonRunPlayerSliceEntry } from '@hoop-rush/persistence';
import SeasonDraftBoard from '$lib/components/season/SeasonDraftBoard.svelte';
import type { SeasonDraftFlow, SeasonDraftFlowState } from '$lib/season/season-draft-flow';
import { buildVersionFaceIndex, type SeasonFaceRef } from '$lib/season/season-branding';
import { loadSeasonDraftCatalog, loadSeasonLeague, loadSeasonRosterTargets, loadSeasonSchedule, } from '$lib/season/season-assets';
import { getManifest, getPlayersIndex } from '$lib/data';
import { DexieSeasonDraftRepository } from '@hoop-rush/persistence';
import { isSeasonRunIncompatibleError } from '@hoop-rush/persistence';
import { getSeasonRunRepository } from '$lib/season/season-repo';
import { clearAllSeasonData } from '$lib/season/season-data-recovery';
import { seasonRootSeed } from '$lib/season/season-ids';
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
let promoting = $state(false);
let promoteError: string | null = $state(null);
let resumeHref: string | null = $state(null);
let brokenRunError: string | null = $state(null);
let hasDraft = $state(false);
let faces = $state<Map<string, SeasonFaceRef>>(new Map());
let clearOpen = $state(false);
let clearing = $state(false);
let clearError: string | null = $state(null);
async function confirmClearSeasonData(): Promise<void> {
    if (clearing)
        return;
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
    }
    catch (error) {
        clearError = error instanceof Error ? error.message : String(error);
    }
    finally {
        clearing = false;
    }
}
$effect(() => {
    if (!browser)
        return;
    let cancelled = false;
    Promise.all([
        getManifest(),
        loadSeasonLeague(),
        loadSeasonSchedule(),
        loadSeasonRosterTargets(),
        getPlayersIndex(),
    ])
        .then(async ([m, seasonLeague, seasonSchedule, rosterTargets, ix]) => {
        if (cancelled)
            return;
        manifest = m;
        league = seasonLeague;
        schedule = seasonSchedule;
        playersIndex = ix;
        const draftRepo = new DexieSeasonDraftRepository();
        const storedDraft = await draftRepo.loadSeasonDraft();
        if (cancelled)
            return;
        if (storedDraft !== null) {
            await ensureFlow(rosterTargets);
            if (cancelled)
                return;
            if (flow !== null) {
                hasDraft = await flow.load();
                board = flow.state();
            }
        }
        else {
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
                    }
                    else {
                        brokenRunError =
                            'A saved season was found but its checkpoint is missing. Clear the broken save to start over.';
                    }
                }
                catch (error) {
                    if (isSeasonRunIncompatibleError(error)) {
                        resumeHref = resolve('/season/run');
                    }
                    else {
                        brokenRunError =
                            error instanceof Error ? error.message : 'The saved season could not be loaded.';
                    }
                }
            }
        }
        catch { }
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
    if (flow !== null)
        return flow;
    const catalog = await loadSeasonDraftCatalog();
    const targets = rosterTargets ?? (await loadSeasonRosterTargets());
    const { SeasonDraftFlow } = await import('$lib/season/season-draft-flow');
    const instance = new SeasonDraftFlow(new DexieSeasonDraftRepository(), catalog, targets);
    instance.onPhaseChange = () => {
        if (flow !== null)
            board = flow.state();
    };
    if (playersIndex !== null) {
        faces = buildVersionFaceIndex(playersIndex.players, catalog.candidates.map((candidate) => ({
            playerVersionId: candidate.playerVersionId,
            playerId: candidate.playerId,
            franchiseId: candidate.franchiseId,
            eraId: candidate.eraId,
            seasonKey: candidate.seasonKey,
            displayName: candidate.displayName,
        })));
    }
    flow = instance;
    return instance;
}
const franchiseName = (franchiseId: string): string => manifest?.modernFranchiseSlots.find((slot) => slot.franchiseId === franchiseId)?.displayName ??
    franchiseId;
async function startDraft() {
    if (!league)
        return;
    busy = true;
    actionError = null;
    try {
        const instance = await ensureFlow();
        if (instance === null)
            return;
        const record = await instance.create({ rootSeed: seasonRootSeed(), league });
        if (record.status === 'rejected') {
            actionError = record.message;
        }
        else {
            started = true;
        }
    }
    catch (error) {
        actionError = error instanceof Error ? error.message : String(error);
    }
    finally {
        if (flow !== null)
            board = flow.state();
        busy = false;
    }
}
async function runCommand(command: () => Promise<{
    status: string;
}>) {
    if (!flow)
        return;
    busy = true;
    actionError = null;
    generationError = null;
    try {
        const record = await command();
        if (record.status === 'rejected') {
            actionError = flow.error ?? 'The draft rejected that action.';
        }
    }
    catch (error) {
        actionError = error instanceof Error ? error.message : String(error);
    }
    finally {
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
    if (!flow)
        return;
    busy = true;
    actionError = null;
    generationError = null;
    try {
        const generation = await flow.generate();
        if (generation === null && flow.error !== null) {
            generationError = flow.error;
        }
    }
    catch (error) {
        generationError = flow.error ?? (error instanceof Error ? error.message : String(error));
    }
    finally {
        board = flow.state();
        busy = false;
    }
}
async function promote() {
    if (!flow || !flow.draft || !flow.generation || !schedule)
        return;
    promoting = true;
    promoteError = null;
    try {
        const repo = await getSeasonRunRepository();
        const draftRepo = new DexieSeasonDraftRepository();
        const stored = await draftRepo.loadSeasonDraft();
        if (!stored)
            throw new Error('The completed draft record is missing.');
        const scheduleContentHash = (await sha256Hex(`${JSON.stringify(schedule)}\n`)) ??
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
    }
    catch (error) {
        promoteError = error instanceof Error ? error.message : String(error);
    }
    finally {
        promoting = false;
    }
}
async function discardDraft() {
    if (!flow)
        return;
    busy = true;
    try {
        await flow.clear();
        started = false;
        hasDraft = false;
        board = flow.state();
    }
    finally {
        busy = false;
    }
}
function buildPlayerSlice(run: SeasonRun, catalog: SeasonDraftCatalog): SeasonRunPlayerSliceEntry[] {
    const byVersion = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
    const entries: SeasonRunPlayerSliceEntry[] = [];
    for (const roster of run.rosters) {
        for (const entry of roster.players) {
            const candidate = byVersion.get(entry.playerVersionId);
            if (candidate === undefined)
                continue;
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

<section class="mx-auto w-full min-w-0 max-w-6xl overflow-x-clip py-6 sm:px-6 sm:py-10">
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
          Your franchise is picked at random. Each round draws eight player cards; safe picks keep
          the 4 PG/SG / 4 SF/PF / 3 C lineup targets reachable, and disabled cards say why.
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
  {:else if brokenRunError}
    <div class="mt-10 rounded-none bg-surface-1 sm:rounded-xl p-6">
      <h2 class="font-display text-xl font-extrabold uppercase tracking-tight">
        Saved season could not load
      </h2>
      <p class="mt-2 text-sm text-muted-foreground">{brokenRunError}</p>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onclick={() => (clearOpen = true)}
          class="inline-flex items-center justify-center gap-2 rounded-lg bg-destructive px-5 py-3 font-semibold text-white transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
        >
          Clear saved data
        </button>
      </div>
      {#if clearError}
        <p role="alert" class="mt-3 text-sm text-destructive">{clearError}</p>
      {/if}
    </div>
  {:else if resumeHref}
    <div class="mt-10 rounded-none bg-surface-1 sm:rounded-xl p-6">
      <h2 class="font-display text-xl font-extrabold uppercase tracking-tight">
        An active season run exists
      </h2>
      <p class="mt-2 text-sm text-muted-foreground">Pick up right where you left off.</p>
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
          Your draft saves automatically in this browser — close the tab and pick up right where you
          left off.
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
            franchise is yours; the rest are AI-controlled.
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
            The remaining 29 teams are filled out automatically, keeping each team's strength and
            lineup needs in line.
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
              Generating the league — the board stays responsive while it works.
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
                Try regenerating — it may succeed.
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
          All 30 teams are set and ready. Promoting moves the draft into an active run and opens the
          season hub.
        </p>
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
    </div>
  {/if}
</section>

<Dialog.Root bind:open={clearOpen}>
  <Dialog.Content
    class="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 shadow-xl outline-none"
  >
    <Dialog.Title class="font-display text-2xl font-extrabold">Clear season data?</Dialog.Title>
    <Dialog.Description class="mt-1 text-sm text-muted-foreground">
      This permanently deletes your saved Season Run and any in-progress draft from this browser. It
      cannot be recovered.
    </Dialog.Description>
    <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Dialog.Close
        class="inline-flex items-center justify-center rounded-xl border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
      >
        Cancel
      </Dialog.Close>
      <button
        type="button"
        onclick={() => void confirmClearSeasonData()}
        disabled={clearing}
        class="inline-flex items-center justify-center rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
      >
        {clearing ? 'Clearing…' : 'Yes, clear everything'}
      </button>
    </div>
  </Dialog.Content>
</Dialog.Root>
