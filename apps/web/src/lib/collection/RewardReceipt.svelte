<script lang="ts">
  import type {
    CollectionBalances,
    CollectionGameRecordV2,
    CollectionGameRecordV3,
  } from '@hoop-rush/data-contracts';
  import { formatMultiplier } from './collection-setup.ts';
  import { requirementLabel } from './collection-progression-view.ts';
  import {
    challengeRewardView,
    firstClearView,
    objectiveEvaluationView,
    receiptPrimaryReason,
    rewardComponentRows,
  } from './collection-reward-view.ts';

  let {
    record,
    balances,
    objectiveTitleOf,
  }: {
    record: CollectionGameRecordV2 | CollectionGameRecordV3;
    balances: CollectionBalances | null;
    objectiveTitleOf?: (objectiveId: string) => string | null;
  } = $props();

  const receipt = $derived(record.reward);
  const rows = $derived(rewardComponentRows(receipt, objectiveTitleOf));
  const evaluation = $derived(
    objectiveEvaluationView(record.objectiveEvaluation, objectiveTitleOf),
  );
  const firstClear = $derived(firstClearView(receipt));
  const challenge = $derived(record.gameVersion === 'collection-game-v3' ? record : null);
  const challengeReward = $derived(challengeRewardView(receipt));
  const outcomeLabel = $derived(
    receipt.gameOutcome === 'forfeit'
      ? receipt.playerWin
        ? 'Win by forfeit'
        : 'Loss by forfeit'
      : receipt.playerWin
        ? 'Win'
        : 'Loss',
  );
  const reasonLabel = $derived(
    receiptPrimaryReason(receipt) === 'game-win-reward' ? 'win reward' : 'loss reward',
  );

  function formatSigned(value: number): string {
    return `+${value.toLocaleString('en-US')}`;
  }
</script>

<section
  aria-label="Reward receipt"
  class="ur-reward-receipt mt-4 rounded-2xl border border-border bg-card p-5"
>
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h3 class="ultimate-eyebrow">Reward receipt</h3>
      <p class="font-display text-xl font-extrabold">{outcomeLabel} · {reasonLabel}</p>
    </div>
    <p class="font-mono text-xs text-muted-foreground">
      {receipt.difficultyId} · {formatMultiplier(receipt.components[0]?.multiplierBp ?? 10_000)}
    </p>
  </div>

  <div class="ur-receipt-objective mt-4 rounded-xl bg-surface-2 p-4">
    <h4 class="text-sm font-bold">Objective</h4>
    <p
      class="mt-1 text-sm font-bold {evaluation.success === null
        ? 'text-muted-foreground'
        : evaluation.success
          ? 'text-accent'
          : 'text-destructive'}"
    >
      {evaluation.statusLabel}
    </p>
    {#if evaluation.conditionLabel}
      <p class="mt-1 text-xs text-muted-foreground">{evaluation.conditionLabel}</p>
    {/if}
    {#if evaluation.kind === 'evaluated'}
      <p class="mt-1 text-xs tabular-nums">
        Recorded: {evaluation.actualValue} · Threshold: {evaluation.threshold}
      </p>
    {/if}
    <p class="mt-1 text-xs text-muted-foreground">{evaluation.detail}</p>
  </div>

  {#if challenge && challengeReward}
    <div class="ur-receipt-challenge mt-4 rounded-xl border border-accent/50 bg-surface-2 p-4">
      <h4 class="text-sm font-bold">Challenge · {challenge.prepared.challenge.displayName}</h4>
      <p class="mt-1 text-xs text-muted-foreground">
        {requirementLabel(challenge.prepared.challenge.requirement)} · {challenge.prepared.challenge
          .difficultyId} · snapshotted before tip-off
      </p>
      <p
        class="mt-2 text-sm font-bold {challengeReward.firstClearGranted
          ? 'text-accent'
          : 'text-muted-foreground'}"
      >
        {challengeReward.label}
      </p>
      <p class="mt-1 text-xs text-muted-foreground">{challengeReward.detail}</p>
      <dl class="mt-2 grid gap-1 text-xs sm:grid-cols-2">
        <div class="flex justify-between gap-2">
          <dt class="text-muted-foreground">First clear</dt>
          <dd class="tabular-nums">
            {challenge.prepared.challenge.firstClearCoins} Coins
            {challenge.prepared.challenge.firstClearEligible ? '(eligible)' : '(claimed)'}
          </dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-muted-foreground">Repeat win</dt>
          <dd class="tabular-nums">{challenge.prepared.challenge.repeatWinCoins} Coins</dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-muted-foreground">Snapshotted requirement</dt>
          <dd class="tabular-nums">
            {challenge.prepared.challenge.validation.rosterCount}/{challenge.prepared.challenge
              .validation.requiredRosterCount} active ·
            {challenge.prepared.challenge.validation.starterCount}/{challenge.prepared.challenge
              .validation.requiredStarterCount} starters
          </dd>
        </div>
        <div class="flex justify-between gap-2">
          <dt class="text-muted-foreground">Challenge ID</dt>
          <dd class="truncate font-mono">{challenge.prepared.challenge.challengeId}</dd>
        </div>
      </dl>
    </div>
  {/if}

  <ul class="ur-receipt-rows mt-4 space-y-2">
    {#each rows as row (row.kind)}
      <li
        class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-4 py-3"
      >
        <span>
          <span class="block text-sm font-semibold">{row.label}</span>
          <span class="block text-xs text-muted-foreground tabular-nums">{row.detail}</span>
        </span>
        <span class="font-display text-base font-extrabold text-accent tabular-nums">
          {formatSigned(row.amount)}
        </span>
      </li>
    {/each}
  </ul>

  <div
    class="ur-receipt-total mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/50 bg-surface-2 px-4 py-3"
  >
    <span class="font-display text-base font-extrabold">Total</span>
    <span class="font-display text-xl font-extrabold text-accent tabular-nums">
      {formatSigned(receipt.total)}
    </span>
  </div>

  <dl class="ur-receipt-ledger mt-4 grid gap-2 text-sm sm:grid-cols-2">
    <div class="rounded-xl bg-surface-2 px-4 py-3">
      <dt class="text-xs text-muted-foreground">New Coins balance</dt>
      <dd class="font-bold tabular-nums">
        {balances === null ? 'Unavailable' : balances.Coins.toLocaleString('en-US')}
      </dd>
    </div>
    <div class="rounded-xl bg-surface-2 px-4 py-3">
      <dt class="text-xs text-muted-foreground">{firstClear.label}</dt>
      <dd class="text-xs text-muted-foreground">{firstClear.detail}</dd>
    </div>
  </dl>
</section>

<style>
  .ur-reward-receipt {
    border: 1px solid var(--ur-line-strong);
    border-top: 3px solid var(--ur-success);
    border-radius: 0;
    background:
      radial-gradient(
        ellipse at 100% 0%,
        color-mix(in srgb, var(--ur-success) 10%, transparent),
        transparent 35%
      ),
      var(--ur-raised);
    padding: clamp(1rem, 3vw, 1.5rem);
  }

  .ur-reward-receipt .ultimate-eyebrow {
    color: var(--ur-success);
  }

  .ur-receipt-objective {
    border-inline-start: 3px solid var(--ur-titan);
    border-radius: 0;
    background: var(--ur-surface);
  }

  .ur-receipt-challenge {
    border-color: var(--ur-ember);
    border-inline-start-width: 3px;
    border-radius: 0;
    background: var(--ur-surface);
  }

  .ur-receipt-rows li {
    border-inline-start: 2px solid var(--ur-line-strong);
    border-radius: 0;
    background: var(--ur-surface);
  }

  .ur-receipt-rows li:last-child {
    border-inline-start-color: var(--ur-apex);
  }

  .ur-receipt-total {
    border-color: var(--ur-apex);
    border-radius: 0;
    background:
      linear-gradient(105deg, color-mix(in srgb, var(--ur-apex) 14%, transparent), transparent 62%),
      var(--ur-bg);
    padding: 1rem;
  }

  .ur-receipt-total > span:last-child {
    font-size: clamp(1.4rem, 4vw, 1.9rem);
  }

  .ur-receipt-ledger > div {
    border-top: 1px solid var(--ur-line);
    background: var(--ur-surface);
    padding: 0.75rem 1rem;
  }

  @media (prefers-reduced-motion: reduce) {
    section :global(*) {
      transition: none !important;
      animation: none !important;
    }
  }
</style>
