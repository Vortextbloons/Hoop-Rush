<script lang="ts" module>
  /** Relative width of the left value against the right, clamped for bars. */
  export function barWidth(left: number, right: number): number {
    const total = Math.max(1, left + right);
    return Math.max(4, Math.min(96, (left / total) * 100));
  }
</script>

<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { Dices, Pencil, RotateCcw } from '@lucide/svelte';
  import type {
    EraSimulationProfile,
    ExplanationFact,
    FranchiseEraPool,
    GameResult,
    GameSimulationInput,
    HoopRushManifest,
    OpponentTeam,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import {
    createEngineContext,
    createOpeningGameInput,
    simulateGame,
    type DraftedLineup,
  } from '@hoop-rush/engine';
  import { getEraSimulationProfile, getManifest, getOpeningOpponent, getPool } from '$lib/data';
  import { buildSandboxUrl, generateSeed, parseSandboxUrl } from '$lib/sandbox-url';
  import TeamLogo from '$lib/components/TeamLogo.svelte';

  type PeakPlayer = FranchiseEraPool['players'][number];

  const SLOT_LABELS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
  const draftHref = resolve('/sandbox');

  let manifest = $state<HoopRushManifest | null>(null);
  let pool = $state<FranchiseEraPool | null>(null);
  let profile = $state<EraSimulationProfile | null>(null);
  let opponent = $state<OpponentTeam | null>(null);
  let error = $state<string | null>(null);

  let franchiseId = $state('');
  let eraId = $state('');
  let playerIds = $state<string[]>([]);
  let seed = $state<string | null>(null);

  let result = $state<GameResult | null>(null);
  let simulating = $state(false);
  let activeTab: 'user' | 'opponent' = $state('user');

  const context = $state(createEngineContext());
  const { url } = $derived(page);
  const currentUrl = $derived(url.toString());

  $effect(() => {
    if (!browser) return;
    const url = new URL(currentUrl);
    const params = url.searchParams;
    franchiseId = params.get('franchise') ?? '';
    eraId = params.get('era') ?? '';
    playerIds = params.get('slots')?.split(',') ?? [];
    seed = params.get('seed');

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
            if (!validation.ok || !validation.state || !validation.state.seed) {
              error =
                validation.error ??
                'This game needs a seed in the URL. Return to setup and start again.';
              return;
            }
            if (!m.opponents[0]) {
              error = 'The opening opponent is unavailable.';
              return;
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

  /** Runs the seeded simulation whenever the URL, pool, profile, or opponent settle. */
  let simulatedKey = $state('');
  $effect(() => {
    if (!browser || pool === null || profile === null || opponent === null || seed === null) return;
    const key = `${currentUrl}-${profile.profileVersion}-${opponent.opponentId}`;
    if (simulatedKey === key) return;
    simulatedKey = key;
    simulateFrom(pool);
  });

  /** Runs the seeded simulation once all inputs are loaded. */
  function simulateFrom(p: FranchiseEraPool) {
    const url = new URL(currentUrl);
    const validation = parseSandboxUrl(url, manifest, p);
    if (!validation.ok || !validation.state?.seed) return;
    const byId = new Map(p.players.map((pl) => [pl.playerId, pl]));
    const drafted: DraftedLineup = {
      lineup: {
        structure: ['G', 'G', 'F', 'F', 'C'],
        assignments: validation.state.playerIds.map((playerId, slotIndex) => ({
          slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
          playerId,
          positions: byId.get(playerId)!.positions.canonical,
        })),
      },
      players: validation.state.playerIds.map((playerId) => byId.get(playerId)!),
    };
    if (!opponent || !profile) return;
    simulating = true;
    try {
      const input = createOpeningGameInput({
        seed: validation.state.seed,
        dataVersion: profile.dataVersion,
        profile,
        drafted,
        opponent,
      });
      result = simulateGame(input, context);
    } finally {
      simulating = false;
    }
  }

  const franchise = $derived(
    manifest?.franchiseLineage.find((e) => e.franchiseId === franchiseId) ?? null,
  );
  const era = $derived(manifest?.eras.find((e) => e.eraId === eraId) ?? null);
  const drafted = $derived.by((): PeakPlayer[] => {
    if (!pool) return [];
    const byId = new Map(pool.players.map((p) => [p.playerId, p]));
    return playerIds.map((id) => byId.get(id)).filter((p): p is PeakPlayer => p !== undefined);
  });

  function replaySameSeed() {
    if (!pool || !opponent || !profile || !seed) return;
    result = null;
    simulateFrom(pool);
  }

  function playNewSeed() {
    if (!seed) return;
    const next = buildSandboxUrl({ franchiseId, eraId, playerIds, seed: generateSeed() }, 'game');
    void goto(resolve(next));
  }

  /** Edit link carries the draft back so the board restores exactly. */
  const editHref = $derived(buildSandboxUrl({ franchiseId, eraId, playerIds }, 'draft'));

  function pct(made: number, attempted: number): string {
    return attempted === 0 ? '—' : `${((made / attempted) * 100).toFixed(1)}%`;
  }

  function playerName(playerId: string): string {
    const draftedName = drafted.find((p) => p.playerId === playerId)?.displayName;
    if (draftedName) return draftedName;
    const opponentName = opponent?.players.find((p) => p.playerId === playerId)?.displayName;
    return opponentName ?? playerId;
  }

  function factWording(fact: ExplanationFact): string {
    switch (fact.kind) {
      case 'turnoverMargin': {
        const margin = Math.round(fact.evidence.margin ?? 0);
        return `turned it over ${Math.round(fact.evidence.teamTurnovers ?? 0)} times to ${Math.round(fact.evidence.opponentTurnovers ?? 0)} — a ${margin}-turnover edge`;
      }
      case 'shotEfficiency': {
        const efg = fact.evidence.efgPct ?? 0;
        const opp = fact.evidence.opponentEfgPct ?? 0;
        return `shot ${pct(Math.round(efg * 1000), 1000)} effective from the field to ${pct(Math.round(opp * 1000), 1000)}`;
      }
      case 'offensiveRebounds': {
        const margin = Math.round(fact.evidence.margin ?? 0);
        return `grabbed ${Math.round(fact.evidence.teamOffensiveRebounds ?? 0)} offensive rebounds to ${Math.round(fact.evidence.opponentOffensiveRebounds ?? 0)} — ${margin} extra possessions`;
      }
      case 'freeThrows': {
        const fta = Math.round(fact.evidence.teamFreeThrowAttempts ?? 0);
        const ftm = Math.round(fact.evidence.teamFreeThrowMakes ?? 0);
        return `lived at the line: ${ftm}/${fta} free throws to ${Math.round(fact.evidence.opponentFreeThrowAttempts ?? 0)} attempts`;
      }
      case 'usage': {
        const name = fact.playerIds[0] ? playerName(fact.playerIds[0]) : 'the lead scorer';
        return `${name} carried the scoring: ${Math.round(fact.evidence.playerPoints ?? 0)} of ${Math.round(fact.evidence.teamPoints ?? 0)} team points`;
      }
      case 'overtime': {
        const periods = Math.round(fact.evidence.periods ?? 0);
        return `went to ${periods} overtime ${periods === 1 ? 'period' : 'periods'} and closed it out ${Math.round(fact.evidence.homeOvertimePoints ?? 0)}-${Math.round(fact.evidence.awayOvertimePoints ?? 0)}`;
      }
    }
  }
</script>

<svelte:head>
  <title>Game result — Sandbox — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Sandbox · Result</p>
  <h1
    class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
  >
    The tape
  </h1>

  {#if error}
    <div class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <p class="font-semibold">Game unavailable</p>
      <p class="mt-1 text-muted-foreground">{error}</p>
      <a
        href={draftHref}
        class="mt-3 inline-flex rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"
      >
        Back to the draft
      </a>
    </div>
  {:else if !result}
    <div class="mt-8 grid place-items-center rounded-xl border border-border bg-card p-16">
      <div
        class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
      ></div>
      <p class="mt-4 font-mono text-xs tracking-[0.16em] text-muted-foreground uppercase">
        {simulating ? 'Simulating possession by possession…' : 'Loading game…'}
      </p>
    </div>
  {:else}
    {@const userWon = result.winner === 'home'}
    {@const ub = result.home.box}
    {@const ob = result.away.box}
    <div class="mt-8">
      <!-- Scoreboard -->
      <div
        class="rounded-2xl border border-line-strong bg-card p-6 shadow-[0_0_24px_hsl(13_100%_62%/0.12)]"
      >
        <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-6">
          <div
            class="flex flex-col items-center gap-1 text-center sm:flex-row sm:gap-3 sm:text-left"
          >
            {#if franchise && manifest}
              <TeamLogo
                {manifest}
                franchiseId={franchise.franchiseId}
                teamExternalId={franchise.teamExternalId}
                alt=""
                className="h-8 w-8"
              />
            {/if}
            <div class="min-w-0">
              <p
                class="font-display truncate text-sm font-extrabold tracking-tight uppercase sm:text-lg"
              >
                {franchise?.displayName ?? 'Your five'}
              </p>
              <p class="font-mono text-[10px] text-muted-foreground">
                {franchiseAbbreviation(franchise?.franchiseId ?? 'user')} · {era?.label ?? eraId}
              </p>
            </div>
          </div>

          <div class="flex flex-col items-center gap-1">
            <p class="font-display text-5xl font-extrabold tracking-tight sm:text-7xl">
              <span class={userWon ? 'text-primary' : 'text-muted-foreground'}>
                {result.home.box.points}
              </span>
              <span class="mx-2 text-muted-foreground">–</span>
              <span class={!userWon ? 'text-primary' : 'text-muted-foreground'}>
                {result.away.box.points}
              </span>
            </p>
            <p
              class="rounded-full border px-3 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase {userWon
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-destructive/40 bg-destructive/10 text-destructive'}"
            >
              {userWon ? 'W' : 'L'} · {result.overtimePeriods > 0
                ? `${result.overtimePeriods} OT`
                : 'Regulation'}
            </p>
          </div>

          <div
            class="flex flex-col items-center gap-1 text-center sm:flex-row-reverse sm:gap-3 sm:text-right"
          >
            {#if opponent && manifest}
              <TeamLogo
                {manifest}
                franchiseId={opponent.teamId}
                teamExternalId={franchise?.teamExternalId ?? ''}
                alt=""
                className="h-8 w-8"
              />
            {/if}
            <div class="min-w-0">
              <p
                class="font-display truncate text-sm font-extrabold tracking-tight uppercase sm:text-lg"
              >
                {result.away.displayName}
              </p>
              <p class="font-mono text-[10px] text-muted-foreground">
                {opponent?.seasonKey ?? ''} · Medium
              </p>
            </div>
          </div>
        </div>

        <!-- Period scores -->
        <div class="mt-6 overflow-x-auto" aria-label="Period scores">
          <table class="w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr
                class="border-b border-border font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase"
              >
                <th scope="col" class="py-2 pr-4 text-left">Team</th>
                {#each result.periodScores.home as _, period (period)}
                  <th scope="col" class="px-2 py-2 text-right">
                    {period < 4 ? `Q${period + 1}` : `OT${period - 3}`}
                  </th>
                {/each}
                <th scope="col" class="px-3 py-2 text-right">Final</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-border/60">
                <th scope="row" class="py-2 pr-4 text-left font-semibold">
                  {franchiseAbbreviation(franchise?.franchiseId ?? 'user')}
                </th>
                {#each result.periodScores.home as score, period (period)}
                  <td class="px-2 py-2 text-right font-mono">{score}</td>
                {/each}
                <td class="px-3 py-2 text-right font-mono font-bold text-primary">
                  {result.home.box.points}
                </td>
              </tr>
              <tr>
                <th scope="row" class="py-2 pr-4 text-left font-semibold">
                  {franchiseAbbreviation(opponent?.teamId ?? 'opp')}
                </th>
                {#each result.periodScores.away as score, period (period)}
                  <td class="px-2 py-2 text-right font-mono">{score}</td>
                {/each}
                <td class="px-3 py-2 text-right font-mono font-bold">
                  {result.away.box.points}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onclick={replaySameSeed}
            class="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm font-semibold transition-colors hover:border-line-strong hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw class="h-4 w-4" />
            Replay this seed
          </button>
          <button
            type="button"
            onclick={playNewSeed}
            class="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm font-semibold transition-colors hover:border-line-strong hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Dices class="h-4 w-4" />
            New seed
          </button>
          <a
            href={resolve(editHref)}
            class="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm font-semibold transition-colors hover:border-line-strong hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Pencil class="h-4 w-4" />
            Edit lineup
          </a>
        </div>
        <p class="mt-3 font-mono text-[10px] text-muted-foreground">
          seed {result.seed} · engine {result.engineVersion} · profile {result.profileVersion} · data
          {result.dataVersion}
        </p>
      </div>

      <!-- Evidence panel -->
      <section
        aria-labelledby="why-heading"
        class="mt-6 rounded-xl border border-border bg-card p-5"
      >
        <h2 id="why-heading" class="font-display text-xl font-extrabold tracking-tight uppercase">
          Why it ended this way
        </h2>
        {#if result.facts.length === 0}
          <p class="mt-3 text-sm text-muted-foreground">
            A grind: neither side created a decisive margin in turnovers, shooting, the glass, or
            the line.
          </p>
        {:else}
          <ul class="mt-3 flex flex-col gap-2">
            {#each result.facts as fact (fact.kind)}
              <li
                class="flex items-start gap-3 rounded-lg border border-border bg-surface-1 p-3 text-sm"
              >
                <span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true"
                ></span>
                <span>
                  <span class="font-semibold">
                    {fact.teamId === result.home.teamId
                      ? (franchise?.displayName ?? 'Your five')
                      : result.away.displayName}
                  </span>
                  {factWording(fact)}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <div
        class="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      >
        <!-- Box score -->
        <section
          aria-labelledby="box-heading"
          class="min-w-0 rounded-xl border border-border bg-card p-5"
        >
          <div class="flex items-center justify-between gap-3">
            <h2
              id="box-heading"
              class="font-display text-xl font-extrabold tracking-tight uppercase"
            >
              Box score
            </h2>
            <div
              class="flex rounded-lg border border-border p-0.5"
              role="group"
              aria-label="Box score team"
            >
              <button
                type="button"
                aria-pressed={activeTab === 'user'}
                onclick={() => (activeTab = 'user')}
                class="rounded-md px-3 py-1 font-mono text-xs font-semibold {activeTab === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground'}"
              >
                Your five · {franchiseAbbreviation(franchise?.franchiseId ?? 'user')}
              </button>
              <button
                type="button"
                aria-pressed={activeTab === 'opponent'}
                onclick={() => (activeTab = 'opponent')}
                class="rounded-md px-3 py-1 font-mono text-xs font-semibold {activeTab ===
                'opponent'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground'}"
              >
                {result.away.displayName} · {franchiseAbbreviation(opponent?.teamId ?? 'opp')}
              </button>
            </div>
          </div>

          <div class="mt-4 overflow-x-auto">
            <table class="w-full min-w-[540px] border-collapse text-sm">
              <thead>
                <tr
                  class="border-b border-border font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
                >
                  <th scope="col" class="py-2 pr-3 text-left">Player</th>
                  <th scope="col" class="px-2 py-2 text-right">MIN</th>
                  <th scope="col" class="px-2 py-2 text-right">PTS</th>
                  <th scope="col" class="px-2 py-2 text-right">FG</th>
                  <th scope="col" class="px-2 py-2 text-right">3P</th>
                  <th scope="col" class="px-2 py-2 text-right">FT</th>
                  <th scope="col" class="px-2 py-2 text-right">REB</th>
                  <th scope="col" class="px-2 py-2 text-right">AST</th>
                  <th scope="col" class="px-2 py-2 text-right">STL</th>
                  <th scope="col" class="px-2 py-2 text-right">BLK</th>
                  <th scope="col" class="px-2 py-2 text-right">TOV</th>
                  <th scope="col" class="px-2 py-2 text-right">PF</th>
                </tr>
              </thead>
              <tbody>
                {#each activeTab === 'user' ? result.home.players : result.away.players as player, i (i)}
                  <tr class="border-b border-border/50 last:border-0">
                    <th scope="row" class="py-2 pr-3 text-left font-semibold">
                      {player.playerId === 'user' || !pool
                        ? player.playerId
                        : (drafted.find((p) => p.playerId === player.playerId)?.displayName ??
                          player.playerId)}
                    </th>
                    <td class="px-2 py-2 text-right font-mono">{player.minutes}</td>
                    <td class="px-2 py-2 text-right font-mono font-bold">{player.points}</td>
                    <td class="px-2 py-2 text-right font-mono">
                      {player.fieldGoals.made}/{player.fieldGoals.attempted}
                    </td>
                    <td class="px-2 py-2 text-right font-mono">
                      {player.threes.made}/{player.threes.attempted}
                    </td>
                    <td class="px-2 py-2 text-right font-mono">
                      {player.freeThrows.made}/{player.freeThrows.attempted}
                    </td>
                    <td class="px-2 py-2 text-right font-mono">{player.rebounds.total}</td>
                    <td class="px-2 py-2 text-right font-mono">{player.assists}</td>
                    <td class="px-2 py-2 text-right font-mono">{player.steals}</td>
                    <td class="px-2 py-2 text-right font-mono">{player.blocks}</td>
                    <td class="px-2 py-2 text-right font-mono">{player.turnovers}</td>
                    <td class="px-2 py-2 text-right font-mono">{player.fouls}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          <p class="mt-3 font-mono text-[10px] text-muted-foreground">
            No substitutions: all five play {48 + result.overtimePeriods * 5} minutes.
          </p>
        </section>

        <!-- Team comparison -->
        <section
          aria-labelledby="compare-heading"
          class="rounded-xl border border-border bg-card p-5"
        >
          <h2
            id="compare-heading"
            class="font-display text-xl font-extrabold tracking-tight uppercase"
          >
            Team comparison
          </h2>
          <dl class="mt-4 flex flex-col gap-3">
            <div class="flex items-center gap-3">
              <dt
                class="w-32 shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
              >
                Field goal
              </dt>
              <dd class="min-w-0 flex-1 text-right font-mono text-sm">
                {pct(ub.fieldGoals.made, ub.fieldGoals.attempted)}
              </dd>
              <div class="h-1.5 min-w-0 flex-1 rounded-full bg-surface-3" aria-hidden="true">
                <div
                  class="h-full rounded-full bg-primary"
                  style="width: {barWidth(
                    ub.fieldGoals.made / Math.max(1, ub.fieldGoals.attempted),
                    ob.fieldGoals.made / Math.max(1, ob.fieldGoals.attempted),
                  )}%"
                ></div>
              </div>
              <dd class="min-w-0 flex-1 text-left font-mono text-sm">
                {pct(ob.fieldGoals.made, ob.fieldGoals.attempted)}
              </dd>
            </div>
            <div class="flex items-center gap-3">
              <dt
                class="w-32 shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
              >
                Three-point
              </dt>
              <dd class="min-w-0 flex-1 text-right font-mono text-sm">
                {pct(ub.threes.made, ub.threes.attempted)}
              </dd>
              <div class="h-1.5 min-w-0 flex-1 rounded-full bg-surface-3" aria-hidden="true">
                <div
                  class="h-full rounded-full bg-primary"
                  style="width: {barWidth(
                    ub.threes.made / Math.max(1, ub.threes.attempted),
                    ob.threes.made / Math.max(1, ob.threes.attempted),
                  )}%"
                ></div>
              </div>
              <dd class="min-w-0 flex-1 text-left font-mono text-sm">
                {pct(ob.threes.made, ob.threes.attempted)}
              </dd>
            </div>
            <div class="flex items-center gap-3">
              <dt
                class="w-32 shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
              >
                Turnovers
              </dt>
              <dd class="min-w-0 flex-1 text-right font-mono text-sm">{ub.turnovers}</dd>
              <div class="h-1.5 min-w-0 flex-1 rounded-full bg-surface-3" aria-hidden="true">
                <div
                  class="h-full rounded-full bg-primary"
                  style="width: {barWidth(ub.turnovers, ob.turnovers)}%"
                ></div>
              </div>
              <dd class="min-w-0 flex-1 text-left font-mono text-sm">{ob.turnovers}</dd>
            </div>
            <div class="flex items-center gap-3">
              <dt
                class="w-32 shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
              >
                Off. rebounds
              </dt>
              <dd class="min-w-0 flex-1 text-right font-mono text-sm">{ub.rebounds.offensive}</dd>
              <div class="h-1.5 min-w-0 flex-1 rounded-full bg-surface-3" aria-hidden="true">
                <div
                  class="h-full rounded-full bg-primary"
                  style="width: {barWidth(ub.rebounds.offensive, ob.rebounds.offensive)}%"
                ></div>
              </div>
              <dd class="min-w-0 flex-1 text-left font-mono text-sm">{ob.rebounds.offensive}</dd>
            </div>
            <div class="flex items-center gap-3">
              <dt
                class="w-32 shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
              >
                Free throws
              </dt>
              <dd class="min-w-0 flex-1 text-right font-mono text-sm">
                {ub.freeThrows.made}/{ub.freeThrows.attempted}
              </dd>
              <div class="h-1.5 min-w-0 flex-1 rounded-full bg-surface-3" aria-hidden="true">
                <div
                  class="h-full rounded-full bg-primary"
                  style="width: {barWidth(ub.freeThrows.attempted, ob.freeThrows.attempted)}%"
                ></div>
              </div>
              <dd class="min-w-0 flex-1 text-left font-mono text-sm">
                {ob.freeThrows.made}/{ob.freeThrows.attempted}
              </dd>
            </div>
            <div class="flex items-center gap-3">
              <dt
                class="w-32 shrink-0 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase"
              >
                Possessions
              </dt>
              <dd class="min-w-0 flex-1 text-right font-mono text-sm">{ub.possessions}</dd>
              <div class="h-1.5 min-w-0 flex-1 rounded-full bg-surface-3" aria-hidden="true">
                <div
                  class="h-full rounded-full bg-primary"
                  style="width: {barWidth(ub.possessions, ob.possessions)}%"
                ></div>
              </div>
              <dd class="min-w-0 flex-1 text-left font-mono text-sm">{ob.possessions}</dd>
            </div>
          </dl>
          <p class="mt-4 font-mono text-[10px] text-muted-foreground">
            {pct(ub.fieldGoals.made, ub.fieldGoals.attempted)} FG · {pct(
              ub.threes.made,
              ub.threes.attempted,
            )} 3P · {pct(ub.freeThrows.made, ub.freeThrows.attempted)} FT — left column
          </p>
        </section>
      </div>
    </div>
  {/if}
</section>
