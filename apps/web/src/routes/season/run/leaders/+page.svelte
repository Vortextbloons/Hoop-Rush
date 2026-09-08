<script lang="ts">
  import { getContext } from 'svelte';
  import { resolve } from '$app/paths';
  import { ArrowRight } from '@lucide/svelte';
  import type {
    SeasonGameSummary,
    SeasonLeaderCategory,
    SeasonRosterEntry,
  } from '@hoop-rush/data-contracts';
  import AwardsSection from '$lib/components/season/AwardsSection.svelte';
  import LeadersTable from '$lib/components/season/LeadersTable.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import { foldSeasonAggregates, LEADER_CATEGORY_LABELS } from '$lib/season/season-presentation';
  import { engineOrderLeaderTables, LEADER_CATEGORIES } from '$lib/season/season-leaders-view';
  import { oneDecimal } from '$lib/format';
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
    <div class="flex flex-col gap-3 px-3 sm:px-0">
      <div class="min-w-0 max-w-3xl lg:max-w-none">
        <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
          Season Run · League Honors
        </p>
        <h1
          id="leaders-heading"
          class="font-display mt-1 text-4xl font-extrabold tracking-tight uppercase sm:text-5xl"
        >
          League Honors
        </h1>
        <p class="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground lg:max-w-3xl">
          Every award and category champion from the regular season.
        </p>
      </div>
      <div
        role="group"
        aria-label="Leader category"
        class="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1 md:hidden"
      >
        {#each LEADER_CATEGORIES as category (category)}
          <button
            type="button"
            aria-pressed={activeCategory === category}
            onclick={() => {
              activeCategory = category;
            }}
            class="shrink-0 rounded-md px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {activeCategory ===
            category
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            {LEADER_CATEGORY_LABELS[category]}
          </button>
        {/each}
      </div>
    </div>

    {#if awards !== null}
      <div class="mt-8 px-3 sm:px-0">
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
      <p class="mt-8 rounded-xl bg-surface-1 p-6 text-sm text-muted-foreground">
        No leader data yet — accept a block to fold game summaries.
      </p>
    {:else}
      <div class="mt-10 px-3 sm:px-0">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="font-display text-xl font-extrabold uppercase tracking-tight">
            Category leaders
          </h2>
          <p class="text-[13px] text-muted-foreground">
            Winners lead each table · ranks 2–5 stay compact.
          </p>
        </div>
      </div>
      <div class="mt-4 px-3 sm:px-0 md:hidden">
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

      <div class="mt-4 hidden gap-4 px-3 sm:px-0 md:grid md:grid-cols-2 xl:grid-cols-3">
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
      <footer
        aria-labelledby="season-honors-heading"
        class="mt-10 rounded-2xl border border-border bg-surface-1 p-5 sm:p-6 mx-3 sm:mx-0"
      >
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
          <a
            href={resolve('/season/run/postseason')}
            class="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:brightness-110"
          >
            {seasonComplete ? 'View champion & Finals awards' : 'View playoff bracket'}
            <ArrowRight class="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
        <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-xl bg-surface-2 p-4">
            <dt
              class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
            >
              MVP
            </dt>
            <dd class="mt-1 truncate text-[15px] font-bold">
              {shell.playerName(awards.mvp.playerVersionId)}
            </dd>
          </div>
          <div class="rounded-xl bg-surface-2 p-4">
            <dt
              class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
            >
              DPOY
            </dt>
            <dd class="mt-1 truncate text-[15px] font-bold">
              {shell.playerName(awards.defensivePlayerOfYear.playerVersionId)}
            </dd>
          </div>
          <div class="rounded-xl bg-surface-2 p-4">
            <dt
              class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
            >
              Sixth Man
            </dt>
            <dd class="mt-1 truncate text-[15px] font-bold">
              {shell.playerName(awards.sixthManOfYear.playerVersionId)}
            </dd>
          </div>
          <div class="rounded-xl bg-surface-2 p-4">
            <dt
              class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
            >
              First Team
            </dt>
            <dd class="mt-1 text-[13px] leading-relaxed font-semibold">
              {firstTeamNames.join(' · ')}
            </dd>
          </div>
        </dl>
        <ul class="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {#each championRows as row (row.category)}
            <li
              class="flex items-baseline justify-between gap-3 border-b border-border/50 py-1.5 text-sm"
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
