<script lang="ts">
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
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
    art = null,
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
    art?: CapRushArt | null;
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

{#snippet teamIdentity(side: 'home' | 'away')}
  {@const team = art?.teamFor(input[side].teamId) ?? null}
  <span
    class="inline-flex min-w-0 max-w-full flex-col items-center gap-1 text-center sm:flex-row sm:gap-2 sm:text-left"
  >
    {#if team !== null && art !== null}
      <TeamLogo
        manifest={art.manifest}
        franchiseId={team.franchiseId}
        teamExternalId={team.teamExternalId}
        className="h-7 w-7 shrink-0"
      />
    {/if}
    <span
      class="min-w-0 break-words"
      class:text-primary={side === localSide}
      style:color={side !== localSide ? 'hsl(212 90% 62%)' : undefined}
      >{input[side].displayName}</span
    >
  </span>
{/snippet}

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
      <div
        class="grid w-full min-w-0 grid-cols-2 items-center gap-3 sm:flex sm:flex-wrap sm:justify-center"
      >
        {@render teamIdentity(localSide)}
        <p
          class="order-last col-span-2 font-display text-5xl sm:order-none font-extrabold tabular-nums sm:text-6xl"
        >
          <span class="text-primary">{localBox?.score ?? 0}</span>
          <span class="px-2 text-muted-foreground" aria-hidden="true">–</span>
          <span style:color="hsl(212 90% 62%)">{opponentBox?.score ?? 0}</span>
        </p>
        {@render teamIdentity(localSide === 'home' ? 'away' : 'home')}
      </div>
      <p class="max-w-md text-xs leading-relaxed text-muted-foreground">{recapDetail}</p>
    </header>

    <GamecastBattleBox {teamIdentity} {boxes} {localSide} theme="duel" />

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
        <h2
          class="flex flex-wrap items-center gap-2 font-display text-2xl font-extrabold uppercase tracking-tight"
        >
          {@render teamIdentity(localSide)}
          <span class="text-muted-foreground">vs</span>
          {@render teamIdentity(localSide === 'home' ? 'away' : 'home')}
        </h2>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-surface-2 px-3 text-xs font-semibold"
          onclick={() => (playing = !playing)}
        >
          {playing ? 'Pause' : 'Resume'}
        </button>
        <button
          type="button"
          class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-surface-2 px-3 text-xs font-semibold"
          onclick={onclose}
        >
          Close
        </button>
      </div>
    </header>

    <GamecastBattleBroadcast
      {teamIdentity}
      theme="duel"
      {result}
      {visible}
      {feed}
      {progress}
      {localSide}
    />
  </section>
{/if}
