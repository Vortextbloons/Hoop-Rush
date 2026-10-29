<script lang="ts">
  import {
    CAP_RUSH_PLAYOFF_TEAMS,
    CAP_RUSH_USER_TEAM_ID,
    type CapRushPostseasonStandings,
    type HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import { franchiseIdentityOf } from '#lib/branding.js';

  let {
    standings,
    manifest = null,
    highlightSeed = null,
  }: {
    standings: CapRushPostseasonStandings;
    manifest?: HoopRushManifest | null;
    highlightSeed?: number | null;
  } = $props();

  const userEntry = $derived(
    standings.entries.find((entry) => entry.teamId === CAP_RUSH_USER_TEAM_ID) ?? null,
  );

  function identityOf(teamId: string) {
    if (manifest === null) return null;
    return franchiseIdentityOf(manifest, teamId);
  }

  function tieBreakLabel(): string {
    switch (standings.cutoff.tieBreak) {
      case 'wins':
        return 'wins';
      case 'point-differential':
        return 'point differential';
      case 'points-for':
        return 'points scored';
      case 'team-id':
        return 'stable team id';
    }
  }
</script>

<section
  class="rounded-2xl border border-border bg-card p-4 sm:p-6"
  aria-label="Final league standings"
>
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
        League standings
      </p>
      <h2 class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase">
        82 games decide the field.
      </h2>
    </div>
    {#if userEntry}
      <p
        class="rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] font-bold text-primary uppercase"
      >
        Your seed · {userEntry.seed}
      </p>
    {/if}
  </div>

  <p class="mt-2 text-xs text-muted-foreground">
    Seeds 1–{CAP_RUSH_PLAYOFF_TEAMS} qualify. Ties break on wins, then point differential, then points
    scored. This cutoff was decided by {tieBreakLabel()}.
  </p>

  <div class="mt-4 max-h-[28rem] overflow-y-auto rounded-xl border border-line-soft">
    <table class="w-full border-collapse text-left">
      <thead class="sticky top-0 z-10 bg-surface-2">
        <tr class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
          <th scope="col" class="px-2 py-2 text-center font-bold">Seed</th>
          <th scope="col" class="px-2 py-2 font-bold">Team</th>
          <th scope="col" class="px-2 py-2 text-right font-bold">W</th>
          <th scope="col" class="px-2 py-2 text-right font-bold">L</th>
          <th scope="col" class="hidden px-2 py-2 text-right font-bold sm:table-cell">Diff</th>
          <th scope="col" class="hidden px-2 py-2 text-right font-bold sm:table-cell">PF</th>
        </tr>
      </thead>
      <tbody>
        {#each standings.entries as entry (entry.teamId)}
          {#if entry.seed === CAP_RUSH_PLAYOFF_TEAMS + 1}
            <tr aria-hidden="true">
              <td colspan="6" class="border-y border-line-strong bg-surface-2 px-2 py-1">
                <span
                  class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
                >
                  Qualification cutoff
                </span>
              </td>
            </tr>
          {/if}
          <tr
            class="border-b border-line-soft/60 last:border-0 {entry.teamId ===
            CAP_RUSH_USER_TEAM_ID
              ? 'bg-primary/10'
              : ''} {highlightSeed === entry.seed ? 'ring-1 ring-inset ring-primary/40' : ''}"
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
                <span
                  class="min-w-0 truncate text-[11px] {entry.teamId === CAP_RUSH_USER_TEAM_ID
                    ? 'font-bold text-foreground'
                    : entry.qualified
                      ? 'text-foreground'
                      : 'text-muted-foreground'}"
                  title={entry.displayName}>{entry.displayName}</span
                >
                {#if entry.teamId === CAP_RUSH_USER_TEAM_ID}
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
            <td
              class="hidden px-2 py-1.5 text-right font-mono text-[10px] tabular-nums text-muted-foreground sm:table-cell"
              >{entry.pointsFor}</td
            >
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <p class="mt-3 text-[11px] text-muted-foreground">
    Cutoff: seed {standings.cutoff.seed} finished {standings.cutoff.wins}–
    {standings.cutoff.losses} with a {standings.cutoff.pointDifferential > 0 ? '+' : ''}{standings
      .cutoff.pointDifferential} differential.
  </p>
</section>
