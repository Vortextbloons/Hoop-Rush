<script lang="ts">
  import type { SetProgressView } from './collection-progression-view.ts';

  let {
    views,
    title = 'Sets',
    blurb = 'Three four-card sets. Own every member to claim its one-time Exchange reward. Claiming never consumes or locks cards.',
    cardNameOf,
    busySetId = null,
    onClaim,
    onInspect,
  }: {
    views: SetProgressView[];
    title?: string;
    blurb?: string;
    cardNameOf: (cardId: string) => string;
    busySetId?: string | null;
    onClaim: (setId: string) => void;
    onInspect: (cardId: string) => void;
  } = $props();

  function formatExchange(amount: number): string {
    return amount.toLocaleString('en-US');
  }
</script>

<section
  aria-labelledby="collection-sets-heading"
  class="mt-6 rounded-2xl border border-border bg-card p-5"
>
  <h2 id="collection-sets-heading" class="font-display text-xl font-extrabold">{title}</h2>
  <p class="mt-1 text-sm text-muted-foreground">{blurb}</p>

  <ul class="mt-4 grid gap-4 lg:grid-cols-3">
    {#each views as view (view.setId)}
      {@const status = view.claimed ? 'Claimed' : view.complete ? 'Complete' : 'Incomplete'}
      <li class="flex min-w-0 flex-col rounded-xl bg-surface-2 p-4">
        <div class="flex items-start justify-between gap-2">
          <h3 class="font-display text-base font-extrabold">{view.title}</h3>
          <span
            class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide {view.claimed
              ? 'bg-surface-3 text-muted-foreground'
              : view.complete
                ? 'bg-positive/20 text-positive'
                : 'bg-surface-3 text-muted-foreground'}"
          >
            {status}
          </span>
        </div>
        <p class="mt-1 text-xs text-muted-foreground">{view.description}</p>
        <p class="mt-2 text-sm font-semibold tabular-nums">
          {view.ownedCount}/{view.requiredCount} owned
        </p>
        <ul class="mt-2 space-y-1 text-sm">
          {#each view.memberCardIds as cardId (cardId)}
            {@const owned = !view.missingCardIds.includes(cardId)}
            <li class="flex items-center justify-between gap-2">
              <span class="min-w-0 truncate {owned ? '' : 'text-muted-foreground'}">
                {cardNameOf(cardId)}
              </span>
              {#if owned}
                <span class="shrink-0 text-xs font-semibold text-positive">Owned</span>
              {:else}
                <button
                  type="button"
                  onclick={() => onInspect(cardId)}
                  class="min-h-11 shrink-0 rounded-lg bg-card px-3 py-1 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Inspect missing
                </button>
              {/if}
            </li>
          {/each}
        </ul>
        <p class="mt-3 text-sm">
          Reward:
          <strong class="tabular-nums">{formatExchange(view.amount)} {view.currency}</strong>
          <span class="block text-xs text-muted-foreground">One-time, granted once per set.</span>
        </p>
        {#if view.complete && !view.claimed}
          <button
            type="button"
            onclick={() => onClaim(view.setId)}
            disabled={busySetId !== null}
            class="mt-auto min-h-11 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-accent-foreground outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {busySetId === view.setId
              ? 'Claiming…'
              : `Claim ${formatExchange(view.amount)} ${view.currency}`}
          </button>
        {:else if view.claimed}
          <p class="mt-auto pt-3 text-xs text-muted-foreground">
            Claimed. Every member card stays owned and usable.
          </p>
        {:else}
          <p class="mt-auto pt-3 text-xs text-muted-foreground">
            Complete every member card to claim this reward. Inspect a missing card to target its
            player.
          </p>
        {/if}
      </li>
    {/each}
  </ul>
</section>
