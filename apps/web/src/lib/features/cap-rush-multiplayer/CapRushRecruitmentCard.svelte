<script lang="ts">
  import type {
    CapRushMultiplayerAuction,
    CapRushMultiplayerMarketPlayer,
    CapRushMultiplayerSeatId,
  } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { bucketClass, bucketLabel, initialsOf } from '../cap-rush/cap-rush-presentation.js';
  import {
    auctionClock,
    exactMoney,
    lotState,
    positionLabel,
    seatLabelFor,
  } from './cap-rush-multiplayer-presentation.js';

  let {
    player,
    auction,
    localSeat,
    nowMs,
    art = null,
    pulse = false,
    extended = false,
  }: {
    player: CapRushMultiplayerMarketPlayer;
    auction: CapRushMultiplayerAuction | null;
    localSeat: CapRushMultiplayerSeatId;
    nowMs: number;
    art?: CapRushArt | null;
    pulse?: boolean;
    extended?: boolean;
  } = $props();

  const state = $derived(auction === null ? 'upcoming' : lotState(auction, localSeat));
  const offerDollars = $derived(auction?.leaderBidDollars ?? player.minimumBidDollars);
  const clock = $derived(auctionClock(auction, nowMs));
  const ownershipLabel = $derived(
    auction === null ? 'Status' : auction.status === 'closed' ? 'Result' : 'Leader',
  );
  const leaderText = $derived.by(() => {
    if (auction === null) return 'Not opened';
    if (auction.status === 'closed') {
      if (auction.winningSeat === null) return 'Unsold';
      return auction.winningSeat === localSeat ? 'Sold to you' : 'Sold to opponent';
    }
    return auction.leaderSeat === null ? 'No bids' : seatLabelFor(auction.leaderSeat, localSeat);
  });
  const face = $derived(art === null ? null : art.faceFor(player.source));
  const team = $derived(art === null ? null : art.teamFor(player.franchiseId));
  const initials = $derived(initialsOf(player.displayName));
</script>

<section
  class="flex flex-col gap-3 rounded-2xl border p-3 transition-colors duration-150 {auction?.status ===
  'open'
    ? 'border-border bg-card'
    : 'border-border bg-surface-1'}"
  aria-label={`Selected player: ${player.displayName}`}
  data-player-id={player.playerId}
  data-lot-state={state}
  data-selected="true"
>
  <div class="flex items-start gap-3">
    {#if face !== null && art !== null}
      <PlayerFace
        player={face}
        manifest={art.manifest}
        size="md"
        fallbackInitials={initials}
        eager
      />
    {:else}
      <span
        class="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-surface-3 font-display text-sm font-extrabold text-muted-foreground"
        aria-hidden="true">{initials}</span
      >
    {/if}
    <div class="min-w-0 flex-1">
      <p class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Selected lot · {positionLabel(player.position)}
      </p>
      <h3
        class="min-w-0 truncate font-display text-xl leading-tight font-extrabold uppercase tracking-tight"
      >
        {player.displayName}
      </h3>
      <p class="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[9px] text-muted-foreground">
        {#if team !== null && art !== null}
          <TeamLogo
            manifest={art.manifest}
            franchiseId={team.franchiseId}
            teamExternalId={team.teamExternalId}
            className="h-3.5 w-3.5"
          />
        {/if}
        <span class="truncate uppercase"
          >{team?.abbreviation ?? franchiseAbbreviation(player.franchiseId)} ·
          {player.seasonKey}</span
        >
      </p>
      <div class="mt-1 flex flex-wrap gap-1">
        <span
          class="rounded border px-1 py-0.5 font-mono text-[8px] font-bold tracking-[0.06em] uppercase {bucketClass(
            player.bucket,
          )}">{bucketLabel(player.bucket)}</span
        >
        <span
          class="rounded border border-line-soft bg-surface-1 px-1 py-0.5 font-mono text-[8px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
          >{player.position}</span
        >
      </div>
    </div>
    <div class="shrink-0 text-right">
      <p class="font-mono text-[8px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
        OVR
      </p>
      <p class="font-display text-3xl leading-none font-extrabold tabular-nums">
        {player.originalOverall}
      </p>
    </div>
  </div>

  <dl class="grid grid-cols-2 gap-2 border-t border-line-soft pt-2.5 sm:grid-cols-3">
    <div class="min-w-0 rounded-lg bg-surface-1 px-2 py-1.5">
      <dt class="font-mono text-[8px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
        {auction === null ? 'Minimum' : 'Current offer'}
      </dt>
      <dd class="mt-0.5 font-mono text-xs font-bold tabular-nums" class:offer-pulse={pulse}>
        {exactMoney(offerDollars)}
      </dd>
    </div>
    <div class="min-w-0 rounded-lg bg-surface-1 px-2 py-1.5">
      <dt class="font-mono text-[8px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
        {auction?.status === 'open' ? 'Lot closes in' : 'Lot status'}
      </dt>
      <dd
        class="mt-0.5 flex items-baseline gap-1 font-mono text-lg leading-none font-semibold tabular-nums"
        class:text-negative={clock.urgent}
      >
        <span>{clock.label}</span>
        {#if extended}
          <span class="font-mono text-[8px] font-bold uppercase text-accent">Extended</span>
        {/if}
      </dd>
    </div>
    <div class="col-span-2 min-w-0 rounded-lg bg-surface-1 px-2 py-1.5 sm:col-span-1">
      <dt class="font-mono text-[8px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
        {ownershipLabel}
      </dt>
      <dd class="mt-0.5 truncate text-xs font-semibold">{leaderText}</dd>
    </div>
  </dl>
</section>

<style>
  .offer-pulse {
    animation: offer-price 200ms ease-out;
  }
  @keyframes offer-price {
    0% {
      transform: scale(1);
    }
    40% {
      transform: scale(1.06);
      color: var(--color-accent);
    }
    100% {
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .offer-pulse {
      animation: none;
    }
  }
</style>
