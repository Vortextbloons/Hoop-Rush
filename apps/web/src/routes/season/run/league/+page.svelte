<script lang="ts">
  import { getContext } from 'svelte';
  import type { SeasonTeamAggregate } from '@hoop-rush/data-contracts';
  import StandingsTable from '$lib/components/season/StandingsTable.svelte';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import {
    foldSeasonAggregates,
    franchiseStreak,
    pointDifferential,
  } from '$lib/season/season-presentation';
  import { franchiseIdentityOf } from '$lib/season/season-branding';

  /**
   * League tab (spec/2.0/11, M2.3.5): conference-switched provisional
   * standings and a league-wide team-stats table, both derived from the
   * snapshot (standings rows + the aggregate fold of accepted summaries).
   * The human franchise is highlighted without implying the ordering is the
   * M2.6 postseason tiebreak. Standings ordering is wins, point
   * differential, franchise id — provisional only.
   */

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

  const streakOf = (franchiseId: string): { kind: 'wins' | 'losses'; length: number } | null => {
    const summaries = shell.snapshot?.summaries ?? [];
    if (summaries.length === 0) return null;
    return franchiseStreak(summaries, franchiseId);
  };

  const aggregates = $derived(
    shell.snapshot ? foldSeasonAggregates(shell.snapshot.summaries) : null,
  );

  const teamStats = $derived.by(() => {
    if (!aggregates || !standings) return [];
    const byId = new Map(standings.rows.map((row) => [row.franchiseId, row]));
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
  <section aria-labelledby="league-heading" class="pt-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
          Season Run · league
        </p>
        <h1
          id="league-heading"
          class="font-display mt-1 text-3xl font-extrabold tracking-tight uppercase"
        >
          League
        </h1>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
          {shell.snapshot.acceptedBlocks.length * 10 > 82
            ? 82
            : shell.snapshot.acceptedBlocks.length * 10}{' '}
          team games accepted{shell.seasonComplete ? ' (final)' : ''}
        </p>
      </div>
      <div class="flex flex-col items-end gap-2">
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
        />
      </div>
    {:else}
      {#if teamStats.length === 0}
        <p class="mt-8 rounded-xl bg-surface-1 p-6 text-sm text-muted-foreground">
          No team stats yet — accept a block to fold game summaries.
        </p>
      {:else}
        <!-- Mobile: per-team stat cards -->
        <ul class="mt-6 flex flex-col gap-2 md:hidden">
          {#each teamStats as team (team.franchiseId)}
            {@const isHuman = team.franchiseId === humanFranchiseId}
            {@const identity = identityOf(team.franchiseId)}
            <li
              data-season-team-stats-row
              aria-label={isHuman
                ? `${shell.franchiseName(team.franchiseId)} (your team)`
                : undefined}
              class="rounded-xl bg-surface-1 px-4 py-3 {isHuman ? 'ring-1 ring-primary/40' : ''}"
            >
              <div class="flex items-center gap-3">
                {#if identity}
                  <SeasonTeamLogo
                    {manifest}
                    franchiseId={identity.franchiseId}
                    teamExternalId={identity.teamExternalId}
                    alt=""
                    size="sm"
                  />
                {/if}
                <span class="min-w-0 flex-1 truncate font-semibold">
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
                      {team[cell.key].toFixed(1)}
                    </dd>
                  </div>
                {/each}
              </dl>
            </li>
          {/each}
        </ul>

        <!-- Desktop: complete team stats table -->
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
                  class="border-b border-border/40 {isHuman ? 'bg-primary/10' : ''}"
                  aria-label={isHuman
                    ? `${shell.franchiseName(team.franchiseId)} (your team)`
                    : undefined}
                >
                  <th scope="row" class="max-w-48 truncate px-4 py-2 text-left font-semibold">
                    <span class="flex items-center gap-2">
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
                    </span>
                  </th>
                  <td class="px-4 py-2 text-right font-mono text-[10px]">{team.gamesPlayed}</td>
                  <td class="px-4 py-2 text-right font-mono text-[10px]">{team.ppg.toFixed(1)}</td>
                  <td class="px-4 py-2 text-right font-mono text-[10px]">{team.rpg.toFixed(1)}</td>
                  <td class="px-4 py-2 text-right font-mono text-[10px]">{team.apg.toFixed(1)}</td>
                  <td class="px-4 py-2 text-right font-mono text-[10px]">{team.spg.toFixed(1)}</td>
                  <td class="px-4 py-2 text-right font-mono text-[10px]">{team.bpg.toFixed(1)}</td>
                  <td class="px-4 py-2 text-right font-mono text-[10px]">{team.topg.toFixed(1)}</td>
                  <td class="px-4 py-2 text-right font-mono text-[10px] font-bold">
                    {team.diff > 0 ? '+' : ''}{team.diff}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="mt-2 font-mono text-[10px] text-muted-foreground">
          Folded from accepted game summaries; rates are per team game played. Diff is total point
          differential (all games, no tiebreak).
        </p>
      {/if}
    {/if}
  </section>
{/if}
