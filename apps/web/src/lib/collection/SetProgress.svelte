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

  function progressPercentage(owned: number, required: number): number {
    if (required <= 0) return 0;
    return Math.round(Math.min((owned / required) * 100, 100));
  }
</script>

<section
  aria-labelledby="collection-sets-heading"
  class="ur-set-progress-book mt-6 rounded-2xl border border-border bg-card p-5"
>
  <h2 id="collection-sets-heading" class="font-display text-xl font-extrabold">{title}</h2>
  <p class="mt-1 text-sm text-muted-foreground">{blurb}</p>

  <ul class="mt-4 grid gap-4 lg:grid-cols-3">
    {#each views as view (view.setId)}
      {@const status = view.claimed ? 'Claimed' : view.complete ? 'Complete' : 'Incomplete'}
      <li class="ur-set-entry flex min-w-0 flex-col rounded-xl bg-surface-2 p-4">
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
        <div
          class="ur-set-meter"
          role="progressbar"
          aria-label={`${view.title} collection progress`}
          aria-valuemin="0"
          aria-valuemax={view.requiredCount}
          aria-valuenow={view.ownedCount}
          aria-valuetext={`${view.ownedCount} of ${view.requiredCount} cards owned`}
        >
          <span style={`width: ${progressPercentage(view.ownedCount, view.requiredCount)}%`}></span>
        </div>
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

<style>
  .ur-set-progress-book {
    border: 1px solid var(--ur-line);
    border-top: 3px solid var(--ur-ember);
    border-radius: 0;
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--ur-ember) 6%, transparent), transparent 42%),
      var(--ur-raised);
    padding: clamp(1rem, 2.5vw, 1.4rem);
  }

  .ur-set-progress-book > h2 {
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: clamp(1.4rem, 2.5vw, 1.8rem);
  }

  .ur-set-progress-book > p {
    color: var(--ur-muted);
  }

  .ur-set-entry {
    border-radius: 0;
    border: 1px solid var(--ur-line);
    border-top: 2px solid var(--ur-line-strong);
    background: var(--ur-bg);
    padding: 0.9rem;
  }

  .ur-set-entry h3 {
    color: var(--ur-paper);
    font-size: 1rem;
  }

  .ur-set-entry > p {
    color: var(--ur-muted);
  }

  .ur-set-entry > p strong {
    color: var(--ur-apex);
  }

  .ur-set-meter {
    height: 0.42rem;
    overflow: hidden;
    margin-top: 0.55rem;
    background: var(--ur-interrupt);
  }

  .ur-set-meter > span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, var(--ur-ember), var(--ur-apex));
    transition: width 180ms ease;
  }

  .ur-set-entry > ul {
    padding-block: 0.2rem;
  }

  .ur-set-entry > ul li {
    min-height: 2rem;
    border-bottom: 1px solid var(--ur-line);
    padding-block: 0.35rem;
  }

  .ur-set-entry > ul li > button {
    border-radius: 0;
    background: var(--ur-surface);
    color: var(--ur-paper);
  }

  .ur-set-entry > button {
    border-radius: 0;
    background: var(--ur-accent);
    color: var(--ur-accent-foreground);
  }

  @media (prefers-reduced-motion: reduce) {
    .ur-set-meter > span {
      transition: none;
    }
  }
</style>
