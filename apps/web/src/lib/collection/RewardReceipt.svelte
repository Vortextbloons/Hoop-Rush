<script lang="ts">
  import type { CollectionBalances, CollectionGameRecordV2 } from '@hoop-rush/data-contracts';
  import { formatMultiplier } from './collection-setup.ts';
  import {
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
    record: CollectionGameRecordV2;
    balances: CollectionBalances | null;
    objectiveTitleOf?: (objectiveId: string) => string | null;
  } = $props();

  const receipt = $derived(record.reward);
  const rows = $derived(rewardComponentRows(receipt, objectiveTitleOf));
  const evaluation = $derived(
    objectiveEvaluationView(record.objectiveEvaluation, objectiveTitleOf),
  );
  const firstClear = $derived(firstClearView(receipt));
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

<section aria-label="Reward receipt" class="mt-4 rounded-2xl border border-border bg-card p-5">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h3 class="ultimate-eyebrow">Reward receipt</h3>
      <p class="font-display text-xl font-extrabold">{outcomeLabel} · {reasonLabel}</p>
    </div>
    <p class="font-mono text-xs text-muted-foreground">
      {receipt.difficultyId} · {formatMultiplier(receipt.components[0]?.multiplierBp ?? 10_000)}
    </p>
  </div>

  <div class="mt-4 rounded-xl bg-surface-2 p-4">
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

  <ul class="mt-4 space-y-2">
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
    class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/50 bg-surface-2 px-4 py-3"
  >
    <span class="font-display text-base font-extrabold">Total</span>
    <span class="font-display text-xl font-extrabold text-accent tabular-nums">
      {formatSigned(receipt.total)}
    </span>
  </div>

  <dl class="mt-4 grid gap-2 text-sm sm:grid-cols-2">
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
  @media (prefers-reduced-motion: reduce) {
    section :global(*) {
      transition: none !important;
      animation: none !important;
    }
  }
</style>
