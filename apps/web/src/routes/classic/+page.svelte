<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowRight } from '@lucide/svelte';
  import type {
    ClassicDraftState,
    ClassicPick,
    HoopRushManifest,
    PlayersIndex,
    PlayersIndexEntry,
    SlotIndex,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { classic, createEngineContext } from '@hoop-rush/engine';
  import { getManifest, getPlayersIndex } from '$lib/data';
  import {
    buildClassicCatalog,
    classicDraftSeed,
    classicPoolRows,
    loadClassicDraftState,
    saveClassicDraftState,
  } from '$lib/classic-draft';
  import { startClassicRun } from '$lib/classic-run';
  import { poolSortLabel, presentationForVariant, variantLabel } from '$lib/draft-presentation';
  import TeamLogo from '$lib/components/TeamLogo.svelte';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import LineupCourt from '$lib/components/LineupCourt.svelte';
  import DraftPoolBrowser from '$lib/components/draft/DraftPoolBrowser.svelte';
  import SlotPickerDialog from '$lib/components/draft/SlotPickerDialog.svelte';

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
  let starting = $state(false);

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

  /** The complete eligible pool for the current roll, sorted per presentation. */
  const rollRows = $derived(index && roll ? classicPoolRows(index, roll, presentation) : []);

  const poolHeading = $derived(
    roll && rollFranchise && rollEra
      ? `${franchiseAbbreviation(rollFranchise.franchiseId)} · ${rollEra.label}`
      : 'Draft pool',
  );

  const countLabel = $derived(`${rollRows.length} players · ${poolSortLabel(presentation)}`);

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

  /** Starts a fresh draft in the chosen immutable variant. */
  async function startDraft(variant: Variant) {
    if (!manifest || !index) return;
    setupError = null;
    actionError = null;
    try {
      const next = classic.createClassicDraft(
        {
          draftId: crypto.randomUUID(),
          variant,
          seed: classicDraftSeed(),
          dataVersion: manifest.dataVersion,
          catalog: buildClassicCatalog(manifest, index),
        },
        createEngineContext(),
      );
      draft = await persist(next);
    } catch (error) {
      setupError = error instanceof Error ? error.message : String(error);
    }
  }

  async function rerollFranchise() {
    if (!draft || catalog.length === 0) return;
    actionError = null;
    try {
      draft = await persist(classic.rerollClassicFranchise(draft, catalog, createEngineContext()));
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    }
  }

  async function rerollEra() {
    if (!draft || catalog.length === 0) return;
    actionError = null;
    try {
      draft = await persist(classic.rerollClassicEra(draft, catalog, createEngineContext()));
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    }
  }

  function openPicker(player: IndexRow) {
    pickerPlayer = player;
  }

  /**
   * Slot choice from the picker. A drafted player repositions (swapping when
   * the target is occupied and both sides can fill each other's slots); a new
   * player is drafted into the open slot. The engine throws precise reasons
   * for invalid placements, surfaced inline.
   */
  async function placePlayer(player: IndexRow, slotIndex: number) {
    if (!draft || catalog.length === 0) return;
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
      draft = await persist(next);
      pickerPlayer = null;
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    }
  }

  async function play82() {
    if (!draft || draft.status !== 'complete') return;
    starting = true;
    actionError = null;
    try {
      await startClassicRun(draft, classicDraftSeed());
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
      starting = false;
    }
  }
</script>

<svelte:head>
  <title>Classic — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <div class="flex items-end justify-between gap-4">
    <div>
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Classic</p>
      {#if draft}
        <h1
          class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
        >
          Classic · {variantLabel(draft.variant)}
        </h1>
      {:else}
        <h1
          class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
        >
          Five draft rounds
        </h1>
      {/if}
      <p class="mt-3 max-w-xl text-sm text-muted-foreground">
        Each round rolls a franchise and an era. One franchise reroll and one era reroll, then live
        with the board.
      </p>
    </div>
    <a
      href={resolve('/')}
      class="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
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
      <div class="mt-10 flex flex-col gap-6 pb-32">
        <div>
          <h2 class="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
            Choose a variant
          </h2>
          <p class="mt-2 max-w-xl text-sm text-muted-foreground">
            The variant is fixed for the whole draft. Both play the same rolls, rerolls, pools, and
            lineup rules.
          </p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onclick={() => startDraft('ratings')}
            class="group flex h-full flex-col rounded-xl border border-border bg-card p-6 text-left outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring sm:p-7"
          >
            <h3 class="font-display text-4xl font-extrabold tracking-tight uppercase">Ratings</h3>
            <p class="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
              Peak season with Overall, Offense, and Defense. Draft on the numbers.
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
            class="group flex h-full flex-col rounded-xl border border-border bg-card p-6 text-left outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring sm:p-7"
          >
            <h3 class="font-display text-4xl font-extrabold tracking-tight uppercase">
              Ball Knowledge
            </h3>
            <p class="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
              The same draft with Overall hidden and the pool sorted by name. Draft on reputation.
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
      <div class="mt-10 flex flex-col gap-6 pb-32">
        {#if draft.status === 'drafting' && roll}
          <div class="rounded-xl border border-border bg-card">
            <div
              class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"
            >
              <span class="font-display text-lg font-extrabold tracking-tight uppercase">
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
            <div class="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2"
                >
                  {#if rollFranchise}
                    <TeamLogo
                      {manifest}
                      franchiseId={rollFranchise.franchiseId}
                      teamExternalId={rollFranchise.teamExternalId}
                    />
                  {/if}
                  <span class="font-mono text-xs font-bold">
                    {franchiseAbbreviation(roll.franchiseId)}
                  </span>
                  {#if rollFranchise}
                    <span class="hidden text-xs text-muted-foreground sm:inline">
                      {rollFranchise.displayName}
                    </span>
                  {/if}
                </span>
                <span
                  class="flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2"
                >
                  <span class="font-mono text-xs font-bold">{rollEra?.label ?? roll.eraId}</span>
                </span>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!franchiseRerollAvailable}
                  title={franchiseRerollAvailable
                    ? 'Roll a different franchise'
                    : draft.rerolls.franchiseSpent
                      ? 'Already used'
                      : 'No alternative'}
                  onclick={rerollFranchise}
                  class="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Reroll franchise
                  {#if draft.rerolls.franchiseSpent}
                    <span
                      class="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.14em] uppercase"
                    >
                      Used
                    </span>
                  {/if}
                </button>
                <button
                  type="button"
                  disabled={!eraRerollAvailable}
                  title={eraRerollAvailable
                    ? 'Roll a different era'
                    : draft.rerolls.eraSpent
                      ? 'Already used'
                      : 'No alternative'}
                  onclick={rerollEra}
                  class="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Reroll era
                  {#if draft.rerolls.eraSpent}
                    <span
                      class="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.14em] uppercase"
                    >
                      Used
                    </span>
                  {/if}
                </button>
              </div>
            </div>
          </div>
          <p class="font-mono text-xs text-muted-foreground">
            Pick one player from this pool to advance.
          </p>
        {/if}

        {#if draft.status === 'drafting' && roll}
          <DraftPoolBrowser
            heading={poolHeading}
            rows={rollRows}
            {slots}
            {countLabel}
            {manifest}
            {presentation}
            filtersEditable={false}
            allowDisplacement={false}
            error={actionError}
            emptyMessage="No players in this pool."
            onpick={openPicker}
          />
        {:else if draft.status === 'complete'}
          <div class="rounded-xl border border-border bg-card">
            <div class="border-b border-border px-4 py-3">
              <h3 class="font-display text-lg font-extrabold tracking-tight uppercase">
                Draft complete
              </h3>
            </div>
            <ul class="flex flex-col divide-y divide-border/60">
              {#each draft.picks as pick (pick.round)}
                {@const row = rowForPick(pick)}
                <li class="flex items-center gap-3 px-4 py-3">
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
                      {row.seasonKey} · {row.positionsCanonical.join('/')} ·
                      {franchiseAbbreviation(row.franchiseId)}
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
        {/if}

        <LineupCourt
          {slots}
          {manifest}
          ready={draft.status === 'complete'}
          allowRemove={false}
          onmove={openPicker}
          onremove={() => undefined}
        />

        {#if draft.status === 'complete'}
          {#if actionError}
            <p
              class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            >
              {actionError}
            </p>
          {/if}
          <div>
            <button
              type="button"
              onclick={play82}
              disabled={starting}
              class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {starting ? 'Starting…' : 'Play 82 games'}
              <ArrowRight class="h-4 w-4" />
            </button>
          </div>
          <p class="font-mono text-[10px] text-muted-foreground">
            seed {draft.seed} · draft {draft.draftId}
          </p>
        {/if}
      </div>
    {/if}
  {/if}

  <SlotPickerDialog
    player={pickerPlayer}
    {slots}
    manifest={manifest!}
    {presentation}
    allowDisplacement={false}
    onplace={placePlayer}
    onclose={() => (pickerPlayer = null)}
  />
</section>
