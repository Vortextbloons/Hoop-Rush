<script lang="ts">
  import type { LockPreview } from '$lib/season/season-lock-preview';

  let {
    preview,
    franchiseName,
  }: {
    preview: LockPreview;
    franchiseName: (franchiseId: string) => string;
  } = $props();

  const gamesLabel = $derived(
    preview.gamesToLock === 1 ? 'the next game' : `the next ${String(preview.gamesToLock)} games`,
  );
</script>

<section
  aria-labelledby="lock-preview-heading"
  class="rounded-xl border border-border bg-surface-1 p-4"
>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2
      id="lock-preview-heading"
      class="font-display text-base font-extrabold uppercase tracking-tight"
    >
      What changed?
    </h2>
    <span
      class="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
    >
      No rewind once the block begins
    </span>
  </div>

  <p class="mt-2 text-sm text-muted-foreground">
    Submitting locks the rotation set for <strong class="text-foreground">{gamesLabel}</strong>
    (rounds {preview.roundRange.fromRound}–{preview.roundRange.toRound}). There is no rewind after
    the block begins.
  </p>

  {#if preview.unchangedSinceLastLock}
    <p class="mt-2 rounded-lg bg-surface-2 p-3 text-sm">
      <strong class="text-foreground">No rotation changes</strong> since the last checkpoint — this submission
      locks the same rotation set.
    </p>
  {:else if preview.changes.length === 0}
    <p class="mt-2 rounded-lg bg-surface-2 p-3 text-sm">
      No rotation changes from the saved baseline.
    </p>
  {:else}
    <p class="mt-2 text-sm text-muted-foreground">
      {preview.changes.length} rotation change{preview.changes.length === 1 ? '' : 's'} since the saved
      baseline:
    </p>
    <ul class="mt-2 flex flex-col divide-y divide-border/60">
      {#each preview.changes as change (change.playerVersionId)}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <span class="min-w-0 flex-1 truncate font-semibold">{change.displayName}</span>
          <span class="font-mono text-[10px] text-muted-foreground">
            {change.roleBefore} ·
            {#if change.minutesBefore !== null}{change.minutesBefore}{:else}—{/if} min
          </span>
          <span class="text-muted-foreground" aria-hidden="true">&rarr;</span>
          <span class="font-mono text-[10px]">
            {change.roleAfter} ·
            {#if change.minutesAfter !== null}{change.minutesAfter}{:else}—{/if} min
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  <h3
    class="mt-4 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
  >
    Upcoming human games in this block
  </h3>
  {#if preview.upcomingGames.length === 0}
    <p class="mt-1 text-sm text-muted-foreground">None scheduled.</p>
  {:else}
    <ol class="mt-1 flex flex-col gap-1">
      {#each preview.upcomingGames as game (game.gameId)}
        <li class="flex flex-wrap items-center gap-2 text-sm">
          <span class="w-14 shrink-0 font-mono text-[10px] text-muted-foreground">
            R{game.round}
          </span>
          <span class="min-w-0 flex-1 truncate">
            {game.humanIsHome ? 'vs' : 'at'}
            {franchiseName(game.opponentFranchiseId)}
          </span>
        </li>
      {/each}
    </ol>
  {/if}
</section>
