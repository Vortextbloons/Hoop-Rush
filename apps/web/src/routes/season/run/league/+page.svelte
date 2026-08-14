<script lang="ts">
  import { getContext } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import type { SeasonTeamAggregate } from '@hoop-rush/data-contracts';
  import StandingsTable from '$lib/components/season/StandingsTable.svelte';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import TiebreakExplanations from '$lib/components/season/TiebreakExplanations.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import {
    foldSeasonAggregates,
    franchiseStreaks,
    pointDifferential,
  } from '$lib/season/season-presentation';
  import {
    postseasonRankingsOf,
    rankedEntriesOf,
  } from '$lib/season/season-postseason-presentation';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  import { oneDecimal } from '$lib/format';

  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);

  type LeagueView = 'standings' | 'stats';
  let view = $state<LeagueView>('standings');
  let conference = $state<'east' | 'west'>(
    shell.humanTeam?.conference === 'west' ? 'west' : 'east',
  );

  const humanFranchiseId = $derived(shell.humanFranchiseId);
  const manifest = $derived(shell.manifest);
  const run = $derived(shell.run);
  const standings = $derived(run?.standings ?? null);

  const rankings = $derived(run !== null ? postseasonRankingsOf(run) : null);
  const rankedEntries = $derived(
    rankings !== null && standings !== null ? rankedEntriesOf(rankings, standings) : null,
  );

  const tiebreakResolutions = $derived.by(() => {
    const recorded = run?.postseason.tiebreakResolutions ?? [];
    if (recorded.length > 0) return recorded;
    return rankings !== null ? [...rankings.east.resolutions, ...rankings.west.resolutions] : [];
  });

  const streaksByFranchise = $derived.by(() => {
    const summaries = shell.snapshot?.summaries ?? [];
    const rows = shell.run?.standings.rows ?? [];
    return new SvelteMap(
      franchiseStreaks(
        summaries,
        rows.map((row) => row.franchiseId),
      ),
    );
  });
  const streakOf = (franchiseId: string): { kind: 'wins' | 'losses'; length: number } | null =>
    streaksByFranchise.get(franchiseId) ?? null;

  const aggregates = $derived(
    shell.snapshot ? foldSeasonAggregates(shell.snapshot.summaries) : null,
  );

  const teamStats = $derived.by(() => {
    if (!aggregates || !standings) return [];
    const byId = new SvelteMap(standings.rows.map((row) => [row.franchiseId, row]));
    const rows: Array<{
      franchiseId: string;
      gamesPlayed: number;
      wins: number;
      diff: number;
      ppg: number;
      rpg: number;
      apg: number;
      spg: number;
      bpg: number;
      topg: number;
    }> = aggregates.teams.map((team: SeasonTeamAggregate) => {
      const gp = Math.max(1, team.gamesPlayed);
      const row = byId.get(team.franchiseId);
      return {
        franchiseId: team.franchiseId,
        gamesPlayed: team.gamesPlayed,
        wins: row?.wins ?? 0,
        diff: row ? pointDifferential(row) : 0,
        ppg: team.points / gp,
        rpg: (team.offensiveRebounds + team.defensiveRebounds) / gp,
        apg: team.assists / gp,
        spg: team.steals / gp,
        bpg: team.blocks / gp,
        topg: team.turnovers / gp,
      };
    });
    rows.sort(
      (a, b) => b.wins - a.wins || b.diff - a.diff || a.franchiseId.localeCompare(b.franchiseId),
    );
    return rows;
  });

  const identityOf = (franchiseId: string) =>
    manifest ? franchiseIdentityOf(manifest, franchiseId) : null;

  const statCells: ReadonlyArray<{
    key: keyof Omit<(typeof teamStats)[number], 'franchiseId' | 'gamesPlayed' | 'wins'>;
    label: string;
  }> = [
    { key: 'ppg', label: 'PPG' },
    { key: 'rpg', label: 'RPG' },
    { key: 'apg', label: 'APG' },
    { key: 'spg', label: 'SPG' },
    { key: 'bpg', label: 'BPG' },
    { key: 'topg', label: 'TOPG' },
  ];

  let desktopViewport = $state<boolean | null>(null);
  $effect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => {
      desktopViewport = media.matches;
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });
</script>

<svelte:head>
  <title>Season Run — league — Hoop Rush</title>
</svelte:head>

{#if !shell.ready || !shell.snapshot || !run || !humanFranchiseId || !manifest}
  <p class="py-10 font-mono text-sm text-muted-foreground">Preparing the league…</p>
{:else}
  <section aria-labelledby="league-heading" class="min-w-0 pt-6">
    <div class="flex flex-col gap-3 px-3 sm:flex-row sm:items-end sm:justify-between sm:px-0">
      <div class="min-w-0">
        <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
          Season Run · league
        </p>
        <h1
          id="league-heading"
          class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl"
        >
          League
        </h1>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
          {shell.snapshot.acceptedBlocks.length * 10 > 82
            ? 82
            : shell.snapshot.acceptedBlocks.length * 10}
          team games accepted{shell.seasonComplete ? ' (final)' : ''}
        </p>
      </div>
      <div class="flex shrink-0 flex-col items-start gap-2 sm:items-end">
        <div role="group" aria-label="League view" class="flex rounded-lg bg-surface-2 p-1">
          <button
            type="button"
            aria-pressed={view === 'standings'}
            onclick={() => {
              view = 'standings';
            }}
            class="rounded-md px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {view ===
            'standings'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            Standings
          </button>
          <button
            type="button"
            aria-pressed={view === 'stats'}
            onclick={() => {
              view = 'stats';
            }}
            class="rounded-md px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {view ===
            'stats'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            Team stats
          </button>
        </div>
        {#if view === 'standings'}
          <div role="group" aria-label="Conference" class="flex rounded-lg bg-surface-2 p-1">
            <button
              type="button"
              aria-pressed={conference === 'east'}
              onclick={() => {
                conference = 'east';
              }}
              class="rounded-md px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {conference ===
              'east'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
            >
              East
            </button>
            <button
              type="button"
              aria-pressed={conference === 'west'}
              onclick={() => {
                conference = 'west';
              }}
              class="rounded-md px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {conference ===
              'west'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'}"
            >
              West
            </button>
          </div>
        {/if}
      </div>
    </div>

    {#if view === 'standings'}
      <div class="mt-6">
        <StandingsTable
          standings={run.standings}
          league={run.league}
          {humanFranchiseId}
          franchiseName={shell.franchiseName}
          {streakOf}
          {conference}
          {manifest}
          rankedOrder={rankedEntries}
        />
      </div>
      <div class="mt-6">
        <TiebreakExplanations
          resolutions={tiebreakResolutions}
          franchiseName={shell.franchiseName}
          {conference}
        />
      </div>
    {:else}
      {#if teamStats.length === 0}
        <p class="mt-8 rounded-xl bg-surface-1 p-6 text-sm text-muted-foreground">
          No team stats yet — accept a block to fold game summaries.
        </p>
      {:else}
        {#if desktopViewport !== true}
          <ul class="mt-6 flex flex-col gap-0 md:hidden md:gap-2">
            {#each teamStats as team (team.franchiseId)}
              {@const isHuman = team.franchiseId === humanFranchiseId}
              {@const identity = identityOf(team.franchiseId)}
              <li
                data-season-team-stats-row
                aria-label={isHuman
                  ? `${shell.franchiseName(team.franchiseId)} (your team)`
                  : undefined}
                class="overflow-hidden bg-surface-1 px-3 py-3 sm:rounded-xl {isHuman
                  ? 'ring-1 ring-primary/40'
                  : ''}"
              >
                <a
                  href={resolve(`/season/run/teams/?franchiseId=${team.franchiseId}` as RouteId)}
                  data-season-team-stats-link={team.franchiseId}
                  aria-label={`${shell.franchiseName(team.franchiseId)} roster`}
                  class="block outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div class="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2">
                    {#if identity}
                      <SeasonTeamLogo
                        {manifest}
                        franchiseId={identity.franchiseId}
                        teamExternalId={identity.teamExternalId}
                        alt=""
                        size="sm"
                      />
                    {:else}
                      <span class="h-7 w-7 shrink-0" aria-hidden="true"></span>
                    {/if}
                    <span class="min-w-0 truncate font-semibold">
                      {shell.franchiseName(team.franchiseId)}
                      {#if isHuman}<span class="text-primary" aria-label="your team">*</span>{/if}
                    </span>
                    <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {team.gamesPlayed} GP
                    </span>
                    <span class="shrink-0 font-mono text-[10px] font-bold">
                      {team.diff > 0 ? '+' : ''}{team.diff}
                    </span>
                  </div>
                  <dl class="mt-2 grid grid-cols-3 gap-x-4 gap-y-1">
                    {#each statCells as cell (cell.key)}
                      <div class="flex items-center justify-between gap-2">
                        <dt class="font-mono text-[10px] text-muted-foreground">{cell.label}</dt>
                        <dd class="font-mono text-[10px] font-bold">
                          {oneDecimal(team[cell.key])}
                        </dd>
                      </div>
                    {/each}
                  </dl>
                </a>
              </li>
            {/each}
          </ul>
        {/if}

        {#if desktopViewport !== false}
          <div class="mt-6 hidden overflow-x-auto rounded-xl bg-surface-1 md:block">
            <table class="w-full min-w-[42rem] text-sm">
              <caption class="sr-only"> League team statistics — all 30 teams </caption>
              <thead>
                <tr
                  class="border-b border-border/70 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                >
                  <th scope="col" class="px-4 py-2 text-left font-medium">Team</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">GP</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">PPG</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">RPG</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">APG</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">SPG</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">BPG</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">TOPG</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">Diff</th>
                </tr>
              </thead>
              <tbody>
                {#each teamStats as team (team.franchiseId)}
                  {@const isHuman = team.franchiseId === humanFranchiseId}
                  {@const identity = identityOf(team.franchiseId)}
                  <tr
                    data-season-team-stats-row
                    class="border-b border-border/40 transition-colors hover:bg-surface-2/60 {isHuman
                      ? 'bg-primary/10'
                      : ''}"
                    aria-label={isHuman
                      ? `${shell.franchiseName(team.franchiseId)} (your team)`
                      : undefined}
                  >
                    <th scope="row" class="max-w-48 truncate px-4 py-2 text-left font-semibold">
                      <a
                        href={resolve(
                          `/season/run/teams/?franchiseId=${team.franchiseId}` as RouteId,
                        )}
                        data-season-team-stats-link={team.franchiseId}
                        aria-label={`${shell.franchiseName(team.franchiseId)} roster`}
                        class="flex items-center gap-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:text-primary"
                      >
                        {#if identity}
                          <SeasonTeamLogo
                            {manifest}
                            franchiseId={identity.franchiseId}
                            teamExternalId={identity.teamExternalId}
                            alt=""
                            size="sm"
                          />
                        {/if}
                        <span class="min-w-0 truncate">
                          {shell.franchiseName(team.franchiseId)}
                          {#if isHuman}<span class="text-primary" aria-label="your team">*</span
                            >{/if}
                        </span>
                      </a>
                    </th>
                    <td class="px-4 py-2 text-right font-mono text-[10px]">{team.gamesPlayed}</td>
                    <td class="px-4 py-2 text-right font-mono text-[10px]"
                      >{oneDecimal(team.ppg)}</td
                    >
                    <td class="px-4 py-2 text-right font-mono text-[10px]"
                      >{oneDecimal(team.rpg)}</td
                    >
                    <td class="px-4 py-2 text-right font-mono text-[10px]"
                      >{oneDecimal(team.apg)}</td
                    >
                    <td class="px-4 py-2 text-right font-mono text-[10px]"
                      >{oneDecimal(team.spg)}</td
                    >
                    <td class="px-4 py-2 text-right font-mono text-[10px]"
                      >{oneDecimal(team.bpg)}</td
                    >
                    <td class="px-4 py-2 text-right font-mono text-[10px]"
                      >{oneDecimal(team.topg)}</td
                    >
                    <td class="px-4 py-2 text-right font-mono text-[10px] font-bold">
                      {team.diff > 0 ? '+' : ''}{team.diff}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
        <p class="mt-2 font-mono text-[10px] text-muted-foreground">
          Folded from accepted game summaries; rates are per team game played. Diff is total point
          differential (all games, no tiebreak).
        </p>
      {/if}
    {/if}
  </section>
{/if}
