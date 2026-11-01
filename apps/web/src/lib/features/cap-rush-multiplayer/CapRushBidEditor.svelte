<script lang="ts">
  import type { Snippet } from 'svelte';
  import { CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS } from '@hoop-rush/data-contracts';
  import type { CapRushBidDraft } from './cap-rush-bid-draft.svelte.js';
  import { exactMoney, type BidQuickChoice } from './cap-rush-multiplayer-presentation.js';

  let {
    draft,
    minimum,
    choices,
    pending = false,
    pendingTotal = null,
    disabled = false,
    disabledReason = null,
    overHardLimit = false,
    onsubmit,
    children,
  }: {
    draft: CapRushBidDraft;
    minimum: number;
    choices: readonly BidQuickChoice[];
    pending?: boolean;
    pendingTotal?: number | null;
    disabled?: boolean;
    disabledReason?: string | null;
    overHardLimit?: boolean;
    onsubmit: (totalDollars: number) => void;
    children?: Snippet;
  } = $props();

  const proposed = $derived(draft.proposedTotal);
  const canSubmit = $derived(!disabled && !pending && draft.valid && !overHardLimit);

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!canSubmit) return;
    const total = draft.proposedTotal;
    if (total === null) return;
    onsubmit(total);
  }
</script>

<div class="flex flex-col gap-2">
  {#if disabled && disabledReason !== null}
    <p class="rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-[11px] leading-snug">
      {disabledReason}
    </p>
  {/if}

  <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
    {#each choices as choice (choice.totalDollars)}
      <button
        type="button"
        class="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl border px-1.5 py-1 text-center outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40
          {draft.proposedTotal === choice.totalDollars
          ? 'border-primary bg-primary/10'
          : 'border-border bg-surface-2 hover:border-line-strong'}"
        aria-label={`Set total to ${exactMoney(choice.totalDollars)} (${choice.hint})`}
        disabled={disabled || pending}
        onclick={() => draft.setTotal(choice.totalDollars)}
      >
        <span class="font-mono text-xs font-bold tabular-nums"
          >{exactMoney(choice.totalDollars)}</span
        >
        <span class="text-[9px] font-semibold tracking-wide text-muted-foreground uppercase"
          >{choice.hint}</span
        >
      </button>
    {/each}
  </div>

  <form class="flex flex-col gap-2" onsubmit={submit} novalidate>
    <label class="flex flex-col gap-1">
      <span class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
        >Total bid</span
      >
      <span
        class="flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-3 focus-within:ring-2 focus-within:ring-ring"
      >
        <span class="font-mono text-sm text-muted-foreground" aria-hidden="true">$</span>
        <input
          type="text"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
          enterkeyhint="send"
          class="min-w-0 flex-1 bg-transparent font-mono text-base tabular-nums outline-none disabled:opacity-50"
          value={draft.text}
          placeholder={exactMoney(minimum)}
          disabled={disabled || pending}
          oninput={(event) => draft.setText(event.currentTarget.value)}
        />
      </span>
    </label>

    {#if pending}
      <p class="text-[11px] font-semibold text-accent" aria-live="polite">
        Placing bid… {pendingTotal === null ? '' : exactMoney(pendingTotal)}
      </p>
    {:else if draft.empty}
      <p class="text-[11px] text-negative">Enter a total bid.</p>
    {:else if draft.malformed}
      <p class="text-[11px] text-negative">Enter whole dollars only, for example 12,500,000.</p>
    {:else if draft.stale && proposed !== null}
      <div
        class="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-2.5 py-1.5"
      >
        <p class="text-[11px] leading-snug">Next legal bid is {exactMoney(minimum)}.</p>
        <button
          type="button"
          class="inline-flex min-h-11 items-center rounded-lg border border-accent/50 bg-accent/10 px-2.5 text-[11px] font-bold text-accent outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onclick={() => draft.useMinimum()}
        >
          Use next bid {exactMoney(minimum)}
        </button>
      </div>
    {:else if overHardLimit}
      <p class="text-[11px] leading-snug text-negative">
        This total exceeds the {exactMoney(CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS)} hard limit.
      </p>
    {:else}
      <p class="text-[11px] text-muted-foreground">
        Bid total
        <span class="font-mono font-bold text-foreground tabular-nums"
          >{proposed === null ? '—' : exactMoney(proposed)}</span
        >
        · next legal bid {exactMoney(minimum)}
      </p>
    {/if}

    {@render children?.()}

    <div
      class="sticky bottom-0 z-10 -mx-1 bg-card px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:static md:pb-0"
    >
      <button
        type="submit"
        class="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-3 font-display text-sm font-extrabold uppercase tracking-wide text-primary-foreground outline-none transition-colors duration-150 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!canSubmit}
      >
        Place bid {proposed === null ? '' : exactMoney(proposed)}
      </button>
    </div>
  </form>
</div>
