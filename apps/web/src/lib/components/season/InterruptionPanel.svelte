<script lang="ts">import { Dialog } from 'bits-ui';
import { X } from '@lucide/svelte';
import { resolve } from '$app/paths';
import type { SeasonInvalidRosterInterruption, SeasonPendingBlockCandidate, } from '@hoop-rush/data-contracts';
import type { SeasonRunCommandError } from '$lib/season/season-hub-state';
import type { InfluenceSpendAffordance } from '$lib/season/season-influence-view';
let { interruption, pending, playerName, injuryPlayerName, rehabAffordances, balance, busy = false, commandError = null, onRehab, onForfeit, onResume, }: {
    interruption: SeasonInvalidRosterInterruption | null;
    pending: SeasonPendingBlockCandidate | null;
    playerName: (playerVersionId: string) => string;
    injuryPlayerName: (injuryId: string) => string;
    rehabAffordances: InfluenceSpendAffordance[];
    balance: number;
    busy?: boolean;
    commandError?: SeasonRunCommandError | null;
    onRehab: (affordance: InfluenceSpendAffordance) => void;
    onForfeit: () => void;
    onResume: () => void;
} = $props();
let forfeitOpen = $state(false);
const unavailablePlayers = $derived(interruption?.unavailablePlayerVersionIds ?? []);
const nextGameLabel = $derived(pending === null ? '' : `game ${pending.nextGameId}`);
</script>

<section
  aria-labelledby="interruption-heading"
  class="rounded-none border border-destructive/40 bg-destructive/10 p-4 sm:rounded-xl"
  data-season-interruption-panel
  role="alert"
>
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2
      id="interruption-heading"
      class="font-display text-base font-extrabold uppercase tracking-tight text-destructive"
    >
      Block paused — no legal five
    </h2>
    <span class="font-mono text-[10px] text-muted-foreground">
      block {pending === null ? '—' : pending.blockIndex + 1} of 9 · {nextGameLabel}
    </span>
  </div>
  <p class="mt-2 text-sm text-muted-foreground">
    The block stopped because your roster cannot field five legal players at the next game's tipoff
    from health availability. Nothing was accepted and nothing was lost — the completed games stay
    saved and the block resumes from {nextGameLabel} without replaying.
  </p>

  {#if unavailablePlayers.length > 0}
    <div class="mt-3">
      <p class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        Unavailable at the next tipoff
      </p>
      <ul class="mt-1 flex flex-wrap gap-1.5">
        {#each unavailablePlayers as playerVersionId (playerVersionId)}
          <li class="rounded-full bg-destructive/15 px-2 py-0.5 text-sm font-semibold">
            {playerName(playerVersionId)}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="mt-4 flex flex-col gap-2">
    <p class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
      Three ways forward
    </p>
    <ol class="flex flex-col gap-2 text-sm">
      <li class="rounded-lg bg-surface-2 p-3">
        <p class="font-semibold">1 · Repair the rotation</p>
        <p class="mt-1 text-muted-foreground">
          Move an available player into the rotation on the Rotation tab. The editor re-validates
          before the block can resume.
        </p>
        <a
          href={resolve('/season/run/team')}
          class="mt-2 inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
        >
          Open Rotation
          <span aria-hidden="true">&rarr;</span>
        </a>
      </li>
      <li class="rounded-lg bg-surface-2 p-3">
        <p class="font-semibold">2 · Risky rehab (2 Influence)</p>
        <p class="mt-1 text-muted-foreground">
          Speed one injured player back: 60% to cut one game off the recovery, 40% to lengthen it
          and open the recurrence window. Needs balance at or above −1.
        </p>
        {#if rehabAffordances.length === 0}
          <p class="mt-2 font-mono text-[10px] text-muted-foreground">
            No active injury is rehab-eligible right now.
          </p>
        {:else}
          <ul class="mt-2 flex flex-wrap gap-1.5">
            {#each rehabAffordances as affordance (affordance.injuryId)}
              <li>
                <button
                  type="button"
                  onclick={() => onRehab(affordance)}
                  disabled={!affordance.affordable || affordance.spent || busy}
                  class="rounded-lg bg-primary/15 px-3 py-1.5 text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Rehab {injuryPlayerName(affordance.injuryId ?? '')} · balance {balance}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </li>
      <li class="rounded-lg bg-surface-2 p-3">
        <p class="font-semibold">3 · Forfeit the next game</p>
        <p class="mt-1 text-muted-foreground">
          Officially forfeit {nextGameLabel} 2-0 with no player statistics, then the block checks the
          following game.
        </p>
        <button
          type="button"
          onclick={() => (forfeitOpen = true)}
          disabled={busy}
          class="mt-2 inline-flex items-center justify-center rounded-lg border border-destructive/50 px-3 py-1.5 text-sm font-semibold text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Forfeit {nextGameLabel}
        </button>
      </li>
    </ol>
  </div>

  {#if commandError !== null}
    <p role="alert" class="mt-3 rounded-lg border border-destructive/40 bg-surface-1 p-3 text-sm">
      {commandError.message}
    </p>
  {/if}

  <div class="mt-4 flex flex-wrap items-center gap-3">
    <button
      type="button"
      onclick={onResume}
      disabled={busy || pending === null}
      class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Resume block
    </button>
    <span class="font-mono text-[10px] text-muted-foreground">
      Resuming re-validates the pending block and simulates from {nextGameLabel} forward.
    </span>
  </div>

  <p class="sr-only" role="status" aria-live="polite">
    Block paused with an invalid roster at {nextGameLabel}. The pending block is preserved.
  </p>
</section>

<Dialog.Root
  open={forfeitOpen}
  onOpenChange={(open) => {
    if (!open) forfeitOpen = false;
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
    <Dialog.Content
      class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
    >
      <div class="flex items-start justify-between gap-3">
        <Dialog.Title class="font-display truncate text-lg font-extrabold tracking-tight uppercase">
          Forfeit {nextGameLabel}?
        </Dialog.Title>
        <Dialog.Close
          aria-label="Cancel"
          class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          <X class="h-4 w-4" />
        </Dialog.Close>
      </div>
      <p class="mt-2 text-sm text-muted-foreground">
        The game records as an official 2-0 forfeit with no player statistics. The block then checks
        the next game in block order; if your roster is still short of five, the pause repeats.
      </p>
      <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onclick={() => (forfeitOpen = false)}
          disabled={busy}
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={() => {
            forfeitOpen = false;
            onForfeit();
          }}
          disabled={busy}
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/50 px-4 py-2 text-sm font-semibold text-destructive transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Forfeit the game
        </button>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
