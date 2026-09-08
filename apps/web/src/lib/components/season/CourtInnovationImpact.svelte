<script lang="ts">
  import type { SeasonInnovationImpact } from '$lib/season/season-innovation-impact-view';
  import RuleBadge from './RuleBadge.svelte';

  let {
    impact,
    blockImpact = null,
    franchiseName,
  }: {
    impact: SeasonInnovationImpact;
    blockImpact?: SeasonInnovationImpact | null;
    franchiseName: (franchiseId: string) => string;
  } = $props();

  function marginLabel(margin: number): string {
    return `${margin >= 0 ? '+' : ''}${String(margin)}`;
  }

  function pointsLabel(points: number | null): string {
    return points === null ? 'Not recorded' : `${String(points)} pts`;
  }
</script>

<section
  aria-labelledby="court-innovation-impact-heading"
  data-season-court-impact
  class="scoreboard-panel border border-primary/30 p-4 sm:p-5"
>
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0">
      <p class="font-mono text-[10px] font-bold tracking-[0.18em] text-primary uppercase">
        Court innovation · observed impact
      </p>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <h2
          id="court-innovation-impact-heading"
          class="font-display text-2xl font-black tracking-tight uppercase sm:text-3xl"
        >
          {impact.displayName}
        </h2>
        <RuleBadge rule={impact.rule} />
      </div>
      <p class="mt-1 max-w-2xl text-xs text-muted-foreground">
        What this rule produced in your home games this season. It reports recorded results, not a
        simulated alternate outcome.
      </p>
    </div>
    <div
      class="shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-right"
      aria-label="Home innovation game record"
    >
      <p class="font-mono text-[9px] font-bold tracking-[0.14em] text-primary uppercase">
        Home record
      </p>
      <p class="font-display text-3xl font-black leading-none tabular-nums">
        {impact.wins}–{impact.losses}
      </p>
    </div>
  </div>

  <div class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
    <div class="rounded-lg bg-surface-2 p-3">
      <p class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Home games
      </p>
      <p class="mt-1 font-display text-2xl font-extrabold tabular-nums">{impact.games.length}</p>
    </div>
    <div class="rounded-lg bg-surface-2 p-3">
      <p class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Avg margin
      </p>
      <p class="mt-1 font-display text-2xl font-extrabold tabular-nums">
        {marginLabel(impact.averageMargin)}
      </p>
    </div>
    <div class="rounded-lg bg-surface-2 p-3">
      <p class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Points / 100
      </p>
      <p class="mt-1 font-display text-2xl font-extrabold tabular-nums">
        {impact.pointsPer100 === null ? '—' : impact.pointsPer100}
      </p>
    </div>
    <div class="rounded-lg bg-surface-2 p-3">
      <p class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Sample
      </p>
      <p class="mt-1 font-display text-2xl font-extrabold tabular-nums">
        {impact.games.length}
        {impact.games.length === 1 ? 'game' : 'games'}
      </p>
    </div>
  </div>

  {#if blockImpact !== null && blockImpact !== undefined}
    <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span class="font-mono font-bold tracking-[0.12em] text-primary uppercase">This block</span>
      <span class="font-semibold">{blockImpact.wins}–{blockImpact.losses}</span>
      <span class="text-muted-foreground">
        {marginLabel(blockImpact.averageMargin)} average margin across {blockImpact.games.length}
        {blockImpact.games.length === 1 ? 'home game' : 'home games'}
      </span>
    </div>
  {/if}

  <div class="mt-5 rounded-xl border border-border/70 bg-surface-2/70 p-3 sm:p-4">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-accent uppercase">
          What showed up on court
        </p>
        <p class="mt-1 text-xs text-muted-foreground">
          Directly recorded signals from the rule’s home-game mechanics.
        </p>
      </div>
    </div>

    {#if impact.evidence.kind === 'deep-four'}
      <div class="mt-3 grid gap-2 sm:grid-cols-3">
        <div class="rounded-lg bg-surface-1 p-3">
          <p class="font-mono text-[9px] font-bold text-muted-foreground uppercase">Deep shots</p>
          <p class="mt-1 text-lg font-extrabold tabular-nums">
            {impact.evidence.makes === null || impact.evidence.attempts === null
              ? 'Not recorded'
              : `${String(impact.evidence.makes)}/${String(impact.evidence.attempts)}`}
          </p>
          <p class="text-[11px] text-muted-foreground">made / attempted</p>
        </div>
        <div class="rounded-lg bg-surface-1 p-3">
          <p class="font-mono text-[9px] font-bold text-muted-foreground uppercase">Rule points</p>
          <p class="mt-1 text-lg font-extrabold tabular-nums">
            {pointsLabel(impact.evidence.points)}
          </p>
          <p class="text-[11px] text-muted-foreground">from deep makes</p>
        </div>
        <div class="rounded-lg bg-surface-1 p-3">
          <p class="font-mono text-[9px] font-bold text-muted-foreground uppercase">
            Scoring shape
          </p>
          <p class="mt-1 text-sm font-semibold">Deep makes count as four</p>
          <p class="text-[11px] text-muted-foreground">above-the-break zone</p>
        </div>
      </div>
    {:else if impact.evidence.kind === 'twenty-second-clock'}
      <div class="mt-3 grid gap-2 sm:grid-cols-3">
        <div class="rounded-lg bg-surface-1 p-3">
          <p class="font-mono text-[9px] font-bold text-muted-foreground uppercase">Possessions</p>
          <p class="mt-1 text-lg font-extrabold tabular-nums">{impact.evidence.possessions}</p>
          <p class="text-[11px] text-muted-foreground">home total</p>
        </div>
        <div class="rounded-lg bg-surface-1 p-3">
          <p class="font-mono text-[9px] font-bold text-muted-foreground uppercase">Turnovers</p>
          <p class="mt-1 text-lg font-extrabold tabular-nums">{impact.evidence.turnovers}</p>
          <p class="text-[11px] text-muted-foreground">home total</p>
        </div>
        <div class="rounded-lg bg-surface-1 p-3">
          <p class="font-mono text-[9px] font-bold text-muted-foreground uppercase">
            Shot-clock violations
          </p>
          <p class="mt-1 text-lg font-extrabold tabular-nums">
            {impact.evidence.shotClockViolations ?? 'Not recorded'}
          </p>
          <p class="text-[11px] text-muted-foreground">direct rule signal</p>
        </div>
      </div>
    {:else}
      <div class="mt-3 grid gap-2 sm:grid-cols-3">
        <div class="rounded-lg bg-surface-1 p-3">
          <p class="font-mono text-[9px] font-bold text-muted-foreground uppercase">
            Overtime races
          </p>
          <p class="mt-1 text-lg font-extrabold tabular-nums">{impact.evidence.overtimeGames}</p>
          <p class="text-[11px] text-muted-foreground">first to seven</p>
        </div>
        <div class="rounded-lg bg-surface-1 p-3">
          <p class="font-mono text-[9px] font-bold text-muted-foreground uppercase">Race points</p>
          <p class="mt-1 text-lg font-extrabold tabular-nums">
            {impact.evidence.raceHomePoints === null || impact.evidence.raceAwayPoints === null
              ? 'Not recorded'
              : `${String(impact.evidence.raceHomePoints)}–${String(impact.evidence.raceAwayPoints)}`}
          </p>
          <p class="text-[11px] text-muted-foreground">home–away total</p>
        </div>
        <div class="rounded-lg bg-surface-1 p-3">
          <p class="font-mono text-[9px] font-bold text-muted-foreground uppercase">
            Race possessions
          </p>
          <p class="mt-1 text-lg font-extrabold tabular-nums">
            {impact.evidence.racePossessions ?? 'Not retained'}
          </p>
          <p class="text-[11px] text-muted-foreground">from full game details</p>
        </div>
      </div>
    {/if}
  </div>

  <div class="mt-5">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="font-mono text-[10px] font-bold tracking-[0.16em] text-muted-foreground uppercase">
        Home-game evidence
      </h3>
      <span class="text-[11px] text-muted-foreground">Select a game for detail</span>
    </div>
    <div class="mt-2 flex flex-col gap-2">
      {#each impact.games as game (game.gameId)}
        <details class="group rounded-lg border border-border bg-surface-2">
          <summary
            class="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
          >
            <span
              class="grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-[10px] font-black {game.result ===
              'W'
                ? 'bg-positive/15 text-positive'
                : 'bg-destructive/15 text-destructive'}"
              aria-label={game.result === 'W' ? 'Win' : 'Loss'}
            >
              {game.result}
            </span>
            <span class="min-w-0 flex-1 truncate">
              <span class="font-semibold">vs {franchiseName(game.opponentFranchiseId)}</span>
              <span class="ml-2 font-mono text-[10px] text-muted-foreground">R{game.round}</span>
            </span>
            <span class="font-mono text-xs font-bold tabular-nums">
              {game.homeScore}–{game.awayScore}
            </span>
            <span class="text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div class="grid gap-2 border-t border-border/60 px-3 py-3 text-xs sm:grid-cols-3">
            <p><span class="text-muted-foreground">Margin</span> · {marginLabel(game.margin)}</p>
            <p>
              <span class="text-muted-foreground">Possessions</span> · {game.possessions ||
                'Not recorded'}
            </p>
            <p>
              <span class="text-muted-foreground">Points / 100</span> · {game.pointsPer100 ?? '—'}
            </p>
          </div>
          <a
            href={`#box-score-${game.gameId}`}
            class="inline-flex min-h-11 items-center px-3 pb-3 text-xs font-semibold text-primary underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring hover:underline"
          >
            Open full box score
            <span class="ml-1" aria-hidden="true">↓</span>
          </a>
        </details>
      {/each}
    </div>
  </div>
</section>
