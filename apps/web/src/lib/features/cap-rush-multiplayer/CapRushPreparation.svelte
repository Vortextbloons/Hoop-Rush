<script lang="ts">
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
    CapRushSpinPurchaseId,
    CapRushSpinReceipt,
  } from '@hoop-rush/data-contracts';
  import { CAP_RUSH_SPIN_PURCHASES, REQUIRED_RATING_KEYS } from '@hoop-rush/data-contracts';
  import { capRushSpinEligibility, havocMutationDefinitionOf } from '@hoop-rush/engine';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import HavocTierBadge from '#lib/features/havoc/HavocTierBadge.svelte';
  import { havocFieldLabel } from '#lib/features/havoc/havoc-presentation.js';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { capStatusClass, capStatusLabel, initialsOf } from '../cap-rush/cap-rush-presentation.js';
  import CapRushMultiplayerRoster from './CapRushMultiplayerRoster.svelte';
  import {
    exactMoney,
    money,
    positionLabel,
    seatLabelFor,
    seatOrder,
    seatPayrollSummary,
  } from './cap-rush-multiplayer-presentation.js';

  const PURCHASE_OPTIONS: readonly CapRushSpinPurchaseId[] = ['standard', 'surge'];

  let {
    state: game,
    localSeat,
    art = null,
    busy = false,
    onpurchasemutation,
    onskipmutation,
    onconfirmlock,
  }: {
    state: CapRushMultiplayerState;
    localSeat: CapRushMultiplayerSeatId;
    art?: CapRushArt | null;
    busy?: boolean;
    onpurchasemutation: (purchase: 'standard' | 'surge', targetPlayerId: string) => void;
    onskipmutation: () => void;
    onconfirmlock: () => void;
  } = $props();

  let targetPlayerId = $state<string | null>(null);
  let purchase = $state<CapRushSpinPurchaseId>('standard');

  const variant = $derived(game.locked?.variant ?? 'clash');
  const seats = $derived(seatOrder(localSeat));
  const localLock = $derived(game.locked?.seats[localSeat] ?? null);
  const picks = $derived(localLock?.picks ?? []);
  const localPayroll = $derived(localLock?.payrollDollars ?? 0);
  const targetId = $derived(
    picks.find((pick) => pick.playerId === targetPlayerId)?.playerId ?? picks[0]?.playerId ?? null,
  );
  const mutationWindow = $derived(
    game.locked !== null &&
      game.recruitment !== null &&
      game.locked.variant === 'roulette' &&
      game.phase === 'preparation',
  );
  const receipts = $derived.by<CapRushSpinReceipt[]>(() => {
    if (localLock === null || localLock.spin === null) return [];
    return [localLock.spin, ...(localLock.additionalSpins ?? [])];
  });
  const spinSpend = $derived(receipts.reduce((total, receipt) => total + receipt.priceDollars, 0));
  const purchasesLeft = $derived(receipts.length < 5);
  const eligibility = $derived(capRushSpinEligibility(localPayroll, purchase));
  const localConfirmed = $derived(game.lockConfirmations[localSeat] !== null);
  const opponentSeat = $derived(seats[1]);
  const opponentConfirmed = $derived(game.lockConfirmations[opponentSeat] !== null);

  function marketPlayer(playerId: string | null) {
    if (playerId === null) return null;
    return game.recruitment?.market.players.find((player) => player.playerId === playerId) ?? null;
  }

  function playerName(playerId: string | null): string {
    return marketPlayer(playerId)?.displayName ?? 'Unlisted player';
  }

  function pickForReceipt(receipt: CapRushSpinReceipt) {
    return picks.find((pick) => pick.cardId === receipt.target.cardId) ?? null;
  }

  function receiptName(receipt: CapRushSpinReceipt): string {
    return playerName(pickForReceipt(receipt)?.playerId ?? null);
  }

  function purchaseLabel(value: CapRushSpinPurchaseId): string {
    return value === 'standard' ? 'Mutation Spark' : 'Mutation Surge';
  }

  function mutationNames(receipt: CapRushSpinReceipt): string[] {
    return [receipt.entry, ...(receipt.additionalEntries ?? [])].map(
      (entry) => havocMutationDefinitionOf(entry.mutationId).name,
    );
  }

  function ratingChanges(
    receipt: CapRushSpinReceipt,
  ): { label: string; from: number; to: number }[] {
    const baseline = marketPlayer(pickForReceipt(receipt)?.playerId ?? null)?.source.profile
      .ratings;
    if (baseline === undefined) return [];
    return REQUIRED_RATING_KEYS.filter(
      (key) => baseline[key] !== receipt.effective.ratings[key],
    ).map((key) => ({
      label: havocFieldLabel(key),
      from: baseline[key],
      to: receipt.effective.ratings[key],
    }));
  }

  function franchiseOf(seat: CapRushMultiplayerSeatId) {
    return game.locked?.seats[seat].franchise ?? game.franchises?.[seat] ?? null;
  }
</script>

<div class="flex flex-col gap-4">
  <header class="flex flex-col gap-1">
    <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
      Preparation
    </p>
    <h2 class="font-display text-2xl font-extrabold tracking-tight uppercase sm:text-3xl">
      {variant === 'roulette' ? 'Mutation window' : 'Roster lock'}
    </h2>
    <p class="max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
      {variant === 'roulette'
        ? 'Buy mutations from your recruited payroll, then both seats confirm to lock the rosters.'
        : 'Cap Clash has no mutations. Review both lineups, then both seats confirm to lock the rosters.'}
    </p>
  </header>

  <div class="grid gap-3 lg:grid-cols-2">
    {#each seats as seat (seat)}
      {@const summary = seatPayrollSummary(game, seat)}
      {@const franchise = franchiseOf(seat)}
      {@const team = franchise !== null && art !== null ? art.teamFor(franchise.franchiseId) : null}
      <section class="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border bg-card p-3">
        <header class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">
            {#if team !== null && art !== null}
              <TeamLogo
                manifest={art.manifest}
                franchiseId={team.franchiseId}
                teamExternalId={team.teamExternalId}
                className="h-7 w-7"
              />
            {/if}
            <div class="min-w-0">
              <p class="truncate font-display text-base font-extrabold tracking-tight uppercase">
                {franchise?.displayName ?? seatLabelFor(seat, localSeat)}
              </p>
              <p class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase">
                {franchise === null ? seatLabelFor(seat, localSeat) : franchise.conference}
              </p>
            </div>
          </div>
          <span
            class="inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-right font-mono text-[9px] leading-tight font-bold tracking-[0.04em] uppercase {capStatusClass(
              summary.status,
            )}"
          >
            {capStatusLabel(summary.status)}
          </span>
        </header>

        <CapRushMultiplayerRoster state={game} {seat} {localSeat} {art} />

        <dl
          class="flex flex-col gap-1 rounded-lg bg-surface-1 px-2.5 py-2 text-[11px] leading-snug"
        >
          <div class="flex items-baseline justify-between gap-2">
            <dt class="text-muted-foreground">Signed payroll</dt>
            <dd class="font-mono font-semibold tabular-nums">
              {exactMoney(summary.signedPayrollDollars)}
            </dd>
          </div>
          <div class="flex items-baseline justify-between gap-2">
            <dt class="text-muted-foreground">Total commitments</dt>
            <dd class="font-mono font-semibold tabular-nums">
              {exactMoney(summary.payrollDollars)}
            </dd>
          </div>
          <div class="flex items-baseline justify-between gap-2">
            <dt class="text-muted-foreground">Remaining to limit</dt>
            <dd class="font-mono font-semibold tabular-nums">
              {exactMoney(summary.headroomDollars)}
            </dd>
          </div>
        </dl>
      </section>
    {/each}
  </div>

  {#if mutationWindow && localLock !== null}
    <section
      class="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-card p-3 sm:p-4"
      aria-label="Mutations"
    >
      <header class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
            Cap Roulette
          </p>
          <h3 class="font-display text-lg font-extrabold tracking-tight uppercase">
            Buy mutations
          </h3>
        </div>
        <p class="font-mono text-[10px] text-muted-foreground">
          {receipts.length} of 5 purchases used
        </p>
      </header>

      <p class="max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
        Mutations are paid from the recruited payroll and do not change roster salaries.
      </p>

      <div role="group" aria-label="Target player" class="flex flex-col gap-2">
        <p class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
          Target player
        </p>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {#each picks as pick (pick.playerId)}
            {@const player = marketPlayer(pick.playerId)}
            {@const face = player !== null && art !== null ? art.faceFor(player.source) : null}
            {@const mutated = receipts.some((receipt) => receipt.target.cardId === pick.cardId)}
            <button
              type="button"
              class="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border p-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 {pick.playerId ===
              targetId
                ? 'border-primary bg-primary/10'
                : 'border-line-soft bg-surface-1 hover:border-line-strong'}"
              aria-pressed={pick.playerId === targetId}
              disabled={busy}
              onclick={() => (targetPlayerId = pick.playerId)}
            >
              {#if player !== null && face !== null && art !== null}
                <PlayerFace
                  player={face}
                  manifest={art.manifest}
                  size="sm"
                  fallbackInitials={initialsOf(player.displayName)}
                />
              {:else}
                <span
                  class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-xs font-extrabold text-muted-foreground"
                  aria-hidden="true">{initialsOf(playerName(pick.playerId))}</span
                >
              {/if}
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm leading-tight font-semibold"
                  >{playerName(pick.playerId)}</span
                >
                <span
                  class="block font-mono text-[9px] tracking-[0.04em] text-muted-foreground uppercase"
                  >{pick.slot} · {positionLabel(pick.slot)} ·
                  {money(pick.salaryDollars)}</span
                >
                {#if mutated}
                  <span class="block text-[9px] font-semibold text-accent">Mutated</span>
                {/if}
              </span>
            </button>
          {/each}
        </div>
      </div>

      <div role="group" aria-label="Mutation purchase" class="flex flex-col gap-2">
        <p class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
          Purchase
        </p>
        <div class="grid gap-2 sm:grid-cols-2">
          {#each PURCHASE_OPTIONS as option (option)}
            {@const optionEligibility = capRushSpinEligibility(localPayroll, option)}
            <button
              type="button"
              class="flex min-h-11 min-w-0 flex-col rounded-xl border p-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 {purchase ===
              option
                ? 'border-primary bg-primary/10'
                : 'border-line-soft bg-surface-1 hover:border-line-strong'}"
              aria-pressed={purchase === option}
              disabled={busy}
              onclick={() => (purchase = option)}
            >
              <span class="flex items-baseline justify-between gap-2">
                <span class="font-display text-sm font-extrabold tracking-tight uppercase"
                  >{purchaseLabel(option)}</span
                >
                <span class="font-mono text-sm font-semibold tabular-nums"
                  >{exactMoney(CAP_RUSH_SPIN_PURCHASES[option].priceDollars)}</span
                >
              </span>
              <span class="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                {option === 'standard' ? 'One mutation.' : 'Two or three mutations.'}
              </span>
              {#if !optionEligibility.eligible}
                <span class="mt-1 block text-[10px] leading-snug font-semibold text-negative">
                  Needs recruited payroll of
                  {exactMoney(optionEligibility.maxEligiblePayrollDollars)} or less.
                </span>
              {/if}
            </button>
          {/each}
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy || targetId === null || !eligibility.eligible || !purchasesLeft}
            onclick={() => {
              if (targetId !== null) onpurchasemutation(purchase, targetId);
            }}
          >
            Buy mutation · {exactMoney(eligibility.priceDollars)}
          </button>
          <button
            type="button"
            class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface-2 px-4 text-xs font-semibold outline-none transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            disabled={busy}
            onclick={onskipmutation}
          >
            Skip mutations
          </button>
          <p class="font-mono text-[10px] text-muted-foreground">
            Recruited payroll {exactMoney(localPayroll)}
          </p>
        </div>
        {#if !purchasesLeft}
          <p class="text-[11px] font-semibold">All five mutation purchases are used.</p>
        {:else if !eligibility.eligible}
          <p class="text-[11px] font-semibold text-negative">
            This payroll is above the {purchaseLabel(purchase)} ceiling of
            {exactMoney(eligibility.maxEligiblePayrollDollars)}.
          </p>
        {/if}
      </div>

      <div
        class="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line-soft bg-surface-1 px-2.5 py-1.5"
      >
        <p class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
          Mutation spend
        </p>
        <p class="font-mono text-sm font-semibold tabular-nums">{exactMoney(spinSpend)}</p>
      </div>

      {#if receipts.length > 0}
        <div class="flex flex-col gap-2">
          <p
            class="font-mono text-[9px] font-bold tracking-[0.12em] text-muted-foreground uppercase"
          >
            Recorded mutations
          </p>
          <ul class="grid gap-2 lg:grid-cols-2">
            {#each receipts as receipt (receipt.receiptDigest)}
              {@const changes = ratingChanges(receipt)}
              {@const physical = receipt.effective.physical}
              <li
                class="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line-soft bg-surface-1 p-2.5"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <p class="min-w-0 text-sm font-bold">
                    <span class="font-mono text-[10px] text-primary">{receipt.target.slot}</span>
                    <span class="break-words"> {receiptName(receipt)}</span>
                  </p>
                  <HavocTierBadge tier={receipt.tier} size="sm" />
                </div>
                <p
                  class="flex flex-wrap items-baseline gap-x-2 font-mono text-[10px] text-muted-foreground"
                >
                  <span>{purchaseLabel(receipt.purchase)}</span>
                  <span aria-hidden="true">·</span>
                  <span class="font-semibold text-foreground tabular-nums"
                    >{exactMoney(receipt.priceDollars)}</span
                  >
                </p>
                <ul class="flex flex-wrap gap-1">
                  {#each mutationNames(receipt) as name (name)}
                    <li
                      class="rounded border border-line-soft bg-background/60 px-1.5 py-0.5 text-[10px] font-semibold"
                    >
                      {name}
                    </li>
                  {/each}
                </ul>
                {#if changes.length > 0 || physical.heightInches !== physical.baselineHeightInches || physical.wingspanDeltaInches !== 0}
                  <dl
                    class="flex flex-wrap gap-x-3 gap-y-1 border-t border-line-soft pt-1.5 text-[10px]"
                  >
                    {#each changes as change (change.label)}
                      <div class="flex items-baseline gap-1">
                        <dt class="text-muted-foreground">{change.label}</dt>
                        <dd class="font-mono font-semibold tabular-nums">
                          {change.from}<span aria-hidden="true">→</span>{change.to}
                        </dd>
                      </div>
                    {/each}
                    {#if physical.heightInches !== physical.baselineHeightInches}
                      <div class="flex items-baseline gap-1">
                        <dt class="text-muted-foreground">Height</dt>
                        <dd class="font-mono font-semibold tabular-nums">
                          {physical.baselineHeightInches}″<span aria-hidden="true">→</span
                          >{physical.heightInches}″
                        </dd>
                      </div>
                    {/if}
                    {#if physical.wingspanDeltaInches !== 0}
                      <div class="flex items-baseline gap-1">
                        <dt class="text-muted-foreground">Wingspan</dt>
                        <dd class="font-mono font-semibold tabular-nums">
                          +{physical.wingspanDeltaInches}″
                        </dd>
                      </div>
                    {/if}
                  </dl>
                {:else}
                  <p class="border-t border-line-soft pt-1.5 text-[10px] leading-snug">
                    Base ratings stay the same; the mutation changes game rules.
                  </p>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </section>
  {/if}

  <section class="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3 sm:p-4">
    <h3 class="font-display text-lg font-extrabold tracking-tight uppercase">Lock the rosters</h3>
    <p class="max-w-2xl text-xs leading-relaxed text-muted-foreground">
      The season starts when both seats confirm the same rosters. Neither confirmation changes
      salaries.
    </p>
    <div class="flex flex-wrap items-center gap-3">
      <button
        type="button"
        class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        disabled={busy || localConfirmed}
        onclick={onconfirmlock}
      >
        {localConfirmed ? 'You confirmed' : 'Confirm roster'}
      </button>
      <p class="text-[11px] leading-snug" role="status">
        {#if localConfirmed}
          You confirmed · {opponentConfirmed ? 'Opponent confirmed' : 'Waiting for opponent'}
        {:else if opponentConfirmed}
          Opponent confirmed · Waiting for you
        {:else}
          Waiting for both seats
        {/if}
      </p>
    </div>
  </section>
</div>
