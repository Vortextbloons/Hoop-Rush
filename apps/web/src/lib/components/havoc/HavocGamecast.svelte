<script lang="ts">
  import { Pause, Play } from '@lucide/svelte';
  import type {
    HavocGamecastState,
    HavocPlaybackSpeed,
  } from '$lib/havoc/havoc-gamecast-state.svelte';
  import {
    formatHavocClock,
    havocParticipantKindLabel,
    havocPeriodLabel,
  } from './havoc-presentation';
  import HavocMutationBadge from './HavocMutationBadge.svelte';

  let {
    state,
    onAccept,
    onClose,
  }: {
    state: HavocGamecastState;
    onAccept: () => void;
    onClose: () => void;
  } = $props();

  const speeds: HavocPlaybackSpeed[] = [1, 2, 4, 8];
  const visible = $derived(state.visibleItems());
  const feed = $derived(visible.slice(-24).reverse());
  const lines = $derived(state.liveLines());
  const finished = $derived(state.finished);
  const statusLabel = $derived(
    finished ? 'Final' : state.playing ? 'Playing' : state.cursor === 0 ? 'Ready' : 'Paused',
  );
</script>

<section
  aria-labelledby="havoc-gamecast-heading"
  class="min-w-0 rounded-xl bg-surface-1"
  data-havoc-gamecast
>
  <header
    class="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3"
  >
    <div class="min-w-0">
      <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
        Hoop Havoc Gamecast · {state.session.variant === 'havoc' ? 'Mutated' : 'Normal'}
      </p>
      <h2
        id="havoc-gamecast-heading"
        class="font-display text-xl font-extrabold tracking-tight uppercase"
      >
        Game {state.session.gameNumber} of 82
      </h2>
    </div>
    <span
      class="rounded-full border border-border px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.12em] uppercase"
      data-havoc-gamecast-status
    >
      {statusLabel}
    </span>
  </header>

  <div class="grid grid-cols-2 gap-px bg-border" aria-live="polite">
    <div class="bg-surface-2 p-4">
      <p
        class="truncate font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
      >
        {state.humanName}
      </p>
      <p class="font-display text-4xl font-black tabular-nums" data-score="human">
        {state.humanScore}
      </p>
    </div>
    <div class="bg-surface-2 p-4 text-right">
      <p
        class="truncate font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
      >
        {state.opponentName}
      </p>
      <p class="font-display text-4xl font-black tabular-nums" data-score="opponent">
        {state.opponentScore}
      </p>
    </div>
  </div>

  <div
    class="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3"
  >
    <p class="font-mono text-xs text-muted-foreground" data-havoc-gamecast-clock>
      {havocPeriodLabel(state.period)} · {formatHavocClock(state.clockSeconds)} ·
      {visible.length} of {state.items.length} plays
    </p>
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-havoc-playback-toggle
        onclick={() => (state.playing ? state.pause() : state.play())}
        disabled={finished}
        class="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
      >
        {#if state.playing}
          <Pause class="h-4 w-4" aria-hidden="true" /> Pause
        {:else}
          <Play class="h-4 w-4" aria-hidden="true" /> Play
        {/if}
      </button>
      <div
        class="inline-flex rounded-lg border border-border p-0.5"
        role="group"
        aria-label="Playback speed"
      >
        {#each speeds as speed (speed)}
          <button
            type="button"
            data-havoc-speed={speed}
            aria-pressed={state.speed === speed}
            onclick={() => state.setSpeed(speed)}
            class="min-h-9 rounded-md px-2 py-1 font-mono text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring {state.speed ===
            speed
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground'}"
          >
            {speed}×
          </button>
        {/each}
      </div>
    </div>
  </div>

  <p class="sr-only" aria-live="polite" data-havoc-gamecast-announcement>{state.announcement}</p>

  <div class="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
    <div class="min-w-0">
      <h3 class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Play feed
      </h3>
      {#if feed.length === 0}
        <p class="mt-2 text-xs text-muted-foreground">Press play to run the tape.</p>
      {:else}
        <ol
          class="mt-2 flex max-h-96 flex-col gap-1.5 overflow-y-auto pr-1"
          data-havoc-gamecast-feed
        >
          {#each feed as item (item.key)}
            <li class="rounded-lg bg-surface-2 px-2.5 py-1.5" data-havoc-feed-item={item.kind}>
              <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                <span class="font-mono text-[10px] text-muted-foreground">
                  {havocPeriodLabel(item.period)}
                  {item.clockSeconds}s
                </span>
                {#if item.mutationId !== null}
                  <HavocMutationBadge mutationId={item.mutationId} />
                {/if}
              </div>
              <p class="mt-0.5 text-xs leading-snug">{item.text}</p>
            </li>
          {/each}
        </ol>
      {/if}
    </div>

    <div class="min-w-0">
      <h3 class="font-mono text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Live lines
      </h3>
      <div class="mt-2 overflow-x-auto">
        <table class="w-full min-w-[34rem] text-xs" data-havoc-gamecast-box>
          <thead>
            <tr
              class="border-b border-border/70 font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase"
            >
              <th scope="col" class="px-2 py-1.5 text-left font-medium">Player</th>
              <th scope="col" class="px-2 py-1.5 text-left font-medium">Role</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">Pts</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">FG</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">FT</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">Reb</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">Ast</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">Stl</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">Blk</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">TO</th>
              <th scope="col" class="px-2 py-1.5 text-right font-medium">PF</th>
            </tr>
          </thead>
          <tbody>
            {#each lines as line (line.instanceId)}
              <tr class="border-b border-border/40" data-havoc-line={line.kind}>
                <th scope="row" class="max-w-40 truncate px-2 py-1.5 text-left font-semibold">
                  {line.displayName}
                </th>
                <td class="px-2 py-1.5 text-muted-foreground">
                  {havocParticipantKindLabel(line.kind)}
                </td>
                <td class="px-2 py-1.5 text-right font-mono font-bold">{line.points}</td>
                <td class="px-2 py-1.5 text-right font-mono">
                  {line.fieldGoalsMade}/{line.fieldGoalsAttempted}
                </td>
                <td class="px-2 py-1.5 text-right font-mono">
                  {line.freeThrowsMade}/{line.freeThrowsAttempted}
                </td>
                <td class="px-2 py-1.5 text-right font-mono">{line.rebounds}</td>
                <td class="px-2 py-1.5 text-right font-mono">{line.assists}</td>
                <td class="px-2 py-1.5 text-right font-mono">{line.steals}</td>
                <td class="px-2 py-1.5 text-right font-mono">{line.blocks}</td>
                <td class="px-2 py-1.5 text-right font-mono">{line.turnovers}</td>
                <td class="px-2 py-1.5 text-right font-mono">{line.fouls}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  {#if state.error !== null}
    <p
      role="alert"
      class="mx-4 mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
    >
      {state.error}
    </p>
  {/if}

  <footer
    class="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-4 py-3"
  >
    <button
      type="button"
      data-havoc-gamecast-close
      onclick={onClose}
      class="inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      Back to hub
    </button>
    {#if finished}
      <button
        type="button"
        data-havoc-gamecast-accept
        onclick={onAccept}
        disabled={state.accepted || state.accepting}
        class="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state.accepted
          ? 'Result accepted'
          : state.accepting
            ? 'Accepting…'
            : 'Add result to record'}
      </button>
    {/if}
  </footer>
</section>
