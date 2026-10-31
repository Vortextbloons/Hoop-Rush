<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    HavocBattleInput,
    HavocBattleResult,
    HavocBattleTape,
  } from '@hoop-rush/data-contracts';
  import GameScoreboard from '#lib/components/GameScoreboard.svelte';
  import GamecastBattleBox from '#lib/gamecast/GamecastBattleBox.svelte';
  import {
    gamecastBattleFeedLines,
    gamecastBattlePlaybackItems,
    gamecastBattleVisibleState,
  } from '#lib/gamecast/gamecast-battle-playback.js';
  import { gamecastBattleLiveBoxes } from '#lib/gamecast/gamecast-battle-view.js';

  let {
    input,
    result,
    tape,
    speed,
    label,
    localTeamId,
    oncomplete,
    onclose,
  }: {
    input: HavocBattleInput;
    result: HavocBattleResult;
    tape: HavocBattleTape;
    speed: 2 | 4;
    label: string;
    localTeamId: string;
    oncomplete: () => void;
    onclose: () => void;
  } = $props();

  const items = $derived(gamecastBattlePlaybackItems(tape));
  const total = $derived(items.length);
  const step = $derived(Math.max(1, Math.ceil((items.length * speed) / 100)));
  let cursor = $state(0);
  let playing = $state(true);

  onMount(() => {
    const id = setInterval(() => {
      if (!playing) return;
      cursor = Math.min(total, cursor + step);
      if (cursor >= total) playing = false;
    }, 100);
    return () => clearInterval(id);
  });

  const visible = $derived(gamecastBattleVisibleState(items, cursor));
  const feed = $derived(gamecastBattleFeedLines({ result, tape }, items, cursor));
  const boxes = $derived(gamecastBattleLiveBoxes(result, visible));
  const progress = $derived(total === 0 ? 1 : cursor / total);
  const complete = $derived(cursor >= total);
  const localSide = $derived(input.home.teamId === localTeamId ? 'home' : 'away');
  const clock = $derived(
    `${String(Math.floor(visible.clockSeconds / 60))}:${String(visible.clockSeconds % 60).padStart(2, '0')}`,
  );
  const teams = $derived([
    {
      key: 'home',
      label: result.home.displayName,
      score: visible.homeScore,
      winner: visible.homeScore > visible.awayScore,
    },
    {
      key: 'away',
      label: result.away.displayName,
      score: visible.awayScore,
      winner: visible.awayScore > visible.homeScore,
    },
  ] as const);
</script>

<section class="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
  <header class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label} · {speed}×
      </p>
      <h2 class="font-display text-2xl font-extrabold uppercase tracking-tight">
        {result.home.displayName} vs {result.away.displayName}
      </h2>
    </div>
    <div class="flex items-center gap-2">
      {#if !complete}
        <button
          type="button"
          class="inline-flex min-h-9 items-center justify-center rounded-lg border border-border bg-surface-2 px-3 text-xs font-semibold"
          onclick={() => (playing = !playing)}
        >
          {playing ? 'Pause' : 'Resume'}
        </button>
      {/if}
      <button
        type="button"
        class="inline-flex min-h-9 items-center justify-center rounded-lg border border-border bg-surface-2 px-3 text-xs font-semibold"
        onclick={onclose}
      >
        Close
      </button>
    </div>
  </header>

  <GameScoreboard {teams} label="Live score" />
  <div
    class="flex items-center justify-between font-mono text-xs text-muted-foreground tabular-nums"
  >
    <span>Q{visible.period}</span>
    <span>{clock}</span>
    <span>{Math.round(progress * 100)}%</span>
  </div>
  <div class="h-1.5 overflow-hidden rounded-full bg-surface-2">
    <div
      class="h-full bg-primary transition-[width]"
      style:width={`${Math.round(progress * 100)}%`}
    ></div>
  </div>

  {#if feed.length > 0}
    <ul class="flex max-h-40 flex-col gap-1 overflow-y-auto">
      {#each feed.slice(-8) as line (line.key)}
        <li class="flex items-center justify-between gap-2 text-xs">
          <span class="truncate text-muted-foreground">{line.summary}</span>
          <span class="font-mono font-semibold tabular-nums"
            >{line.points > 0 ? `+${line.points}` : ''}</span
          >
        </li>
      {/each}
    </ul>
  {/if}

  <details class="rounded-xl border border-border bg-surface-2 p-3">
    <summary class="cursor-pointer text-xs font-semibold">Box score</summary>
    <div class="mt-3">
      <GamecastBattleBox {boxes} {localSide} />
    </div>
  </details>

  {#if complete}
    <button
      type="button"
      class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary"
      onclick={oncomplete}
    >
      Continue
    </button>
  {/if}
</section>
