<script lang="ts">
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
  } from '@hoop-rush/data-contracts';
  import {
    CAP_RUSH_CAP_LINE_DOLLARS,
    CAP_RUSH_HARD_LIMIT_DOLLARS,
    POSITIONS,
  } from '@hoop-rush/data-contracts';
  import { money, positionLabel, seatLabelFor } from './cap-rush-multiplayer-presentation.js';

  let {
    state,
    seat,
    localSeat,
  }: {
    state: CapRushMultiplayerState;
    seat: CapRushMultiplayerSeatId;
    localSeat: CapRushMultiplayerSeatId;
  } = $props();

  const locked = $derived(state.locked?.seats[seat] ?? null);
  const recruitment = $derived(state.recruitment);
  const payroll = $derived(locked?.payrollDollars ?? recruitment?.seats[seat].payrollDollars ?? 0);
  const filled = $derived(
    recruitment?.seats[seat].filledPositions ?? locked?.picks.map((pick) => pick.slot) ?? [],
  );
  const lead = $derived(recruitment?.seats[seat].leadPlayerId ?? null);
  const leadName = $derived(
    lead === null
      ? null
      : (recruitment?.market.players.find((player) => player.playerId === lead)?.displayName ??
          lead),
  );
  const signed = $derived(
    recruitment?.signings
      .filter((signing) => signing.seat === seat)
      .sort(
        (left, right) => POSITIONS.indexOf(left.position) - POSITIONS.indexOf(right.position),
      ) ?? [],
  );
  const capPercent = $derived(
    Math.min(100, Math.round((payroll / CAP_RUSH_HARD_LIMIT_DOLLARS) * 100)),
  );
  const capLinePercent = $derived(
    Math.round((CAP_RUSH_CAP_LINE_DOLLARS / CAP_RUSH_HARD_LIMIT_DOLLARS) * 100),
  );
  const remaining = $derived(Math.max(0, CAP_RUSH_HARD_LIMIT_DOLLARS - payroll));
</script>

<section
  class="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4
    {seat === localSeat ? 'border-primary/40' : ''}"
>
  <header class="flex items-baseline justify-between gap-2">
    <h3 class="font-display text-lg font-bold uppercase tracking-tight">
      {seatLabelFor(seat, localSeat)}
    </h3>
    <span class="font-mono text-xs text-muted-foreground tabular-nums">
      {money(payroll)} payroll
    </span>
  </header>

  <div class="flex flex-col gap-1">
    <div class="relative h-2.5 overflow-hidden rounded-full bg-surface-2">
      <div class="h-full bg-primary" style:width={`${capPercent}%`}></div>
      <span
        class="absolute inset-y-0 w-px bg-foreground/40"
        style:left={`${capLinePercent}%`}
        aria-hidden="true"
      ></span>
    </div>
    <div class="flex justify-between text-[10px] text-muted-foreground">
      <span>Cap {money(CAP_RUSH_CAP_LINE_DOLLARS)}</span>
      <span>{money(remaining)} left</span>
    </div>
  </div>

  {#if leadName !== null}
    <p class="rounded-lg border border-accent/40 bg-accent/10 px-2 py-1.5 text-xs">
      Leading <span class="font-semibold">{leadName}</span>
    </p>
  {/if}

  <ul class="flex flex-col gap-1.5">
    {#each POSITIONS as position (position)}
      {@const signing = signed.find((entry) => entry.position === position)}
      {@const isFilled = filled.includes(position)}
      <li class="flex items-center justify-between gap-2 text-xs">
        <span class="flex items-center gap-2">
          <span class="w-7 font-mono text-[10px] font-bold text-muted-foreground">{position}</span>
          <span class="truncate" class:text-muted-foreground={!isFilled}>
            {signing?.displayName ?? 'Open'}
          </span>
        </span>
        {#if signing}
          <span class="font-mono text-[10px] tabular-nums">{money(signing.salaryDollars)}</span>
        {:else}
          <span class="text-[10px] text-muted-foreground">{positionLabel(position)}</span>
        {/if}
      </li>
    {/each}
  </ul>
</section>
