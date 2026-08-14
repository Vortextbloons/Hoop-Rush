<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { X } from '@lucide/svelte';
  import type {
    SeasonInfluenceLedgerEntry,
    SeasonInfluenceSource,
  } from '@hoop-rush/data-contracts';
  import type { InfluenceSpendAffordance } from '$lib/season/season-influence-view';

  const SOURCE_LABEL: Record<SeasonInfluenceSource, string> = {
    'initial-grant': 'Initial grant',
    'block-grant': 'Block grant',
    'objective-reward': 'Objective reward',
    'extra-trade-offer': 'Extra trade offer',
    'risky-rehab': 'Risky rehab',
    'free-agent-signing': 'Free-agent signing',
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
      ? `Buy the extra trade offer (window ${String((affordance.windowIndex ?? 0) + 1)}) for 1 Influence`
      : 'Run a risky rehab for 2 Influence';
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
  class="rounded-none bg-surface-1 p-4 sm:rounded-xl"
  data-season-influence-panel
>
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2
      id="influence-heading"
      class="font-display text-base font-extrabold uppercase tracking-tight"
    >
      Influence
    </h2>
    <span class="font-mono text-[10px] text-muted-foreground">
      cap {cap} · floor {floor}
    </span>
  </div>

  <div class="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
    <p class="text-2xl font-extrabold tabular-nums">{balance}</p>
    <p class="font-mono text-[10px] text-muted-foreground">
      {atCap
        ? 'at the +8 cap — grants apply 0'
        : atFloor
          ? 'at the −3 floor — spends are rejected'
          : 'spendable this window'}
    </p>
  </div>

  {#if affordances.some((affordance) => !affordance.spent)}
    <div class="mt-3 flex flex-col gap-2">
      <p class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        Spend
      </p>
      {#each affordances.filter((affordance) => !affordance.spent) as affordance (affordance.purpose + (affordance.injuryId ?? affordance.windowIndex))}
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="text-sm font-semibold">
              {#if affordance.purpose === 'extra-trade-offer'}
                Extra trade offer
              {:else if playerName !== null && affordance.playerVersionId !== null}
                Risky rehab — {playerName(affordance.playerVersionId)}
              {:else}
                Risky rehab
              {/if}
              <span class="ml-1 font-mono text-[10px] font-normal text-muted-foreground">
                cost {affordance.cost} · balance {balance} → {balance - affordance.cost}
              </span>
            </p>
            <p class="font-mono text-[10px] text-muted-foreground">
              {affordance.purpose === 'extra-trade-offer'
                ? 'Generates a fourth human offer this window'
                : '60% chance to cut one game off the recovery; 40% risk of lengthening it and opening the recurrence window'}
            </p>
          </div>
          <button
            type="button"
            onclick={() => openConfirm(affordance)}
            disabled={!affordance.affordable || busy}
            class="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {affordance.affordable ? `Spend ${affordance.cost}` : 'Cannot afford'}
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if recordedOutcomes.length > 0}
    <div class="mt-4">
      <p class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        Recorded rehab outcomes
      </p>
      <ul class="mt-1 flex flex-col gap-1">
        {#each recordedOutcomes as affordance (affordance.injuryId)}
          <li class="flex flex-wrap items-center gap-x-2 text-sm">
            <span class="min-w-0 flex-1 truncate font-semibold">
              {playerName !== null && affordance.playerVersionId !== null
                ? playerName(affordance.playerVersionId)
                : 'Risky rehab'}
            </span>
            <span
              class="shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] {affordance.rehabOutcome ===
              'success'
                ? 'bg-positive/15 text-positive'
                : 'bg-destructive/15 text-destructive'}"
            >
              Outcome: {affordance.rehabOutcome}
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if entries.length > 0}
    <div class="mt-4">
      <p class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        Recent ledger
      </p>
      <ul class="mt-1 flex flex-col divide-y divide-border/50">
        {#each entries as entry (entry.entryId)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-sm">
            <span class="min-w-0 flex-1 truncate text-muted-foreground">
              {SOURCE_LABEL[entry.source]}
            </span>
            <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
              {entry.explanation}
            </span>
            <span class="shrink-0 font-mono text-[10px] font-bold tabular-nums">
              {deltaLabel(entry.appliedDelta)} → {entry.balanceAfter}
            </span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  <p class="sr-only" role="status" aria-live="polite">
    Influence balance {balance}; {entries.length} recent ledger entries.
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
      <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
      <Dialog.Content
        class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
      >
        <div class="flex items-start justify-between gap-3">
          <Dialog.Title
            class="font-display truncate text-lg font-extrabold tracking-tight uppercase"
          >
            {pendingSpend.purpose === 'extra-trade-offer'
              ? 'Buy the extra trade offer?'
              : 'Run a risky rehab?'}
          </Dialog.Title>
          <Dialog.Close
            aria-label="Cancel"
            class="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
          >
            <X class="h-4 w-4" />
          </Dialog.Close>
        </div>
        <p class="mt-2 text-sm text-muted-foreground">
          {affordanceLabel(pendingSpend)}. The balance would move to
          <strong class="text-foreground"> {balance - pendingSpend.cost}</strong> (floor −3).
        </p>
        <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onclick={() => (spendOpen = false)}
            disabled={busy}
            class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={confirmSpend}
            disabled={busy}
            class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Confirm spend
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
{/if}
