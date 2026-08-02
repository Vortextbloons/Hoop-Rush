<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowRight, Check, ChevronDown, Lock, Plus, Search, X } from '@lucide/svelte';
  import { Dialog, Select } from 'bits-ui';
  import type {
    FranchiseEraPool,
    HoopRushManifest,
    PeakPlayerSeason,
    PoolAvailability,
    SlotIndex,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { canPlay, slotRequirement, validateLineup } from '@hoop-rush/engine';
  import { getManifest, getPool } from '$lib/data';
  import { generateSeed, parseSandboxUrl } from '$lib/sandbox-url';
  import { startSandboxRun } from '$lib/sandbox-run';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import TeamLogo from '$lib/components/TeamLogo.svelte';
  import LineupCourt from '$lib/components/LineupCourt.svelte';

  type PeakPlayer = FranchiseEraPool['players'][number];

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
  let runError: string | null = $state(null);

  let franchiseId = $state('');
  let eraId = $state('');

  let pool = $state.raw<FranchiseEraPool | null>(null);
  let poolError: string | null = $state(null);
  let loadingPool = $state(false);

  let starting = $state(false);

  let slots = $state<(PeakPlayer | null)[]>([null, null, null, null, null]);
  let pickerPlayer = $state<PeakPlayer | null>(null);
  let search = $state('');
  let positionFilter = $state<SlotIndex | null>(null);

  $effect(() => {
    let cancelled = false;
    getManifest().then(
      (m) => {
        if (!cancelled) {
          manifest = m;
          restoreUrlState(m);
        }
      },
      (error: unknown) => {
        if (!cancelled) manifestError = error instanceof Error ? error.message : String(error);
      },
    );
    return () => {
      cancelled = true;
    };
  });

  /** Restores a draft carried in the URL (franchise, era, and five picks). */
  function restoreUrlState(m: HoopRushManifest) {
    if (franchiseId || eraId) return;
    if (typeof window === 'undefined') return;
    const result = parseSandboxUrl(new URL(window.location.href), m);
    if (!result.ok || !result.state) return;
    franchiseId = result.state.franchiseId;
    eraId = result.state.eraId;
    pendingUrlSlots = result.state.slots ?? null;
  }

  /** Five player ids from the URL, applied once the pool finishes loading. */
  let pendingUrlSlots: string[] | null = null;

  const franchise = $derived(
    manifest?.modernFranchiseSlots.find((e) => e.franchiseId === franchiseId) ?? null,
  );
  const era = $derived(manifest?.eras.find((e) => e.eraId === eraId) ?? null);

  /** Availability of the selected pair, read directly from the matrix. */
  const selectedAvailability = $derived<PoolAvailability | null>(
    manifest && franchiseId && eraId
      ? (manifest.availability.find(
          (entry) => entry.franchiseId === franchiseId && entry.eraId === eraId,
        ) ?? null)
      : null,
  );

  /** Every slot x era matrix entry, for the availability legend. */
  const availabilityMatrix = $derived(
    manifest
      ? new Map(
          manifest.availability.map((entry) => [
            `${entry.franchiseId}/${entry.eraId}`,
            entry,
          ]),
        )
      : new Map<string, PoolAvailability>(),
  );

  const franchiseItems = $derived(
    (manifest?.modernFranchiseSlots ?? []).map((entry) => ({
      value: entry.franchiseId,
      label: entry.displayName,
    })),
  );

  const eraItems = $derived(
    (manifest?.eras ?? []).map((e) => ({
      value: e.eraId,
      label: e.label,
    })),
  );

  const eraLabel = $derived(new Map((manifest?.eras ?? []).map((e) => [e.eraId, e.label])));

  function selectFranchise(id: string) {
    franchiseId = id;
    slots = [null, null, null, null, null];
  }

  function selectEra(id: string) {
    eraId = id;
    slots = [null, null, null, null, null];
  }

  /** Loads the compact pool for the selected pair after both selectors are set. */
  $effect(() => {
    if (!manifest || !franchiseId || !eraId) return;
    const availability = availabilityMatrix.get(`${franchiseId}/${eraId}`);
    if (!availability || availability.status !== 'available') {
      pool = null;
      loadingPool = false;
      return;
    }
    const entry = manifest.pools.find(
      (p) => p.franchiseId === franchiseId && p.eraId === eraId,
    );
    if (!entry) {
      pool = null;
      poolError = 'The pool index entry is unavailable.';
      return;
    }
    let cancelled = false;
    loadingPool = true;
    poolError = null;
    getPool(entry).then(
      (p) => {
        if (cancelled) return;
        pool = p;
        loadingPool = false;
        // Restore URL-drafted picks once the pool is available.
        if (pendingUrlSlots !== null && slots.every((s) => s === null)) {
          const byId = new Map(p.players.map((player) => [player.playerId, player]));
          const restored = pendingUrlSlots.map((id) => byId.get(id) ?? null);
          if (restored.every((player) => player !== null)) {
            slots = restored as PeakPlayer[];
          }
          pendingUrlSlots = null;
        }
      },
      (error: unknown) => {
        if (cancelled) return;
        pool = null;
        loadingPool = false;
        poolError = error instanceof Error ? error.message : String(error);
      },
    );
    return () => {
      cancelled = true;
    };
  });

  const poolRows = $derived(pool?.players ?? []);

  const filteredRows = $derived.by(() => {
    let list = poolRows;
    if (positionFilter !== null) {
      const requirement = slotRequirement(positionFilter);
      list = list.filter((p) => p.positions.canonical.includes(requirement));
    }
    const query = search.trim().toLowerCase();
    if (query) {
      list = list.filter((p) => p.displayName.toLowerCase().includes(query));
    }
    return list;
  });

  const poolHeading = $derived(
    franchise && era
      ? `${franchiseAbbreviation(franchise.franchiseId)} · ${era.label}`
      : franchise
        ? franchiseAbbreviation(franchise.franchiseId)
        : era
          ? era.label
          : 'Choose a franchise and decade',
  );

  /** Historical aliases represented in the pool, from the lineage table. */
  const poolAliases = $derived.by(() => {
    if (!pool || !manifest) return [];
    const seasonKeys = new Set(pool.players.map((p) => p.seasonKey));
    const aliases = new Set<string>();
    for (const segment of manifest.franchiseLineage) {
      if (segment.modernFranchiseId !== pool.franchiseId) continue;
      const overlap = [...seasonKeys].some(
        (season) =>
          season >= segment.validFromSeasonKey &&
          (segment.validThroughSeasonKey === undefined || season <= segment.validThroughSeasonKey),
      );
      if (overlap) aliases.add(segment.displayName);
    }
    return [...aliases].sort();
  });

  function canFillSlot(player: PeakPlayer, slotIndex: number): boolean {
    return canPlay(player.positions.canonical, slotRequirement(slotIndex as SlotIndex));
  }

  /**
   * Where a displaced incumbent can land: the first open slot it can fill,
   * including the slot the incoming player is vacating. Returns null when the
   * incumbent cannot move anywhere.
   */
  function displacementTargetFor(
    incumbent: PeakPlayer,
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
    incumbent: PeakPlayer | null;
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
  function placePlayer(subject: PeakPlayer, slotIndex: number) {
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

  function openPicker(player: PeakPlayer) {
    pickerPlayer = player;
  }

  type PoolCardState = 'lineup' | 'place' | 'displace' | 'blocked';

  type PoolCardInfo = {
    state: PoolCardState;
    /** Who gets moved and where when this card's take-over is used. */
    displace: { incumbent: PeakPlayer; targetSlot: number } | null;
  };

  /**
   * Eligibility shown on the pool card itself, before any click. A player is
   * "place" whenever any eligible slot is open; the displace highlight is
   * reserved for the case where displacement is the only option.
   */
  function poolCardInfoFor(player: PeakPlayer): PoolCardInfo {
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
        positions: player!.positions.canonical,
      })),
    }).ok;
  });

  const ready = $derived(
    lineupIsLegal && pool !== null && selectedAvailability?.status === 'available',
  );

  /** Starts and persists the 82-game run for the picked five. */
  async function play82() {
    if (!ready || !pool) return;
    starting = true;
    runError = null;
    try {
      const picked = slots.filter((p): p is PeakPlayer => p !== null);
      await startSandboxRun(picked, generateSeed());
    } catch (e) {
      runError = e instanceof Error ? e.message : String(e);
      starting = false;
    }
  }

  function unavailableReasonText(entry: PoolAvailability): string {
    if (entry.status === 'available') return '';
    switch (entry.reason) {
      case 'no-franchise-history':
        return entry.firstSupportedSeason
          ? `No franchise history in this decade (first supported season ${entry.firstSupportedSeason})`
          : 'No franchise history in this decade';
      case 'source-incomplete':
        return 'Historical source data is incomplete for this decade';
      case 'identity-failed':
        return 'Team identities could not be resolved for this decade';
      case 'insufficient-players':
        return 'Too few eligible players to build a roster';
      case 'position-coverage-failed':
        return 'Cannot form a legal G,G,F,F,C lineup';
      case 'confidence-failed':
        return 'Historical data confidence is below the release policy';
      case 'calibration-failed':
        return 'Simulation calibration did not pass for this decade';
      default:
        return 'Unavailable';
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
        Draft a franchise decade
      </h1>
      <p class="mt-3 max-w-xl text-sm text-muted-foreground">
        Pick one franchise and one decade, choose five peak player-seasons from that pool, and take
        them 82-0 against every NBA franchise.
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
    <div class="mt-8 grid gap-6 sm:grid-cols-2">
      <div>
        <h2
          id="sandbox-franchise-label"
          class="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase"
        >
          Franchise
        </h2>
        <Select.Root
          type="single"
          value={franchiseId}
          onValueChange={selectFranchise}
          items={franchiseItems}
        >
          <Select.Trigger
            aria-labelledby="sandbox-franchise-label"
            class="mt-3 flex h-12 w-full items-center justify-between gap-3 rounded-lg border border-input bg-card px-3.5 text-sm font-semibold text-foreground outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Select.Value placeholder="Choose a franchise…">
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
        <Select.Root type="single" value={eraId} onValueChange={selectEra} items={eraItems}>
          <Select.Trigger
            aria-labelledby="sandbox-decade-label"
            class="mt-3 flex h-12 w-full items-center justify-between gap-3 rounded-lg border border-input bg-card px-3.5 text-sm font-semibold text-foreground outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Select.Value placeholder="Choose a decade…">
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

    {#if franchiseId && eraId}
      {#if selectedAvailability && selectedAvailability.status === 'unavailable'}
        <div
          class="mt-6 rounded-xl border border-border bg-card p-5"
          role="status"
          aria-live="polite"
        >
          <p class="font-display text-lg font-extrabold tracking-tight uppercase">
            {franchiseAbbreviation(franchiseId)} · {eraLabel.get(eraId) ?? eraId}
          </p>
          <p class="mt-2 text-sm text-muted-foreground">{unavailableReasonText(selectedAvailability)}</p>
          {#if selectedAvailability.detail}
            <p class="mt-1 font-mono text-[11px] text-muted-foreground">
              {selectedAvailability.detail}
            </p>
          {/if}
        </div>
      {:else if loadingPool}
        <p class="mt-8 font-mono text-sm text-muted-foreground">Loading pool…</p>
      {:else if poolError}
        <p class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {poolError}
        </p>
      {:else if pool}
        <div class="mt-10 flex flex-col gap-6 pb-32">
          <div class="rounded-xl border border-border bg-card">
            <div class="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div class="min-w-0">
                <h2 class="font-display text-lg font-extrabold tracking-tight uppercase">
                  {poolHeading}
                </h2>
                {#if poolAliases.length > 0}
                  <p class="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                    {poolAliases.join(' · ')}
                  </p>
                {/if}
              </div>
              <div class="shrink-0 text-right font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
                <p>{pool.players.length} players · 40-game rule</p>
                <p>{pool.coverageSummary.coverageBand}</p>
              </div>
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
                  {filteredRows.length}/{poolRows.length}
                </span>
              </div>
            </div>
            {#if runError}
              <p class="border-b border-border/60 p-4 text-sm text-destructive">{runError}</p>
            {/if}
            {#if filteredRows.length === 0}
              <p class="p-6 text-center font-mono text-xs text-muted-foreground">
                No players match.
              </p>
            {:else}
              <ul
                class="grid max-h-[55vh] gap-1 overflow-y-auto p-2 sm:max-h-[560px] sm:grid-cols-2 xl:grid-cols-3"
              >
                {#each filteredRows as player (player.playerId)}
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
                          {player.seasonKey} · {player.historicalTeamIdentity.displayName} · {player.positions.canonical.join(
                            '/',
                          )}
                        </span>
                      </span>
                      <span class="flex shrink-0 gap-1 font-mono text-[10px]">
                        <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Overall">
                          O {player.summaryRatings.overallRating}
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
                  aria-label={`${SLOT_NAMES[slotIndex]} slot: ${slots[slotIndex]?.displayName ?? 'empty'}`}
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
    {:else}
      <div
        class="mt-8 rounded-xl border border-border bg-card p-5"
        role="status"
        aria-live="polite"
      >
        <p class="text-sm text-muted-foreground">
          Choose a franchise and decade to load its player pool.
        </p>
      </div>
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
                  {subject.seasonKey} · {subject.historicalTeamIdentity.displayName} · {subject.positions.canonical.join(
                    '/',
                  )} · O {subject.summaryRatings.overallRating}
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
                      {opt.incumbent.seasonKey} · {opt.incumbent.positions.canonical.join('/')}
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
