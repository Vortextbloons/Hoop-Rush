<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { X } from '@lucide/svelte';
  import type {
    ClassicDraftState,
    ClassicPick,
    HoopRushManifest,
    PlayersIndex,
    PlayersIndexEntry,
    PeakPlayerSeason,
    SlotIndex,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation, resolveEraTeamIdentity } from '@hoop-rush/data-contracts';
  import { classic, createEngineContext } from '@hoop-rush/engine';
  import { Dialog } from 'bits-ui';
  import { getManifest, getPlayersIndex } from '$lib/data';
  import {
    buildClassicCatalog,
    classicDraftSeed,
    classicPoolRows,
    clearClassicDraftState,
    loadClassicDraftState,
    saveClassicDraftState,
  } from '$lib/classic-draft';
  import {
    registerClassicDraftNavigationGuard,
    setClassicGuardBypass,
    type ClassicGuardTarget,
  } from '$lib/classic-nav-guard';
  import { startClassicRun } from '$lib/classic-run';
  import { resolvePlayerRefs } from '$lib/player-refs';
  import { poolSortLabel, presentationForVariant, variantLabel } from '$lib/draft-presentation';
  import TeamLogo from '$lib/components/TeamLogo.svelte';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import LineupCourt from '$lib/components/LineupCourt.svelte';
  import LineupSummaryNav from '$lib/components/LineupSummaryNav.svelte';
  import DraftValuePanel from '$lib/components/DraftValuePanel.svelte';
  import DraftPoolBrowser from '$lib/components/draft/DraftPoolBrowser.svelte';
  import SlotPickerDialog from '$lib/components/draft/SlotPickerDialog.svelte';
  import ClassicRollReel from '$lib/components/classic/ClassicRollReel.svelte';

  type IndexRow = PlayersIndexEntry;
  type Variant = 'ratings' | 'ball-knowledge';

  const ROUNDS = [0, 1, 2, 3, 4] as const;

  let manifest = $state.raw<HoopRushManifest | null>(null);
  let manifestError: string | null = $state(null);
  let index = $state.raw<PlayersIndex | null>(null);
  let indexError: string | null = $state(null);
  let draft = $state.raw<ClassicDraftState | null>(null);
  let draftLoaded = $state(false);
  let draftError: string | null = $state(null);
  let setupError: string | null = $state(null);
  let actionError: string | null = $state(null);
  let pickerPlayer = $state<IndexRow | null>(null);
  let spinning = $state(false);
  let spinKey = $state(0);
  let reelAxis = $state<'both' | 'franchise' | 'era'>('both');
  let guardOpen = $state(false);
  let guardTarget = $state<ClassicGuardTarget | null>(null);
  let starting = $state(false);
  let launchError: string | null = $state(null);
  let resolvedDraftPlayers = $state.raw<PeakPlayerSeason[]>([]);

  /** False once this component starts being destroyed (see below). */
  let mounted = true;
  $effect(() => {
    mounted = true;
    return () => {
      // Post-destroy async callbacks (persistence, bits-ui dismissal timers)
      // must never write reactive state on a torn-down tree; that can
      // cascade into an update-depth error during navigation away.
      mounted = false;
    };
  });

  let unregister: (() => void) | null = null;
  $effect(() => {
    unregister = registerClassicDraftNavigationGuard(
      () => draft,
      (target) => {
        guardTarget = target;
        guardOpen = true;
      },
    );
    return () => {
      unregister?.();
      unregister = null;
    };
  });

  $effect(() => {
    let cancelled = false;
    getManifest().then(
      (m) => {
        if (cancelled) return;
        manifest = m;
        getPlayersIndex().then(
          (ix) => {
            if (cancelled) return;
            index = ix;
            loadClassicDraftState().then(
              (saved) => {
                if (cancelled) return;
                draft = saved;
                draftLoaded = true;
              },
              (error: unknown) => {
                if (cancelled) return;
                draftError = error instanceof Error ? error.message : String(error);
                draftLoaded = true;
              },
            );
          },
          (error: unknown) => {
            if (!cancelled) indexError = error instanceof Error ? error.message : String(error);
          },
        );
      },
      (error: unknown) => {
        if (!cancelled) manifestError = error instanceof Error ? error.message : String(error);
      },
    );
    return () => {
      cancelled = true;
    };
  });

  /** The engine catalog: one entry per packaged manifest pool, in pool order. */
  const catalog = $derived.by(() =>
    manifest && index ? buildClassicCatalog(manifest, index) : [],
  );

  const presentation = $derived(presentationForVariant(draft?.variant ?? 'ratings'));

  const roll = $derived(draft?.roll ?? null);

  const rollFranchise = $derived(
    roll
      ? (manifest?.modernFranchiseSlots.find((e) => e.franchiseId === roll.franchiseId) ?? null)
      : null,
  );

  const rollEra = $derived(
    roll ? (manifest?.eras.find((e) => e.eraId === roll.eraId) ?? null) : null,
  );

  /** Era-scoped historical identity for the landed roll (franchise + era). */
  const rollIdentity = $derived(
    manifest && roll ? resolveEraTeamIdentity(manifest, roll.franchiseId, roll.eraId) : null,
  );

  /** The complete eligible pool for the current roll, sorted per presentation. */
  const rollRows = $derived(index && roll ? classicPoolRows(index, roll, presentation) : []);

  const poolHeading = $derived(
    roll && rollFranchise && rollEra && rollIdentity
      ? `${rollIdentity.abbreviationLabel ?? franchiseAbbreviation(rollFranchise.franchiseId)} · ${rollEra.label}`
      : 'Draft pool',
  );

  const countLabel = $derived(`${rollRows.length} players · ${poolSortLabel(presentation)}`);

  const reelAnnouncement = $derived(
    roll
      ? `Round ${draft!.round} of 5 · ${
          rollIdentity?.displayLabel ?? rollFranchise?.displayName ?? roll.franchiseId
        } · ${rollEra?.label ?? roll.eraId}`
      : '',
  );

  function rowForPick(pick: ClassicPick): IndexRow | null {
    if (!index) return null;
    return (
      index.players.find(
        (p) =>
          p.playerId === pick.playerId &&
          p.franchiseId === pick.franchiseId &&
          p.eraId === pick.eraId,
      ) ?? null
    );
  }

  /** Drafted players in slot order, as index rows for the shared court. */
  const slots = $derived.by((): (IndexRow | null)[] => {
    const rows: (IndexRow | null)[] = [null, null, null, null, null];
    if (!draft) return rows;
    for (const pick of draft.picks) {
      rows[pick.slotIndex] = rowForPick(pick);
    }
    return rows;
  });

  /** Resolve full profiles for Fit/Matchup explanations while drafting. */
  $effect(() => {
    const m = manifest;
    const refs = slots
      .filter((player): player is IndexRow => player !== null)
      .map((player) => ({
        playerId: player.playerId,
        franchiseId: player.franchiseId,
        eraId: player.eraId,
      }));
    if (!m || refs.length === 0) {
      resolvedDraftPlayers = [];
      return;
    }
    let cancelled = false;
    resolvePlayerRefs(refs, m).then(
      (players) => {
        if (!cancelled) resolvedDraftPlayers = players;
      },
      () => {
        if (!cancelled) resolvedDraftPlayers = [];
      },
    );
    return () => {
      cancelled = true;
    };
  });

  const pickedCount = $derived(slots.filter((player) => player !== null).length);

  const franchiseRerollAvailable = $derived(
    draft && catalog.length > 0
      ? classic.classicRerollAvailable(draft, 'franchise', catalog)
      : false,
  );

  const eraRerollAvailable = $derived(
    draft && catalog.length > 0 ? classic.classicRerollAvailable(draft, 'era', catalog) : false,
  );

  async function persist(next: ClassicDraftState): Promise<ClassicDraftState> {
    await saveClassicDraftState(next);
    return next;
  }

  /**
   * Persists a fresh roll and triggers the reel animation for it. Callers
   * lock interactions (spinning = true) BEFORE awaiting: the engine result is
   * synchronous, but the persist is async, so the stale pool must be hidden
   * the moment the command is issued. spinKey only changes here, after the
   * persisted state already matches the reels, so a resumed saved state never
   * re-animates.
   */
  async function applyRoll(next: ClassicDraftState, axis: 'both' | 'franchise' | 'era') {
    draft = await persist(next);
    if (!mounted) return;
    if (next.roll) {
      reelAxis = axis;
      spinKey += 1;
      launchError = null;
    }
  }

  /** The reels settled: the pool for the new roll is ready to browse. */
  function onReelSettled() {
    spinning = false;
  }

  /** Starts a fresh draft in the chosen immutable variant. */
  async function startDraft(variant: Variant) {
    if (!manifest || !index) return;
    setupError = null;
    actionError = null;
    launchError = null;
    try {
      // Lock interactions immediately so the feedback shows before the async
      // persist resolves (the engine result itself is synchronous).
      spinning = true;
      const next = classic.createClassicDraft(
        {
          draftId: crypto.randomUUID(),
          variant,
          seed: classicDraftSeed(),
          dataVersion: manifest.dataVersion,
          catalog,
        },
        createEngineContext(),
      );
      draft = await persist(next);
      if (!mounted) return;
      // The very first roll animates too: the reel mounts with spinKey > 0
      // and spins on mount. A resumed draft always mounts with spinKey 0 and
      // never replays.
      reelAxis = 'both';
      spinKey += 1;
    } catch (error) {
      spinning = false;
      setupError = error instanceof Error ? error.message : String(error);
    }
  }

  async function rerollFranchise() {
    if (!draft || catalog.length === 0 || spinning || starting) return;
    actionError = null;
    try {
      const next = classic.rerollClassicFranchise(draft, catalog, createEngineContext());
      spinning = true;
      await applyRoll(next, 'franchise');
    } catch (error) {
      spinning = false;
      actionError = error instanceof Error ? error.message : String(error);
    }
  }

  async function rerollEra() {
    if (!draft || catalog.length === 0 || spinning || starting) return;
    actionError = null;
    try {
      const next = classic.rerollClassicEra(draft, catalog, createEngineContext());
      spinning = true;
      await applyRoll(next, 'era');
    } catch (error) {
      spinning = false;
      actionError = error instanceof Error ? error.message : String(error);
    }
  }

  function openPicker(player: IndexRow) {
    pickerPlayer = player;
  }

  /**
   * Slot choice from the picker. A drafted player repositions (swapping or
   * displacing incumbents when needed); a new player is drafted into the
   * for invalid placements, surfaced inline. The fifth pick auto-launches the
   * season (no reel spin — the draft is done); every other successful
   * placement rolls the next round through the reels. Interactions lock
   * before the async persist so the stale pool can never be clicked again.
   */
  async function placePlayer(player: IndexRow, slotIndex: number) {
    if (!draft || catalog.length === 0 || spinning || starting) return;
    actionError = null;
    try {
      const alreadyDrafted = draft.picks.some((p) => p.playerId === player.playerId);
      const next = alreadyDrafted
        ? classic.repositionClassicPlayer(draft, catalog, {
            playerId: player.playerId,
            slotIndex: slotIndex as SlotIndex,
          })
        : classic.draftClassicPlayer(
            draft,
            catalog,
            { playerId: player.playerId, slotIndex: slotIndex as SlotIndex },
            createEngineContext(),
          );
      if (next.status === 'complete' && !alreadyDrafted) {
        starting = true;
        pickerPlayer = null;
        draft = await persist(next);
        if (!mounted) return;
        void launchRun(next);
      } else {
        spinning = true;
        pickerPlayer = null;
        await applyRoll(next, 'both');
      }
    } catch (error) {
      spinning = false;
      starting = false;
      actionError = error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * The single path into the season: promotes the completed draft to an active
   * run and navigates to the challenge. On failure the persisted draft is
   * retained (promotion only clears it on success), so the page stays and
   * shows the recovery UI with the error.
   */
  async function launchRun(draftToRun: ClassicDraftState) {
    starting = true;
    launchError = null;
    try {
      await startClassicRun(draftToRun, classicDraftSeed());
    } catch (error) {
      if (!mounted) return;
      launchError = error instanceof Error ? error.message : String(error);
      starting = false;
    }
  }

  /** Leaves the draft: clears the saved state and navigates to the blocked target. */
  async function discardAndLeave() {
    const target = guardTarget;
    guardOpen = false;
    setClassicGuardBypass(true);
    await clearClassicDraftState();
    // The target pathname comes from the navigation URL, which already carries
    // the base path, so resolve() must not be applied on top of it.
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    void goto(target ? `${target.pathname}${target.search}` : '/');
  }
</script>

<svelte:head>
  <title>Classic — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-0 py-4 sm:px-6 sm:py-10">
  <div class="flex items-start justify-between gap-3 px-3 sm:px-0">
    <div class="min-w-0 flex-1">
      <p class="font-mono text-[10px] tracking-[0.16em] text-primary uppercase sm:text-xs">
        Classic
      </p>
      {#if draft}
        <h1
          class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase sm:mt-2 sm:text-4xl md:text-5xl"
        >
          Classic · {variantLabel(draft.variant)}
        </h1>
      {:else}
        <h1
          class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase sm:mt-2 sm:text-4xl md:text-5xl"
        >
          Five draft rounds
        </h1>
      {/if}
      <p class="mt-2 hidden max-w-xl text-sm text-muted-foreground sm:mt-3 sm:block">
        Each round rolls a franchise and an era. One franchise reroll and one era reroll, then live
        with the board.
      </p>
    </div>
    <a
      href={resolve('/')}
      class="shrink-0 pt-1 font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
    >
      Back
    </a>
  </div>

  {#if manifestError}
    <p class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      Failed to load data: {manifestError}
    </p>
  {:else if !manifest}
    <p class="mt-8 font-mono text-sm text-muted-foreground">Loading data…</p>
  {:else}
    {#if indexError}
      <p class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
        Failed to load players: {indexError}
      </p>
    {:else if !index}
      <p class="mt-8 font-mono text-sm text-muted-foreground">Loading players…</p>
    {:else if draftError}
      <p class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
        Failed to load draft: {draftError}
      </p>
    {:else if !draftLoaded}
      <p class="mt-8 font-mono text-sm text-muted-foreground">Loading draft…</p>
    {:else if !draft}
      <div class="mt-6 flex flex-col gap-4 pb-32 sm:mt-10 sm:gap-6">
        <div class="px-3 sm:px-0">
          <h2 class="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
            Choose a variant
          </h2>
          <p class="mt-2 max-w-xl text-sm text-muted-foreground">
            The variant is fixed for the whole draft. Both play the same rolls, rerolls, pools, and
            lineup rules.
          </p>
        </div>
        <div class="grid gap-3 px-3 sm:grid-cols-2 sm:gap-4 sm:px-0">
          <button
            type="button"
            onclick={() => startDraft('ratings')}
            class="group flex h-full flex-col rounded-xl bg-card p-6 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring sm:p-7"
          >
            <h3 class="font-display text-4xl font-extrabold tracking-tight uppercase">Ratings</h3>
            <p class="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
              Peak season with Overall. Draft on the numbers.
            </p>
            <span class="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">
              Start Ratings draft
              <span
                aria-hidden="true"
                class="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                >&rarr;</span
              >
            </span>
          </button>
          <button
            type="button"
            onclick={() => startDraft('ball-knowledge')}
            class="group flex h-full flex-col rounded-xl bg-card p-6 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring sm:p-7"
          >
            <h3 class="font-display text-4xl font-extrabold tracking-tight uppercase">
              Ball Knowledge
            </h3>
            <p class="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
              The same draft with every rating badge hidden and the pool sorted by name. Draft on
              reputation.
            </p>
            <span class="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary">
              Start Ball Knowledge draft
              <span
                aria-hidden="true"
                class="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                >&rarr;</span
              >
            </span>
          </button>
        </div>
        {#if setupError}
          <p
            class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          >
            {setupError}
          </p>
        {/if}
      </div>
    {:else}
      <div class="mt-6 flex flex-col gap-4 pb-32 sm:mt-10 sm:gap-6">
        {#if draft.status === 'drafting' && roll}
          <div class="rounded-none bg-surface-1 sm:rounded-xl">
            <div
              class="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3"
            >
              <span
                data-round-heading
                class="font-display text-base font-extrabold tracking-tight uppercase sm:text-lg"
              >
                Round {draft.round} of 5
              </span>
              <span class="flex gap-1.5" aria-hidden="true">
                {#each ROUNDS as i (i)}
                  <span
                    class="h-2 w-2 rounded-full {i < draft.round - 1
                      ? 'bg-primary'
                      : i === draft.round - 1
                        ? 'bg-accent'
                        : 'border border-border'}"
                  ></span>
                {/each}
              </span>
            </div>
            <div class="flex flex-col gap-2 px-3 pb-3 sm:gap-3 sm:px-4 sm:pb-4">
              <div
                class="grid w-full grid-cols-2 gap-2"
                aria-label={`Round ${draft.round} of 5 · ${rollIdentity?.displayLabel ?? rollFranchise?.displayName ?? roll.franchiseId} · ${rollEra?.label ?? roll.eraId}`}
              >
                <span
                  class="flex min-w-0 items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2 sm:px-3"
                  data-indicator="franchise"
                >
                  {#if rollFranchise}
                    <TeamLogo
                      {manifest}
                      franchiseId={rollFranchise.franchiseId}
                      teamExternalId={rollFranchise.teamExternalId}
                      logoCandidates={rollIdentity?.logoCandidates ?? []}
                    />
                  {/if}
                  <span class="min-w-0">
                    <span class="block font-mono text-[10px] font-bold tracking-[0.12em] uppercase">
                      {rollIdentity?.abbreviationLabel ?? franchiseAbbreviation(roll.franchiseId)}
                    </span>
                    {#if rollFranchise}
                      <span class="block truncate text-sm font-bold">
                        {rollIdentity?.displayLabel ?? rollFranchise.displayName}
                      </span>
                    {/if}
                  </span>
                </span>
                <span
                  class="flex items-center justify-center rounded-lg bg-surface-2 px-2.5 py-2 sm:px-3"
                  data-indicator="era"
                >
                  <span class="font-display text-sm font-extrabold tracking-tight">
                    {rollEra?.label ?? roll.eraId}
                  </span>
                </span>
              </div>
              <div class="grid w-full grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={spinning || starting || !franchiseRerollAvailable}
                  title={franchiseRerollAvailable
                    ? 'Roll a different franchise'
                    : draft.rerolls.franchiseSpent
                      ? 'Already used'
                      : 'No alternative'}
                  onclick={rerollFranchise}
                  class="flex min-h-11 min-w-0 flex-col items-center justify-center rounded-lg bg-surface-2 px-2 py-2 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-row sm:gap-2 sm:px-3"
                >
                  <span class="text-[11px] font-semibold leading-tight sm:text-sm"
                    >Reroll franchise</span
                  >
                  {#if draft.rerolls.franchiseSpent}
                    <span
                      class="mt-0.5 font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase sm:mt-0"
                    >
                      Used
                    </span>
                  {/if}
                </button>
                <button
                  type="button"
                  disabled={spinning || starting || !eraRerollAvailable}
                  title={eraRerollAvailable
                    ? 'Roll a different era'
                    : draft.rerolls.eraSpent
                      ? 'Already used'
                      : 'No alternative'}
                  onclick={rerollEra}
                  class="flex min-h-11 min-w-0 flex-col items-center justify-center rounded-lg bg-surface-2 px-2 py-2 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-row sm:gap-2 sm:px-3"
                >
                  <span class="text-[11px] font-semibold leading-tight sm:text-sm">Reroll era</span>
                  {#if draft.rerolls.eraSpent}
                    <span
                      class="mt-0.5 font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase sm:mt-0"
                    >
                      Used
                    </span>
                  {/if}
                </button>
              </div>
            </div>
          </div>
          <ClassicRollReel
            {manifest}
            franchiseId={roll.franchiseId}
            eraId={roll.eraId}
            franchiseOptions={manifest.modernFranchiseSlots.map((f) => f.franchiseId)}
            eraOptions={manifest.eras.map((e) => e.eraId)}
            axis={reelAxis}
            {spinKey}
            announceText={reelAnnouncement}
            roundLabel={`Round ${draft.round} of 5`}
            spinDurationMs={draft.round === 1 ? undefined : 500}
            onSettled={onReelSettled}
          />
        {/if}

        {#if draft.status === 'drafting' && roll && !spinning && !starting}
          <DraftPoolBrowser
            heading={poolHeading}
            rows={rollRows}
            {slots}
            {countLabel}
            {manifest}
            {presentation}
            filtersEditable={true}
            allowDisplacement
            error={actionError}
            emptyMessage="No players in this pool."
            onpick={openPicker}
          />
        {:else if draft.status === 'complete'}
          {@const completeDraft = draft}
          {#if starting}
            <p class="font-mono text-xs text-muted-foreground">Starting the season…</p>
          {/if}
          {#if launchError}
            <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
              <p class="font-semibold">The season could not start</p>
              <p class="mt-1 text-muted-foreground">{launchError}</p>
            </div>
          {/if}
          {#if actionError}
            <p
              class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            >
              {actionError}
            </p>
          {/if}
          <div class="rounded-none bg-surface-1 sm:rounded-xl">
            <div class="px-3 py-3 sm:px-4">
              <h3 class="font-display text-lg font-extrabold tracking-tight uppercase">
                Your five
              </h3>
            </div>
            <ul class="flex flex-col divide-y divide-border/60">
              {#each draft.picks as pick (pick.round)}
                {@const row = rowForPick(pick)}
                <li class="flex items-center gap-3 px-3 py-3 sm:px-4">
                  <span
                    class="w-16 shrink-0 font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
                  >
                    Round {pick.round}
                  </span>
                  {#if row}
                    <PlayerFace
                      player={row}
                      {manifest}
                      size="sm"
                      fallbackInitials={row.firstName[0]! + row.lastName[0]!}
                    />
                    <span class="min-w-0 flex-1 truncate text-sm font-bold">
                      {row.displayName}
                    </span>
                    <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {row.seasonKey} · {row.positionsPlayable.join('/')} ·
                      {resolveEraTeamIdentity(manifest!, row.franchiseId, row.eraId)
                        .abbreviationLabel ?? franchiseAbbreviation(row.franchiseId)}
                    </span>
                  {:else}
                    <span class="min-w-0 flex-1 truncate text-sm font-bold">
                      {pick.playerId}
                    </span>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
          <div class="px-3 sm:px-0">
            <button
              type="button"
              onclick={() => launchRun(completeDraft)}
              disabled={starting}
              class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Retry starting the simulation
            </button>
          </div>
          <p class="px-3 font-mono text-[10px] text-muted-foreground sm:px-0">
            seed {draft.seed} · draft {draft.draftId}
          </p>
        {/if}

        <LineupCourt
          {slots}
          {manifest}
          ready={draft.status === 'complete'}
          allowRemove={false}
          onmove={openPicker}
          onremove={() => undefined}
        />
        <DraftValuePanel players={resolvedDraftPlayers} />

        <LineupSummaryNav {slots} {pickedCount} />
      </div>
    {/if}
  {/if}

  <SlotPickerDialog
    player={pickerPlayer}
    {slots}
    manifest={manifest!}
    {presentation}
    allowDisplacement
    onplace={placePlayer}
    onclose={() => {
      if (mounted) pickerPlayer = null;
    }}
  />

  <Dialog.Root
    open={guardOpen}
    onOpenChange={(open) => {
      if (!open) guardOpen = false;
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
            Leave the draft?
          </Dialog.Title>
          <Dialog.Close
            aria-label="Cancel"
            class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
          >
            <X class="h-4 w-4" />
          </Dialog.Close>
        </div>
        <p class="mt-2 text-sm text-muted-foreground">
          Leaving now discards this draft and its rerolls. Refresh or closing the tab keeps it for
          later.
        </p>
        <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onclick={() => (guardOpen = false)}
            class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
          >
            Stay
          </button>
          <button
            type="button"
            onclick={discardAndLeave}
            class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Leave and discard
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
</section>
