<script lang="ts">
  import type { SeasonTradeNegotiation } from '@hoop-rush/data-contracts';
  import { humanizeTradeRejection } from '$lib/season/season-presentation';
  let {
    negotiation,
    inquiryAllowance = 3,
    exchangeMax = 3,
    commandError = null,
    playerNameOf = (id: string) => id,
    onAccept,
    onDecline,
    onRevision,
    onWalkAway,
    busy = false,
  }: {
    negotiation: SeasonTradeNegotiation | null;
    inquiryAllowance?: number;
    exchangeMax?: number;
    commandError?: string | null;
    playerNameOf?: (playerVersionId: string) => string;
    onAccept?: (inquiryId: string) => void;
    onDecline?: (inquiryId: string) => void;
    onRevision?: (inquiryId: string) => void;
    onWalkAway?: (inquiryId: string) => void;
    busy?: boolean;
  } = $props();

  const exchangeCount = $derived(negotiation?.exchangeCount ?? 0);
  const nextOfferNumber = $derived(Math.min(exchangeMax, exchangeCount + 1));
  const canAct = $derived(
    negotiation !== null &&
      (negotiation.status === 'active' || negotiation.status === 'countered') &&
      exchangeCount < exchangeMax,
  );
  const isFinal = $derived(
    negotiation?.status === 'accepted' ||
      negotiation?.status === 'declined' ||
      negotiation?.status === 'walked-away' ||
      negotiation?.status === 'expired',
  );
  const humanizedError = $derived(
    humanizeTradeRejection(commandError, {
      playerNameOf,
      tradeFit: { attemptNumber: exchangeCount },
    }),
  );
  let confirmWalkFor: string | null = $state(null);
  const confirmWalk = $derived(negotiation !== null && confirmWalkFor === negotiation.inquiryId);

  function accept(): void {
    if (negotiation === null || busy) return;
    onAccept?.(negotiation.inquiryId);
  }
  function revise(): void {
    if (negotiation === null || busy) return;
    onRevision?.(negotiation.inquiryId);
  }
  function walk(): void {
    if (negotiation === null || busy) return;
    if (!confirmWalk) {
      confirmWalkFor = negotiation.inquiryId;
      return;
    }
    confirmWalkFor = null;
    onWalkAway?.(negotiation.inquiryId);
  }
</script>

<section
  aria-labelledby="transcript-heading"
  class="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4"
  data-testid="negotiation-transcript"
>
  <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
    <h3 id="transcript-heading" class="text-sm font-bold uppercase tracking-tight">Negotiation</h3>
    {#if negotiation !== null}
      <span class="text-xs text-muted-foreground">Offer {nextOfferNumber} of {exchangeMax}</span>
    {:else}
      <span class="text-xs text-muted-foreground">No active talk — pick a team</span>
    {/if}
  </div>

  {#if negotiation === null}
    <p class="rounded-lg bg-surface-2 p-3 text-sm text-muted-foreground">
      Open a team from the board to begin. One talk at a time, up to three offers.
    </p>
  {:else}
    {#if exchangeCount === 1 && exchangeMax === 3}
      <p class="text-xs text-muted-foreground" role="status">Offer 2 of 3 — one more after this.</p>
    {:else if exchangeCount >= 2}
      <p class="text-xs text-muted-foreground" role="status">
        Offer {nextOfferNumber} of {exchangeMax}{nextOfferNumber >= exchangeMax
          ? ' — last chance.'
          : '.'}
      </p>
    {/if}

    {#if negotiation.latestRequestedChange !== null}
      <p class="rounded-lg bg-amber-500/10 p-2.5 text-sm">
        <span class="font-semibold">They asked:</span>
        {negotiation.latestRequestedChange}
      </p>
    {/if}

    {#if humanizedError !== null}
      <p
        role="alert"
        class="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm"
      >
        {humanizedError}
      </p>
    {/if}

    {#if isFinal}
      <p class="rounded-lg bg-surface-2 p-3 text-sm text-muted-foreground" role="status">
        {#if negotiation.status === 'accepted'}Accepted — rosters update at commit.{/if}
        {#if negotiation.status === 'declined'}Declined — you can open another talk if talks remain.{/if}
        {#if negotiation.status === 'walked-away'}You walked away — no penalty.{/if}
        {#if negotiation.status === 'expired'}Expired — window closed.{/if}
      </p>
    {:else if canAct}
      <div class="grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onclick={accept}
          disabled={busy}
          data-testid="negotiation-accept"
          class="inline-flex min-h-11 items-center justify-center rounded-lg bg-positive px-4 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          Accept
        </button>
        <button
          type="button"
          onclick={revise}
          disabled={busy}
          data-testid="negotiation-revise"
          class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          Revise
        </button>
        <button
          type="button"
          onclick={walk}
          disabled={busy}
          data-testid="negotiation-walkaway"
          class="inline-flex min-h-11 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 px-4 text-sm font-semibold text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          {confirmWalk ? 'Confirm walk away?' : 'Walk away'}
        </button>
      </div>
      {#if confirmWalk}
        <p class="text-xs text-muted-foreground" role="status">
          Walking away ends this talk with no penalty. Press Walk away again to confirm.
        </p>
      {/if}
    {:else if negotiation.status === 'draft'}
      <p class="text-sm text-muted-foreground">Draft — submit your first offer above.</p>
    {/if}

    <p class="sr-only" role="status">
      {#if negotiation !== null}Talk {negotiation.status} with {exchangeCount} offers{/if}
    </p>
  {/if}
</section>

<style>
  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none !important;
    }
  }
</style>
