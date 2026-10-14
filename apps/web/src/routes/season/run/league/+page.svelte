<script lang="ts">
  import { getContext } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import type { SeasonGameSummary, SeasonTeamAggregate } from '@hoop-rush/data-contracts';
  import StandingsTable from '#lib/components/season/StandingsTable.svelte';
  import SeasonTeamLogo from '#lib/components/season/SeasonTeamLogo.svelte';
  import TiebreakExplanations from '#lib/components/season/TiebreakExplanations.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '#lib/season/season-shell-context.js';
  import {
    foldSeasonAggregates,
    franchiseStreaks,
    pointDifferential,
  } from '#lib/season/season-presentation.js';
  import {
    postseasonRankingsOf,
    rankedEntriesOf,
  } from '#lib/season/season-postseason-presentation.js';
  import { franchiseIdentityOf } from '#lib/season/season-branding.js';
  import { oneDecimal } from '#lib/format.js';
  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);
  const foldWeak = new WeakMap<
    readonly SeasonGameSummary[],
    ReturnType<typeof foldSeasonAggregates>
  >();
  const foldByDigest = new Map<string, ReturnType<typeof foldSeasonAggregates>>();
  function summariesDigest(summaries: readonly SeasonGameSummary[]): string {
    let hash = 2166136261;
    for (const summary of summaries) {
      const id = summary.gameId;
      for (let i = 0; i < id.length; i += 1) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
      hash = Math.imul(hash ^ summary.homeScore, 16777619);
      hash = Math.imul(hash ^ summary.awayScore, 16777619);
    }
    return `${String(summaries.length)}:${String(hash >>> 0)}`;
  }
  function memoizedFold(
    summaries: readonly SeasonGameSummary[],
  ): ReturnType<typeof foldSeasonAggregates> {
    const weakHit = foldWeak.get(summaries);
    if (weakHit !== undefined) return weakHit;
    const digest = summariesDigest(summaries);
    const digestHit = foldByDigest.get(digest);
    if (digestHit !== undefined) {
      foldWeak.set(summaries, digestHit);
      return digestHit;
    }
    const folded = foldSeasonAggregates(summaries);
    foldWeak.set(summaries, folded);
    foldByDigest.set(digest, folded);
    if (foldByDigest.size > 4) {
      const oldest = foldByDigest.keys().next().value;
      if (oldest !== undefined) foldByDigest.delete(oldest);
    }
    return folded;
  }
  const streaksWeak = new WeakMap<
    readonly SeasonGameSummary[],
    Map<string, { kind: 'wins' | 'losses'; length: number } | null>
  >();
  const streaksByDigest = new Map<
    string,
    Map<string, { kind: 'wins' | 'losses'; length: number } | null>
  >();
  function memoizedStreaks(
    summaries: readonly SeasonGameSummary[],
    franchiseIds: readonly string[],
  ): Map<string, { kind: 'wins' | 'losses'; length: number } | null> {
    const weakHit = streaksWeak.get(summaries);
    if (weakHit !== undefined && weakHit.size === franchiseIds.length) return weakHit;
    const digest = `${summariesDigest(summaries)}:${franchiseIds.join(',')}`;
    const digestHit = streaksByDigest.get(digest);
    if (digestHit !== undefined) {
      streaksWeak.set(summaries, digestHit);
      return digestHit;
    }
    const computed = franchiseStreaks(summaries, franchiseIds);
    streaksWeak.set(summaries, computed);
    streaksByDigest.set(digest, computed);
    if (streaksByDigest.size > 4) {
      const oldest = streaksByDigest.keys().next().value;
      if (oldest !== undefined) streaksByDigest.delete(oldest);
    }
    return computed;
  }
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
      memoizedStreaks(
        summaries,
        rows.map((row) => row.franchiseId),
      ),
    );
  });
  const streakOf = (
    franchiseId: string,
  ): {
    kind: 'wins' | 'losses';
    length: number;
  } | null => streaksByFranchise.get(franchiseId) ?? null;
  const aggregates = $derived(shell.snapshot ? memoizedFold(shell.snapshot.summaries) : null);
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
</script>

<svelte:head>
  <title>Season Run — league — Hoop Rush</title>
</svelte:head>

{#if !shell.ready || !shell.snapshot || !run || !humanFranchiseId || !manifest}
  <p class="py-10 font-mono text-sm text-muted-foreground">Preparing the league…</p>
{:else}
  <section aria-labelledby="league-heading" class="min-w-0 pt-6">
    <div class="sr-arrive flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <p class="sr-eyebrow">Season Run</p>
        <h1 id="league-heading" class="sr-page-title mt-1">League</h1>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
          <span class="sr-number"
            >{shell.snapshot.acceptedBlocks.length * 10 > 82
              ? 82
              : shell.snapshot.acceptedBlocks.length * 10}</span
          >
          games played
        </p>
      </div>
      <div class="flex shrink-0 flex-col items-start gap-2 sm:items-end">
        <div
          role="group"
          aria-label="League view"
          class="flex gap-1 rounded-full border border-border bg-surface-2 p-1"
        >
          <button
            type="button"
            aria-pressed={view === 'standings'}
            onclick={() => {
              view = 'standings';
            }}
            class="min-h-11 rounded-full px-4 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-colors {view ===
            'standings'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'} motion-reduce:transition-none"
          >
            Standings
          </button>
          <button
            type="button"
            aria-pressed={view === 'stats'}
            onclick={() => {
              view = 'stats';
            }}
            class="min-h-11 rounded-full px-4 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-colors {view ===
            'stats'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'} motion-reduce:transition-none"
          >
            Team stats
          </button>
        </div>
        {#if view === 'standings'}
          <div
            role="group"
            aria-label="Conference"
            class="flex gap-1 rounded-full border border-border bg-surface-2 p-1"
          >
            <button
              type="button"
              aria-pressed={conference === 'east'}
              onclick={() => {
                conference = 'east';
              }}
              class="min-h-11 rounded-full px-4 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-colors {conference ===
              'east'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'} motion-reduce:transition-none"
            >
              East
            </button>
            <button
              type="button"
              aria-pressed={conference === 'west'}
              onclick={() => {
                conference = 'west';
              }}
              class="min-h-11 rounded-full px-4 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-colors {conference ===
              'west'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'} motion-reduce:transition-none"
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
        <p class="sr-panel-quiet mt-8 p-6 text-sm text-muted-foreground">
          Play a block to see team stats.
        </p>
      {:else}
        <p class="sr-section-label mt-6">Team stats</p>
        <ul class="mt-2 flex flex-col gap-2 md:hidden">
          {#each teamStats as team (team.franchiseId)}
            {@const isHuman = team.franchiseId === humanFranchiseId}
            {@const identity = identityOf(team.franchiseId)}
            <li
              data-season-team-stats-row
              aria-label={isHuman
                ? `${shell.franchiseName(team.franchiseId)} (your team)`
                : undefined}
              class="sr-gamecard {isHuman ? 'ring-1 ring-primary/40' : ''}"
              style={isHuman ? '--sr-accent: var(--sr-hardwood)' : undefined}
            >
              <a
                href={resolve(`/season/run/teams?franchiseId=${team.franchiseId}` as any)}
                data-season-team-stats-link={team.franchiseId}
                aria-label={`${shell.franchiseName(team.franchiseId)} roster`}
                class="block outline-none"
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
                  <span class="sr-number shrink-0 font-mono text-[10px] font-bold">
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

        <div class="sr-panel-quiet mt-2 hidden overflow-x-auto md:block">
          <table class="sr-table min-w-[42rem]">
            <caption class="sr-only"> League team statistics — all 30 teams </caption>
            <thead>
              <tr>
                <th scope="col" class="text-left">Team</th>
                <th scope="col" class="text-right!">GP</th>
                <th scope="col" class="text-right!">PPG</th>
                <th scope="col" class="text-right!">RPG</th>
                <th scope="col" class="text-right!">APG</th>
                <th scope="col" class="text-right!">SPG</th>
                <th scope="col" class="text-right!">BPG</th>
                <th scope="col" class="text-right!">TOPG</th>
                <th scope="col" class="text-right!">Diff</th>
              </tr>
            </thead>
            <tbody>
              {#each teamStats as team (team.franchiseId)}
                {@const isHuman = team.franchiseId === humanFranchiseId}
                {@const identity = identityOf(team.franchiseId)}
                <tr
                  data-season-team-stats-row
                  class={isHuman ? 'bg-primary/10' : ''}
                  aria-label={isHuman
                    ? `${shell.franchiseName(team.franchiseId)} (your team)`
                    : undefined}
                >
                  <th
                    scope="row"
                    class="max-w-48 truncate px-4 py-2 text-left font-semibold {isHuman
                      ? '[box-shadow:inset_3px_0_0_var(--sr-hardwood)]'
                      : ''}"
                  >
                    <a
                      href={resolve(`/season/run/teams?franchiseId=${team.franchiseId}` as any)}
                      data-season-team-stats-link={team.franchiseId}
                      aria-label={`${shell.franchiseName(team.franchiseId)} roster`}
                      class="flex items-center gap-2 transition-colors hover:text-primary motion-reduce:transition-none"
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
                        {#if isHuman}<span class="text-primary" aria-label="your team">*</span>{/if}
                      </span>
                    </a>
                  </th>
                  <td class="px-4 py-2 text-right font-mono text-muted-foreground">
                    {team.gamesPlayed}
                  </td>
                  <td class="px-4 py-2 text-right font-mono">{oneDecimal(team.ppg)}</td>
                  <td class="px-4 py-2 text-right font-mono">{oneDecimal(team.rpg)}</td>
                  <td class="px-4 py-2 text-right font-mono">{oneDecimal(team.apg)}</td>
                  <td class="px-4 py-2 text-right font-mono">{oneDecimal(team.spg)}</td>
                  <td class="px-4 py-2 text-right font-mono">{oneDecimal(team.bpg)}</td>
                  <td class="px-4 py-2 text-right font-mono">{oneDecimal(team.topg)}</td>
                  <td class="px-4 py-2 text-right font-mono font-bold">
                    {team.diff > 0 ? '+' : ''}{team.diff}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
  </section>
{/if}
