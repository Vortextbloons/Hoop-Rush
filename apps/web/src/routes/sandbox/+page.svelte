<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { ArrowRight, Check, ChevronDown, Lock, Plus, Search, X } from '@lucide/svelte';
  import { Dialog, Select } from 'bits-ui';
  import type {
    EraSimulationProfile,
    FranchiseEraPool,
    HoopRushManifest,
    OpponentBracket,
    SlotIndex,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import {
    canPlay,
    createChallenge,
    createEngineContext,
    simulateChallengeBestOf,
    slotRequirement,
    toSimulationPlayer,
    validateLineup,
    type ChallengeCreation,
  } from '@hoop-rush/engine';
  import { getBracket, getEraSimulationProfile, getManifest, getPool } from '$lib/data';
  import { challengeRepository } from '$lib/challenge-repo';
  import { generateSeed } from '$lib/sandbox-url';
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

  let franchiseId = $state('');
  let eraId = $state('');

  let pool = $state.raw<FranchiseEraPool | null>(null);
  let poolError: string | null = $state(null);

  let profile = $state.raw<EraSimulationProfile | null>(null);
  let bracket = $state.raw<OpponentBracket | null>(null);
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

  $effect(() => {
    if (!manifest || !eraId) return;
    const profileEntry = manifest.eraSimulationProfiles.find((p) => p.eraId === eraId);
    if (!profileEntry) return;
    let cancelled = false;
    getEraSimulationProfile(profileEntry).then(
      (p) => {
        if (!cancelled) profile = p;
      },
      () => {
        if (!cancelled) poolError = 'The decade simulation profile is unavailable.';
      },
    );
    return () => {
      cancelled = true;
    };
  });

  /**
   * Restores a draft carried in the URL (franchise, era, and five slot
   * assignments) so "edit lineup" returns to the exact same draft.
   */
  function restoreUrlState(m: HoopRushManifest) {
    if (franchiseId || eraId || slots.some((p) => p !== null)) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const nextFranchise = params.get('franchise');
    const nextEra = params.get('era');
    const nextSlots = params.get('slots');
    if (!nextFranchise || !nextEra || !nextSlots) return;
    if (!m.franchiseLineage.some((e) => e.franchiseId === nextFranchise)) return;
    if (!m.eras.some((e) => e.eraId === nextEra)) return;
    const poolEntry = m.pools.find((p) => p.franchiseId === nextFranchise && p.eraId === nextEra);
    if (!poolEntry) return;
    franchiseId = nextFranchise;
    eraId = nextEra;
    loadPoolFor(nextFranchise, nextEra);
    getPool(poolEntry).then(
      (p) => {
        if (p === null) return;
        const byId = new Map(p.players.map((player) => [player.playerId, player]));
        const ids = nextSlots.split(',');
        if (ids.length !== 5 || new Set(ids).size !== 5) return;
        slots = ids.map((id) => byId.get(id) ?? null);
        pickerPlayer = null;
      },
      () => {
        // Invalid draft state falls back to an empty board.
      },
    );
  }

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
        (b.detailedRatings.overall ?? 0) - (a.detailedRatings.overall ?? 0) ||
        a.displayName.localeCompare(b.displayName),
    );
  });

  const filteredPlayers = $derived.by(() => {
    let list = sortedPlayers;
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
    search = '';
    positionFilter = null;
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
    lineupIsLegal && manifest !== null && pool !== null && profile !== null && franchise !== null,
  );

  /** Creates and persists the active 82-game run, then starts it immediately. */
  async function play82() {
    if (!ready || !pool || !profile || !franchise || !manifest) return;
    if (!manifest.bracket) {
      poolError = 'The opponent bracket is unavailable.';
      return;
    }
    starting = true;
    try {
      bracket = await getBracket(manifest.bracket);
      const players = slots.filter((p): p is PeakPlayer => p !== null);
      const sample = players[0];
      const context = createEngineContext();
      const creation: ChallengeCreation = {
        runId: crypto.randomUUID(),
        mode: 'sandbox',
        franchiseId,
        eraId,
        homeDisplayName: franchise.displayName,
        lineup: {
          structure: [...SLOT_REQUIREMENTS],
          assignments: players.map((player, slotIndex) => ({
            slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
            playerId: player.playerId,
            positions: player.positions.canonical,
          })),
        },
        players: players.map((player) => toSimulationPlayer(player)),
        runSeed: generateSeed(),
        dataVersion: profile.dataVersion,
        ratingVersion: sample?.source.ratingsVersion ?? 'unknown',
        positionNormalizationVersion: sample?.positions.normalizationVersion ?? 'position-v1',
        engineVersion: context.engineVersion,
        profile,
        bracket,
      };
      // Sandbox simulates the complete season twice from derived attempt seeds
      // and keeps the best record; the chosen attempt's seed becomes the
      // persisted run seed so the paced reveal reproduces exactly those games.
      const chosen = simulateChallengeBestOf(creation, profile, context);
      const run = createChallenge({ ...creation, runSeed: chosen.runSeed });
      await challengeRepository.saveActiveRun({
        recordId: 'active',
        saveSchemaVersion: 2,
        run,
      });
      void goto(resolve('/sandbox/challenge'));
    } catch (e) {
      poolError = e instanceof Error ? e.message : String(e);
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
      <div class="mt-10 flex flex-col gap-6 pb-32">
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
                  {filteredPlayers.length}/{pool.players.length}
                </span>
              </div>
            </div>
            {#if filteredPlayers.length === 0}
              <p class="p-6 text-center font-mono text-xs text-muted-foreground">
                No players match.
              </p>
            {:else}
              <ul
                class="grid max-h-[55vh] gap-1 overflow-y-auto p-2 sm:max-h-[560px] sm:grid-cols-2 xl:grid-cols-3"
              >
                {#each filteredPlayers as player (player.playerId)}
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
                          O {player.detailedRatings.overall ?? 0}
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
                  </span>
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
                  {subject.seasonKey} · {subject.positions.canonical.join('/')} · O
                  {subject.detailedRatings.overall ?? 0}
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
