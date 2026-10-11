<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import type {
    SeasonInfluenceLedgerEntry,
    SeasonInfluenceSource,
  } from '@hoop-rush/data-contracts';
  import type { InfluenceSpendAffordance } from '$lib/season/season-influence-view';
  const SOURCE_LABEL: Record<SeasonInfluenceSource, string> = {
    'initial-grant': 'Starting Influence',
    'block-grant': 'Played block',
    'objective-reward': 'Goal reward',
    'challenge-reward': 'Challenge reward',
    'campaign-reward': 'Story reward',
    'extra-trade-offer': 'Extra trade offer',
    'trade-inquiry-purchase': 'Trade inquiry',
    'trade-cash-sent': 'Trade Influence sent',
    'trade-cash-received': 'Trade Influence received',
    'risky-rehab': 'Injury rehab',
    'free-agent-signing': 'Signed free agent',
    'sponsor-purchase': 'Sponsor gear',
  };
  let {
    balance,
    cap,
    floor,
    atCap,
    atFloor,
    entries,
    affordances,
    busy = false,
    playerName = null,
    onSpend,
  }: {
    balance: number;
    cap: number;
    floor: number;
    atCap: boolean;
    atFloor: boolean;
    entries: SeasonInfluenceLedgerEntry[];
    affordances: InfluenceSpendAffordance[];
    busy?: boolean;
    playerName?: ((playerVersionId: string) => string) | null;
    onSpend: (affordance: InfluenceSpendAffordance) => void;
  } = $props();
  let pendingSpend: InfluenceSpendAffordance | null = $state(null);
  let spendOpen = $state(false);
  function openConfirm(affordance: InfluenceSpendAffordance): void {
    if (affordance.spent || !affordance.affordable || busy) return;
    pendingSpend = affordance;
    spendOpen = true;
  }
  function confirmSpend(): void {
    if (pendingSpend === null) return;
    spendOpen = false;
    const affordance = pendingSpend;
    pendingSpend = null;
    onSpend(affordance);
  }
  function affordanceLabel(affordance: InfluenceSpendAffordance): string {
    return affordance.purpose === 'extra-trade-offer'
      ? `Open one more trade talk (window ${String((affordance.windowIndex ?? 0) + 1)}) for ${String(affordance.cost)} Influence`
      : `Try to bring an injured player back sooner for ${String(affordance.cost)} Influence`;
  }
  function rehabTitle(affordance: InfluenceSpendAffordance): string {
    const name =
      playerName !== null && affordance.playerVersionId !== null
        ? playerName(affordance.playerVersionId)
        : 'Injured player';
    return `Bring back ${name} (${String(affordance.cost)}◆)`;
  }
  const recordedOutcomes = $derived(
    affordances.filter(
      (affordance) =>
        affordance.purpose === 'risky-rehab' &&
        affordance.rehabOutcome !== null &&
        affordance.rehabOutcome !== 'pending',
    ),
  );
  const deltaLabel = (delta: number): string => (delta >= 0 ? `+${String(delta)}` : String(delta));
</script>

<section
  aria-labelledby="influence-heading"
  class="sr-panel-quiet p-4"
  data-season-influence-panel
>
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2
      id="influence-heading"
      class="font-display text-base font-extrabold uppercase tracking-tight"
    >
      Influence
    </h2>
  </div>

  <div class="mt-2">
    <div class="sr-stat-tile" data-tone={atFloor ? 'loss' : 'live'}>
      <strong>◆ {balance}/{cap}</strong>
      <span>
        {atCap
          ? 'Full — spend to keep earning'
          : atFloor
            ? 'Empty — play blocks to earn more'
            : 'Play blocks to earn more.'}
      </span>
    </div>
  </div>

  {#if affordances.some((affordance) => !affordance.spent)}
    <div class="mt-3 flex flex-col gap-2">
      <p class="sr-section-label">
        Use Influence
      </p>
      {#each affordances.filter((affordance) => !affordance.spent) as affordance (affordance.purpose + (affordance.injuryId ?? affordance.windowIndex))}
        <div class="sr-gamecard flex flex-wrap items-center justify-between gap-2 p-3">
          <div class="min-w-0">
            <p class="text-sm font-semibold">
              {#if affordance.purpose === 'extra-trade-offer'}
                Extra trade talk
              {:else}
                {rehabTitle(affordance)}
              {/if}
              <span class="sr-chip ml-1">
                {affordance.cost} Influence
              </span>
            </p>
            <p class="text-xs text-muted-foreground">
              {affordance.purpose === 'extra-trade-offer'
                ? 'Talk to one more team this window.'
                : 'Chance sooner, can set back.'}
            </p>
          </div>
          <button
            type="button"
            onclick={() => openConfirm(affordance)}
            disabled={!affordance.affordable || busy}
            class="sr-btn"
          >
            {affordance.affordable ? `Use ${affordance.cost}` : 'Need more'}
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if recordedOutcomes.length > 0}
    <div class="mt-4">
      <p class="sr-section-label">
        Rehab results
      </p>
      <ul class="mt-1 flex flex-col gap-1">
        {#each recordedOutcomes as affordance (affordance.injuryId)}
          <li class="flex flex-wrap items-center gap-x-2 text-sm">
            <span class="min-w-0 flex-1 truncate font-semibold">
              {playerName !== null && affordance.playerVersionId !== null
                ? playerName(affordance.playerVersionId)
                : 'Injury rehab'}
            </span>
            <span class="sr-badge shrink-0" data-tone={affordance.rehabOutcome === 'success' ? 'win' : 'loss'}>
              {affordance.rehabOutcome === 'success' ? 'Back sooner' : 'Setback'}
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if entries.length > 0}
    <details class="mt-4">
      <summary
        class="sr-section-label cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Recent activity
      </summary>
      <ul class="mt-1 flex flex-col divide-y divide-border/50">
        {#each entries as entry (entry.entryId)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-sm">
            <span class="min-w-0 flex-1 truncate text-muted-foreground">
              {SOURCE_LABEL[entry.source]}
            </span>
            <span class="sr-number shrink-0 font-mono text-[10px] font-bold tabular-nums">
              {deltaLabel(entry.appliedDelta)} → {entry.balanceAfter}
            </span>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
  <p class="sr-only" role="status" aria-live="polite">
    Influence balance {balance}; {entries.length} recent entries.
  </p>
</section>

{#if pendingSpend !== null}
  <Dialog.Root
    open={spendOpen}
    onOpenChange={(open) => {
      if (!open) spendOpen = false;
    }}
  >
    <Dialog.Portal>
      <Dialog.Overlay class="sr-dialog-overlay" />
      <Dialog.Content
        class="sr-dialog max-h-[85dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6"
      >
        <div class="flex items-start justify-between gap-3">
          <Dialog.Title
            class="font-display truncate text-lg font-extrabold tracking-tight uppercase"
          >
            {pendingSpend.purpose === 'extra-trade-offer'
              ? 'Open one more trade talk?'
              : 'Try to bring them back sooner?'}
          </Dialog.Title>
          <Dialog.Close
            aria-label="Cancel"
            class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
          >
            <X class="h-4 w-4" />
          </Dialog.Close>
        </div>
        <p class="mt-2 text-sm text-muted-foreground">
          {affordanceLabel(pendingSpend)}. You’ll have
          <strong class="text-foreground"> {balance - pendingSpend.cost}</strong> left.
        </p>
        <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onclick={() => (spendOpen = false)}
            disabled={busy}
            class="sr-btn-ghost"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={confirmSpend}
            disabled={busy}
            class="sr-btn"
          >
            Confirm
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
{/if}
