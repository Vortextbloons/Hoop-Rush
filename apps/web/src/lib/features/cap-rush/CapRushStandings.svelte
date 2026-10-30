<script lang="ts">
  import {
    CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS,
    CAP_RUSH_CONFERENCE_NAMES,
    CAP_RUSH_PLAYOFF_TEAMS,
    capRushConferenceStandingsEntries,
    isConferenceStandings,
    type CapRushConferenceStandings,
    type CapRushPostseasonStandings,
    type HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import { franchiseIdentityOf } from '#lib/branding.js';

  let {
    standings,
    manifest = null,
    userTeamId = null,
    onTeamSelect,
    highlightSeed = null,
  }: {
    standings: CapRushPostseasonStandings | CapRushConferenceStandings;
    manifest?: HoopRushManifest | null;
    userTeamId?: string | null;
    onTeamSelect?: (teamId: string) => void;
    highlightSeed?: number | null;
  } = $props();

  const conference = $derived(isConferenceStandings(standings));
  const conferenceStandings = $derived(
    conference ? (standings as CapRushConferenceStandings) : null,
  );
  const entries = $derived(
    conferenceStandings === null
      ? (standings as CapRushPostseasonStandings).entries
      : capRushConferenceStandingsEntries(conferenceStandings),
  );
  const userEntry = $derived(
    userTeamId === null ? null : (entries.find((entry) => entry.teamId === userTeamId) ?? null),
  );
  const userConference = $derived(
    userEntry !== null && 'conference' in userEntry
      ? (userEntry as { conference: 'east' | 'west' }).conference
      : null,
  );

  function identityOf(teamId: string) {
    if (manifest === null) return null;
    return franchiseIdentityOf(manifest, teamId);
  }

  function tieBreakLabel(value: string): string {
    switch (value) {
      case 'wins':
        return 'wins';
      case 'head-to-head':
        return 'head-to-head record';
      case 'conference':
        return 'conference record';
      case 'point-differential':
        return 'point differential';
      case 'points-for':
        return 'points scored';
      case 'team-id':
        return 'stable team id';
      default:
        return 'wins';
    }
  }

  const tables = $derived(
    conferenceStandings === null
      ? [{ conference: null, entries, cutoff: null }]
      : [
          {
            conference: 'west' as const,
            entries: conferenceStandings.west.entries,
            cutoff: conferenceStandings.west.cutoff,
          },
          {
            conference: 'east' as const,
            entries: conferenceStandings.east.entries,
            cutoff: conferenceStandings.east.cutoff,
          },
        ],
  );
</script>

<section
  class="rounded-2xl border border-border bg-card p-4 sm:p-6"
  aria-label="Final league standings"
>
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
        {conference ? 'Conference standings' : 'League standings'}
      </p>
      <h2 class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase">
        {conference ? 'Eight per conference.' : '82 games decide the field.'}
      </h2>
    </div>
    {#if userEntry}
      <p
        class="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] font-bold text-primary uppercase"
      >
        {conference && userConference !== null
          ? `${CAP_RUSH_CONFERENCE_NAMES[userConference]} · Seed ${userEntry.seed}`
          : `Your seed · ${userEntry.seed}`}
      </p>
    {/if}
  </div>

  <p class="mt-2 text-xs text-muted-foreground">
    {#if conference}
      Seeds 1–{CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS} in each conference qualify. Ties break on wins, then
      head-to-head record among tied teams, then conference record, point differential, points scored
      and stable team id.
    {:else}
      Seeds 1–{CAP_RUSH_PLAYOFF_TEAMS} qualify. Ties break on wins, then point differential, then points
      scored.
    {/if}
  </p>

  <div class={conference ? 'mt-4 grid gap-4 lg:grid-cols-2' : 'mt-4'}>
    {#each tables as table (table.conference ?? 'overall')}
      <div class="min-w-0">
        {#if table.conference !== null}
          <p
            class="mb-2 font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
          >
            {CAP_RUSH_CONFERENCE_NAMES[table.conference]}
          </p>
        {/if}
        <div class="max-h-[24rem] overflow-y-auto rounded-xl border border-line-soft">
          <table class="w-full border-collapse text-left">
            <thead class="sticky top-0 z-10 bg-surface-2">
              <tr class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
                <th scope="col" class="px-2 py-2 text-center font-bold">Seed</th>
                <th scope="col" class="px-2 py-2 font-bold">Team</th>
                <th scope="col" class="px-2 py-2 text-right font-bold">W</th>
                <th scope="col" class="px-2 py-2 text-right font-bold">L</th>
                <th scope="col" class="hidden px-2 py-2 text-right font-bold sm:table-cell">Diff</th
                >
              </tr>
            </thead>
            <tbody>
              {#each table.entries as entry (entry.teamId)}
                {#if entry.seed === CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS + 1}
                  <tr aria-hidden="true">
                    <td colspan="5" class="border-y border-line-strong bg-surface-2 px-2 py-1">
                      <span
                        class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
                      >
                        Qualification cutoff
                      </span>
                    </td>
                  </tr>
                {/if}
                <tr
                  class="border-b border-line-soft/60 last:border-0 {entry.teamId === userTeamId
                    ? 'bg-primary/10'
                    : ''} {highlightSeed === entry.seed && table.conference === null
                    ? 'ring-1 ring-inset ring-primary/40'
                    : ''}"
                >
                  <td
                    class="px-2 py-1.5 text-center font-mono text-[10px] tabular-nums {entry.qualified
                      ? 'text-foreground'
                      : 'text-muted-foreground'}">{entry.seed}</td
                  >
                  <td class="w-full max-w-0 px-2 py-1.5">
                    <span class="flex min-w-0 items-center gap-1.5">
                      {#if identityOf(entry.teamId) && manifest}
                        {@const identity = identityOf(entry.teamId)}
                        <TeamLogo
                          {manifest}
                          franchiseId={identity?.franchiseId ?? entry.teamId}
                          teamExternalId={identity?.teamExternalId ?? ''}
                          alt=""
                          className="h-4 w-4"
                        />
                      {/if}
                      {#if onTeamSelect}
                        <button
                          type="button"
                          class="min-w-0 truncate text-[11px] outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring {entry.teamId ===
                          userTeamId
                            ? 'font-bold text-foreground'
                            : entry.qualified
                              ? 'text-foreground'
                              : 'text-muted-foreground'}"
                          title={entry.displayName}
                          onclick={() => onTeamSelect(entry.teamId)}
                        >
                          {entry.displayName}
                        </button>
                      {:else}
                        <span
                          class="min-w-0 truncate text-[11px] {entry.teamId === userTeamId
                            ? 'font-bold text-foreground'
                            : entry.qualified
                              ? 'text-foreground'
                              : 'text-muted-foreground'}"
                          title={entry.displayName}>{entry.displayName}</span
                        >
                      {/if}
                      {#if entry.teamId === userTeamId}
                        <span class="shrink-0 font-mono text-[8px] font-bold text-primary uppercase"
                          >You</span
                        >
                      {/if}
                    </span>
                  </td>
                  <td class="px-2 py-1.5 text-right font-mono text-[10px] font-bold tabular-nums"
                    >{entry.wins}</td
                  >
                  <td
                    class="px-2 py-1.5 text-right font-mono text-[10px] tabular-nums text-muted-foreground"
                    >{entry.losses}</td
                  >
                  <td
                    class="hidden px-2 py-1.5 text-right font-mono text-[10px] tabular-nums sm:table-cell {entry.pointDifferential >
                    0
                      ? 'text-positive'
                      : 'text-muted-foreground'}"
                    >{entry.pointDifferential > 0 ? '+' : ''}{entry.pointDifferential}</td
                  >
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if table.cutoff !== null}
          <p class="mt-2 text-[11px] text-muted-foreground">
            Cutoff: seed {table.cutoff.seed} finished {table.cutoff.wins}–{table.cutoff.losses} with a
            {table.cutoff.pointDifferential > 0 ? '+' : ''}{table.cutoff.pointDifferential}
            differential. Decided by {tieBreakLabel(table.cutoff.tieBreak)}.
          </p>
        {:else if !conference}
          <p class="mt-3 text-[11px] text-muted-foreground">
            Cutoff: seed {(standings as CapRushPostseasonStandings).cutoff.seed} finished
            {(standings as CapRushPostseasonStandings).cutoff.wins}–{(
              standings as CapRushPostseasonStandings
            ).cutoff.losses} with a {(standings as CapRushPostseasonStandings).cutoff
              .pointDifferential > 0
              ? '+'
              : ''}{(standings as CapRushPostseasonStandings).cutoff.pointDifferential} differential.
          </p>
        {/if}
      </div>
    {/each}
  </div>
</section>
