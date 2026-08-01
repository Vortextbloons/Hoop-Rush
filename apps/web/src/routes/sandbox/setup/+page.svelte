<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { ArrowRight, Pencil, Shield } from '@lucide/svelte';
  import type {
    EraSimulationProfile,
    FranchiseEraPool,
    HoopRushManifest,
    OpponentTeam,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { getEraSimulationProfile, getManifest, getOpeningOpponent, getPool } from '$lib/data';
  import { buildSandboxUrl, generateSeed, parseSandboxUrl } from '$lib/sandbox-url';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import TeamLogo from '$lib/components/TeamLogo.svelte';

  type PeakPlayer = FranchiseEraPool['players'][number];
  type SlotLabel = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

  const SLOT_LABELS: SlotLabel[] = ['PG', 'SG', 'SF', 'PF', 'C'];
  const SLOT_NAMES = [
    'Point Guard',
    'Shooting Guard',
    'Small Forward',
    'Power Forward',
    'Center',
  ] as const;
  const draftHref = resolve('/sandbox');

  let manifest = $state<HoopRushManifest | null>(null);
  let pool = $state<FranchiseEraPool | null>(null);
  let profile = $state<EraSimulationProfile | null>(null);
  let opponent = $state<OpponentTeam | null>(null);
  let error = $state<string | null>(null);

  let playerIds = $state<string[]>([]);
  let franchiseId = $state('');
  let eraId = $state('');

  const { url } = $derived(page);
  const currentUrl = $derived(url.toString());

  $effect(() => {
    if (!browser) return;
    const url = new URL(currentUrl);
    const params = url.searchParams;
    const slots = params.get('slots');
    franchiseId = params.get('franchise') ?? '';
    eraId = params.get('era') ?? '';
    playerIds = slots ? slots.split(',') : [];

    let cancelled = false;
    getManifest().then(
      (m) => {
        if (cancelled) return;
        manifest = m;
        if (!m.franchiseLineage.some((e) => e.franchiseId === franchiseId)) {
          error = `Unknown franchise "${franchiseId}".`;
          return;
        }
        if (!m.eras.some((e) => e.eraId === eraId)) {
          error = `Unknown decade "${eraId}".`;
          return;
        }
        const poolEntry = m.pools.find((p) => p.franchiseId === franchiseId && p.eraId === eraId);
        const profileEntry = m.eraSimulationProfiles.find((p) => p.eraId === eraId);
        const opponentEntry = m.opponents[0];
        if (!poolEntry || !profileEntry || !opponentEntry) {
          error = 'This matchup is not packaged yet.';
          return;
        }
        getPool(poolEntry).then(
          (p) => {
            if (cancelled) return;
            pool = p;
            const validation = parseSandboxUrl(url, m, p);
            if (!validation.ok || !validation.state) {
              error = validation.error ?? 'Invalid draft state.';
            }
          },
          (e: unknown) => {
            if (!cancelled) error = e instanceof Error ? e.message : String(e);
          },
        );
        getEraSimulationProfile(profileEntry).then(
          (p) => {
            if (!cancelled) profile = p;
          },
          () => {
            if (!cancelled) error = 'The decade simulation profile is unavailable.';
          },
        );
        getOpeningOpponent(opponentEntry).then(
          (o) => {
            if (!cancelled) opponent = o;
          },
          () => {
            if (!cancelled) error = 'The opening opponent is unavailable.';
          },
        );
      },
      (e: unknown) => {
        if (!cancelled) error = e instanceof Error ? e.message : String(e);
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

  const drafted = $derived.by((): PeakPlayer[] => {
    if (!pool) return [];
    const byId = new Map(pool.players.map((p) => [p.playerId, p]));
    return playerIds.map((id) => byId.get(id)).filter((p): p is PeakPlayer => p !== undefined);
  });

  const ready = $derived(
    drafted.length === 5 && manifest !== null && profile !== null && opponent !== null,
  );

  function startChallenge() {
    if (!ready) return;
    const seed = generateSeed();
    const href = buildSandboxUrl({ franchiseId, eraId, playerIds, seed }, 'game');
    void goto(resolve(href));
  }
</script>

<svelte:head>
  <title>Challenge setup — Sandbox — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Sandbox · Setup</p>
  <h1
    class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
  >
    One game. Five players.
  </h1>

  <div class="mt-6 flex flex-wrap items-center gap-2">
    <a
      href={draftHref}
      class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
    >
      <Pencil class="h-4 w-4" />
      Edit lineup
    </a>
    {#if franchise && manifest}
      <span
        class="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold"
      >
        <TeamLogo
          {manifest}
          franchiseId={franchise.franchiseId}
          teamExternalId={franchise.teamExternalId}
          alt=""
        />
        {franchise.displayName}
        <span class="font-mono text-xs text-muted-foreground">
          {franchiseAbbreviation(franchise.franchiseId)} · {era?.label ?? eraId}
        </span>
      </span>
    {/if}
  </div>

  {#if error}
    <div class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <p class="font-semibold">Draft state unavailable</p>
      <p class="mt-1 text-muted-foreground">{error}</p>
      <a
        href={draftHref}
        class="mt-3 inline-flex rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"
      >
        Back to the draft
      </a>
    </div>
  {:else}
    <div class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div class="flex flex-col gap-6">
        <section
          aria-labelledby="your-five-heading"
          class="rounded-xl border border-border bg-card p-5"
        >
          <h2
            id="your-five-heading"
            class="font-display text-xl font-extrabold tracking-tight uppercase"
          >
            Your five
          </h2>
          {#if drafted.length === 5 && manifest}
            <ul class="mt-4 flex flex-col gap-3">
              {#each drafted as player, slotIndex (player.playerId)}
                <li
                  class="flex items-center gap-3 rounded-lg border border-border bg-surface-1 p-3"
                >
                  <span class="w-14 shrink-0 text-center">
                    <span class="font-display block text-lg font-extrabold text-primary">
                      {SLOT_LABELS[slotIndex]}
                    </span>
                    <span class="font-mono text-[10px] text-muted-foreground">
                      {SLOT_NAMES[slotIndex]}
                    </span>
                  </span>
                  <PlayerFace
                    {player}
                    {manifest}
                    size="sm"
                    fallbackInitials={player.firstName[0]! + player.lastName[0]!}
                  />
                  <div class="min-w-0 flex-1">
                    <p
                      class="font-display truncate text-base font-extrabold tracking-tight uppercase"
                    >
                      {player.displayName}
                    </p>
                    <p class="font-mono text-[10px] text-muted-foreground">
                      {player.seasonKey} · {player.positions.canonical.join('/')}
                    </p>
                  </div>
                  <span
                    class="hidden shrink-0 gap-3 font-mono text-xs text-muted-foreground sm:flex"
                  >
                    <span aria-label="Offense">O {player.summaryRatings.offenseRating}</span>
                    <span aria-label="Defense">D {player.summaryRatings.defenseRating}</span>
                  </span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="mt-4 animate-pulse text-sm text-muted-foreground">Loading your five…</p>
          {/if}
        </section>

        <section
          aria-labelledby="rules-heading"
          class="rounded-xl border border-border bg-card p-5"
        >
          <h2
            id="rules-heading"
            class="font-display text-xl font-extrabold tracking-tight uppercase"
          >
            Game rules
          </h2>
          <ul class="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
            <li class="flex items-start gap-2">
              <Shield class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              Neutral site: no home-court edge, no luck bonuses, no rubber-banding.
            </li>
            <li class="flex items-start gap-2">
              <Shield class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              Your five play every minute — no bench, no substitutions, no fatigue.
            </li>
            <li class="flex items-start gap-2">
              <Shield class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              One regulation game, with overtime until a winner exists.
            </li>
            <li class="flex items-start gap-2">
              <Shield class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              Every result is seeded and reproducible from this page's URL.
            </li>
          </ul>
        </section>
      </div>

      <aside aria-labelledby="opponent-heading" class="flex flex-col gap-6">
        <section class="rounded-xl border border-border bg-card p-5">
          <h2
            id="opponent-heading"
            class="font-display text-xl font-extrabold tracking-tight uppercase"
          >
            Opening opponent
          </h2>
          {#if opponent && manifest}
            <div class="mt-3 flex items-center gap-3">
              <TeamLogo
                {manifest}
                franchiseId={opponent.teamId}
                teamExternalId={franchise?.teamExternalId ?? ''}
                alt=""
              />
              <div class="min-w-0">
                <p class="font-display truncate text-lg font-extrabold tracking-tight uppercase">
                  {opponent.displayName}
                </p>
                <p class="font-mono text-[10px] text-muted-foreground">
                  {opponent.seasonKey} · Medium
                </p>
              </div>
            </div>
            <ul class="mt-4 flex flex-col gap-2">
              {#each opponent.players as player (player.playerId)}
                <li
                  class="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2"
                >
                  <span class="min-w-0">
                    <span
                      class="font-display block truncate text-sm font-extrabold tracking-tight uppercase"
                    >
                      {player.displayName}
                    </span>
                    <span class="font-mono text-[10px] text-muted-foreground">
                      {player.positions.join('/')} · {player.ratings.insideScoring} in · {player
                        .ratings.perimeterDefense} def
                    </span>
                  </span>
                </li>
              {/each}
            </ul>
            <p class="mt-3 text-xs text-muted-foreground">
              Medium difficulty comes from a calibrated opponent band — never from rating boosts.
            </p>
          {:else}
            <p class="mt-4 animate-pulse text-sm text-muted-foreground">Loading opponent…</p>
          {/if}
        </section>

        <div class="rounded-xl border border-line-strong bg-surface-2 p-5">
          <p class="text-sm text-muted-foreground">
            Each game uses a fresh seeded simulation. Your draft is saved in this page's URL, so you
            can reload or share it.
          </p>
          <button
            type="button"
            onclick={startChallenge}
            disabled={!ready}
            class="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Tip off
            <ArrowRight class="h-4 w-4" />
          </button>
          <p class="mt-3 text-center text-xs text-muted-foreground">
            {#if profile}
              {profile.parameters.pace.toFixed(0)} possessions per 48 · {Math.round(
                profile.parameters.leagueTsPct * 100,
              )}% league true shooting · {era?.label ?? eraId} rules
            {:else}
              Loading profile…
            {/if}
          </p>
        </div>
      </aside>
    </div>
  {/if}
</section>
