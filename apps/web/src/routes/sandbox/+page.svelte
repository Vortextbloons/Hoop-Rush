<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowRight, Check, ChevronDown } from '@lucide/svelte';
  import { Select } from 'bits-ui';
  import { SvelteMap } from 'svelte/reactivity';
  import type {
    HoopRushManifest,
    PeakPlayerSeason,
    PlayersIndex,
    PlayersIndexEntry,
    SlotIndex,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { canPlay, slotRequirement, validateLineup } from '@hoop-rush/engine';
  import { clearDataLoaderCaches, getManifest, getPlayersIndex, getPool } from '$lib/data';
  import { generateSeed, parseSandboxUrl } from '$lib/sandbox-url';
  import { startSandboxRun } from '$lib/sandbox-run';
  import { poolSortLabel, sortDraftRows } from '$lib/draft-presentation';
  import TeamLogo from '$lib/components/TeamLogo.svelte';
  import LineupCourt from '$lib/components/LineupCourt.svelte';
  import DraftPoolBrowser from '$lib/components/draft/DraftPoolBrowser.svelte';
  import SlotPickerDialog from '$lib/components/draft/SlotPickerDialog.svelte';
  import AsyncState from '$lib/components/AsyncState.svelte';

  type IndexRow = PlayersIndexEntry;

  /** One slot ref: enough to locate a peak player-season in the index and pools. */
  type SlotRef = { playerId: string; franchiseId: string; eraId: string };

  const SLOT_LABELS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
  const SLOT_REQUIREMENTS = ['G', 'G', 'F', 'F', 'C'] as const;
  const SLOT_NAMES = [
    'Point Guard',
    'Shooting Guard',
    'Small Forward',
    'Power Forward',
    'Center',
  ] as const;
  const SLOT_INDEXES = [0, 1, 2, 3, 4] as const;

  let manifest = $state.raw<HoopRushManifest | null>(null);
  let manifestError: string | null = $state(null);
  let index = $state.raw<PlayersIndex | null>(null);
  let indexError: string | null = $state(null);
  let runError: string | null = $state(null);

  let starting = $state(false);

  let slots = $state<(IndexRow | null)[]>([null, null, null, null, null]);
  let pickerPlayer = $state<IndexRow | null>(null);
  let pickerTrigger = $state<HTMLElement | null>(null);
  let pickerFallbackId = $state<string | null>(null);
  /** Empty string means no filter (show all teams/decades). */
  let franchiseFilter = $state('');
  let eraFilter = $state('');

  function loadSandboxData() {
    manifestError = null;
    indexError = null;
    manifest = null;
    index = null;
    let cancelled = false;
    getManifest().then(
      (m) => {
        if (cancelled) return;
        manifest = m;
        getPlayersIndex().then(
          (ix) => {
            if (cancelled) return;
            index = ix;
            restoreUrlState(m, ix);
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
  }

  $effect(() => loadSandboxData());

  function retrySandboxData() {
    clearDataLoaderCaches();
    loadSandboxData();
  }

  /**
   * Restores a draft carried in the URL (five player selections plus an
   * optional seed) so "edit lineup" returns to the exact same draft. The
   * selections are re-validated against the manifest and the players index;
   * the underlying pools are loaded so full records are available for Play.
   */
  function restoreUrlState(m: HoopRushManifest, ix: PlayersIndex) {
    if (slots.some((p) => p !== null)) return;
    if (typeof window === 'undefined') return;
    const result = parseSandboxUrl(new URL(window.location.href), m, ix);
    if (!result.ok || !result.state) return;
    const rows = result.state.slots.map((sel) =>
      ix.players.find(
        (p) =>
          p.playerId === sel.playerId && p.franchiseId === sel.franchiseId && p.eraId === sel.eraId,
      ),
    );
    if (rows.some((row) => row === undefined)) return;
    const filled = rows.filter((row): row is IndexRow => row !== undefined);
    resolveRefsToPlayers(result.state.slots).then(
      () => {
        slots = filled;
        pickerPlayer = null;
      },
      () => {
        // Invalid draft state falls back to an empty board.
      },
    );
  }

  const franchise = $derived(
    manifest?.modernFranchiseSlots.find((e) => e.franchiseId === franchiseFilter) ?? null,
  );
  const era = $derived(manifest?.eras.find((e) => e.eraId === eraFilter) ?? null);

  const franchiseItems = $derived([
    { value: '', label: 'Any team' },
    ...(manifest?.modernFranchiseSlots ?? []).map((entry) => ({
      value: entry.franchiseId,
      label: entry.displayName,
    })),
  ]);

  const eraItems = $derived([
    { value: '', label: 'Any decade' },
    ...(manifest?.eras ?? []).map((e) => ({
      value: e.eraId,
      label: e.label,
    })),
  ]);

  const poolRows = $derived.by(() => {
    let list = index?.players ?? [];
    if (franchiseFilter) list = list.filter((p) => p.franchiseId === franchiseFilter);
    if (eraFilter) list = list.filter((p) => p.eraId === eraFilter);
    return list;
  });

  const sortedRows = $derived(sortDraftRows(poolRows, 'sandbox'));

  const poolHeading = $derived(
    franchise && era
      ? `${franchiseAbbreviation(franchise.franchiseId)} · ${era.label}`
      : franchise
        ? franchiseAbbreviation(franchise.franchiseId)
        : era
          ? era.label
          : 'All players',
  );

  const countLabel = $derived(`${poolRows.length} players · ${poolSortLabel('sandbox')}`);

  function selectFranchise(id: string) {
    franchiseFilter = id;
  }

  function selectEra(id: string) {
    eraFilter = id;
  }

  function canFillSlot(player: IndexRow, slotIndex: number): boolean {
    return canPlay(player.positionsCanonical, slotRequirement(slotIndex as SlotIndex));
  }

  /**
   * Where a displaced incumbent can land: the first open slot it can fill,
   * including the slot the incoming player is vacating. Returns null when the
   * incumbent cannot move anywhere.
   */
  function displacementTargetFor(
    incumbent: IndexRow,
    targetSlot: number,
    subjectSlot: number,
  ): number | null {
    for (const i of SLOT_INDEXES) {
      if (i === targetSlot) continue;
      const willBeOpen = i === subjectSlot || slots[i] === null;
      if (!willBeOpen) continue;
      if (canFillSlot(incumbent, i)) return i;
    }
    return null;
  }

  /** Place the player at a slot, moving any movable incumbent out of the way. */
  function placePlayer(subject: IndexRow, slotIndex: number) {
    const subjectSlot = slots.findIndex((p) => p !== null && p.playerId === subject.playerId);
    const incumbent = slots[slotIndex];
    if (incumbent && incumbent.playerId !== subject.playerId) {
      const target = displacementTargetFor(incumbent, slotIndex, subjectSlot);
      if (target === null) return;
      slots[target] = incumbent;
    }
    slots[slotIndex] = subject;
    if (subjectSlot !== -1 && subjectSlot !== slotIndex) slots[subjectSlot] = null;
    closePicker();
  }

  function openPicker(player: IndexRow) {
    pickerTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pickerFallbackId = pickerTrigger?.closest<HTMLElement>('[id^="court-slot-"]')?.id ?? null;
    pickerPlayer = player;
  }

  function closePicker() {
    pickerPlayer = null;
    const trigger = pickerTrigger;
    const fallback = pickerFallbackId;
    pickerTrigger = null;
    pickerFallbackId = null;
    queueMicrotask(() => {
      if (trigger?.isConnected) {
        trigger.focus();
      } else if (fallback) {
        document.getElementById(fallback)?.focus();
      }
    });
  }

  function removePlayer(slotIndex: number) {
    slots[slotIndex] = null;
    queueMicrotask(() => document.getElementById(`court-slot-${String(slotIndex)}`)?.focus());
  }

  const pickedCount = $derived(slots.filter((p) => p !== null).length);

  const lineupIsLegal = $derived.by(() => {
    if (slots.some((p) => p === null)) return false;
    return validateLineup({
      structure: [...SLOT_REQUIREMENTS],
      assignments: slots.map((player, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: player!.playerId,
        positions: player!.positionsCanonical,
      })),
    }).ok;
  });

  const ready = $derived(lineupIsLegal && manifest !== null && index !== null);

  /**
   * Loads the full peak records behind the picked index rows via their
   * franchise-era pools, in slot order.
   */
  async function resolveRefsToPlayers(refs: SlotRef[]): Promise<PeakPlayerSeason[]> {
    const byKey = new SvelteMap<string, SvelteMap<string, PeakPlayerSeason>>();
    for (const key of new Set(refs.map((r) => `${r.franchiseId}/${r.eraId}`))) {
      const slash = key.indexOf('/');
      const poolEntry = manifest?.pools.find(
        (p) => p.franchiseId === key.slice(0, slash) && p.eraId === key.slice(slash + 1),
      );
      if (!poolEntry) throw new Error(`Pool unavailable for ${key}.`);
      const pool = await getPool(poolEntry);
      byKey.set(key, new SvelteMap(pool.players.map((p) => [p.playerId, p])));
    }
    return refs.map((ref) => {
      const player = byKey.get(`${ref.franchiseId}/${ref.eraId}`)?.get(ref.playerId);
      if (!player) throw new Error(`Drafted player ${ref.playerId} is unavailable.`);
      return player;
    });
  }

  /** Resolves the picked players, then starts and persists the 82-game run. */
  async function play82() {
    if (!ready || !index || !manifest) return;
    starting = true;
    runError = null;
    try {
      const picked = slots.filter((p): p is IndexRow => p !== null);
      const refs = picked.map((p) => ({
        playerId: p.playerId,
        franchiseId: p.franchiseId,
        eraId: p.eraId,
      }));
      const resolved = await resolveRefsToPlayers(refs);
      await startSandboxRun(resolved, generateSeed());
    } catch (e) {
      runError = e instanceof Error ? e.message : String(e);
      starting = false;
    }
  }
</script>

<svelte:head>
  <title>Sandbox — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <div class="flex items-end justify-between gap-4">
    <div>
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Sandbox</p>
      <h1
        class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
      >
        Draft any five
      </h1>
      <p class="mt-3 max-w-xl text-sm text-muted-foreground">
        Five players, any franchise, any era. Build a lineup from every peak player-season and take
        it 82-0.
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
    <div class="mt-8">
      <AsyncState
        kind="error"
        title="Data unavailable"
        message={`Failed to load data: ${manifestError}`}
        retry={retrySandboxData}
      />
    </div>
  {:else if !manifest}
    <div class="mt-8">
      <AsyncState
        kind="loading"
        title="Loading sandbox data"
        message="Preparing the player index…"
      />
    </div>
  {:else}
    {#if indexError}
      <div class="mt-8">
        <AsyncState
          kind="error"
          title="Players unavailable"
          message={`Failed to load players: ${indexError}`}
          retry={retrySandboxData}
        />
      </div>
    {:else if !index}
      <div class="mt-8">
        <AsyncState kind="loading" title="Loading player index" message="One moment…" />
      </div>
    {:else}
      <div class="mt-10 flex flex-col gap-6 pb-32">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <h2
              id="sandbox-team-label"
              class="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase"
            >
              Team
            </h2>
            <Select.Root
              type="single"
              value={franchiseFilter}
              onValueChange={selectFranchise}
              items={franchiseItems}
            >
              <Select.Trigger
                aria-labelledby="sandbox-team-label"
                class="mt-2 flex h-11 w-full items-center justify-between gap-3 rounded-lg border border-input bg-card px-3.5 text-sm font-semibold text-foreground outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Select.Value placeholder="Any team…">
                  {#snippet children(props)}
                    {#if franchise}
                      <span class="flex min-w-0 items-center gap-2.5">
                        <TeamLogo
                          manifest={manifest!}
                          franchiseId={franchise.franchiseId}
                          teamExternalId={franchise.teamExternalId}
                        />
                        <span class="truncate" title={franchise.displayName}>
                          {franchiseAbbreviation(franchise.franchiseId)}
                        </span>
                      </span>
                    {:else}
                      <span class="font-normal text-muted-foreground">{props.placeholder}</span>
                    {/if}
                  {/snippet}
                </Select.Value>
                <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
              </Select.Trigger>
              <Select.Portal>
                <Select.Content
                  side="bottom"
                  sideOffset={6}
                  align="start"
                  collisionPadding={12}
                  class="z-50 min-w-64 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover p-1 shadow-2xl shadow-black/30"
                >
                  <Select.Viewport
                    class="max-h-[min(20rem,55vh)] overflow-y-auto overscroll-contain p-0.5"
                  >
                    <Select.Item
                      value=""
                      label="Any team"
                      aria-label="Any team"
                      class="cursor-pointer select-none rounded-md outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[selected]:bg-primary/10"
                    >
                      {#snippet children({ selected })}
                        <span class="flex w-full items-center gap-2.5 py-1 pr-1 pl-0.5">
                          <span class="min-w-0 flex-1 truncate text-sm font-semibold">Any team</span
                          >
                          {#if selected}
                            <Check class="h-4 w-4 shrink-0 text-primary" />
                          {/if}
                        </span>
                      {/snippet}
                    </Select.Item>
                    {#each manifest.modernFranchiseSlots as entry (entry.franchiseId)}
                      <Select.Item
                        value={entry.franchiseId}
                        label={entry.displayName}
                        aria-label={`${franchiseAbbreviation(entry.franchiseId)} — ${entry.displayName}`}
                        class="cursor-pointer select-none rounded-md outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[selected]:bg-primary/10"
                      >
                        {#snippet children({ selected })}
                          <span class="flex w-full items-center gap-2.5 py-1 pr-1 pl-0.5">
                            <TeamLogo
                              manifest={manifest!}
                              franchiseId={entry.franchiseId}
                              teamExternalId={entry.teamExternalId}
                            />
                            <span class="min-w-0 flex-1 truncate text-sm font-semibold">
                              {franchiseAbbreviation(entry.franchiseId)}
                            </span>
                            {#if selected}
                              <Check class="h-4 w-4 shrink-0 text-primary" />
                            {/if}
                          </span>
                        {/snippet}
                      </Select.Item>
                    {/each}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </div>

          <div>
            <h2
              id="sandbox-decade-label"
              class="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase"
            >
              Decade
            </h2>
            <Select.Root type="single" value={eraFilter} onValueChange={selectEra} items={eraItems}>
              <Select.Trigger
                aria-labelledby="sandbox-decade-label"
                class="mt-2 flex h-11 w-full items-center justify-between gap-3 rounded-lg border border-input bg-card px-3.5 text-sm font-semibold text-foreground outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Select.Value placeholder="Any decade…">
                  {#snippet children(props)}
                    {#if era}
                      <span class="truncate font-mono">{era.label}</span>
                    {:else}
                      <span class="font-normal text-muted-foreground">{props.placeholder}</span>
                    {/if}
                  {/snippet}
                </Select.Value>
                <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
              </Select.Trigger>
              <Select.Portal>
                <Select.Content
                  side="bottom"
                  sideOffset={6}
                  align="start"
                  collisionPadding={12}
                  class="z-50 min-w-48 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover p-1 shadow-2xl shadow-black/30"
                >
                  <Select.Viewport
                    class="max-h-[min(20rem,55vh)] overflow-y-auto overscroll-contain p-0.5"
                  >
                    <Select.Item
                      value=""
                      label="Any decade"
                      aria-label="Any decade"
                      class="cursor-pointer select-none rounded-md outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[selected]:bg-primary/10"
                    >
                      {#snippet children({ selected })}
                        <span class="flex w-full items-center gap-2.5 py-1 pr-1 pl-0.5">
                          <span class="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
                            Any decade
                          </span>
                          {#if selected}
                            <Check class="h-4 w-4 shrink-0 text-primary" />
                          {/if}
                        </span>
                      {/snippet}
                    </Select.Item>
                    {#each manifest.eras as e (e.eraId)}
                      <Select.Item
                        value={e.eraId}
                        label={e.label}
                        class="cursor-pointer select-none rounded-md outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[selected]:bg-primary/10"
                      >
                        {#snippet children({ selected })}
                          <span class="flex w-full items-center gap-2.5 py-1 pr-1 pl-0.5">
                            <span class="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
                              {e.label}
                            </span>
                            {#if selected}
                              <Check class="h-4 w-4 shrink-0 text-primary" />
                            {/if}
                          </span>
                        {/snippet}
                      </Select.Item>
                    {/each}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </div>
        </div>

        <DraftPoolBrowser
          heading={poolHeading}
          rows={sortedRows}
          {slots}
          {countLabel}
          {manifest}
          presentation="sandbox"
          filtersEditable
          error={null}
          emptyMessage="No players match."
          onpick={openPicker}
        />

        {#if runError}
          <AsyncState
            kind="error"
            title="Run could not start"
            message={runError}
            retry={play82}
            retryLabel="Try again"
          />
        {/if}

        <LineupCourt
          {slots}
          {manifest}
          ready={lineupIsLegal}
          onmove={openPicker}
          onremove={removePlayer}
        />
        {#if ready}
          <div class="mt-4">
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
        {/if}
      </div>

      <nav
        aria-label="Lineup summary"
        class="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      >
        <div
          class="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6"
        >
          <a
            href="#your-five"
            class="font-display text-sm font-extrabold tracking-tight uppercase transition-colors hover:text-primary"
          >
            Your five
          </a>
          <span class="flex gap-1 sm:gap-1.5">
            {#each SLOT_LABELS as label, slotIndex (slotIndex)}
              <a
                href="#court-slot-{slotIndex}"
                aria-label={`${SLOT_NAMES[slotIndex]} slot: {slots[slotIndex]?.displayName ?? 'empty'}`}
                class="grid h-7 w-7 place-items-center rounded-md text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8 {slots[
                  slotIndex
                ]
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-muted-foreground transition-colors hover:border-line-strong hover:text-foreground'}"
              >
                {label}
              </a>
            {/each}
          </span>
          <span class="ml-auto font-mono text-xs text-muted-foreground">
            Picked {pickedCount} of 5
          </span>
        </div>
      </nav>
    {/if}
  {/if}

  <SlotPickerDialog
    player={pickerPlayer}
    {slots}
    manifest={manifest!}
    presentation="sandbox"
    allowDisplacement
    onplace={placePlayer}
    onclose={closePicker}
  />
</section>
