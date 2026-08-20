<script lang="ts">
  import type { SeasonTradeNegotiation } from '@hoop-rush/data-contracts';
  import { responseCauseLabel } from '$lib/season/season-presentation';

  let {
    negotiation,
    inquiryAllowance,
    exchangeMax = 3,
    onAccept,
    onDecline,
    onRevision, // human revision callback payload builder is external; this button opens builder again?
    onWalkAway,
    busy = false,
  }: {
    negotiation: SeasonTradeNegotiation | null;
    inquiryAllowance: number;
    exchangeMax?: number;
    onAccept?: (inquiryId: string) => void;
    onDecline?: (inquiryId: string) => void;
    onRevision?: (inquiryId: string) => void;
    onWalkAway?: (inquiryId: string) => void;
    busy?: boolean;
  } = $props();

  const exchanges = $derived(negotiation?.exchanges ?? []);
  const exchangeCount = $derived(negotiation?.exchangeCount ?? 0);
  const canAct = $derived(negotiation !== null && (negotiation.status === 'active' || negotiation.status === 'countered') && exchangeCount < exchangeMax);
  const isFinal = $derived(negotiation?.status === 'accepted' || negotiation?.status === 'declined' || negotiation?.status === 'walked-away' || negotiation?.status === 'expired');

  function kindLabel(kind: string): string {
    switch (kind) {
      case 'human-proposal':
        return 'You proposed';
      case 'ai-counter':
        return 'They countered';
      case 'human-revision':
        return 'You revised';
      case 'ai-final':
        return 'Final';
      default:
        return kind;
    }
  }
</script>

<section aria-labelledby="transcript-heading" class="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4" data-testid="negotiation-transcript">
  <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
    <h3 id="transcript-heading" class="font-display text-sm font-extrabold uppercase tracking-tight">Negotiation</h3>
    {#if negotiation !== null}
      <span class="font-mono text-[10px] text-muted-foreground">
        {exchangeCount}/{exchangeMax} exchanges · {inquiryAllowance} inquiry cap · {negotiation.status}
      </span>
    {:else}
      <span class="font-mono text-[10px] text-muted-foreground">No active inquiry — pick a team to start</span>
    {/if}
  </div>

  {#if negotiation === null}
    <p class="rounded-lg bg-surface-2 p-3 text-sm text-muted-foreground">Open a team from the board to begin. One active negotiation at a time, up to three exchanges. Walk-away has no penalty; history is preserved after the window closes.</p>
  {:else}
    <ol class="flex flex-col gap-2" aria-label="Negotiation exchanges">
      {#each exchanges as ex (ex.exchangeIndex)}
        <li class="flex gap-3 rounded-lg border border-border bg-card p-3">
          <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-3 font-mono text-xs font-bold">{ex.exchangeIndex}</span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold">{kindLabel(ex.kind)} {#if ex.responseCause !== null}· <span class="font-mono text-xs {ex.responseCause === 'acceptable' ? 'text-positive' : ex.responseCause === 'close-needs-more-value' ? 'text-amber-600 dark:text-amber-400' : 'text-destructive'}">{responseCauseLabel(ex.responseCause)}</span>{/if}</p>
            {#if ex.proposalFingerprint !== null}
              <p class="mt-1 font-mono text-[10px] text-muted-foreground">Fingerprint {ex.proposalFingerprint.slice(0, 16)}… · at revision {ex.atStateRevision}</p>
            {/if}
            {#if ex.proposalId !== null}
              <p class="font-mono text-[10px] text-muted-foreground">{ex.proposalId}</p>
            {/if}
          </div>
        </li>
      {/each}
    </ol>

    {#if negotiation.latestRequestedChange !== null}
      <p class="rounded-lg bg-amber-500/10 p-2.5 text-sm"><span class="font-semibold">They asked:</span> {negotiation.latestRequestedChange}</p>
    {/if}

    {#if negotiation.finalReason !== null}
      <p class="rounded-lg border p-2.5 text-sm {negotiation.finalReason === 'acceptable' ? 'border-positive/30 bg-positive/10 text-positive' : 'border-destructive/30 bg-destructive/10 text-destructive'}">
        Final: {responseCauseLabel(negotiation.finalReason)}
      </p>
    {/if}

    {#if negotiation.expressedInterests.length > 0}
      <div class="rounded-lg bg-surface-2 p-3">
        <p class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Expressed interests</p>
        <ul class="mt-1 flex flex-wrap gap-1.5">
          {#each negotiation.expressedInterests as interest (interest)}
            <li class="rounded-full bg-card border border-border px-2.5 py-1 text-xs">{interest}</li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if negotiation.rejectedPlayerVersionIds.length > 0}
      <p class="font-mono text-[10px] text-muted-foreground">Rejected players: {negotiation.rejectedPlayerVersionIds.join(' · ')}</p>
    {/if}

    {#if isFinal}
      <p class="rounded-lg bg-surface-2 p-3 text-sm text-muted-foreground" role="status" aria-live="polite">
        {#if negotiation.status === 'accepted'}Accepted — ownership will transfer and rotations will repair at commit. Announcement does not move focus.{/if}
        {#if negotiation.status === 'declined'}Declined — walk-away has no penalty. You can open another inquiry if cap remains.{/if}
        {#if negotiation.status === 'walked-away'}You walked away — no penalty. History preserved for this window.{/if}
        {#if negotiation.status === 'expired'}Expired — window closed. History remains browseable.{/if}
      </p>
    {:else if canAct}
      <div class="grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onclick={() => onAccept?.(negotiation.inquiryId)}
          disabled={busy}
          data-testid="negotiation-accept"
          class="inline-flex h-11 items-center justify-center rounded-lg bg-positive px-4 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:opacity-40"
        >
          Accept
        </button>
        <button
          type="button"
          onclick={() => onRevision?.(negotiation.inquiryId)}
          disabled={busy || exchangeCount >= 2}
          data-testid="negotiation-revise"
          class="inline-flex h-11 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-surface-2 disabled:opacity-40"
        >
          Revise (1 left)
        </button>
        <button
          type="button"
          onclick={() => onWalkAway?.(negotiation.inquiryId)}
          disabled={busy}
          data-testid="negotiation-walkaway"
          class="inline-flex h-11 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 px-4 text-sm font-semibold text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-destructive/15 disabled:opacity-40"
        >
          Walk away
        </button>
      </div>
      <p class="font-mono text-[10px] text-muted-foreground">3 exchanges total: 1 initial, 2 counter, 3 final accept/revision/walk-away. Duplicate fingerprint rejects do not increment.</p>
    {:else if negotiation.status === 'draft'}
      <p class="text-sm text-muted-foreground">Draft — submit your first proposal above. That consumes the inquiry.</p>
    {/if}

    <p class="sr-only" role="status" aria-live="polite">
      {#if negotiation !== null}Negotiation {negotiation.inquiryId.slice(0, 8)} {negotiation.status} with {exchangeCount} exchanges{/if}
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
