<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    HavocBattleInput,
    HavocBattleResult,
    HavocBattleTape,
  } from '@hoop-rush/data-contracts';
  import GamecastBattleBroadcast from '#lib/gamecast/GamecastBattleBroadcast.svelte';
  import {
    gamecastBattleFeedLines,
    gamecastBattlePlaybackItems,
    gamecastBattleVisibleState,
  } from '#lib/gamecast/gamecast-battle-playback.js';

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
  const progress = $derived(total === 0 ? 1 : cursor / total);
  const complete = $derived(cursor >= total);
  const localSide = $derived(input.home.teamId === localTeamId ? 'home' : 'away');
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

  <GamecastBattleBroadcast theme="duel" {result} {visible} {feed} {progress} {localSide} />

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
