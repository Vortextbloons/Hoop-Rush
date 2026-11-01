<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    HavocBattleInput,
    HavocBattleResult,
    HavocBattleTape,
  } from '@hoop-rush/data-contracts';
  import GamecastBattleBroadcast from '#lib/gamecast/GamecastBattleBroadcast.svelte';
  import GamecastBattleBox from '#lib/gamecast/GamecastBattleBox.svelte';
  import {
    gamecastBattleFeedLines,
    gamecastBattlePlaybackItems,
    gamecastBattleVisibleState,
  } from '#lib/gamecast/gamecast-battle-playback.js';
  import { gamecastBattleFinalBoxes } from '#lib/gamecast/gamecast-battle-view.js';

  let {
    input,
    result,
    tape,
    speed,
    kind,
    slot = null,
    localTeamId,
    oncomplete,
    onclose,
  }: {
    input: HavocBattleInput;
    result: HavocBattleResult;
    tape: HavocBattleTape;
    speed: 2 | 4;
    kind: 'h2h' | 'playoff' | 'review';
    slot?: number | null;
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
  const label = $derived(
    kind === 'h2h' ? 'Head-to-head' : kind === 'playoff' ? 'Playoff' : 'Game review',
  );
  const matchupLabel = $derived(slot === null ? label : `${label} · Game ${String(slot)}`);
  const boxes = $derived(gamecastBattleFinalBoxes(result));
  const localBox = $derived(boxes.find((box) => box.side === localSide));
  const opponentBox = $derived(boxes.find((box) => box.side !== localSide));
  const localWon = $derived((localBox?.score ?? 0) > (opponentBox?.score ?? 0));
  const recapDetail = $derived(
    kind === 'review'
      ? 'Review the final box score, then continue.'
      : kind === 'h2h'
        ? 'Both players must confirm this result. Continue when ready.'
        : 'Review the result, then continue.',
  );
</script>

{#if complete}
  <section
    class="flex flex-col gap-4 rounded-2xl border border-border border-t-[3px] border-t-primary bg-card p-4"
    aria-label={`${label} result`}
    data-cap-rush-broadcast={kind}
    data-complete="true"
  >
    <header class="flex flex-col items-center gap-1 text-center">
      <p class="font-mono text-[10px] tracking-[0.16em] text-primary uppercase">
        {matchupLabel} · Final
      </p>
      <h2 class="font-display text-2xl font-extrabold tracking-tight uppercase sm:text-3xl">
        {kind === 'review' ? 'Final' : localWon ? 'You win' : 'Opponent wins'}
      </h2>
      <p class="font-display text-5xl font-extrabold tabular-nums sm:text-6xl">
        <span class="text-primary">{localBox?.score ?? 0}</span>
        <span class="px-2 text-muted-foreground" aria-hidden="true">–</span>
        <span>{opponentBox?.score ?? 0}</span>
      </p>
      <p class="max-w-md text-xs leading-relaxed text-muted-foreground">{recapDetail}</p>
    </header>

    <GamecastBattleBox {boxes} {localSide} theme="duel" />

    <footer class="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onclick={oncomplete}
      >
        Continue
      </button>
    </footer>
  </section>
{:else}
  <section
    class="flex flex-col gap-4 rounded-2xl border border-border border-t-[3px] border-t-primary bg-card p-4"
    aria-label={`${label} broadcast`}
    data-cap-rush-broadcast={kind}
  >
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
          {matchupLabel} · {speed}×
        </p>
        <h2 class="font-display text-2xl font-extrabold uppercase tracking-tight">
          {result.home.displayName} vs {result.away.displayName}
        </h2>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="inline-flex min-h-9 items-center justify-center rounded-lg border border-border bg-surface-2 px-3 text-xs font-semibold"
          onclick={() => (playing = !playing)}
        >
          {playing ? 'Pause' : 'Resume'}
        </button>
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
  </section>
{/if}
