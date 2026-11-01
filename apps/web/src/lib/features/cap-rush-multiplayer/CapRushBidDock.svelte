<script lang="ts">
  import type {
    CapRushMultiplayerAuction,
    CapRushMultiplayerMarketPlayer,
    CapRushMultiplayerSeatId,
  } from '@hoop-rush/data-contracts';
  import type { CapRushBidDraft } from './cap-rush-bid-draft.svelte.js';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { initialsOf } from '../cap-rush/cap-rush-presentation.js';
  import {
    clockLabel,
    money,
    lotState,
    remainingMs,
    seatLabelFor,
  } from './cap-rush-multiplayer-presentation.js';

  let {
    player,
    auction,
    localSeat,
    nowMs,
    art = null,
    draft,
    adjustable = false,
    proposedTotal,
    pending = false,
    pendingTotal = null,
    canSubmit = false,
    pendingNote = null,
    rejectedMessage = null,
    oncancelbid = null,
    cancelBusy = false,
    onopensheet,
    onsubmit,
  }: {
    player: CapRushMultiplayerMarketPlayer;
    auction: CapRushMultiplayerAuction | null;
    localSeat: CapRushMultiplayerSeatId;
    nowMs: number;
    art?: CapRushArt | null;
    draft: CapRushBidDraft;
    adjustable?: boolean;
    proposedTotal: number | null;
    pending?: boolean;
    pendingTotal?: number | null;
    canSubmit?: boolean;
    pendingNote?: string | null;
    rejectedMessage?: string | null;
    oncancelbid?: (() => void) | null;
    cancelBusy?: boolean;
    onopensheet: () => void;
    onsubmit: () => void;
  } = $props();

  const face = $derived(art === null ? null : art.faceFor(player.source));
  const initials = $derived(initialsOf(player.displayName));
  const offerDollars = $derived(auction?.leaderBidDollars ?? player.minimumBidDollars);
  const remaining = $derived(auction === null ? 0 : remainingMs(auction.endsAtIso, nowMs));
  const clockText = $derived(
    auction === null
      ? '—'
      : auction.status === 'open'
        ? remaining <= 0
          ? 'Pending'
          : clockLabel(remaining)
        : 'Closed',
  );
  const clockUrgent = $derived(auction?.status === 'open' && remaining <= 10_000);
  const clockLabelText = $derived(auction?.status === 'open' ? 'Closes' : 'Status');
  const leaderText = $derived.by(() => {
    if (auction === null) return 'Not opened';
    if (auction.status === 'closed') {
      if (auction.winningSeat === null) return 'Unsold';
      return auction.winningSeat === localSeat ? 'Sold to you' : 'Sold to opponent';
    }
    return auction.leaderSeat === null
      ? 'No bids'
      : `${seatLabelFor(auction.leaderSeat, localSeat)} lead`;
  });
</script>

<div
  class="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/90 md:hidden"
  data-player-id={player.playerId}
  data-lot-state={auction === null ? 'upcoming' : lotState(auction, localSeat)}
  data-selected="true"
>
  <div
    class="mx-auto flex w-full max-w-3xl flex-col gap-1.5 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
  >
    <button
      type="button"
      class="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-border bg-surface-1 px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open bid details for ${player.displayName}`}
      onclick={onopensheet}
    >
      {#if face !== null && art !== null}
        <PlayerFace
          player={face}
          manifest={art.manifest}
          size="sm"
          fallbackInitials={initials}
          eager
        />
      {:else}
        <span
          class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
          aria-hidden="true">{initials}</span
        >
      {/if}
      <span class="min-w-0 flex-1">
        <span class="block truncate font-display text-sm leading-tight font-extrabold"
          >{player.displayName}</span
        >
        <span class="block truncate font-mono text-[10px] text-muted-foreground">
          {leaderText} · {money(offerDollars)}
        </span>
      </span>
      <span class="shrink-0 text-right">
        <span class="block font-mono text-[8px] tracking-[0.08em] text-muted-foreground uppercase"
          >{clockLabelText}</span
        >
        <span
          class="block font-mono text-sm font-bold tabular-nums"
          class:text-negative={clockUrgent}>{clockText}</span
        >
      </span>
    </button>

    {#if adjustable}
      <div class="grid grid-cols-4 gap-1.5" aria-label="Adjust bid amount">
        {#each [{ delta: -100000, label: '?$100K' }, { delta: 100000, label: '+$100K' }, { delta: 500000, label: '+$500K' }, { delta: 1000000, label: '+$1M' }] as step (step.delta)}
          <button
            type="button"
            class="min-h-12 touch-manipulation rounded-xl border border-border bg-surface-2 px-1 font-mono text-xs font-bold tabular-nums outline-none hover:border-primary active:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            disabled={pending ||
              (step.delta < 0 &&
                (draft.proposedTotal ?? draft.minimumDollars) <= draft.minimumDollars)}
            onclick={() => draft.adjust(step.delta)}>{step.label}</button
          >
        {/each}
      </div>
    {/if}

    <div class="flex items-center gap-2">
      <button
        type="button"
        class="min-h-12 min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onclick={onopensheet}
      >
        <p class="font-mono text-[8px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          Your total ? tap amount to edit
        </p>
        {#if pending}
          <p
            class="truncate font-mono text-sm font-bold text-accent tabular-nums"
            aria-live="polite"
          >
            Placing bid… {pendingTotal === null ? '' : money(pendingTotal)}
          </p>
        {:else}
          <p class="truncate font-mono text-sm font-bold tabular-nums">
            {proposedTotal === null ? '—' : money(proposedTotal)}
          </p>
        {/if}
      </button>
      <button
        type="button"
        class="inline-flex min-h-12 min-w-24 shrink-0 items-center justify-center rounded-xl bg-primary px-3 font-display text-sm font-extrabold uppercase tracking-wide text-primary-foreground outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        disabled={pending}
        onclick={() => {
          if (canSubmit) onsubmit();
          else onopensheet();
        }}
      >
        {pending
          ? 'Placing…'
          : canSubmit
            ? `Bid ${proposedTotal === null ? '' : money(proposedTotal)}`
            : 'Review bid'}
      </button>
    </div>

    {#if auction?.status === 'open' && auction.leaderSeat === localSeat && oncancelbid !== null}
      <button
        type="button"
        class="min-h-11 w-full rounded-xl border border-border bg-surface-2 px-3 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        aria-label={`Cancel bid on ${player.displayName}`}
        disabled={cancelBusy || pending || remaining <= 0}
        onclick={oncancelbid}>Cancel bid</button
      >
    {/if}

    {#if pendingNote !== null && !pending}
      <p class="truncate text-[10px] font-semibold text-accent" aria-live="polite">{pendingNote}</p>
    {:else if rejectedMessage !== null && !pending}
      <p class="truncate text-[10px] font-semibold text-negative" aria-live="polite">
        {rejectedMessage}
      </p>
    {/if}
  </div>
</div>
