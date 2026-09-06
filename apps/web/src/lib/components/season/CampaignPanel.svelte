<script lang="ts">
  import { campaignHistoryOf, campaignOpportunityCardsOf } from '$lib/season/season-presentation';
  import type { SeasonRun } from '@hoop-rush/data-contracts';
  let {
    run,
    nextBlockIndex,
    busy = false,
    commandError = null,
    onSelectOpportunity,
    playerName = () => 'Unknown player',
  }: {
    run: SeasonRun | null;
    nextBlockIndex: number | null;
    busy?: boolean;
    commandError?: string | null;
    onSelectOpportunity: (input: { blockIndex: number; opportunityId: string }) => void;
    playerName?: (playerVersionId: string) => string;
  } = $props();
  const decision = $derived(
    run !== null ? campaignOpportunityCardsOf(run, nextBlockIndex, playerName) : null,
  );
  const history = $derived(campaignHistoryOf(run));
  const cards = $derived(decision?.cards ?? []);
  const blockIndex = $derived(decision?.blockIndex ?? nextBlockIndex);
  const isFinal = $derived(decision?.isFinalBlock ?? false);
</script>

<section
  aria-labelledby="campaign-heading"
  id="campaign-opportunity"
  class="flex flex-col gap-3"
  data-testid="campaign-panel"
>
  <h2 id="campaign-heading" class="text-base font-extrabold uppercase tracking-tight">
    Opportunity
  </h2>

  {#if decision === null}
    <p class="rounded-xl bg-surface-1 p-4 text-xs text-muted-foreground">Loading opportunity…</p>
  {:else if isFinal}
    <p class="rounded-lg bg-surface-2 p-3 text-xs text-muted-foreground">
      Final block — no new opportunity. Past results are under History.
    </p>
  {:else if cards.length === 0}
    <p class="rounded-lg bg-surface-2 p-3 text-xs text-muted-foreground">
      Preparing the opportunities…
    </p>
  {:else}
    {#if commandError !== null}
      <p role="alert" class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
        {commandError}
      </p>
    {/if}
    <ul class="grid gap-3 lg:grid-cols-2">
      {#each cards as card (card.opportunityId)}
        <li
          class="flex flex-col gap-2 rounded-xl border bg-card p-4 {card.selected
            ? 'border-primary bg-primary/5 ring-1 ring-primary'
            : 'border-border'}"
        >
          <p class="text-xs font-bold">{card.targetLabel}</p>
          <p class="text-xs text-muted-foreground">{card.conditionLabel}</p>
          <p class="text-xs">
            <span class="font-semibold">{card.rewardLabel}</span>
            {#if card.breakthroughLabel !== null}
              <span class="text-muted-foreground"> · breakthrough: {card.breakthroughLabel}</span>
            {/if}
          </p>
          <button
            type="button"
            disabled={card.selected || busy}
            onclick={() =>
              onSelectOpportunity({
                blockIndex: card.blockIndex,
                opportunityId: card.opportunityId,
              })}
            aria-pressed={card.selected}
            data-testid={`select-opportunity-${card.opportunityId}`}
            class="mt-auto inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {card.selected ? 'Selected' : 'Select'}
          </button>
        </li>
      {/each}
    </ul>
    {#if blockIndex !== null && blockIndex !== undefined}
      <p class="font-mono text-xs text-muted-foreground">Choose one for Block {blockIndex + 1}.</p>
    {/if}
  {/if}

  {#if history.length > 0}
    <details class="rounded-xl border border-border bg-surface-1">
      <summary
        class="cursor-pointer p-4 text-xs font-bold uppercase tracking-wide text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        History ({history.length})
      </summary>
      <ul class="flex flex-col gap-2 border-t border-border p-4">
        {#each history as entry (entry.blockIndex)}
          <li class="text-xs">
            <span class="font-bold">Block {entry.blockIndex + 1} · {entry.outcomeLabel}</span>
            <span class="mt-0.5 block text-muted-foreground">{entry.explanation}</span>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</section>
