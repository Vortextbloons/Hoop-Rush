<script lang="ts">
  import { resolve } from '$app/paths';
  import type { FranchiseEraPool, HoopRushManifest } from '@hoop-rush/data-contracts';
  import { resolveLogoUrl } from '@hoop-rush/data-contracts';
  import { canPlay, slotRequirement, validateLineup } from '@hoop-rush/engine';
  import { getManifest, getPool } from '$lib/data';
  import PlayerFace from '$lib/components/PlayerFace.svelte';

  type PeakPlayer = FranchiseEraPool['players'][number];

  const SLOT_LABELS = ['G', 'G', 'F', 'F', 'C'] as const;

  let manifest = $state<HoopRushManifest | null>(null);
  let manifestError: string | null = $state(null);

  let franchiseId = $state<string | null>(null);
  let eraId = $state<string | null>(null);

  let pool: FranchiseEraPool | null = $state(null);
  let poolError: string | null = $state(null);
  let loadingPool = $state(false);

  let slots = $state<(PeakPlayer | null)[]>([null, null, null, null, null]);
  let notice: string | null = $state(null);

  $effect(() => {
    let cancelled = false;
    getManifest().then(
      (m) => {
        if (!cancelled) manifest = m;
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

  function selectFranchise(id: string) {
    franchiseId = id;
    resetPool();
    void loadPoolFor(franchiseId, eraId);
  }

  function selectEra(id: string) {
    eraId = id;
    resetPool();
    void loadPoolFor(franchiseId, eraId);
  }

  function resetPool() {
    pool = null;
    poolError = null;
    slots = [null, null, null, null, null];
    notice = null;
  }

  function loadPoolFor(franchise: string | null, era: string | null) {
    if (!franchise || !era) return;
    loadingPool = true;
    poolError = null;
    const entry = manifest?.pools.find((p) => p.franchiseId === franchise && p.eraId === era);
    if (!entry) {
      loadingPool = false;
      poolError = 'No pool is packaged for this franchise and decade yet.';
      return;
    }
    getPool(entry).then(
      (p) => {
        pool = p;
        loadingPool = false;
      },
      (error: unknown) => {
        loadingPool = false;
        poolError = error instanceof Error ? error.message : String(error);
      },
    );
  }

  function canAssignToSlot(player: PeakPlayer, slotIndex: number): boolean {
    const already = slots.some((p) => p !== null && p.playerId === player.playerId);
    return !already && canPlay(player.positions.canonical, slotRequirement(slotIndex));
  }

  function addPlayer(player: PeakPlayer) {
    notice = null;
    if (slots.every((p) => p !== null)) return;
    const index = slots.findIndex((p, i) => p === null && canAssignToSlot(player, i));
    if (index >= 0) {
      slots[index] = player;
    } else if (slots.some((p) => p !== null && p.playerId === player.playerId)) {
      notice = `${player.displayName} is already in the lineup.`;
    } else {
      notice = `${player.displayName} cannot fill any open ${SLOT_LABELS.join('/')} slot.`;
    }
  }

  function removePlayer(slotIndex: number) {
    slots[slotIndex] = null;
    notice = null;
  }

  const pickedCount = $derived(slots.filter((p) => p !== null).length);

  const lineupIsLegal = $derived.by(() => {
    if (slots.some((p) => p === null)) return false;
    return validateLineup({
      structure: ['G', 'G', 'F', 'F', 'C'],
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

<section class="mx-auto w-full max-w-6xl px-6 py-10">
  <div class="flex items-end justify-between gap-4">
    <div>
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Sandbox</p>
      <h1 class="font-display mt-2 text-4xl font-extrabold tracking-tight uppercase md:text-5xl">
        Choose a franchise and decade
      </h1>
      <p class="mt-2 max-w-2xl text-sm text-muted-foreground">
        Every player in the pool appears once, at their best eligible season — at least 40 games for
        this franchise. Pick exactly five: two guards, two forwards, one center.
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
    <div class="mt-8">
      <h2 class="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
        Franchise
      </h2>
      <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6">
        {#each manifest.franchiseLineage as entry (entry.franchiseId)}
          {@const available =
            era === null || franchiseAvailableIn(era.toSeasonKey, entry.firstNbaSeasonKey)}
          <button
            type="button"
            class="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-35 {franchiseId ===
            entry.franchiseId
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border bg-card hover:border-line-strong'}"
            disabled={!available}
            onclick={() => selectFranchise(entry.franchiseId)}
          >
            <img
              src={resolveLogoUrl(manifest, entry.teamExternalId) ?? ''}
              alt=""
              width="20"
              height="20"
              class="h-5 w-5 object-contain"
              loading="lazy"
            />
            <span class="truncate">{entry.displayName}</span>
          </button>
        {/each}
      </div>

      <h2 class="mt-8 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
        Decade
      </h2>
      <div class="mt-3 flex flex-wrap gap-2">
        {#each manifest.eras as e (e.eraId)}
          {@const available =
            franchise === null || franchiseAvailableIn(e.toSeasonKey, franchise.firstNbaSeasonKey)}
          <button
            type="button"
            class="rounded-lg border px-4 py-2 font-mono text-sm disabled:cursor-not-allowed disabled:opacity-35 {eraId ===
            e.eraId
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border bg-card hover:border-line-strong'}"
            disabled={!available}
            onclick={() => selectEra(e.eraId)}
          >
            {e.label}
          </button>
        {/each}
      </div>
    </div>

    {#if poolError}
      <p class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
        {poolError}
      </p>
    {:else if loadingPool}
      <p class="mt-8 font-mono text-sm text-muted-foreground">Loading pool…</p>
    {:else if pool && franchise && era}
      <div class="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div class="rounded-xl border border-border bg-card">
          <div class="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 class="font-display text-lg font-extrabold tracking-tight uppercase">
              {franchise.displayName} · {era.label}
            </h2>
            <span class="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
              {pool.players.length} eligible · peak seasons
            </span>
          </div>
          <ul class="grid max-h-[560px] gap-1 overflow-y-auto p-2 sm:grid-cols-2">
            {#each pool.players as player (player.playerId)}
              {@const inLineup = slots.some((p) => p !== null && p.playerId === player.playerId)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left {inLineup
                    ? 'border-primary/50 bg-primary/10 opacity-60'
                    : 'border-transparent hover:border-border hover:bg-surface-2'}"
                  onclick={() => addPlayer(player)}
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
                      {player.seasonKey} · {player.positions.canonical.join('/')}
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
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        </div>

        <div class="flex flex-col gap-4">
          <div class="rounded-xl border border-border bg-card p-4">
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
                    <PlayerFace
                      {player}
                      {manifest}
                      size="sm"
                      fallbackInitials={player.firstName[0]! + player.lastName[0]!}
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-bold">{player.displayName}</span>
                      <span class="block font-mono text-[10px] text-muted-foreground">
                        {player.seasonKey} · O {player.summaryRatings.overallRating}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${player.displayName}`}
                      class="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground"
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
            {#if notice}
              <p class="mt-3 text-xs text-muted-foreground">{notice}</p>
            {/if}
            {#if lineupIsLegal}
              <p
                class="mt-4 rounded-lg border border-line-strong bg-surface-2 p-3 text-xs text-muted-foreground"
              >
                Legal lineup. Challenge setup and simulation arrive in the next milestone — your
                five are locked for now.
              </p>
            {/if}
          </div>

          <div class="rounded-xl border border-border bg-card p-4">
            <h2 class="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
              Pool rules
            </h2>
            <ul class="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>· At least 40 games for this franchise in the chosen season</li>
              <li>· Each player appears at their best eligible season</li>
              <li>· Positions come from career-wide NBA listings</li>
              <li>· Exactly five players, no bench</li>
            </ul>
          </div>
        </div>
      </div>
    {/if}
  {/if}
</section>
