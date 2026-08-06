<script lang="ts">
  import { setContext } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import {
    BarChart3,
    CalendarDays,
    ClipboardList,
    LayoutGrid,
    LogOut,
    Trophy,
    Users,
    X,
  } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
  import { franchiseAbbreviation, type PlayersIndexEntry } from '@hoop-rush/data-contracts';
  import { ordinal, provisionalRanking, recordLabel } from '$lib/season/season-presentation';
  import {
    loadSeasonDraftCatalog,
    loadSeasonHomeCourtProfile,
    loadSeasonLeague,
    loadSeasonSchedule,
    seasonArtifactUrls,
  } from '$lib/season/season-assets';
  import { getManifest, getPlayersIndex } from '$lib/data';
  import { getSeasonBlockRunner, getSeasonRunRepository } from '$lib/season/season-repo';
  import { SeasonHubState } from '$lib/season/season-hub-state';
  import {
    initialSeasonRunShellData,
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import { buildVersionFaceIndex, type SeasonVersionTuple } from '$lib/season/season-branding';
  import { createRotationEditor } from '$lib/season/season-rotation-editor';
  import { isNavItemActive, type NavItem } from '$lib/nav-items';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import SeasonMasthead from '$lib/components/season/SeasonMasthead.svelte';
  import type { RotationEditor } from '$lib/season/season-rotation-editor';

  let { children } = $props();

  /**
   * Season Run shell (M2.3.5): owns the shared `SeasonHubState` for the
   * lifetime of the active run, loads the packaged assets and branding join
   * once, and exposes everything to the six tabs through context. The
   * layout instance survives tab navigation, so an in-flight block worker
   * continues across tabs; it is torn down only when the user leaves the
   * run group.
   */

  const seasonNavItems: NavItem[] = [
    { id: 'hub', label: 'Hub', href: '/season/run', icon: LayoutGrid },
    { id: 'team', label: 'Rotation', href: '/season/run/team', icon: ClipboardList },
    { id: 'roster', label: 'Roster', href: '/season/run/roster', icon: Users },
    { id: 'schedule', label: 'Schedule', href: '/season/run/schedule', icon: CalendarDays },
    { id: 'league', label: 'League', href: '/season/run/league', icon: Trophy },
    { id: 'leaders', label: 'Leaders', href: '/season/run/leaders', icon: BarChart3 },
  ];

  const shell = $state<SeasonRunShellData>(initialSeasonRunShellData());
  setContext(SEASON_RUN_SHELL_CONTEXT, shell);

  const routeId = $derived(page.route.id);

  let playersIndex: PlayersIndexEntry[] = [];

  function recomputeRunFacts(): void {
    const snapshot = shell.snapshot;
    const run = snapshot?.run ?? null;
    shell.run = run;
    const humanTeam = run?.league.teams.find((team) => team.control === 'human') ?? null;
    shell.humanTeam = humanTeam;
    shell.humanFranchiseId = humanTeam?.franchiseId ?? null;
    shell.nextBlockIndex = snapshot === null ? null : snapshot.acceptedBlocks.length;
    shell.seasonComplete = (shell.nextBlockIndex ?? 0) >= 9;

    if (run !== null) {
      const tuples: SeasonVersionTuple[] = run.rosters.flatMap((roster) =>
        roster.players.map((entry) => ({
          playerVersionId: entry.playerVersionId,
          playerId: entry.playerId,
          franchiseId: entry.franchiseId,
          eraId: entry.eraId,
          seasonKey: entry.seasonKey,
          displayName: entry.displayName,
        })),
      );
      shell.facesByVersion = buildVersionFaceIndex(playersIndex, tuples);
      const rebuilt = rebuildRotationEditor(run);
      shell.editor = rebuilt.editor;
      shell.editorKey = rebuilt.key;
    } else {
      shell.facesByVersion = new Map();
      shell.editor = null;
      shell.editorKey = null;
    }
  }

  /** Keeps the current editor (and its pending edits) across tab switches;
   * rebuilds only when the locked rotation changes after an accepted block. */
  function rebuildRotationEditor(run: NonNullable<SeasonRunShellData['run']>): {
    editor: RotationEditor | null;
    key: string | null;
  } {
    const catalog = shell.catalog;
    const franchiseId = shell.humanFranchiseId;
    if (catalog === null || franchiseId === null) return { editor: null, key: null };
    const rotation = run.rotations.find((r) => r.franchiseId === franchiseId);
    const roster = run.rosters.find((r) => r.franchiseId === franchiseId);
    if (rotation === undefined || roster === undefined) return { editor: null, key: null };
    const members = roster.players.map((entry) => {
      const candidate = catalog.candidates.find((c) => c.playerVersionId === entry.playerVersionId);
      return {
        playerVersionId: entry.playerVersionId,
        displayName: entry.displayName,
        playable: candidate?.positions.playable ?? [],
      };
    });
    const key = `${run.runId}:${rotation.starters.join(',')}:${rotation.closingFive.join(',')}`;
    if (shell.editorKey === key && shell.editor !== null) {
      return { editor: shell.editor, key };
    }
    return { editor: createRotationEditor(rotation, members), key };
  }

  function mirrorHub(): void {
    const hub = shell.hub;
    if (hub === null) return;
    shell.snapshot = hub.snapshot;
    shell.index = hub.index;
    shell.block = hub.block;
    recomputeRunFacts();
  }

  let unsubscribeHub: (() => void) | null = null;

  let quitOpen = $state(false);
  let quitting = $state(false);
  let quitError: string | null = $state(null);

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
      await goto(resolve('/season'));
    } finally {
      quitting = false;
    }
  }

  $effect(() => {
    if (!import.meta.env.SSR) {
      void initShell();
    }
    return () => {
      unsubscribeHub?.();
      unsubscribeHub = null;
      const hub = shell.hub;
      if (hub !== null) {
        hub.destroy();
        shell.hub = null;
      }
    };
  });

  async function initShell(): Promise<void> {
    try {
      const [manifest, league, catalog, schedule, index, homeCourt, urls] = await Promise.all([
        getManifest(),
        loadSeasonLeague(),
        loadSeasonDraftCatalog(),
        loadSeasonSchedule(),
        getPlayersIndex(),
        loadSeasonHomeCourtProfile(),
        seasonArtifactUrls(),
      ]);
      void homeCourt;
      void urls;
      shell.manifest = manifest;
      shell.league = league;
      shell.catalog = catalog;
      shell.schedule = schedule;
      playersIndex = index.players;

      const repo = await getSeasonRunRepository(schedule);
      const runner = await getSeasonBlockRunner();
      const hub = new SeasonHubState(repo, runner);
      shell.hub = hub;
      unsubscribeHub = hub.subscribe(() => mirrorHub());
      await hub.refresh();
      mirrorHub();
    } catch (error) {
      shell.error = error instanceof Error ? error.message : String(error);
    } finally {
      shell.ready = true;
    }
  }

  shell.cancelBlock = () => shell.hub?.cancel();
  shell.retryBlock = () => shell.hub?.retry();
  shell.refresh = async () => {
    await shell.hub?.refresh();
    mirrorHub();
  };
  shell.quitRun = async () => {
    if (shell.hub === null) {
      return { ok: false, error: 'season hub is not ready' };
    }
    return shell.hub.quitRun();
  };
  shell.playerName = (playerVersionId: string): string => {
    for (const roster of shell.run?.rosters ?? []) {
      const entry = roster.players.find((p) => p.playerVersionId === playerVersionId);
      if (entry !== undefined) return entry.displayName;
    }
    return '—';
  };
  shell.playablePositions = (playerVersionId: string): readonly string[] => {
    const candidate = shell.catalog?.candidates.find((c) => c.playerVersionId === playerVersionId);
    return candidate?.positions.playable ?? [];
  };
  shell.franchiseName = (franchiseId: string): string => {
    return (
      shell.manifest?.modernFranchiseSlots.find((slot) => slot.franchiseId === franchiseId)
        ?.displayName ?? franchiseId
    );
  };
  shell.franchiseAbbrev = (franchiseId: string): string => {
    return franchiseAbbreviation(franchiseId);
  };

  const mastheadFacts = $derived.by(() => {
    const run = shell.run;
    const franchiseId = shell.humanFranchiseId;
    const manifest = shell.manifest;
    if (run === null || franchiseId === null || manifest === null) return null;
    const row = run.standings.rows.find((r) => r.franchiseId === franchiseId);
    if (row === undefined) return null;
    const ranked = provisionalRanking(run.standings, run.league).find(
      (entry) => entry.row.franchiseId === franchiseId,
    );
    return {
      franchiseId,
      record: recordLabel(row.wins, row.losses),
      position: ranked === undefined ? '—' : `${ordinal(ranked.rank)} in the ${ranked.conference}`,
    };
  });

  const showEmptyState = $derived(
    shell.ready && shell.error === null && shell.hub !== null && shell.snapshot === null,
  );

  /** M2.4: the stored run was made under older Season rules. */
  const incompatible = $derived(shell.hub?.incompatible ?? null);

  /** Two-step discard: step 1 explains, step 2 (dialog) confirms. */
  let discardOpen = $state(false);
  let discarding = $state(false);
  let discardError: string | null = $state(null);

  async function confirmDiscard(): Promise<void> {
    if (discarding) return;
    discarding = true;
    discardError = null;
    try {
      await shell.hub?.discardIncompatibleRun();
      discardOpen = false;
      await goto(resolve('/season'));
    } catch (error) {
      discardError = error instanceof Error ? error.message : String(error);
    } finally {
      discarding = false;
    }
  }
</script>

<svelte:head>
  <title>Season Run — Hoop Rush</title>
</svelte:head>

{#if shell.error !== null}
  <div class="mx-auto mt-16 w-full max-w-xl px-4 sm:px-6">
    <div class="scoreboard-panel p-6">
      <h1 class="font-display text-3xl font-extrabold">Season data unavailable</h1>
      <p class="mt-2 text-sm text-muted-foreground">{shell.error}</p>
      <a
        href={resolve('/season')}
        class="mt-4 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold"
      >
        Back to Season setup
      </a>
    </div>
  </div>
{:else if !shell.ready}
  <div class="mx-auto mt-16 w-full max-w-xl px-4 sm:px-6">
    <div class="scoreboard-panel p-6" aria-live="polite">
      <p class="font-mono text-sm text-muted-foreground">Loading your season…</p>
    </div>
  </div>
{:else if incompatible !== null}
  <div class="mx-auto mt-16 w-full max-w-xl px-4 sm:px-6">
    <div class="scoreboard-panel p-6">
      <p class="text-label uppercase text-muted-foreground">Season rules changed</p>
      <h1 class="mt-1 font-display text-3xl font-extrabold">
        This saved season was made with the old rules
      </h1>
      <p class="mt-3 text-sm leading-relaxed text-muted-foreground">
        Season Run now simulates stamina, workload, and pair chemistry, so runs started under the
        previous rules (schema {incompatible.storedRunSchemaVersion}) cannot continue. Nothing has
        been deleted: the saved season stays in your browser until you decide.
      </p>
      <div class="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onclick={() => (discardOpen = true)}
          class="inline-flex items-center gap-2 rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          Discard run and restart
        </button>
        <a
          href={resolve('/season')}
          class="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
        >
          Keep it and go back
        </a>
      </div>
      {#if discardError !== null}
        <p class="mt-3 text-sm text-destructive" role="alert">{discardError}</p>
      {/if}
    </div>
  </div>
  <Dialog.Root bind:open={discardOpen}>
    <Dialog.Content
      class="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 shadow-xl outline-none"
    >
      <Dialog.Title class="font-display text-2xl font-extrabold">Discard this season?</Dialog.Title>
      <Dialog.Description class="mt-1 text-sm text-muted-foreground">
        This permanently deletes the saved season (schema {incompatible.storedRunSchemaVersion})
        from this browser. It cannot be recovered. Your next run starts fresh under the current
        rules.
      </Dialog.Description>
      <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Dialog.Close
          class="inline-flex items-center justify-center rounded-xl border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
        >
          Cancel
        </Dialog.Close>
        <button
          type="button"
          onclick={confirmDiscard}
          disabled={discarding}
          class="inline-flex items-center justify-center rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        >
          {discarding ? 'Discarding…' : 'Yes, discard the season'}
        </button>
      </div>
    </Dialog.Content>
  </Dialog.Root>
{:else if showEmptyState}
  <div class="mx-auto mt-16 w-full max-w-xl px-4 sm:px-6">
    <div class="scoreboard-panel p-6">
      <h1 class="font-display text-3xl font-extrabold">No active Season Run</h1>
      <p class="mt-2 text-sm text-muted-foreground">
        Create a franchise, draft ten players, and generate the league to open your command center.
      </p>
      <a
        href={resolve('/season')}
        class="mt-4 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold"
      >
        Start a Season Run
      </a>
    </div>
  </div>
{:else}
  <div class="mx-auto w-full min-w-0 max-w-6xl overflow-x-hidden sm:px-6">
    <div class="px-3 pt-6 sm:px-0">
      <div class="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
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
          class="inline-flex w-fit items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-destructive/50 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
        >
          <LogOut class="h-4 w-4 shrink-0" />
          Quit run
        </button>
      </div>
    </div>

    <nav
      aria-label="Season navigation"
      class="sticky top-0 z-30 mt-4 hidden border-y border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:block"
    >
      <div class="mx-auto flex w-full max-w-6xl items-center gap-1 px-4 sm:px-6">
        {#each seasonNavItems as item (item.id)}
          {@const active = isNavItemActive(item, routeId)}
          <a
            href={resolve(item.href as RouteId)}
            aria-current={active ? 'page' : undefined}
            class="inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold outline-none transition-colors focus-visible:bg-surface-2 focus-visible:text-foreground {active
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
          >
            <item.icon class="h-4 w-4 shrink-0" />
            {item.label}
          </a>
        {/each}
      </div>
    </nav>

    <main class="min-w-0 overflow-x-hidden pb-[max(6.5rem,env(safe-area-inset-bottom))] md:pb-14">
      {@render children()}
    </main>
  </div>

  <BottomNav items={seasonNavItems} label="Season navigation" />

  <Dialog.Root
    open={quitOpen}
    onOpenChange={(open) => {
      if (!open && !quitting) quitOpen = false;
    }}
  >
    <Dialog.Portal>
      <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
      <Dialog.Content
        class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
      >
        <div class="flex items-start justify-between gap-3">
          <Dialog.Title
            class="font-display truncate text-lg font-extrabold tracking-tight uppercase"
          >
            Quit this run?
          </Dialog.Title>
          <Dialog.Close
            aria-label="Cancel"
            class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
          >
            <X class="h-4 w-4" />
          </Dialog.Close>
        </div>
        <p class="mt-2 text-sm text-muted-foreground">
          Quitting ends this Season Run and deletes its progress from this browser. You can start a
          new Season Run from the Season setup screen.
        </p>
        {#if quitError}
          <p
            role="alert"
            class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            {quitError}
          </p>
        {/if}
        <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onclick={() => (quitOpen = false)}
            disabled={quitting}
            class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            Stay
          </button>
          <button
            type="button"
            onclick={() => void confirmQuit()}
            disabled={quitting}
            class="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/50 px-4 py-2 text-sm font-semibold text-destructive transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {quitting ? 'Quitting…' : 'Quit and delete'}
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
{/if}
