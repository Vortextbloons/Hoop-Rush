<script lang="ts">
  import {
    CAP_RUSH_PLAYOFF_ROUND_NAMES,
    CAP_RUSH_USER_TEAM_ID,
    type CapRushPlayoffSeries,
    type CapRushPostseasonStandings,
    type HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import { franchiseIdentityOf } from '#lib/branding.js';

  let {
    series,
    standings,
    manifest = null,
  }: {
    series: readonly CapRushPlayoffSeries[];
    standings: CapRushPostseasonStandings;
    manifest?: HoopRushManifest | null;
  } = $props();

  const entries = $derived(new Map(standings.entries.map((entry) => [entry.teamId, entry])));
  const latestRound = $derived(
    series.length === 0 ? 1 : Math.max(...series.map((entry) => entry.round)),
  );
  let selectedRound = $state<number | null>(null);
  const activeRound = $derived(selectedRound ?? latestRound);

  function winsOf(entry: CapRushPlayoffSeries, teamId: string): number {
    return entry.games.filter((game) => game.winnerTeamId === teamId).length;
  }

  function winnerOf(entry: CapRushPlayoffSeries): string | null {
    if (winsOf(entry, entry.highTeamId) >= 4) return entry.highTeamId;
    if (winsOf(entry, entry.lowTeamId) >= 4) return entry.lowTeamId;
    return null;
  }

  function nameOf(teamId: string): string {
    return entries.get(teamId)?.displayName ?? teamId;
  }

  function seedOf(teamId: string): number {
    return entries.get(teamId)?.seed ?? 0;
  }

  function identityOf(teamId: string) {
    if (manifest === null) return null;
    return franchiseIdentityOf(manifest, teamId);
  }

  function roundSeries(round: number): CapRushPlayoffSeries[] {
    return series
      .filter((entry) => entry.round === round)
      .sort((left, right) => left.seriesSlot - right.seriesSlot);
  }

  const shown = $derived(roundSeries(activeRound));
</script>

<section class="rounded-2xl border border-border bg-card p-4 sm:p-6" aria-label="Playoff bracket">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
        The bracket
      </p>
      <h2 class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase">
        Sixteen teams. Four rounds.
      </h2>
    </div>
    <div class="flex flex-wrap gap-1.5 lg:hidden" role="group" aria-label="Choose a playoff round">
      {#each CAP_RUSH_PLAYOFF_ROUND_NAMES as name, index (name)}
        <button
          type="button"
          class="min-h-9 rounded-lg border px-2.5 text-[10px] font-bold uppercase outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring {activeRound ===
          index + 1
            ? 'border-primary bg-primary/15 text-primary'
            : 'border-line-soft text-muted-foreground hover:text-foreground'}"
          aria-pressed={activeRound === index + 1}
          onclick={() => (selectedRound = index + 1)}
        >
          {name}
        </button>
      {/each}
    </div>
  </div>

  <div class="mt-4 hidden gap-3 lg:grid lg:grid-cols-4">
    {#each CAP_RUSH_PLAYOFF_ROUND_NAMES as name, index (name)}
      {@const round = index + 1}
      <div class="flex min-w-0 flex-col gap-2">
        <p
          class="font-mono text-[10px] font-bold tracking-[0.12em] uppercase {round === latestRound
            ? 'text-primary'
            : 'text-muted-foreground'}"
        >
          {name}
        </p>
        <div class="flex flex-1 flex-col justify-around gap-2">
          {#each roundSeries(round) as matchup (matchup.seriesId)}
            {@const winner = winnerOf(matchup)}
            {@const hasUser =
              matchup.highTeamId === CAP_RUSH_USER_TEAM_ID ||
              matchup.lowTeamId === CAP_RUSH_USER_TEAM_ID}
            <div
              class="rounded-xl border bg-surface-1 p-2.5 {hasUser
                ? 'border-primary/50'
                : 'border-line-soft'}"
            >
              {#each [matchup.highTeamId, matchup.lowTeamId] as teamId (teamId)}
                {@const identity = identityOf(teamId)}
                <div
                  class="flex min-w-0 items-center gap-1.5 py-0.5 {winner === teamId
                    ? 'text-foreground'
                    : 'text-muted-foreground'}"
                >
                  <span class="w-4 shrink-0 text-center font-mono text-[9px] tabular-nums"
                    >{seedOf(teamId)}</span
                  >
                  {#if identity && manifest}
                    <TeamLogo
                      {manifest}
                      franchiseId={identity.franchiseId}
                      teamExternalId={identity.teamExternalId}
                      alt=""
                      className="h-4 w-4"
                    />
                  {:else}
                    <span class="h-4 w-4 shrink-0 rounded-sm bg-surface-3" aria-hidden="true"
                    ></span>
                  {/if}
                  <span
                    class="min-w-0 flex-1 truncate text-[11px] {winner === teamId
                      ? 'font-bold'
                      : ''}"
                    title={nameOf(teamId)}>{nameOf(teamId)}</span
                  >
                  <span class="w-4 shrink-0 text-right font-mono text-[10px] font-bold tabular-nums"
                    >{winsOf(matchup, teamId)}</span
                  >
                </div>
              {/each}
            </div>
          {/each}
          {#if roundSeries(round).length === 0}
            <div
              class="rounded-xl border border-dashed border-line-soft p-3 text-[10px] text-muted-foreground"
            >
              Awaiting the previous round.
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <div class="mt-4 flex flex-col gap-2 lg:hidden">
    <p class="font-mono text-[10px] font-bold tracking-[0.12em] text-primary uppercase">
      {CAP_RUSH_PLAYOFF_ROUND_NAMES[activeRound - 1]}
    </p>
    {#each shown as matchup (matchup.seriesId)}
      {@const winner = winnerOf(matchup)}
      {@const hasUser =
        matchup.highTeamId === CAP_RUSH_USER_TEAM_ID || matchup.lowTeamId === CAP_RUSH_USER_TEAM_ID}
      <div
        class="rounded-xl border bg-surface-1 p-3 {hasUser
          ? 'border-primary/50'
          : 'border-line-soft'}"
      >
        {#each [matchup.highTeamId, matchup.lowTeamId] as teamId (teamId)}
          {@const identity = identityOf(teamId)}
          <div
            class="flex min-w-0 items-center gap-2 py-1 {winner === teamId
              ? 'text-foreground'
              : 'text-muted-foreground'}"
          >
            <span class="w-5 shrink-0 text-center font-mono text-[10px] tabular-nums"
              >{seedOf(teamId)}</span
            >
            {#if identity && manifest}
              <TeamLogo
                {manifest}
                franchiseId={identity.franchiseId}
                teamExternalId={identity.teamExternalId}
                alt=""
                className="h-5 w-5"
              />
            {:else}
              <span class="h-5 w-5 shrink-0 rounded-sm bg-surface-3" aria-hidden="true"></span>
            {/if}
            <span class="min-w-0 flex-1 truncate text-xs {winner === teamId ? 'font-bold' : ''}"
              >{nameOf(teamId)}</span
            >
            <span class="shrink-0 font-mono text-xs font-bold tabular-nums"
              >{winsOf(matchup, teamId)}</span
            >
          </div>
        {/each}
      </div>
    {/each}
    {#if shown.length === 0}
      <p class="rounded-xl border border-dashed border-line-soft p-3 text-xs text-muted-foreground">
        Awaiting the previous round.
      </p>
    {/if}
  </div>
</section>
