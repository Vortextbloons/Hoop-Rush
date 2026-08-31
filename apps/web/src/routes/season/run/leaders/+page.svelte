<script lang="ts">
  import { getContext } from 'svelte';
  import type { SeasonLeaderCategory, SeasonRosterEntry } from '@hoop-rush/data-contracts';
  import AwardsSection from '$lib/components/season/AwardsSection.svelte';
  import LeadersTable from '$lib/components/season/LeadersTable.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import { foldSeasonAggregates, LEADER_CATEGORY_LABELS } from '$lib/season/season-presentation';
  import { engineOrderLeaderTables, LEADER_CATEGORIES } from '$lib/season/season-leaders-view';
  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);
  let activeCategory = $state<SeasonLeaderCategory>('points');
  const aggregates = $derived(
    shell.snapshot ? foldSeasonAggregates(shell.snapshot.summaries) : null,
  );
  const leaders = $derived(
    aggregates ? engineOrderLeaderTables(aggregates.players, aggregates.teams) : null,
  );
  const rosterByVersion = $derived.by(() => {
    const map = new Map<string, SeasonRosterEntry>();
    for (const roster of shell.run?.rosters ?? []) {
      for (const entry of roster.players) map.set(entry.playerVersionId, entry);
    }
    return map;
  });
  const manifest = $derived(shell.manifest);
  const awards = $derived(shell.run?.awards ?? null);
</script>

<svelte:head>
  <title>Season Run — leaders — Hoop Rush</title>
</svelte:head>

{#if !shell.ready || !shell.snapshot || !shell.run || !manifest}
  <p class="py-10 font-mono text-sm text-muted-foreground">Preparing the leaders…</p>
{:else}
  <section aria-labelledby="leaders-heading" class="min-w-0 pt-6">
    <div class="flex flex-col gap-3 px-3 sm:px-0">
      <div class="min-w-0">
        <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
          Season Run · leaders
        </p>
        <h1
          id="leaders-heading"
          class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl"
        >
          Leaders
        </h1>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
          Rate categories require a 70% game share · ordered per-game, then value
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
      <div class="mt-6">
        <AwardsSection
          {awards}
          playerName={shell.playerName}
          franchiseName={shell.franchiseName}
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
      <div class="mt-6 md:hidden">
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

      <div class="mt-6 hidden grid-cols-2 gap-4 lg:grid-cols-3 md:grid">
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

    <p class="mt-6 font-mono text-[10px] text-muted-foreground">
      Identity is the player-season version: each row is one distinct season of one player, with its
      historical source logo and season. Eligibility: at least 70% of the team's games.
    </p>
  </section>
{/if}
