<script lang="ts">
  import type {
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
    CapRushSpinPurchaseId,
    CapRushSpinReceipt,
  } from '@hoop-rush/data-contracts';
  import {
    CAP_RUSH_CAP_LINE_DOLLARS,
    CAP_RUSH_SPIN_PURCHASES,
    REQUIRED_RATING_KEYS,
  } from '@hoop-rush/data-contracts';
  import { capRushSpinEligibility } from '@hoop-rush/engine';
  import { ChevronDown } from '@lucide/svelte';
  import HavocMutationList from '#lib/features/havoc/HavocMutationList.svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import HavocTierBadge from '#lib/features/havoc/HavocTierBadge.svelte';
  import { havocFieldLabel, mutationNameOf } from '#lib/features/havoc/havoc-presentation.js';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import {
    capRushSpinOutcomeRows,
    capRushSpinPurchaseLabel,
    capStatusClass,
    capStatusLabel,
    initialsOf,
  } from '../cap-rush/cap-rush-presentation.js';
  import CapRushMultiplayerRoster from './CapRushMultiplayerRoster.svelte';
  import {
    exactMoney,
    money,
    positionLabel,
    seatLabelFor,
    seatOrder,
    seatPayrollSummary,
  } from './cap-rush-multiplayer-presentation.js';
  import Panel from '#lib/components/ui/Panel.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';

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

  const variant = $derived(game.locked?.variant ?? 'clash');
  const seats = $derived(seatOrder(localSeat));
  const localLock = $derived(game.locked?.seats[localSeat] ?? null);
  const picks = $derived(localLock?.picks ?? []);
  const localPayroll = $derived(localLock?.payrollDollars ?? 0);
  const localSummary = $derived(seatPayrollSummary(game, localSeat));
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
  const mutationBudget = $derived(
    Math.max(0, CAP_RUSH_CAP_LINE_DOLLARS - localPayroll - spinSpend),
  );
  const availablePicks = $derived(
    picks.filter((pick) => !receipts.some((receipt) => receipt.target.cardId === pick.cardId)),
  );
  const targetId = $derived(
    availablePicks.find((pick) => pick.playerId === targetPlayerId)?.playerId ??
      availablePicks[0]?.playerId ??
      null,
  );
  const allTargetsMutated = $derived(picks.length > 0 && availablePicks.length === 0);
  const purchasesLeft = $derived(receipts.length < 5);
  const anyPurchaseEligible = $derived(
    PURCHASE_OPTIONS.some(
      (option) => capRushSpinEligibility(localPayroll + spinSpend, option).eligible,
    ),
  );
  const decisionOpen = $derived(
    mutationWindow &&
      localLock !== null &&
      purchasesLeft &&
      availablePicks.length > 0 &&
      !allTargetsMutated &&
      anyPurchaseEligible,
  );
  const latestReceipt = $derived(
    receipts.length === 0 ? null : (receipts[receipts.length - 1] ?? null),
  );
  const previousReceipts = $derived(receipts.slice(0, -1).reverse());
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

  function mutationNames(receipt: CapRushSpinReceipt): string {
    return [receipt.entry, ...(receipt.additionalEntries ?? [])]
      .map((entry) => mutationNameOf(entry.mutationId))
      .join(' / ');
  }

  function purchaseCostSummary(): string {
    return PURCHASE_OPTIONS.map(
      (option) =>
        `${capRushSpinPurchaseLabel(option)} ${exactMoney(CAP_RUSH_SPIN_PURCHASES[option].priceDollars)}`,
    ).join(' · ');
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
  {#snippet receiptEffects(receipt: CapRushSpinReceipt)}
    {@const changes = ratingChanges(receipt)}
    {@const physical = receipt.effective.physical}
    <HavocMutationList mutations={[receipt.entry, ...(receipt.additionalEntries ?? [])]} readable />
    {#if changes.length > 0 || physical.heightInches !== physical.baselineHeightInches || physical.wingspanDeltaInches !== 0}
      <dl class="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-line-soft pt-1.5 text-[10px]">
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
    {/if}
  {/snippet}

  <SectionHeading
    eyebrow="Preparation"
    title={variant === 'roulette' ? 'Mutation window' : 'Roster lock'}
    level={2}
  />

  <div class="grid gap-3 lg:grid-cols-2">
    {#each seats as seat (seat)}
      {@const summary = seatPayrollSummary(game, seat)}
      {@const franchise = franchiseOf(seat)}
      {@const team = franchise !== null && art !== null ? art.teamFor(franchise.franchiseId) : null}
      <Panel as="section" padding="none" class="flex min-w-0 flex-col gap-2.5 p-3">
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
              <p class="ui-micro">
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
          {#if summary.payrollDollars !== summary.signedPayrollDollars}
            <div class="flex items-baseline justify-between gap-2">
              <dt class="text-muted-foreground">Total commitments</dt>
              <dd class="font-mono font-semibold tabular-nums">
                {exactMoney(summary.payrollDollars)}
              </dd>
            </div>
          {/if}
          <div class="flex items-baseline justify-between gap-2">
            <dt class="text-muted-foreground">Remaining to limit</dt>
            <dd class="font-mono font-semibold tabular-nums">
              {exactMoney(summary.headroomDollars)}
            </dd>
          </div>
        </dl>
      </Panel>
    {/each}
  </div>

  {#if mutationWindow && localLock !== null}
    <Panel
      as="section"
      padding="none"
      class="flex flex-col gap-3 p-3 sm:p-4"
      aria-label="Mutations"
    >
      <SectionHeading
        eyebrow="Cap Roulette"
        title="Mutation spins"
        description="Mutation purchases draw from the normal cap. The roster hard limit applies to player payroll."
        level={3}
        align="center"
      >
        {#snippet actions()}
          <span class="ui-micro">{receipts.length} of 5 purchases used</span>
        {/snippet}
      </SectionHeading>

      <StatGrid columns={3} mobile={2}>
        <StatTile
          label="Mutation budget left"
          size="sm"
          surface="tile"
          note="Normal cap"
          tone={mutationBudget === 0 ? 'negative' : 'default'}
          value={exactMoney(mutationBudget)}
        />
        <StatTile
          label="Mutation spend"
          size="sm"
          surface="tile"
          note={`${receipts.length} of 5 purchases`}
          tone={receipts.length === 0 ? 'muted' : 'default'}
          value={exactMoney(spinSpend)}
        />
        <StatTile
          label="Payroll room to limit"
          size="sm"
          surface="tile"
          note="Hard limit"
          tone={localSummary.headroomDollars < 0 ? 'negative' : 'default'}
          value={exactMoney(localSummary.headroomDollars)}
        />
      </StatGrid>

      {#if decisionOpen}
        <div role="group" aria-label="Target player" class="flex flex-col gap-2">
          <SectionHeading level={4} size="sm" title="Choose a player" align="center">
            {#snippet actions()}
              <span class="ui-micro">One purchase per player</span>
            {/snippet}
          </SectionHeading>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {#each picks as pick (pick.playerId)}
              {@const player = marketPlayer(pick.playerId)}
              {@const face = player !== null && art !== null ? art.faceFor(player.source) : null}
              {@const mutated = receipts.some((receipt) => receipt.target.cardId === pick.cardId)}
              <button
                type="button"
                class="flex min-h-14 min-w-0 items-center gap-2 rounded-xl border p-2 text-left text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring {mutated
                  ? 'border-line-soft bg-surface-1'
                  : pick.playerId === targetId
                    ? 'border-primary bg-primary/10'
                    : 'border-line-soft bg-surface-1 hover:border-line-strong'}"
                aria-pressed={!mutated && pick.playerId === targetId}
                disabled={busy || mutated}
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
                  <span class="ui-micro mt-0.5 block truncate"
                    >{pick.slot} · {positionLabel(pick.slot)} · {money(pick.salaryDollars)}</span
                  >
                </span>
                {#if mutated}
                  <Badge tone="accent">Mutated</Badge>
                {/if}
              </button>
            {/each}
          </div>
        </div>

        <div role="group" aria-label="Mutation purchase" class="flex flex-col gap-2">
          <SectionHeading
            level={4}
            size="sm"
            title="Choose your spin"
            description="Tier odds are exact. The spin is charged when purchased."
          />
          <div class="grid gap-2 sm:grid-cols-2">
            {#each PURCHASE_OPTIONS as option (option)}
              {@const optionEligibility = capRushSpinEligibility(localPayroll + spinSpend, option)}
              {@const optionPurchase = CAP_RUSH_SPIN_PURCHASES[option]}
              <Panel as="article" padding="none" class="flex min-w-0 flex-col p-3 sm:p-4">
                <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                  <h4 class="font-display text-lg leading-tight font-extrabold uppercase">
                    {capRushSpinPurchaseLabel(option)}
                  </h4>
                  <p class="font-mono text-sm font-bold tabular-nums">
                    {exactMoney(optionPurchase.priceDollars)}
                  </p>
                </div>
                <p class="mt-1 text-xs text-muted-foreground">
                  {option === 'standard'
                    ? 'One mutation, drawn at the odds below.'
                    : 'One to three mutations, drawn as a bundle.'}
                </p>
                <dl class="mt-3 divide-y divide-line-soft border-t border-line-soft">
                  {#each capRushSpinOutcomeRows(option, optionPurchase.tierOdds) as row (row.tier)}
                    <div class="flex items-baseline justify-between gap-2 py-1.5">
                      <dt class="min-w-0 text-[11px] leading-snug">{row.label}</dt>
                      <dd class="shrink-0 font-mono text-xs font-bold tabular-nums">
                        {Math.round(row.odds * 100)}%
                      </dd>
                    </div>
                  {/each}
                </dl>
                {#if !optionEligibility.eligible}
                  <p class="mt-2.5 text-[11px] leading-snug font-semibold text-negative">
                    {exactMoney(mutationBudget)} available for mutations.
                  </p>
                {/if}
                <div class="mt-auto pt-3">
                  <Button
                    class="w-full"
                    tone="primary"
                    disabled={busy ||
                      targetId === null ||
                      !optionEligibility.eligible ||
                      !purchasesLeft}
                    onclick={() => {
                      if (targetId !== null) onpurchasemutation(option, targetId);
                    }}
                  >
                    Buy {capRushSpinPurchaseLabel(option)}
                  </Button>
                </div>
              </Panel>
            {/each}
          </div>
        </div>
      {:else}
        <div class="rounded-xl border border-line-soft bg-surface-1 p-3">
          {#if !purchasesLeft || allTargetsMutated}
            <p class="text-sm font-semibold">All five mutation purchases are used.</p>
            <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
              Confirm your roster to close the mutation window.
            </p>
          {:else}
            <p class="text-sm font-semibold">No spin fits the normal cap.</p>
            <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
              {exactMoney(mutationBudget)} mutation budget left. {purchaseCostSummary()}.
            </p>
          {/if}
        </div>
      {/if}

      <div class="flex flex-wrap items-center gap-2">
        <Button tone="secondary" disabled={busy} onclick={onskipmutation}>Skip mutations</Button>
        <p class="ui-micro">Total spending {exactMoney(localPayroll + spinSpend)}</p>
      </div>
    </Panel>
  {/if}

  <Panel as="section" padding="none" class="flex flex-col gap-2 p-3 sm:p-4">
    <SectionHeading level={3} size="sm" title="Lock the rosters" align="center" />
    <div class="flex flex-wrap items-center gap-3">
      <Button tone="primary" disabled={busy || localConfirmed} onclick={onconfirmlock}>
        {localConfirmed ? 'You confirmed' : 'Confirm roster'}
      </Button>
      <p class="text-xs leading-snug" role="status">
        {#if localConfirmed}
          You confirmed · {opponentConfirmed ? 'Opponent confirmed' : 'Waiting for opponent'}
        {:else if opponentConfirmed}
          Opponent confirmed · Waiting for you
        {:else}
          Waiting for both seats
        {/if}
      </p>
    </div>
  </Panel>

  {#if mutationWindow && receipts.length > 0}
    <Panel as="section" padding="none" class="flex flex-col gap-2 p-3 sm:p-4">
      <SectionHeading level={3} size="sm" title="Mutation results" align="center">
        {#snippet actions()}
          <span class="ui-micro"
            >{receipts.length} of 5 purchases &middot; {exactMoney(spinSpend)}</span
          >
        {/snippet}
      </SectionHeading>

      {#if latestReceipt !== null}
        {@const player = marketPlayer(pickForReceipt(latestReceipt)?.playerId ?? null)}
        {@const face = player !== null && art !== null ? art.faceFor(player.source) : null}
        {#key latestReceipt.receiptDigest}
          <Panel
            as="article"
            padding="none"
            class="latest-receipt flex min-w-0 items-start gap-2.5 p-3 sm:gap-3 sm:p-4"
            role="status"
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
                aria-hidden="true">{initialsOf(receiptName(latestReceipt))}</span
              >
            {/if}
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="ui-label">Latest purchase</span>
                <HavocTierBadge tier={latestReceipt.tier} size="sm" />
              </div>
              <p class="mt-1 min-w-0 text-sm font-bold">
                <span class="font-mono text-[10px] text-primary">{latestReceipt.target.slot}</span>
                <span class="break-words">{receiptName(latestReceipt)}</span>
              </p>
              <p class="ui-micro mt-0.5">
                {capRushSpinPurchaseLabel(latestReceipt.purchase)} &middot;
                {exactMoney(latestReceipt.priceDollars)}
              </p>
              <div class="mt-2">
                {@render receiptEffects(latestReceipt)}
              </div>
            </div>
          </Panel>
        {/key}
      {/if}

      {#if previousReceipts.length > 0}
        <ul class="grid gap-2 sm:grid-cols-2">
          {#each previousReceipts as receipt (receipt.receiptDigest)}
            {@const player = marketPlayer(pickForReceipt(receipt)?.playerId ?? null)}
            {@const face = player !== null && art !== null ? art.faceFor(player.source) : null}
            <li class="min-w-0">
              <details class="ui-panel group min-w-0" data-padding="none">
                <summary
                  class="flex min-h-11 cursor-pointer list-none items-center gap-2 p-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                      class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-3 font-display text-[10px] font-extrabold text-muted-foreground"
                      aria-hidden="true">{initialsOf(receiptName(receipt))}</span
                    >
                  {/if}
                  <span class="min-w-0 flex-1">
                    <span class="flex min-w-0 items-center gap-1.5">
                      <span class="shrink-0 font-mono text-[10px] font-bold text-primary"
                        >{receipt.target.slot}</span
                      >
                      <span class="truncate text-xs font-bold">{receiptName(receipt)}</span>
                    </span>
                    <span class="ui-micro mt-0.5 block truncate"
                      >{capRushSpinPurchaseLabel(receipt.purchase)} &middot;
                      {exactMoney(receipt.priceDollars)}</span
                    >
                    <span class="mt-0.5 block truncate text-[10px] text-primary"
                      >{mutationNames(receipt)}</span
                    >
                  </span>
                  <HavocTierBadge tier={receipt.tier} size="sm" />
                  <ChevronDown
                    size={14}
                    class="receipt-chevron shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </summary>
                <div class="border-t border-line-soft p-2.5">
                  {@render receiptEffects(receipt)}
                </div>
              </details>
            </li>
          {/each}
        </ul>
      {/if}
    </Panel>
  {/if}
</div>

<style>
  :global(.latest-receipt) {
    animation: receipt-in 500ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  @keyframes receipt-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  :global(.receipt-chevron) {
    transition: transform 150ms ease;
  }
  details[open] :global(.receipt-chevron) {
    transform: rotate(180deg);
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.latest-receipt) {
      animation: none;
    }
    :global(.receipt-chevron) {
      transition: none;
    }
  }
</style>
