<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { Dices, Pencil, RotateCcw } from '@lucide/svelte';
  import type {
    ChallengeRun,
    HoopRushManifest,
    PlayerSeasonAggregate,
    RunAggregates,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import type { RouteId } from '$app/types';
  import { createChallenge, createEngineContext, toSimulationPlayer } from '@hoop-rush/engine';
  import type { FranchiseEraPool } from '@hoop-rush/data-contracts';
  import { getBracket, getEraSimulationProfile, getManifest, getPool } from '$lib/data';
  import { challengeRepository } from '$lib/challenge-repo';
  import { generateSeed } from '$lib/sandbox-url';
  import { perGamePlayer } from '@hoop-rush/engine';
  import GameStrip from '$lib/components/GameStrip.svelte';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import SeasonTierBadge from '$lib/components/SeasonTierBadge.svelte';
  import TeamLogo from '$lib/components/TeamLogo.svelte';

  /**
   * Challenge result (spec/08): final record and 82-0 outcome, first-loss
   * explanation when applicable, the full game strip, aggregate shooting,
   * turnover, rebound, free-throw, and possession facts, and the user's
   * five-player season table immediately below the record. Per-game values
   * are derived from the actual 82 games played, with an accessible
   * totals/per-game switch.
   */

  type PeakPlayer = FranchiseEraPool['players'][number];

  const SLOT_LABELS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;

  let manifest = $state<HoopRushManifest | null>(null);
  let pool = $state<FranchiseEraPool | null>(null);
  let run = $state<ChallengeRun | null>(null);
  let error = $state<string | null>(null);
  let totalsMode = $state(false);
  let replaying = $state(false);

  const { url } = $derived(page);

  $effect(() => {
    if (!browser) return;
    let cancelled = false;
    const runId = new URL(url.toString()).searchParams.get('runId');
    getManifest().then(
      (m) => {
        if (cancelled) return;
        manifest = m;
      },
      () => {
        if (!cancelled) error = 'The manifest is unavailable.';
      },
    );
    const loadRun = (id: string | null) => {
      const promise = id
        ? challengeRepository.loadCompletedRun(id)
        : challengeRepository.listCompletedRuns().then((rows) => {
            const latest = rows[0];
            return latest ? challengeRepository.loadCompletedRun(latest.runId) : null;
          });
      promise.then(
        (record) => {
          if (cancelled) return;
          if (!record) {
            error = 'No completed challenge found. Run one first.';
            return;
          }
          run = record.run;
          const entry = manifest?.pools.find(
            (p) => p.franchiseId === record.run.franchiseId && p.eraId === record.run.eraId,
          );
          if (entry) {
            getPool(entry).then(
              (p) => {
                if (!cancelled) pool = p;
              },
              () => {
                // The season table renders from run snapshots regardless.
              },
            );
          }
        },
        (e: unknown) => {
          if (!cancelled) error = e instanceof Error ? e.message : String(e);
        },
      );
    };
    loadRun(runId);
    return () => {
      cancelled = true;
    };
  });

  const franchise = $derived(
    manifest?.franchiseLineage.find((e) => e.franchiseId === run?.franchiseId) ?? null,
  );
  const era = $derived(manifest?.eras.find((e) => e.eraId === run?.eraId) ?? null);

  const aggregates = $derived(run?.aggregates ?? null);
  const record = $derived(aggregates?.team);

  /** The user's five in slot order with their packaged names. */
  const seasonTable = $derived.by(() => {
    const currentRun = run;
    if (!currentRun || !pool) {
      return [] as Array<{ player: PeakPlayer; aggregate: PlayerSeasonAggregate }>;
    }
    const byId = new Map(pool.players.map((p) => [p.playerId, p]));
    return currentRun.players
      .map((snapshot) => {
        const aggregate = currentRun.aggregates.players.find(
          (p) => p.playerId === snapshot.playerId,
        );
        const player = byId.get(snapshot.playerId);
        if (!aggregate || !player) return null;
        return { player, aggregate };
      })
      .filter(
        (row): row is { player: PeakPlayer; aggregate: PlayerSeasonAggregate } => row !== null,
      );
  });

  const displayAggregates = $derived.by(() => {
    if (!aggregates) return null;
    return {
      team: aggregates.team,
      players: aggregates.players.map((p) => (totalsMode ? p : perGamePlayer(p))),
    } satisfies RunAggregates;
  });

  /** Best single-game scoring performance among the user's five. */
  const bestPerformance = $derived.by(() => {
    if (!run) return null;
    let best: { playerId: string; gameNumber: number; points: number; opponent: string } | null =
      null;
    for (const game of run.games) {
      for (const player of game.home.players) {
        if (!best || player.points > best.points) {
          const entry = run.bracket.schedule[game.gameNumber - 1];
          const opponent = run.bracket.opponents.find((o) => o.opponentId === entry?.opponentId);
          best = {
            playerId: player.playerId,
            gameNumber: game.gameNumber,
            points: player.points,
            opponent: opponent?.displayName ?? 'Unknown',
          };
        }
      }
    }
    return best;
  });

  const bestPlayerName = $derived.by(() => {
    if (!bestPerformance || !pool) return bestPerformance?.playerId ?? null;
    const byId = new Map(pool.players.map((p) => [p.playerId, p]));
    return byId.get(bestPerformance.playerId)?.displayName ?? bestPerformance.playerId;
  });

  function pct(made: number, attempted: number): string {
    return attempted === 0 ? '—' : `${((made / attempted) * 100).toFixed(1)}%`;
  }

  function perGameValue(value: number, games: number, decimals = 1): string {
    return (value / Math.max(1, games)).toFixed(decimals);
  }

  function formatAggregateStat(value: number): string {
    return totalsMode ? String(value) : value.toFixed(1);
  }

  /** Recreates the run with the same seed and plays it again. */
  async function replaySameSeed() {
    if (!run || !pool || replaying) return;
    replaying = true;
    try {
      await createAndStart({ seed: run.runSeed });
    } finally {
      replaying = false;
    }
  }

  /** Creates a brand-new run with a fresh seed. */
  async function playNewSeed() {
    if (!run || !pool || replaying) return;
    replaying = true;
    try {
      await createAndStart({ seed: generateSeed() });
    } finally {
      replaying = false;
    }
  }

  async function createAndStart({ seed }: { seed: string }) {
    const currentRun = run;
    if (!currentRun || !pool || !manifest) return;
    const entry = manifest.pools.find(
      (p) => p.franchiseId === currentRun.franchiseId && p.eraId === currentRun.eraId,
    );
    if (!entry) {
      error = 'This matchup is not packaged yet.';
      return;
    }
    const profileEntry = manifest.eraSimulationProfiles.find((p) => p.eraId === currentRun.eraId);
    if (!profileEntry) {
      error = 'The decade simulation profile is unavailable.';
      return;
    }
    const [profile, bracket] = await Promise.all([
      getEraSimulationProfile(profileEntry),
      manifest.bracket ? getBracket(manifest.bracket) : Promise.reject(new Error('no bracket')),
    ]);
    const byId = new Map(pool.players.map((p) => [p.playerId, p]));
    const players = currentRun.playerIds.map((id) => byId.get(id)!);
    const sample = players[0];
    const created = createChallenge({
      runId: crypto.randomUUID(),
      mode: 'sandbox',
      franchiseId: currentRun.franchiseId,
      eraId: currentRun.eraId,
      homeDisplayName: currentRun.homeDisplayName,
      lineup: {
        structure: ['G', 'G', 'F', 'F', 'C'],
        assignments: players.map((player, slotIndex) => ({
          slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
          playerId: player.playerId,
          positions: player.positions.canonical,
        })),
      },
      players: players.map((player) => toSimulationPlayer(player)),
      runSeed: seed,
      dataVersion: profile.dataVersion,
      ratingVersion: sample?.source.ratingsVersion ?? 'unknown',
      positionNormalizationVersion: sample?.positions.normalizationVersion ?? 'position-v1',
      engineVersion: createEngineContext().engineVersion,
      profile,
      bracket,
    });
    await challengeRepository.saveActiveRun({
      recordId: 'active',
      saveSchemaVersion: 2,
      run: created,
    });
    void goto(resolve('/sandbox/challenge'));
  }

  function toggleMode() {
    totalsMode = !totalsMode;
  }

  const editHref = $derived(
    run
      ? (`/sandbox?franchise=${run.franchiseId}&era=${run.eraId}&slots=${run.playerIds.join(',')}` as RouteId)
      : null,
  );
</script>

<svelte:head>
  <title>Challenge result — Sandbox — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Sandbox · Result</p>
  <h1
    class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
  >
    Season report
  </h1>

  {#if error}
    <div class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <p class="font-semibold">Result unavailable</p>
      <p class="mt-1 text-muted-foreground">{error}</p>
      <a
        href={resolve('/sandbox/history')}
        class="mt-3 inline-flex rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"
      >
        Challenge history
      </a>
    </div>
  {:else if !run || !record}
    <div class="mt-8 grid place-items-center rounded-xl border border-border bg-card p-16">
      <div
        class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
      ></div>
      <p class="mt-4 font-mono text-xs tracking-[0.16em] text-muted-foreground uppercase">
        Loading result…
      </p>
    </div>
  {:else}
    <!-- Final record -->
    <div
      class="mt-8 rounded-2xl border border-line-strong bg-card p-6 shadow-[0_0_24px_hsl(13_100%_62%/0.12)] sm:p-8"
    >
      <div
        class="flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left"
      >
        <div class="flex items-center gap-3">
          {#if franchise && manifest}
            <TeamLogo
              {manifest}
              franchiseId={franchise.franchiseId}
              teamExternalId={franchise.teamExternalId}
              alt=""
              className="h-10 w-10"
            />
          {/if}
          <div>
            <p class="font-display text-xl font-extrabold tracking-tight uppercase">
              {run.homeDisplayName}
            </p>
            <p class="font-mono text-[10px] text-muted-foreground">
              {franchiseAbbreviation(run.franchiseId)} · {era?.label ?? run.eraId} · five players, no
              bench
            </p>
          </div>
        </div>
        <div class="text-center sm:text-right">
          <p class="font-display text-5xl font-extrabold tracking-tight sm:text-6xl">
            {record.wins}<span class="text-muted-foreground">–</span>{record.losses}
          </p>
          <SeasonTierBadge wins={record.wins} size="large" />
        </div>
      </div>

      <!-- The full 82-game strip -->
      <div class="mt-6 rounded-xl border border-border bg-surface-1 p-3 sm:p-4">
        <GameStrip {run} games={run.games} compact />
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onclick={replaySameSeed}
          disabled={replaying}
          class="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm font-semibold transition-colors hover:border-line-strong outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <RotateCcw class="h-4 w-4" />
          Replay this seed
        </button>
        <button
          type="button"
          onclick={playNewSeed}
          disabled={replaying}
          class="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm font-semibold transition-colors hover:border-line-strong outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <Dices class="h-4 w-4" />
          New seed
        </button>
        {#if editHref}
          <a
            href={resolve(editHref)}
            class="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm font-semibold transition-colors hover:border-line-strong hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Pencil class="h-4 w-4" />
            Edit lineup
          </a>
        {/if}
        <span class="ml-auto font-mono text-[10px] text-muted-foreground">
          seed {run.runSeed} · engine {run.versions.engineVersion} · bracket {run.versions
            .bracketVersion} · schedule {run.versions.scheduleVersion}
        </span>
      </div>
    </div>

    <!-- Five-player season table directly below the record -->
    <section
      aria-labelledby="season-table-heading"
      class="mt-6 rounded-xl border border-border bg-card p-5"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="season-table-heading"
          class="font-display text-xl font-extrabold tracking-tight uppercase"
        >
          Your five · season
        </h2>
        <div
          class="flex rounded-lg border border-border p-0.5"
          role="group"
          aria-label="Season values"
        >
          <button
            type="button"
            aria-pressed={!totalsMode}
            onclick={toggleMode}
            class="rounded-md px-3 py-1 font-mono text-xs font-semibold {!totalsMode
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground'}"
          >
            Per game
          </button>
          <button
            type="button"
            aria-pressed={totalsMode}
            onclick={toggleMode}
            class="rounded-md px-3 py-1 font-mono text-xs font-semibold {totalsMode
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground'}"
          >
            Totals
          </button>
        </div>
      </div>
      {#if displayAggregates && seasonTable.length > 0}
        <div class="mt-4 overflow-x-auto">
          <table class="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr
                class="border-b border-border font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
              >
                <th scope="col" class="py-2 pr-3 text-left">Player</th>
                <th scope="col" class="px-2 py-2 text-right">PTS</th>
                <th scope="col" class="px-2 py-2 text-right">FG%</th>
                <th scope="col" class="px-2 py-2 text-right">3P%</th>
                <th scope="col" class="px-2 py-2 text-right">FT%</th>
                <th scope="col" class="px-2 py-2 text-right">REB</th>
                <th scope="col" class="px-2 py-2 text-right">AST</th>
                <th scope="col" class="px-2 py-2 text-right">STL</th>
                <th scope="col" class="px-2 py-2 text-right">BLK</th>
                <th scope="col" class="px-2 py-2 text-right">TOV</th>
              </tr>
            </thead>
            <tbody>
              {#each displayAggregates.players as aggregate, index (aggregate.playerId)}
                {@const row = seasonTable[index]}
                {@const raw = aggregates!.players.find((p) => p.playerId === aggregate.playerId)!}
                <tr class="border-b border-border/50 last:border-0">
                  <th scope="row" class="py-2 pr-3 text-left">
                    <span class="flex items-center gap-2">
                      {#if row}
                        <PlayerFace
                          player={row.player}
                          manifest={manifest!}
                          size="sm"
                          fallbackInitials={row.player.firstName[0]! + row.player.lastName[0]!}
                        />
                        <span class="min-w-0">
                          <span class="block truncate font-semibold">
                            {row.player.displayName}
                          </span>
                          <span class="block font-mono text-[10px] text-muted-foreground">
                            {SLOT_LABELS[index]}
                          </span>
                        </span>
                      {:else}
                        <span class="font-mono text-xs">{aggregate.playerId}</span>
                      {/if}
                    </span>
                  </th>
                  <td class="px-2 py-2 text-right font-mono font-bold">
                    {formatAggregateStat(aggregate.points)}
                  </td>
                  <td class="px-2 py-2 text-right font-mono">
                    {pct(raw.fieldGoals.made, raw.fieldGoals.attempted)}
                  </td>
                  <td class="px-2 py-2 text-right font-mono">
                    {pct(raw.threes.made, raw.threes.attempted)}
                  </td>
                  <td class="px-2 py-2 text-right font-mono">
                    {pct(raw.freeThrows.made, raw.freeThrows.attempted)}
                  </td>
                  <td class="px-2 py-2 text-right font-mono">
                    {formatAggregateStat(aggregate.rebounds.total)}
                  </td>
                  <td class="px-2 py-2 text-right font-mono">
                    {formatAggregateStat(aggregate.assists)}
                  </td>
                  <td class="px-2 py-2 text-right font-mono">
                    {formatAggregateStat(aggregate.steals)}
                  </td>
                  <td class="px-2 py-2 text-right font-mono">
                    {formatAggregateStat(aggregate.blocks)}
                  </td>
                  <td class="px-2 py-2 text-right font-mono">
                    {formatAggregateStat(aggregate.turnovers)}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="mt-3 font-mono text-[10px] text-muted-foreground">
          Per-game values divide exact season totals by the actual games played ({record.gamesPlayed}).
        </p>
      {:else}
        <p class="mt-4 animate-pulse text-sm text-muted-foreground">Loading season table…</p>
      {/if}
    </section>

    <!-- Aggregate facts and best performance -->
    <div class="mt-6 grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="facts-heading" class="rounded-xl border border-border bg-card p-5">
        <h2 id="facts-heading" class="font-display text-xl font-extrabold tracking-tight uppercase">
          Season facts
        </h2>
        <dl class="mt-4 flex flex-col gap-3 text-sm">
          <div
            class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
          >
            <dt
              class="shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
            >
              Field goal
            </dt>
            <dd class="min-w-0 font-mono sm:text-right">
              {pct(record.fieldGoals.made, record.fieldGoals.attempted)} · {record.fieldGoals.made}/
              {record.fieldGoals.attempted}
            </dd>
          </div>
          <div
            class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
          >
            <dt
              class="shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
            >
              Three-point
            </dt>
            <dd class="min-w-0 font-mono sm:text-right">
              {pct(record.threes.made, record.threes.attempted)} · {record.threes.made}/
              {record.threes.attempted}
            </dd>
          </div>
          <div
            class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
          >
            <dt
              class="shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
            >
              Free throws
            </dt>
            <dd class="min-w-0 font-mono sm:text-right">
              {pct(record.freeThrows.made, record.freeThrows.attempted)} · {record.freeThrows.made}/
              {record.freeThrows.attempted}
            </dd>
          </div>
          <div
            class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
          >
            <dt
              class="shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
            >
              Turnovers
            </dt>
            <dd class="min-w-0 font-mono sm:text-right">
              {perGameValue(record.turnovers, record.gamesPlayed)} per game · {record.turnovers} total
            </dd>
          </div>
          <div
            class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
          >
            <dt
              class="shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
            >
              Rebounds
            </dt>
            <dd class="min-w-0 font-mono sm:text-right">
              <span class="block sm:inline"
                >{perGameValue(record.rebounds.total, record.gamesPlayed)} per game</span
              >
              <span class="block text-muted-foreground sm:inline">
                <span class="hidden sm:inline"> · </span>
                {record.rebounds.offensive} offensive · {record.rebounds.defensive} defensive
              </span>
            </dd>
          </div>
          <div
            class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
          >
            <dt
              class="shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
            >
              Assists
            </dt>
            <dd class="min-w-0 font-mono sm:text-right">
              {perGameValue(record.assists, record.gamesPlayed)} per game · {record.assists} total
            </dd>
          </div>
          <div
            class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
          >
            <dt
              class="shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
            >
              Possessions
            </dt>
            <dd class="min-w-0 font-mono sm:text-right">
              {perGameValue(record.possessions, record.gamesPlayed)} per game · {record.possessions} total
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="best-heading" class="rounded-xl border border-border bg-card p-5">
        <h2 id="best-heading" class="font-display text-xl font-extrabold tracking-tight uppercase">
          Best performance
        </h2>
        {#if bestPerformance}
          <div class="mt-4 rounded-lg border border-border bg-surface-1 p-4">
            <p class="font-display text-lg font-extrabold tracking-tight uppercase">
              {bestPlayerName}
            </p>
            <p class="mt-1 font-mono text-xs text-muted-foreground">
              {bestPerformance.points} points · game {bestPerformance.gameNumber} vs {bestPerformance.opponent}
            </p>
          </div>
          <p class="mt-3 text-xs text-muted-foreground">
            The single-game scoring high for your five across all {record.gamesPlayed} games.
          </p>
        {:else}
          <p class="mt-4 text-sm text-muted-foreground">No games recorded.</p>
        {/if}
      </section>
    </div>
  {/if}
</section>
