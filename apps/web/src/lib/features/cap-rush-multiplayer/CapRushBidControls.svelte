<script lang="ts">
  import { CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS } from '@hoop-rush/data-contracts';
  import { money } from './cap-rush-multiplayer-presentation.js';

  let {
    minimum,
    currentBid = null,
    disabled = false,
    onbid,
  }: {
    minimum: number;
    currentBid?: number | null;
    disabled?: boolean;
    onbid: (totalDollars: number) => void;
  } = $props();

  let amount: number = $state(minimum);

  function submit(value: number) {
    if (disabled) return;
    onbid(Math.trunc(value));
  }

  const quick = $derived([
    { label: `Bid ${money(minimum)}`, value: minimum },
    {
      label: '+$100K',
      value:
        (currentBid ?? minimum - CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS) +
        CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS,
    },
    {
      label: '+$500K',
      value:
        (currentBid ?? minimum - CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS) +
        5 * CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS,
    },
    {
      label: '+$1M',
      value:
        (currentBid ?? minimum - CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS) +
        10 * CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS,
    },
  ]);
</script>

<div class="flex flex-col gap-2">
  <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {#each quick as entry (entry.label)}
      <button
        type="button"
        class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-3 text-sm font-bold text-primary
          disabled:opacity-40"
        {disabled}
        onclick={() => submit(entry.value)}
      >
        {entry.label}
      </button>
    {/each}
  </div>
  <div class="flex flex-col gap-2 sm:flex-row">
    <label
      class="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3"
    >
      <span class="text-xs text-muted-foreground">Custom</span>
      <input
        type="number"
        class="min-w-0 flex-1 bg-transparent font-mono text-sm tabular-nums outline-none"
        min={minimum}
        step={CAP_RUSH_MULTIPLAYER_BID_INCREMENT_DOLLARS}
        bind:value={amount}
        {disabled}
      />
    </label>
    <button
      type="button"
      class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface-2 px-4 text-sm font-semibold
        disabled:opacity-40"
      disabled={disabled || amount < minimum}
      onclick={() => submit(amount)}
    >
      Place custom bid
    </button>
  </div>
  <p class="text-[11px] text-muted-foreground">
    Next legal bid is {money(minimum)}. Every raise is at least $100,000.
  </p>
</div>
