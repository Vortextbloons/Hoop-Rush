<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowRight, Check, Lock, Plus, Search, X } from '@lucide/svelte';
  import { Dialog } from 'bits-ui';
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
  import { getManifest, getPlayersIndex, getPool } from '$lib/data';
  import { generateSeed, parseSandboxUrl } from '$lib/sandbox-url';
  import { startSandboxRun } from '$lib/sandbox-run';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import LineupCourt from '$lib/components/LineupCourt.svelte';

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
  let search = $state('');
  let positionFilter = $state<SlotIndex | null>(null);

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
  });

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

  const eraLabel = $derived(new Map((manifest?.eras ?? []).map((e) => [e.eraId, e.label])));

  const sortedRows = $derived.by(() => {
    if (!index) return [] as IndexRow[];
    return [...index.players].sort(
      (a, b) => b.overall - a.overall || a.displayName.localeCompare(b.displayName),
    );
  });

  const filteredRows = $derived.by(() => {
    let list = sortedRows;
    if (positionFilter !== null) {
      const requirement = slotRequirement(positionFilter);
      list = list.filter((p) => p.positionsCanonical.includes(requirement));
    }
    const query = search.trim().toLowerCase();
    if (query) {
      list = list.filter((p) => p.displayName.toLowerCase().includes(query));
    }
    return list;
  });

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

  type PickerOption = {
    index: number;
    incumbent: IndexRow | null;
    state: 'open' | 'self' | 'displace' | 'blocked' | 'cant-play';
    moveTarget: number | null;
    ariaLabel: string;
  };

  const pickerOptions = $derived.by((): PickerOption[] => {
    const subject = pickerPlayer;
    if (!subject) return [];
    const subjectSlot = slots.findIndex((p) => p !== null && p.playerId === subject.playerId);
    return SLOT_INDEXES.map((i) => {
      const incumbent = slots[i] ?? null;
      const slotName = `${SLOT_NAMES[i]} slot ${i + 1}`;
      if (!canFillSlot(subject, i)) {
        return {
          index: i,
          incumbent,
          state: 'cant-play',
          moveTarget: null,
          ariaLabel: `${subject.displayName} cannot play ${slotName}`,
        };
      }
      if (!incumbent) {
        return {
          index: i,
          incumbent: null,
          state: 'open',
          moveTarget: null,
          ariaLabel: `Place ${subject.displayName} at ${slotName}`,
        };
      }
      if (incumbent.playerId === subject.playerId) {
        return {
          index: i,
          incumbent,
          state: 'self',
          moveTarget: null,
          ariaLabel: `${subject.displayName} already at ${slotName}`,
        };
      }
      const target = displacementTargetFor(incumbent, i, subjectSlot);
      if (target !== null) {
        return {
          index: i,
          incumbent,
          state: 'displace',
          moveTarget: target,
          ariaLabel: `Place ${subject.displayName} at ${slotName}, moving ${incumbent.displayName} to ${SLOT_NAMES[target]} slot ${target + 1}`,
        };
      }
      return {
        index: i,
        incumbent,
        state: 'blocked',
        moveTarget: null,
        ariaLabel: `${slotName} occupied by ${incumbent.displayName}`,
      };
    });
  });

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
    pickerPlayer = null;
  }

  function openPicker(player: IndexRow) {
    pickerPlayer = player;
  }

  type PoolCardState = 'lineup' | 'place' | 'displace' | 'blocked';

  type PoolCardInfo = {
    state: PoolCardState;
    /** Who gets moved and where when this card's take-over is used. */
    displace: { incumbent: IndexRow; targetSlot: number } | null;
  };

  /**
   * Eligibility shown on the pool card itself, before any click. A player is
   * "place" whenever any eligible slot is open; the displace highlight is
   * reserved for the case where displacement is the only option.
   */
  function poolCardInfoFor(player: IndexRow): PoolCardInfo {
    if (slots.some((p) => p !== null && p.playerId === player.playerId)) {
      return { state: 'lineup', displace: null };
    }
    let displace: PoolCardInfo['displace'] = null;
    for (const i of SLOT_INDEXES) {
      if (!canFillSlot(player, i)) continue;
      const incumbent = slots[i] ?? null;
      if (!incumbent) return { state: 'place', displace: null };
      if (displace === null) {
        const target = displacementTargetFor(incumbent, i, -1);
        if (target !== null) displace = { incumbent, targetSlot: target };
      }
    }
    return displace !== null
      ? { state: 'displace', displace }
      : { state: 'blocked', displace: null };
  }

  function removePlayer(slotIndex: number) {
    slots[slotIndex] = null;
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
    {:else}
      <div class="mt-10 flex flex-col gap-6 pb-32">
        <div class="rounded-xl border border-border bg-card">
          <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 class="font-display text-lg font-extrabold tracking-tight uppercase">
              All players
            </h2>
            <span
              class="shrink-0 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase"
            >
              {sortedRows.length} players · sorted by OVER
            </span>
          </div>
          <div class="flex flex-col gap-2 border-b border-border p-2">
            <div class="relative">
              <Search
                class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                bind:value={search}
                placeholder="Search players…"
                aria-label="Search players by name"
                class="h-10 w-full rounded-lg border border-input bg-surface-1 pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div
              class="flex items-center gap-1 overflow-x-auto pb-0.5"
              role="group"
              aria-label="Filter by position"
            >
              <button
                type="button"
                aria-pressed={positionFilter === null}
                onclick={() => (positionFilter = null)}
                class="shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px] font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {positionFilter ===
                null
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-line-strong hover:text-foreground'}"
              >
                All
              </button>
              {#each SLOT_INDEXES as i (i)}
                <button
                  type="button"
                  aria-pressed={positionFilter === i}
                  onclick={() => (positionFilter = positionFilter === i ? null : i)}
                  class="shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px] font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {positionFilter ===
                  i
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:border-line-strong hover:text-foreground'}"
                >
                  {SLOT_LABELS[i]}
                </button>
              {/each}
              <span class="ml-auto shrink-0 pl-1 font-mono text-[10px] text-muted-foreground">
                {filteredRows.length}/{sortedRows.length}
              </span>
            </div>
          </div>
          {#if runError}
            <p class="border-b border-border/60 p-4 text-sm text-destructive">{runError}</p>
          {/if}
          {#if filteredRows.length === 0}
            <p class="p-6 text-center font-mono text-xs text-muted-foreground">No players match.</p>
          {:else}
            <ul
              class="grid max-h-[55vh] gap-1 overflow-y-auto p-2 sm:max-h-[560px] sm:grid-cols-2 xl:grid-cols-3"
            >
              {#each filteredRows as player (player.franchiseId + '/' + player.eraId + '/' + player.playerId)}
                {@const card = poolCardInfoFor(player)}
                {@const cardState = card.state}
                <li>
                  <button
                    type="button"
                    disabled={cardState === 'blocked'}
                    aria-disabled={cardState === 'blocked' ? 'true' : undefined}
                    onclick={() => openPicker(player)}
                    class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left {cardState ===
                    'lineup'
                      ? 'border-primary/50 bg-primary/10 opacity-60'
                      : cardState === 'displace'
                        ? 'border-accent/50 bg-accent/10 opacity-90 shadow-[0_0_8px_hsl(42_91%_61%/0.15)] hover:bg-accent/20 hover:opacity-100'
                        : cardState === 'blocked'
                          ? 'border-transparent opacity-40 disabled:cursor-not-allowed'
                          : 'border-transparent hover:border-border hover:bg-surface-2'}"
                  >
                    <PlayerFace
                      {player}
                      {manifest}
                      size="md"
                      fallbackInitials={player.firstName[0]! + player.lastName[0]!}
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-bold">{player.displayName}</span>
                      <span class="block font-mono text-[10px] text-muted-foreground">
                        {player.seasonKey} · {franchiseAbbreviation(player.franchiseId)} · {eraLabel.get(
                          player.eraId,
                        ) ?? player.eraId} · {player.positionsCanonical.join('/')}
                      </span>
                    </span>
                    <span class="flex shrink-0 gap-1 font-mono text-[10px]">
                      <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Overall">
                        O {player.overall}
                      </span>
                      {#if cardState === 'displace' && card.displace}
                        <span
                          class="rounded bg-accent/25 px-1.5 py-0.5 font-bold text-accent"
                          title={`Moves ${card.displace.incumbent.displayName} to ${SLOT_NAMES[card.displace.targetSlot]}`}
                        >
                          Moves {card.displace.incumbent.displayName.split(' ').pop()}
                        </span>
                      {:else if cardState === 'blocked'}
                        <span
                          class="rounded bg-surface-3 px-1.5 py-0.5 text-muted-foreground"
                          title="No open or movable position"
                        >
                          No slot
                        </span>
                      {/if}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

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

  <Dialog.Root
    open={pickerPlayer !== null}
    onOpenChange={(open) => {
      if (!open) pickerPlayer = null;
    }}
  >
    <Dialog.Portal>
      <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
      <Dialog.Content
        class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
      >
        {#if pickerPlayer}
          {@const subject = pickerPlayer}
          <div class="flex items-start justify-between gap-3">
            <div class="flex min-w-0 items-center gap-3">
              <PlayerFace
                player={subject}
                manifest={manifest!}
                size="sm"
                fallbackInitials={subject.firstName[0]! + subject.lastName[0]!}
              />
              <div class="min-w-0">
                <Dialog.Title
                  class="font-display truncate text-lg font-extrabold tracking-tight uppercase"
                >
                  {subject.displayName}
                </Dialog.Title>
                <p class="font-mono text-[10px] text-muted-foreground">
                  {subject.seasonKey} · {subject.positionsCanonical.join('/')} · O
                  {subject.overall}
                </p>
              </div>
            </div>
            <Dialog.Close
              aria-label="Cancel"
              class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
            >
              <X class="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div class="mt-4 flex flex-col gap-2">
            {#each pickerOptions as opt (opt.index)}
              {@const label = SLOT_LABELS[opt.index]}
              <button
                type="button"
                aria-label={opt.ariaLabel}
                disabled={opt.state === 'self' ||
                  opt.state === 'blocked' ||
                  opt.state === 'cant-play'}
                onclick={() => placePlayer(subject, opt.index)}
                class="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed {opt.state ===
                'open'
                  ? 'border-primary/50 bg-primary/5 hover:bg-primary/10'
                  : opt.state === 'displace'
                    ? 'border-accent/60 bg-accent/10 hover:bg-accent/15'
                    : opt.state === 'self'
                      ? 'border-primary/40 bg-primary/10 opacity-70'
                      : 'border-border bg-surface-1 opacity-45'}"
              >
                <span
                  class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-sm font-extrabold {opt.state ===
                  'displace'
                    ? 'text-accent'
                    : 'text-primary'}"
                >
                  {label}
                </span>
                <span class="min-w-0 flex-1">
                  {#if opt.incumbent}
                    <span class="block truncate text-sm font-bold">
                      {opt.incumbent.displayName}
                    </span>
                    <span class="block font-mono text-[10px] text-muted-foreground">
                      {opt.incumbent.seasonKey} · {opt.incumbent.positionsCanonical.join('/')}
                    </span>
                  {:else}
                    <span class="block truncate text-sm font-semibold">Open {label} slot</span>
                  {/if}
                </span>
                <span class="flex shrink-0 items-center gap-1.5">
                  {#if opt.state === 'self'}
                    <Check class="h-4 w-4 text-primary" />
                    <span class="font-mono text-[10px] tracking-wide uppercase">Current</span>
                  {:else if opt.state === 'displace' && opt.moveTarget !== null}
                    <ArrowRight class="h-4 w-4 shrink-0 text-accent" />
                    <span class="font-mono text-[10px] tracking-wide uppercase text-accent">
                      Moves {opt.incumbent!.displayName.split(' ').pop()} to
                      {SLOT_LABELS[opt.moveTarget]}
                    </span>
                  {:else if opt.state === 'blocked'}
                    <Lock class="h-4 w-4 shrink-0" />
                    <span class="font-mono text-[10px] tracking-wide uppercase">Occupied</span>
                  {:else if opt.state === 'cant-play'}
                    <span class="font-mono text-[10px] tracking-wide uppercase">Can't play</span>
                  {:else}
                    <Plus class="h-4 w-4 shrink-0 text-primary" />
                  {/if}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
</section>
