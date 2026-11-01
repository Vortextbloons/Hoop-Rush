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
    clockLabel,
    exactMoney,
    lotState,
    lotStateLabel,
    money,
    remainingMs,
    seatLabelFor,
  } from './cap-rush-multiplayer-presentation.js';

  let {
    player,
    auction,
    localSeat,
    nowMs,
    selected = false,
    art = null,
    pulse = false,
    extended = false,
    onselect,
  }: {
    player: CapRushMultiplayerMarketPlayer;
    auction: CapRushMultiplayerAuction | null;
    localSeat: CapRushMultiplayerSeatId;
    nowMs: number;
    selected?: boolean;
    art?: CapRushArt | null;
    pulse?: boolean;
    extended?: boolean;
    onselect: (playerId: string) => void;
  } = $props();

  const state = $derived(auction === null ? 'upcoming' : lotState(auction, localSeat));
  const stateLabel = $derived(
    auction === null ? 'Upcoming' : lotStateLabel(lotState(auction, localSeat)),
  );
  const offerDollars = $derived(auction?.leaderBidDollars ?? player.minimumBidDollars);
  const offerLabel = $derived(
    auction?.leaderBidDollars === null || auction === null ? 'Min' : 'Offer',
  );
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
  const leaderText = $derived.by(() => {
    if (auction === null) return 'Not opened';
    if (auction.status === 'closed') {
      return auction.winningSeat === null
        ? 'Unsold'
        : `${seatLabelFor(auction.winningSeat, localSeat)} won`;
    }
    return auction.leaderSeat === null
      ? 'No bids yet'
      : `${seatLabelFor(auction.leaderSeat, localSeat)} leads`;
  });
  const face = $derived(art === null ? null : art.faceFor(player.source));
  const team = $derived(art === null ? null : art.teamFor(player.franchiseId));
  const initials = $derived(initialsOf(player.displayName));
  const tone = $derived(
    state === 'you-lead'
      ? 'border-accent/60'
      : state === 'sold-to-you'
        ? 'border-positive/50'
        : state === 'unsold'
          ? 'border-dashed'
          : 'border-border',
  );
  const ariaLabel = $derived(
    `${player.displayName}, ${player.position}, overall ${String(player.originalOverall)}, ${stateLabel}, ${offerLabel} ${exactMoney(offerDollars)}, ${
      auction?.status === 'open'
        ? remaining <= 0
          ? 'closure pending'
          : `closes in ${clockText}`
        : leaderText
    }`,
  );
</script>

<button
  type="button"
  class="group flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-lg border bg-card p-2 text-left outline-none transition-colors duration-150 hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring sm:rounded-xl sm:p-2.5
    {selected ? 'border-primary ring-2 ring-primary/40' : tone}"
  aria-pressed={selected}
  aria-label={ariaLabel}
  data-player-id={player.playerId}
  data-lot-state={state}
  data-selected={selected ? 'true' : 'false'}
  data-pulse={pulse ? 'true' : 'false'}
  onclick={() => onselect(player.playerId)}
>
  <span class="flex min-w-0 items-start gap-2">
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
      <span class="flex items-baseline justify-between gap-1">
        <span class="min-w-0 truncate font-display text-xs leading-tight font-extrabold sm:text-sm"
          >{player.displayName}</span
        >
        <span
          class="shrink-0 font-mono text-[10px] font-bold text-muted-foreground tabular-nums"
          aria-label={`Overall ${String(player.originalOverall)}`}>{player.originalOverall}</span
        >
      </span>
      <span
        class="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-[8px] text-muted-foreground"
      >
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
      </span>
    </span>
  </span>

  <span class="flex flex-wrap gap-1">
    <span
      class="rounded border px-1 py-0.5 font-mono text-[8px] font-bold tracking-[0.06em] uppercase {bucketClass(
        player.bucket,
      )}">{bucketLabel(player.bucket)}</span
    >
    <span
      class="rounded border border-line-soft bg-surface-1 px-1 py-0.5 font-mono text-[8px] font-bold tracking-[0.06em] text-muted-foreground uppercase"
      >{player.position}</span
    >
    <span
      class="truncate rounded border px-1 py-0.5 font-mono text-[8px] font-bold tracking-[0.06em] uppercase {state ===
      'you-lead'
        ? 'border-accent/50 bg-accent/10 text-accent'
        : state === 'sold-to-you'
          ? 'border-positive/40 bg-positive/10 text-positive'
          : 'border-line-soft bg-surface-1 text-muted-foreground'}">{stateLabel}</span
    >
  </span>

  <span class="mt-auto flex items-end justify-between gap-1 border-t border-line-soft pt-1.5">
    <span class="flex min-w-0 flex-col">
      <span class="font-mono text-[8px] font-bold tracking-[0.08em] text-muted-foreground uppercase"
        >{offerLabel}</span
      >
      <span class="font-mono text-xs font-bold tabular-nums sm:text-sm" class:lot-pulse={pulse}
        >{money(offerDollars)}</span
      >
    </span>
    <span class="flex min-w-0 flex-col items-end">
      <span
        class="font-mono text-[10px] font-semibold tabular-nums"
        class:text-negative={clockUrgent}>{clockText}</span
      >
      {#if extended}
        <span class="font-mono text-[8px] font-bold uppercase text-accent">Extended</span>
      {:else}
        <span class="max-w-full truncate text-[8px] text-muted-foreground">{leaderText}</span>
      {/if}
    </span>
  </span>
</button>

<style>
  .lot-pulse {
    animation: lot-price 200ms ease-out;
  }
  @keyframes lot-price {
    0% {
      transform: scale(1);
    }
    40% {
      transform: scale(1.08);
      color: var(--color-accent);
    }
    100% {
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .lot-pulse {
      animation: none;
    }
  }
</style>
