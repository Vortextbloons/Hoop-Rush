<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowRight, ArrowRightLeft, Check, ChevronDown, Lock, Plus, X } from '@lucide/svelte';
  import { Dialog, Select } from 'bits-ui';
  import type { FranchiseEraPool, HoopRushManifest, SlotIndex } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { canPlay, slotRequirement, validateLineup } from '@hoop-rush/engine';
  import { getManifest, getPool, prefetchPools } from '$lib/data';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import TeamLogo from '$lib/components/TeamLogo.svelte';

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

  let manifest = $state<HoopRushManifest | null>(null);
  let manifestError: string | null = $state(null);

  let franchiseId = $state('');
  let eraId = $state('');

  let pool: FranchiseEraPool | null = $state(null);
  let poolError: string | null = $state(null);

  let slots = $state<(PeakPlayer | null)[]>([null, null, null, null, null]);
  let pickerPlayer = $state<PeakPlayer | null>(null);

  $effect(() => {
    let cancelled = false;
    getManifest().then(
      (m) => {
        if (!cancelled) {
          manifest = m;
          prefetchPools(m.pools);
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

  const franchise = $derived(
    manifest?.franchiseLineage.find((e) => e.franchiseId === franchiseId) ?? null,
  );
  const era = $derived(manifest?.eras.find((e) => e.eraId === eraId) ?? null);

  function franchiseAvailableIn(eraTo: string, firstNba: string | undefined): boolean {
    return firstNba === undefined || firstNba <= eraTo;
  }

  const franchiseItems = $derived(
    (manifest?.franchiseLineage ?? []).map((entry) => ({
      value: entry.franchiseId,
      label: entry.displayName,
      disabled: era !== null && !franchiseAvailableIn(era.toSeasonKey, entry.firstNbaSeasonKey),
    })),
  );

  const eraItems = $derived(
    (manifest?.eras ?? []).map((e) => ({
      value: e.eraId,
      label: e.label,
      disabled:
        franchise !== null && !franchiseAvailableIn(e.toSeasonKey, franchise.firstNbaSeasonKey),
    })),
  );

  const sortedPlayers = $derived.by(() => {
    if (!pool) return [] as PeakPlayer[];
    return [...pool.players].sort(
      (a, b) =>
        b.summaryRatings.overallRating - a.summaryRatings.overallRating ||
        a.displayName.localeCompare(b.displayName),
    );
  });

  function selectFranchise(id: string) {
    franchiseId = id;
    const nextFranchise = manifest?.franchiseLineage.find((e) => e.franchiseId === id) ?? null;
    if (
      era &&
      nextFranchise &&
      !franchiseAvailableIn(era.toSeasonKey, nextFranchise.firstNbaSeasonKey)
    ) {
      eraId = '';
    }
    resetPool();
    void loadPoolFor(franchiseId, eraId);
  }

  function selectEra(id: string) {
    eraId = id;
    const nextEra = manifest?.eras.find((e) => e.eraId === id) ?? null;
    if (
      franchise &&
      nextEra &&
      !franchiseAvailableIn(nextEra.toSeasonKey, franchise.firstNbaSeasonKey)
    ) {
      franchiseId = '';
    }
    resetPool();
    void loadPoolFor(franchiseId, eraId);
  }

  function resetPool() {
    pool = null;
    poolError = null;
    slots = [null, null, null, null, null];
    pickerPlayer = null;
  }

  function loadPoolFor(franchise: string | null, era: string | null) {
    if (!franchise || !era) return;
    poolError = null;
    const entry = manifest?.pools.find((p) => p.franchiseId === franchise && p.eraId === era);
    if (!entry) {
      poolError = 'Pool unavailable.';
      return;
    }
    getPool(entry).then(
      (p) => {
        pool = p;
      },
      (error: unknown) => {
        poolError = error instanceof Error ? error.message : String(error);
      },
    );
  }

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

  /** Eligibility shown on the pool card itself, before any click. */
  function poolCardInfoFor(player: PeakPlayer): PoolCardInfo {
    if (slots.some((p) => p !== null && p.playerId === player.playerId)) {
      return { state: 'lineup', displace: null };
    }
    for (const i of SLOT_INDEXES) {
      if (!canFillSlot(player, i)) continue;
      const incumbent = slots[i] ?? null;
      if (!incumbent) return { state: 'place', displace: null };
      const target = displacementTargetFor(incumbent, i, -1);
      if (target !== null) {
        return { state: 'displace', displace: { incumbent, targetSlot: target } };
      }
    }
    return { state: 'blocked', displace: null };
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
        Choose a franchise and decade
      </h1>
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
                {#each manifest.franchiseLineage as entry (entry.franchiseId)}
                  {@const available =
                    era === null || franchiseAvailableIn(era.toSeasonKey, entry.firstNbaSeasonKey)}
                  <Select.Item
                    value={entry.franchiseId}
                    label={entry.displayName}
                    aria-label={`${franchiseAbbreviation(entry.franchiseId)} — ${entry.displayName}`}
                    disabled={!available}
                    aria-disabled={!available ? 'true' : undefined}
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
                        {#if !available}
                          <span
                            class="shrink-0 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase"
                          >
                            Not in NBA yet
                          </span>
                        {:else if selected}
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
                  {@const available =
                    franchise === null ||
                    franchiseAvailableIn(e.toSeasonKey, franchise.firstNbaSeasonKey)}
                  <Select.Item
                    value={e.eraId}
                    label={e.label}
                    disabled={!available}
                    aria-disabled={!available ? 'true' : undefined}
                    class="cursor-pointer select-none rounded-md outline-none transition-colors data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-surface-3 data-[selected]:bg-primary/10"
                  >
                    {#snippet children({ selected })}
                      <span class="flex w-full items-center gap-2.5 py-1 pr-1 pl-0.5">
                        <span class="min-w-0 flex-1 truncate font-mono text-sm font-semibold">
                          {e.label}
                        </span>
                        {#if !available}
                          <span
                            class="shrink-0 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase"
                          >
                            No seasons yet
                          </span>
                        {:else if selected}
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

    {#if poolError}
      <p class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
        {poolError}
      </p>
    {:else if franchise && era}
      <div class="mt-10 grid gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-0">
        <div class="rounded-xl border border-border bg-card">
          <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 class="font-display text-lg font-extrabold tracking-tight uppercase">
              {franchiseAbbreviation(franchise.franchiseId)} · {era.label}
            </h2>
            <span
              class="shrink-0 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase"
            >
              {#if pool}
                {pool.players.length} players
              {:else}
                Loading players…
              {/if}
            </span>
          </div>
          {#if pool}
            <ul class="grid max-h-[55vh] gap-1 overflow-y-auto p-2 sm:max-h-[560px] sm:grid-cols-2">
              {#each sortedPlayers as player (player.playerId)}
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
                        {player.seasonKey} · {player.positions.sourceLabels.join('/')}
                      </span>
                    </span>
                    <span class="flex shrink-0 gap-1 font-mono text-[10px]">
                      <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Overall">
                        O {player.summaryRatings.overallRating}
                      </span>
                      <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Offense">
                        A {player.summaryRatings.offenseRating}
                      </span>
                      <span class="rounded bg-surface-3 px-1.5 py-0.5" title="Defense">
                        D {player.summaryRatings.defenseRating}
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
          {:else}
            <ul
              aria-hidden="true"
              class="grid max-h-[55vh] gap-1 overflow-y-auto p-2 sm:max-h-[560px] sm:grid-cols-2"
            >
              {#each Array(8) as _, i (i)}
                <li
                  class="flex w-full animate-pulse items-center gap-3 rounded-lg border border-transparent px-3 py-2.5"
                >
                  <span class="h-12 w-12 shrink-0 rounded-lg bg-surface-3"></span>
                  <span class="min-w-0 flex-1">
                    <span class="block h-3.5 w-32 rounded bg-surface-3"></span>
                    <span class="mt-2 block h-2.5 w-20 rounded bg-surface-3"></span>
                  </span>
                  <span class="flex shrink-0 gap-1">
                    <span class="h-4 w-9 rounded bg-surface-3"></span>
                    <span class="h-4 w-9 rounded bg-surface-3"></span>
                    <span class="h-4 w-9 rounded bg-surface-3"></span>
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <div class="flex flex-col gap-4">
          <div id="your-five" class="scroll-mt-4 rounded-xl border border-border bg-card p-4">
            <div class="flex items-center justify-between">
              <h2 class="font-display text-lg font-extrabold tracking-tight uppercase">
                Your five
              </h2>
              <span class="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
                {pickedCount}/5
              </span>
            </div>
            <div class="mt-3 flex flex-col gap-2">
              {#each SLOT_LABELS as label, slotIndex (slotIndex)}
                {@const player = slots[slotIndex]}
                <div
                  class="flex items-center gap-3 rounded-lg border px-3 py-2 {player
                    ? 'border-line-strong bg-surface-2'
                    : 'border-dashed border-border'}"
                >
                  <span
                    class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-sm font-extrabold text-primary"
                  >
                    {label}
                  </span>
                  {#if player}
                    <button
                      type="button"
                      aria-label={`Move ${player.displayName} to another position`}
                      class="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none transition-colors hover:bg-surface-3/60 focus-visible:ring-2 focus-visible:ring-ring"
                      onclick={() => openPicker(player)}
                    >
                      <PlayerFace
                        {player}
                        {manifest}
                        size="sm"
                        fallbackInitials={player.firstName[0]! + player.lastName[0]!}
                      />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-bold">{player.displayName}</span>
                        <span class="block font-mono text-[10px] text-muted-foreground">
                          {player.seasonKey} · {player.positions.canonical.join('/')} · O
                          {player.summaryRatings.overallRating}
                        </span>
                      </span>
                      <ArrowRightLeft class="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${player.displayName}`}
                      class="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground"
                      onclick={() => removePlayer(slotIndex)}
                    >
                      ×
                    </button>
                  {:else}
                    <span class="font-mono text-xs text-muted-foreground">
                      Open {label} slot
                    </span>
                  {/if}
                </div>
              {/each}
            </div>
            {#if lineupIsLegal}
              <p
                class="mt-4 rounded-lg border border-line-strong bg-surface-2 p-3 text-xs text-muted-foreground"
              >
                Lineup ready.
              </p>
            {/if}
          </div>
        </div>
      </div>

      <a
        href="#your-five"
        class="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden"
      >
        <span class="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <span class="font-display text-sm font-extrabold tracking-tight uppercase">
            Your five
          </span>
          <span class="flex gap-1">
            {#each SLOT_LABELS as label, slotIndex (slotIndex)}
              <span
                class="grid h-6 w-6 place-items-center rounded-md text-[10px] font-bold {slots[
                  slotIndex
                ]
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-muted-foreground'}"
              >
                {label}
              </span>
            {/each}
          </span>
          <span class="ml-auto font-mono text-xs text-muted-foreground">
            Picked {pickedCount} of 5
          </span>
        </span>
      </a>
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
                  {subject.seasonKey} · {subject.positions.canonical.join('/')} · O
                  {subject.summaryRatings.overallRating}
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
                    <span class="block font-mono text-[10px] text-muted-foreground">Empty</span>
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
