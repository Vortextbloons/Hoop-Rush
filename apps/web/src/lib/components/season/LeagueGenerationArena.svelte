<script lang="ts">
  import type { SeasonLeague } from '@hoop-rush/data-contracts';
  import type { SeasonDraftGenerationProgress } from '$lib/season/season-draft-flow';
  import { SIM_BAR_FILL_MS } from '$lib/components/season/live-sim-animation';
  let {
    progress = null,
    league = null,
  }: {
    progress: SeasonDraftGenerationProgress | null;
    league: SeasonLeague | null;
  } = $props();
  const phase = $derived(progress?.phase ?? null);
  const percent = $derived.by(() => {
    if (progress === null) return 2;
    const { phase: p, completed, total } = progress;
    const safeTotal = Math.max(1, total);
    const frac = Math.min(1, Math.max(0, completed / safeTotal));
    if (p === 'scouting') return 5;
    if (p === 'anchors') return 15;
    if (p === 'pool-fill') return Math.round(15 + frac * 45);
    if (p === 'selection') return Math.round(60 + frac * 25);
    if (p === 'rotations') return Math.round(85 + frac * 13);
    return 100;
  });
  const stageLine = $derived.by(() => {
    if (progress === null) return 'Taking the court…';
    const { phase: p, completed, total } = progress;
    if (p === 'scouting') return 'Scouting the pool…';
    if (p === 'anchors') return 'Placing franchise anchors…';
    if (p === 'pool-fill') return `Filling pools — round ${String(completed)}/${String(total)}`;
    if (p === 'selection')
      return `Selecting rosters — ${String(completed)}/${String(total)} teams`;
    if (p === 'rotations') return `Planning rotations — ${String(completed)}/${String(total)}`;
    return 'Final buzzer…';
  });
  const completedSet = $derived(new Set(progress?.teamsCompleted ?? []));
  const eastTeams = $derived((league?.teams ?? []).filter((t) => t.conference === 'east'));
  const westTeams = $derived((league?.teams ?? []).filter((t) => t.conference === 'west'));
  function lit(franchiseId: string, control: string): boolean {
    if (control === 'human') return true;
    return completedSet.has(franchiseId);
  }
</script>

<div class="mt-10 overflow-hidden rounded-none bg-surface-1 sm:rounded-xl">
  <div
    aria-hidden="true"
    class="h-1 w-full bg-gradient-to-r from-primary via-primary/40 to-primary motion-reduce:hidden"
  ></div>
  <div class="p-6">
    <div class="flex flex-wrap items-center gap-2">
      <span class="sim-live-pill"><span class="sim-live-dot" aria-hidden="true"></span>Live</span>
      <span class="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground"
        >Arena reveal</span
      >
    </div>
    <h2 class="mt-3 font-display text-xl font-extrabold uppercase tracking-tight">
      Building league…
    </h2>
    <p class="mt-1 text-xs text-muted-foreground" role="status">{stageLine}</p>
    <p class="mt-1 text-xs text-muted-foreground">Filling the other 29 teams. Your draft is saved.</p>
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={stageLine}
      class="mt-4"
    >
      <div class="flex items-center justify-between font-mono text-xs text-muted-foreground">
        <span>{percent}%</span>
        <span class="tabular-nums">{stageLine}</span>
      </div>
      <div class="sim-bar mt-2" aria-hidden="true">
        <div
          class="sim-bar-fill"
          data-active={phase !== 'done'}
          style="width: {percent}%; transition: width {SIM_BAR_FILL_MS}ms linear"
        ></div>
      </div>
    </div>
    {#if league !== null}
      <div class="mt-5 grid gap-4 sm:grid-cols-2">
        {#each [{ label: 'East', teams: eastTeams }, { label: 'West', teams: westTeams }] as conf (conf.label)}
          <div>
            <p
              class="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground"
            >
              {conf.label}
            </p>
            <div class="mt-2 flex flex-wrap items-center gap-1.5" aria-label="{conf.label} teams lit">
              {#each conf.teams as team (team.franchiseId)}
                {@const isLit = lit(team.franchiseId, team.control)}
                <span
                  title={team.franchiseId}
                  class="inline-block h-2.5 w-2.5 rounded-full {isLit
                    ? 'bg-primary'
                    : 'bg-border'} {team.control === 'human'
                    ? 'ring-2 ring-primary/60 ring-offset-1 ring-offset-surface-1'
                    : ''} motion-reduce:transition-none"
                ></span>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
    <span class="sr-only" aria-live="polite">{stageLine} {percent}%</span>
  </div>
</div>
