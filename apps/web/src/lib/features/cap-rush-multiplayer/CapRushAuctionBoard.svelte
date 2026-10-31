<script lang="ts">
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
    Position,
  } from '@hoop-rush/data-contracts';
  import { POSITIONS } from '@hoop-rush/data-contracts';
  import CapRushAuctionLot from './CapRushAuctionLot.svelte';
  import CapRushBidControls from './CapRushBidControls.svelte';
  import CapRushSeatLedger from './CapRushSeatLedger.svelte';
  import {
    clockLabel,
    currentRound,
    money,
    nextMinimumBid,
    playerById,
    positionLabel,
    remainingMs,
    seatLabelFor,
  } from './cap-rush-multiplayer-presentation.js';

  let {
    game,
    localSeat,
    nowMs,
    busy = false,
    onbid,
  }: {
    game: CapRushMultiplayerState;
    localSeat: CapRushMultiplayerSeatId;
    nowMs: number;
    busy?: boolean;
    onbid: (playerId: string, totalDollars: number) => void;
  } = $props();

  const recruitment = $derived(game.recruitment);
  const round = $derived(recruitment === null ? null : currentRound(recruitment));
  let selectedId: string | null = $state(null);

  const lots = $derived(
    round === null || recruitment === null
      ? []
      : round.auctions.flatMap((auction) => {
          const player = playerById(recruitment, auction.playerId);
          return player === undefined ? [] : [{ auction, player }];
        }),
  );

  const selected = $derived(lots.find((entry) => entry.auction.playerId === selectedId) ?? null);

  $effect(() => {
    if (round === null) return;
    if (selectedId !== null && lots.some((entry) => entry.auction.playerId === selectedId)) return;
    selectedId =
      round.auctions.find((auction) => auction.status === 'open')?.playerId ??
      round.auctions[0]?.playerId ??
      null;
  });

  const seatFilled = $derived(
    recruitment === null || round === null
      ? false
      : recruitment.seats[localSeat].filledPositions.includes(round.position),
  );
  const leadElsewhere = $derived(
    recruitment !== null &&
      recruitment.seats[localSeat].leadPlayerId !== null &&
      recruitment.seats[localSeat].leadPlayerId !== selectedId,
  );
  const minimum = $derived(
    selected === null ? 0 : nextMinimumBid(selected.auction, selected.player),
  );
  const canBid = $derived(
    !busy &&
      selected !== null &&
      selected.auction.status === 'open' &&
      !seatFilled &&
      !leadElsewhere,
  );
  const roundSeconds = $derived(
    round === null
      ? 0
      : (() => {
          const open = round.auctions
            .filter((auction) => auction.status === 'open')
            .map((auction) => remainingMs(auction.endsAtIso, nowMs));
          return open.length === 0 ? 0 : Math.min(...open);
        })(),
  );
  const upcoming = $derived(
    recruitment === null || round === null ? [] : POSITIONS.slice(round.index + 1),
  );
  const bidDisabledReason = $derived(
    seatFilled
      ? `You already signed a ${round?.position ?? 'player'} this round.`
      : leadElsewhere
        ? `You already lead the ${round?.position ?? ''} auction.`
        : null,
  );
</script>

{#if recruitment === null || round === null}
  <p class="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
    The recruitment market is not open yet.
  </p>
{:else}
  <div class="flex flex-col gap-4">
    <header
      class="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-end sm:justify-between"
    >
      <div class="flex flex-col gap-1">
        <p
          class="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground"
        >
          Round {round.index + 1} of 5
        </p>
        <h2 class="font-display text-3xl font-extrabold uppercase tracking-tight sm:text-4xl">
          {positionLabel(round.position)}
        </h2>
        <p class="text-xs text-muted-foreground">Twelve lots. One signing per seat. No rerolls.</p>
      </div>
      <div class="flex items-end gap-4">
        <div class="flex flex-col items-end">
          <span class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Round clock
          </span>
          <span
            class="font-mono text-3xl font-semibold tabular-nums"
            class:text-negative={roundSeconds <= 10_000}
          >
            {clockLabel(roundSeconds)}
          </span>
        </div>
        <ol class="hidden gap-1 sm:flex">
          {#each POSITIONS as position, index (position)}
            <li
              class="flex h-8 w-8 items-center justify-center rounded-lg border font-mono text-[10px] font-bold
                {index === round.index
                ? 'border-primary bg-primary/15 text-primary'
                : index < round.index
                  ? 'border-positive/40 bg-positive/10 text-positive'
                  : 'border-border text-muted-foreground'}"
            >
              {position}
            </li>
          {/each}
        </ol>
      </div>
    </header>

    <div class="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_15rem]">
      <div class="order-2 flex flex-col gap-3 lg:order-1">
        <CapRushSeatLedger state={game} seat="p1" {localSeat} />
      </div>

      <div class="order-1 flex flex-col gap-4 lg:order-2">
        <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {#each lots as lot (lot.auction.playerId)}
            <CapRushAuctionLot
              auction={lot.auction}
              player={lot.player}
              {localSeat}
              {nowMs}
              selected={lot.auction.playerId === selectedId}
              disabled={busy}
              onselect={(playerId) => (selectedId = playerId)}
            />
          {/each}
        </div>

        {#if selected}
          <section class="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
            <div class="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Selected lot
                </p>
                <h3 class="font-display text-xl font-bold uppercase tracking-tight">
                  {selected.player.displayName}
                </h3>
              </div>
              <div class="flex gap-4 text-right">
                <div>
                  <p
                    class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    OVR
                  </p>
                  <p class="font-mono text-lg font-semibold tabular-nums">
                    {selected.player.originalOverall}
                  </p>
                </div>
                <div>
                  <p
                    class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    Minimum
                  </p>
                  <p class="font-mono text-lg font-semibold tabular-nums">
                    {money(selected.player.minimumBidDollars)}
                  </p>
                </div>
                <div>
                  <p
                    class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                  >
                    Leader
                  </p>
                  <p class="text-sm font-semibold">
                    {selected.auction.leaderSeat === null
                      ? 'None'
                      : seatLabelFor(selected.auction.leaderSeat, localSeat)}
                  </p>
                </div>
              </div>
            </div>
            {#if bidDisabledReason !== null}
              <p
                class="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground"
              >
                {bidDisabledReason}
              </p>
            {/if}
            {#key selected.auction.playerId}
              <CapRushBidControls
                {minimum}
                currentBid={selected.auction.leaderBidDollars}
                disabled={!canBid}
                onbid={(totalDollars) => onbid(selected.auction.playerId, totalDollars)}
              />
            {/key}
          </section>
        {/if}
      </div>

      <div class="order-3 flex flex-col gap-3">
        <CapRushSeatLedger state={game} seat="p2" {localSeat} />
      </div>
    </div>

    {#if upcoming.length > 0}
      <p class="text-xs text-muted-foreground">
        Next: {upcoming.map((position: Position) => positionLabel(position)).join(' → ')}
      </p>
    {/if}
  </div>
{/if}
