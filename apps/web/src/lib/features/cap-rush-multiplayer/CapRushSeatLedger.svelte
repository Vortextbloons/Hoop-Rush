<script lang="ts">
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
  } from '@hoop-rush/data-contracts';
  import {
    CAP_RUSH_CAP_LINE_DOLLARS,
    CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS,
  } from '@hoop-rush/data-contracts';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { capStatusClass, capStatusLabel } from '../cap-rush/cap-rush-presentation.js';
  import CapRushMultiplayerRoster from './CapRushMultiplayerRoster.svelte';
  import { exactMoney, money, seatPayrollSummary } from './cap-rush-multiplayer-presentation.js';

  let {
    state,
    seat,
    localSeat,
    art = null,
    highlightPlayerId = null,
  }: {
    state: CapRushMultiplayerState;
    seat: CapRushMultiplayerSeatId;
    localSeat: CapRushMultiplayerSeatId;
    art?: CapRushArt | null;
    highlightPlayerId?: string | null;
  } = $props();

  const summary = $derived(seatPayrollSummary(state, seat));
  const capPercent = $derived(
    Math.min(
      100,
      Math.round((summary.payrollDollars / CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS) * 100),
    ),
  );
  const capLinePercent = $derived(
    Math.round((CAP_RUSH_CAP_LINE_DOLLARS / CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS) * 100),
  );
</script>

<section class="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
  <header class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <p class="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
        Signed payroll
      </p>
      <p class="font-display text-3xl font-extrabold tracking-tight tabular-nums">
        {money(summary.signedPayrollDollars)}
      </p>
    </div>
    <span
      class="inline-flex shrink-0 rounded-full border px-2 py-1 text-right font-mono text-[9px] leading-tight font-bold tracking-[0.04em] uppercase {capStatusClass(
        summary.status,
      )}"
    >
      {capStatusLabel(summary.status)}
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
    <p class="flex justify-between gap-2 font-mono text-[10px] text-muted-foreground tabular-nums">
      <span>Cap {money(CAP_RUSH_CAP_LINE_DOLLARS)}</span>
      <span>Limit {money(CAP_RUSH_MULTIPLAYER_HARD_LIMIT_DOLLARS)}</span>
    </p>
  </div>

  {#if summary.bindingBidDollars !== null}
    <div class="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2">
      <p class="font-mono text-[9px] font-bold tracking-[0.12em] text-accent uppercase">
        Binding lead · not signed yet
      </p>
      <p class="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span class="min-w-0 truncate font-semibold">
          {summary.bindingPlayerName ?? 'Winning bid'}
        </span>
        <span class="shrink-0 font-mono font-semibold tabular-nums"
          >{exactMoney(summary.bindingBidDollars)}</span
        >
      </p>
    </div>
  {/if}

  <dl class="flex flex-col gap-1 rounded-lg bg-surface-1 px-3 py-2 font-mono text-[11px]">
    <div class="flex items-baseline justify-between gap-2">
      <dt class="text-muted-foreground">Total commitments</dt>
      <dd class="font-semibold tabular-nums">{money(summary.payrollDollars)}</dd>
    </div>
    <div class="flex items-baseline justify-between gap-2">
      <dt class="text-muted-foreground">Remaining to limit</dt>
      <dd class="font-semibold tabular-nums">{money(summary.headroomDollars)}</dd>
    </div>
  </dl>

  <CapRushMultiplayerRoster {state} {seat} {localSeat} {art} {highlightPlayerId} />
</section>
