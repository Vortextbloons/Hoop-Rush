<script lang="ts">
  import type {
    HoopRushManifest,
    SeasonEffectsState,
    SeasonGameSummary,
    SeasonRoster,
  } from '@hoop-rush/data-contracts';
  import SeasonPlayerStats from '$lib/components/season/SeasonPlayerStats.svelte';
  import SeasonRosterList from '$lib/components/season/SeasonRosterList.svelte';
  import type { SeasonPlayerStatsView } from '$lib/season/season-player-stats-view';
  import type { SeasonRunShellData } from '$lib/season/season-shell-context';
  type RosterPanelView = 'roster' | 'stats';
  let {
    roster,
    manifest,
    shell,
    roleOf,
    effects,
    summaries,
    statsView,
  }: {
    roster: SeasonRoster;
    manifest: HoopRushManifest;
    shell: SeasonRunShellData;
    roleOf: (playerVersionId: string) => {
      role: string;
      minutes: number | string;
    };
    effects: SeasonEffectsState | null;
    summaries: SeasonGameSummary[];
    statsView: SeasonPlayerStatsView;
  } = $props();
  let view = $state<RosterPanelView>('roster');
  const inactiveCount = $derived(shell.editor?.inactiveMembers().length ?? 0);
</script>

<section aria-labelledby="roster-panel-heading" class="min-w-0" data-team-roster-panel>
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div class="min-w-0">
      <h3
        id="roster-panel-heading"
        class="font-display text-xl font-extrabold uppercase tracking-tight"
      >
        Roster
      </h3>
      <p class="mt-1 font-mono text-[10px] text-muted-foreground">
        Ten active rotation players
        {#if inactiveCount > 0}
          · {inactiveCount} inactive {inactiveCount === 1 ? 'player' : 'players'}
        {/if}
        · identity, workload, and folded box scores
      </p>
    </div>
    <div
      role="group"
      aria-label="Roster view"
      class="flex w-full rounded-lg bg-surface-2 p-1 sm:w-auto"
    >
      <button
        type="button"
        aria-pressed={view === 'roster'}
        onclick={() => {
          view = 'roster';
        }}
        class="min-h-11 flex-1 rounded-md px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:flex-none sm:px-3 sm:py-1.5 {view ===
        'roster'
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground'}"
      >
        Overview
      </button>
      <button
        type="button"
        aria-pressed={view === 'stats'}
        onclick={() => {
          view = 'stats';
        }}
        class="min-h-11 flex-1 rounded-md px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:flex-none sm:px-3 sm:py-1.5 {view ===
        'stats'
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground'}"
      >
        Season stats
      </button>
    </div>
  </div>

  <div class="mt-4">
    {#if view === 'roster'}
      <SeasonRosterList {roster} {manifest} {shell} {roleOf} {effects} {summaries} embedded />
    {:else}
      <SeasonPlayerStats view={statsView} {manifest} {shell} embedded />
    {/if}
  </div>
</section>
