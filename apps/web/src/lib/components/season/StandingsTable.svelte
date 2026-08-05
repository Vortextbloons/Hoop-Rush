<script lang="ts">
  import type { SeasonStandings } from '@hoop-rush/data-contracts';
  import type { SeasonLeague } from '@hoop-rush/data-contracts';
  import {
    ordinal,
    pointDifferential,
    provisionalRanking,
    streakLabel,
    winPct,
  } from '$lib/season/season-presentation';

  /**
   * Season Run standings table (spec/2.0/02 standings, M2.3 hub). Shows the
   * provisional conference ordering — wins desc, point differential desc,
   * franchiseId asc — which is explicitly NOT the M2.6 postseason tiebreak.
   * Streaks come from ordered game summaries, not from the standings fold.
   */

  let {
    standings,
    league,
    humanFranchiseId,
    franchiseName,
    streakOf,
  }: {
    standings: SeasonStandings;
    league: SeasonLeague;
    humanFranchiseId: string | null;
    franchiseName: (franchiseId: string) => string;
    streakOf: (franchiseId: string) => { kind: 'wins' | 'losses'; length: number } | null;
  } = $props();

  const ranked = $derived(provisionalRanking(standings, league));
  const east = $derived(ranked.filter((entry) => entry.conference === 'east'));
  const west = $derived(ranked.filter((entry) => entry.conference === 'west'));

  const pctText = (wins: number, losses: number): string => {
    const pct = winPct(wins, losses);
    return pct === 0 && wins + losses === 0 ? '—' : pct.toFixed(3).slice(1);
  };
</script>

<div class="grid gap-6 lg:grid-cols-2">
  {#each [{ title: 'East', rows: east }, { title: 'West', rows: west }] as conference (conference.title)}
    <section aria-labelledby={`standings-${conference.title.toLowerCase()}-heading`}>
      <h3
        id={`standings-${conference.title.toLowerCase()}-heading`}
        class="font-display text-sm font-extrabold uppercase tracking-tight"
      >
        {conference.title} · provisional
      </h3>
      <div class="mt-2 overflow-x-auto rounded-xl bg-surface-1">
        <table class="w-full min-w-[34rem] text-sm">
          <thead>
            <tr
              class="border-b border-border/70 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
            >
              <th scope="col" class="px-3 py-2 text-left font-medium">#</th>
              <th scope="col" class="px-3 py-2 text-left font-medium">Team</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">W</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">L</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Pct</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Diff</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Conf</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Div</th>
              <th scope="col" class="px-3 py-2 text-right font-medium">Streak</th>
            </tr>
          </thead>
          <tbody>
            {#each conference.rows as entry (entry.row.franchiseId)}
              {@const row = entry.row}
              {@const isHuman = row.franchiseId === humanFranchiseId}
              {@const streak = streakOf(row.franchiseId)}
              <tr
                class="border-b border-border/50 {isHuman ? 'bg-primary/10' : ''}"
                aria-label={isHuman ? `${franchiseName(row.franchiseId)} (your team)` : undefined}
              >
                <td class="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                  {ordinal(entry.rank)}
                </td>
                <th scope="row" class="max-w-44 truncate px-3 py-2 text-left font-semibold">
                  {franchiseName(row.franchiseId)}
                  {#if isHuman}<span class="text-primary" aria-label="your team">*</span>{/if}
                </th>
                <td class="px-3 py-2 text-right font-bold">{row.wins}</td>
                <td class="px-3 py-2 text-right">{row.losses}</td>
                <td class="px-3 py-2 text-right font-mono text-[10px]">
                  {pctText(row.wins, row.losses)}
                </td>
                <td class="px-3 py-2 text-right font-mono text-[10px]">
                  {pointDifferential(row) > 0 ? '+' : ''}{pointDifferential(row)}
                </td>
                <td class="px-3 py-2 text-right font-mono text-[10px]">
                  {row.conferenceWins}–{row.conferenceLosses}
                </td>
                <td class="px-3 py-2 text-right font-mono text-[10px]">
                  {row.divisionWins}–{row.divisionLosses}
                </td>
                <td class="px-3 py-2 text-right font-mono text-[10px]">
                  {streak ? streakLabel(streak.kind, streak.length) : '—'}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="mt-1 font-mono text-[10px] text-muted-foreground">
        Provisional ordering only: wins, point differential, franchise id. The M2.6 postseason
        tiebreak is not applied.
      </p>
    </section>
  {/each}
</div>
