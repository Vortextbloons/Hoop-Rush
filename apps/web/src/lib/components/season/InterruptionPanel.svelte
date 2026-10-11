<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import { resolve } from '$app/paths';
  import type {
    SeasonInvalidRosterInterruption,
    SeasonPendingBlockCandidate,
  } from '@hoop-rush/data-contracts';
  import type { SeasonRunCommandError } from '$lib/season/season-hub-state';
  import type { InfluenceSpendAffordance } from '$lib/season/season-influence-view';
  let {
    interruption,
    pending,
    playerName,
    injuryPlayerName,
    rehabAffordances,
    balance,
    busy = false,
    commandError = null,
    onRehab,
    onForfeit,
    onResume,
  }: {
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
</script>

<section
  aria-labelledby="interruption-heading"
  class="sr-panel-featured p-4 sm:p-5"
  data-season-interruption-panel
  role="alert"
>
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2
      id="interruption-heading"
      class="font-display text-base font-extrabold uppercase tracking-tight text-destructive"
    >
      Not enough healthy players
    </h2>
    <span class="sr-badge" data-tone="warn">
      Block {pending === null ? '—' : pending.blockIndex + 1} of 9
    </span>
  </div>
  <p class="mt-2 text-sm text-muted-foreground">
    You don’t have 5 healthy players for the next game. Played games still count — fix your lineup
    and pick up where you stopped.
  </p>

  {#if unavailablePlayers.length > 0}
    <div class="mt-3">
      <p class="sr-section-label">Out for the next game</p>
      <ul class="mt-1 flex flex-wrap gap-1.5">
        {#each unavailablePlayers as playerVersionId (playerVersionId)}
          <li class="sr-badge" data-tone="loss">
            {playerName(playerVersionId)}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="mt-4 flex flex-col gap-2">
    <p class="sr-section-label">Your options</p>
    <ol class="flex flex-col gap-2 text-sm">
      <li class="sr-panel-quiet p-3">
        <p class="font-semibold">Fix your lineup</p>
        <p class="mt-1 text-muted-foreground">Swap a healthy player in on the Rotation tab.</p>
        <a
          href={resolve('/season/run/team')}
          class="mt-2 inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
        >
          Open Rotation
          <span aria-hidden="true">&rarr;</span>
        </a>
      </li>
      <li class="sr-panel-quiet p-3">
        <p class="text-xs font-semibold">
          {#if rehabAffordances.length > 0 && rehabAffordances[0] !== undefined}
            Try rehab ({rehabAffordances[0].cost}◆)
          {:else}
            Try rehab
          {/if}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">Chance sooner, can set back.</p>
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
                  class="min-h-11 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Bring back {injuryPlayerName(affordance.injuryId ?? '')} ({affordance.cost}◆)
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </li>
      <li class="sr-panel-quiet p-3">
        <p class="font-semibold">Skip the game (loss)</p>
        <p class="mt-1 text-muted-foreground">Take the loss and move to the next game.</p>
        <button
          type="button"
          onclick={() => (forfeitOpen = true)}
          disabled={busy}
          class="mt-2 inline-flex min-h-11 items-center justify-center rounded-lg border border-destructive/50 px-3 py-1.5 text-sm font-semibold text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Skip game
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
    <button type="button" onclick={onResume} disabled={busy || pending === null} class="sr-btn">
      Play on
    </button>
    <span class="sr-section-label"> Picks up where you stopped. </span>
  </div>

  <p class="sr-only" role="status" aria-live="polite">
    Not enough healthy players. Fix your lineup to play on.
  </p>
</section>

<Dialog.Root bind:open={forfeitOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="sr-dialog-overlay" />
    <Dialog.Content
      class="sr-dialog w-[min(28rem,calc(100vw_-_1.5rem))] max-h-[85dvh] overflow-y-auto p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] outline-none sm:p-5"
    >
      <div class="flex items-start justify-between gap-3">
        <Dialog.Title
          class="font-display truncate text-lg font-extrabold tracking-tight uppercase text-foreground"
        >
          Skip this game?
        </Dialog.Title>
        <Dialog.Close
          aria-label="Cancel"
          class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
        >
          <X class="h-4 w-4" />
        </Dialog.Close>
      </div>
      <p class="mt-2 text-sm text-muted-foreground">
        It counts as a loss and the block moves to the next game.
      </p>
      <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onclick={() => (forfeitOpen = false)}
          disabled={busy}
          class="sr-btn-ghost"
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
          class="sr-btn-danger"
        >
          Skip game
        </button>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
