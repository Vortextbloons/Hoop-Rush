<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowRight, Check, ChevronDown } from '@lucide/svelte';
  import { Select } from 'bits-ui';
  import type {
    HoopRushManifest,
    PeakPlayerSeason,
    PlayersIndex,
    PlayersIndexEntry,
  } from '@hoop-rush/data-contracts';
  import {
    franchiseAbbreviation,
    resolveEraTeamIdentity,
    LINEUP_STRUCTURE,
  } from '@hoop-rush/data-contracts';
  import { validateLineup } from '@hoop-rush/engine';
  import { clearDataLoaderCaches, getManifest, getPlayersIndex, getPool } from '$lib/data';
  import { resolvePlayerRefs } from '$lib/player-refs';
  import { generateSeed, parseSandboxUrl } from '$lib/sandbox-url';
  import { startSandboxRun } from '$lib/sandbox-run';
  import { sortDraftRows } from '$lib/draft-presentation';
  import TeamLogo from '$lib/components/TeamLogo.svelte';
  import LineupCourt from '$lib/components/LineupCourt.svelte';
  import LineupSummaryNav from '$lib/components/LineupSummaryNav.svelte';
  import DraftValuePanel from '$lib/components/DraftValuePanel.svelte';
  import DraftPoolBrowser from '$lib/components/draft/DraftPoolBrowser.svelte';
  import AsyncState from '$lib/components/AsyncState.svelte';
  let slotPickerModule: Promise<
    typeof import('$lib/components/draft/SlotPickerDialog.svelte')
  > | null = null;
  function loadSlotPickerDialog(): Promise<
    typeof import('$lib/components/draft/SlotPickerDialog.svelte')
  > {
    slotPickerModule ??= import('$lib/components/draft/SlotPickerDialog.svelte');
    return slotPickerModule;
  }
  import {
    SLOT_INDEXES,
    SLOT_LABELS,
    SLOT_NAMES,
    canFillSlot,
    displacementTargetFor,
  } from '$lib/draft-slots';
  type IndexRow = PlayersIndexEntry;
  type SlotRef = {
    playerId: string;
    franchiseId: string;
    eraId: string;
  };
  let manifest = $state.raw<HoopRushManifest | null>(null);
  let manifestError: string | null = $state(null);
  let index = $state.raw<PlayersIndex | null>(null);
  let indexError: string | null = $state(null);
  let runError: string | null = $state(null);
  let starting = $state(false);
  let mounted = true;
  $effect(() => {
    mounted = true;
    return () => {
      mounted = false;
    };
  });
  let slots = $state<(IndexRow | null)[]>([null, null, null, null, null]);
  let resolvedDraftPlayers = $state.raw<PeakPlayerSeason[]>([]);
  let pickerPlayer = $state<IndexRow | null>(null);
  let pickerTrigger = $state<HTMLElement | null>(null);
  let pickerFallbackId = $state<string | null>(null);
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
  function retrySandboxData() {
    clearDataLoaderCaches();
    loadSandboxData();
  }
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
        if (!mounted) return;
        slots = filled;
        pickerPlayer = null;
      },
      () => {},
    );
  }
  const franchise = $derived(
    manifest?.modernFranchiseSlots.find((e) => e.franchiseId === franchiseFilter) ?? null,
  );
  const era = $derived(manifest?.eras.find((e) => e.eraId === eraFilter) ?? null);
  const eraIdentity = $derived(
    manifest && franchise && era
      ? resolveEraTeamIdentity(manifest, franchise.franchiseId, era.eraId)
      : null,
  );
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
    franchise && era && eraIdentity
      ? `${eraIdentity.abbreviationLabel ?? franchiseAbbreviation(franchise.franchiseId)} · ${era.label}`
      : franchise
        ? franchiseAbbreviation(franchise.franchiseId)
        : era
          ? era.label
          : 'All players',
  );
  const countLabel = $derived(`${poolRows.length} players`);
  function selectFranchise(id: string) {
    franchiseFilter = id;
  }
  function selectEra(id: string) {
    eraFilter = id;
  }
  function placePlayer(subject: IndexRow, slotIndex: number) {
    const subjectSlot = slots.findIndex((p) => p !== null && p.playerId === subject.playerId);
    const incumbent = slots[slotIndex];
    if (incumbent && incumbent.playerId !== subject.playerId) {
      const target = displacementTargetFor(slots, incumbent, slotIndex, subjectSlot);
      if (target === null) return;
      slots[target] = incumbent;
    }
    slots[slotIndex] = subject;
    if (subjectSlot !== -1 && subjectSlot !== slotIndex) slots[subjectSlot] = null;
    if (manifest) {
      const entry = manifest.pools.find(
        (p) => p.franchiseId === subject.franchiseId && p.eraId === subject.eraId,
      );
      if (entry) void getPool(entry).catch(() => {});
    }
    closePicker();
  }
  function openPicker(player: IndexRow) {
    pickerTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pickerFallbackId = pickerTrigger?.closest<HTMLElement>('[id^="court-slot-"]')?.id ?? null;
    pickerPlayer = player;
  }
  function closePicker() {
    if (!mounted) return;
    pickerPlayer = null;
    const trigger = pickerTrigger;
    const fallback = pickerFallbackId;
    pickerTrigger = null;
    pickerFallbackId = null;
    queueMicrotask(() => {
      if (!mounted) return;
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
      structure: [...LINEUP_STRUCTURE],
      assignments: slots.map((player, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: player!.playerId,
        positions: player!.positionsPlayable,
      })),
    }).ok;
  });
  const ready = $derived(lineupIsLegal && manifest !== null && index !== null);
  async function resolveRefsToPlayers(refs: SlotRef[]): Promise<PeakPlayerSeason[]> {
    const m = manifest;
    if (!m) throw new Error('The manifest is unavailable.');
    return resolvePlayerRefs(refs, m);
  }
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
      if (!mounted) return;
      await startSandboxRun(resolved, generateSeed());
      if (!mounted) return;
    } catch (e) {
      if (!mounted) return;
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
        Five players, any team, any era. Build your five and chase 82–0.
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-3">
      <a
        href={resolve('/multiplayer')}
        class="rounded-lg bg-primary px-3 py-1.5 font-mono text-xs font-bold text-primary-foreground hover:opacity-90"
      >
        Play online →
      </a>
      <a
        href={resolve('/')}
        class="shrink-0 font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        Back
      </a>
    </div>
  </div>

  {#if manifestError}
    <div class="mt-8">
      <AsyncState
        kind="error"
        title="Data unavailable"
        message="Couldn’t load data. Try again."
        retry={retrySandboxData}
      />
    </div>
  {:else if !manifest}
    <div class="mt-8">
      <AsyncState kind="loading" title="Loading…" message="Loading…" />
    </div>
  {:else}
    {#if indexError}
      <div class="mt-8">
        <AsyncState
          kind="error"
          title="Players unavailable"
          message="Couldn’t load data. Try again."
          retry={retrySandboxData}
        />
      </div>
    {:else if !index}
      <div class="mt-8">
        <AsyncState kind="loading" title="Loading…" message="Loading…" />
      </div>
    {:else}
      <div class="mt-10 flex flex-col gap-6 pb-32">
        <div class="rounded-xl bg-surface-1 p-3 sm:p-4">
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
                            logoCandidates={eraIdentity?.logoCandidates ?? []}
                          />
                          <span
                            class="truncate"
                            title={eraIdentity?.displayLabel ?? franchise.displayName}
                          >
                            {eraIdentity?.abbreviationLabel ??
                              franchiseAbbreviation(franchise.franchiseId)}
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
                            <span class="min-w-0 flex-1 truncate text-sm font-semibold"
                              >Any team</span
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
              <Select.Root
                type="single"
                value={eraFilter}
                onValueChange={selectEra}
                items={eraItems}
              >
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
        <DraftValuePanel players={resolvedDraftPlayers} />
        {#if ready}
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
        {/if}
      </div>

      <LineupSummaryNav {slots} {pickedCount} />
    {/if}
  {/if}

  {#if pickerPlayer}
    {#await loadSlotPickerDialog() then { default: SlotPickerDialog }}
      <p class="px-4 py-3 font-mono text-xs text-muted-foreground">Loading…</p>
      <SlotPickerDialog
        player={pickerPlayer}
        {slots}
        manifest={manifest!}
        presentation="sandbox"
        allowDisplacement
        onplace={placePlayer}
        onclose={closePicker}
      />
    {/await}
  {/if}
</section>
