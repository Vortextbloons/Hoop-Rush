<script lang="ts">
  import { getContext } from 'svelte';
  import { resolve } from '$app/paths';
  import { ArrowRight } from '@lucide/svelte';
  import type {
    SeasonGameSummary,
    SeasonLeaderCategory,
    SeasonRosterEntry,
  } from '@hoop-rush/data-contracts';
  import AwardsSection from '#lib/components/season/AwardsSection.svelte';
  import LeadersTable from '#lib/components/season/LeadersTable.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '#lib/season/season-shell-context.js';
  import { foldSeasonAggregates, LEADER_CATEGORY_LABELS } from '#lib/season/season-presentation.js';
  import { engineOrderLeaderTables, LEADER_CATEGORIES } from '#lib/season/season-leaders-view.js';
  import { oneDecimal } from '#lib/format.js';
  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);
  let activeCategory = $state<SeasonLeaderCategory>('points');
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
  const leadersWeak = new WeakMap<object, ReturnType<typeof engineOrderLeaderTables>>();
  function memoizedLeaders(
    aggregates: ReturnType<typeof memoizedFold>,
  ): ReturnType<typeof engineOrderLeaderTables> {
    const hit = leadersWeak.get(aggregates);
    if (hit !== undefined) return hit;
    const ordered = engineOrderLeaderTables(aggregates.players, aggregates.teams);
    leadersWeak.set(aggregates, ordered);
    return ordered;
  }
  const aggregates = $derived(shell.snapshot ? memoizedFold(shell.snapshot.summaries) : null);
  const leaders = $derived(aggregates ? memoizedLeaders(aggregates) : null);
  const rosterByVersion = $derived.by(() => {
    const map = new Map<string, SeasonRosterEntry>();
    for (const roster of shell.run?.rosters ?? []) {
      for (const entry of roster.players) map.set(entry.playerVersionId, entry);
    }
    return map;
  });
  const manifest = $derived(shell.manifest);
  const awards = $derived(shell.run?.awards ?? null);
  const stage = $derived(shell.run?.stage ?? null);
  const seasonComplete = $derived(stage === 'completed');
  const championRows = $derived.by(() => {
    if (!leaders) return [];
    return LEADER_CATEGORIES.map((category) => {
      const top = leaders[category][0] ?? null;
      return {
        category,
        label: LEADER_CATEGORY_LABELS[category],
        name: top ? shell.playerName(top.playerVersionId) : '—',
        perGame: top ? oneDecimal(top.perGame) : '—',
      };
    });
  });
  const firstTeamNames = $derived.by(() => {
    if (!awards) return [];
    return awards.allLeagueFirstTeam.map((member) => shell.playerName(member.playerVersionId));
  });
</script>

<svelte:head>
  <title>Season Run — League Honors — Hoop Rush</title>
</svelte:head>

{#if !shell.ready || !shell.snapshot || !shell.run || !manifest}
  <p class="py-10 font-mono text-sm text-muted-foreground">Preparing League Honors…</p>
{:else}
  <section aria-labelledby="leaders-heading" class="min-w-0 pt-6">
    <div class="sr-arrive flex flex-col gap-3">
      <div class="min-w-0 max-w-3xl lg:max-w-none">
        <p class="sr-eyebrow">Season Run · League Honors</p>
        <h1 id="leaders-heading" class="sr-page-title mt-1">League Honors</h1>
      </div>
      <div
        role="group"
        aria-label="Leader category"
        class="flex max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-surface-2 p-1 md:hidden"
      >
        {#each LEADER_CATEGORIES as category (category)}
          <button
            type="button"
            aria-pressed={activeCategory === category}
            onclick={() => {
              activeCategory = category;
            }}
            class="min-h-11 shrink-0 rounded-full px-4 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-colors {activeCategory ===
            category
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'} motion-reduce:transition-none"
          >
            {LEADER_CATEGORY_LABELS[category]}
          </button>
        {/each}
      </div>
    </div>

    {#if awards !== null}
      <div class="mt-8">
        <AwardsSection
          {awards}
          playerName={shell.playerName}
          franchiseName={shell.franchiseName}
          franchiseAbbrev={shell.franchiseAbbrev}
          aggregates={aggregates?.players ?? null}
          {rosterByVersion}
          {manifest}
          faces={shell.facesByVersion}
        />
      </div>
    {/if}

    {#if !leaders}
      <p class="sr-panel-quiet mt-8 p-6 text-sm text-muted-foreground">
        No leader data yet — accept a block to fold game summaries.
      </p>
    {:else}
      <div class="mt-10">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="sr-section-label">Category leaders</h2>
          <p class="text-[13px] text-muted-foreground">
            Winners lead each table · ranks 2–5 stay compact.
          </p>
        </div>
      </div>
      <div class="mt-3 md:hidden">
        <LeadersTable
          category={activeCategory}
          entries={leaders[activeCategory]}
          {rosterByVersion}
          faces={shell.facesByVersion}
          {manifest}
          playerName={shell.playerName}
          franchiseAbbrev={shell.franchiseAbbrev}
        />
      </div>

      <div class="mt-3 hidden gap-4 md:grid md:grid-cols-2 xl:grid-cols-3">
        {#each LEADER_CATEGORIES as category (category)}
          <LeadersTable
            {category}
            entries={leaders[category]}
            {rosterByVersion}
            faces={shell.facesByVersion}
            {manifest}
            playerName={shell.playerName}
            franchiseAbbrev={shell.franchiseAbbrev}
          />
        {/each}
      </div>
    {/if}

    {#if awards !== null && leaders}
      <footer aria-labelledby="season-honors-heading" class="sr-panel-featured mt-10 p-5 sm:p-6">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="season-honors-heading"
              class="font-display text-lg font-extrabold uppercase tracking-tight"
            >
              Season Honors
            </h2>
            <p class="mt-1 text-[13px] text-muted-foreground">
              The regular season, decided — take it into the postseason.
            </p>
          </div>

          <a href={resolve('season/run/postseason/')} class="sr-btn">
            {seasonComplete ? 'View champion & Finals awards' : 'View playoff bracket'}

            <ArrowRight class="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
        <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div class="sr-stat-tile">
            <dt class="sr-section-label">MVP</dt>
            <dd class="mt-1 truncate text-[15px] font-bold">
              {shell.playerName(awards.mvp.playerVersionId)}
            </dd>
          </div>
          <div class="sr-stat-tile">
            <dt class="sr-section-label">DPOY</dt>
            <dd class="mt-1 truncate text-[15px] font-bold">
              {shell.playerName(awards.defensivePlayerOfYear.playerVersionId)}
            </dd>
          </div>
          <div class="sr-stat-tile">
            <dt class="sr-section-label">Sixth Man</dt>
            <dd class="mt-1 truncate text-[15px] font-bold">
              {shell.playerName(awards.sixthManOfYear.playerVersionId)}
            </dd>
          </div>
          <div class="sr-stat-tile">
            <dt class="sr-section-label">First Team</dt>
            <dd class="mt-1 text-[13px] leading-relaxed font-semibold">
              {firstTeamNames.join(' · ')}
            </dd>
          </div>
        </dl>
        <ul class="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {#each championRows as row (row.category)}
            <li
              class="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 text-sm"
            >
              <span class="text-muted-foreground">{row.label}</span>
              <span class="min-w-0 truncate font-semibold">
                {row.name}
                <span class="ml-1 font-mono text-xs text-muted-foreground">{row.perGame}/g</span>
              </span>
            </li>
          {/each}
        </ul>
      </footer>
    {/if}
  </section>
{/if}
