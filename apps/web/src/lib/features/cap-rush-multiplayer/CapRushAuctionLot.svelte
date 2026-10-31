<script lang="ts">
  import type {
    CapRushMultiplayerAuction,
    CapRushMultiplayerMarketPlayer,
    CapRushMultiplayerSeatId,
  } from '@hoop-rush/data-contracts';
  import {
    auctionProgress,
    clockLabel,
    lotState,
    lotStateLabel,
    money,
    remainingMs,
    seatLabelFor,
  } from './cap-rush-multiplayer-presentation.js';

  let {
    auction,
    player,
    localSeat,
    nowMs,
    selected = false,
    disabled = false,
    onselect,
  }: {
    auction: CapRushMultiplayerAuction;
    player: CapRushMultiplayerMarketPlayer;
    localSeat: CapRushMultiplayerSeatId;
    nowMs: number;
    selected?: boolean;
    disabled?: boolean;
    onselect: (playerId: string) => void;
  } = $props();

  const state = $derived(lotState(auction, localSeat));
  const progress = $derived(auctionProgress(auction, nowMs));
  const seconds = $derived(remainingMs(auction.endsAtIso, nowMs));
  const leaderLabel = $derived(
    auction.leaderSeat === null ? null : seatLabelFor(auction.leaderSeat, localSeat),
  );
</script>

<button
  type="button"
  class="group relative flex min-h-32 flex-col gap-2 overflow-hidden rounded-xl border bg-card p-3 text-left transition
    {selected ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-line-strong'}
    {state === 'sold-to-you' ? 'border-positive/50' : ''}
    {state === 'you-lead' ? 'border-accent/60' : ''}
    {disabled ? 'opacity-70' : ''}"
  aria-pressed={selected}
  {disabled}
  onclick={() => onselect(auction.playerId)}
>
  <span
    class="absolute inset-x-0 top-0 h-1 transition-[width] duration-300
      {seconds <= 10_000 && auction.status === 'open' ? 'bg-negative' : 'bg-primary/70'}"
    style:width={`${Math.round(progress * 100)}%`}
  ></span>
  <div class="flex items-start justify-between gap-2 pt-1">
    <span class="font-display text-lg font-bold uppercase leading-tight tracking-tight">
      {player.displayName}
    </span>
    <span class="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums">
      {player.originalOverall}
    </span>
  </div>
  <div
    class="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
  >
    <span>{player.bucket}</span>
    <span aria-hidden="true">·</span>
    <span>{player.seasonKey}</span>
  </div>
  <div class="mt-auto flex items-end justify-between gap-2">
    <div class="flex flex-col">
      <span class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
        >Min</span
      >
      <span class="font-mono text-sm font-semibold tabular-nums">
        {money(player.minimumBidDollars)}
      </span>
    </div>
    <div class="flex flex-col items-end">
      <span class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {lotStateLabel(state)}
      </span>
      <span class="font-mono text-sm font-semibold tabular-nums">
        {auction.leaderBidDollars === null ? '—' : money(auction.leaderBidDollars)}
      </span>
    </div>
  </div>
  {#if auction.status === 'open'}
    <div class="flex items-center justify-between text-[10px] text-muted-foreground">
      <span>{leaderLabel === null ? 'Open' : `${leaderLabel} leads`}</span>
      <span class="font-mono tabular-nums">{clockLabel(seconds)}</span>
    </div>
  {:else}
    <div class="text-[10px] text-muted-foreground">Closed</div>
  {/if}
</button>
