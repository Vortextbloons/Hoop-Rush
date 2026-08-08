<script lang="ts">
  import type { HoopRushManifest, SeasonLeague, SeasonStandings } from '@hoop-rush/data-contracts';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import {
    ordinal,
    pointDifferential,
    provisionalRanking,
    recordLabel,
    streakLabel,
    winPct,
  } from '$lib/season/season-presentation';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  import SeasonTeamLogo from './SeasonTeamLogo.svelte';

  /**
   * Season Run standings (spec/2.0/02 standings, M2.3.5 League tab). Shows
   * the provisional conference ordering — wins desc, point differential desc,
   * franchiseId asc — which is explicitly NOT the M2.6 postseason tiebreak.
   * Streaks come from ordered game summaries, not from the standings fold.
   *
   * Responsive: below `md` each team is a ranked card with its logo, record,
   * point differential, and an expandable splits panel (home/away,
   * conference, division, streak); at `md+` the same facts render as a
   * complete semantic table. The human franchise is highlighted without
   * implying the ordering is authoritative.
   */

  let {
    standings,
    league,
    humanFranchiseId,
    franchiseName,
    streakOf,
    conference = null,
    manifest = null,
  }: {
    standings: SeasonStandings;
    league: SeasonLeague;
    humanFranchiseId: string | null;
    franchiseName: (franchiseId: string) => string;
    streakOf: (franchiseId: string) => { kind: 'wins' | 'losses'; length: number } | null;
    /** When set, only one conference is rendered (League tab switch). */
    conference?: 'east' | 'west' | null;
    /** Packaged manifest; when present rows render franchise logos. */
    manifest?: HoopRushManifest | null;
  } = $props();

  const ranked = $derived(provisionalRanking(standings, league));
  const conferences = $derived.by(() => {
    const sections: Array<{ title: string; entries: typeof ranked }> = [];
    if (conference === null || conference === 'east') {
      sections.push({ title: 'East', entries: ranked.filter((e) => e.conference === 'east') });
    }
    if (conference === null || conference === 'west') {
      sections.push({ title: 'West', entries: ranked.filter((e) => e.conference === 'west') });
    }
    return sections;
  });

  const pctText = (wins: number, losses: number): string => {
    const pct = winPct(wins, losses);
    return pct === 0 && wins + losses === 0 ? '—' : pct.toFixed(3).slice(1);
  };

  const diffText = (pointsFor: number, pointsAgainst: number): string => {
    const diff = pointsFor - pointsAgainst;
    return `${diff > 0 ? '+' : ''}${String(diff)}`;
  };

  const identityOf = (franchiseId: string) =>
    manifest ? franchiseIdentityOf(manifest, franchiseId) : null;

  /**
   * Responsive split: once the viewport is known, only the active variant
   * mounts (md breakpoint). Null = unknown (SSR, jsdom, no matchMedia): both
   * variants render, exactly like the historical markup.
   */
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

{#each conferences as section (section.title)}
  <section aria-labelledby={`standings-${section.title.toLowerCase()}-heading`}>
    <h3
      id={`standings-${section.title.toLowerCase()}-heading`}
      class="font-display px-3 text-sm font-extrabold uppercase tracking-tight sm:px-0"
    >
      {section.title} · provisional
    </h3>

    <!-- Mobile: ranked team cards with expandable splits -->
    {#if desktopViewport !== true}
      <ul class="mt-2 flex flex-col gap-0 md:hidden md:gap-2">
        {#each section.entries as entry (entry.row.franchiseId)}
          {@const row = entry.row}
          {@const isHuman = row.franchiseId === humanFranchiseId}
          {@const streak = streakOf(row.franchiseId)}
          {@const identity = identityOf(row.franchiseId)}
          <li
            data-season-standings-row
            aria-label={isHuman ? `${franchiseName(row.franchiseId)} (your team)` : undefined}
            class="overflow-hidden bg-surface-1 sm:rounded-xl {isHuman
              ? 'ring-1 ring-primary/40'
              : ''}"
          >
            <a
              href={resolve(`/season/run/teams/?franchiseId=${row.franchiseId}` as RouteId)}
              data-season-standings-link={row.franchiseId}
              aria-label={`${franchiseName(row.franchiseId)} roster`}
              class="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-2 sm:gap-x-3 sm:px-4"
            >
              <span class="w-7 shrink-0 font-mono text-[10px] font-bold text-muted-foreground">
                {ordinal(entry.rank)}
              </span>
              {#if manifest && identity}
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
                {franchiseName(row.franchiseId)}
                {#if isHuman}<span class="text-primary" aria-label="your team">*</span>{/if}
              </span>
              <span class="shrink-0 text-right tabular-nums">
                <span class="block font-mono text-xs font-bold">
                  {recordLabel(row.wins, row.losses)}
                </span>
                <span class="block font-mono text-[10px] text-muted-foreground">
                  {diffText(row.pointsFor, row.pointsAgainst)}
                </span>
              </span>
            </a>
            <details class="group border-t border-border/50">
              <summary
                class="cursor-pointer px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
              >
                Splits
              </summary>
              <dl class="grid grid-cols-2 gap-x-4 gap-y-1 px-4 pb-3 text-sm">
                <div class="flex items-center justify-between gap-2">
                  <dt class="font-mono text-[10px] text-muted-foreground">Home</dt>
                  <dd class="font-mono text-[10px]">{row.homeWins}–{row.homeLosses}</dd>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <dt class="font-mono text-[10px] text-muted-foreground">Away</dt>
                  <dd class="font-mono text-[10px]">{row.awayWins}–{row.awayLosses}</dd>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <dt class="font-mono text-[10px] text-muted-foreground">Conference</dt>
                  <dd class="font-mono text-[10px]">{row.conferenceWins}–{row.conferenceLosses}</dd>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <dt class="font-mono text-[10px] text-muted-foreground">Division</dt>
                  <dd class="font-mono text-[10px]">{row.divisionWins}–{row.divisionLosses}</dd>
                </div>
                <div class="flex items-center justify-between gap-2">
                  <dt class="font-mono text-[10px] text-muted-foreground">Streak</dt>
                  <dd class="font-mono text-[10px] font-bold">
                    {streak ? streakLabel(streak.kind, streak.length) : '—'}
                  </dd>
                </div>
              </dl>
            </details>
          </li>
        {/each}
      </ul>
    {/if}

    <!-- Desktop: complete semantic table -->
    {#if desktopViewport !== false}
      <div class="mt-2 hidden overflow-x-auto rounded-xl bg-surface-1 md:block">
        <table class="w-full min-w-[42rem] text-sm">
          <caption class="sr-only">
            {section.title} conference standings — provisional ordering
          </caption>
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
            {#each section.entries as entry (entry.row.franchiseId)}
              {@const row = entry.row}
              {@const isHuman = row.franchiseId === humanFranchiseId}
              {@const streak = streakOf(row.franchiseId)}
              {@const identity = identityOf(row.franchiseId)}
              <tr
                data-season-standings-row
                class="border-b border-border/50 transition-colors hover:bg-surface-2/60 {isHuman
                  ? 'bg-primary/10'
                  : ''}"
                aria-label={isHuman ? `${franchiseName(row.franchiseId)} (your team)` : undefined}
              >
                <td class="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                  {ordinal(entry.rank)}
                </td>
                <th scope="row" class="max-w-44 truncate px-3 py-2 text-left font-semibold">
                  <a
                    href={resolve(`/season/run/teams/?franchiseId=${row.franchiseId}` as RouteId)}
                    data-season-standings-link={row.franchiseId}
                    aria-label={`${franchiseName(row.franchiseId)} roster`}
                    class="flex items-center gap-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:text-primary"
                  >
                    {#if manifest && identity}
                      <SeasonTeamLogo
                        {manifest}
                        franchiseId={identity.franchiseId}
                        teamExternalId={identity.teamExternalId}
                        alt=""
                        size="sm"
                      />
                    {/if}
                    <span class="min-w-0 truncate">
                      {franchiseName(row.franchiseId)}
                      {#if isHuman}<span class="text-primary" aria-label="your team">*</span>{/if}
                    </span>
                  </a>
                </th>
                <td class="px-3 py-2 text-right font-bold">{row.wins}</td>
                <td class="px-3 py-2 text-right">{row.losses}</td>
                <td class="px-3 py-2 text-right font-mono text-[10px]">
                  {pctText(row.wins, row.losses)}
                </td>
                <td class="px-3 py-2 text-right font-mono text-[10px]">
                  {diffText(row.pointsFor, row.pointsAgainst)}
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
    {/if}
  </section>
{/each}

<p class="mt-2 font-mono text-[10px] text-muted-foreground">
  Provisional ordering only: wins, point differential, franchise id. The M2.6 postseason tiebreak is
  not applied.
</p>
